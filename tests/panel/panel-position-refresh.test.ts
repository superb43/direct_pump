import {afterEach,expect,it,vi} from 'vitest';
import {SITE_CONTEXTS} from '../fixtures/site-contexts';
import {mountPanel} from '../../src/panel/panel';
import {createPanelView} from '../../src/panel/panel-view';
import {DEFAULT_SETTINGS,type PositionSnapshot,type PortfolioSnapshot,type Receipt,type WorkerRequest,type WorkerResponse} from '../../src/model';

// Minimal DOM adapter for asynchronous panel behavior; no visual-fidelity claim.
class Element {
 value='';attributes=new Map<string,string>();textContent='';innerHTML='';className='';hidden=false;title='';open=false;style={cssText:''};children:Element[]=[];
 classList={add:vi.fn(),toggle:vi.fn()};events=new Map<string,()=>void>();nodes=new Map<string,Element>();
 append(...children:Element[]){this.children.push(...children);}
 replaceChildren(...children:Element[]){this.children=children;}
 addEventListener(name:string,callback:()=>void){this.events.set(name,callback);}
 removeAttribute(name:string){this.attributes.delete(name);}setAttribute(name:string,value:string){this.attributes.set(name,value);}remove(){}attachShadow(){return this;}
 querySelector(selector:string){if(!this.nodes.has(selector))this.nodes.set(selector,new Element());return this.nodes.get(selector)!;}
 querySelectorAll(){return [];}
}
const mint='DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP',wallet='wallet';
const target={site:'GMGN' as const,kind:'MINT' as const,address:mint,pageUrl:`https://gmgn.ai/sol/token/${mint}`};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it.each(SITE_CONTEXTS)('$site: displays history-based values without prefixes and preserves sign colors and explains the average in holdings',async(context)=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const position:PositionSnapshot={wallet,mint,balanceRaw:'100',decimals:0,supplyRaw:'1000',updatedAt:Date.now(),costBasisUsdMicros:'100000000',costBasisSolLamports:'1000000000',costBasisEstimated:true,expectedExitLamports:'1250000000',solUsd:{priceMicros:'100000000',capturedAt:Date.now(),source:'Coinbase spot'}};
 const send=async(r:WorkerRequest):Promise<WorkerResponse>=>{
  if(r.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'QI'}};
  if(r.type==='WALLET_RESTORE')return {ok:true,wallet};
  if(r.type==='POSITION')return {ok:true,position};
  if(r.type==='PORTFOLIO')return {ok:true,portfolio:{wallet,updatedAt:Date.now(),holdings:[{mint,symbol:'QI',pageUrl:context.target.pageUrl,position}]}};
  return {ok:true};
 };
 const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement});await flush();const root=body.children[0]!,row=root.querySelector('.holdings-list').children[0]!;
 expect(row.children[1]!.children[1]!.textContent).toBe('+$25.00 (+25.00%)');expect(row.children[1]!.children[1]!.className).toBe('positive');
 expect(row.title).toContain('Cost basis: $100.00');expect(row.title).toContain('Avg cost (including entry costs): $1 per token.');
 expect(root.querySelector('.position-source').textContent).toContain('Includes trade-history estimates');
 panel.destroy();
});
it.each(SITE_CONTEXTS)('$site: shows confirmed feedback once, preserves fee audits and hides it after five seconds',async(context)=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const receipt:Receipt={wallet,mint,venue:'PUMP_CURVE',side:'BUY',pageUrl:context.target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',signature:'confirmed',feeReceipt:{state:'PENDING',checkedAt:Date.now(),note:'Checking fees',protocolFees:[],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:false}};
 const send=vi.fn(async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'SI'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  if(request.type==='STATUS')return {ok:true,receipt};
  return {ok:true};
 });
 const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement});await flush();const root=body.children[0]!,status=root.querySelector('.status');
 expect(root.innerHTML).not.toContain('fee-receipt');
 expect(root.innerHTML.indexOf('class="status"')).toBeGreaterThan(root.innerHTML.indexOf('sell-group'));
 expect(root.innerHTML.indexOf('class="status"')).toBeLessThan(root.innerHTML.indexOf('class="position"'));
 expect(root.querySelector('.status-text').textContent).toBe('Buy confirmed.');expect(status.hidden).toBe(false);
 expect(root.querySelector('.explorer').hidden).toBe(false);
 expect((root.querySelector('.explorer') as Element & {href:string}).href).toBe('https://solscan.io/tx/confirmed');
 await vi.advanceTimersByTimeAsync(4_999);expect(status.hidden).toBe(false);
 expect(send.mock.calls.filter(([r])=>r.type==='STATUS')).toHaveLength(2);
 await vi.advanceTimersByTimeAsync(1);expect(status.hidden).toBe(true);expect(root.querySelector('.explorer').hidden).toBe(true);
 await vi.advanceTimersByTimeAsync(1_000);expect(status.hidden).toBe(true);
 panel.showReceipt({...receipt,feeReceipt:{...receipt.feeReceipt!,state:'VERIFIED',checkedAt:Date.now()}});
 expect(status.hidden).toBe(true);
 const reads=send.mock.calls.filter(([r])=>r.type==='STATUS').length;
 await vi.advanceTimersByTimeAsync(3_000);expect(send.mock.calls.filter(([r])=>r.type==='STATUS')).toHaveLength(reads);
 panel.showReceipt({...receipt,side:'SELL',signature:'next-sell'});
 expect(root.querySelector('.status-text').textContent).toBe('Sell confirmed.');expect(status.hidden).toBe(false);
 panel.destroy();expect(vi.getTimerCount()).toBe(0);
});
it.each(SITE_CONTEXTS)('$site: a success timer cannot hide later pending, failed or expired feedback',async(context)=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'SI'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  return {ok:true};
 };
 const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement});await flush();const root=body.children[0]!,status=root.querySelector('.status');
 const base:Receipt={wallet,mint,venue:'PUMP_CURVE',side:'BUY',pageUrl:context.target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',signature:'first'};
 for(const state of ['SIGNING','SUBMITTED','UNKNOWN','FAILED','EXPIRED'] as const){
  panel.showReceipt({...base,signature:`success-${state}`});await vi.advanceTimersByTimeAsync(1_000);
  panel.showReceipt({...base,status:state,signature:state==='SIGNING'?undefined:`result-${state}`});
  const text=root.querySelector('.status-text').textContent;
  await vi.advanceTimersByTimeAsync(6_000);expect(status.hidden).toBe(false);expect(root.querySelector('.status-text').textContent).toBe(text);
  expect(panel.isBusy()).toBe(['SIGNING','SUBMITTED','UNKNOWN'].includes(state));
  if(state==='SIGNING')expect(root.querySelector('.explorer').hidden).toBe(true);
  if(state==='FAILED')expect(status.attributes.get('role')).toBe('alert');
 }
 panel.destroy();
});
it.each(SITE_CONTEXTS)('$site: cancels success expiry on wallet and hint changes without accepting another wallet receipt',async(context)=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 let account:string|undefined=wallet,delayToken=false;
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return delayToken?new Promise(()=>{}):{ok:true,token:{mint,symbol:'SI'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet:account};
  return {ok:true};
 };
 const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement});await flush();const root=body.children[0]!,status=root.querySelector('.status');
 const receipt:Receipt={wallet,mint,venue:'PUMP_CURVE',side:'BUY',pageUrl:context.target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',signature:'confirmed'};
 panel.showReceipt(receipt);panel.showReceipt({...receipt,wallet:'wrong-wallet',status:'FAILED',error:'Wrong wallet failure'});
 expect(root.querySelector('.status-text').textContent).toBe('Buy confirmed.');
 account=undefined;await vi.advanceTimersByTimeAsync(3_000);
 expect(root.querySelector('.status-text').textContent).toContain('Connect Phantom');
 await vi.advanceTimersByTimeAsync(2_001);expect(status.hidden).toBe(false);expect(root.querySelector('.status-text').textContent).toContain('Connect Phantom');
 account=wallet;await vi.advanceTimersByTimeAsync(1_000);panel.showReceipt(receipt);
 delayToken=true;panel.updateContext({...context.target,poolHint:'changed-hint'});
 await vi.advanceTimersByTimeAsync(5_001);expect(status.hidden).toBe(false);expect(root.querySelector('.status-text').textContent).toBe('Checking token context…');
 expect(root.querySelector('.explorer').hidden).toBe(true);
 panel.destroy();expect(vi.getTimerCount()).toBe(0);
});
it.each(SITE_CONTEXTS)('$site: totals the displayed holdings, retains their ages and ignores current-token marks and hint drift',async(context)=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const row=(asset:string,value:string,basis:string,hours:number):PositionSnapshot=>({wallet,mint:asset,balanceRaw:'1000000',decimals:6,supplyRaw:'1000000000',openedAt:Date.now()-hours*3600000,updatedAt:Date.now(),costBasisUsdMicros:basis,expectedExitLamports:value,solUsd:{priceMicros:'1000000',capturedAt:Date.now(),source:'Coinbase spot'}});
 const positions=[row('Solamians','5180000000','1430000',5),row(mint,'3550000000','5670000',8)];
 const holdings:PortfolioSnapshot={wallet,updatedAt:Date.now(),holdings:positions.map(position=>({mint:position.mint,symbol:position.mint===mint?'FARM':'Solamians',position}))};
 const send=vi.fn(async(r:WorkerRequest):Promise<WorkerResponse>=>{
  if(r.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'FARM'}};
  if(r.type==='WALLET_RESTORE')return {ok:true,wallet};
  if(r.type==='POSITION')return {ok:true,position:{...positions[1]!,expectedExitLamports:'3580000000'}};
  if(r.type==='PORTFOLIO')return {ok:true,portfolio:holdings};
  if(r.type==='PORTFOLIO_PRICES')return {ok:true,portfolio:{...holdings,holdings:holdings.holdings.map(h=>({...h,priceUpdatedAt:Date.now(),position:{...h.position!,updatedAt:Date.now(),expectedExitLamports:h.mint===mint?'4550000000':h.position!.expectedExitLamports}}))}};
  return {ok:true};
 });
 const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement});await flush();const root=body.children[0]!;
 expect(root.querySelector('.position-value').textContent).toBe('$8.73');expect(root.querySelector('.position-pnl').textContent).toBe('+$1.63 (+22.95%)');
 expect(root.innerHTML).not.toContain('Held for');expect(root.innerHTML).not.toContain('position-age');
 expect(root.querySelector('.holdings-list').children.map(row=>row.children[0]!.children[1]!.textContent)).toEqual(['5h','8h']);
 panel.updateMarket({mint,priceUsd:'99',observedAt:Date.now(),source:context.source});
 panel.updateContext({...context.target,mintHint:mint,poolHint:'drifted-hint'});await flush();
 expect(root.querySelector('.position-value').textContent).toBe('$8.73');
 vi.setSystemTime(Date.now()+1000);panel.refreshPortfolio(wallet);await flush();
 expect(root.querySelector('.position-value').textContent).toBe('$9.73');expect(root.querySelector('.position-pnl').textContent).toBe('+$2.63 (+37.04%)');
 expect(root.querySelector('.holdings-list').children[1]!.children[1]!.children[0]!.textContent).toBe('$4.55');panel.destroy();
});
it.each(SITE_CONTEXTS)('$site: updates holdings after a second buy and keeps token quote responses out of the totals',async(context)=>{
 const target=context.target;
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 let balance='100';const quotes:{resolve:(r:WorkerResponse)=>void;balance:string;time:number}[]=[];
 const holdings=():PositionSnapshot=>({wallet,mint,balanceRaw:balance,decimals:0,supplyRaw:'1000',updatedAt:Date.now(),balanceUpdatedAt:Date.now(),costBasisUsdMicros:'100000000'});
 const send=vi.fn(async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'SI',venue:'PUMP_CURVE',quoteMint:'So11111111111111111111111111111111111111112',quoteSymbol:'SOL'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  if(request.type==='POSITION')return request.holdingsOnly?{ok:true,position:holdings()}:new Promise(resolve=>quotes.push({resolve,balance,time:Date.now()}));
  if(request.type==='PORTFOLIO')return {ok:true,portfolio:{wallet,updatedAt:Date.now(),holdings:[{mint,position:{...holdings(),market:{mint,priceUsd:'1',observedAt:Date.now(),source:context.source}}}]}};
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
 panel.updateMarket({mint,priceUsd:'2',observedAt:Date.now(),source:context.source});expect(shadow.querySelector('.position-value').textContent).toBe('$200.00');
 const latest=quotes.at(-1)!;latest.resolve({ok:true,position:{...holdings(),expectedExitLamports:'1900000000',exitNetworkLamports:'1000000',market:{mint,priceUsd:'1',observedAt:latest.time,source:context.source},solUsd:{priceMicros:'100000000',capturedAt:latest.time,source:'Coinbase spot'}}});
 await flush();expect(shadow.querySelector('.position-pnl').textContent).toBe('+$0.00');
 panel.destroy();
});

it('keeps a wallet lock for another token without displaying its execution fees',async()=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'SI',venue:'PUMP_CURVE',quoteMint:'So11111111111111111111111111111111111111112',quoteSymbol:'SOL'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  return {ok:true};
 };
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement});await flush();const shadow=body.children[0]!;
 panel.showReceipt({wallet,mint:'another-token',venue:'PUMP_CURVE',side:'BUY',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'SUBMITTED',signature:'other-signature'});
 expect(panel.isBusy()).toBe(true);expect(shadow.querySelector('.status-text').textContent).toContain('Another token');expect(shadow.innerHTML).not.toContain('fee-receipt');
 panel.showReceipt({wallet,mint:'another-token',venue:'PUMP_CURVE',side:'BUY',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',signature:'other-signature'});
 expect(panel.isBusy()).toBe(false);expect(shadow.innerHTML).not.toContain('fee-receipt');panel.destroy();
});

