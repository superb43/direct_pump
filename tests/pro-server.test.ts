import { it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { createProServer } from '../server/api';
import type { ProEngine } from '../server/engine';
it('serves a latest activity snapshot beyond 500 events while preserving cursor replay',async()=>{
  const {ProStore}=await import('../server/store'),store=new ProStore(':memory:');
  const server=createProServer({store} as ProEngine,{pair:async()=>({deviceId:'d',serverId:'s'}),verify:async()=> 'd'},'s');
  const invoke=(url:string)=>new Promise<{ok:boolean;data?:import('../src/pro/contracts').ProEvent[]}>(resolve=>{
    const req=Object.assign(Readable.from([]),{method:'GET',url,headers:{}}),res={statusCode:200,setHeader(){},end(body:string){resolve(JSON.parse(body));}};server.emit('request',req,res);
  });
  try{
    for(let i=0;i<501;i++)store.event('TEST',`event ${i+1}`);
    const latest=await invoke('/v1/events?latest=30');expect(latest.ok).toBe(true);expect(latest.data?.map(event=>event.sequence)).toEqual(Array.from({length:30},(_,i)=>472+i));
    expect((await invoke('/v1/events?after=499')).data?.map(event=>event.sequence)).toEqual([500,501]);
    expect((await invoke('/v1/events?latest=501')).ok).toBe(false);
  }finally{store.close();}
});
it('returns frozen API envelopes and requires device auth for private endpoints', async () => {
    const auth = { pair: async () => ({ deviceId: 'device', serverId: 'server' }), verify: async () => { throw new Error('Unauthorized.'); } };
    const server = createProServer({} as ProEngine, auth, 'server');
    const invoke = (url: string) => new Promise<{
        status: number;
        body: unknown;
    }>(resolve => { const req = Object.assign(Readable.from([]), { method: 'GET', url, headers: {} }); const res = { statusCode: 200, setHeader() { }, end(body: string) { resolve({ status: res.statusCode, body: JSON.parse(body) }); } }; server.emit('request', req, res); });
    expect(await invoke('/v1/info')).toEqual({ status: 200, body: { ok: true, data: { serverId: 'server', apiVersion: 1 } } });
    expect(await invoke('/v1/orders')).toEqual({ status: 400, body: { ok: false, error: 'Unauthorized.' } });
});
it('authenticates debug activation, clamps duration and returns sanitized diagnostics separately from audit', async () => { const { ProStore } = await import('../server/store'); const store = new ProStore(':memory:'); const auth = { pair: async () => ({ deviceId: 'd', serverId: 's' }), verify: async () => 'd' }; const server = createProServer({ store } as ProEngine, auth, 's'); const invoke = (url: string, method = 'GET', body = '') => new Promise<{
    status: number;
    body: any;
}>(resolve => { const req = Object.assign(Readable.from(body ? [body] : []), { method, url, headers: { 'x-dp-nonce': 'public-request-nonce' } }); const res = { statusCode: 200, setHeader() { }, end(value: string) { resolve({ status: res.statusCode, body: JSON.parse(value) }); } }; server.emit('request', req, res); }); try {
    expect((await invoke('/v1/diagnostics/debug', 'POST', '{"minutes":61}')).body.ok).toBe(false);
    expect((await invoke('/v1/diagnostics/debug', 'POST', '{"minutes":60}')).body.ok).toBe(true);
    store.diagnostics.log({ component: 'api', type: 'debug.visible', level: 'debug', details: { password: 'never-show' } });
    const rows = (await invoke('/v1/diagnostics')).body.data;
    expect(rows.some((row: any) => row.type === 'debug.visible')).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('never-show');
    expect((await invoke('/v1/diagnostics?export=1')).body.data).toHaveProperty('events');
}
finally {
    store.close();
} });
it('gates strategy specs by signer capability across all MC collections and includes legacy list entries',async()=>{
  const {ProStore}=await import('../server/store');const store=new ProStore(':memory:');let capabilities=['mc-orders-v2'];
  const engine={store,wallet:"wallet",preview:async(spec:unknown)=>({spec}),create:async(_id:string,spec:unknown)=>({spec})} as unknown as ProEngine;
  const server=createProServer(engine,{pair:async()=>({deviceId:'d',serverId:'s'}),verify:async()=> 'd',capabilities:async()=>capabilities},'s');
  const invoke=(url:string,method='GET',body?:unknown)=>new Promise<{status:number;body:any}>(resolve=>{const req=Object.assign(Readable.from(body?[JSON.stringify(body)]:[]),{method,url,headers:{}});const res={statusCode:200,setHeader(){},end(value:string){resolve({status:res.statusCode,body:JSON.parse(value)});}};server.emit('request',req,res);});
  try{
    expect((await invoke('/v2/orders','POST',{spec:{kind:'MARKET'}})).body.error).toContain('wallet changed');
    expect((await invoke('/v2/orders','POST',{expectedWallet:'other-wallet',spec:{kind:'MARKET'}})).body.error).toContain('wallet changed');
    expect((await invoke('/v2/orders','POST',{expectedWallet:'wallet',spec:{kind:'STRATEGY'}})).body.error).toContain('capabilities');
    expect((await invoke('/v2/preview','POST',{expectedWallet:'wallet',spec:{kind:'LIMIT',exitStrategy:{}}})).body.error).toContain('capabilities');
    capabilities=['mc-orders-v2','exit-strategies-v2'];expect((await invoke('/v2/orders')).body.data).toEqual([]);
    expect((await invoke('/v1/info')).body.data.capabilities).toEqual(capabilities);
  }finally{store.close();}
});
