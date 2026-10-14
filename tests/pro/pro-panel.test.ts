import {afterEach,expect,it,vi} from 'vitest';
vi.mock('wxt/browser',()=>({browser:{}}));
import {PanelReview} from '../../src/pro/panel-view';
it('discards a late preview after changing the ticket or token',()=>{
 const review=new PanelReview<{mint:string;amount:string}>();const version=review.version();review.invalidate();
 expect(()=>review.accept({mint:'old-token',amount:'25'},version)).toThrow('Ticket changed');expect(()=>review.current()).toThrow('Review the order first');
});
it('preserves exact intent and idempotent ID across retry, isolated from caller mutation',()=>{
 const review=new PanelReview<{mint:string;steps:{portion:number}[]}>();const spec={mint:'token',steps:[{portion:25},{portion:75}]};
 review.accept(spec,review.version(),'same-reviewed-id');spec.steps[0]!.portion=100;
 const attempt=review.current();attempt.spec.steps[0]!.portion=1;
 expect(review.current()).toEqual({id:'same-reviewed-id',spec:{mint:'token',steps:[{portion:25},{portion:75}]}});
 review.invalidate();expect(()=>review.current()).toThrow();
});

import {restorePendingOrder,strategyAllocation,pendingOrderAcknowledged,type PendingOrderReview} from '../../src/pro/panel-view';
import {validateProSpecV2,type ProSpecV2,type ProExitStep,type ProOrder} from '../../src/pro/contracts';
const mint='DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP';
const common:ProSpecV2={version:2,basis:'MC',kind:'MARKET',side:'SELL',target:{site:'GMGN',kind:'MINT',address:mint,pageUrl:`https://gmgn.ai/sol/token/${mint}`},mint,amountRaw:'1000000',decimals:6,expiresAt:Date.now()+3600000,slippageBps:100,priorityFeeLamports:100000,maxNetworkLamports:'5000000'};
const rows:ProExitStep[]=[25,25,50].map((portion,i)=>({id:`00000000-0000-4000-8000-00000000000${i}`,kind:'TAKE_PROFIT',targetMcUsd:String(500000+i*100000),portionBps:portion*100}));
rows.push({id:'00000000-0000-4000-8000-000000000003',kind:'STOP_LOSS',targetMcUsd:'300000',portionBps:10000});
it('supports independent allocation paths for 25/25/50 TP protected by 100% SL',()=>{
 expect(()=>validateProSpecV2({...common,kind:'STRATEGY',steps:rows})).not.toThrow();
 expect(strategyAllocation(rows)).toBe('TP 100% · 0% left | SL 100% · 0% left');
 expect(()=>validateProSpecV2({...common,kind:'STRATEGY',steps:[...rows,{...rows[0]!,id:'00000000-0000-4000-8000-000000000004'}]})).toThrow('Each exit path');
});
it('recovers immutable saved intent with the original UUID and target across navigation and expiry',()=>{
 const saved:PendingOrderReview={id:'00000000-0000-4000-8000-000000000005',spec:{...common,expiresAt:Date.now()-1000},serverId:'server',deviceId:'device',wallet:'server-wallet',operation:'create'};
 const recovered=restorePendingOrder(saved,{serverId:'server',deviceId:'device',wallet:'server-wallet'});
 saved.spec.target.address='changed';saved.spec.amountRaw='99';
 expect(recovered.id).toBe(saved.id);expect(recovered.spec.target.address).toBe(mint);expect(recovered.spec.amountRaw).toBe('1000000');
 expect(()=>restorePendingOrder(recovered,{serverId:'other-server',deviceId:'device',wallet:'server-wallet'})).toThrow('server wallet');
 expect(()=>restorePendingOrder({...recovered,operation:'retry',revision:1,action:'unrecognized'},{serverId:'server',deviceId:'device',wallet:'server-wallet'})).toThrow('authorization action');
});

