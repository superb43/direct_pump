import {afterEach,expect,it,vi} from 'vitest';
import {Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction,Connection,type VersionedTransactionResponse,type ParsedTransactionWithMeta} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,MintLayout,TOKEN_PROGRAM_ID,AccountLayout} from '@solana/spl-token';
import {readProChartEntry} from '../../server/chart-entry';
import type {ProEngine} from '../../server/engine';
import type {ProOrder,ProAttempt} from '../../src/pro/contracts';
import bs58 from 'bs58';
import {Readable} from 'node:stream';
import {createProServer} from '../../server/api';
vi.mock('wxt/browser',()=>({browser:{storage:{local:{}},runtime:{getURL:(path:string)=>`chrome-extension://test/${path}`}}}));
import {allowedProRequest} from '../../src/pro/worker';
afterEach(()=>vi.useRealTimers());

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
 const engine={wallet:wallet.publicKey.toBase58(),market:{connection},store:{orders:()=>[order],attempts:()=>[attempt]}} as unknown as ProEngine;
 return {engine,mint:mint.toBase58(),attempt,connection,tx,accountData};
}
it('reconstructs actual chain spend excluding network/setup instead of requested amount',async()=>{
 const f=fixture();expect(await readProChartEntry(f.engine,f.mint)).toMatchObject({priceUsd:'25.000000000000',marketCapUsd:'25000000.000000000000',balanceRaw:'1000000'});expect(f.connection.getTokenAccountsByOwner).not.toHaveBeenCalled();
});
it('suppresses missing historical USD evidence without fetching a current price',async()=>{
 const f=fixture();delete f.attempt.solUsdUnits;expect(await readProChartEntry(f.engine,f.mint)).toHaveProperty('unavailable');
});
it('suppresses unresolved, unavailable, failed or mismatched transaction evidence',async()=>{
 const f=fixture();f.attempt.state='UNKNOWN';expect(await readProChartEntry(f.engine,f.mint)).toHaveProperty('unavailable');expect(f.connection.getTransaction).not.toHaveBeenCalled();
 f.attempt.state='FINALIZED';vi.mocked(f.connection.getTransaction).mockResolvedValue(null);expect(await readProChartEntry(f.engine,f.mint)).toHaveProperty('unavailable');
 vi.mocked(f.connection.getTransaction).mockResolvedValue(f.tx);f.tx.meta!.err={InstructionError:[0,'InvalidArgument']};expect(await readProChartEntry(f.engine,f.mint)).toHaveProperty('unavailable');
 f.tx.meta!.err=null;f.tx.transaction.message.recentBlockhash=Keypair.generate().publicKey.toBase58();expect(await readProChartEntry(f.engine,f.mint)).toHaveProperty('unavailable');
});
it('requires authentication and one mint query and exposes only the read-only route',async()=>{
 const f=fixture();let authorized=false;
 const server=createProServer(f.engine,{pair:async()=>({deviceId:'d',serverId:'s'}),verify:async()=>{if(!authorized)throw new Error('Unauthorized.');return 'd';}},'s');
 const invoke=(url:string)=>new Promise<{ok:boolean;data?:unknown;error?:string}>(resolve=>{const req=Object.assign(Readable.from([]),{method:'GET',url,headers:{}});const res={statusCode:200,setHeader(){},end(body:string){resolve(JSON.parse(body));}};server.emit('request',req,res);});
 const path=`/v1/chart-entry?mint=${f.mint}`;
 expect(await invoke(path)).toEqual({ok:false,error:'Unauthorized.'});authorized=true;
 expect(await invoke('/v1/info')).toMatchObject({ok:true,data:{capabilities:['chart-entry-v1','portfolio-v1']}});
 expect(await invoke(path)).toMatchObject({ok:true,data:{mint:f.mint,priceUsd:'25.000000000000'}});
 for(const bad of ['/v1/chart-entry',`${path}&mint=${f.mint}`,`${path}&wallet=other`])expect(await invoke(bad)).toMatchObject({ok:false,error:'Invalid chart entry mint.'});
 expect(allowedProRequest('GET',path)).toBe(true);
 for(const method of ['POST','PATCH','DELETE'])expect(allowedProRequest(method,path)).toBe(false);
 expect(allowedProRequest('GET',`${path}&wallet=other`)).toBe(false);
});
it('caches immutable finalized facts but checks fresh holdings and invalidates changed journal values',async()=>{
 const f=fixture();expect(await readProChartEntry(f.engine,f.mint)).toHaveProperty('priceUsd');
 expect(await readProChartEntry(f.engine,f.mint)).toHaveProperty('priceUsd');expect(f.connection.getTransaction).toHaveBeenCalledTimes(1);expect(f.connection.getAccountInfoAndContext).toHaveBeenCalledTimes(2);
 f.attempt.solUsdUnits='200000000000000';expect(await readProChartEntry(f.engine,f.mint)).toMatchObject({priceUsd:'50.000000000000'});expect(f.connection.getTransaction).toHaveBeenCalledTimes(2);
 const data=f.accountData,decoded=AccountLayout.decode(data);AccountLayout.encode({...decoded,amount:2000000n},data);
 expect(await readProChartEntry(f.engine,f.mint)).toHaveProperty('unavailable');expect(f.connection.getTransaction).toHaveBeenCalledTimes(2);
});
it('bounds a stalled historical RPC and starts no additional calls after the deadline',async()=>{
 vi.useFakeTimers();const f=fixture();vi.mocked(f.connection.getTransaction).mockImplementation(()=>new Promise(()=>{}));
 const reading=readProChartEntry(f.engine,f.mint);await vi.advanceTimersByTimeAsync(8000);
 expect(await reading).toHaveProperty('unavailable');expect(f.connection.getTransaction).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(8000);expect(f.connection.getTransaction).toHaveBeenCalledTimes(1);
});
it('suppresses stale balance slots, closed accounts and foreign account ownership',async()=>{
 const f=fixture(),balance=await f.connection.getAccountInfoAndContext(PublicKey.default);
 vi.mocked(f.connection.getAccountInfoAndContext).mockResolvedValue({...balance,context:{slot:0}});
 expect(await readProChartEntry(f.engine,f.mint)).toMatchObject({unavailable:'Wallet balance predates the confirmed transaction.'});
 vi.mocked(f.connection.getAccountInfoAndContext).mockResolvedValue({context:{slot:1},value:null});
 expect(await readProChartEntry(f.engine,f.mint)).toMatchObject({unavailable:'No open position.'});
 const decoded=AccountLayout.decode(f.accountData);AccountLayout.encode({...decoded,owner:PublicKey.default},f.accountData);
 vi.mocked(f.connection.getAccountInfoAndContext).mockResolvedValue(balance);
 expect(await readProChartEntry(f.engine,f.mint)).toMatchObject({unavailable:'Token balance ownership does not match.'});
 expect(f.connection.getTokenAccountsByOwner).not.toHaveBeenCalled();
});