it('does not substitute a current-token live mark for unavailable holdings totals',async()=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const snapshot:PositionSnapshot={wallet,mint,balanceRaw:'10',decimals:0,supplyRaw:'1000',updatedAt:Date.now()};
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'SI',venue:'PUMP_CURVE',quoteMint:'So11111111111111111111111111111111111111112',quoteSymbol:'SOL'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  if(request.type==='POSITION')return {ok:true,position:snapshot};
  return {ok:true};
 };
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement});await flush();const shadow=body.children[0]!;
 panel.updateMarket({mint,priceUsd:'1',observedAt:Date.now(),source:'GMGN page'});expect(shadow.querySelector('.position-value').textContent).toBe('Unavailable');
 panel.updateMarket(undefined);expect(shadow.querySelector('.position-value').textContent).toBe('Unavailable');
 panel.updateMarket({mint:'another-token',priceUsd:'2',observedAt:Date.now(),source:'GMGN page'});expect(shadow.querySelector('.position-value').textContent).toBe('Unavailable');panel.destroy();
});

it.each(SITE_CONTEXTS)('$site: discards an old wallet quote after Phantom switches accounts',async(context)=>{
 const target=context.target;
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 let account=wallet;const quotes:{wallet:string;resolve:(r:WorkerResponse)=>void}[]=[];
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'SI',venue:'PUMP_CURVE',quoteMint:'So11111111111111111111111111111111111111112',quoteSymbol:'SOL'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet:account};
  if(request.type==='POSITION')return request.holdingsOnly?{ok:true,position:{wallet:request.wallet,mint,balanceRaw:request.wallet===wallet?'10':'20',decimals:0,supplyRaw:'1000',updatedAt:Date.now()}}:new Promise(resolve=>quotes.push({wallet:request.wallet,resolve}));
  if(request.type==='PORTFOLIO')return {ok:true,portfolio:{wallet:request.wallet,updatedAt:Date.now(),holdings:[{mint,position:{wallet:request.wallet,mint,balanceRaw:request.wallet===wallet?'10':'20',decimals:0,supplyRaw:'1000',updatedAt:Date.now(),market:{mint,priceUsd:'1',observedAt:Date.now(),source:context.source}}}]}};
  return {ok:true};
 };
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement});await flush();panel.updateMarket({mint,priceUsd:'1',observedAt:Date.now(),source:context.source});
 const old=quotes.filter(q=>q.wallet===wallet);account='new-wallet';await vi.advanceTimersByTimeAsync(3000);await flush();
 for(const q of old)q.resolve({ok:true,position:{wallet,mint,balanceRaw:'999',decimals:0,supplyRaw:'1000',updatedAt:Date.now()}});await flush();
 expect(body.children[0]!.querySelector('.position-value').textContent).toBe('$20.00');panel.destroy();
});

