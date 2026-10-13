import {Buffer} from 'buffer';
import bs58 from 'bs58';
import {expect,it} from 'vitest';
import {Connection,PublicKey,TransactionMessage,TransactionInstruction,type VersionedTransactionResponse} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {CP_AMM_PROGRAM_ID} from '@meteora-ag/cp-amm-sdk';
import {decodeDammFees} from '../src/damm-fees';

// Authenticated event from the reported successful HOOKED sell; no local secrets.
const event='EVM9wLnauu9H41GfKhTodp7KrhwxaiJck2nTbTFprizdfAphHJuBCUoDfDSR4Uvdj5FVtuTWQpdxWJwvLcxMzbEgw8VQm6C8ZUd5ypVFx3HZC5szuRMXpQKH29EBY6gE7fLdiWbZLf6ojkizSoFkEbEV5yX2gY4GxaNdWDXGQbzmcpyfsoriLczT8uJ8srCyy4qv4mmyHniErZHfLDsrQzfpERyrdZyX5hXTW8BkentyqRzqNXyktaJwjuSGguxXRbVx3EGE5E5u';
const pool=new PublicKey('C7r9jXWiVYmBYR2Jj5YSLiEitUGJPjQXWeg7HPU8NwUk'),mint=new PublicKey('C1mBfBoDkwWfd6uTFZp62ARHLjeVp3bDpCDMfMZtPngE');
const authority=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],CP_AMM_PROGRAM_ID)[0];
const rpc=new Connection('https://rpc.test');
function fixture(){
 const accounts=Array<PublicKey>(14).fill(CP_AMM_PROGRAM_ID);accounts[1]=pool;accounts[6]=mint;accounts[7]=NATIVE_MINT;accounts[12]=authority;
 const message=new TransactionMessage({payerKey:PublicKey.default,recentBlockhash:PublicKey.default.toBase58(),instructions:[new TransactionInstruction({programId:CP_AMM_PROGRAM_ID,keys:accounts.map(pubkey=>({pubkey,isSigner:false,isWritable:false})),data:Buffer.from([248,198,158,145,225,117,135,200])})]}).compileToV0Message();
 const keys=message.getAccountKeys(),index=(key:PublicKey)=>Array.from({length:keys.length},(_,i)=>i).find(i=>keys.get(i)!.equals(key))!;
 const emit={programIdIndex:index(CP_AMM_PROGRAM_ID),accounts:[index(authority)],data:event,stackHeight:2};
 const tx={transaction:{message},meta:{innerInstructions:[{index:0,instructions:[emit]}],preTokenBalances:[{mint:mint.toBase58(),uiTokenAmount:{decimals:6}}],postTokenBalances:[]}} as unknown as VersionedTransactionResponse;
 return {tx,emit};
}
it('decodes the actual DAMM SOL fees exactly once without adding rent or network costs',()=>{
 const {tx,emit}=fixture();tx.meta!.innerInstructions![0]!.instructions.push({...emit});
 expect(decodeDammFees(rpc,tx)).toEqual([{label:'Meteora DAMM LP',mint:NATIVE_MINT.toBase58(),decimals:9,symbol:'SOL',rawAmount:'3126969'},{label:'Meteora DAMM protocol',mint:NATIVE_MINT.toBase58(),decimals:9,symbol:'SOL',rawAmount:'781742'}]);
});
it('does not accept unbound authority, wrong program, wrong depth or an unrelated event',()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.emit.accounts=[0];},(f:ReturnType<typeof fixture>)=>{f.emit.programIdIndex=0;},(f:ReturnType<typeof fixture>)=>{f.emit.stackHeight=3;},(f:ReturnType<typeof fixture>)=>{const data=Buffer.from(bs58.decode(f.emit.data));data[0]=0;f.emit.data=bs58.encode(data);}]){
  const f=fixture();mutate(f);expect(decodeDammFees(rpc,f.tx)).toEqual([]);
 }
});
it('rejects a mismatched pool and truncated event data',()=>{
 const f=fixture(),data=Buffer.from(bs58.decode(f.emit.data));data[16]=data[16]!^1;f.emit.data=bs58.encode(data);expect(()=>decodeDammFees(rpc,f.tx)).toThrow();
 f.emit.data=bs58.encode(data.subarray(0,-1));expect(()=>decodeDammFees(rpc,f.tx)).toThrow();
});
it('keeps output-token fees denominated in that token rather than pretending they are SOL',()=>{
 const f=fixture(),data=Buffer.from(bs58.decode(f.emit.data));data[48]=1;data[49]=0;f.emit.data=bs58.encode(data);
 const fees=decodeDammFees(rpc,f.tx);expect(fees).toHaveLength(2);expect(fees.every(fee=>fee.mint===mint.toBase58()&&fee.decimals===6)).toBe(true);
});
