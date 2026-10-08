import {afterEach,expect,it,vi} from 'vitest';
import {SITE_CONTEXTS} from './fixtures/site-contexts';
import {mountPanel} from '../src/panel';
import {DEFAULT_SETTINGS,type PositionSnapshot,type Receipt,type WorkerRequest,type WorkerResponse} from '../src/model';

// Minimal DOM adapter for asynchronous panel behavior; no visual-fidelity claim.
class Element {
 textContent='';innerHTML='';className='';hidden=false;title='';open=false;style={cssText:''};children:Element[]=[];
 classList={add:vi.fn(),toggle:vi.fn()};events=new Map<string,()=>void>();nodes=new Map<string,Element>();
 append(...children:Element[]){this.children.push(...children);}
 replaceChildren(...children:Element[]){this.children=children;}
 addEventListener(name:string,callback:()=>void){this.events.set(name,callback);}
 setAttribute(){}remove(){}attachShadow(){return this;}
 querySelector(selector:string){if(!this.nodes.has(selector))this.nodes.set(selector,new Element());return this.nodes.get(selector)!;}
 querySelectorAll(){return [];}
}
const mint='DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP',wallet='wallet';
const target={site:'GMGN' as const,kind:'MINT' as const,address:mint,pageUrl:`https://gmgn.ai/sol/token/${mint}`};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it.each(SITE_CONTEXTS)('$site: updates the second-buy balance before a slow sell quote and ignores an earlier quote response',async(context)=>{
 const target=context.target;
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval});
 let balance='100';const quotes:{resolve:(r:WorkerResponse)=>void;balance:string;time:number}[]=[];
 const holdings=():PositionSnapshot=>({wallet,mint,balanceRaw:balance,decimals:0,supplyRaw:'1000',updatedAt:Date.now(),balanceUpdatedAt:Date.now(),costBasisUsdMicros:'100000000'});
 const send=vi.fn(async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'SI',venue:'PUMP_CURVE',quoteMint:'So11111111111111111111111111111111111111112',quoteSymbol:'SOL'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  if(request.type==='POSITION')return request.holdingsOnly?{ok:true,position:holdings()}:new Promise(resolve=>quotes.push({resolve,balance,time:Date.now()}));
  if(request.type==='SETTINGS_PUBLIC')return {ok:true,publicSettings:DEFAULT_SETTINGS};
  return {ok:true};
 });
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement});panel.updateMarket({mint,priceUsd:'1',observedAt:Date.now(),source:context.source});await flush();
 const shadow=body.children[0]!;
 expect(shadow.querySelector('.position-value').textContent).toBe('$100.00');
 const oldQuotes=quotes.splice(0);balance='200';vi.setSystemTime(Date.now()+100);
 panel.showReceipt({wallet,mint,venue:'PUMP_CURVE',side:'BUY',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',signature:'second-buy'} satisfies Receipt);
 await flush();expect(shadow.querySelector('.position-value').textContent).toBe('$200.00');
 expect(send.mock.calls.some(([request])=>request.type==='POSITION'&&request.holdingsOnly&&request.refresh)).toBe(true);
 for(const old of oldQuotes)old.resolve({ok:true,position:{...holdings(),balanceRaw:old.balance,balanceUpdatedAt:old.time,expectedExitLamports:'1000000000',solUsd:{priceMicros:'100000000',capturedAt:old.time,source:'Coinbase spot'}}});
 await flush();expect(shadow.querySelector('.position-value').textContent).toBe('$200.00');
 panel.updateMarket({mint,priceUsd:'2',observedAt:Date.now(),source:context.source});expect(shadow.querySelector('.position-value').textContent).toBe('$400.00');
 const latest=quotes.at(-1)!;latest.resolve({ok:true,position:{...holdings(),expectedExitLamports:'1900000000',exitNetworkLamports:'1000000',market:{mint,priceUsd:'1',observedAt:latest.time,source:context.source},solUsd:{priceMicros:'100000000',capturedAt:latest.time,source:'Coinbase spot'}}});
 await flush();expect(shadow.querySelector('.position-pnl').textContent).toContain('+$279.90');
 panel.destroy();
});