it('shows initial token and settings failures even when wallet restoration finishes later',async()=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 let restore!:(r:WorkerResponse)=>void;
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')throw new Error('Token read failed');
  if(request.type==='SETTINGS_PUBLIC')throw new Error('Settings read failed');
  if(request.type==='WALLET_RESTORE')return new Promise(resolve=>{restore=resolve;});
  return {ok:true};
 };
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement});await flush();restore({ok:true,wallet});await flush();
 const status=body.children[0]!.querySelector('.status');expect(body.children[0]!.querySelector('.status-text').textContent).toBe('Token read failed');expect(status.className).toContain('error');panel.destroy();
});

it('keeps both matching and foreign Axiom marks out of holdings totals',async()=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'SI',venue:'PUMP_CURVE',quoteMint:'So11111111111111111111111111111111111111112',quoteSymbol:'SOL'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  if(request.type==='POSITION')return {ok:true,position:{wallet,mint,balanceRaw:'10',decimals:0,supplyRaw:'1000',updatedAt:Date.now()}};
  return {ok:true};
 };
 const pool={...target,site:'AXIOM' as const,kind:'POOL' as const,address:'pool-address'};
 const panel=mountPanel(pool,send,{container:body as unknown as HTMLElement});await flush();const shadow=body.children[0]!;
 panel.updateMarket({mint,priceUsd:'2',observedAt:Date.now(),source:'Axiom page'});expect(shadow.querySelector('.position-value').textContent).toBe('Unavailable');
 panel.updateMarket({mint:'wrong-mint',priceUsd:'3',observedAt:Date.now(),source:'Axiom page'});expect(shadow.querySelector('.position-value').textContent).toBe('Unavailable');panel.destroy();
});

