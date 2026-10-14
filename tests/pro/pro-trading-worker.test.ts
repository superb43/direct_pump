import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({stored:{} as Record<string,unknown>,fetch:vi.fn(),settings:{enabled:true,serverUrl:'https://private.example',serverId:'server',deviceId:'device',chromeNotifications:false}}));
vi.mock('wxt/browser',()=>({browser:{storage:{local:{get:async()=>({...state.stored}),set:async(value:Record<string,unknown>)=>Object.assign(state.stored,value)}}}}));
vi.mock('../../src/pro/client',()=>({loadProSettings:async()=>({...state.settings}),proFetch:state.fetch,saveProSettings:async()=>{},pair:vi.fn(),streamProEvents:vi.fn()}));
import {createProWorker,allowedProRequest} from '../../src/pro/worker';
import {defaultPreferences} from '../../src/pro/trading-preferences';
afterEach(()=>{state.stored={};state.fetch.mockReset();state.settings.enabled=true;state.settings.serverId='server';vi.useRealTimers();});
it('defaults only absent preferences and stores a separate validated private key',async()=>{
 const worker=createProWorker(),defaults=defaultPreferences();
 expect(await worker.handle({type:'PRO',action:'PREFERENCES_GET'})).toEqual({ok:true,data:defaults});
 state.stored.proSettings={privateSetting:'preserved'};state.stored.settings={basicSetting:'preserved'};
 const changed={...defaults,confirmMarket:true};
 expect(await worker.handle({type:'PRO',action:'PREFERENCES_SAVE',preferences:changed})).toEqual({ok:true,data:changed});
 expect(state.stored.proTradingPreferences).toEqual(changed);expect(state.stored.proSettings).toEqual({privateSetting:'preserved'});expect(state.stored.settings).toEqual({basicSetting:'preserved'});
 state.stored.proTradingPreferences={version:99};expect(await worker.handle({type:'PRO',action:'PREFERENCES_GET'})).toMatchObject({ok:false});
 expect(await worker.handle({type:'PRO',action:'PREFERENCES_SAVE',preferences:{...defaults,serverUrl:'https://other.example'}})).toMatchObject({ok:false});
});
it('allows only bounded new read and preview endpoints',()=>{
 const mint='So11111111111111111111111111111111111111112';
 for(const path of ['/v1/portfolio',`/v1/portfolio?mint=${mint}`])expect(allowedProRequest('GET',path)).toBe(true);
 for(const path of ['/v1/portfolio?mint=bad',`/v1/portfolio?mint=${mint}&mint=${mint}`,'/v1/portfolio?wallet=other'])expect(allowedProRequest('GET',path)).toBe(false);
 expect(allowedProRequest('POST','/v2/recover-initials/preview')).toBe(true);expect(allowedProRequest('GET','/v2/recover-initials/preview')).toBe(false);
});
it('does not let a stalled portfolio read hold order mutations and rejects a changed read session',async()=>{
 let resolve!:(value:unknown)=>void;state.fetch.mockImplementation(async(_method:string,path:string)=>path==='/v1/portfolio'?new Promise(r=>{resolve=r;}):{});
 const worker=createProWorker(),reading=worker.handle({type:'PRO',action:'REQUEST',path:'/v1/portfolio'});
 await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
 expect(await worker.handle({type:'PRO',action:'REQUEST',method:'POST',path:'/v1/orders/12345678-1234-4123-8123-123456789abc/cancel'})).toMatchObject({ok:true});
 state.settings.serverId='other';resolve({wallet:'old'});expect(await reading).toMatchObject({ok:false});
});

import {canonicalJson} from '../../src/pro/contracts';
it('serializes cross-view preference saves before the final order policy fence',async()=>{
 const worker=createProWorker(),previous=defaultPreferences(),expectedSession={serverId:'server',deviceId:'device',wallet:'wallet'};
 state.fetch.mockImplementation(async(_method:string,path:string)=>path==='/v1/health'?{serverId:'server',wallet:'wallet'}:{});
 const request={type:'PRO' as const,action:'REQUEST' as const,method:'POST',path:'/v2/orders',body:{orderId:'123e4567-e89b-42d3-a456-426614174000',spec:{}},expectedSession,expectedPreferences:canonicalJson(previous)};
 const saved=worker.handle({type:'PRO',action:'PREFERENCES_SAVE',preferences:{...previous,confirmMarket:true}});
 const rejected=worker.handle(request);await saved;
 expect(await rejected).toMatchObject({ok:false,error:expect.stringContaining('preferences changed')});
 expect(state.fetch.mock.calls.some(([method])=>method==='POST')).toBe(false);
 expect(await worker.handle({...request,expectedPreferences:undefined})).toMatchObject({ok:false});
 expect(await worker.handle({...request,expectedPreferences:canonicalJson(state.stored.proTradingPreferences)})).toMatchObject({ok:true});
 expect(state.fetch).toHaveBeenLastCalledWith('POST','/v2/orders',{...request.body,expectedWallet:'wallet'},expectedSession);
});
it('rechecks persisted profile after asynchronous server wallet validation',async()=>{
 const worker=createProWorker(),previous=defaultPreferences(),next=defaultPreferences();next.profiles[0]!.buyPresets=['0.2'];
 state.fetch.mockImplementation(async()=>{state.stored.proTradingPreferences=next;return {serverId:'server',wallet:'wallet'};});
 expect(await worker.handle({type:'PRO',action:'REQUEST',method:'POST',path:'/v2/strategies',body:{spec:{}},expectedSession:{serverId:'server',deviceId:'device',wallet:'wallet'},expectedPreferences:canonicalJson(previous)})).toMatchObject({ok:false,error:expect.stringContaining('preferences changed')});
 expect(state.fetch).toHaveBeenCalledTimes(1);
});
