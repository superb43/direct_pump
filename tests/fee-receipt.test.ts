import { beforeEach, expect, it, vi } from 'vitest';
import { Connection, PublicKey, Keypair, SystemProgram, ComputeBudgetProgram, TransactionMessage, TransactionInstruction, VersionedTransaction, type ParsedTransactionWithMeta, type VersionedTransactionResponse } from '@solana/web3.js';
import { NATIVE_MINT, getAssociatedTokenAddressSync, createCloseAccountInstruction } from '@solana/spl-token';
import bs58 from 'bs58';
import { instructionManifest } from '../src/manifest';
import { analyzeFeeFacts, verifyFeeReceipt } from '../src/fee-receipt';
import { priceMicros, volumeUsd, updateSavings, EMPTY_SAVINGS } from '../src/savings';
import type { Receipt, LedgerTrade } from '../src/model';
import { OFFLINE_PUMP_AMM_PROGRAM } from '@pump-fun/pump-swap-sdk';
import maxpain from './fixtures/chain/pump-maxpain-sell.json';

const wallet=Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
const target=Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const mint=Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
const ata=getAssociatedTokenAddressSync(mint,wallet);
const signature='fee-test-signature';
const rent=2_039_280,volume=250_000_000,fee=205_000;
function fixture(sell=false, extra=false, oldWsol=false) {
 const instructions=[ComputeBudgetProgram.setComputeUnitLimit({units:200_000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:1_000_000}),SystemProgram.transfer({fromPubkey:wallet,toPubkey:target,lamports:volume}),SystemProgram.transfer({fromPubkey:wallet,toPubkey:ata,lamports:rent})];
 if(oldWsol)instructions.push(createCloseAccountInstruction(getAssociatedTokenAddressSync(NATIVE_MINT,wallet),wallet,wallet));
 const original=new TransactionMessage({payerKey:wallet,recentBlockhash:PublicKey.default.toBase58(),instructions}).compileToV0Message();
 if(extra)instructions.push(SystemProgram.transfer({fromPubkey:wallet,toPubkey:mint,lamports:1000}));
 const message=new TransactionMessage({payerKey:wallet,recentBlockhash:PublicKey.default.toBase58(),instructions}).compileToV0Message();
 const names=message.getAccountKeys();const accountIndex=Array.from({length:names.length},(_,i)=>i).find(i=>names.get(i)!.equals(ata))!;
 const preBalances=Array(names.length).fill(0),postBalances=Array(names.length).fill(0);
 preBalances[0]=2_000_000_000;postBalances[0]=preBalances[0]+(sell?volume:-volume)-fee-rent;postBalances[accountIndex]=rent;
 const meta={fee,err:null,preBalances,postBalances,preTokenBalances:[],postTokenBalances:[{accountIndex,mint:mint.toBase58(),owner:wallet.toBase58(),uiTokenAmount:{amount:'1000000',decimals:6,uiAmount:null,uiAmountString:'1'}}],loadedAddresses:{writable:[],readonly:[]},logMessages:[],innerInstructions:[]};
 if(oldWsol){
   const index=Array.from({length:names.length},(_,i)=>i).find(i=>names.get(i)!.equals(getAssociatedTokenAddressSync(NATIVE_MINT,wallet)))!;
   meta.preBalances[index]=1_000_000_000+rent;meta.postBalances[0]+=1_000_000_000+rent;
   (meta.preTokenBalances as unknown[]).push({accountIndex:index,mint:NATIVE_MINT.toBase58(),owner:wallet.toBase58(),uiTokenAmount:{amount:'1000000000',decimals:9,uiAmount:null,uiAmountString:'1'}});
 }
 const tx={slot:100,blockTime:Math.floor(Date.now()/1000),meta,transaction:{message,signatures:[signature]},version:0} as unknown as VersionedTransactionResponse;
 const parsed={slot:100,blockTime:tx.blockTime,meta,transaction:{signatures:[signature],message:{accountKeys:[],instructions:[]}}} as unknown as ParsedTransactionWithMeta;
 const receipt:Receipt={signature,wallet:wallet.toBase58(),mint:mint.toBase58(),side:sell?'SELL':'BUY',venue:'PUMP_SWAP',message:'',pageUrl:'https://gmgn.ai/',blockhash:PublicKey.default.toBase58(),lastValidBlockHeight:100,createdAt:Date.now(),status:'CONFIRMED',inputAmount:String(volume),feeManifest:instructionManifest(original)};
 return {tx,parsed,receipt};
}
it('separates actual base/priority fees and setup rent from confirmed buy/sell volume',()=>{
 for(const sell of [false,true]) {
  const {tx,parsed,receipt}=fixture(sell),r=analyzeFeeFacts(receipt,tx,parsed);
  expect(r.state).toBe('VERIFIED');expect(r.zeroExtraFeesVerified).toBe(true);
  expect(r.totalNetworkLamports).toBe('205000');expect(r.priorityLamports).toBe('200000');expect(r.baseNetworkLamports).toBe('5000');
  expect(r.rentDepositedLamports).toBe(String(rent));expect(r.volumeLamports).toBe(String(volume));
 }
});
it('rejects an additional SOL transfer even if the trade instruction stayed the same',()=>{
 const {tx,parsed,receipt}=fixture(false,true);const r=analyzeFeeFacts(receipt,tx,parsed);
 expect(r.state).toBe('MISMATCH');expect(r.zeroExtraFeesVerified).toBe(false);expect(r.volumeLamports).toBeUndefined();
});
it('does not count failed swaps or unsafe RPC balance integers',()=>{
 const {tx,parsed,receipt}=fixture();tx.meta!.err={InstructionError:[2,'InvalidArgument']};
 const r=analyzeFeeFacts(receipt,tx,parsed);expect(r.executionSucceeded).toBe(false);expect(r.volumeLamports).toBeUndefined();
 tx.meta!.err=null;tx.meta!.preBalances[0]=Number.MAX_SAFE_INTEGER+1;
 expect(analyzeFeeFacts(receipt,tx,parsed).volumeLamports).toBeUndefined();
});
it('rounds prioritization fee upward by the declared limit, not consumed CU',()=>{
 const f=fixture();const instructions=[ComputeBudgetProgram.setComputeUnitLimit({units:3}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:500_001}),SystemProgram.transfer({fromPubkey:wallet,toPubkey:target,lamports:1})];
 const message=new TransactionMessage({payerKey:wallet,recentBlockhash:PublicKey.default.toBase58(),instructions}).compileToV0Message();
 f.tx.transaction.message=message;f.receipt.feeManifest=instructionManifest(message);f.tx.meta!.fee=5002;f.parsed.meta!.fee=5002;
 const r=analyzeFeeFacts(f.receipt,f.tx,f.parsed);expect(r.priorityLamports).toBe('2');expect(r.baseNetworkLamports).toBe('5000');
});
it('does not pretend older receipts without a built manifest are verified',async()=>{
 const {receipt}=fixture();delete receipt.feeManifest;
 const rpc=new Connection('https://rpc.test');const read=vi.spyOn(rpc,'getTransaction');
 expect((await verifyFeeReceipt(rpc,receipt)).state).toBe('UNAVAILABLE');expect(read).not.toHaveBeenCalled();
});
it('computes a 1% USD benchmark precisely and updates a duplicate signature without recounting',()=>{
 const snapshot={priceMicros:priceMicros('116.595').toString(),capturedAt:Date.now(),source:'Coinbase spot' as const};
 expect(volumeUsd('250000000',snapshot)).toBe('29148750');
 const {receipt,tx,parsed}=fixture();const report=analyzeFeeFacts(receipt,tx,parsed);
 const trade:LedgerTrade={signature,wallet:receipt.wallet,mint:receipt.mint,side:'BUY',createdAt:receipt.createdAt,feeReceipt:{...report,volumeUsdMicros:volumeUsd(report.volumeLamports!,snapshot),usd:snapshot}};
 const totals=updateSavings(EMPTY_SAVINGS,undefined,trade);expect(totals.savedUsdMicros).toBe('291487');expect(totals.verifiedTrades).toBe(1);
 expect(updateSavings(totals,trade,trade)).toEqual(totals);
 const unpriced={...trade,feeReceipt:{...report}};const initial=updateSavings(EMPTY_SAVINGS,undefined,unpriced);
 expect(initial.unpricedTrades).toBe(1);const repaired=updateSavings(initial,unpriced,trade);
 expect(repaired.verifiedTrades).toBe(1);expect(repaired.unpricedTrades).toBe(0);expect(repaired.volumeUsdMicros).toBe('29148750');
});

