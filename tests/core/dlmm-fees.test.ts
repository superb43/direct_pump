import { expect, it } from 'vitest';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { PublicKey, TransactionMessage, TransactionInstruction, type VersionedTransactionResponse } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { decodeDlmmFees } from '../../src/dlmm-fees';
const program=new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
const authority=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],program)[0];
const pool=new PublicKey('FtiotJckV2ZG4S1YgJDJLiXKKDAnKWXgQxo7vxsjPwPe'),wallet=new PublicKey('6bCFu4zFAnWUvQ12vdMRwtEH8bQVwbvEUx3AbdX7NA7V'),mint=new PublicKey('C1mBfBoDkwWfd6uTFZp62ARHLjeVp3bDpCDMfMZtPngE');
const event='yCGxBopjnVNQkNP5usq1PpJqrStihvcvN7ChrC5vfen5PKvmhz4JX9PMsRhKt3mtJgnbYuT8HNQ6QxRGRUmfQAwBHDXvPSVHi4FDRT4kzqRtJb6wEX4iLhESSqp9pnaj1SdxwDz7UrtseGYHzP2UiXkH3d5CsRUH5TGsJmKktKY1i87YvhNxWyHfQYzX6YTdJMg6nb';
function fixture(){
 const message=new TransactionMessage({payerKey:wallet,recentBlockhash:PublicKey.default.toBase58(),instructions:[new TransactionInstruction({programId:program,keys:[pool,wallet,mint,NATIVE_MINT,authority].map(pubkey=>({pubkey,isSigner:false,isWritable:false})),data:Buffer.alloc(0)})]}).compileToV0Message();
 const keys=message.getAccountKeys(),idx=(key:PublicKey)=>Array.from({length:keys.length},(_,i)=>i).find(i=>keys.get(i)!.equals(key))!;
 const accounts=Array(15).fill(idx(program));accounts[0]=idx(pool);accounts[6]=idx(mint);accounts[7]=idx(NATIVE_MINT);accounts[10]=idx(wallet);accounts[13]=idx(authority);
 const swap={programIdIndex:idx(program),accounts,data:bs58.encode(new Uint8Array([248,198,158,145,225,117,135,200])),stackHeight:2};
 const emit={programIdIndex:idx(program),accounts:[idx(authority)],data:event,stackHeight:3};
 const tx={transaction:{message},meta:{innerInstructions:[{index:0,instructions:[swap,emit]}],preTokenBalances:[],postTokenBalances:[]}} as unknown as VersionedTransactionResponse;
 return {tx,swap,emit};
}
it('decodes the actual confirmed DLMM SOL fee once, separating LP and protocol',()=>{
 const {tx,emit}=fixture();tx.meta!.innerInstructions![0]!.instructions.push({...emit});
 expect(decodeDlmmFees(tx)).toEqual([
  {label:'Meteora DLMM LP',mint:NATIVE_MINT.toBase58(),decimals:9,symbol:'SOL',rawAmount:'452679'},
  {label:'Meteora DLMM protocol',mint:NATIVE_MINT.toBase58(),decimals:9,symbol:'SOL',rawAmount:'50297'},
 ]);
});
it('does not attribute unbound, forged, wrong-depth or unknown event data',()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>f.swap.accounts[13]=f.swap.accounts[0]!, (f:ReturnType<typeof fixture>)=>f.emit.stackHeight=2,(f:ReturnType<typeof fixture>)=>f.emit.data=bs58.encode(new Uint8Array(145))]){
  const f=fixture();mutate(f);expect(decodeDlmmFees(f.tx)).toEqual([]);
 }
});
it('rejects inconsistent event pool, amount split and truncated layouts',()=>{
 for(const change of [(b:Buffer)=>{b[16]=b[16]!^1;return b;},(b:Buffer)=>{b.writeBigUInt64LE(999999999n,113);return b;},(b:Buffer)=>{b.writeBigUInt64LE(1n,137);return b;},(b:Buffer)=>b.subarray(0,-1)]){
  const f=fixture();f.emit.data=bs58.encode(change(Buffer.from(bs58.decode(event))));expect(()=>decodeDlmmFees(f.tx)).toThrow();
 }
});
