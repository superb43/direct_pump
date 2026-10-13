import { Connection, type ConnectionConfig } from '@solana/web3.js';

const READ_METHODS = new Set([
  'getAccountInfo', 'getMultipleAccounts', 'getProgramAccounts', 'getBalance',
  'getTokenAccountBalance', 'getTokenAccountsByOwner', 'getTokenSupply',
  'getSlot', 'getLatestBlockhash', 'getMinimumBalanceForRentExemption',
]);
const SLOT_METHODS = new Set(['getAccountInfo', 'getMultipleAccounts', 'getProgramAccounts']);
type Payload = { id?: unknown; error?: unknown; [key: string]: unknown };
type Job = { controller: AbortController; promise: Promise<Payload>; users: number };
type Cached = { endpoint: string; expires: number; payload: Payload };
const aborted = () => new DOMException('Price request cancelled', 'AbortError');

/** Worker-local, read-only quote transport. Trade connections must remain separate. */
export function createPriceRpc() {
  const pending = new Map<string, Job>();
  const cache = new Map<string, Cached>();
  const cooldowns = new Map<string, number>();
  const queue: Array<() => void> = [];
  let active = 0;

  function acquire(signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const index = queue.indexOf(start);
        if (index >= 0) queue.splice(index, 1);
        reject(aborted());
      };
      const start = () => {
        signal.removeEventListener('abort', cancel);
        if (signal.aborted) { reject(aborted()); return; }
        active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          active--;
          queue.shift()?.();
        });
      };
      if (signal.aborted) { reject(aborted()); return; }
      signal.addEventListener('abort', cancel, { once: true });
      if (active < 4) start(); else queue.push(start);
    });
  }

  function cooldown(endpoint: string) {
    const until = cooldowns.get(endpoint) ?? 0;
    if (until <= Date.now()) { cooldowns.delete(endpoint); return 0; }
    return until;
  }
  function rateLimit(endpoint: string) {
    const retryAt = cooldown(endpoint);
    if (retryAt) throw Object.assign(new Error('Price RPC rate limited'), { status: 429, retryAt });
  }
  function prune() {
    for (const [key, entry] of cache) if (entry.expires <= Date.now()) cache.delete(key);
    while (cache.size > 200) cache.delete(cache.keys().next().value!);
  }

  async function request(endpoint: string, body: string, controller: AbortController): Promise<Payload> {
    const release = await acquire(controller.signal);
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      rateLimit(endpoint);
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        signal: controller.signal,
      });
      if (!response.ok) {
        let retryAt: number | undefined;
        if (response.status === 429) {
          const header = response.headers.get('Retry-After');
          const seconds = header === null ? NaN : Number(header);
          const date = header === null ? NaN : Date.parse(header);
          retryAt = Date.now() + 1_000;
          if (Number.isFinite(seconds)) retryAt = Date.now() + Math.max(0, seconds) * 1_000;
          else if (Number.isFinite(date)) retryAt = Math.max(Date.now(), date);
          cooldowns.set(endpoint, Math.max(cooldowns.get(endpoint) ?? 0, retryAt));
        }
        throw Object.assign(new Error(`Price RPC HTTP ${response.status}`), { status: response.status, retryAt });
      }
      return await response.json() as Payload;
    } finally { clearTimeout(timeout); release(); }
  }

  function join(job: Job, signal?: AbortSignal): Promise<Payload> {
    job.users++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener('abort', cancel);
        if (--job.users === 0) job.controller.abort();
        return true;
      };
      const cancel = () => { if (finish()) reject(aborted()); };
      if (signal?.aborted) { cancel(); return; }
      signal?.addEventListener('abort', cancel, { once: true });
      job.promise.then(value => { if (finish()) resolve(value); }, error => { if (finish()) reject(error); });
    });
  }

  function connection(endpoint: string, minSlot = 0, signal?: AbortSignal): Connection {
    const transport = async (_url: unknown, options?: { body?: unknown }) => {
      if (signal?.aborted) throw aborted();
      const input = JSON.parse(String(options?.body)) as { id: unknown; method: string; params?: unknown[] };
      const params = [...(input.params ?? [])];
      if (SLOT_METHODS.has(input.method)) {
        const config = (params[1] ?? {}) as Record<string, unknown>;
        params[1] = { ...config, commitment: 'confirmed', minContextSlot: Math.max(minSlot, Number(config.minContextSlot) || 0) };
      }
      const key = JSON.stringify([endpoint, input.method, params]);
      const cacheable = READ_METHODS.has(input.method);
      prune();
      let payload = cacheable ? cache.get(key)?.payload : undefined;
      if (!payload) {
        let job = cacheable ? pending.get(key) : undefined;
        if (job?.controller.signal.aborted) job = undefined;
        if (!job) {
          rateLimit(endpoint);
          const controller = new AbortController();
          job = { controller, users: 0, promise: request(endpoint, JSON.stringify({ ...input, params }), controller) };
          const owned = job;
          job.promise = job.promise.then(result => {
            if (cacheable && !controller.signal.aborted && !result.error) {
              cache.set(key, { endpoint, payload: result, expires: Date.now() + 200 });
              prune();
            }
            return result;
          }).finally(() => { if (pending.get(key) === owned) pending.delete(key); });
          if (cacheable) pending.set(key, job);
        }
        payload = await join(job, signal);
      }
      return new Response(JSON.stringify({ ...payload, id: input.id }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    };
    return new Connection(endpoint, {
      commitment: 'confirmed', disableRetryOnRateLimit: true,
      fetch: transport as ConnectionConfig['fetch'],
    });
  }

  function invalidate(endpoint: string, _addresses?: string[]) {
    // Conservatively invalidate completed reads only; pending reads retain ownership.
    for (const [key, entry] of cache) if (entry.endpoint === endpoint) cache.delete(key);
  }
  return { connection, cooldown, invalidate };
}