it('isolates a trade from an existing WSOL balance and rent refund',()=>{
 const {tx,parsed,receipt}=fixture(false,false,true);const r=analyzeFeeFacts(receipt,tx,parsed);
 expect(r.volumeLamports).toBe(String(volume));expect(r.rentRefundedLamports).toBe(String(rent));expect(r.rentDepositedLamports).toBe(String(rent));
});
it('counts only initial protocol-state funding as rent, not its later creator fee',()=>{
 const {tx,parsed,receipt}=fixture();const keys=tx.transaction.message.getAccountKeys();
 const index=Array.from({length:keys.length},(_,i)=>i).find(i=>keys.get(i)!.equals(target))!;
 tx.meta!.postBalances[index]=rent+100_000;tx.meta!.postBalances[0]=tx.meta!.postBalances[0]!-rent;
 (parsed.meta!.innerInstructions as unknown[]).push({index:2,instructions:[{program:'system',parsed:{type:'createAccount',info:{source:wallet.toBase58(),newAccount:target.toBase58(),lamports:rent}}}]});
 const r=analyzeFeeFacts(receipt,tx,parsed);expect(r.rentDepositedLamports).toBe(String(rent*2));expect(r.volumeLamports).toBe(String(volume));
});

it('compares stored manifests by values even when Chrome storage changes object key order',()=>{
 const {tx,parsed,receipt}=fixture();receipt.feeManifest=receipt.feeManifest!.map(ix=>({accounts:ix.accounts,data:ix.data,program:ix.program}));
 const result=analyzeFeeFacts(receipt,tx,parsed);expect(result.state).toBe('VERIFIED');expect(result.volumeLamports).toBe(String(volume));
});
it('shows actual network cost on a genuine mismatch without crediting savings',()=>{
 const {tx,parsed,receipt}=fixture(false,true);const r=analyzeFeeFacts(receipt,tx,parsed);
 expect(r.state).toBe('MISMATCH');expect(r.totalNetworkLamports).toBe('205000');expect(r.priorityLamports).toBe('200000');expect(r.volumeUsdMicros).toBeUndefined();expect(r.differences?.length).toBeGreaterThan(0);
});

