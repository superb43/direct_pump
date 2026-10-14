import {afterEach,expect,it,vi} from 'vitest';
const transport=vi.hoisted(()=>({request:vi.fn(),listeners:new Set<(changes:any,area:string)=>void>(),stored:{} as Record<string,unknown>,write:vi.fn()}));
vi.mock('wxt/browser',()=>({browser:{storage:{onChanged:{addListener:(fn:any)=>transport.listeners.add(fn),removeListener:(fn:any)=>transport.listeners.delete(fn)},local:{get:async()=>({...transport.stored}),set:async(value:any)=>{await transport.write();Object.assign(transport.stored,value);},remove:async(key:string)=>{delete transport.stored[key];}}}}}));
vi.mock('../../src/pro/settings-view',()=>({sendPro:(request:unknown)=>transport.request(request),mountProSettings:()=>({destroy(){}})}));
vi.mock('../../src/pro/withdrawal-view',()=>({mountWithdrawalView:()=>({refresh:async()=>{},destroy(){}})}));
vi.mock('../../src/pro/wallet-view',()=>({mountProWallet:()=>({update(){},showWithdraw(){},withdrawalVisible:()=>false,destroy(){}})}));
vi.mock('../../src/pro/onboarding-view',()=>({mountProOnboarding:()=>({open(){},destroy(){}})}));
vi.mock('../../src/pro/hotkeys',()=>({mountProHotkeys:()=>({sync:async()=>{},destroy(){}}),readProTradeBinding:async(target:any,mint:any,session:any)=>({target,mint,session}),assertProTradeBinding:async()=>{}}));
import {defaultPreferences} from '../../src/pro/trading-preferences';
import {mountProPanel} from '../../src/pro/panel-view';
import type {ProTradingPreferences} from '../../src/pro/trading-preferences';
class Element {
 checked=false;value='';textContent='';hidden=false;disabled=false;dataset:Record<string,string>={};children:Element[]=[];nodes=new Map<string,Element>();events=new Map<string,(event?:unknown)=>void>();cleared=false;private markup='';
 get innerHTML(){return this.markup;}set innerHTML(value:string){this.markup=value;this.cleared=false;this.nodes.clear();}
 classList={toggle:vi.fn()};elements={namedItem:(name:string)=>this.querySelector(name)};
 querySelector(selector:string):Element {if(this.cleared)return null as unknown as Element;if(!this.nodes.has(selector))this.nodes.set(selector,new Element());return this.nodes.get(selector)!;}
 querySelectorAll(){return [];}
 append(...nodes:Element[]){this.children.push(...nodes);}replaceChildren(...nodes:Element[]){this.children=nodes;this.nodes.clear();this.cleared=nodes.length===0;}
 focus(){}scrollIntoView(){}setAttribute(){}addEventListener(name:string,listener:(event?:unknown)=>void){this.events.set(name,listener);}
}
const mint='DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP';
const sol='So11111111111111111111111111111111111111112';
const target={site:'GMGN' as const,kind:'MINT' as const,address:mint,pageUrl:`https://gmgn.ai/sol/token/${mint}`};
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
let panels:ReturnType<typeof mountProPanel>[]=[];
afterEach(()=>{for(const panel of panels)panel.destroy();panels=[];transport.listeners.clear();transport.stored={};transport.request.mockReset();transport.write.mockReset();vi.useRealTimers();vi.unstubAllGlobals();});
function fixture(){
 vi.useFakeTimers();vi.stubGlobal('document',{hidden:false,createElement:()=>new Element(),addEventListener(){}});vi.stubGlobal('window',{setTimeout,clearTimeout,setInterval,clearInterval});
 let preferences=defaultPreferences(),delayPreview=false,releasePreview:(()=>void)|undefined;
 const submitted:any[]=[];
 const change=(next:ProTradingPreferences,emit=true)=>{preferences=structuredClone(next);if(emit)for(const listener of transport.listeners)listener({proTradingPreferences:{newValue:next}},'local');};
 transport.request.mockImplementation(async(request:any)=>{
  if(request.action==='PREFERENCES_GET')return structuredClone(preferences);
  if(request.action==='PREFERENCES_SAVE'){change(request.preferences);return structuredClone(preferences);}
  if(request.action==='SETTINGS')return {enabled:true,serverId:'server',deviceId:'device'};
  if(request.path==='/v1/health')return {serverId:'server',wallet:'server-wallet',signer:'READY',engine:'RUNNING',capabilities:['mc-orders-v2']};
  if(request.path?.startsWith('/v1/wallet'))return [{mint:sol,decimals:9,availableRaw:'1000000000',reservedRaw:'0'}];
  if(request.path==='/v2/preview'){if(delayPreview)await new Promise<void>(resolve=>{releasePreview=resolve;});return {spec:request.body.spec,summary:{marketCapUsd:'1000',supplyRaw:'1000',tokenDecimals:0,quoteAt:Date.now()}};}
  if(request.path==='/v2/orders'&&request.method==='POST'){submitted.push(request);return {};}
  if(['/v2/orders','/v1/events?latest=30'].includes(request.path))return [];
  throw new Error(`Unexpected path ${request.path}`);
 });
 const mount=()=>{const container=new Element(),panel=mountProPanel(container as unknown as HTMLElement,target);panels.push(panel);return {container,panel,node:(key:string)=>container.querySelector(key==='confirm'?'.pro-action-bar [data-confirm]':`[data-${key}]`),submit(){const ticket=container.querySelector('[data-ticket]');ticket.querySelector('amount').value='0.01';ticket.events.get('submit')!({preventDefault(){}});}};};
 return {mount,change,submitted,get preferences(){return structuredClone(preferences);},delayPreview(){delayPreview=true;},releasePreview(){releasePreview!();}};
}
it('updates both mounted native views when confirmation policy and profile change',async()=>{
 const f=fixture(),a=f.mount(),b=f.mount();await flush();
 const next=f.preferences;next.confirmMarket=true;next.profiles.push({...next.profiles[0]!,id:'other',name:'Other',slippageBps:200,buyPresets:['0.2']});next.activeProfileId='other';f.change(next);
 for(const view of [a,b]){expect(view.node('review-button').textContent).toBe('Review buy');expect(view.node('active-profile').value).toBe('other');expect(view.node('ticket').querySelector('slippage').value).toBe('2');expect(view.container.querySelector('.pro-presets').innerHTML).toContain('0.2');}
 b.submit();await flush();expect(f.submitted).toHaveLength(0);expect(b.node('review').hidden).toBe(false);
 a.panel.destroy();panels=panels.filter(panel=>panel!==a.panel);expect(transport.listeners.size).toBe(1);
});
it.each([true,false])('fences a changed policy during delayed preview (storage event delivered: %s)',async emit=>{
 const f=fixture(),view=f.mount();await flush();f.delayPreview();view.submit();await flush();
 f.change({...f.preferences,confirmMarket:true},emit);f.releasePreview();await flush();
 expect(f.submitted).toHaveLength(0);expect(Object.keys(transport.stored)).toHaveLength(0);expect(view.node('status').textContent).toMatch(/changed/);
});
it('preserves original pending UUID/spec after a profile change during persistence and requires explicit retry',async()=>{
 const f=fixture(),view=f.mount();await flush();let release!:()=>void;transport.write.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
 view.submit();await flush();expect(release).toBeTypeOf('function');const next=f.preferences;next.profiles[0]!.buyPresets=['0.2'];f.change(next);release();await flush();
 expect(f.submitted).toHaveLength(0);const pending=Object.values(transport.stored)[0] as any;expect(pending.spec.amountRaw).toBe('10000000');expect(view.node('review').hidden).toBe(false);
 view.node('confirm').events.get('click')!();await flush();expect(f.submitted).toHaveLength(1);expect(f.submitted[0].body).toEqual({orderId:pending.id,spec:pending.spec});
});
it('keeps the reviewed order explicit when skipping future confirmations while invalidating another view',async()=>{
 const f=fixture();f.change({...f.preferences,confirmMarket:true});const a=f.mount(),b=f.mount();await flush();a.submit();b.submit();await flush();
 a.node('skip-confirm-value').checked=true;a.node('skip-confirm-value').events.get('change')!();await flush();
 expect(a.node('review').hidden).toBe(false);expect(b.node('review').hidden).toBe(true);expect(f.submitted).toHaveLength(0);
 a.node('confirm').events.get('click')!();await flush();expect(f.submitted).toHaveLength(1);
});
