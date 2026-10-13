import { it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createProServer, type ApiAuth } from '../server/api';
import type { ProEngine } from '../server/engine';
import { ProStore } from '../server/store';
import { WithdrawalService } from '../server/withdrawal-service';
import { canonicalJson } from '../src/pro/contracts';

function harness(auth: ApiAuth, engine = {} as ProEngine) {
    const server = createProServer(engine, auth, 'server');
    return (url: string, method = 'GET', body?: unknown) => new Promise<{ status: number; body: any }>(resolve => {
        const req = Object.assign(Readable.from(body ? [JSON.stringify(body)] : []), { method, url, headers: { 'x-dp-device': 'device', 'x-dp-nonce': 'nonce', 'x-dp-time': '123', 'x-dp-signature': 'signature' } });
        const res = { statusCode: 200, setHeader() {}, end(value: string) { resolve({ status: res.statusCode, body: JSON.parse(value) }); } };
        server.emit('request', req, res);
    });
}
const baseAuth = { verify: async () => 'device', pair: async () => ({ deviceId: 'device', serverId: 'server' }) };
it('routes each withdrawal action with the original bound path and canonical proof after API authentication', async () => {
    const verify = vi.fn(baseAuth.verify), withdrawal = vi.fn(async () => ({ id: 'public-id' }));
    const invoke = harness({ ...baseAuth, verify, withdrawal });
    const cases = [
        ['/v1/recipients', 'GET', 'recipients'], ['/v1/recipients', 'POST', 'addRecipient'],
        ['/v1/recipients/id/deactivate', 'POST', 'deactivateRecipient'],
        ['/v1/withdrawals/preview', 'POST', 'preview'], ['/v1/withdrawals', 'POST', 'approve'],
        ['/v1/withdrawals', 'GET', 'withdrawals'], ['/v1/withdrawals/id', 'GET', 'withdrawal'],
    ];
    for (const [path, method, action] of cases) {
        const body = method === 'GET' ? undefined : { z: 2, a: 1 };
        expect((await invoke(path!, method!, body)).body).toEqual({ ok: true, data: { id: 'public-id' } });
        expect(withdrawal).toHaveBeenLastCalledWith(action, expect.objectContaining({ method, path, body: body ? canonicalJson(body) : '' }));
        expect(verify.mock.invocationCallOrder.at(-1)).toBeLessThan(withdrawal.mock.invocationCallOrder.at(-1)!);
    }
    expect((await invoke('/v1/info')).body.data.capabilities).toEqual(['withdrawals-v1']);
});
it('unauthorized withdrawal requests never reach the signer', async () => {
    const withdrawal = vi.fn();
    const invoke = harness({ ...baseAuth, verify: async () => { throw new Error('Unauthorized.'); }, withdrawal });
    expect((await invoke('/v1/withdrawals', 'POST', { previewId: 'p', spec: {} })).body.ok).toBe(false);
    expect(withdrawal).not.toHaveBeenCalled();
});
it('uses signer-authoritative wallet reservations and omits capability for old servers', async () => {
    const balance = [{ mint: 'SOL', decimals: 9, totalRaw: '100', reservedRaw: '90', availableRaw: '10' }];
    const walletBalances = vi.fn(async () => balance);
    const invoke = harness({ ...baseAuth, walletBalances });
    expect((await invoke('/v1/wallet?mint=SOL')).body.data).toEqual(balance);
    expect(walletBalances).toHaveBeenCalledWith('SOL');
    expect((await invoke('/v1/info')).body.data).not.toHaveProperty('capabilities');
});
it('persists status alert deduplication with event and outbox in one transaction across service restart', async () => {
    const store = new ProStore(':memory:');
    let state = 'CONFIRMED';
    const signer = { withdrawal: vi.fn(async () => [{ id: 'withdrawal-id', state, signature: 'signature' }]) };
    try {
        await new WithdrawalService(signer, store).poll();
        await new WithdrawalService(signer, store).poll();
        expect(store.events()).toHaveLength(1);
        expect(store.events()[0]).toMatchObject({ type: 'CONFIRMED', withdrawalId: 'withdrawal-id', signature: 'signature', message: 'Withdrawal confirmed.' });
        expect(store.db.prepare('SELECT COUNT(*) AS n FROM outbox').get()?.n).toBe(1);
        state = 'FINALIZED';
        await new WithdrawalService(signer, store).poll();
        expect(store.events().map(row => row.type)).toEqual(['CONFIRMED', 'FINALIZED']);
        expect(store.meta('withdrawal-alert:withdrawal-id')).toBe('FINALIZED');
    } finally { store.close(); }
});
it('rolls back emitted status when durable event persistence fails', async () => {
    const store = new ProStore(':memory:');
    const service = new WithdrawalService({ withdrawal: async () => [{ id: 'w', state: 'FAILED' }] }, store);
    try {
        const original = store.event.bind(store);
        store.event = () => { throw new Error('disk failure'); };
        await service.poll();
        expect(store.meta('withdrawal-alert:w')).toBeUndefined();
        store.event = original;
        await service.poll();
        expect(store.events()).toHaveLength(1);
    } finally { store.close(); }
});
it('slow signer status polling is singleflight and independent from order ticks', async () => {
    const { startServiceLoops } = await import('../server/cli');
    vi.useFakeTimers();
    const store = new ProStore(':memory:');
    let finish!: () => void;
    const withdrawal = vi.fn(() => new Promise<unknown>(resolve => { finish = () => resolve([]); }));
    const service = new WithdrawalService({ withdrawal }, store), tick = vi.fn(async () => {});
    const stop = startServiceLoops({ tick }, { flush: async () => {} }, store, service);
    try {
        await vi.advanceTimersByTimeAsync(5000);
        expect(tick.mock.calls.length).toBe(10);
        expect(withdrawal).toHaveBeenCalledTimes(1);
        finish();
        await Promise.resolve();
    } finally { stop(); vi.useRealTimers(); store.close(); }
});
it('handshake hides withdrawals for old or unavailable signer IPC and advertises matching builds', async () => {
    const withdrawal = vi.fn(async () => []);
    expect((await harness({ ...baseAuth, withdrawal, capabilities: async () => [] })('/v1/info')).body.data).not.toHaveProperty('capabilities');
    expect((await harness({ ...baseAuth, withdrawal, capabilities: async () => { throw new Error('Unknown RPC'); } })('/v1/info')).body.data).not.toHaveProperty('capabilities');
    expect((await harness({ ...baseAuth, withdrawal, capabilities: async () => ['withdrawals-v1'] })('/v1/info')).body.data.capabilities).toEqual(['withdrawals-v1']);
    const health = { health: async () => ({ signer: 'READY' }) } as unknown as ProEngine;
    expect((await harness({ ...baseAuth, withdrawal, capabilities: async () => [] }, health)('/v1/health')).body.data).not.toHaveProperty('capabilities');
    expect((await harness({ ...baseAuth, withdrawal, capabilities: async () => ['withdrawals-v1'] }, health)('/v1/health')).body.data.capabilities).toEqual(['withdrawals-v1']);
});
it('emits confirmed success once when polling first observes finalized and alerts definitive expiry', async () => {
    const store = new ProStore(':memory:');
    let state = 'FINALIZED';
    const signer = { withdrawal: async () => [{ id: 'success', state }, { id: 'expired', state: 'EXPIRED' }] };
    try {
        await new WithdrawalService(signer, store).poll();
        expect(store.events().map(row => row.type)).toEqual(['CONFIRMED', 'FINALIZED', 'EXPIRED']);
        expect(store.db.prepare('SELECT COUNT(*) AS n FROM outbox').get()?.n).toBe(3);
        await new WithdrawalService(signer, store).poll();
        expect(store.events()).toHaveLength(3);
        state = 'CONFIRMED';
        await new WithdrawalService(signer, store).poll();
        expect(store.events().filter(row => row.type === 'CONFIRMED')).toHaveLength(1);
    } finally { store.close(); }
});
