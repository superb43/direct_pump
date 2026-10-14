import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProHealth, ProSettings } from '../../src/pro/contracts';

const transport = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), fetch: vi.fn(), tabs: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { tabs: { create: transport.tabs } } }));
vi.mock('../../src/pro/client', () => ({ loadProSettings: transport.load, saveProSettings: transport.save, proFetch: transport.fetch, pair: vi.fn(), streamProEvents: vi.fn() }));
vi.mock('../../src/diagnostics/diagnostics', () => ({ logEvent: vi.fn(), exportDiagnostics: vi.fn(), setDebugUntil: vi.fn() }));
import { allowedProRequest, createProWorker } from '../../src/pro/worker';

let settings: ProSettings;
const health: ProHealth = { apiVersion: 1, serverId: 'server', wallet: 'wallet', signer: 'READY', engine: 'PAUSED', at: 1, capabilities: ['mc-orders-v2', 'exit-strategies-v2'], limits: { maxBuyLamports: '100000000', dailyBuyLamports: '1000000000', maxNetworkLamports: '5000000' } };
beforeEach(() => {
  vi.clearAllMocks();
  settings = { enabled: false, serverUrl: 'https://personal.example', serverId: 'server', deviceId: 'device', chromeNotifications: false };
  transport.load.mockImplementation(async () => ({ ...settings }));
  transport.save.mockImplementation(async value => { settings = { ...value }; });
  transport.fetch.mockImplementation(async (method, path) => path === '/v1/health' ? { ...health, engine: settings.enabled ? 'RUNNING' : 'PAUSED' } : {});
});