it('keeps a wallet lock for another token without displaying its execution fees',async()=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval});
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'SI',venue:'PUMP_CURVE',quoteMint:'So11111111111111111111111111111111111111112',quoteSymbol:'SOL'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  return {ok:true};
 };
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement});await flush();const shadow=body.children[0]!;
 panel.showReceipt({wallet,mint:'another-token',venue:'PUMP_CURVE',side:'BUY',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'SUBMITTED',signature:'other-signature'});
 expect(panel.isBusy()).toBe(true);expect(shadow.querySelector('.status').textContent).toContain('Another token');expect(shadow.querySelector('.fee-receipt').hidden).toBe(true);
 panel.showReceipt({wallet,mint:'another-token',venue:'PUMP_CURVE',side:'BUY',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',signature:'other-signature'});
 expect(panel.isBusy()).toBe(false);expect(shadow.querySelector('.fee-receipt').hidden).toBe(true);panel.destroy();
});

it('clears missing or mismatched market hints instead of retaining another page price',async()=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval});
 const snapshot:PositionSnapshot={wallet,mint,balanceRaw:'10',decimals:0,supplyRaw:'1000',updatedAt:Date.now()};
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'SI',venue:'PUMP_CURVE',quoteMint:'So11111111111111111111111111111111111111112',quoteSymbol:'SOL'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  if(request.type==='POSITION')return {ok:true,position:snapshot};
  return {ok:true};
 };
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement});await flush();const shadow=body.children[0]!;
 panel.updateMarket({mint,priceUsd:'1',observedAt:Date.now(),source:'GMGN page'});expect(shadow.querySelector('.position-value').textContent).toBe('$10.00');
 panel.updateMarket(undefined);expect(shadow.querySelector('.position-value').textContent).toBe('Unavailable');
 panel.updateMarket({mint:'another-token',priceUsd:'2',observedAt:Date.now(),source:'GMGN page'});expect(shadow.querySelector('.position-value').textContent).toBe('Unavailable');panel.destroy();
});

it.each(SITE_CONTEXTS)('$site: discards an old wallet quote after Phantom switches accounts',async(context)=>{
 const target=context.target;
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval});
 let account=wallet;const quotes:{wallet:string;resolve:(r:WorkerResponse)=>void}[]=[];
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'SI',venue:'PUMP_CURVE',quoteMint:'So11111111111111111111111111111111111111112',quoteSymbol:'SOL'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet:account};
  if(request.type==='POSITION')return request.holdingsOnly?{ok:true,position:{wallet:request.wallet,mint,balanceRaw:request.wallet===wallet?'10':'20',decimals:0,supplyRaw:'1000',updatedAt:Date.now()}}:new Promise(resolve=>quotes.push({wallet:request.wallet,resolve}));
  return {ok:true};
 };
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement});await flush();panel.updateMarket({mint,priceUsd:'1',observedAt:Date.now(),source:context.source});
 const old=quotes.filter(q=>q.wallet===wallet);account='new-wallet';await vi.advanceTimersByTimeAsync(3000);await flush();
 for(const q of old)q.resolve({ok:true,position:{wallet,mint,balanceRaw:'999',decimals:0,supplyRaw:'1000',updatedAt:Date.now()}});await flush();
 expect(body.children[0]!.querySelector('.position-value').textContent).toBe('$20.00');panel.destroy();
});

it('shows initial token and settings failures even when wallet restoration finishes later',async()=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval});
 let restore!:(r:WorkerResponse)=>void;
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')throw new Error('Token read failed');
  if(request.type==='SETTINGS_PUBLIC')throw new Error('Settings read failed');
  if(request.type==='WALLET_RESTORE')return new Promise(resolve=>{restore=resolve;});
  return {ok:true};
 };
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement});await flush();restore({ok:true,wallet});await flush();
 const status=body.children[0]!.querySelector('.status');expect(status.textContent).toBe('Token read failed');expect(status.className).toContain('error');panel.destroy();
});

it('accepts pool market hints only for the verified token mint',async()=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval});
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'SI',venue:'PUMP_CURVE',quoteMint:'So11111111111111111111111111111111111111112',quoteSymbol:'SOL'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  if(request.type==='POSITION')return {ok:true,position:{wallet,mint,balanceRaw:'10',decimals:0,supplyRaw:'1000',updatedAt:Date.now()}};
  return {ok:true};
 };
 const pool={...target,site:'AXIOM' as const,kind:'POOL' as const,address:'pool-address'};
 const panel=mountPanel(pool,send,{container:body as unknown as HTMLElement});await flush();const shadow=body.children[0]!;
 panel.updateMarket({mint,priceUsd:'2',observedAt:Date.now(),source:'Axiom page'});expect(shadow.querySelector('.position-value').textContent).toBe('$20.00');expect(shadow.querySelector('.position-source').textContent).toBe('Axiom live price');
 panel.updateMarket({mint:'wrong-mint',priceUsd:'3',observedAt:Date.now(),source:'Axiom page'});expect(shadow.querySelector('.position-value').textContent).toBe('Unavailable');panel.destroy();
});

