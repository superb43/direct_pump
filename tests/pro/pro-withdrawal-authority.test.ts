import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type { Mock } from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {Keypair,Connection,PublicKey,SystemProgram,SystemInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {canonicalJson,type AuthProof} from '../../src/pro/contracts';
import type {AuthRegistry} from '../../server/auth';
import {WithdrawalAuthority,WalletLedger} from '../../server/withdrawals';
import {SOL} from '../../server/store';
import type {WithdrawalPreview,WithdrawalSpec,Withdrawal} from '../../src/pro/withdrawals';
import type {buildWithdrawalTransfer,WithdrawalTransferSpec} from '../../server/withdrawal-transfer';

describe('private signer withdrawal ledger',()=>{
 let db:DatabaseSync,authority:WithdrawalAuthority,key:Keypair,recipient:Keypair,spec:WithdrawalSpec,balances:Record<string,bigint>,active:boolean,locked:boolean;
 let connection:Connection,submit:ReturnType<typeof vi.fn>,status:ReturnType<typeof vi.fn>,height:ReturnType<typeof vi.fn>;
 let build:Mock<typeof buildWithdrawalTransfer>,sync:Mock<(requireSettled?:boolean)=>Promise<void>>;
 const proof=(method:string,path:string,body?:unknown):AuthProof=>({method,path,body:body===undefined?'':canonicalJson(body),envelope:{deviceId:'paired-device',timestamp:Date.now(),nonce:randomUUID(),signature:''}});
 const auth=()=>({verify:()=>{if(!active)throw new Error('revoked');return 'paired-device';},isActive:()=>active}) as unknown as AuthRegistry;
 const instantiate=(maxFee='10000')=>new WithdrawalAuthority(db,auth(),connection,()=>key.publicKey.toBase58(),()=>locked?undefined:key,maxFee,sync,async()=>({...balances}),build);
 beforeEach(async()=>{
  db=new DatabaseSync(':memory:');key=Keypair.generate();recipient=Keypair.generate();balances={[SOL]:100000n};active=true;locked=false;
  submit=vi.fn(async(bytes:Buffer)=>{const tx=VersionedTransaction.deserialize(bytes);const bs58=await import('bs58');return bs58.default.encode(tx.signatures[0]!);});status=vi.fn(async()=>({value:[null]}));height=vi.fn(async()=>1);sync=vi.fn(async()=>{});
  connection={sendRawTransaction:submit,getSignatureStatuses:status,getBlockHeight:height} as unknown as Connection;
  build=vi.fn(async(_connection:Connection,_wallet:PublicKey,intended:WithdrawalTransferSpec)=>({transaction:new VersionedTransaction(new TransactionMessage({payerKey:key.publicKey,recentBlockhash:'11111111111111111111111111111111',instructions:[SystemProgram.transfer({fromPubkey:key.publicKey,toPubkey:recipient.publicKey,lamports:BigInt(intended.amountRaw)})]}).compileToV0Message()),blockhash:'11111111111111111111111111111111',lastValidBlockHeight:99,feeLamports:'5000',rentLamports:'0'}));
  authority=instantiate();const id=randomUUID();await authority.call('addRecipient',proof('POST','/v1/recipients',{id,name:'Trusted wallet',address:recipient.publicKey.toBase58()}));
  spec={requestId:randomUUID(),recipientId:id,recipientVersion:1,address:recipient.publicKey.toBase58(),mint:SOL,decimals:9,amountRaw:'1000',maxNetworkLamports:'10000'};
 });
 afterEach(()=>{db.close();vi.restoreAllMocks();});
 const preview=async()=>await authority.call('preview',proof('POST','/v1/withdrawals/preview',spec)) as WithdrawalPreview;
 const approve=async(p:WithdrawalPreview,s=spec)=>await authority.call('approve',proof('POST','/v1/withdrawals',{previewId:p.id,spec:s})) as Withdrawal;
 it('reserves existing orders including fee budgets for Max',async()=>{
  authority.ledger.replace('order:one',{[SOL]:60000n});const p=await preview();expect(p.maxRaw).toBe('35000');expect(p.reservedRaw).toBe('60000');expect(p.feeLamports).toBe('5000');
  const r=await approve(p);expect(r.state).toBe('SUBMITTED');expect(authority.ledger.reserved(SOL)).toBe(66000n);expect(sync).toHaveBeenCalledWith(true);
 });
 it('withdraws Max from 0.001 SOL using the actual fee rather than the 0.005 SOL ceiling',async()=>{
  authority=instantiate('5000000');balances[SOL]=1000000n;spec.maxNetworkLamports='5000000';spec.amountRaw='1';
  const discovery=await preview();expect(discovery.maxRaw).toBe('995000');expect(discovery.spec.maxNetworkLamports).toBe('5000000');
  spec.amountRaw=discovery.maxRaw;const reviewed=await preview();await approve(reviewed);
  expect(authority.ledger.reserved(SOL)).toBe(1000000n);
  const tx=VersionedTransaction.deserialize(submit.mock.calls[0]![0]);
  const transfer=SystemInstruction.decodeTransfer(TransactionMessage.decompile(tx.message).instructions[0]!);
  expect(transfer.lamports).toBe(995000n);
 });
 it('requires a new review when independently rebuilt fees change, before signing',async()=>{
  const p=await preview(),original=build.getMockImplementation()!;
  build.mockImplementationOnce(async(...args:Parameters<typeof original>)=>({...await original(...args),feeLamports:'6000'}));
  await expect(approve(p)).rejects.toThrow('costs changed');
  expect(submit).not.toHaveBeenCalled();expect(authority.ledger.reserved(SOL)).toBe(0n);
 });
 it('includes token account rent in the exact SOL reservation and invalidates changed rent',async()=>{
  spec.mint=Keypair.generate().publicKey.toBase58();spec.decimals=6;balances[spec.mint]=10000n;
  const original=build.getMockImplementation()!;
  build.mockImplementation(async(...args:Parameters<typeof original>)=>({...await original(...args),rentLamports:'2000'}));
  const p=await preview();expect(p.maxRaw).toBe('10000');
  build.mockImplementationOnce(async(...args:Parameters<typeof original>)=>({...await original(...args),rentLamports:'3000'}));
  await expect(approve(p)).rejects.toThrow('costs changed');expect(submit).not.toHaveBeenCalled();
  await approve(p);expect(authority.ledger.reserved(SOL)).toBe(7000n);expect(authority.ledger.reserved(spec.mint)).toBe(1000n);
 });
 it('rejects destination or amount changes after review',async()=>{
  const p=await preview();await expect(approve(p,{...spec,address:Keypair.generate().publicKey.toBase58()})).rejects.toThrow('preview changed');await expect(approve(p,{...spec,amountRaw:'2000'})).rejects.toThrow('preview changed');expect(submit).not.toHaveBeenCalled();
 });
 it('rejects remapped recipient address before preview',async()=>{spec.address=Keypair.generate().publicKey.toBase58();await expect(preview()).rejects.toThrow('Saved recipient');});
 it('does not overwrite a saved address in place',async()=>{await expect(authority.call('addRecipient',proof('POST','/v1/recipients',{id:spec.recipientId,name:'Trusted wallet',address:Keypair.generate().publicKey.toBase58()}))).rejects.toThrow('overwritten');});
 it('deactivation after review blocks approval',async()=>{const p=await preview();await authority.call('deactivateRecipient',proof('POST',`/v1/recipients/${spec.recipientId}/deactivate`,{version:1}));await expect(approve(p)).rejects.toThrow('inactive');});
 it('does not reinterpret recipient authorization as a withdrawal',async()=>{await expect(authority.call('approve',proof('POST','/v1/recipients',spec))).rejects.toThrow('action mismatch');});
 it('invalidates review after balance or order-reservation changes',async()=>{const p=await preview();balances[SOL]=99999n;await expect(approve(p)).rejects.toThrow('Balance or reservations');balances[SOL]=100000n;authority.ledger.replace('order:new',{[SOL]:1n});await expect(approve(p)).rejects.toThrow('Balance or reservations');});
 it('keeps Max conservative and refuses any over-reservation',async()=>{authority.ledger.replace('order:one',{[SOL]:95000n});const p=await preview();expect(p.maxRaw).toBe('0');await expect(approve(p)).rejects.toThrow('unreserved');});
 it('is idempotent across lost ACK and signer object recreation',async()=>{const p=await preview();const r=await approve(p);authority=instantiate();expect(await approve(p)).toEqual(r);expect(submit).toHaveBeenCalledTimes(1);await expect(approve(p,{...spec,amountRaw:'2'})).rejects.toThrow('identity conflict');});
 it('retains reservations through unknown and confirmed until finalized',async()=>{const p=await preview();submit.mockRejectedValueOnce(new Error('lost RPC ack'));const r=await approve(p);expect(r.state).toBe('UNKNOWN');expect(authority.ledger.reserved(SOL)).toBe(6000n);status.mockResolvedValue({value:[{confirmationStatus:'confirmed',err:null}]});await authority.reconcile();expect(authority.ledger.reserved(SOL)).toBe(6000n);status.mockResolvedValue({value:[{confirmationStatus:'finalized',err:null}]});await authority.reconcile();expect(authority.ledger.reserved(SOL)).toBe(0n);expect((await authority.call('withdrawals') as Withdrawal[])[0]?.state).toBe('FINALIZED');});
 it('retries only the exact journaled bytes',async()=>{const p=await preview();submit.mockRejectedValue(new Error('lost RPC ack'));await approve(p);db.prepare("UPDATE withdrawals SET value=json_set(value,'$.submittedAt',0)").run();await authority.reconcile();expect(submit).toHaveBeenCalledTimes(2);expect(submit.mock.calls[0]?.[0]).toEqual(submit.mock.calls[1]?.[0]);expect(build).toHaveBeenCalledTimes(2);});
 it('does not release a confirmed failed transaction before finalization',async()=>{await approve(await preview());status.mockResolvedValue({value:[{confirmationStatus:'confirmed',err:{InstructionError:[0,'error']}}]});await authority.reconcile();expect(authority.ledger.reserved(SOL)).toBe(6000n);status.mockResolvedValue({value:[{confirmationStatus:'finalized',err:{InstructionError:[0,'error']}}]});await authority.reconcile();expect(authority.ledger.reserved(SOL)).toBe(0n);expect((await authority.call('withdrawals') as Withdrawal[])[0]?.state).toBe('FAILED');});
 it('expires absent signatures only after finalized block height and history recheck',async()=>{await approve(await preview());height.mockResolvedValue(100);await authority.reconcile();expect((await authority.call('withdrawals') as Withdrawal[])[0]?.state).toBe('EXPIRED');expect(status).toHaveBeenCalledTimes(2);expect(authority.ledger.reserved(SOL)).toBe(0n);});
 it('refuses locked or revoked devices without changing engine controls',async()=>{const p=await preview();locked=true;await expect(approve(p)).rejects.toThrow('Unlock');locked=false;active=false;await expect(approve(p)).rejects.toThrow('revoked');expect(submit).not.toHaveBeenCalled();});
 it('detects revocation and changed balances during transaction construction',async()=>{const p=await preview();build.mockImplementationOnce(async(...args)=>{active=false;return build.getMockImplementation()!(...args);});await expect(approve(p)).rejects.toThrow('authorization changed');expect(submit).not.toHaveBeenCalled();});
 it('rolls back terminal status when releasing the reservation fails',async()=>{
  await approve(await preview());status.mockResolvedValue({value:[{confirmationStatus:'finalized',err:null}]});
  const release=vi.spyOn(authority.ledger,'release').mockImplementationOnce(()=>{throw new Error('disk failure');});await expect(authority.reconcile()).rejects.toThrow('disk failure');
  expect((await authority.call('withdrawals') as Withdrawal[])[0]?.state).toBe('SUBMITTED');expect(authority.ledger.reserved(SOL)).toBe(6000n);release.mockRestore();authority=instantiate();await authority.reconcile();expect(authority.ledger.reserved(SOL)).toBe(0n);
 });
 it('keeps the maximum allowed history within the bounded IPC response limit',async()=>{
  const {SIGNER_REPLY_LIMIT}=await import('../../server/errors');
  for(let i=0;i<500;i++){const id=randomUUID();db.prepare('INSERT INTO withdrawals VALUES(?,?)').run(id,canonicalJson({id,spec:{...spec,requestId:id},deviceId:'paired-device',state:'FINALIZED',createdAt:Date.now(),updatedAt:Date.now(),signature:'1'.repeat(88),signedTransaction:'private',blockhash:'private',lastValidBlockHeight:99,error:'Submission uncertain; the same transaction is being reconciled.'}));}
  const rows=await authority.call('withdrawals');expect(JSON.stringify({ok:true,data:rows}).length).toBeLessThan(SIGNER_REPLY_LIMIT);
 });
 it('exposes only public status without unsigned or signed transaction bytes',async()=>{await approve(await preview());const text=JSON.stringify(await authority.call('withdrawals'));expect(text).not.toMatch(/signedTransaction|deviceId|blockhash|lastValidBlockHeight/);});
});
