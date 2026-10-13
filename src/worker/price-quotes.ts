import {PublicKey} from '@solana/web3.js';
import type {PageTarget,PositionSnapshot,Settings} from '../model';
import {targetKey} from '../sites/catalog';
import {quotePosition} from '../position';
import {quoteIssue} from '../quote-issue';
import {currentSolUsd,solUsdRetryAt} from '../usd-price';
import {logEvent} from '../diagnostics';
import {createPriceScheduler} from './price-scheduler';
import {createPriceRpc} from './price-rpc';

type Deferred={promise:Promise<PositionSnapshot>;resolve:(value:PositionSnapshot)=>void;reject:(reason:unknown)=>void};
type Entry={wallet:string;endpoint:string;result?:PositionSnapshot;pending?:Deferred;running:boolean;slot:number;requiredSlot:number;completedSlot:number;failures:number;retryAt:number;at:number;touched:number};
export function priceQuoteKey(settings:Settings,target:PageTarget,base:PositionSnapshot){
 return JSON.stringify([base.wallet,targetKey(target),base.mint,base.balanceRaw,base.decimals,base.supplyRaw,settings.rpcUrl,settings.priorityFeeLamports,settings.slippageBps,settings.jupiterApiKey]);
}
const defer=():Deferred=>{let resolve!:Deferred['resolve'],reject!:Deferred['reject'];const promise=new Promise<PositionSnapshot>((yes,no)=>{resolve=yes;reject=no;});void promise.catch(()=>{});return {promise,resolve,reject};};

/** Only price fields cross callers; their confirmed balances, basis and lifetimes stay owned. */
export function mergePrice(base:PositionSnapshot,price:PositionSnapshot):PositionSnapshot{
 return {...base,updatedAt:price.updatedAt,expectedExitLamports:price.expectedExitLamports,exitNetworkLamports:price.exitNetworkLamports,exitSetupLamports:price.exitSetupLamports,pricePool:price.pricePool,
  market:price.market,solUsd:currentSolUsd()??price.solUsd,quoteIssue:price.quoteIssue,usdIssue:price.usdIssue,warning:base.warning};
}
export function withCurrentUsd(price:PositionSnapshot):PositionSnapshot{
 const solUsd=currentSolUsd()??(price.solUsd&&Date.now()-price.solUsd.capturedAt<30_000?price.solUsd:undefined);
 return {...price,solUsd,usdIssue:price.expectedExitLamports!==undefined&&!solUsd?{kind:'USD',message:'SOL/USD price unavailable; the SOL sell estimate is current.',retryable:true,retryAt:solUsdRetryAt()||undefined}:undefined};
}

