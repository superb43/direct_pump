import {Buffer} from 'buffer';
import {expect,it,vi} from 'vitest';
import {Connection,Keypair,PublicKey} from '@solana/web3.js';
import {AccountLayout,MintLayout,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {CP_AMM_PROGRAM_ID} from '@meteora-ag/cp-amm-sdk';
import {readPortfolioBalances,type BalanceCache} from '../../src/portfolio/portfolio-balances';
import type {Receipt} from '../../src/model';

const wallet=Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey,mint=Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const info=(data:Buffer,owner=TOKEN_PROGRAM_ID)=>({data,owner,executable:false,lamports:2039280,rentEpoch:0});
function mintInfo(){const data=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data);return info(data);}
function tokenInfo(key:PublicKey,amount:bigint,owner=wallet){const data=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint:key,owner,amount,delegateOption:0,delegate:PublicKey.default,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},data);return info(data);}
const receipt=(mint:PublicKey):Receipt=>({wallet:wallet.toBase58(),mint:mint.toBase58(),symbol:'SI',pageUrl:`https://gmgn.ai/sol/token/${mint}`,venue:'PUMP_CURVE',side:'BUY',createdAt:1000,status:'CONFIRMED',message:'',blockhash:'',lastValidBlockHeight:1,feeReceipt:{state:'VERIFIED',checkedAt:0,note:'',protocolFees:[],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:true,executionSucceeded:true,tokenBeforeRaw:'0',tokenAfterRaw:'100',volumeLamports:'100000000',totalNetworkLamports:'1000000'}});
function fixture(){
 const rpc=new Connection('https://rpc.test'),ata=getAssociatedTokenAddressSync(mint,wallet);
 const accounts=new Map([[mint.toBase58(),mintInfo()],[ata.toBase58(),tokenInfo(mint,100n)]]);
 const batch=vi.spyOn(rpc,'getMultipleAccountsInfoAndContext').mockImplementation(async keys=>({context:{slot:100},value:keys.map(key=>accounts.get(key.toBase58())??null)}));
 const indexed=vi.spyOn(rpc,'getTokenAccountsByOwner').mockRejectedValue(Error('403: Indexed requests require a personal token'));
 return {rpc,accounts,batch,indexed,ata};
}
it('reads inventory before mint metadata without indexed scans and preserves balance, basis and holding time on public RPCs',async()=>{
 const {rpc,batch,indexed}=fixture();const rows=await readPortfolioBalances(rpc,wallet,[receipt(mint)],100);
 expect(batch).toHaveBeenCalledTimes(2);expect(batch.mock.calls[0]![0].map(key=>key.toBase58())).not.toContain(mint.toBase58());expect(indexed).not.toHaveBeenCalled();expect(batch.mock.calls[0]![1]).toEqual({commitment:'confirmed',minContextSlot:100});
 expect(rows[0]).toMatchObject({quoteReady:true,balanceSlot:100,holding:{position:{balanceRaw:'100',costBasisSolLamports:'101000000',openedAt:1000}}});
});
it('propagates a verified purchase average over liquidity-changed confirmed inventory',async()=>{
 const {rpc,accounts,ata}=fixture();accounts.set(ata.toBase58(),tokenInfo(mint,80n));
 const rows=await readPortfolioBalances(rpc,wallet,[receipt(mint)],100);
 expect(rows[0]).toMatchObject({holding:{position:{balanceRaw:'80',costBasisSolLamports:'80800000',costBasisEstimated:true,openedAt:1000}}});
 expect(rows[0]!.holding.position!.warning).toContain('LP/transfer');
});
it('omits confirmed zero balances and treats an RPC error as unavailable rather than zero',async()=>{
 const {rpc,accounts,batch,ata}=fixture();accounts.delete(ata.toBase58());expect(await readPortfolioBalances(rpc,wallet,[receipt(mint)])).toEqual([]);
 batch.mockRejectedValue(Error('RPC unavailable'));expect(await readPortfolioBalances(rpc,wallet,[receipt(mint)])).toMatchObject([{holding:{error:'RPC unavailable'},quoteReady:false}]);
});
it('recovers saved pools and recorded non-associated accounts without an indexed scan',async()=>{
 const {rpc,accounts}=fixture(),pool=Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey,other=Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey;
 const row={...receipt(mint),venue:'METEORA_DAMM' as const};const keys=Array<string>(14).fill(CP_AMM_PROGRAM_ID.toBase58());keys[1]=pool.toBase58();keys[2]=other.toBase58();keys[6]=mint.toBase58();keys[8]=wallet.toBase58();row.feeManifest=[{program:CP_AMM_PROGRAM_ID.toBase58(),accounts:keys,data:''}];
 accounts.set(other.toBase58(),tokenInfo(mint,50n));const rows=await readPortfolioBalances(rpc,wallet,[row]);
 expect(rows[0]!.target.poolHint).toBe(pool.toBase58());expect(rows[0]!.holding.position!.balanceRaw).toBe('150');expect(rows[0]!.quoteReady).toBe(false);
 accounts.set(other.toBase58(),tokenInfo(mint,50n,PublicKey.default));expect((await readPortfolioBalances(rpc,wallet,[row]))[0]!.holding.position!.balanceRaw).toBe('100');
});
it('reads Token-2022 associated accounts with the mint program, keeping the other ATA separate',async()=>{
 const {rpc,accounts,ata}=fixture();accounts.delete(ata.toBase58());accounts.set(mint.toBase58(),{...mintInfo(),owner:TOKEN_2022_PROGRAM_ID});
 const token2022=getAssociatedTokenAddressSync(mint,wallet,false,TOKEN_2022_PROGRAM_ID);accounts.set(token2022.toBase58(),{...tokenInfo(mint,100n),owner:TOKEN_2022_PROGRAM_ID});
 expect((await readPortfolioBalances(rpc,wallet,[receipt(mint)]))[0]!.holding.position!.balanceRaw).toBe('100');
});
it('uses the verified mint program on repeated reads and rescans both programs if mint ownership changes',async()=>{
 const {rpc,accounts,ata,batch}=fixture(),options={cache:new Map() as BalanceCache,slowMints:new Set<string>()};
 await readPortfolioBalances(rpc,wallet,[receipt(mint)],100,options);batch.mockClear();
 await readPortfolioBalances(rpc,wallet,[receipt(mint)],100,options);
 expect(batch.mock.calls[0]![0].map(key=>key.toBase58())).toEqual([ata.toBase58()]);
 accounts.delete(ata.toBase58());accounts.set(mint.toBase58(),{...mintInfo(),owner:TOKEN_2022_PROGRAM_ID});
 const newer=getAssociatedTokenAddressSync(mint,wallet,false,TOKEN_2022_PROGRAM_ID);accounts.set(newer.toBase58(),{...tokenInfo(mint,200n),owner:TOKEN_2022_PROGRAM_ID});
 expect((await readPortfolioBalances(rpc,wallet,[receipt(mint)],100,options))[0]!.holding.position!.balanceRaw).toBe('200');
 batch.mockClear();await readPortfolioBalances(rpc,wallet,[receipt(mint)],100,{...options,refresh:true});
 expect(batch.mock.calls[0]![0]).toHaveLength(2);
});
it('does not cache zero when the hinted ATA is empty and missing mint evidence hides a positive alternate ATA',async()=>{
 const {rpc,accounts,ata}=fixture(),options={cache:new Map() as BalanceCache,slowMints:new Set<string>()};
 await readPortfolioBalances(rpc,wallet,[receipt(mint)],100,options);
 accounts.delete(ata.toBase58());accounts.delete(mint.toBase58());
 const other=getAssociatedTokenAddressSync(mint,wallet,false,TOKEN_2022_PROGRAM_ID);
 accounts.set(other.toBase58(),{...tokenInfo(mint,200n),owner:TOKEN_2022_PROGRAM_ID});
 const rows=await readPortfolioBalances(rpc,wallet,[receipt(mint)],100,options);
 expect(rows[0]!.holding.error).toContain('mint is unavailable');expect(options.cache.has(mint.toBase58())).toBe(false);
 accounts.delete(other.toBase58());expect(await readPortfolioBalances(rpc,wallet,[receipt(mint)],100,options)).toEqual([]);
});
it('splits large tracked universes at the RPC limit without per-token calls',async()=>{
 const {rpc,accounts,batch}=fixture();const receipts=Array.from({length:40},(_,index)=>receipt(Keypair.fromSeed(new Uint8Array(32).fill(index+10)).publicKey));
 for(const row of receipts)accounts.set(row.mint,mintInfo());
 expect(await readPortfolioBalances(rpc,wallet,receipts)).toEqual([]);expect(batch).toHaveBeenCalledOnce();expect(batch.mock.calls.every(([keys])=>keys.length<=100)).toBe(true);
});
it('keeps free PublicNode batches within ten accounts even when many tracked tokens remain',async()=>{
 const {accounts}=fixture(),rpc=new Connection('https://solana-rpc.publicnode.com/');
 const receipts=Array.from({length:12},(_,index)=>receipt(Keypair.fromSeed(new Uint8Array(32).fill(index+10)).publicKey));
 for(const row of receipts){const key=new PublicKey(row.mint);accounts.set(row.mint,mintInfo());accounts.set(getAssociatedTokenAddressSync(key,wallet).toBase58(),tokenInfo(key,100n));}
 const batch=vi.spyOn(rpc,'getMultipleAccountsInfoAndContext').mockImplementation(async keys=>{if(keys.length>10)throw Error('403: Request blocked');return {context:{slot:100},value:keys.map(key=>accounts.get(key.toBase58())??null)};});
 const rows=await readPortfolioBalances(rpc,wallet,receipts,100);expect(rows).toHaveLength(12);expect(rows.every(row=>row.holding.position?.balanceRaw==='100')).toBe(true);expect(batch).toHaveBeenCalledTimes(5);expect(batch.mock.calls.every(([keys])=>keys.length<=10)).toBe(true);
});

