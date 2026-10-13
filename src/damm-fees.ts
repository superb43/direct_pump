import {Buffer} from 'buffer';
import bs58 from 'bs58';
import {Connection,PublicKey,type VersionedTransactionResponse} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {CpAmm,CP_AMM_PROGRAM_ID,getFeeMode,type CollectFeeMode,type TradeDirection} from '@meteora-ag/cp-amm-sdk';
import type {FeeAmount} from './model';

const AUTHORITY=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],CP_AMM_PROGRAM_ID)[0];
const EVENT=[228,69,165,46,81,203,154,29];
const SWAPS=[[248,198,158,145,225,117,135,200],[65,75,63,76,235,91,91,136]];
const starts=(bytes:Uint8Array,prefix:number[])=>prefix.every((value,index)=>bytes[index]===value);
type SwapEvent={pool:PublicKey;tradeDirection:number;collectFeeMode:number;hasReferral:boolean;swapResult:{claimingFee:{toString():string};compoundingFee:{toString():string};protocolFee:{toString():string};referralFee:{toString():string}}};

/** Pinned SDK 1.5.1 event decoding; only authenticated direct swap CPI events. */
export function decodeDammFees(rpc:Connection,tx:VersionedTransactionResponse):FeeAmount[]{
  const keys=tx.transaction.message.getAccountKeys({accountKeysFromLookups:tx.meta?.loadedAddresses??{writable:[],readonly:[]}});
  const decimals=new Map([...(tx.meta?.preTokenBalances??[]),...(tx.meta?.postTokenBalances??[])].map(row=>[row.mint,row.uiTokenAmount.decimals]));
  const fees:FeeAmount[]=[];
  let coder:ReturnType<typeof makeCoder>|undefined;
  const makeCoder=()=>new CpAmm(rpc)._program.coder.events;
  for(const group of tx.meta?.innerInstructions??[]){
    const swap=tx.transaction.message.compiledInstructions[group.index];
    if(!swap||!keys.get(swap.programIdIndex)?.equals(CP_AMM_PROGRAM_ID)||!SWAPS.some(prefix=>starts(swap.data,prefix)))continue;
    const accounts=swap.accountKeyIndexes.map(index=>keys.get(index)!);
    if(!accounts[12]?.equals(AUTHORITY)||!accounts[13]?.equals(CP_AMM_PROGRAM_ID))continue;
    for(const ix of group.instructions){
      if(!keys.get(ix.programIdIndex)?.equals(CP_AMM_PROGRAM_ID)||(ix as typeof ix & {stackHeight?:number}).stackHeight!==2||ix.accounts.length!==1||!keys.get(ix.accounts[0]!)?.equals(AUTHORITY))continue;
      const data=Buffer.from(bs58.decode(ix.data));if(!starts(data,EVENT))continue;
      coder??=makeCoder();const event=coder.decode(data.subarray(8).toString('base64'));
      if(event?.name!=='evtSwap2')continue;
      const value=event.data as SwapEvent;
      if(!value.pool.equals(accounts[1]!)||![0,1].includes(value.tradeDirection)||![0,1,2].includes(value.collectFeeMode))throw new Error('Inconsistent DAMM swap event.');
      const mode=getFeeMode(value.collectFeeMode as CollectFeeMode,value.tradeDirection as TradeDirection,value.hasReferral);
      const mint=accounts[mode.feesOnTokenA?6:7]!.toBase58(),precision=mint===NATIVE_MINT.toBase58()?9:decimals.get(mint);
      if(precision===undefined)break;
      const result=value.swapResult;
      const components=[['Meteora DAMM LP',BigInt(result.claimingFee.toString())+BigInt(result.compoundingFee.toString())],['Meteora DAMM protocol',BigInt(result.protocolFee.toString())],['Meteora DAMM partner',BigInt(result.referralFee.toString())]] as const;
      for(const [label,amount] of components){if(amount<0n)throw new Error('Invalid DAMM fee.');if(amount>0n)fees.push({label,mint,decimals:precision,symbol:mint===NATIVE_MINT.toBase58()?'SOL':`${mint.slice(0,4)}…${mint.slice(-4)}`,rawAmount:amount.toString()});}
      break; // One event per swap, even if log/CPI data is repeated.
    }
  }
  return fees;
}
