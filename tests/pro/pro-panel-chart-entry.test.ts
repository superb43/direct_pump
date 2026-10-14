import {afterEach,expect,it,vi} from 'vitest';
const transport=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('wxt/browser',()=>({browser:{storage:{local:{get:async()=>({})}}}}));
vi.mock('../../src/pro/settings-view',()=>({sendPro:(request:unknown)=>transport.request(request),mountProSettings:()=>({destroy(){}})}));
vi.mock('../../src/pro/withdrawal-view',()=>({mountWithdrawalView:()=>({refresh:async()=>{},destroy(){}})}));
vi.mock('../../src/pro/wallet-view',()=>({mountProWallet:()=>({update(){},showWithdraw(){},withdrawalVisible:()=>false,destroy(){}})}));
vi.mock('../../src/pro/onboarding-view',()=>({mountProOnboarding:()=>({open(){},destroy(){}})}));
vi.mock('../../src/pro/hotkeys',()=>({mountProHotkeys:()=>({sync:async()=>{},destroy(){}})}));
import {defaultPreferences} from '../../src/pro/trading-preferences';
import {mountProPanel} from '../../src/pro/panel-view';
import type {ChartEntry} from '../../src/chart/chart-entry';
class Element {
 value='';textContent='';hidden=false;disabled=false;dataset:Record<string,string>={};children:Element[]=[];nodes=new Map<string,Element>();events=new Map<string,(event?:unknown)=>void>();cleared=false;private markup='';
 get innerHTML(){return this.markup;}set innerHTML(value:string){this.markup=value;this.cleared=false;this.nodes.clear();}
 classList={toggle:vi.fn()};elements={namedItem:(name:string)=>this.querySelector(name)};
 querySelector(selector:string):Element {if(this.cleared)return null as unknown as Element;if(!this.nodes.has(selector))this.nodes.set(selector,new Element());return this.nodes.get(selector)!;}
 querySelectorAll(){return [];}
 append(...nodes:Element[]){this.children.push(...nodes);}replaceChildren(...nodes:Element[]){this.children=nodes;this.nodes.clear();this.cleared=nodes.length===0;}
 setAttribute(){}addEventListener(name:string,listener:(event?:unknown)=>void){this.events.set(name,listener);}
}
const mint='DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP';
const target={site:'GMGN' as const,kind:'MINT' as const,address:mint,pageUrl:`https://gmgn.ai/sol/token/${mint}`};
const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();transport.request.mockReset();});
function fixture(){
 vi.useFakeTimers();vi.stubGlobal('document',{hidden:false,createElement:()=>new Element(),addEventListener(){}});vi.stubGlobal('window',{setTimeout,clearTimeout,setInterval,clearInterval});
 const entry:ChartEntry={mint,wallet:'server-wallet',priceUsd:'1',marketCapUsd:'1000',balanceRaw:'100',supplyRaw:'1000',decimals:0,updatedAt:Date.now()};
 let response:unknown=entry,capability=true,wallet=entry.wallet,delay=false;const queued:{resolve:(value:unknown)=>void;wallet:string}[]=[];
 transport.request.mockImplementation(async(request:{action:string;path?:string})=>{
  if(request.action==='PREFERENCES_GET')return defaultPreferences();
  if(request.action==='SETTINGS')return {enabled:true,serverId:'server',deviceId:'device'};
  if(request.path==='/v1/health')return {serverId:'server',wallet,signer:'READY',engine:'RUNNING',capabilities:['mc-orders-v2',...capability?['chart-entry-v1']:[]]};
  if(request.path?.startsWith('/v1/chart-entry')){if(delay)return new Promise(resolve=>queued.push({resolve,wallet}));if(response instanceof Error)throw response;return response;}
  if(request.path==='/v1/wallet')return [{mint:'So11111111111111111111111111111111111111112',availableRaw:'1000',reservedRaw:'0'}];
  if(['/v2/orders','/v1/events?latest=30'].includes(request.path??''))return [];
  throw new Error(`Unexpected path ${request.path}`);
 });
 const callback=vi.fn(),container=new Element(),panel=mountProPanel(container as unknown as HTMLElement,target,callback);
 return {panel,callback,container,entry,queued,setResponse:(next:unknown)=>{response=next;},setCapability:(next:boolean)=>{capability=next;},setWallet:(next:string)=>{wallet=next;},setDelay:(next:boolean)=>{delay=next;}};
}
it('loads native server entry independently and clears unavailable or failed entry without breaking balances/orders',async()=>{
 const f=fixture();await flush();expect(f.callback).toHaveBeenLastCalledWith(f.entry);
 expect(transport.request.mock.calls.some(([r])=>r.path===`/v1/chart-entry?mint=${mint}`)).toBe(true);
 f.setResponse(new Error('Entry RPC failed'));await f.panel.refresh();await flush();expect(f.callback).toHaveBeenLastCalledWith(undefined);
 expect(f.container.querySelector('[data-balance]').innerHTML).toContain('Available');expect(f.container.querySelector('[data-orders]').textContent).toContain('No orders');expect(f.container.querySelector('[data-status]').textContent).not.toContain('Entry RPC failed');
 f.setResponse({mint,wallet:'server-wallet',unavailable:'No cost'});await f.panel.refresh();await flush();expect(f.callback).toHaveBeenLastCalledWith(undefined);
 f.setResponse(f.entry);f.setCapability(false);await f.panel.refresh();await flush();expect(f.callback).toHaveBeenLastCalledWith(undefined);f.panel.destroy();
});
it('rejects a delayed previous target response and clears destroy/session owner changes',async()=>{
 const f=fixture();await flush();f.setDelay(true);const pending=f.panel.refresh();await flush();const old=f.queued.splice(0);
 f.panel.update({...target,poolHint:'new-context'});expect(f.callback).toHaveBeenLastCalledWith(undefined);
 for(const request of old)request.resolve(f.entry);await pending;await flush();expect(f.callback).toHaveBeenLastCalledWith(undefined);
 f.setDelay(false);for(const request of f.queued.splice(0))request.resolve(f.entry);await flush();f.setWallet('other-wallet');await f.panel.refresh();await flush();expect(f.callback).toHaveBeenLastCalledWith(undefined);
 f.panel.destroy();expect(f.callback).toHaveBeenLastCalledWith(undefined);
});

