import {afterEach,expect,it,vi} from 'vitest';
const transport=vi.hoisted(()=>({settings:{enabled:true,serverUrl:'https://personal.example',serverId:'s',deviceId:'d',chromeNotifications:false},fetch:vi.fn(),save:vi.fn()}));
vi.mock('wxt/browser',()=>({browser:{}}));
vi.mock('../src/pro/client',()=>({loadProSettings:async()=>({...transport.settings}),saveProSettings:async(value:typeof transport.settings)=>{transport.save(value);transport.settings=value;},proFetch:transport.fetch,pair:vi.fn(),streamProEvents:vi.fn()}));
import {createProWorker} from '../src/pro/worker';
const path='/v1/chart-entry?mint=So11111111111111111111111111111111111111112';
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();transport.settings.enabled=true;transport.settings.serverId='s';});
it('never lets an unresolved optional chart read delay cancel or disable and returns a bounded timeout',async()=>{
 vi.useFakeTimers();transport.fetch.mockImplementation(async(_method:string,url:string)=>url===path?new Promise(()=>{}):{});
 const worker=createProWorker(),chart=worker.handle({type:'PRO',action:'REQUEST',path});
 expect(await worker.handle({type:'PRO',action:'REQUEST',method:'POST',path:'/v1/orders/12345678-1234-4123-8123-123456789abc/cancel'})).toMatchObject({ok:true});
 expect(await worker.handle({type:'PRO',action:'DISABLE'})).toMatchObject({ok:true});expect(transport.settings.enabled).toBe(false);
 await vi.advanceTimersByTimeAsync(8000);expect(await chart).toMatchObject({ok:false,error:'Chart entry read timed out.'});
});
it('rejects a chart response after the captured paired session changes',async()=>{
 let resolve:(value:unknown)=>void=()=>{};transport.fetch.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const chart=createProWorker().handle({type:'PRO',action:'REQUEST',path});
 await vi.waitFor(()=>expect(transport.fetch).toHaveBeenCalled());transport.settings.serverId='other';resolve({priceUsd:'1'});
 expect(await chart).toMatchObject({ok:false,error:'Pro session changed during chart entry read.'});
});
