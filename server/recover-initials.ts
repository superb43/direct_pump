import {sanitizeDiagnostic} from '../src/diagnostics/diagnostics';
import {validateProSpecV2,type ProSpecV2} from '../src/pro/contracts';
import type {ProRecoverInitialsPreview} from '../src/pro/portfolio-contracts';
import type {ProEngine} from './engine';
import {readProPortfolio} from './pro-portfolio';
/** Read-only quantity discovery. Actual submission always uses the ordinary order/signer path. */
export async function previewRecoverInitials(engine:ProEngine,input:unknown):Promise<ProRecoverInitialsPreview>{
 const spec=validateProSpecV2(input,engine.clock());
 if(spec.kind!=='MARKET'||spec.side!=='SELL'||spec.exitStrategy)throw Error('Market sell required for original-capital recovery.');
 const unavailable=(reason:string,target='0'):ProRecoverInitialsPreview=>({status:'UNAVAILABLE',targetLamports:target,reason,quoteAt:engine.clock()});
 const deadline=Date.now()+12000;
 const bounded=async<T>(work:()=>Promise<T>):Promise<T>=>{const remaining=deadline-Date.now();if(remaining<=0)throw Error('Recovery quote timed out.');let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work(),new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(Error('Recovery quote timed out.')),remaining);})]);}finally{if(timer)clearTimeout(timer);}};
 let goal=0n;
 try{
  if(engine.store.locked(engine.wallet))return unavailable('Wallet has an unresolved execution.');
  const portfolio=await bounded(()=>readProPortfolio(engine,spec.mint)),row=portfolio.rows.find(r=>r.mint===spec.mint);
  if(!row||row.status!=='READY'||row.unrecoveredLamports===undefined)return unavailable(row?.reason??'Verified position history unavailable.');
  goal=BigInt(row.unrecoveredLamports);
  if(goal===0n)return {status:'RECOVERED',targetLamports:'0',quoteAt:engine.clock()};
  if(row.decimals!==spec.decimals)return unavailable('Token decimals changed.',String(goal));
  const balances=await bounded(()=>engine.market.balances(spec.mint)),total=balances[spec.mint];if(total===undefined||String(total)!==row.totalRaw)return unavailable('Token balance changed.',String(goal));
  const reserved=engine.store.reserved(spec.mint),available=total>reserved?total-reserved:0n;
  if(available===0n)return {status:'INSUFFICIENT',targetLamports:String(goal),expectedNetLamports:'0',shortfallLamports:String(goal),reason:'No unreserved tokens available. Cancel reservations separately if intended.',quoteAt:engine.clock()};
  const budget=BigInt(spec.maxNetworkLamports);
  if((balances['So11111111111111111111111111111111111111112']??0n)-engine.store.reserved('So11111111111111111111111111111111111111112')<budget)return unavailable('Insufficient unreserved SOL for network cost budget.',String(goal));
  const quote=async(amount:bigint)=>{const candidate:ProSpecV2={...spec,amountRaw:String(amount)};const result=await bounded(()=>engine.preview(candidate));const net=BigInt(result.summary.outputRaw)-budget;return {spec:result.spec as ProSpecV2,net:net>0n?net:0n,at:result.summary.quoteAt??engine.clock()};};
  const full=await quote(available);
  if(full.net<goal)return {status:'INSUFFICIENT',targetLamports:String(goal),expectedNetLamports:String(full.net),shortfallLamports:String(goal-full.net),reason:'Available tokens cannot recover the target after the full network budget. All-token selling is a separate choice.',quoteAt:full.at};
  let upper=available,lower=0n,best=full;
  let candidate=(available*goal+full.net-1n)/full.net;
  if(candidate>=upper)candidate=upper/2n;
  for(let i=0;i<12&&upper-lower>1n;i++){
   if(candidate<=lower||candidate>=upper)candidate=(upper+lower)/2n;
   const result=await quote(candidate);
   if(result.net>=goal){upper=candidate;best=result;}else lower=candidate;
   candidate=(upper+lower)/2n;
  }
  // Recheck both reservation and inventory after asynchronous history and quotes.
  const latest=await bounded(()=>engine.market.balances(spec.mint)),latestTotal=latest[spec.mint]??0n,latestReserved=engine.store.reserved(spec.mint);
  if(latestTotal!==total||latestReserved!==reserved||engine.store.locked(engine.wallet)||upper>latestTotal-latestReserved)return unavailable('Balance, reservations or wallet execution changed. Refresh before submitting.',String(goal));
  if(engine.clock()-best.at>2000)return unavailable('Recovery quote is stale. Refresh before submitting.',String(goal));
  return {status:'READY',spec:best.spec,targetLamports:String(goal),expectedNetLamports:String(best.net),reason:'Quote-based recovery; the full network cost budget is deducted. Price changes may leave an unrecovered remainder.',quoteAt:best.at};
 }catch(error){return unavailable(error instanceof Error?String(sanitizeDiagnostic(error.message)).slice(0,512):'Recovery preview unavailable.',String(goal));}
}
