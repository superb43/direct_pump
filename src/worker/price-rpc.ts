import { Connection,PublicKey, type ConnectionConfig } from '@solana/web3.js';

const READ_METHODS = new Set([
  'getAccountInfo', 'getMultipleAccounts', 'getProgramAccounts', 'getBalance',
  'getTokenAccountBalance', 'getTokenAccountsByOwner', 'getTokenSupply',
  'getSlot', 'getLatestBlockhash', 'getMinimumBalanceForRentExemption',
]);
const SLOT_METHODS = new Set(['getAccountInfo', 'getMultipleAccounts', 'getProgramAccounts']);
type Payload = { id?: unknown; error?: unknown; [key: string]: unknown };
type Job = { controller: AbortController; promise: Promise<Payload>; users: number };
type Cached = { endpoint: string; expires: number; payload: Payload };
type AccountRead={slot:number;floor:number;at:number;version:number;value:unknown};
type Input={id:unknown;method:string;params?:unknown[]};
type AccountTask={input:Input;keys:string[];controller:AbortController;resolve:(value:Payload)=>void;reject:(error:unknown)=>void};
const observations=new WeakMap<Connection,{at?:number;slots:Map<number,number>}>();
/** Cached reads keep their actual observation time; callers never renew balance leases on reuse. */
export function priceRpcReadAt(rpc:Connection,slot?:number):number|undefined{
 const read=observations.get(rpc);return slot===undefined?read?.at:read?.slots.get(slot);
}
const aborted = () => new DOMException('Price request cancelled', 'AbortError');