it('replays an early confirmed receipt after token resolution and continues its pending fee audit',async()=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 let resolveToken!:(r:WorkerResponse)=>void;
 const receipt:Receipt={wallet,mint,venue:'PUMP_CURVE',side:'BUY',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',signature:'early-confirmed',feeReceipt:{state:'PENDING',checkedAt:Date.now(),note:'Checking transaction fees',protocolFees:[],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:false}};
 const send=vi.fn(async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return new Promise(resolve=>{resolveToken=resolve;});
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  if(request.type==='STATUS')return {ok:true,receipt};
  return {ok:true};
 });
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement});await flush();const shadow=body.children[0]!;
 expect(shadow.innerHTML).not.toContain('fee-receipt');
 expect(send.mock.calls.filter(([request])=>request.type==='STATUS')).toHaveLength(1);
 resolveToken({ok:true,token:{mint,symbol:'SI',venue:'PUMP_CURVE',quoteMint:'So11111111111111111111111111111111111111112',quoteSymbol:'SOL'}});await flush();
 expect(shadow.innerHTML).not.toContain('fee-receipt');expect(shadow.querySelector('.status-text').textContent).toBe('Buy confirmed.');
 await vi.advanceTimersByTimeAsync(3000);await flush();expect(send.mock.calls.filter(([request])=>request.type==='STATUS')).toHaveLength(2);panel.destroy();
});