it('finishes essential refresh and keeps controls usable while one chart read never resolves',async()=>{
 const f=fixture();await flush();f.setDelay(true);
 await f.panel.refresh();await flush();expect(f.queued).toHaveLength(1);
 expect(f.container.querySelector('[data-balance]').innerHTML).toContain('Available');
 expect(f.container.querySelector('[data-orders]').textContent).toContain('No orders');
 expect(f.container.querySelector('[data-health]').textContent).toContain('Signer READY');
 expect(f.container.querySelector('[data-review-button]').disabled).toBe(false);
 const previousHealthReads=transport.request.mock.calls.filter(([request])=>request.path==='/v1/health').length;
 for(let i=0;i<3;i++)await f.panel.refresh();await flush();
 expect(transport.request.mock.calls.filter(([request])=>request.path==='/v1/health')).toHaveLength(previousHealthReads+3);
 expect(f.queued).toHaveLength(1);
 f.panel.update({...target,poolHint:'next-generation'});await flush();expect(f.queued).toHaveLength(1);
 f.panel.destroy();for(const request of f.queued)request.resolve(f.entry);await flush();expect(f.callback).toHaveBeenLastCalledWith(undefined);
});
it.each(['removed','remounted'] as const)('does not render a refresh finalizer into a %s panel',async outcome=>{
 const f=fixture();await flush();let release!:(value:unknown)=>void;
 transport.request.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const refreshing=f.panel.refresh();await flush();f.panel.destroy();
 if(outcome==='remounted'){f.container.innerHTML='<div class="pro-panel"></div>';f.container.querySelector('.pro-panel').dataset.ready='new-owner';}
 release({enabled:true,serverId:'server',deviceId:'device'});await expect(refreshing).resolves.toBeUndefined();
 if(outcome==='removed')expect(f.container.querySelector('.pro-panel')).toBeNull();
 else expect(f.container.querySelector('.pro-panel').dataset.ready).toBe('new-owner');
});
