import { it, expect, vi } from 'vitest';
import { ProStore } from '../server/store';
import { TelegramOutbox } from '../server/notify';
it('durably retries failed delivery without disclosing credentials or crashing execution', async () => { const store = new ProStore(':memory:'); store.event('FAILED', 'Trade failed.'); const request = vi.fn().mockRejectedValueOnce(new Error('secret')).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }); const notify = new TelegramOutbox(store, 'test-token', 'test-chat', request); await notify.flush(10000); expect(store.db.prepare('SELECT tries FROM outbox').get()?.tries).toBe(1); await notify.flush(20000); expect(store.db.prepare('SELECT 1 FROM outbox').get()).toBeUndefined(); expect(JSON.parse(String(request.mock.calls[0]![1]!.body)).text.startsWith('[DIRECT_PUMP]')).toBe(true); store.close(); });
it('disabled notification configuration keeps durable outbox and makes no network request', async () => { const store = new ProStore(':memory:'); store.event('FAILED', 'Trade failed.'); const request = vi.fn(); await new TelegramOutbox(store, '', '', request).flush(); expect(request).not.toHaveBeenCalled(); expect(store.db.prepare('SELECT count(*) AS n FROM outbox').get()?.n).toBe(1); store.close(); });
it('queues only critical events and guards overlapping slow deliveries', async () => { const store = new ProStore(':memory:'); store.event('CREATED', 'accepted'); store.event('PAUSED', 'paused'); expect(store.db.prepare('SELECT COUNT(*) AS n FROM outbox').get()?.n).toBe(0); store.event('FAILED', 'failed'); let finish!: () => void; const wait = new Promise<void>(resolve => { finish = resolve; }); const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => { await wait; return { ok: true, json: async () => ({ ok: true }) } as Response; }); const notify = new TelegramOutbox(store, 'token', 'chat', request, '42'); const first = notify.flush(); await notify.flush(); expect(request).toHaveBeenCalledTimes(1); expect(JSON.parse(String(request.mock.calls[0]![1]!.body)).message_thread_id).toBe(42); store.diagnostics.log({ component: 'engine', type: 'execution.reconciled', level: 'info' }); expect(store.diagnostics.latest().at(-1)?.type).toBe('execution.reconciled'); finish(); await first; store.close(); });
it('slow notification backlog never blocks engine ticks', async () => { const { startServiceLoops } = await import('../server/cli'); vi.useFakeTimers(); let finish!: () => void; const wait = new Promise<void>(resolve => { finish = resolve; }); const tick = vi.fn(async () => { }), flush = vi.fn(async () => { await wait; }); const stop = startServiceLoops({ tick }, { flush }, { diagnostics: { log: vi.fn() } as unknown as import('../server/diagnostics').ServerDiagnostics }); try {
    await vi.advanceTimersByTimeAsync(4000);
    expect(tick).toHaveBeenCalledTimes(8);
    expect(flush).toHaveBeenCalledTimes(2);
}
finally {
    stop();
    finish();
    vi.useRealTimers();
} });
