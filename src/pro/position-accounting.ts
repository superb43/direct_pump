/** SOL accounting from independently verified chain fills, never requested fee caps. */
export type PositionFill = {side:'BUY'|'SELL';beforeRaw?:string;afterRaw?:string;netLamports:string;failed?:boolean;slot:number;at:number;signature:string};
export function accountPosition(fills:PositionFill[],balanceRaw:string){
 let quantity=0n,basis=0n,realized=0n,unrecovered=0n;
 for(const fill of orderFills(fills)){
  const net=BigInt(fill.netLamports);
  if(fill.failed){if(net<0n)throw Error('Invalid failed transaction cost.');realized-=net;if(quantity>0n)unrecovered+=net;continue;}
  if(fill.beforeRaw===undefined||fill.afterRaw===undefined)throw Error('Token history unavailable.');
  const before=BigInt(fill.beforeRaw),after=BigInt(fill.afterRaw);
  if(before!==quantity)throw Error('External token movement or incomplete history.');
  if(fill.side==='BUY'){
   if(after<=before||net<=0n)throw Error('Invalid buy accounting.');
   basis+=net;unrecovered+=net;
  }else{
   if(after>=before||before===0n)throw Error('Invalid sell accounting.');
   const allocated=after===0n?basis:basis*(before-after)/before;
   basis-=allocated;realized+=net-allocated;unrecovered-=net;
   if(after===0n){basis=0n;unrecovered=0n;}
  }
  quantity=after;
 }
 if(quantity!==BigInt(balanceRaw))throw Error('Current balance differs from verified trading history.');
 return {costBasisLamports:String(basis),realizedPnlLamports:String(realized),unrecoveredLamports:String(unrecovered>0n?unrecovered:0n)};
}

/** Slot time cannot order transactions. Reconstruct only an unambiguous balance chain. */
function orderFills(fills:PositionFill[]):PositionFill[]{
 const slots=new Map<number,PositionFill[]>();
 for(const fill of fills){const group=slots.get(fill.slot)??[];group.push(fill);slots.set(fill.slot,group);}
 const ordered:PositionFill[]=[];let quantity='0';
 for(const [,group] of [...slots].sort(([a],[b])=>a-b)){
  const successful=group.filter(f=>!f.failed),failed=group.filter(f=>f.failed);
  if(failed.length&&successful.some(f=>f.beforeRaw==='0'||f.afterRaw==='0'))throw Error('Holding episode order is ambiguous within a slot.');
  ordered.push(...failed);
  while(successful.length){
   const candidates=successful.filter(f=>f.beforeRaw===quantity);
   if(candidates.length!==1)throw Error('Token history order is ambiguous or incomplete.');
   const next=candidates[0]!;ordered.push(next);quantity=next.afterRaw??'';successful.splice(successful.indexOf(next),1);
  }
 }
 return ordered;
}
