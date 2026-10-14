import {expect,it,vi} from 'vitest';
import {Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction,Connection,type VersionedTransactionResponse,type ParsedTransactionWithMeta} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,MintLayout,TOKEN_PROGRAM_ID,AccountLayout} from '@solana/spl-token';
import type {ProEngine} from '../../server/engine';
import type {ProOrder,ProAttempt} from '../../src/pro/contracts';
import bs58 from 'bs58';
import {Readable} from 'node:stream';
import {createProServer} from '../../server/api';
import {readProPortfolio} from '../../server/pro-portfolio';
function fixture(){
 const wallet=Keypair.fromSeed(new Uint8Array(32).fill(1)),mint=Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey,target=Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey,ata=getAssociatedTokenAddressSync(mint,wallet.publicKey);
 const message=new TransactionMessage({payerKey:wallet.publicKey,recentBlockhash:PublicKey.default.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:wallet.publicKey,toPubkey:target,lamports:250000000}),SystemProgram.transfer({fromPubkey:wallet.publicKey,toPubkey:ata,lamports:2039280})]}).compileToV0Message();
 const signed=new VersionedTransaction(message);signed.sign([wallet]);
 const keys=message.getAccountKeys(),index=Array.from({length:keys.length},(_,i)=>i).find(i=>keys.get(i)!.equals(ata))!;
 const before=Array(keys.length).fill(0),after=Array(keys.length).fill(0);before[0]=2000000000;after[0]=before[0]-250000000-2039280-5000;after[index]=2039280;
 const signature=bs58.encode(signed.signatures[0]!);
 const meta={err:null,fee:5000,preBalances:before,postBalances:after,preTokenBalances:[],postTokenBalances:[{accountIndex:index,mint:mint.toBase58(),owner:wallet.publicKey.toBase58(),uiTokenAmount:{amount:'1000000',decimals:6,uiAmount:null,uiAmountString:'1'}}],loadedAddresses:{writable:[],readonly:[]},innerInstructions:[]};
 const tx={slot:1,blockTime:100,meta,transaction:{message,signatures:[signature]},version:0} as unknown as VersionedTransactionResponse;
 const parsed={slot:1,blockTime:100,meta,transaction:{signatures:[signature],message:{accountKeys:[],instructions:[]}}} as unknown as ParsedTransactionWithMeta;
 const mintData=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1000000000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},mintData);
 const accountData=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint,owner:wallet.publicKey,amount:1000000n,delegateOption:0,delegate:PublicKey.default,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},accountData);
 const connection=new Connection('https://rpc.test');
 vi.spyOn(connection,'getAccountInfo').mockResolvedValue({data:mintData,owner:TOKEN_PROGRAM_ID,executable:false,lamports:1,rentEpoch:0});
 vi.spyOn(connection,'getAccountInfoAndContext').mockResolvedValue({context:{slot:1},value:{data:accountData,owner:TOKEN_PROGRAM_ID,executable:false,lamports:2039280,rentEpoch:0}});
 vi.spyOn(connection,'getTokenAccountsByOwner').mockRejectedValue(Error('403: Indexed requests require a personal token'));
 vi.spyOn(connection,'getTransaction').mockResolvedValue(tx);vi.spyOn(connection,'getParsedTransaction').mockResolvedValue(parsed);
 const order={id:'order',wallet:wallet.publicKey.toBase58(),spec:{mint:mint.toBase58(),side:'BUY',amountRaw:'900000000'},state:'FINALIZED'} as ProOrder;
 const attempt={id:'attempt',orderId:'order',state:'FINALIZED',signature,signedTransaction:Buffer.from(signed.serialize()).toString('base64'),solUsdUnits:'100000000000000',createdAt:1} as ProAttempt;
 const engine={wallet:wallet.publicKey.toBase58(),market:{connection},store:{orders:()=>[order],attempts:()=>[attempt],reserved:()=>0n}} as unknown as ProEngine;
 return {engine,mint:mint.toBase58(),attempt,connection,tx,accountData};
}

