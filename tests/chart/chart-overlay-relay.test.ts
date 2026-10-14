import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SITE_CONTEXTS, TEST_MINT } from '../fixtures/site-contexts';
import type { ChartEntry } from '../../src/chart/chart-entry';
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { tabs: { sendMessage: mocks.send } } }));
import { createChartOverlayRelay } from '../../src/chart/chart-overlay-relay';
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const entry = (): ChartEntry => ({ mint: TEST_MINT, wallet: 'private-wallet', priceUsd: '.01'.replace(/^\./, '0.'), marketCapUsd: '10000000', balanceRaw: '100', supplyRaw: '1000000000000000', decimals: 6, updatedAt: Date.now() });
beforeEach(() => {
  vi.useFakeTimers(); mocks.send.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal('window', { setInterval, clearInterval });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each(SITE_CONTEXTS)('$site leases only display values to its tab and stops on teardown', async ({ target }) => {
  const relay = createChartOverlayRelay(27, target), value = entry();
  relay.updateEntry(); await flush(); expect(mocks.send).not.toHaveBeenCalled();
  relay.updateEntry(value); await flush();
  const [tab, message, frame] = mocks.send.mock.calls[0]!;
  expect(tab).toBe(27); expect(frame).toEqual({ frameId: 0 });
  expect(message.command.entry).toEqual({ mint: TEST_MINT, priceUsd: '0.01', marketCapUsd: '10000000' });
  expect(JSON.stringify(message)).not.toContain('private-wallet');
  relay.updateEntry({ ...value }); await flush(); expect(mocks.send).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(4000); expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(mocks.send.mock.calls[1]![1].command.expiresAt).toBeGreaterThan(message.command.expiresAt);
  relay.destroy(); await flush(); expect(mocks.send).toHaveBeenLastCalledWith(27, expect.objectContaining({ command: expect.objectContaining({ entry: null }) }), { frameId: 0 });
  const calls = mocks.send.mock.calls.length; await vi.advanceTimersByTimeAsync(16000); relay.updateEntry(value); expect(mocks.send).toHaveBeenCalledTimes(calls);
});
it('serializes a delayed update followed by clear and rejects stale source evidence', async () => {
  let resolve!: (value: unknown) => void;
  mocks.send.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const relay = createChartOverlayRelay(1, SITE_CONTEXTS[0]!.target);
  relay.updateEntry(entry()); relay.updateEntry(); expect(mocks.send).toHaveBeenCalledOnce();
  resolve({ ok: true }); await flush(); expect(mocks.send.mock.calls[1]![1].command.entry).toBeNull();
  relay.updateEntry({ ...entry(), updatedAt: Date.now() - 90001 }); await flush(); expect(mocks.send.mock.calls.at(-1)![1].command.entry).toBeNull();
  relay.destroy();
});
it('hint drift discards the old entry before accepting further heartbeats', async () => {
  const target = SITE_CONTEXTS[0]!.target, relay = createChartOverlayRelay(1, target);
  relay.updateEntry(entry()); await flush(); relay.updateTarget({ ...target, poolHint: 'new' }); await flush();
  expect(mocks.send.mock.calls.at(-1)![1].command.entry).toBeNull();
  const calls = mocks.send.mock.calls.length; await vi.advanceTimersByTimeAsync(8000); expect(mocks.send).toHaveBeenCalledTimes(calls); relay.destroy();
});