it('accepts the exact appended Phantom assertion pair without relaxing the original plan',()=>{
 const f=fixture();
 const original=f.tx.transaction.message;
 const instructions=[...original.compiledInstructions].map(ix=>new TransactionInstruction({programId:original.staticAccountKeys[ix.programIdIndex]!,data:Buffer.from(ix.data),keys:ix.accountKeyIndexes.map(index=>({pubkey:original.staticAccountKeys[index]!,isSigner:original.isAccountSigner(index),isWritable:original.isAccountWritable(index)}))}));
 const programId=new PublicKey('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95');
 instructions.push(...[[wallet,'BgfmnACUYBKstZ5ATFaEA2S7gQdXV9JJY55'],[ata,'2MWjo7YpRNTqTvArLxMJdjGBdALpsLFa8VCcX']].map(([pubkey,data])=>new TransactionInstruction({programId,keys:[{pubkey:pubkey as PublicKey,isSigner:false,isWritable:false}],data:Buffer.from(bs58.decode(data as string))})));
 const message=new TransactionMessage({payerKey:wallet,recentBlockhash:PublicKey.default.toBase58(),instructions}).compileToV0Message();
 const oldKeys=original.getAccountKeys(),newKeys=message.getAccountKeys();
 for(const name of ['preBalances','postBalances'] as const){const old=f.tx.meta![name];f.tx.meta![name]=Array.from({length:newKeys.length},(_,i)=>{const oldIndex=Array.from({length:oldKeys.length},(_,j)=>j).find(j=>oldKeys.get(j)!.equals(newKeys.get(i)!));return oldIndex===undefined?0:old[oldIndex]!;});}
 f.tx.meta!.postTokenBalances![0]!.accountIndex=Array.from({length:newKeys.length},(_,i)=>i).find(i=>newKeys.get(i)!.equals(ata))!;
 f.tx.transaction.message=message;
 expect(analyzeFeeFacts(f.receipt,f.tx,f.parsed)).toMatchObject({state:'VERIFIED',volumeLamports:String(volume),zeroExtraFeesVerified:true});
 f.receipt.feeManifest![0]!.data='changed';
 expect(analyzeFeeFacts(f.receipt,f.tx,f.parsed).state).toBe('MISMATCH');
});

