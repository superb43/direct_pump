import {sanitizeDiagnostic} from '../src/diagnostics/diagnostics';
import {PublicKey,VersionedTransaction,type Connection} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,unpackAccount,unpackMint} from '@solana/spl-token';
import bs58 from 'bs58';
import {analyzeFeeFacts} from '../src/fee-receipt';
import {instructionManifest} from '../src/manifest';
import {accountPosition,type PositionFill} from '../src/pro/position-accounting';
import {isProPortfolioTarget,type ProPortfolio,type ProPortfolioRow} from '../src/pro/portfolio-contracts';
import type {ProEngine} from './engine';
import type {ProSpec} from '../src/pro/contracts';
const finalized=new WeakMap<ProEngine,Map<string,PositionFill>>();
const pending=new WeakMap<ProEngine,Map<string,Promise<ProPortfolio>>>();
export function portfolioConnection(engine:ProEngine):Connection|undefined{return (engine.market as (typeof engine.market&{connection?:Connection})|undefined)?.connection;}
export function readProPortfolio(engine:ProEngine,mint?:string):Promise<ProPortfolio>{
 if(mint)new PublicKey(mint);
 let jobs=pending.get(engine);if(!jobs){jobs=new Map();pending.set(engine,jobs);}
 const key=mint??'',prior=jobs.get(key);if(prior)return prior;
 const work=read(engine,mint).finally(()=>jobs!.delete(key));jobs.set(key,work);return work;
}
async function read(engine:ProEngine,current?:string):Promise<ProPortfolio>{
 const connection=portfolioConnection(engine),result:ProPortfolio={wallet:engine.wallet,updatedAt:Date.now(),rows:[],partial:false};
 if(!connection)return {...result,partial:true};
 const deadline=Date.now()+8000;
 let historicalReads=0;
 const bounded=async<T>(work:()=>Promise<T>):Promise<T>=>{const remaining=deadline-Date.now();if(remaining<=0)throw Error('Portfolio read timed out.');let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work(),new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(Error('Portfolio read timed out.')),remaining);})]);}finally{if(timer)clearTimeout(timer);}};
 const orders=engine.store.orders().filter(o=>o.wallet===engine.wallet),byId=new Map(orders.map(o=>[o.id,o]));
 const mints=[...new Set([...(current?[current]:[]),...orders.map(o=>o.spec.mint)])];
 let cache=finalized.get(engine);if(!cache){cache=new Map();finalized.set(engine,cache);}
 for(const mint of mints.slice(0,512)){
  let row:ProPortfolioRow|undefined;
  try{
   const key=new PublicKey(mint),wallet=new PublicKey(engine.wallet),info=await bounded(()=>connection.getAccountInfo(key,'confirmed'));
   if(!info)throw Error('Token metadata unavailable.');
   const metadata=unpackMint(key,info,info.owner),ata=getAssociatedTokenAddressSync(key,wallet,false,info.owner),account=await bounded(()=>connection.getAccountInfoAndContext(ata,{commitment:'confirmed'}));
   const token=account.value?unpackAccount(ata,account.value,info.owner):undefined;
   if(token&&(!token.owner.equals(wallet)||!token.mint.equals(key)))throw Error('Token ownership mismatch.');
   const total=token?.amount??0n,reserved=engine.store.reserved(mint),available=total>reserved?total-reserved:0n;
   const spec=[...orders].reverse().find(o=>o.spec.mint===mint)?.spec;
   const target=spec?.target?.kind==='POOL'?{...spec.target,mintHint:mint}:spec?.target;
   row={mint,...(target&&isProPortfolioTarget(target,mint)?{target}:{}),decimals:metadata.decimals,totalRaw:String(total),reservedRaw:String(reserved),availableRaw:String(available),status:'UNAVAILABLE'};result.rows.push(row);
   const fills:PositionFill[]=[],seen=new Map<string,string>();
   for(const attempt of engine.store.attempts().filter(a=>byId.get(a.orderId)?.spec.mint===mint)){
    if(attempt.state==='AUTHORIZED'&&!attempt.signature&&!attempt.signedTransaction||attempt.state==='EXPIRED'||attempt.state==='FAILED'&&!attempt.signature&&!attempt.signedTransaction)continue;
    if(!attempt.signature||!attempt.signedTransaction||!['CONFIRMED','FINALIZED','FAILED'].includes(attempt.state))throw Error('Journal transaction is unresolved.');
    const order=byId.get(attempt.orderId)!,signature=attempt.signature;
    const cacheKey=JSON.stringify([signature,attempt.signedTransaction,order.spec.side,attempt.inputRaw??order.spec.amountRaw]);
    if(seen.has(signature)){if(seen.get(signature)!==cacheKey)throw Error('Conflicting duplicate journal signature.');continue;}seen.set(signature,cacheKey);
    const cached=['FINALIZED','FAILED'].includes(attempt.state)?cache.get(cacheKey):undefined;if(cached){fills.push(cached);continue;}
    if(historicalReads>=32)throw Error('History reconstruction is in progress. Refresh to continue.');historicalReads++;
    const commitment=['FINALIZED','FAILED'].includes(attempt.state)?'finalized':'confirmed';
    const [tx,parsed]=await bounded(()=>Promise.all([connection.getTransaction(signature,{commitment,maxSupportedTransactionVersion:0}),connection.getParsedTransaction(signature,{commitment,maxSupportedTransactionVersion:0})]));
    if(!tx?.meta||!parsed?.meta||!tx.blockTime)throw Error('Confirmed metadata unavailable.');
    const signed=VersionedTransaction.deserialize(Buffer.from(attempt.signedTransaction,'base64'));
    if(bs58.encode(signed.signatures[0]!)!==signature||!Buffer.from(signed.message.serialize()).equals(Buffer.from(tx.transaction.message.serialize())))throw Error('Signed transaction does not match chain.');
    const facts=analyzeFeeFacts({wallet:engine.wallet,mint,side:order.spec.side,venue:'JUPITER',pageUrl:'',message:'',blockhash:attempt.blockhash??'',lastValidBlockHeight:attempt.lastValidBlockHeight??0,createdAt:attempt.createdAt,status:'CONFIRMED',signature,inputAmount:attempt.inputRaw??order.spec.amountRaw,feeManifest:instructionManifest(signed.message,{accountKeysFromLookups:tx.meta.loadedAddresses??{writable:[],readonly:[]}})},tx,parsed);
    if(facts.state!=='VERIFIED'||!facts.zeroExtraFeesVerified||facts.totalNetworkLamports===undefined)throw Error('Transaction accounting is unverified.');
    const failed=facts.executionSucceeded===false;
    if(attempt.state==='FAILED'&&!failed)throw Error('Failed journal transaction disagrees with chain.');
    if(!failed&&(facts.volumeLamports===undefined||facts.rentDepositedLamports===undefined||facts.rentRefundedLamports===undefined||facts.tokenBeforeRaw===undefined||facts.tokenAfterRaw===undefined))throw Error('Settled accounting facts unavailable.');
    const costs=BigInt(facts.totalNetworkLamports)+BigInt(facts.rentDepositedLamports??'0')-BigInt(facts.rentRefundedLamports??'0');
    const net=failed?BigInt(facts.totalNetworkLamports):order.spec.side==='BUY'?BigInt(facts.volumeLamports!)+costs:BigInt(facts.volumeLamports!)-costs;
    const fill:PositionFill={side:order.spec.side,beforeRaw:facts.tokenBeforeRaw,afterRaw:facts.tokenAfterRaw,netLamports:String(net),failed,slot:tx.slot,at:tx.blockTime*1000,signature};fills.push(fill);
    if(['FINALIZED','FAILED'].includes(attempt.state)){cache.set(cacheKey,fill);if(cache.size>10000)cache.delete(cache.keys().next().value!);}
   }
   if(!Number.isSafeInteger(account.context.slot)||fills.some(f=>f.slot>account.context.slot))throw Error('Balance predates confirmed fills.');
   if(!fills.length&&total>0n)throw Error('Acquisition history unavailable.');
   Object.assign(row,accountPosition(fills,String(total)),{status:'READY'});
   if(total===0n){row.valueLamports='0';row.unrealizedPnlLamports='0';}
   else if(spec){
    try{const quoteSpec:ProSpec={kind:'MARKET',side:'SELL',target:spec.target,mint,amountRaw:String(total),decimals:metadata.decimals,expiresAt:engine.clock()+60000,slippageBps:spec.slippageBps,priorityFeeLamports:spec.priorityFeeLamports,maxNetworkLamports:spec.maxNetworkLamports};const quote=await bounded(()=>engine.market.observation(quoteSpec));engine.fresh(quote);if(quote.solUsdMicros>0n)row.solUsdUnits=String(quote.solUsdMicros);const net=BigInt(quote.outputRaw)-BigInt(quoteSpec.maxNetworkLamports);row.valueLamports=String(net>0n?net:0n);row.unrealizedPnlLamports=String(BigInt(row.valueLamports)-BigInt(row.costBasisLamports!));row.reason='Liquidation estimate deducts the full network cost budget.';}catch{row.reason='Current liquidation quote unavailable.';result.partial=true;}
   }
  }catch(error){result.partial=true;if(row){row.status='UNAVAILABLE';row.reason=error instanceof Error?String(sanitizeDiagnostic(error.message)).slice(0,512):'Portfolio data unavailable.';}}
 }
 if(mints.length>512)result.partial=true;
 result.updatedAt=Date.now();return result;
}
