import { afterEach, describe, expect, it, vi } from 'vitest';
import {PublicKey,type Connection} from '@solana/web3.js';
import { createPriceRpc,priceRpcReadAt } from '../../src/worker/price-rpc';

const endpoint = 'https://rpc.example.test';
const rpc = (connection: Connection, method: string, params: unknown[]) =>
  (connection as unknown as { _rpcRequest(method: string, params: unknown[]): Promise<{ id: string; result: unknown }> })._rpcRequest(method, params);
function response(body: string) {
  const request = JSON.parse(body);
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { context: { slot: 100 }, value: request.method==='getMultipleAccounts'?request.params[0].map(()=>null):null } }));
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('shared price RPC transport', () => {
  it.each([100,101])('keeps a later slot-%s websocket observation when an older HTTP request finishes',async slot=>{
    vi.useFakeTimers();vi.setSystemTime(1000);
    const address=PublicKey.default.toBase58(),value={owner:address,data:['AA==','base64'],lamports:2,executable:false,rentEpoch:0};
    let complete!:(response:Response)=>void,body='';
    const fetcher=vi.fn((_url:unknown,options:RequestInit)=>{body=String(options.body);return new Promise<Response>(resolve=>{complete=resolve;});});vi.stubGlobal('fetch',fetcher);
    const transport=createPriceRpc(),read=rpc(transport.connection(endpoint),'getAccountInfo',[address]);await tick();
    expect(transport.observe(endpoint,'wss://rpc.example.test',address,slot,value)).toBe(true);
    const input=JSON.parse(body);complete(new Response(JSON.stringify({jsonrpc:'2.0',id:input.id,result:{context:{slot:100},value:{...value,lamports:1}}})));
    const first=await read;expect((first.result as {value:unknown}).value).toEqual(value);
    vi.setSystemTime(1100);const next=transport.connection(endpoint),cached=await rpc(next,'getAccountInfo',[address]);
    expect((cached.result as {context:{slot:number};value:unknown}).context.slot).toBe(slot);expect((cached.result as {value:unknown}).value).toEqual(value);
    expect(fetcher).toHaveBeenCalledOnce();expect(priceRpcReadAt(next,slot)).toBe(1000);
  });
  it('reuses only a recent confirmed websocket observation from the matching endpoint',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000);
    const transport=createPriceRpc(),address=PublicKey.default.toBase58(),value={owner:address,data:['AA==','base64'],lamports:1,executable:false,rentEpoch:0};
    const fetcher=vi.fn(async(_url:unknown,options:RequestInit)=>response(String(options.body)));vi.stubGlobal('fetch',fetcher);
    expect(transport.observe(endpoint,'wss://different.test',address,100,value)).toBe(false);
    expect(transport.observe(endpoint,'wss://rpc.example.test',address,100,{...value,data:['garbage','base64']})).toBe(false);
    expect(transport.observe(endpoint,'wss://rpc.example.test',address,100,value)).toBe(true);
    vi.setSystemTime(1100);const shared=transport.connection(endpoint,100);const result=await rpc(shared,'getAccountInfo',[address]);
    expect((result.result as {value:unknown}).value).toEqual(value);expect(fetcher).not.toHaveBeenCalled();expect(priceRpcReadAt(shared,100)).toBe(1000);
    expect(transport.observe(endpoint,'wss://rpc.example.test',address,99,value)).toBe(false);
    await expect(rpc(transport.connection(endpoint,101),'getAccountInfo',[address])).rejects.toThrow('stale');expect(fetcher).toHaveBeenCalledOnce();
    vi.setSystemTime(1201);await rpc(transport.connection(endpoint),'getAccountInfo',[address]);expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('combines two warm Pump batches into ten distinct accounts and restores each result',async()=>{
    const fetcher=vi.fn(async(_url:unknown,options:RequestInit)=>response(String(options.body)));vi.stubGlobal('fetch',fetcher);
    const transport=createPriceRpc(),url='https://solana-rpc.publicnode.com';
    const reads=await Promise.all(['a','b'].map(token=>rpc(transport.connection(url,90),'getMultipleAccounts',[["global","fee",`pool-${token}`,`mint-${token}`,`base-${token}`,`quote-${token}`],{encoding:'base64'}])));
    expect(fetcher).toHaveBeenCalledOnce();const body=JSON.parse(String(fetcher.mock.calls[0]![1].body));
    expect(body.method).toBe('getMultipleAccounts');expect(body.params[0]).toHaveLength(10);expect(body.params[1].minContextSlot).toBe(90);
    expect(reads.map(read=>(read.result as {value:unknown[]}).value.length)).toEqual([6,6]);expect(reads[0]!.id).not.toBe(reads[1]!.id);
  });
  it('shares batch mint facts with singleton reads without renewing their observation time',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000);
    const fetcher=vi.fn(async(_url:unknown,options:RequestInit)=>response(String(options.body)));vi.stubGlobal('fetch',fetcher);
    const transport=createPriceRpc();await rpc(transport.connection(endpoint),'getMultipleAccounts',[['mint','pool']]);
    vi.setSystemTime(1100);const reused=transport.connection(endpoint);await rpc(reused,'getAccountInfo',['mint']);
    expect(fetcher).toHaveBeenCalledOnce();expect(priceRpcReadAt(reused,100)).toBe(1000);
    vi.setSystemTime(1201);const fresh=transport.connection(endpoint);await rpc(fresh,'getAccountInfo',['mint']);
    expect(fetcher).toHaveBeenCalledTimes(2);expect(priceRpcReadAt(fresh,100)).toBe(1201);
  });
  it('invalidates only the changed account while keeping unrelated account observations',async()=>{
    const fetcher=vi.fn(async(_url:unknown,options:RequestInit)=>response(String(options.body)));vi.stubGlobal('fetch',fetcher);
    const transport=createPriceRpc();await rpc(transport.connection(endpoint),'getMultipleAccounts',[['changed','unchanged']]);
    transport.invalidate(endpoint,['changed']);await rpc(transport.connection(endpoint),'getAccountInfo',['unchanged']);expect(fetcher).toHaveBeenCalledOnce();
    await rpc(transport.connection(endpoint),'getAccountInfo',['changed']);expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('splits a combined PublicNode read at ten accounts and never mixes endpoints or slot floors',async()=>{
    const fetcher=vi.fn(async(_url:unknown,options:RequestInit)=>response(String(options.body)));vi.stubGlobal('fetch',fetcher);
    const transport=createPriceRpc(),url='https://solana-rpc.publicnode.com';
    await Promise.all([rpc(transport.connection(url),'getMultipleAccounts',[Array.from({length:12},(_,i)=>String(i))]),rpc(transport.connection(endpoint,90),'getAccountInfo',['other']),rpc(transport.connection(endpoint,91),'getAccountInfo',['other'])]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.filter(([url])=>url==='https://solana-rpc.publicnode.com').map(([,options])=>JSON.parse(String(options.body)).params[0].length)).toEqual([10,2]);
  });
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
    const jobs = Array.from({ length: 8 }, (_, i) => rpc(transport.connection(endpoint, 0, i === 4 ? queued.signal : undefined), 'getBalance', [String(i)]));
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