it('replays an early confirmed receipt after token resolution and continues its pending fee audit',async()=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval});
 let resolveToken!:(r:WorkerResponse)=>void;
 const receipt:Receipt={wallet,mint,venue:'PUMP_CURVE',side:'BUY',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',signature:'early-confirmed',feeReceipt:{state:'PENDING',checkedAt:Date.now(),note:'Checking transaction fees',protocolFees:[],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:false}};
 const send=vi.fn(async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return new Promise(resolve=>{resolveToken=resolve;});
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  if(request.type==='STATUS')return {ok:true,receipt};
  return {ok:true};
 });
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement});await flush();const shadow=body.children[0]!;
 expect(shadow.querySelector('.fee-receipt').hidden).toBe(true);
 expect(send.mock.calls.filter(([request])=>request.type==='STATUS')).toHaveLength(1);
 resolveToken({ok:true,token:{mint,symbol:'SI',venue:'PUMP_CURVE',quoteMint:'So11111111111111111111111111111111111111112',quoteSymbol:'SOL'}});await flush();
 expect(shadow.querySelector('.fee-receipt').hidden).toBe(false);expect(shadow.querySelector('.status').textContent).toBe('Transaction confirmed.');
 await vi.advanceTimersByTimeAsync(3000);await flush();expect(send.mock.calls.filter(([request])=>request.type==='STATUS')).toHaveLength(2);panel.destroy();
});

for (const context of SITE_CONTEXTS) {
 it(`${context.site}: restores the wallet before metadata and retains the early matching market and receipt`,async()=>{
  vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval});
  let resolveToken!:(r:WorkerResponse)=>void;
  const receipt:Receipt={wallet,mint,venue:'PUMP_CURVE',side:'BUY',pageUrl:context.target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',signature:'early',feeReceipt:{state:'PENDING',checkedAt:Date.now(),note:'Checking transaction fees',protocolFees:[],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:false}};
  const send=vi.fn(async(request:WorkerRequest):Promise<WorkerResponse>=>{
   if(request.type==='TOKEN_INFO')return new Promise(resolve=>{resolveToken=resolve;});
   if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
   if(request.type==='STATUS')return {ok:true,receipt};
   if(request.type==='POSITION')return {ok:true,position:{wallet,mint,balanceRaw:'10',decimals:0,supplyRaw:'1000',updatedAt:Date.now()}};
   return {ok:true};
  });
  const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement});
  panel.updateMarket({mint,priceUsd:'2',observedAt:Date.now(),source:context.source});await flush();
  const shadow=body.children[0]!;expect(shadow.querySelector('.fee-receipt').hidden).toBe(true);
  resolveToken({ok:true,token:{mint,symbol:'SI'}});await flush();
  expect(shadow.querySelector('.position-value').textContent).toBe('$20.00');
  expect(shadow.querySelector('.status').textContent).toBe('Transaction confirmed.');
  expect(shadow.querySelector('.fee-receipt').hidden).toBe(false);
  await vi.advanceTimersByTimeAsync(3000);expect(send.mock.calls.filter(([r])=>r.type==='STATUS')).toHaveLength(2);
  panel.destroy();
 });
 it(`${context.site}: invalidates delayed token, holdings and quotes on hint refresh while preserving the wallet lock`,async()=>{
  vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval});
  const tokens:((r:WorkerResponse)=>void)[]=[],positions:{request:Extract<WorkerRequest,{type:'POSITION'}>;resolve:(r:WorkerResponse)=>void}[]=[];
  const send=vi.fn(async(request:WorkerRequest):Promise<WorkerResponse>=>{
   if(request.type==='TOKEN_INFO')return new Promise(resolve=>tokens.push(resolve));
   if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
   if(request.type==='POSITION')return new Promise(resolve=>positions.push({request,resolve}));
   return {ok:true};
  });
  const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement});await flush();
  tokens[0]!({ok:true,token:{mint,symbol:'INITIAL'}});await flush();
  panel.updateMarket({mint,priceUsd:'2',observedAt:Date.now(),source:context.source});
  const oldPositions=[...positions];
  panel.showReceipt({wallet,mint:'other-token',venue:'PUMP_CURVE',side:'BUY',pageUrl:context.target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'SUBMITTED',signature:'pending'});
  const first={...context.target,poolHint:'first-pool'},latest={...context.target,poolHint:'latest-pool'};
  panel.updateContext(first);panel.updateContext(latest);await flush();
  expect(panel.isBusy()).toBe(true);expect(send.mock.calls.filter(([r])=>r.type==='WALLET_RESTORE')).toHaveLength(1);
  expect(send.mock.calls.filter(([r])=>r.type==='CONNECT')).toHaveLength(0);
  tokens[1]!({ok:true,token:{mint:'wrong-mint',symbol:'STALE'}});await flush();
  expect(body.children[0]!.querySelector('.token').textContent).not.toContain('STALE');
  tokens[2]!({ok:true,token:{mint,symbol:'LATEST'}});await flush();
  for(const p of oldPositions)p.resolve({ok:true,position:{wallet,mint,balanceRaw:'999',decimals:0,supplyRaw:'1000',updatedAt:Date.now()}});
  await flush();expect(body.children[0]!.querySelector('.position').hidden).toBe(true);expect(panel.isBusy()).toBe(true);
  panel.showReceipt({wallet,mint:'other-token',venue:'PUMP_CURVE',side:'BUY',pageUrl:context.target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',signature:'pending'});
  expect(panel.isBusy()).toBe(false);expect(body.children[0]!.querySelector('.fee-receipt').hidden).toBe(true);
  panel.refreshPosition();await flush();expect(positions.at(-1)!.request.target).toEqual(latest);panel.destroy();
 });
}