for (const context of SITE_CONTEXTS) {
 it(`${context.site}: restores the wallet before metadata and retains the early matching market and receipt`,async()=>{
  vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
  let resolveToken!:(r:WorkerResponse)=>void;
  const receipt:Receipt={wallet,mint,venue:'PUMP_CURVE',side:'BUY',pageUrl:context.target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',signature:'early',feeReceipt:{state:'PENDING',checkedAt:Date.now(),note:'Checking transaction fees',protocolFees:[],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:false}};
  const send=vi.fn(async(request:WorkerRequest):Promise<WorkerResponse>=>{
   if(request.type==='TOKEN_INFO')return new Promise(resolve=>{resolveToken=resolve;});
   if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
   if(request.type==='STATUS')return {ok:true,receipt};
   if(request.type==='POSITION')return {ok:true,position:{wallet,mint,balanceRaw:'10',decimals:0,supplyRaw:'1000',updatedAt:Date.now()}};
   if(request.type==='PORTFOLIO')return {ok:true,portfolio:{wallet,updatedAt:Date.now(),holdings:[{mint,position:{wallet,mint,balanceRaw:'10',decimals:0,supplyRaw:'1000',updatedAt:Date.now(),market:{mint,priceUsd:'2',observedAt:Date.now(),source:context.source}}}]}};
   return {ok:true};
  });
  const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement});
  panel.updateMarket({mint,priceUsd:'2',observedAt:Date.now(),source:context.source});await flush();
  const shadow=body.children[0]!;expect(shadow.innerHTML).not.toContain('fee-receipt');
  resolveToken({ok:true,token:{mint,symbol:'SI'}});await flush();
  expect(shadow.querySelector('.position-value').textContent).toBe('$20.00');
  expect(shadow.querySelector('.status-text').textContent).toBe('Buy confirmed.');
  expect(shadow.innerHTML).not.toContain('fee-receipt');
  await vi.advanceTimersByTimeAsync(3000);expect(send.mock.calls.filter(([r])=>r.type==='STATUS')).toHaveLength(2);
  panel.destroy();
 });
 it(`${context.site}: invalidates delayed token, holdings and quotes on hint refresh while preserving the wallet lock`,async()=>{
  vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
  const tokens:((r:WorkerResponse)=>void)[]=[],positions:{request:Extract<WorkerRequest,{type:'POSITION'}>;resolve:(r:WorkerResponse)=>void}[]=[];
  const send=vi.fn(async(request:WorkerRequest):Promise<WorkerResponse>=>{
   if(request.type==='TOKEN_INFO')return new Promise(resolve=>tokens.push(resolve));
   if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
   if(request.type==='POSITION')return new Promise(resolve=>positions.push({request,resolve}));
   return {ok:true};
  });
  const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement});await flush();
  tokens[0]!({ok:true,token:{mint,symbol:'INITIAL'}});await flush();
  expect(body.children[0]!.querySelector('.token-ticker').textContent).toBe('$INITIAL');
  expect(body.children[0]!.querySelector('.token-address').textContent).toBe('DEW9dS…i98WDP');
  panel.updateMarket({mint,priceUsd:'2',observedAt:Date.now(),source:context.source});
  const oldPositions=[...positions];
  panel.showReceipt({wallet,mint:'other-token',venue:'PUMP_CURVE',side:'BUY',pageUrl:context.target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'SUBMITTED',signature:'pending'});
  const first={...context.target,poolHint:'first-pool'},latest={...context.target,poolHint:'latest-pool'};
  panel.updateContext(first);panel.updateContext(latest);await flush();
  expect(panel.isBusy()).toBe(true);expect(send.mock.calls.filter(([r])=>r.type==='WALLET_RESTORE')).toHaveLength(1);
  expect(send.mock.calls.filter(([r])=>r.type==='CONNECT')).toHaveLength(0);
  tokens[1]!({ok:true,token:{mint:'wrong-mint',symbol:'STALE'}});await flush();
  expect(body.children[0]!.querySelector('.token-ticker').textContent).not.toContain('STALE');
  tokens[2]!({ok:true,token:{mint,symbol:'LATEST'}});await flush();
  expect(body.children[0]!.querySelector('.token-ticker').textContent).toBe('$LATEST');
  for(const p of oldPositions)p.resolve({ok:true,position:{wallet,mint,balanceRaw:'999',decimals:0,supplyRaw:'1000',updatedAt:Date.now()}});
  await flush();expect(body.children[0]!.querySelector('.position').hidden).toBe(true);expect(panel.isBusy()).toBe(true);
  panel.showReceipt({wallet,mint:'other-token',venue:'PUMP_CURVE',side:'BUY',pageUrl:context.target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',signature:'pending'});
  expect(panel.isBusy()).toBe(false);expect(body.children[0]!.innerHTML).not.toContain('fee-receipt');
  panel.refreshPosition();await flush();expect(positions.at(-1)!.request.target).toEqual(latest);panel.destroy();
 });
}

for (const context of SITE_CONTEXTS) {
 it(`${context.site}: keeps the exact click target through async Phantom connection`,async()=>{
  vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
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
  vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
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
  expect(shadow.querySelector('.status-text').textContent).toContain('token context changed');panel.destroy();
 });
}


it.each(SITE_CONTEXTS)('$site: spins only for unresolved trade receipts and stops before ancillary fee updates',async(context)=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'SI'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  return {ok:true};
 };
 const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement});await flush();const shadow=body.children[0]!,status=shadow.querySelector('.status');
 const base:Receipt={wallet,mint,venue:'PUMP_CURVE',side:'BUY',pageUrl:context.target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'SIGNING'};
 expect(status.className.split(' ')).not.toContain('pending');
 for(const state of ['SIGNING','SUBMITTED','UNKNOWN'] as const){
  panel.showReceipt({...base,status:state,signature:state==='SUBMITTED'?'submitted':undefined});
  expect(status.className.split(' ')).toContain('pending');expect(panel.isBusy()).toBe(true);
 }
 for(const state of ['CONFIRMED','FAILED','EXPIRED'] as const){
  panel.showReceipt({...base,status:state,signature:'finished',feeReceipt:{state:'PENDING',checkedAt:Date.now(),note:'Updating fees',protocolFees:[],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:false}});
  expect(status.className.split(' ')).not.toContain('pending');expect(panel.isBusy()).toBe(false);
 }
 expect(shadow.querySelector('.status-text').textContent).toContain('expired');
 panel.showReceipt({...base,status:'FAILED',error:'Transaction failed.'});expect(shadow.querySelector('.status-text').textContent).toBe('Transaction failed.');
 panel.destroy();
});


