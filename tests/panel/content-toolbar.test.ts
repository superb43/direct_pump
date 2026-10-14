import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE_CONTEXTS, TEST_MINT } from '../fixtures/site-contexts';
import type { PageTarget } from '../../src/model';
import { overlayCommand } from '../../src/chart/chart-overlay-contract';

const mocks = vi.hoisted(() => ({ listener: undefined as unknown, send: vi.fn(), hints: vi.fn(), price: undefined as string | undefined }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { id: 'test-extension', getURL: (path: string) => `chrome-extension://test-extension${path}`, sendMessage: mocks.send, onMessage: { addListener: (fn: unknown) => { mocks.listener = fn; }, removeListener: vi.fn() } } } }));
// Transport tests mock the DOM boundary. Real scoped readers have their own contracts.
vi.mock('../../src/adapters', () => ({ readPageHints: mocks.hints }));
const sender = { id: 'test-extension', url: 'chrome-extension://test-extension/sidepanel.html' };
const listen = (message: unknown, reply = vi.fn(), from = sender) => (mocks.listener as (m: unknown, s: unknown, r: unknown) => unknown)(message, from, reply);
async function start(interval = vi.fn()) {
  const script = await import('../../entrypoints/content');
  script.default.main({ setInterval: interval, onInvalidated: vi.fn() } as never);
}
beforeEach(() => {
  vi.stubGlobal('location', { href: SITE_CONTEXTS[0]!.target.pageUrl });
  vi.stubGlobal('document', { documentElement: {} });
  vi.stubGlobal('defineContentScript', (config: unknown) => config);
  mocks.price = undefined; mocks.send.mockReset().mockResolvedValue({ ok: true });
  mocks.hints.mockReset().mockImplementation((_document: Document, target: PageTarget) => ({
    mintHint: target.kind === 'POOL' ? TEST_MINT : undefined,
    market: mocks.price ? { mint: TEST_MINT, priceUsd: mocks.price, observedAt: Date.now(), source: SITE_CONTEXTS.find(row => row.site === target.site)!.source } : undefined,
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe.each(SITE_CONTEXTS)('$site panel relay contract', ({ target }) => {
  it('relays minimal chart display only from the native panel and clears drift', async () => {
    vi.stubGlobal('location', { href: target.pageUrl, origin: new URL(target.pageUrl).origin });
    const post = vi.fn(); vi.stubGlobal('window', { postMessage: post }); await start();
    const reply = vi.fn(); listen({ type: 'PANEL_CONTEXT' }, reply);
    const current = reply.mock.calls[0]![0].target;
    const command = overlayCommand(current, { mint: TEST_MINT, wallet: 'private-wallet', priceUsd: '1', marketCapUsd: '1000', supplyRaw: '1000', decimals: 0, balanceRaw: '10', updatedAt: Date.now() });
    const message = { type: 'PANEL_CHART_ENTRY', command };
    listen(message, reply, { ...sender, url: target.pageUrl }); expect(post).not.toHaveBeenCalled();
    listen(message, reply); expect(post).toHaveBeenLastCalledWith(command, new URL(target.pageUrl).origin);
    expect(JSON.stringify(post.mock.calls)).not.toContain('private-wallet'); expect(mocks.send).not.toHaveBeenCalled();
    listen({ ...message, command: { ...command, key: 'stale-target' } }, reply);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ entry: null }), new URL(target.pageUrl).origin);
  });
  it('relays buy and sell through the same bound context and rejects stale pages', async () => {
    vi.stubGlobal('location', { href: target.pageUrl }); await start();
    const reply = vi.fn(); listen({ type: 'PANEL_CONTEXT' }, reply);
    const current = reply.mock.calls[0]![0].target;
    expect(current).toMatchObject(target);
    for (const intent of [{ side: 'BUY', sol: '0.1' }, { side: 'SELL', percent: 50 }]) {
      const request = { type: 'TRADE', target: current, wallet: 'wallet', intent };
      expect(listen({ type: 'PANEL_REQUEST', request }, reply)).toBe(true);
      await Promise.resolve(); expect(mocks.send).toHaveBeenLastCalledWith(request);
    }
    mocks.send.mockClear(); vi.stubGlobal('location', { href: 'https://unsupported.test/' });
    listen({ type: 'PANEL_REQUEST', request: { type: 'TRADE', target: current, wallet: 'wallet', intent: { side: 'BUY', sol: '0.1' } } }, reply);
    expect(mocks.send).not.toHaveBeenCalled(); expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false }));
  });
  it('rejects page/foreign senders and private settings/history on every site', async () => {
    vi.stubGlobal('location', { href: target.pageUrl }); await start(); const reply = vi.fn();
    for (const from of [{ ...sender, id: 'foreign' }, { ...sender, url: target.pageUrl }, { ...sender, url: 'chrome-extension://test-extension/popup.html' }]) listen({ type: 'PANEL_CONTEXT' }, reply, from);
    expect(reply).not.toHaveBeenCalled();
    for (const type of ['HISTORY','SETTINGS_GET','RPC_TEST','MARKET_UPDATE']) listen({ type: 'PANEL_REQUEST', request: { type } }, reply);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('shares unchanged context reads without repeatedly scanning the DOM', async () => {
    vi.stubGlobal('location', { href: target.pageUrl }); await start();
    for (let i = 0; i < 5; i++) listen({ type: 'PANEL_CONTEXT' });
    expect(mocks.hints).toHaveBeenCalledOnce();
  });
});

it('pushes throttled changes and explicit disappeared-mark invalidation', async () => {
  vi.useFakeTimers(); let notify = () => {};
  vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { notify = callback; } observe() {} disconnect() {} });
  mocks.price = '0.015'; await start();
  notify(); notify(); await vi.advanceTimersByTimeAsync(100);
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(mocks.send).toHaveBeenLastCalledWith(expect.objectContaining({ market: expect.objectContaining({ mint: TEST_MINT, priceUsd: '0.015' }) }));
  notify(); await vi.advanceTimersByTimeAsync(100); expect(mocks.send).toHaveBeenCalledOnce();
  mocks.price = undefined; notify(); await vi.advanceTimersByTimeAsync(100);
  expect(mocks.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'MARKET_UPDATE', market: undefined }));
});
it('refreshes unchanged-price freshness while keeping URL ticks lightweight', async () => {
  vi.useFakeTimers(); mocks.price = '1'; let tick = () => {};
  await start(vi.fn((callback: () => void) => { tick = callback; }));
  tick(); const first = mocks.send.mock.calls[0]![0].market.observedAt;
  for (let i = 0; i < 10; i++) { await vi.advanceTimersByTimeAsync(500); tick(); }
  expect(mocks.hints).toHaveBeenCalledTimes(2);
  expect(mocks.send.mock.calls.at(-1)![0].market.observedAt).toBeGreaterThan(first);
  vi.stubGlobal('location', { href: 'https://unsupported.test/' });
  tick(); const reply = vi.fn(); listen({ type: 'PANEL_CONTEXT' }, reply);
  expect(reply).toHaveBeenCalledWith({ target: null, market: undefined });
});
