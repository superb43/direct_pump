import { beforeEach, expect, it, vi } from 'vitest';
import { DIAGNOSTIC_DEBUG_MAX_MS, diagnosticEvents, exportDiagnostics, logEvent, sanitizeDiagnostic, setDebugUntil } from '../../src/diagnostics/diagnostics';
import { readDiagnostics, writeDiagnostic } from '../../src/diagnostics/diagnostic-store';

vi.mock('../../src/diagnostics/diagnostic-store', () => ({ writeDiagnostic: vi.fn(async () => {}), readDiagnostics: vi.fn(async () => []) }));
beforeEach(async () => { await diagnosticEvents(); vi.clearAllMocks(); setDebugUntil(0); vi.useRealTimers(); });

it('removes credential canaries in nested objects, text, headers and every RPC URL scheme', () => {
  const canaries = ['pw-canary', 'key-canary', 'auth-canary', 'url-canary', 'socket-canary', 'signed-canary'];
  const output = JSON.stringify(sanitizeDiagnostic({
    password: canaries[0], nested: { apiKey: canaries[1] }, headers: { Authorization: canaries[2] },
    message: `failed http://user:pw@rpc.test/path/${canaries[3]}?secret=x and wss://rpc.test/${canaries[4]} Bearer auth-canary password=pw-canary`,
    signedTransaction: canaries[5], error: new Error('https://rpc.test/key-canary ws://rpc.test/socket-canary'),
  }));
  canaries.forEach(canary => expect(output).not.toContain(canary));
  expect(output).toContain('[RPC]');
  expect(sanitizeDiagnostic('secretKey=[1,2,3] key=CANARY credential=CANARY')).toBe('secretKey=[REDACTED] key=[REDACTED] credential=[REDACTED]');
});

it('preserves public transaction identities, bounds data and avoids getters and cycles', () => {
  const value = { signature: 'public-signature', mint: 'public-mint', publicKey: 'public-key', message: 'x'.repeat(5000) + '\u0000' };
  const result = sanitizeDiagnostic(value) as Record<string, unknown>;
  expect(result.signature).toBe(value.signature);
  expect(result.mint).toBe(value.mint);
  expect(result.publicKey).toBe(value.publicKey);
  expect(sanitizeDiagnostic('publicKey=public-key signature=public-signature mint=public-mint')).toBe('publicKey=public-key signature=public-signature mint=public-mint');
  expect((result.message as string).length).toBe(1024);
  expect(sanitizeDiagnostic('abc\u0000\u001bdef')).toBe('abc  def');
  const getter = vi.fn(() => { throw Error('must not run'); });
  const object: Record<string, unknown> = {};
  Object.defineProperty(object, 'message', { get: getter, enumerable: true });
  object.self = object;
  expect(JSON.stringify(sanitizeDiagnostic(object))).toContain('[CIRCULAR]');
  expect(getter).not.toHaveBeenCalled();
  expect((sanitizeDiagnostic(Array.from({ length: 100 }, () => 'x')) as unknown[]).length).toBe(20);
});

it('persists only sanitized whitelisted details and never logs price ticks', async () => {
  logEvent({ type: 'order.failed', level: 'error', component: 'worker', signature: 'public-signature', details: { message: 'token=CANARY', wallet: 'public-wallet', rawPayload: 'CANARY', password: 'CANARY' } });
  logEvent({ type: 'price.tick', level: 'info', component: 'price' });
  await diagnosticEvents();
  expect(writeDiagnostic).toHaveBeenCalledTimes(1);
  const event = vi.mocked(writeDiagnostic).mock.calls[0]![0];
  expect(JSON.stringify(event)).not.toContain('CANARY');
  expect(event.details).toEqual({ message: 'token=[REDACTED]', wallet: 'public-wallet' });
});

it('caps debug to one hour and expires it automatically', async () => {
  vi.useFakeTimers();
  const now = Date.now();
  setDebugUntil(now + 100 * DIAGNOSTIC_DEBUG_MAX_MS);
  logEvent({ type: 'probe', level: 'debug', component: 'test' });
  await diagnosticEvents();
  vi.setSystemTime(now + DIAGNOSTIC_DEBUG_MAX_MS);
  logEvent({ type: 'probe', level: 'debug', component: 'test' });
  await diagnosticEvents();
  expect(writeDiagnostic).toHaveBeenCalledTimes(1);
});

it('cannot throw storage failures into trading and returns sanitized JSON exports', async () => {
  vi.mocked(writeDiagnostic).mockRejectedValueOnce(new Error('quota'));
  expect(() => logEvent({ type: 'failure', level: 'error', component: 'worker' })).not.toThrow();
  vi.mocked(readDiagnostics).mockResolvedValueOnce([{ type: 'failure', at: Date.now(), level: 'error', component: 'worker', version: 'test', details: { message: 'password=CANARY' } }]);
  const exported = await exportDiagnostics();
  expect(exported).not.toContain('CANARY');
  expect(JSON.parse(exported).schemaVersion).toBe(1);
});
