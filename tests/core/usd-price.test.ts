import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const NOW = Date.parse('2026-10-12T00:00:00Z');
const spot = (amount = '150.12', headers?: HeadersInit) => new Response(JSON.stringify({
  data: { base: 'SOL', currency: 'USD', amount },
}), { headers });
const currentTime = () => Date.now() / 1000;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('shares one request for twenty current spot callers and preserves its observation timestamp', async () => {
  let resolve!: (response: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
  vi.stubGlobal('fetch', fetch);
  const { solUsdSnapshot, currentSolUsd, solUsdRetryAt } = await import('../../src/usd-price');
  const jobs = Array.from({ length: 20 }, () => solUsdSnapshot(currentTime()));
  expect(fetch).toHaveBeenCalledTimes(1);
  resolve(spot());
  const results = await Promise.all(jobs);
  expect(results.every(value => value === results[0])).toBe(true);
  expect(currentSolUsd()).toEqual({ priceMicros: '150120000', capturedAt: NOW, source: 'Coinbase spot' });
  vi.setSystemTime(NOW + 29_999);
  expect(await solUsdSnapshot(currentTime())).toBe(results[0]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(currentSolUsd()?.capturedAt).toBe(NOW);
  expect(solUsdRetryAt()).toBe(0);
});

it('recovers on shared exponential deadlines and resets the backoff after success', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('network down'));
  vi.stubGlobal('fetch', fetch);
  const { solUsdSnapshot, solUsdRetryAt } = await import('../../src/usd-price');
  for (const delay of [1000, 2000, 4000, 8000, 15000, 15000]) {
    const start = Date.now();
    await expect(solUsdSnapshot(currentTime())).resolves.toBeUndefined();
    expect(solUsdRetryAt()).toBe(start + delay);
    const count = fetch.mock.calls.length;
    vi.setSystemTime(start + delay - 1);
    await expect(solUsdSnapshot(currentTime())).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(count);
    vi.setSystemTime(start + delay);
  }
  fetch.mockResolvedValueOnce(spot());
  expect(await solUsdSnapshot(currentTime())).toBeDefined();
  expect(solUsdRetryAt()).toBe(0);
  vi.setSystemTime(Date.now() + 30_000);
  await solUsdSnapshot(currentTime());
  expect(solUsdRetryAt()).toBe(Date.now() + 1000);
});

it('expires the successful price and never refreshes it on a failed request', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(spot()).mockRejectedValue(new Error('down'));
  vi.stubGlobal('fetch', fetch);
  const { solUsdSnapshot, currentSolUsd } = await import('../../src/usd-price');
  const first = await solUsdSnapshot(currentTime());
  vi.setSystemTime(NOW + 30_000);
  expect(currentSolUsd()).toBeUndefined();
  expect(await solUsdSnapshot(currentTime())).toBeUndefined();
  expect(currentSolUsd()).toBeUndefined();
  expect(first?.capturedAt).toBe(NOW);
});

it.each(['60', new Date(NOW + 60_000).toUTCString()])('respects HTTP429 Retry-After %s as a retry floor', async header => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': header } })).mockResolvedValue(spot());
  vi.stubGlobal('fetch', fetch);
  const { solUsdSnapshot, solUsdRetryAt } = await import('../../src/usd-price');
  expect(await solUsdSnapshot(currentTime())).toBeUndefined();
  expect(solUsdRetryAt()).toBe(NOW + 60_000);
  vi.setSystemTime(NOW + 59_999);
  expect(await solUsdSnapshot(currentTime())).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(NOW + 60_000);
  expect(await solUsdSnapshot(currentTime())).toBeDefined();
});

it('bounds spot requests with a five-second abort signal', async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  })));
  const { solUsdSnapshot, solUsdRetryAt } = await import('../../src/usd-price');
  const job = solUsdSnapshot(currentTime());
  expect(timeout).toHaveBeenCalledWith(5000);
  vi.setSystemTime(NOW + 5000);
  controller.abort();
  expect(await job).toBeUndefined();
  expect(solUsdRetryAt()).toBe(NOW + 6000);
});

it.each([
  { data: { base: 'SOL', currency: 'USD', amount: '0' } },
  { data: { base: 'BTC', currency: 'USD', amount: '150' } },
  { data: { base: 'SOL', currency: 'EUR', amount: '150' } },
  { data: { base: 'SOL', currency: 'USD', amount: 'NaN' } },
])('rejects invalid quote fields $data', async body => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
  const { solUsdSnapshot, currentSolUsd } = await import('../../src/usd-price');
  expect(await solUsdSnapshot(currentTime())).toBeUndefined();
  expect(currentSolUsd()).toBeUndefined();
});

it.each(['invalid date', new Date(NOW - 121_000).toUTCString()])('rejects invalid or stale provider dates: %s', async date => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(spot('150', { date })));
  const { solUsdSnapshot } = await import('../../src/usd-price');
  expect(await solUsdSnapshot(currentTime())).toBeUndefined();
});

it('keeps historical candles and daily fallback separate from spot retry and cache', async () => {
  const blockTime = (NOW - 3_600_000) / 1000;
  const minute = Math.floor(blockTime / 60) * 60;
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify([[minute, 140, 160, 145, 155, 10]])))
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(spot('145'));
  vi.stubGlobal('fetch', fetch);
  const { solUsdSnapshot, currentSolUsd, solUsdRetryAt } = await import('../../src/usd-price');
  await solUsdSnapshot(currentTime());
  expect(solUsdRetryAt()).toBe(NOW + 1000);
  expect(await solUsdSnapshot(blockTime)).toEqual({ priceMicros: '155000000', capturedAt: (minute + 60) * 1000, source: 'Coinbase 1m candle' });
  expect(await solUsdSnapshot(blockTime)).toBeDefined();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await solUsdSnapshot(blockTime - 60)).toMatchObject({ priceMicros: '145000000', source: 'Coinbase daily estimate' });
  expect(String(fetch.mock.calls[3]![0])).toContain('?date=2026-10-11');
  expect(currentSolUsd()).toBeUndefined();
  expect(solUsdRetryAt()).toBe(NOW + 1000);
});