it('caches confirmed zero balances for 60s, detects external reacquisition and bypasses cache on manual refresh',async()=>{
 const {rpc,accounts,batch,ata}=fixture();accounts.delete(ata.toBase58());
 const cache:BalanceCache=new Map(),options={cache,slowMints:new Set<string>()},start=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(start);
 try{
  expect(await readPortfolioBalances(rpc,wallet,[receipt(mint)],undefined,options)).toEqual([]);
  expect(batch).toHaveBeenCalledOnce();expect(batch.mock.calls[0]![0]).toHaveLength(2);
  accounts.set(ata.toBase58(),tokenInfo(mint,200n));clock.mockReturnValue(start+59_999);
  expect(await readPortfolioBalances(rpc,wallet,[receipt(mint)],undefined,options)).toEqual([]);expect(batch).toHaveBeenCalledOnce();
  clock.mockReturnValue(start+60_000);
  expect((await readPortfolioBalances(rpc,wallet,[receipt(mint)],undefined,options))[0]!.holding.position!.balanceRaw).toBe('200');
  accounts.delete(ata.toBase58());expect(await readPortfolioBalances(rpc,wallet,[receipt(mint)],undefined,{...options,refresh:true})).toEqual([]);
 }finally{clock.mockRestore();}
});
it('does not cache failures as zero and refreshes changed receipts immediately',async()=>{
 const {rpc,accounts,batch,ata}=fixture(),options={cache:new Map() as BalanceCache,slowMints:new Set<string>()};accounts.delete(ata.toBase58());
 batch.mockRejectedValueOnce(Error('RPC unavailable'));
 expect((await readPortfolioBalances(rpc,wallet,[receipt(mint)],undefined,options))[0]!.holding.error).toBe('RPC unavailable');expect(options.cache.size).toBe(0);
 expect(await readPortfolioBalances(rpc,wallet,[receipt(mint)],undefined,options)).toEqual([]);
 accounts.set(ata.toBase58(),tokenInfo(mint,200n));
 expect((await readPortfolioBalances(rpc,wallet,[{...receipt(mint),createdAt:2000}],undefined,options))[0]!.holding.position!.balanceRaw).toBe('200');
});
it('keeps dust balance timestamps unchanged while active holdings still refresh',async()=>{
 const {rpc,batch}=fixture(),options={cache:new Map() as BalanceCache,slowMints:new Set([mint.toBase58()])};
 const rows=await readPortfolioBalances(rpc,wallet,[receipt(mint)],undefined,options),at=rows[0]!.holding.position!.balanceUpdatedAt;
 batch.mockClear();expect((await readPortfolioBalances(rpc,wallet,[receipt(mint)],undefined,options))[0]!.holding.position!.balanceUpdatedAt).toBe(at);expect(batch).not.toHaveBeenCalled();
 options.slowMints.clear();await readPortfolioBalances(rpc,wallet,[receipt(mint)],undefined,options);expect(batch).toHaveBeenCalledTimes(2);
});

