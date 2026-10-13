import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
const local = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { storage: { local }, runtime: { getURL: (path: string) => `chrome-extension://test${path}` }, tabs: { create: vi.fn() } } }));
vi.mock('../src/diagnostics', async importOriginal => ({ ...await importOriginal<typeof import('../src/diagnostics')>(), exportDiagnostics: vi.fn(), setDebugUntil: vi.fn() }));
import { loadProSettings, saveProSettings, validateServerUrl, normalizeProSettings, validateProData, pair, proFetch } from '../src/pro/client';
import { authMessage, canonicalJson } from '../src/pro/contracts';
import { allowedProRequest, createProWorker } from '../src/pro/worker';
describe('Pro device boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); local.get.mockResolvedValue({}); local.set.mockResolvedValue(undefined); });
  it('signs the exact canonical body with a persisted nonextractable P256 device key', async () => {
    vi.stubGlobal('crypto', webcrypto);
    let storedKey: CryptoKeyPair | undefined;
    let settings: Record<string, unknown> = {};
    local.get.mockImplementation(async () => settings);
    local.set.mockImplementation(async (value: Record<string, unknown>) => { settings = { ...settings, ...value }; });
    vi.stubGlobal('indexedDB', { open: () => {
      const open = { result: { close: () => {}, transaction: () => {
        const tx: { oncomplete?: () => void; objectStore: () => unknown } = { objectStore: () => ({
          put: (key: CryptoKeyPair) => { storedKey = key; const req = { result: undefined }; setTimeout(() => tx.oncomplete?.(), 0); return req; },
          get: () => { const req = { result: storedKey }; setTimeout(() => tx.oncomplete?.(), 0); return req; },
        }) }; return tx;
      } }, onsuccess: undefined as undefined | (() => void) };
      queueMicrotask(() => open.onsuccess?.()); return open;
    } });
    const readNonces: string[] = [];
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/v1/info')) return { ok: true, json: async () => ({ ok: true, data: { serverId: 'personal', apiVersion: 1 } }) };
      if (url.endsWith('/v1/pair')) return { ok: true, json: async () => ({ ok: true, data: { serverId: 'personal', deviceId: 'device' } }) };
      const headers = options.headers as Record<string, string>;
      if (url.endsWith('/v1/diagnostics') && options.method === 'GET') {
        readNonces.push(headers['x-dp-nonce']!);
        if (readNonces.length === 1) throw new TypeError('Transient connection loss');
        const message = authMessage('personal', { method: 'GET', path: '/v1/diagnostics', body: '', envelope: { timestamp: Number(headers['x-dp-time']), nonce: headers['x-dp-nonce']! } });
        expect(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, storedKey!.publicKey, Uint8Array.from(atob(headers['x-dp-signature']!), c => c.charCodeAt(0)), new TextEncoder().encode(message))).toBe(true);
        return { ok: true, json: async () => ({ ok: true, data: [] }) };
      }
      const body = options.body as string;
      expect(body).toBe(canonicalJson({ z: 1, a: { y: 2, x: 3 } }));
      const message = authMessage('personal', { method: 'POST', path: '/v1/diagnostics', body, envelope: { timestamp: Number(headers['x-dp-time']), nonce: headers['x-dp-nonce']! } });
      const signature = Uint8Array.from(atob(headers['x-dp-signature']!), c => c.charCodeAt(0));
      expect(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, storedKey!.publicKey, signature, new TextEncoder().encode(message))).toBe(true);
      expect(storedKey!.privateKey.extractable).toBe(false);
      return { ok: true, json: async () => ({ ok: true, data: { id: 'accepted', spec: {} } }) };
    });
    vi.stubGlobal('fetch', fetcher);
    try { await pair('https://personal.example', 'one-time-code'); expect(await proFetch('POST', '/v1/diagnostics', { z: 1, a: { y: 2, x: 3 } })).toEqual({ id: 'accepted', spec: {} }); expect(fetcher).toHaveBeenCalledTimes(3); await proFetch('GET', '/v1/diagnostics'); expect(fetcher).toHaveBeenCalledTimes(5); expect(readNonces[0]).not.toBe(readNonces[1]); expect(fetcher.mock.calls[3]![1].signal).toBe(fetcher.mock.calls[4]![1].signal); fetcher.mockRejectedValueOnce(new TypeError('Mutation connection loss')); await expect(proFetch('POST', '/v1/diagnostics', { z: 1, a: { y: 2, x: 3 } })).rejects.toThrow('Mutation connection loss'); expect(fetcher).toHaveBeenCalledTimes(6); }
    finally { vi.unstubAllGlobals(); }
  });
  it('rejects malformed envelopes and sanitizes server errors before throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: false, error: 'privateKey=abc https://server.example?apiKey=secret' }) })));
    try { await expect(pair('https://personal.example','code')).rejects.toThrow('privateKey=[REDACTED] [RPC]'); }
    finally { vi.unstubAllGlobals(); }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: { serverId: 'server' } }) })));
    try { await expect(pair('https://personal.example','code')).rejects.toThrow('Invalid Pro response envelope'); }
    finally { vi.unstubAllGlobals(); }
  });
  it('fails closed on malformed stored settings and never imports unknown settings fields', () => {
    expect(normalizeProSettings({ enabled: true, serverUrl: 'http://localhost', deviceId: 'device', serverId: 'server' })).toEqual({ enabled: false, serverUrl: '', chromeNotifications: false });
    expect(normalizeProSettings({ enabled: 'true', serverUrl: 'https://personal.example', deviceId: 'device', serverId: 'server', serverKey: 'secret' })).toEqual({ enabled: false, serverUrl: 'https://personal.example', deviceId: 'device', serverId: 'server', chromeNotifications: false });
  });
  it('rejects malformed endpoint data before the UI receives it', () => {
    expect(() => validateProData('/v1/info', { serverId: 'personal', apiVersion: 99 })).toThrow();
    expect(() => validateProData('/v1/pair', { serverId: 'personal', deviceId: { secret: 'key' } })).toThrow();
    expect(() => validateProData('/v1/events?after=0', [{ sequence: -1 }])).toThrow();
    expect(() => validateProData('/v1/wallet', [{ mint: 'bad', decimals: 99 }])).toThrow();
  });
  it('defaults disabled, with no server or notification opt-in', async () => {
    expect(await loadProSettings()).toEqual({ enabled: false, serverUrl: '', chromeNotifications: false });
  });
  it('accepts only HTTPS origins', () => {
    expect(validateServerUrl('https://personal.example:8443/')).toBe('https://personal.example:8443');
    for (const url of ['http://localhost:8080','https://user:pass@example.com','https://example.com/v1','https://example.com?key=x','https://example.com#x']) expect(() => validateServerUrl(url)).toThrow();
  });
  it('persists only session settings, never arbitrary browser secrets', async () => {
    await saveProSettings({ enabled: false, serverUrl: 'https://personal.example/', chromeNotifications: false, secret: 'do-not-store' } as never);
    expect(local.set.mock.calls[0]![0].proSettings).not.toHaveProperty('secret');
  });
  it('blocks signer, arbitrary origins, traversal and unknown endpoints from generic requests', () => {
    for (const path of ['/v1/signer/unlock','https://evil.example/v1/health','/v1/orders/../cancel','/v1/health?key=x']) expect(allowedProRequest('POST', path)).toBe(false);
    expect(allowedProRequest('GET','/v1/health')).toBe(true);
    expect(allowedProRequest('GET','/v1/events?after=42')).toBe(true);
    expect(allowedProRequest('GET','/v1/events?latest=30')).toBe(true);
    for(const path of ['/v1/events?latest=0','/v1/events?latest=501','/v1/events?latest=30&after=0'])expect(allowedProRequest('GET',path)).toBe(false);
    expect(allowedProRequest('POST','/v1/orders/abc-123/cancel')).toBe(false);
    expect(allowedProRequest('POST','/v1/orders/12345678-1234-4123-8123-123456789abc/cancel')).toBe(true);
    expect(allowedProRequest('POST','/v1/orders/12345678-1234-4123-8123-123456789abc:exit/pause')).toBe(true);
  });
  it('allows revision-based UUID edits and generated exit orders only', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    expect(allowedProRequest('PATCH', `/v1/orders/${id}`)).toBe(true);
    expect(allowedProRequest('PATCH', `/v1/orders/${id}:exit`)).toBe(true);
    expect(allowedProRequest('POST', `/v1/orders/${id}:exit/resume`)).toBe(true);
    expect(allowedProRequest('PATCH', '/v1/orders/arbitrary')).toBe(false);
  });
  it('does not allow settings to enable execution or replace server identity', async () => {
    const reply = await createProWorker().handle({ type: 'PRO', action: 'SETTINGS', settings: { enabled: true, serverUrl: 'https://attacker.example', chromeNotifications: false } });
    expect(reply.ok).toBe(false); expect(local.set).not.toHaveBeenCalled();
  });
  it('leaves Pro enabled when the stop cannot be confirmed', async () => {
    local.get.mockResolvedValue({ proSettings: { enabled: true, serverUrl: 'https://personal.example', chromeNotifications: false } });
    const reply = await createProWorker().handle({ type: 'PRO', action: 'DISABLE' });
    expect(reply).toMatchObject({ ok: false, error: expect.stringContaining('Stop unconfirmed') });
    expect(local.set).not.toHaveBeenCalled();
  });
  it('rejects a reviewed session that changed before transport loaded pairing',async()=>{
    local.get.mockResolvedValue({proSettings:{enabled:true,serverUrl:'https://personal.example',serverId:'current-server',deviceId:'current-device',chromeNotifications:false}});
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    try{
      await expect(proFetch('POST','/v2/orders',{spec:{}},{serverId:'reviewed-server',deviceId:'reviewed-device',wallet:'reviewed-wallet'})).rejects.toThrow('session changed');
      expect(fetcher).not.toHaveBeenCalled();
    }finally{vi.unstubAllGlobals();}
  });
});
