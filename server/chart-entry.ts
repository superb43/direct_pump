import {PublicKey,VersionedTransaction,type Connection} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,unpackAccount,unpackMint} from '@solana/spl-token';
import {chartEntryFromFills,type ChartEntryFill,type ChartEntryResult} from '../src/chart/chart-entry';
import {analyzeFeeFacts} from '../src/fee-receipt';
import {instructionManifest} from '../src/manifest';
import bs58 from 'bs58';
import type {ProEngine} from './engine';
const confirmedFacts=new WeakMap<Connection,Map<string,ChartEntryFill>>();

/** Read-only reconstruction from the journal and confirmed chain metadata. */
export async function readProChartEntry(engine:ProEngine,mint:string):Promise<ChartEntryResult>{
 const unavailable=(reason:string):ChartEntryResult=>({mint,wallet:engine.wallet,unavailable:reason});
 try{
  const deadline=Date.now()+8000;
  const read=async<T>(work:()=>Promise<T>):Promise<T>=>{
   const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Chart entry read timed out.');
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{return await Promise.race([work(),new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Chart entry read timed out.')),remaining);})]);}
   finally{if(timer)clearTimeout(timer);}
  };
  const key=new PublicKey(mint);
  const connection=(engine.market as typeof engine.market&{connection?:Connection}).connection;
  if(!connection)return unavailable('Confirmed transaction reader is unavailable.');
  const info=await read(()=>connection.getAccountInfo(key,'confirmed'));
  if(!info)return unavailable('Token metadata is unavailable.');
  const decoded=unpackMint(key,info,info.owner),wallet=new PublicKey(engine.wallet);
  const ata=getAssociatedTokenAddressSync(key,wallet,false,info.owner);
  const account=await read(()=>connection.getAccountInfoAndContext(ata,{commitment:'confirmed'}));
  const balanceAt=Date.now();
  const token=account.value?unpackAccount(ata,account.value,info.owner):undefined;
  if(token&&(!token.owner.equals(wallet)||!token.mint.equals(key)))return unavailable('Token balance ownership does not match.');
  const balance=token?.amount??0n;
  if(balance===0n)return unavailable('No open position.');
  const orders=new Map(engine.store.orders().filter(o=>o.wallet===engine.wallet&&o.spec.mint===mint).map(o=>[o.id,o]));
  const attempts=engine.store.attempts().filter(a=>orders.has(a.orderId)&&!['FAILED','EXPIRED','AUTHORIZED'].includes(a.state));
  if(attempts.length>100)return unavailable('Entry history exceeds the bounded transaction reader.');
  const fills:ChartEntryFill[]=[],seen=new Set<string>();
  let cache=confirmedFacts.get(connection);if(!cache){cache=new Map();confirmedFacts.set(connection,cache);}
  for(const attempt of attempts){
   const order=orders.get(attempt.orderId)!;
   if(!attempt.signature||!attempt.signedTransaction||!['CONFIRMED','FINALIZED'].includes(attempt.state))return unavailable('A journal transaction is unresolved.');
   const signature=attempt.signature;
   if(seen.has(attempt.signature))continue;seen.add(attempt.signature);
   const cacheKey=JSON.stringify([engine.wallet,mint,attempt.signature,attempt.signedTransaction,order.spec.side,attempt.inputRaw??order.spec.amountRaw,attempt.solUsdUnits]);
   const cached=attempt.state==='FINALIZED'?cache.get(cacheKey):undefined;
   if(cached){fills.push(cached);continue;}
   const commitment=attempt.state==='FINALIZED'?'finalized':'confirmed';
   const [tx,parsed]=await read(()=>Promise.all([
    connection.getTransaction(signature,{commitment,maxSupportedTransactionVersion:0}),
    connection.getParsedTransaction(signature,{commitment,maxSupportedTransactionVersion:0}),
   ]));
   if(!tx?.meta||!parsed?.meta||tx.meta.err||!tx.blockTime)return unavailable('Confirmed transaction metadata is unavailable.');
   const signed=VersionedTransaction.deserialize(Buffer.from(attempt.signedTransaction,'base64'));
   if(!signed.signatures[0]||bs58.encode(signed.signatures[0])!==attempt.signature)return unavailable('Journal transaction signature does not match.');
   if(!Buffer.from(signed.message.serialize()).equals(Buffer.from(tx.transaction.message.serialize())))return unavailable('Confirmed transaction differs from the signed journal.');
   const facts=analyzeFeeFacts({wallet:engine.wallet,mint,side:order.spec.side,venue:'JUPITER',pageUrl:'',message:'',blockhash:attempt.blockhash??'',lastValidBlockHeight:attempt.lastValidBlockHeight??0,createdAt:attempt.createdAt,status:'CONFIRMED',signature:attempt.signature,inputAmount:attempt.inputRaw??order.spec.amountRaw,feeManifest:instructionManifest(signed.message,{accountKeysFromLookups:tx.meta.loadedAddresses??{writable:[],readonly:[]}})},tx,parsed);
   let costUsdUnits:bigint|undefined;
   if(order.spec.side==='BUY'&&facts.volumeLamports&&attempt.solUsdUnits)costUsdUnits=BigInt(facts.volumeLamports)*BigInt(attempt.solUsdUnits)/1_000_000_000n;
   const fill:ChartEntryFill={side:order.spec.side,beforeRaw:facts.tokenBeforeRaw??'0',afterRaw:facts.tokenAfterRaw??'0',costUsdUnits,at:tx.blockTime*1000,slot:tx.slot,valid:facts.state==='VERIFIED'&&facts.executionSucceeded===true&&facts.zeroExtraFeesVerified&&facts.tokenBeforeRaw!==undefined&&facts.tokenAfterRaw!==undefined};
   fills.push(fill);
   if(attempt.state==='FINALIZED'&&fill.valid&&(order.spec.side==='SELL'||costUsdUnits!==undefined)){cache.set(cacheKey,fill);while(cache.size>100)cache.delete(cache.keys().next().value!);}
  }
  if(!Number.isSafeInteger(account.context.slot)||fills.some(fill=>fill.slot!==undefined&&fill.slot>account.context.slot))return unavailable('Wallet balance predates the confirmed transaction.');
  return chartEntryFromFills(fills,{mint,wallet:engine.wallet,balanceRaw:String(balance),supplyRaw:String(decoded.supply),decimals:decoded.decimals,updatedAt:balanceAt});
 }catch{return unavailable('Confirmed entry data is unavailable.');}
}
