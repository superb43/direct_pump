import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { PublicKey, type VersionedTransactionResponse } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import type { FeeAmount } from './model';

// Same pinned upstream IDL as vendor/dlmm-idl.ts (2f540c2107988e0f97efa5917100bb912c96c17a).
const DLMM=new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
const AUTHORITY=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],DLMM)[0].toBase58();
const EVENT=[228,69,165,46,81,203,154,29];
const SWAP_EVENT=[81,108,227,190,205,208,10,196];
const SWAP=[248,198,158,145,225,117,135,200];
const equal=(data:Uint8Array,prefix:number[],offset=0)=>prefix.every((v,i)=>data[offset+i]===v);

/** Only authenticated CPI events of an actual DLMM swap; unknown assets stay unpriced. */
export function decodeDlmmFees(tx:VersionedTransactionResponse):FeeAmount[]{
 const keys=tx.transaction.message.getAccountKeys({accountKeysFromLookups:tx.meta?.loadedAddresses??{writable:[],readonly:[]}});
 const mints=new Map<string,number>();
 for(const row of [...(tx.meta?.preTokenBalances??[]),...(tx.meta?.postTokenBalances??[])])mints.set(row.mint,row.uiTokenAmount.decimals);
 const amounts=new Map<string,FeeAmount>();
 for(const group of tx.meta?.innerInstructions??[]){
  let swap:{pool:string;from:string;x:string;y:string;height:number}|undefined;
  for(const compiled of group.instructions){
   const ix=compiled as typeof compiled & {stackHeight?:number|null};
   if(!keys.get(ix.programIdIndex)?.equals(DLMM)){if(swap&&(ix.stackHeight??0)<=swap.height)swap=undefined;continue;}
   const data=Buffer.from(bs58.decode(ix.data)),accounts=ix.accounts.map(i=>keys.get(i)!.toBase58());
   if(equal(data,SWAP)){
    const authorityIndex=13;
    swap=accounts[authorityIndex]===AUTHORITY&&accounts[authorityIndex+1]===DLMM.toBase58()&&ix.stackHeight!=null?{pool:accounts[0]!,from:accounts[10]!,x:accounts[6]!,y:accounts[7]!,height:ix.stackHeight}:undefined;
    continue;
   }
   if(!swap||ix.stackHeight!==swap.height+1||accounts.length!==1||accounts[0]!==AUTHORITY||!equal(data,EVENT))continue;
   if(!equal(data,SWAP_EVENT,8))continue;
   if(data.length!==145||bs58.encode(data.subarray(16,48))!==swap.pool||bs58.encode(data.subarray(48,80))!==swap.from)throw new Error('Inconsistent DLMM swap event.');
   if(data[104]!>1)throw new Error('Invalid DLMM direction.');
   const mint=data[104]===1?swap.x:swap.y;
   const total=data.readBigUInt64LE(105),protocol=data.readBigUInt64LE(113),host=data.readBigUInt64LE(137);
   if(host!==0n)throw new Error('DLMM host fee attribution is not supported.');
   if(protocol>total)throw new Error('Inconsistent DLMM fee split.');
   const lp=total-protocol;
   const decimals=mint===NATIVE_MINT.toBase58()?9:mints.get(mint);
   if(decimals===undefined)continue;
   for(const [label,amount] of [['Meteora DLMM LP',lp],['Meteora DLMM protocol',protocol]] as const){
    if(amount===0n)continue;
    const key=`${label}:${mint}`,prior=amounts.get(key);
    amounts.set(key,{label,mint,decimals,symbol:mint===NATIVE_MINT.toBase58()?'SOL':`${mint.slice(0,4)}…${mint.slice(-4)}`,rawAmount:(BigInt(prior?.rawAmount??'0')+amount).toString()});
   }
   swap=undefined; // One fee event per swap; no log/CPI double counting.
  }
 }
 return [...amounts.values()];
}
