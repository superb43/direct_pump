import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '@solana/web3.js';
import { createPriceRpc } from '../src/worker/price-rpc';

const endpoint = 'https://rpc.example.test';
const rpc = (connection: Connection, method: string, params: unknown[]) =>
  (connection as unknown as { _rpcRequest(method: string, params: unknown[]): Promise<{ id: string; result: unknown }> })._rpcRequest(method, params);
function response(body: string) {
  const request = JSON.parse(body);
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { context: { slot: 100 }, value: null } }));
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('shared price RPC transport', () => {
  it('preserves strict slot requirements and shares identical reads while restoring each response id', async () => {
    const fetcher = vi.fn(async (_url: unknown, options: RequestInit) => response(String(options.body)));
    vi.stubGlobal('fetch', fetcher);
    const transport = createPriceRpc();
    const results = await Promise.all(Array.from({ length: 20 }, () => rpc(transport.connection(endpoint, 90), 'getAccountInfo', ['mint', { minContextSlot: 95, encoding: 'base64' }])));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new Set(results.map(result => result.id)).size).toBe(20);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1].body)).params[1]).toEqual({ minContextSlot: 95, encoding: 'base64', commitment: 'confirmed' });
    await rpc(transport.connection(endpoint, 96), 'getAccountInfo', ['mint', { minContextSlot: 95, encoding: 'base64' }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('isolates caller cancellation and aborts the underlying fetch only when every caller cancels', async () => {
    let complete!: () => void;
    let sharedSignal!: AbortSignal;
    const fetcher = vi.fn((_url: unknown, options: RequestInit) => {
      sharedSignal = options.signal!;
      return new Promise<Response>((resolve, reject) => {
        complete = () => resolve(response(String(options.body)));
        sharedSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const transport = createPriceRpc();
    const first = new AbortController(), second = new AbortController();
    const cancelled = rpc(transport.connection(endpoint, 0, first.signal), 'getAccountInfo', ['mint']);
    const surviving = rpc(transport.connection(endpoint, 0, second.signal), 'getAccountInfo', ['mint']);
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await tick();
    first.abort();
    await rejected;
    expect(sharedSignal.aborted).toBe(false);
    complete();
    await surviving;
    expect(fetcher).toHaveBeenCalledTimes(1);

    const third = new AbortController(), fourth = new AbortController();
    const a = rpc(transport.connection(endpoint, 0, third.signal), 'getAccountInfo', ['other']);
    const b = rpc(transport.connection(endpoint, 0, fourth.signal), 'getAccountInfo', ['other']);
    const failures = Promise.all([expect(a).rejects.toMatchObject({ name: 'AbortError' }), expect(b).rejects.toMatchObject({ name: 'AbortError' })]);
    await tick();
    third.abort(); fourth.abort();
    await failures;
    expect(sharedSignal.aborted).toBe(true);
  });

  it('applies endpoint-wide Retry-After cooldown without additional HTTP retries', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '2' } }));
    vi.stubGlobal('fetch', fetcher);
    const transport = createPriceRpc();
    const retryAt = Date.now() + 2_000;
    await expect(rpc(transport.connection(endpoint), 'getAccountInfo', ['mint'])).rejects.toMatchObject({ status: 429, retryAt });
    expect(transport.cooldown(endpoint)).toBe(retryAt);
    await expect(rpc(transport.connection(endpoint), 'getAccountInfo', ['other'])).rejects.toMatchObject({ status: 429, retryAt });
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_001);
    await expect(rpc(transport.connection(endpoint), 'getAccountInfo', ['other'])).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('caps concurrent HTTP requests at four and releases a cancelled queued request', async () => {
    const completions: Array<() => void> = [];
    let running = 0, peak = 0;
    const fetcher = vi.fn((_url: unknown, options: RequestInit) => new Promise<Response>(resolve => {
      running++; peak = Math.max(peak, running);
      completions.push(() => { running--; resolve(response(String(options.body))); });
    }));
    vi.stubGlobal('fetch', fetcher);
    const transport = createPriceRpc();
    const queued = new AbortController();
    const jobs = Array.from({ length: 8 }, (_, i) => rpc(transport.connection(endpoint, 0, i === 4 ? queued.signal : undefined), 'getAccountInfo', [String(i)]));
    const cancelled = expect(jobs[4]).rejects.toMatchObject({ name: 'AbortError' });
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(4);
    queued.abort(); await cancelled;
    for (let i = 0; i < 7; i++) { completions[i]!(); await tick(); }
    await Promise.all(jobs.filter((_, i) => i !== 4));
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(peak).toBe(4);
  });

  it('aborts HTTP work at eight seconds and releases its concurrency slot', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: unknown, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetcher);
    const transport = createPriceRpc();
    const request = rpc(transport.connection(endpoint), 'getAccountInfo', ['mint']);
    const failure = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await tick();
    await vi.advanceTimersByTimeAsync(8_000);
    await failure;
    fetcher.mockImplementation(async (_url, options) => response(String(options.body)));
    await rpc(transport.connection(endpoint), 'getAccountInfo', ['mint']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('bounds completed reuse to 200 entries', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_url: unknown, options: RequestInit) => response(String(options.body)));
    vi.stubGlobal('fetch', fetcher);
    const connection = createPriceRpc().connection(endpoint);
    for (let i = 0; i < 201; i++) await rpc(connection, 'getAccountInfo', [String(i)]);
    await rpc(connection, 'getAccountInfo', ['200']);
    expect(fetcher).toHaveBeenCalledTimes(201);
    await rpc(connection, 'getAccountInfo', ['0']);
    expect(fetcher).toHaveBeenCalledTimes(202);
  });

  it('invalidates completed reads, expires reuse and never shares writes', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_url: unknown, options: RequestInit) => response(String(options.body)));
    vi.stubGlobal('fetch', fetcher);
    const transport = createPriceRpc();
    const connection = transport.connection(endpoint);
    await rpc(connection, 'getAccountInfo', ['mint']);
    await rpc(connection, 'getAccountInfo', ['mint']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    transport.invalidate(endpoint, ['mint']);
    await rpc(connection, 'getAccountInfo', ['mint']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(201);
    await rpc(connection, 'getAccountInfo', ['mint']);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await Promise.all([rpc(connection, 'sendTransaction', ['tx']), rpc(connection, 'sendTransaction', ['tx'])]);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
});