for (const context of SITE_CONTEXTS) {
 it(`${context.site}: keeps the exact click target through async Phantom connection`,async()=>{
  vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval});
  let connect!:(r:WorkerResponse)=>void;const initial={...context.target};
  const send=vi.fn(async(request:WorkerRequest):Promise<WorkerResponse>=>{
   if(request.type==='TOKEN_INFO')return {ok:true,token:{mint}};
   if(request.type==='CONNECT')return new Promise(resolve=>{connect=resolve;});
   return {ok:true};
  });
  const panel=mountPanel(initial,send,{container:body as unknown as HTMLElement});await flush();
  const shadow=body.children[0]!;shadow.querySelector('input').textContent='';
  (shadow.querySelector('input') as unknown as {value:string}).value='0.01';
  (shadow.querySelector('.custom-buy').events.get('click') as unknown as (event:{isTrusted:boolean})=>void)({isTrusted:true});await flush();
  initial.poolHint='mutated-outside-panel';connect({ok:true,wallet});await flush();
  const trade=send.mock.calls.map(([r])=>r).find(r=>r.type==='TRADE');
  expect(trade).toMatchObject({target:context.target,wallet,intent:{side:'BUY',sol:'0.01'}});
  expect(trade?.type==='TRADE'&&trade.target.poolHint).toBeUndefined();panel.destroy();
 });
 it(`${context.site}: rejects a changed hint context during Phantom connection`,async()=>{
  vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval});
  let connect!:(r:WorkerResponse)=>void;
  const send=vi.fn(async(request:WorkerRequest):Promise<WorkerResponse>=>{
   if(request.type==='TOKEN_INFO')return {ok:true,token:{mint}};
   if(request.type==='CONNECT')return new Promise(resolve=>{connect=resolve;});
   return {ok:true};
  });
  const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement});await flush();
  const shadow=body.children[0]!;(shadow.querySelector('input') as unknown as {value:string}).value='0.01';
  (shadow.querySelector('.custom-buy').events.get('click') as unknown as (event:{isTrusted:boolean})=>void)({isTrusted:true});await flush();
  panel.updateContext({...context.target,poolHint:'new-hint'});await flush();connect({ok:true,wallet});await flush();
  expect(send.mock.calls.some(([r])=>r.type==='TRADE')).toBe(false);
  expect(shadow.querySelector('.status').textContent).toContain('token context changed');panel.destroy();
 });
}