it('requires the requested retry outcome before releasing the saved review',()=>{
 const pending:PendingOrderReview={id:'00000000-0000-4000-8000-000000000006',spec:common,serverId:'server',deviceId:'device',wallet:'server-wallet',operation:'retry',revision:2,action:'cancel'};
 const order:ProOrder={id:pending.id,spec:common,wallet:'server-wallet',revision:2,state:'OPEN',createdAt:Date.now(),updatedAt:Date.now()};
 expect(pendingOrderAcknowledged(pending,order)).toBe(false);
 expect(pendingOrderAcknowledged(pending,{...order,state:'CANCELLED'})).toBe(true);
 expect(pendingOrderAcknowledged({...pending,action:'resume'},{...order,state:'PAUSED'})).toBe(false);
 expect(pendingOrderAcknowledged({...pending,action:'resume'},{...order,state:'SIGNING'})).toBe(true);
 expect(pendingOrderAcknowledged({...pending,action:'pause'},order)).toBe(false);
 expect(pendingOrderAcknowledged({...pending,action:'pause'},{...order,state:'PAUSED'})).toBe(true);
 expect(pendingOrderAcknowledged({...pending,action:'edit'},{...order,revision:1})).toBe(false);
 expect(pendingOrderAcknowledged({...pending,action:'edit'},{...order,pendingAction:'edit'})).toBe(false);
 expect(pendingOrderAcknowledged({...pending,action:'edit'},order)).toBe(true);
 expect(()=>restorePendingOrder({...pending,id:'invalid-order-id'},{serverId:'server',deviceId:'device',wallet:'server-wallet'})).toThrow('server wallet');
 expect(restorePendingOrder({...pending,id:pending.id+':exit'},{serverId:'server',deviceId:'device',wallet:'server-wallet'}).id).toBe(pending.id+':exit');
});

import {isProSideControl,compactMcInput,expectedRemainingRaw} from '../../src/pro/panel-view';
import {parseMcInput} from '../../src/pro/mc';
it('routes only the actual side segments, preserving a Limit or Strategy on Review/Confirm',()=>{
 const segment={dataset:{side:'SELL'},matches:(selector:string)=>selector==='.pro-sides [data-side]'};
 const reviewAction={dataset:{side:'BUY'},matches:()=>false};const confirmAction={dataset:{side:'SELL'},matches:()=>false};
 expect(isProSideControl(segment)).toBe(true);expect(isProSideControl(reviewAction)).toBe(false);expect(isProSideControl(confirmAction)).toBe(false);
});
it('shortens generated MC values without losing any digit and leaves parser precision intact',()=>{
 for(const value of ['420000.000000000000','250123.456789123456','1200000.120000000000','1234567890.123456789123','0.000000000001']){
  expect(parseMcInput(compactMcInput(value))).toBe(parseMcInput(value));
 }
 expect(compactMcInput('420000.000000000000')).toBe('420K');
 expect(compactMcInput('250123.456789123456')).toBe('250123.456789123456');
});
it('shows quantity residual after per-step integer rounding rather than assuming 100% leaves zero',()=>{
 expect(expectedRemainingRaw('1001',rows.filter(row=>row.kind==='TAKE_PROFIT'))).toBe('1');
 expect(expectedRemainingRaw('1001',[{...rows[0]!,remaining:true,portionBps:undefined}])).toBe('0');
});

import {sameProSession,requireReviewSession,pendingCancellationReview} from '../../src/pro/panel-view';
import {manualExecutionAllowed,mountPanelController} from '../../src/panel/panel-controller';
it('freezes the complete reviewed server/device/wallet owner and rejects each identity change',()=>{
 const owner={serverId:'server',deviceId:'device',wallet:'wallet'};const review=new PanelReview<ProSpecV2>();
 review.accept(common,review.version(),'00000000-0000-4000-8000-000000000010',owner);owner.wallet='other-wallet';
 const approved=review.current();expect(approved.session!.wallet).toBe('wallet');
 expect(()=>requireReviewSession(approved.session,owner)).toThrow('pairing changed');
 for(const key of ['serverId','deviceId','wallet'] as const){const changed={...approved.session!,[key]:'changed'};expect(sameProSession(approved.session,changed)).toBe(false);expect(()=>requireReviewSession(approved.session,changed)).toThrow();}
 expect(requireReviewSession(approved.session,{serverId:'server',deviceId:'device',wallet:'wallet'})).toEqual(approved.session);
});
it('never allows native Phantom execution while the stored mode is unknown or Pro is on',()=>{
 expect(manualExecutionAllowed(true,'PREVIEW')).toBe(false);expect(manualExecutionAllowed(true,'UNKNOWN')).toBe(false);expect(manualExecutionAllowed(true,'ON')).toBe(false);expect(manualExecutionAllowed(true,'OFF')).toBe(true);
 expect(manualExecutionAllowed(false,'UNKNOWN')).toBe(true);
});
it('reviews signer-fenced cancellation of an expired missing create with the same UUID/spec/owner',()=>{
 const original:PendingOrderReview={id:'00000000-0000-4000-8000-000000000011',spec:{...common,expiresAt:Date.now()-1000},serverId:'server',deviceId:'device',wallet:'server-wallet',operation:'create'};
 const cancel=pendingCancellationReview(original);
 expect(cancel).toEqual({...original,operation:'retry',action:'cancel',revision:1});expect(original.operation).toBe('create');
 const order:ProOrder={id:original.id,spec:original.spec,wallet:original.wallet,revision:1,state:'OPEN',createdAt:Date.now(),updatedAt:Date.now()};
 expect(pendingOrderAcknowledged(cancel,undefined)).toBe(false);expect(pendingOrderAcknowledged(cancel,order)).toBe(false);
 expect(pendingOrderAcknowledged(cancel,{...order,state:'CANCELLED',pendingAction:'cancel'})).toBe(false);
 expect(pendingOrderAcknowledged(cancel,{...order,state:'CANCELLED'})).toBe(true);
 expect(pendingOrderAcknowledged(cancel,{...order,state:'CANCELLED',wallet:'other-wallet'})).toBe(false);
 expect(()=>pendingCancellationReview(original,{...order,spec:{...order.spec,amountRaw:'99'}})).toThrow('differs');
});