it.each(SITE_CONTEXTS)('$site: copies only the resolved mint and keeps clipboard feedback out of trade status',async(context)=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const write=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('navigator',{clipboard:{writeText:write}});
 const send=async(r:WorkerRequest):Promise<WorkerResponse>=>r.type==='TOKEN_INFO'?{ok:true,token:{mint,symbol:'SI'}}:r.type==='WALLET_RESTORE'?{ok:true,wallet}:{ok:true};
 const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement});await flush();const s=body.children[0]!;
 panel.showReceipt({wallet,mint,venue:'PUMP_CURVE',side:'BUY',pageUrl:context.target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:0,status:'SIGNING'});
 const click=s.querySelector('.copy-address').events.get('click') as unknown as (e:{isTrusted:boolean})=>void;
 click({isTrusted:true});await flush();expect(write).toHaveBeenCalledWith(mint);expect(s.querySelector('.copy-feedback').textContent).toBe('Copied');expect(s.querySelector('.status').className).toContain('pending');
 await vi.advanceTimersByTimeAsync(1100);expect(s.querySelector('.copy-feedback').hidden).toBe(true);
 const tokenClick=s.querySelector('.token-link').events.get('click') as unknown as (e:{isTrusted:boolean})=>void;
 tokenClick({isTrusted:true});await flush();expect(write).toHaveBeenCalledTimes(2);expect(s.querySelector('.token-link').attributes.has('href')).toBe(false);
 write.mockRejectedValueOnce(Error('denied'));click({isTrusted:true});await flush();expect(s.querySelector('.copy-feedback').textContent).toBe('Copy failed');expect(s.querySelector('.status').className).toContain('pending');
 panel.destroy();
});
it.each(SITE_CONTEXTS)('$site: invalid custom amount stays local without wallet or trade requests',async(context)=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const send=vi.fn(async(r:WorkerRequest):Promise<WorkerResponse>=>r.type==='TOKEN_INFO'?{ok:true,token:{mint,symbol:'SI'}}:{ok:true});
 const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement});await flush();const s=body.children[0]!;
 for(const value of ['','0','1.0000000001']){s.querySelector('input').value=value;(s.querySelector('.custom-buy').events.get('click') as unknown as (e:{isTrusted:boolean})=>void)({isTrusted:true});await flush();expect(s.querySelector('.amount-error').hidden).toBe(false);}
 expect(send.mock.calls.some(([r])=>r.type==='CONNECT'||r.type==='TRADE')).toBe(false);panel.destroy();
});
it('rejects a delayed portfolio from the old wallet without replacing the new wallet holdings',async()=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 let account=wallet,oldPortfolio!:(r:WorkerResponse)=>void;
 const send=async(r:WorkerRequest):Promise<WorkerResponse>=>{
  if(r.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'SI'}};
  if(r.type==='WALLET_RESTORE')return {ok:true,wallet:account};
  if(r.type==='PORTFOLIO'){if(r.wallet===wallet)return new Promise(resolve=>{oldPortfolio=resolve;});return {ok:true,portfolio:{wallet:r.wallet,updatedAt:Date.now(),holdings:[{mint,symbol:'NEW',position:{wallet:r.wallet,mint,balanceRaw:'20',decimals:0,supplyRaw:'1000',updatedAt:Date.now()}}]}};}
  return {ok:true};
 };
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement});await flush();account='new-wallet';await vi.advanceTimersByTimeAsync(3000);await flush();
 oldPortfolio({ok:true,portfolio:{wallet,updatedAt:Date.now(),holdings:[{mint,symbol:'OLD',position:{wallet,mint,balanceRaw:'99',decimals:0,supplyRaw:'1000',updatedAt:Date.now()}}]}});await flush();
 const list=body.children[0]!.querySelector('.holdings-list');expect(list.children[0]!.children[0]!.children[0]!.textContent).toBe('$NEW');panel.destroy();
});
it('refreshes the open holdings list automatically every five seconds without a manual click',async()=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const send=vi.fn(async(r:WorkerRequest):Promise<WorkerResponse>=>r.type==='TOKEN_INFO'?{ok:true,token:{mint,symbol:'SI'}}:r.type==='WALLET_RESTORE'?{ok:true,wallet}:r.type==='PORTFOLIO'?{ok:true,portfolio:{wallet,updatedAt:Date.now(),holdings:[]}}:{ok:true});
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement});await flush();body.children[0]!.querySelector('.holdings').open=true;
 const calls=()=>send.mock.calls.filter(([request])=>request.type==='PORTFOLIO').length;
 const initial=calls();await vi.advanceTimersByTimeAsync(5000);expect(calls()).toBe(initial+1);
 (document as unknown as {hidden:boolean}).hidden=true;await vi.advanceTimersByTimeAsync(5000);expect(calls()).toBe(initial+1);panel.destroy();
});
it('keeps a fresh pushed net PnL when the site mark arrives without forcing another quote',async()=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const base:PositionSnapshot={wallet,mint,balanceRaw:'100',decimals:0,supplyRaw:'1000',updatedAt:Date.now(),costBasisUsdMicros:'100000000',expectedExitLamports:'1000000000',solUsd:{priceMicros:'100000000',capturedAt:Date.now(),source:'Coinbase spot'}};
 const send=vi.fn(async(r:WorkerRequest):Promise<WorkerResponse>=>r.type==='TOKEN_INFO'?{ok:true,token:{mint,symbol:'SI'}}:r.type==='WALLET_RESTORE'?{ok:true,wallet}:r.type==='POSITION'?{ok:true,position:base}:r.type==='PORTFOLIO'?{ok:true,portfolio:{wallet,updatedAt:Date.now(),holdings:[{mint,position:base}]}}:r.type==='PORTFOLIO_PRICES'?{ok:true,portfolio:{wallet,updatedAt:Date.now(),holdings:[{mint,position:{...base,updatedAt:Date.now(),expectedExitLamports:'2000000000'},priceMode:'LIVE',priceUpdatedAt:Date.now()}]}}:{ok:true});
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement});await flush();vi.setSystemTime(Date.now()+1000);panel.refreshPortfolio(wallet);await flush();
 const quotes=send.mock.calls.filter(([r])=>r.type==='POSITION'&&!r.holdingsOnly).length;
 panel.updateMarket({mint,priceUsd:'1.8',observedAt:Date.now(),source:'GMGN page'});await flush();
 expect(body.children[0]!.querySelector('.position-pnl').textContent).toContain('+$100.00');expect(body.children[0]!.querySelector('.position-value').textContent).toBe('$200.00');
 expect(send.mock.calls.filter(([r])=>r.type==='POSITION'&&!r.holdingsOnly)).toHaveLength(quotes);panel.destroy();
});