it('invalidates an older zero cache after a failed forced read so the next automatic read retries',async()=>{
 const {rpc,accounts,batch,ata}=fixture(),options={cache:new Map() as BalanceCache,slowMints:new Set<string>()};accounts.delete(ata.toBase58());
 expect(await readPortfolioBalances(rpc,wallet,[receipt(mint)],undefined,options)).toEqual([]);expect(options.cache.size).toBe(1);
 batch.mockRejectedValueOnce(Error('RPC unavailable'));
 expect((await readPortfolioBalances(rpc,wallet,[receipt(mint)],undefined,{...options,refresh:true}))[0]!.holding.error).toBe('RPC unavailable');expect(options.cache.size).toBe(0);
 accounts.set(ata.toBase58(),tokenInfo(mint,200n));expect((await readPortfolioBalances(rpc,wallet,[receipt(mint)],undefined,options))[0]!.holding.position!.balanceRaw).toBe('200');
});
it('keeps the oldest batch slot for shared chart proof and rejects stale RPC balances',async()=>{
 const {rpc,batch}=fixture();
 const read=batch.getMockImplementation()!;
 batch.mockImplementation(async(keys,config)=>{const result=await read(keys,config);return {...result,context:{slot:batch.mock.calls.length===1?100:120}};});
 expect((await readPortfolioBalances(rpc,wallet,[receipt(mint)],100))[0]!.balanceSlot).toBe(100);
 batch.mockImplementation(async(keys,config)=>({...await read(keys,config),context:{slot:99}}));
 const rows=await readPortfolioBalances(rpc,wallet,[receipt(mint)],100);
 expect(rows[0]!.holding.position).toBeUndefined();expect(rows[0]!.holding.error).toContain('predates');
});
it('preserves the balance read time when later mint metadata takes longer',async()=>{
 const {rpc,batch}=fixture(),read=batch.getMockImplementation()!;
 const clock=vi.spyOn(Date,'now').mockReturnValue(100_000);
 try{
  batch.mockImplementation(async(keys,config)=>{const response=await read(keys,config);if(batch.mock.calls.length===2)clock.mockReturnValue(120_000);return response;});
  const position=(await readPortfolioBalances(rpc,wallet,[receipt(mint)],100))[0]!.holding.position!;
  expect(position.updatedAt).toBe(120_000);expect(position.balanceUpdatedAt).toBe(100_000);
 }finally{clock.mockRestore();}
});