it('isolates the real maxpain full SELL with the observed Phantom guard layout',()=>{
 const transaction=VersionedTransaction.deserialize(Buffer.from(maxpain.raw.transaction[0]!, 'base64'));
 const tx={...maxpain.raw,transaction:{message:transaction.message,signatures:transaction.signatures.map(signature=>bs58.encode(signature))},meta:{...maxpain.raw.meta,loadedAddresses:{writable:maxpain.raw.meta.loadedAddresses.writable.map(key=>new PublicKey(key)),readonly:maxpain.raw.meta.loadedAddresses.readonly.map(key=>new PublicKey(key))}}} as VersionedTransactionResponse;
 const parsed=maxpain.parsed as unknown as ParsedTransactionWithMeta;
 // This fixture supplies the original on-chain prefix as its test plan; it
 // does not assert that a stored local plan may be replaced with chain data.
 const plan=instructionManifest(transaction.message,{accountKeysFromLookups:tx.meta!.loadedAddresses!}).slice(0,-2);
 const receipt:Receipt={signature:tx.transaction.signatures[0],wallet:'6bCFu4zFAnWUvQ12vdMRwtEH8bQVwbvEUx3AbdX7NA7V',mint:'EVD9rS4kGfSnwEzsQWxBnQAgM8ha3iCfbbe6GFNMpump',symbol:'maxpain',side:'SELL',venue:'PUMP_SWAP',status:'CONFIRMED',message:'',pageUrl:'https://gmgn.ai/sol/token/EVD9rS4kGfSnwEzsQWxBnQAgM8ha3iCfbbe6GFNMpump',blockhash:'',lastValidBlockHeight:1,createdAt:maxpain.raw.blockTime!*1000,feeManifest:plan};
 expect(analyzeFeeFacts(receipt,tx,parsed)).toMatchObject({state:'VERIFIED',executionSucceeded:true,zeroExtraFeesVerified:true,totalNetworkLamports:'105000',priorityLamports:'100000',volumeLamports:'7220745',tokenBeforeRaw:'18915014205',tokenAfterRaw:'0'});
 receipt.feeManifest![1]!.data='changed';
 expect(analyzeFeeFacts(receipt,tx,parsed)).toMatchObject({state:'MISMATCH',zeroExtraFeesVerified:false});
 expect(analyzeFeeFacts(receipt,tx,parsed).volumeLamports).toBeUndefined();
});

it('prices confirmed network costs on a mismatch without inventing cost basis or savings',async()=>{
 const {tx,parsed,receipt}=fixture(false,true);
 receipt.feeReceipt={state:'MISMATCH',checkedAt:0,note:'prior',protocolBreakdownIncomplete:true,protocolFees:[],zeroExtraFeesVerified:false,usd:{priceMicros:'120000000',capturedAt:Date.now(),source:'Coinbase spot'}};
 const rpc=new Connection('https://rpc.test');vi.spyOn(rpc,'getTransaction').mockResolvedValue(tx);vi.spyOn(rpc,'getParsedTransaction').mockResolvedValue(parsed);
 const result=await verifyFeeReceipt(rpc,receipt);
 expect(result).toMatchObject({state:'MISMATCH',usd:receipt.feeReceipt!.usd,totalNetworkLamports:'205000',zeroExtraFeesVerified:false});expect(result.volumeUsdMicros).toBeUndefined();
});

it('preserves on-chain slippage diagnostics and prices failed network fees without reverted volume',async()=>{
 const {tx,parsed,receipt}=fixture();
 tx.meta!.err={InstructionError:[2,{Custom:6004}]};tx.meta!.logMessages=[`Program ${OFFLINE_PUMP_AMM_PROGRAM.programId} failed: custom program error: 0x1774`];
 receipt.feeReceipt={state:'PENDING',checkedAt:0,note:'prior',protocolBreakdownIncomplete:true,protocolFees:[],zeroExtraFeesVerified:false,usd:{priceMicros:'120000000',capturedAt:Date.now(),source:'Coinbase spot'}};
 const rpc=new Connection('https://rpc.test');vi.spyOn(rpc,'getTransaction').mockResolvedValue(tx);vi.spyOn(rpc,'getParsedTransaction').mockResolvedValue(parsed);
 const result=await verifyFeeReceipt(rpc,receipt);
 expect(result).toMatchObject({state:'VERIFIED',executionSucceeded:false,totalNetworkLamports:'205000',usd:receipt.feeReceipt.usd,diagnostic:{stage:'CHAIN',code:6004,instructionIndex:2}});
 expect(result.executionError).toMatch(/Slippage limit exceeded/);expect(result.volumeLamports).toBeUndefined();expect(result.volumeUsdMicros).toBeUndefined();expect(result.protocolFees).toEqual([]);
});