/** Worker-local, read-only quote transport. Trade connections must remain separate. */
export function createPriceRpc() {
  const pending = new Map<string, Job>();
  const cache = new Map<string, Cached>();
  const cooldowns = new Map<string, number>();
  const accounts=new Map<string,AccountRead>(),accountGroups=new Map<string,{endpoint:string;config:Record<string,unknown>;tasks:AccountTask[]}>();
  const payloadTimes=new WeakMap<Payload,number>();
  let observationVersion=0;
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
    for(const [key,entry]of accounts)if(Date.now()-entry.at>200)accounts.delete(key);
    while(accounts.size>200)accounts.delete(accounts.keys().next().value!);
  }

  function accountKey(endpoint:string,address:string,config:Record<string,unknown>){
    const {minContextSlot:_floor,...format}=config;return JSON.stringify([endpoint,address,format]);
  }
  function cachedAccount(endpoint:string,address:string,config:Record<string,unknown>){
    const row=accounts.get(accountKey(endpoint,address,config)),floor=Number(config.minContextSlot)||0;
    return row&&Date.now()>=row.at&&Date.now()-row.at<=200&&row.slot>=floor&&row.floor>=floor?row:undefined;
  }
  function accountPayload(input:Input,rows:AccountRead[]):Payload{
    const payload={jsonrpc:'2.0',id:input.id,result:{context:{slot:Math.min(...rows.map(row=>row.slot))},value:input.method==='getAccountInfo'?rows[0]!.value:rows.map(row=>row.value)}};
    payloadTimes.set(payload,Math.min(...rows.map(row=>row.at)));return payload;
  }
  async function flushAccounts(group:{endpoint:string;config:Record<string,unknown>;tasks:AccountTask[]}){
    const {endpoint,config}=group,tasks=group.tasks.filter(task=>!task.controller.signal.aborted),floor=Number(config.minContextSlot)||0;
    if(!tasks.length)return;
    const values=new Map<string,AccountRead>(),needed=new Set<string>();
    for(const task of tasks)for(const address of task.keys){const row=cachedAccount(endpoint,address,config);if(row)values.set(address,row);else needed.add(address);}
    const abort=new AbortController(),cancel=()=>{if(tasks.every(task=>task.controller.signal.aborted))abort.abort();};
    for(const task of tasks)task.controller.signal.addEventListener('abort',cancel,{once:true});
    try{
      const limit=new URL(endpoint).hostname==='solana-rpc.publicnode.com'?10:100,keys=[...needed];
      for(let offset=0;offset<keys.length;offset+=limit){
        const chunk=keys.slice(offset,offset+limit),single=tasks.length===1&&tasks[0]!.input.method==='getAccountInfo'&&chunk.length===1;
        const input={...tasks[0]!.input,method:single?'getAccountInfo':'getMultipleAccounts',params:[single?chunk[0]:chunk,config]};
        const started=observationVersion,payload=await request(endpoint,JSON.stringify(input),abort);
        if(payload.error){for(const task of tasks)if(!task.controller.signal.aborted)task.resolve({...payload,id:task.input.id});return;}
        const result=payload.result as {context?:{slot?:number};value?:unknown},slot=result?.context?.slot;
        const data=single?[result?.value]:result?.value;
        if(!Number.isSafeInteger(slot)||slot!<floor||!Array.isArray(data)||data.length!==chunk.length)throw new Error('Price RPC returned incomplete or stale account data.');
        const at=Date.now();
        chunk.forEach((address,index)=>{
          const key=accountKey(endpoint,address,config),previous=accounts.get(key),row={slot:slot!,floor,at,version:++observationVersion,value:data[index]};
          // A request that started earlier cannot replace a later observation at the same/newer slot.
          if(previous&&(previous.slot>slot!||previous.slot===slot&&previous.version>started)){
            values.set(address,cachedAccount(endpoint,address,config)??row);
          }else{values.set(address,row);accounts.set(key,row);}
        });
      }
      prune();
      for(const task of tasks)if(!task.controller.signal.aborted)task.resolve(accountPayload(task.input,task.keys.map(address=>values.get(address)!)));
    }catch(error){for(const task of tasks)if(!task.controller.signal.aborted)task.reject(error);}
    finally{for(const task of tasks)task.controller.signal.removeEventListener('abort',cancel);}
  }
  function readAccounts(endpoint:string,input:Input,controller:AbortController):Promise<Payload>{
    const keys=(input.method==='getAccountInfo'?[input.params?.[0]]:input.params?.[0]) as string[],config=input.params?.[1] as Record<string,unknown>;
    if(!Array.isArray(keys)||!keys.length)return request(endpoint,JSON.stringify(input),controller);
    const rows=keys.map(address=>cachedAccount(endpoint,address,config));
    if(rows.every((row):row is AccountRead=>!!row))return Promise.resolve(accountPayload(input,rows));
    return new Promise((resolve,reject)=>{
      const cancelled=()=>reject(aborted());controller.signal.addEventListener('abort',cancelled,{once:true});
      const task:AccountTask={input,keys,controller,resolve:value=>{controller.signal.removeEventListener('abort',cancelled);resolve(value);},reject:error=>{controller.signal.removeEventListener('abort',cancelled);reject(error);}};
      const key=JSON.stringify([endpoint,config]);let group=accountGroups.get(key);
      if(!group){group={endpoint,config,tasks:[]};accountGroups.set(key,group);const owned=group;
        // One microtask coalesces compatible readers without a new polling delay.
        void Promise.resolve().then(()=>{accountGroups.delete(key);return flushAccounts(owned);});
      }
      group.tasks.push(task);
    });
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
    const observed:{at?:number;slots:Map<number,number>}={slots:new Map()};
    const transport = async (_url: unknown, options?: { body?: unknown }) => {
      if (signal?.aborted) throw aborted();
      const input = JSON.parse(String(options?.body)) as Input;
      const params = [...(input.params ?? [])];
      if (SLOT_METHODS.has(input.method)) {
        const config = (params[1] ?? {}) as Record<string, unknown>;
        params[1] = { ...config, commitment: 'confirmed', minContextSlot: Math.max(minSlot, Number(config.minContextSlot) || 0) };
      }
      const accountRead=input.method==='getAccountInfo'||input.method==='getMultipleAccounts';
      if(accountRead)params[1]={encoding:'base64',...(params[1] as Record<string,unknown>)};
      const key = JSON.stringify([endpoint, input.method, params]);
      const cacheable = READ_METHODS.has(input.method);
      prune();
      let payload = cacheable&&!accountRead ? cache.get(key)?.payload : undefined;
      if (!payload) {
        let job = cacheable ? pending.get(key) : undefined;
        if (job?.controller.signal.aborted) job = undefined;
        if (!job) {
          if(!accountRead)rateLimit(endpoint);
          const controller = new AbortController();
          job = { controller, users: 0, promise: accountRead?readAccounts(endpoint,{...input,params},controller):request(endpoint, JSON.stringify({ ...input, params }), controller) };
          const owned = job;
          job.promise = job.promise.then(result => {
            if (cacheable&&!accountRead && !controller.signal.aborted && !result.error) {
              cache.set(key, { endpoint, payload: result, expires: Date.now() + 200 });
              prune();
            }
            return result;
          }).finally(() => { if (pending.get(key) === owned) pending.delete(key); });
          if (cacheable) pending.set(key, job);
        }
        payload = await join(job, signal);
      }
      const at=payloadTimes.get(payload),slot=(payload.result as {context?:{slot?:number}})?.context?.slot;
      if(at!==undefined&&Number.isSafeInteger(slot)){
        observed.at=Math.min(observed.at??at,at);observed.slots.set(slot!,Math.min(observed.slots.get(slot!)??at,at));
      }
      return new Response(JSON.stringify({ ...payload, id: input.id }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    };
    const rpc=new Connection(endpoint, {
      commitment: 'confirmed', disableRetryOnRateLimit: true,
      fetch: transport as ConnectionConfig['fetch'],
    });
    observations.set(rpc,observed);return rpc;
  }

  function invalidate(endpoint: string, addresses?: string[]) {
    for(const key of accounts.keys()){const [owner,address]=JSON.parse(key) as string[];if(owner===endpoint&&(!addresses||addresses.includes(address!)))accounts.delete(key);}
    // Non-account cache entries have no account binding and remain conservatively invalidated.
    for (const [key, entry] of cache) if (entry.endpoint === endpoint) cache.delete(key);
  }
  function observe(endpoint:string,wsEndpoint:string,address:string,slot:number,value:unknown):boolean{
    const http=new URL(endpoint),ws=new URL(wsEndpoint);
    if(http.protocol!=='https:'||ws.protocol!=='wss:'||http.host!==ws.host||http.pathname!==ws.pathname||http.search!==ws.search||!Number.isSafeInteger(slot)||slot<0)return false;
    try{new PublicKey(address);
      if(value!==null){const row=value as {owner:string;lamports:number;executable:boolean;data:unknown[];rentEpoch:number};new PublicKey(row.owner);
        if(!Number.isSafeInteger(row.lamports)||row.lamports<0||typeof row.executable!=='boolean'||!Array.isArray(row.data)||row.data.length!==2||row.data[1]!=='base64'||typeof row.data[0]!=='string'||row.data[0].length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(row.data[0])||!Number.isFinite(row.rentEpoch)||row.rentEpoch<0)return false;
      }
    }catch{return false;}
    const config={encoding:'base64',commitment:'confirmed'},key=accountKey(endpoint,address,config),old=accounts.get(key);
    if(old&&old.slot>slot)return false;
    accounts.set(key,{slot,floor:slot,at:Date.now(),version:++observationVersion,value});prune();return true;
  }
  return { connection, cooldown, invalidate,observe };
}