it.each(SITE_CONTEXTS)('$site: relays confirmed entry, clears missing basis and ignores delayed context snapshots',async(context)=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const chartEntry=vi.fn();let includeEntry=true,delayed=false;const queued:((r:WorkerResponse)=>void)[]=[];
 const entry=()=>({mint,wallet,priceUsd:'1',marketCapUsd:'1000',balanceRaw:'100',supplyRaw:'1000',decimals:0,updatedAt:Date.now()});
 const snapshot=():PositionSnapshot=>({wallet,mint,balanceRaw:'100',supplyRaw:'1000',decimals:0,updatedAt:Date.now(),chartEntry:includeEntry?entry():undefined});
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'TEST'}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  if(request.type==='POSITION')return delayed?new Promise(resolve=>queued.push(resolve)):{ok:true,position:snapshot()};
  return {ok:true};
 };
 const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement,chartEntry});await flush();expect(chartEntry).toHaveBeenLastCalledWith(entry());
 includeEntry=false;panel.refreshPosition(true);await flush();expect(chartEntry).toHaveBeenLastCalledWith(undefined);
 includeEntry=true;panel.refreshPosition(true);await flush();expect(chartEntry).toHaveBeenLastCalledWith(entry());
 panel.showReceipt({wallet,mint:'another-mint',venue:'PUMP_CURVE',side:'BUY',pageUrl:context.target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'UNKNOWN'});expect(chartEntry).toHaveBeenLastCalledWith(undefined);
 panel.showReceipt({wallet,mint:'another-mint',venue:'PUMP_CURVE',side:'BUY',pageUrl:context.target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'FAILED'});
 delayed=true;panel.refreshPosition(true);await flush();const oldRequests=queued.splice(0);panel.updateContext({...context.target,poolHint:'new-context'});await flush();
 for(const resolve of oldRequests)resolve({ok:true,position:snapshot()});await flush();expect(chartEntry).toHaveBeenLastCalledWith(undefined);
 panel.destroy();expect(chartEntry).toHaveBeenLastCalledWith(undefined);
});

it('expires entry evidence instead of refreshing its timestamp when holdings become unavailable',async()=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const chartEntry=vi.fn(),updatedAt=Date.now();let unavailable=false;
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint}};
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  if(request.type==='POSITION')return unavailable?{ok:false,error:'RPC unavailable'}:{ok:true,position:{wallet,mint,balanceRaw:'100',supplyRaw:'1000',decimals:0,updatedAt,chartEntry:{mint,wallet,balanceRaw:'100',supplyRaw:'1000',decimals:0,updatedAt,priceUsd:'1',marketCapUsd:'1000'}}};
  return {ok:true};
 };
 const panel=mountPanel(target,send,{container:body as unknown as HTMLElement,chartEntry});await flush();expect(chartEntry.mock.lastCall?.[0]?.updatedAt).toBe(updatedAt);unavailable=true;
 await vi.advanceTimersByTimeAsync(31_000);expect(chartEntry).toHaveBeenLastCalledWith(undefined);panel.destroy();
});

it.each(SITE_CONTEXTS)('$site: keeps a bounded entry through 429 and reports expiry without renewing evidence',async(context)=>{
 vi.useFakeTimers();vi.setSystemTime(100_000);const body=new Element();vi.stubGlobal('document',{body,documentElement:body,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 const chartEntry=vi.fn(),entry={wallet,mint,balanceRaw:'100',supplyRaw:'1000',decimals:0,priceUsd:'1',marketCapUsd:'1000',updatedAt:100_000,validUntil:130_000};let limited=false;
 const snapshot=():PositionSnapshot=>({wallet,mint,balanceRaw:'100',supplyRaw:'1000',decimals:0,updatedAt:Date.now(),chartEntry:entry,chartEntryNote:limited?'Avg entry verification delayed: RPC rate limit (429). Last verified value shown.':undefined,costBasisUsdMicros:'100000000',costBasisSolLamports:'1000000000',expectedExitLamports:'2000000000',exitNetworkLamports:'0',exitSetupLamports:'0',solUsd:{priceMicros:'100000000',capturedAt:Date.now(),source:'Coinbase spot'}});
 const send=async(request:WorkerRequest):Promise<WorkerResponse>=>request.type==='TOKEN_INFO'?{ok:true,token:{mint,symbol:'TEST'}}:request.type==='WALLET_RESTORE'?{ok:true,wallet}:request.type==='POSITION'?{ok:true,position:snapshot()}:{ok:true};
 const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement,chartEntry});await flush();expect(chartEntry).toHaveBeenLastCalledWith(entry);
 vi.setSystemTime(115_000);limited=true;panel.refreshPosition(true);await flush();expect(chartEntry.mock.lastCall?.[0]?.updatedAt).toBe(100_000);
 const root=body.children[0]!;expect(root.querySelector('.position-source').textContent).toContain('429');expect(root.querySelector('.position-source').hidden).toBe(false);
 await vi.advanceTimersByTimeAsync(15_000);expect(chartEntry).toHaveBeenLastCalledWith(undefined);expect(root.querySelector('.position-source').textContent).toContain('expired');
 expect(root.querySelector('.position-source').textContent).not.toContain('Last verified value shown');panel.destroy();
});