export function createPriceQuotes(onResult:(key:string,price:PositionSnapshot)=>void=()=>{}){
 const entries=new Map<string,Entry>(),scheduler=createPriceScheduler(),transport=createPriceRpc();
 function request(settings:Settings,target:PageTarget,base:PositionSnapshot,options:{refresh?:boolean;slot?:number;quoteReady?:boolean;blocked:()=>Promise<boolean>}):Promise<PositionSnapshot>{
  const key=priceQuoteKey(settings,target,base),slot=options.slot??0;
  let entry=entries.get(key);
  if(!entry){entry={wallet:base.wallet,endpoint:settings.rpcUrl,running:false,slot:0,requiredSlot:0,completedSlot:0,failures:0,retryAt:0,at:0,touched:Date.now()};entries.set(key,entry);}
  const owned=entry;owned.touched=Date.now();owned.requiredSlot=Math.max(owned.requiredSlot,slot);
  const project=(price:PositionSnapshot)=>mergePrice(base,withCurrentUsd(price));
  if(owned.result&&(Date.now()<owned.retryAt||!options.refresh&&owned.requiredSlot<=owned.completedSlot&&Date.now()-owned.at<3000)&&!owned.pending)return Promise.resolve(project(owned.result));
  const task=async(minSlot:number,signal:AbortSignal)=>{
   if(entries.get(key)!==owned)return;
   const pending=owned.pending??defer();owned.pending=pending;owned.running=true;minSlot=Math.max(minSlot,owned.requiredSlot);owned.slot=minSlot;
   const started=Date.now(),abort=new AbortController(),cancel=()=>abort.abort();signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
   const timer=setTimeout(cancel,12_000);
   try{
    if(owned.result&&Date.now()<owned.retryAt){pending.resolve(withCurrentUsd(owned.result));return;}
    const initiallyBlocked=await options.blocked();
    if(signal.aborted||abort.signal.aborted||entries.get(key)!==owned)throw new Error('Price read cancelled.');
    if(initiallyBlocked)throw new Error('Position updates resume after the active trade.');
    const rpc=transport.connection(settings.rpcUrl,minSlot,abort.signal);
    // USD conversion is a separate shared job and never occupies a quote slot.
    const read=quotePosition(rpc,target,new PublicKey(base.wallet),settings,base,options.quoteReady,undefined,{signal:abort.signal,skipUsd:true});
    const interrupted=new Promise<never>((_resolve,reject)=>{abort.signal.addEventListener('abort',()=>reject(abort.signal.reason),{once:true});});
    const priced=await Promise.race([read,interrupted]);
    if(abort.signal.aborted)throw abort.signal.reason;
    const blocked=await options.blocked();
    if(abort.signal.aborted||entries.get(key)!==owned||blocked)throw new Error('Position changed during the quote. Read again.');
    const issue=priced.quoteIssue??(priced.expectedExitLamports===undefined?quoteIssue(new Error(priced.warning??'Exit route unavailable.')):undefined);
    if(issue){
     owned.failures++;
     owned.retryAt=issue.retryable?Math.max(issue.retryAt??0,Date.now()+Math.min(15_000,1000*2**Math.min(owned.failures-1,4))*(0.8+Math.random()*0.4)):Infinity;
     owned.result={...(owned.result??priced),quoteIssue:{...issue,retryAt:Number.isFinite(owned.retryAt)?owned.retryAt:undefined}};
    }else{owned.failures=0;owned.retryAt=0;owned.at=Date.now();owned.completedSlot=minSlot;owned.result={...priced,quoteIssue:undefined};}
    const result=withCurrentUsd(owned.result);pending.resolve(result);onResult(key,result);
    logEvent({level:issue?'warn':'debug',component:'prices',type:issue?'quote.failed':'quote.completed',duration:Date.now()-started,code:issue?.kind,details:{mint:base.mint,slot:minSlot,error:issue?.message,retry:issue?.retryAt}});
   }catch(error){
    if(signal.aborted||entries.get(key)!==owned){pending.reject(error);return;}
    const issue=quoteIssue(error);owned.failures++;owned.retryAt=issue.retryable?Math.max(issue.retryAt??0,Date.now()+Math.min(15_000,1000*2**Math.min(owned.failures-1,4))*(0.8+Math.random()*0.4)):Infinity;
    owned.result={...(owned.result??{...base,expectedExitLamports:undefined,solUsd:undefined}),quoteIssue:{...issue,retryAt:Number.isFinite(owned.retryAt)?owned.retryAt:undefined}};
    const result=withCurrentUsd(owned.result);pending.resolve(result);onResult(key,result);
    logEvent({level:'warn',component:'prices',type:'quote.failed',duration:Date.now()-started,code:issue.kind,details:{mint:base.mint,error:issue.message}});
   }finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);owned.running=false;if(owned.pending===pending)owned.pending=undefined;}
  };
  if(owned.pending)logEvent({level:'debug',component:'prices',type:'quote.shared',details:{mint:base.mint,slot}});
  if(!owned.pending){owned.pending=defer();scheduler.enqueue(key,task,slot,Math.max(owned.retryAt,transport.cooldown(settings.rpcUrl)));}
  else if(owned.running&&slot&&(slot>owned.slot||options.refresh&&slot===owned.slot))scheduler.enqueue(key,task,slot,Math.max(owned.retryAt,transport.cooldown(settings.rpcUrl)));
  else if(!owned.running&&slot)scheduler.enqueue(key,task,slot,Math.max(owned.retryAt,transport.cooldown(settings.rpcUrl)));
  for(const [cached,value]of entries)if(cached!==key&&!value.pending&&Number.isFinite(value.retryAt)&&Date.now()-value.touched>60_000)entries.delete(cached);
  return owned.pending.promise.then(project);
 }
 function cancel(matches:(key:string,entry:Entry)=>boolean){for(const [key,entry]of entries)if(matches(key,entry)){entries.delete(key);entry.pending?.reject(new Error('Price read cancelled.'));scheduler.cancel(value=>value===key);}}
 return {request,cancelWallet:(wallet:string)=>cancel((_key,entry)=>entry.wallet===wallet),cancelKey:(key:string)=>cancel(value=>value===key),retryAt:(key:string)=>{const entry=entries.get(key);if(entry)entry.touched=Date.now();return entry?.retryAt??0;},
  connection:transport.connection,invalidate:(endpoint:string)=>transport.invalidate(endpoint)};
}