// Minimal DOM adapter exercises controller mode policy without a visual-fidelity claim.
class ModeElement {
 value='';attributes=new Map<string,string>();textContent='';innerHTML='';className='';hidden=false;disabled=false;title='';open=false;style={cssText:''};children:ModeElement[]=[];
 classList={add:vi.fn(),toggle:vi.fn()};events=new Map<string,(event?:any)=>void>();nodes=new Map<string,ModeElement>();
 append(...children:ModeElement[]){this.children.push(...children);}replaceChildren(...children:ModeElement[]){this.children=children;}
 addEventListener(name:string,callback:(event?:any)=>void){this.events.set(name,callback);}removeAttribute(name:string){this.attributes.delete(name);}setAttribute(name:string,value:string){this.attributes.set(name,value);}remove(){}attachShadow(){return this;}
 querySelector(selector:string){if(!this.nodes.has(selector))this.nodes.set(selector,new ModeElement());return this.nodes.get(selector)!;}querySelectorAll(){return [];}
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('shows failed initial mode reads and keeps manual/toggle requests blocked until a successful retry',async()=>{
 vi.useFakeTimers();const body=new ModeElement();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new ModeElement()});vi.stubGlobal('window',{setInterval,clearInterval});
 let failed=true;const requests:string[]=[];
 const send=vi.fn(async(request:import('../../src/model').WorkerRequest):Promise<import('../../src/model').WorkerResponse>=>{
  requests.push(request.type==='PRO'?`PRO:${request.action}`:request.type);
  if(request.type==='PRO'&&request.action==='SETTINGS')return failed?{ok:false,error:'Mode storage read failed'}:{ok:true,data:{enabled:false,serverUrl:'',chromeNotifications:false}};
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'TEST'}};
  return {ok:true};
 });
 const panel=mountPanelController(common.target,send,{container:body as unknown as HTMLElement,native:true});
 for(let i=0;i<30;i++)await Promise.resolve();const shadow=body.children[0]!;
 expect(shadow.querySelector('.pro-switch').textContent).toBe('Pro unknown');expect(shadow.querySelector('.pro-switch').disabled).toBe(true);
 expect(shadow.querySelector('.pro-mode-status').textContent).toContain('Mode storage read failed');expect(shadow.querySelector('.manual-panel').hidden).toBe(true);
 shadow.querySelector('.connect').events.get('click')!({isTrusted:true});shadow.querySelector('.pro-switch').events.get('click')!();
 for(let i=0;i<10;i++)await Promise.resolve();expect(requests).not.toContain('CONNECT');expect(requests).not.toContain('PRO:ENABLE');expect(requests).not.toContain('TRADE');
 failed=false;shadow.querySelector('.pro-mode-retry').events.get('click')!();for(let i=0;i<20;i++)await Promise.resolve();
 expect(shadow.querySelector('.pro-switch').textContent).toBe('Pro OFF');expect(shadow.querySelector('.pro-switch').disabled).toBe(false);expect(shadow.querySelector('.manual-panel').hidden).toBe(false);panel.destroy();
});

import {validateChartEntry} from '../../src/pro/panel-view';
it('accepts only fresh wallet/mint bound entries whose integer MC agrees with supply',()=>{
 const entry={mint,wallet:'wallet',priceUsd:'0.123456789123',marketCapUsd:'123.456789123000',supplyRaw:'1000000000',decimals:6,balanceRaw:'2000000',updatedAt:100_000};
 expect(validateChartEntry(entry,mint,'wallet',90_000,100_000)).toEqual(entry);
 for(const change of [{wallet:'other'},{mint:'other'},{balanceRaw:'0'},{balanceRaw:'1000000001'},{supplyRaw:'-1'},{decimals:1.5},{marketCapUsd:'123.456789123001'},{priceUsd:'NaN'},{updatedAt:100_001},{updatedAt:9_999},{unavailable:'Unknown',priceUsd:undefined}])expect(validateChartEntry({...entry,...change},mint,'wallet',90_000,100_000)).toBeUndefined();
 expect(validateChartEntry(entry,mint,'wallet',30_000,130_001)).toBeUndefined();
});