it('reconstructs fee-inclusive actual costs and caches only finalized facts',async()=>{
 const f=fixture();const result=await readProPortfolio(f.engine,f.mint);
 expect(result.rows[0]).toMatchObject({status:'READY',costBasisLamports:'252044280',realizedPnlLamports:'0',unrecoveredLamports:'252044280',totalRaw:'1000000'});
 await readProPortfolio(f.engine,f.mint);expect(f.connection.getTransaction).toHaveBeenCalledTimes(1);
});
it('fails closed for unresolved journals, mismatched signed bytes and external balances',async()=>{
 const f=fixture();f.attempt.state='UNKNOWN';expect((await readProPortfolio(f.engine,f.mint)).rows[0]).toMatchObject({status:'UNAVAILABLE'});
 f.attempt.state='FINALIZED';f.tx.transaction.message.recentBlockhash=PublicKey.default.toBase58();f.attempt.signature=Keypair.generate().publicKey.toBase58();expect((await readProPortfolio(f.engine,f.mint)).rows[0]).toMatchObject({status:'UNAVAILABLE'});
});
it('records actual failed network fees without invented swap volume',async()=>{
 const f=fixture();f.tx.meta!.err={InstructionError:[0,'InvalidArgument']};f.attempt.state='FAILED';
 const decoded=AccountLayout.decode(f.accountData);AccountLayout.encode({...decoded,amount:0n},f.accountData);
 expect((await readProPortfolio(f.engine,f.mint)).rows[0]).toMatchObject({status:'READY',costBasisLamports:'0',realizedPnlLamports:'-5000',unrecoveredLamports:'0'});
});
it.each([false,true])('continues bounded immutable history reconstruction on refresh (failed=%s)',async(failed)=>{
 const f=fixture(),wallet=Keypair.fromSeed(new Uint8Array(32).fill(1));
 const attempts:ProAttempt[]=[],orders:ProOrder[]=[],transactions=new Map<string,VersionedTransactionResponse>();
 for(let i=0;i<(failed?34:33);i++){
  const signed=VersionedTransaction.deserialize(Buffer.from(f.attempt.signedTransaction!,'base64'));
  signed.message.recentBlockhash=Keypair.fromSeed(new Uint8Array(32).fill(i+10)).publicKey.toBase58();signed.sign([wallet]);
  const signature=bs58.encode(signed.signatures[0]!),meta=structuredClone(f.tx.meta!);
  const failedAttempt=failed&&i<33;
  if(failedAttempt)meta.err={InstructionError:[0,'InvalidArgument']};
  const row=meta.postTokenBalances![0]!;
  meta.preTokenBalances=i===0||failed?[]:[{...row,uiTokenAmount:{...row.uiTokenAmount,amount:String(i*1000000)}}];
  meta.postTokenBalances=[{...row,uiTokenAmount:{...row.uiTokenAmount,amount:String(failed?1000000:(i+1)*1000000)}}];
  transactions.set(signature,{...f.tx,slot:i+1,meta,transaction:{message:signed.message,signatures:[signature]}});
  orders.push({...f.engine.store.orders()[0]!,id:String(i)});
  attempts.push({...f.attempt,state:failedAttempt?'FAILED':'FINALIZED',id:String(i),orderId:String(i),signature,signedTransaction:Buffer.from(signed.serialize()).toString('base64')});
 }
 vi.spyOn(f.engine.store,'orders').mockReturnValue(orders);vi.spyOn(f.engine.store,'attempts').mockReturnValue(attempts);
 vi.mocked(f.connection.getTransaction).mockImplementation(async(signature)=>transactions.get(signature)!);
 vi.mocked(f.connection.getParsedTransaction).mockImplementation(async(signature)=>{const tx=transactions.get(signature)!;return {slot:tx.slot,blockTime:tx.blockTime,meta:tx.meta,transaction:{signatures:[signature],message:{accountKeys:[],instructions:[]}}} as unknown as ParsedTransactionWithMeta;});
 const account=await f.connection.getAccountInfoAndContext(PublicKey.default);
 const decoded=AccountLayout.decode(f.accountData);AccountLayout.encode({...decoded,amount:failed?1000000n:33000000n},f.accountData);
 vi.mocked(f.connection.getAccountInfoAndContext).mockResolvedValue({...account,context:{slot:100}});
 expect((await readProPortfolio(f.engine,f.mint)).rows[0]).toMatchObject({status:'UNAVAILABLE',reason:expect.stringMatching(/in progress/)});
 expect(f.connection.getTransaction).toHaveBeenCalledTimes(32);
 expect((await readProPortfolio(f.engine,f.mint)).rows[0]).toMatchObject({status:'READY',costBasisLamports:failed?'252044280':String(252044280n*33n),...(failed?{realizedPnlLamports:'-165000',unrecoveredLamports:'252044280'}:{})});
 expect(f.connection.getTransaction).toHaveBeenCalledTimes(failed?34:33);
});
it('bounds a stalled history RPC and does not start additional work after its deadline',async()=>{
 vi.useFakeTimers();const f=fixture();vi.mocked(f.connection.getTransaction).mockImplementation(()=>new Promise(()=>{}));
 const result=readProPortfolio(f.engine,f.mint);await vi.advanceTimersByTimeAsync(8000);
 expect((await result).rows[0]).toMatchObject({status:'UNAVAILABLE',reason:expect.stringMatching(/timed out/)});
 expect(f.connection.getTransaction).toHaveBeenCalledTimes(1);vi.useRealTimers();
});
it('authenticates portfolio reads, validates query scope and gates recovery by wallet/capabilities',async()=>{
 const f=fixture();let authorized=false;
 const server=createProServer(f.engine,{verify:async()=>{if(!authorized)throw Error('Unauthorized.');return 'device';},pair:async()=>({deviceId:'device',serverId:'server'}),capabilities:async()=>['mc-orders-v2']},'server');
 const invoke=(url:string,method='GET',body?:unknown)=>new Promise<{ok:boolean;data?:unknown;error?:string}>(resolve=>{const req=Object.assign(Readable.from(body?[JSON.stringify(body)]:[]),{method,url,headers:{}});const res={statusCode:200,setHeader(){},end(raw:string){resolve(JSON.parse(raw));}};server.emit('request',req,res);});
 expect(await invoke(`/v1/portfolio?mint=${f.mint}`)).toMatchObject({ok:false,error:'Unauthorized.'});authorized=true;
 expect(await invoke('/v1/info')).toMatchObject({ok:true,data:{capabilities:['chart-entry-v1','portfolio-v1','mc-orders-v2','recover-initials-preview-v1']}});
 expect(await invoke(`/v1/portfolio?mint=${f.mint}`)).toMatchObject({ok:true,data:{rows:[{status:'READY',costBasisLamports:'252044280'}]}});
 for(const path of ['/v1/portfolio?wallet=other',`/v1/portfolio?mint=${f.mint}&mint=${f.mint}`,'/v1/portfolio?mint=bad'])expect(await invoke(path)).toMatchObject({ok:false,error:'Invalid portfolio mint.'});
 expect(await invoke('/v2/recover-initials/preview','POST',{expectedWallet:'other',spec:{}})).toMatchObject({ok:false,error:'Reviewed signing wallet changed.'});
});

it('does not advertise a portfolio reader when the market is absent',async()=>{
 const engine={store:{},wallet:PublicKey.default.toBase58()} as unknown as ProEngine;
 const server=createProServer(engine,{verify:async()=>'',pair:async()=>({deviceId:'d',serverId:'s'})},'s');
 const result=await new Promise<unknown>(resolve=>{const req=Object.assign(Readable.from([]),{method:'GET',url:'/v1/info',headers:{}});server.emit('request',req,{statusCode:200,setHeader(){},end(body:string){resolve(JSON.parse(body));}});});
 expect(result).toEqual({ok:true,data:{serverId:'s',apiVersion:1}});
});