it('shows retry at exactly 15s of balance delay even while price timestamps advance',()=>{
 vi.useFakeTimers();vi.setSystemTime(100_000);const body=new Element();
 vi.stubGlobal('document',{hidden:false,createElement:()=>new Element()});
 const view=createPanelView(body as unknown as HTMLElement),root=body.children[0]!;root.querySelector('.holdings').open=true;
 const snapshot:PortfolioSnapshot={wallet,updatedAt:Date.now(),holdings:[{mint,position:{wallet,mint,balanceRaw:'10',decimals:0,supplyRaw:'1000',updatedAt:Date.now()}}]};
 view.renderPortfolio(snapshot);expect(root.querySelector('.holdings-refresh').hidden).toBe(true);
 vi.setSystemTime(114_999);view.updateHoldingTimes();expect(root.querySelector('.holdings-refresh').hidden).toBe(true);
 vi.setSystemTime(115_000);view.renderPortfolio({...snapshot,holdings:snapshot.holdings.map(row=>({...row,priceUpdatedAt:Date.now(),position:{...row.position!,updatedAt:Date.now()}}))});
 expect(root.querySelector('.holdings-refresh').hidden).toBe(false);
 expect(root.querySelector('.holdings-note').textContent).toContain('15s since last balance update');
 view.renderPortfolio({...snapshot,updatedAt:Date.now()});expect(root.querySelector('.holdings-refresh').hidden).toBe(true);
});

it('gives reopened or newly visible Holdings a fresh 15s monitoring window',()=>{
 vi.useFakeTimers();vi.setSystemTime(100_000);const body=new Element(),doc={hidden:false,createElement:()=>new Element()};vi.stubGlobal('document',doc);
 const view=createPanelView(body as unknown as HTMLElement),root=body.children[0]!,holdings=root.querySelector('.holdings');holdings.open=true;
 view.renderPortfolio({wallet,updatedAt:Date.now(),holdings:[]});
 holdings.open=false;view.updatePortfolioStatus();vi.setSystemTime(160_000);holdings.open=true;view.updatePortfolioStatus();
 expect(root.querySelector('.holdings-refresh').hidden).toBe(true);
 vi.setSystemTime(175_000);view.updateHoldingTimes();expect(root.querySelector('.holdings-refresh').hidden).toBe(false);
 doc.hidden=true;view.updatePortfolioStatus();expect(root.querySelector('.holdings-refresh').hidden).toBe(true);
 vi.setSystemTime(200_000);doc.hidden=false;view.updatePortfolioStatus();expect(root.querySelector('.holdings-refresh').hidden).toBe(true);
 vi.setSystemTime(215_000);view.updateHoldingTimes();expect(root.querySelector('.holdings-refresh').hidden).toBe(false);
});

it('shows failures immediately, keeps them through price pushes and ignores intentional per-token balance caching',()=>{
 vi.useFakeTimers();vi.setSystemTime(100_000);const body=new Element();vi.stubGlobal('document',{hidden:false,createElement:()=>new Element()});
 const view=createPanelView(body as unknown as HTMLElement),root=body.children[0]!;root.querySelector('.holdings').open=true;
 const snapshot:PortfolioSnapshot={wallet,updatedAt:Date.now(),holdings:[{mint,position:{wallet,mint,balanceRaw:'10',decimals:0,supplyRaw:'1000',updatedAt:Date.now(),balanceUpdatedAt:Date.now()-60_000}}]};
 view.renderPortfolio(snapshot);expect(root.querySelector('.holdings-refresh').hidden).toBe(true);
 view.renderPortfolioError('RPC unavailable');expect(root.querySelector('.holdings-refresh').hidden).toBe(false);
 view.renderPortfolio(snapshot);expect(root.querySelector('.holdings-note').textContent).toContain('RPC unavailable');
 view.renderPortfolioError();view.renderPortfolio({...snapshot,updatedAt:Date.now()});expect(root.querySelector('.holdings-refresh').hidden).toBe(true);
 view.renderPortfolio({...snapshot,holdings:[{mint,error:'Token balance failed'}]});expect(root.querySelector('.holdings-refresh').hidden).toBe(false);
 expect(root.querySelector('.holdings-note').textContent).toContain('Token balance failed');
});

it.each(SITE_CONTEXTS)('$site: offers retry immediately after a holdings request failure and hides it after recovery',async(context)=>{
 vi.useFakeTimers();const body=new Element();vi.stubGlobal('document',{body,documentElement:body,hidden:false,createElement:()=>new Element()});vi.stubGlobal('window',{setInterval,clearInterval,setTimeout,clearTimeout});
 let fail=true;
 const send=vi.fn(async(request:WorkerRequest):Promise<WorkerResponse>=>{
  if(request.type==='WALLET_RESTORE')return {ok:true,wallet};
  if(request.type==='TOKEN_INFO')return {ok:true,token:{mint,symbol:'TEST'}};
  if(request.type==='PORTFOLIO')return fail?{ok:false,error:'RPC unavailable'}:{ok:true,portfolio:{wallet,updatedAt:Date.now(),holdings:[]}};
  return {ok:true};
 });
 const panel=mountPanel(context.target,send,{container:body as unknown as HTMLElement});const root=body.children[0]!;root.querySelector('.holdings').open=true;await flush();
 const retry=root.querySelector('.holdings-refresh');expect(retry.hidden).toBe(false);expect(root.querySelector('.holdings-note').textContent).toContain('RPC unavailable');
 fail=false;(retry.events.get('click') as unknown as (event:{isTrusted:boolean})=>void)({isTrusted:true});await flush();
 expect(send.mock.calls.some(([request])=>request.type==='PORTFOLIO'&&request.refresh===true)).toBe(true);
 expect(retry.hidden).toBe(true);panel.destroy();
});