describe('Pro sidepanel mode authority', () => {
  it('enables the engine after recording ON and does not resume individual paused orders', async () => {
    const reply = await createProWorker().handle({ type: 'PRO', action: 'ENABLE' });
    expect(reply).toMatchObject({ ok: true, data: { engine: 'RUNNING' } });
    expect(settings.enabled).toBe(true);
    expect(transport.fetch.mock.calls.map(call => call.slice(0, 2))).toEqual([['GET', '/v1/health'], ['POST', '/v1/resume-engine'], ['GET', '/v1/health']]);
    expect(transport.save.mock.invocationCallOrder[0]).toBeLessThan(transport.fetch.mock.invocationCallOrder[1]!);
    expect(transport.tabs).not.toHaveBeenCalled();
  });
  it('keeps OFF when the signer is locked or pairing is missing', async () => {
    transport.fetch.mockResolvedValue({ ...health, signer: 'LOCKED' });
    expect(await createProWorker().handle({ type: 'PRO', action: 'ENABLE' })).toMatchObject({ ok: false, error: expect.stringContaining('Unlock') });
    expect(settings.enabled).toBe(false); expect(transport.save).not.toHaveBeenCalled();
    settings.deviceId = undefined;
    expect(await createProWorker().handle({ type: 'PRO', action: 'ENABLE' })).toMatchObject({ ok: false, error: expect.stringContaining('Pair') });
    expect(transport.fetch).toHaveBeenCalledOnce();
  });
  it('preserves ON after a lost engine resume acknowledgement without retrying the mutation', async () => {
    transport.fetch.mockImplementation(async (method, path) => {
      if (path === '/v1/health') return health;
      throw new Error('Lost acknowledgement.');
    });
    expect(await createProWorker().handle({ type: 'PRO', action: 'ENABLE' })).toMatchObject({ ok: false, error: expect.stringContaining('Start unconfirmed') });
    expect(settings.enabled).toBe(true);
    expect(transport.fetch.mock.calls.filter(call => call[0] === 'POST')).toHaveLength(1);
  });
  it('records OFF only after confirmed server pause and keeps ON after an outage', async () => {
    settings.enabled = true;
    transport.fetch.mockRejectedValueOnce(new Error('Offline'));
    const worker = createProWorker();
    expect(await worker.handle({ type: 'PRO', action: 'DISABLE' })).toMatchObject({ ok: false, error: expect.stringContaining('Stop unconfirmed') });
    expect(settings.enabled).toBe(true); expect(transport.save).not.toHaveBeenCalled();
    expect(await worker.handle({ type: 'PRO', action: 'DISABLE' })).toMatchObject({ ok: true });
    expect(settings.enabled).toBe(false);
  });
  it('serializes enable and disable so the final OFF follows its server acknowledgement', async () => {
    const worker = createProWorker();
    const replies = await Promise.all([worker.handle({ type: 'PRO', action: 'ENABLE' }), worker.handle({ type: 'PRO', action: 'DISABLE' })]);
    expect(replies.every(reply => reply.ok)).toBe(true);
    expect(settings.enabled).toBe(false);
    expect(transport.fetch.mock.calls.filter(call => call[0] === 'POST').map(call => call[1])).toEqual(['/v1/resume-engine', '/v1/pause-all']);
  });
  it('rejects the retired tab-opening action', async () => {
    expect(await createProWorker().handle({ type: 'PRO', action: 'OPEN' } as never)).toMatchObject({ ok: false });
    expect(transport.tabs).not.toHaveBeenCalled();
  });
  it('binds an MC mutation to the reviewed server, device and wallet inside the queue', async () => {
    settings.enabled=true;
    const expectedSession={serverId:'server',deviceId:'device',wallet:health.wallet};
    const body={orderId:'123e4567-e89b-42d3-a456-426614174000',spec:{},expectedWallet:'substituted'};
    expect(await createProWorker().handle({type:'PRO',action:'REQUEST',method:'POST',path:'/v2/orders',body,expectedSession})).toMatchObject({ok:true});
    expect(transport.fetch).toHaveBeenLastCalledWith('POST','/v2/orders',{...body,expectedWallet:health.wallet},expectedSession);
    settings.deviceId='another-device';transport.fetch.mockClear();
    expect(await createProWorker().handle({type:'PRO',action:'REQUEST',method:'POST',path:'/v2/orders',body,expectedSession})).toMatchObject({ok:false,error:expect.stringContaining('session changed')});
    expect(transport.fetch).not.toHaveBeenCalled();
  });
  it('refuses a wallet change or unbound MC mutation before posting anything', async () => {
    settings.enabled=true;
    expect(await createProWorker().handle({type:'PRO',action:'REQUEST',method:'POST',path:'/v2/preview',body:{spec:{}}})).toMatchObject({ok:false,error:expect.stringContaining('server wallet')});
    expect(transport.fetch).not.toHaveBeenCalled();
    transport.fetch.mockResolvedValue({...health,wallet:'new-wallet'});
    expect(await createProWorker().handle({type:'PRO',action:'REQUEST',method:'PATCH',path:'/v2/orders/123e4567-e89b-42d3-a456-426614174000',body:{spec:{}},expectedSession:{serverId:'server',deviceId:'device',wallet:health.wallet}})).toMatchObject({ok:false,error:expect.stringContaining('wallet changed')});
    expect(transport.fetch.mock.calls.some(call=>call[0]==='PATCH')).toBe(false);
  });
});

it('allows only bounded v2 MC order and strategy paths', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  for (const kind of ['orders', 'strategies']) {
    expect(allowedProRequest('GET', `/v2/${kind}`)).toBe(true);
    expect(allowedProRequest('POST', `/v2/${kind}`)).toBe(true);
    expect(allowedProRequest('PATCH', `/v2/${kind}/${id}`)).toBe(true);
    for (const action of ['pause', 'resume', 'cancel', 'retry']) expect(allowedProRequest('POST', `/v2/${kind}/${id}:exit/${action}`)).toBe(true);
  }
  expect(allowedProRequest('POST', '/v2/preview')).toBe(true);
  for (const path of ['/v2/signer/unlock', `/v2/orders/${id}/sign`, '/v2/orders/../cancel', '/v2/orders/arbitrary/cancel', 'https://evil.example/v2/preview', '/v2/orders?all=1']) expect(allowedProRequest('POST', path)).toBe(false);
});
