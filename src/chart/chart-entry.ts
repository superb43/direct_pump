import type {Receipt} from '../model';

export type ChartEntry = {mint:string;wallet:string;priceUsd:string;marketCapUsd:string;supplyRaw:string;decimals:number;balanceRaw:string;updatedAt:number;validUntil?:number};
export type ChartEntryResult = ChartEntry | {mint:string;wallet:string;unavailable:string};
export type ChartEntryFill = {side:'BUY'|'SELL';beforeRaw:string;afterRaw:string;costUsdUnits?:bigint;at:number;slot?:number;valid:boolean};
const scale=1_000_000_000_000n;
const usd=(value:bigint)=>`${value/scale}.${(value%scale).toString().padStart(12,'0')}`;

/** Confirmed swap consideration only. Partial sales preserve the average price. */
export function chartEntryFromFills(fills:ChartEntryFill[],position:Pick<ChartEntry,'mint'|'wallet'|'balanceRaw'|'supplyRaw'|'decimals'|'updatedAt'>):ChartEntryResult{
 const unavailable=(reason:string):ChartEntryResult=>({mint:position.mint,wallet:position.wallet,unavailable:reason});
 try{
  const balance=BigInt(position.balanceRaw),supply=BigInt(position.supplyRaw);
  if(balance<=0n)return unavailable('No open position.');
  if(supply<=0n||!Number.isInteger(position.decimals)||position.decimals<0||position.decimals>18)return unavailable('Token metadata is unavailable.');
  let quantity=0n,average=0n,known=true;
  for(const fill of [...fills].sort((a,b)=>a.at-b.at||(a.slot??0)-(b.slot??0))){
   if(!fill.valid){known=false;continue;}
   const before=BigInt(fill.beforeRaw),after=BigInt(fill.afterRaw),delta=after-before;
   if(before<0n||after<0n){known=false;continue;}
   if(before===0n){quantity=0n;average=0n;known=true;}
   if(before!==quantity)known=false;
   if(fill.side==='BUY'&&delta>0n){
    if(fill.costUsdUnits===undefined||fill.costUsdUnits<=0n)known=false;
    else average=(average*before+fill.costUsdUnits*10n**BigInt(position.decimals))/after;
   }else if(!(fill.side==='SELL'&&delta<0n))known=false;
   quantity=after;
   if(after===0n){average=0n;known=true;}
  }
  if(!known||quantity!==balance||average<=0n)return unavailable('Confirmed entry cost is incomplete: external transfers or untracked acquisitions.');
  return {...position,priceUsd:usd(average),marketCapUsd:usd(average*supply/10n**BigInt(position.decimals))};
 }catch{return unavailable('Confirmed entry data is invalid.');}
}

export function chartEntryFromReceipts(receipts:Receipt[],position:Pick<ChartEntry,'mint'|'wallet'|'balanceRaw'|'supplyRaw'|'decimals'|'updatedAt'>):ChartEntryResult{
 const seen=new Set<string>();
 const fills:ChartEntryFill[]=[];
 for(const receipt of receipts){
  if(receipt.wallet!==position.wallet||receipt.mint!==position.mint||['FAILED','EXPIRED'].includes(receipt.status))continue;
  if(receipt.status!=='CONFIRMED')return {mint:position.mint,wallet:position.wallet,unavailable:'A transaction is unresolved.'};
  if(receipt.signature&&seen.has(receipt.signature))continue;
  if(receipt.signature)seen.add(receipt.signature);
  const f=receipt.feeReceipt;
  const valid=receipt.status==='CONFIRMED'&&f?.state==='VERIFIED'&&f.executionSucceeded===true&&f.zeroExtraFeesVerified&&f.tokenBeforeRaw!==undefined&&f.tokenAfterRaw!==undefined;
  let costUsdUnits:bigint|undefined;
  try{if(f?.volumeLamports&&f.usd)costUsdUnits=BigInt(f.volumeLamports)*BigInt(f.usd.priceMicros)*1_000_000n/1_000_000_000n;}catch{/* Invalid costs suppress the entry. */}
  fills.push({side:receipt.side,beforeRaw:f?.tokenBeforeRaw??'0',afterRaw:f?.tokenAfterRaw??'0',at:f?.blockTime!==undefined?f.blockTime*1000:receipt.createdAt,slot:f?.slot,valid,costUsdUnits});
 }
 return chartEntryFromFills(fills,position);
}
