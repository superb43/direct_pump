import {afterEach,expect,it,vi} from 'vitest';
import {createChartEntryCache} from '../../src/chart/chart-entry-cache';
import {Connection,Keypair,PublicKey} from '@solana/web3.js';
import {AccountLayout,MintLayout,TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {DEFAULT_SETTINGS,type Receipt,type PositionSnapshot} from '../../src/model';
import {SITE_CONTEXTS} from '../fixtures/site-contexts';
const mocks=vi.hoisted(()=>({route:vi.fn(),history:vi.fn()}));
vi.mock('../../src/execution',()=>({resolveExecution:mocks.route}));
vi.mock('../../src/ledger',()=>({allReceipts:mocks.history}));
import {readPosition} from '../../src/portfolio/position';
function fixture(context=SITE_CONTEXTS[0]!){
 const wallet=Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey,mint=new PublicKey(context.target.mintHint??context.target.address),ata=getAssociatedTokenAddressSync(mint,wallet);
 const target={...context.target};
 const info=(data:Buffer)=>({data,owner:TOKEN_PROGRAM_ID,executable:false,lamports:2039280,rentEpoch:0});
 const mintData=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1000000000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},mintData);
 const token=(amount:bigint,owner=wallet)=>{const data=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint,owner,amount,delegateOption:0,delegate:PublicKey.default,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},data);return info(data);};
 const rpc=new Connection('https://rpc.test'),row={pubkey:ata,account:token(10n)};
 vi.spyOn(rpc,'getAccountInfo').mockResolvedValue(info(mintData));
 const balance=vi.spyOn(rpc,'getAccountInfoAndContext').mockResolvedValue({context:{slot:777},value:row.account});
 const accounts=vi.spyOn(rpc,'getTokenAccountsByOwner').mockRejectedValue(Error('403: Indexed requests require a personal token'));
 mocks.route.mockResolvedValue({mint,account:mint,venue:'JUPITER'});
 const receipt:Receipt={wallet:wallet.toBase58(),mint:mint.toBase58(),side:'BUY',venue:'JUPITER',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,status:'CONFIRMED',createdAt:1,feeReceipt:{state:'VERIFIED',checkedAt:1,note:'',protocolFees:[],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:true,executionSucceeded:true,tokenBeforeRaw:'0',tokenAfterRaw:'10',volumeLamports:'1000000000',totalNetworkLamports:'5000',usd:{priceMicros:'100000000',capturedAt:1,source:'Coinbase spot'}}};mocks.history.mockResolvedValue([receipt]);
 const options={cache:createChartEntryCache(),scope:'same-target'};
 const position:PositionSnapshot={wallet:wallet.toBase58(),mint:mint.toBase58(),balanceRaw:'10',decimals:6,supplyRaw:'1000000000000',updatedAt:Date.now(),balanceUpdatedAt:Date.now()};
 return {wallet,mint,ata,rpc,target,row,token,accounts,balance,options,position,receipt};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it.each(SITE_CONTEXTS)('$site publishes average entry from the existing balance even when owner searches are denied',async(context)=>{
 const f=fixture(context);
 const result=await readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,f.options);
 expect(result).toMatchObject({balanceRaw:'10',chartEntry:{balanceRaw:'10',priceUsd:'10000000.000000000000'}});
 expect(f.balance).toHaveBeenCalledExactlyOnceWith(f.ata,{commitment:'confirmed',minContextSlot:777});expect(f.accounts).not.toHaveBeenCalled();
});
it.each(SITE_CONTEXTS)('$site reuses fresh Holdings proof without an extra balance read or renewing its time',async(context)=>{
 vi.useFakeTimers();vi.setSystemTime(100_000);const f=fixture(context);vi.setSystemTime(104_999);
 const options={...f.options,balance:{position:f.position,slot:777,quoteReady:true}};
 const result=await readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,options);
 expect(result).toMatchObject({balanceUpdatedAt:100_000,chartEntry:{updatedAt:100_000,validUntil:130_000}});
 expect(f.balance).not.toHaveBeenCalled();expect(f.accounts).not.toHaveBeenCalled();
 vi.setSystemTime(105_000);const refreshed=await readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,options);
 expect(f.balance).toHaveBeenCalledOnce();expect(refreshed.chartEntry?.updatedAt).toBe(105_000);
});
it('suppresses entry on recorded quantity mismatch, full exit or a stale confirmed slot',async()=>{
 const f=fixture();f.balance.mockResolvedValue({context:{slot:777},value:f.token(11n)});
 const changed=await readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,f.options);
 expect(changed.balanceRaw).toBe('11');expect(changed.chartEntry).toBeUndefined();expect(changed.chartEntryNote).toContain('incomplete');
 f.balance.mockResolvedValue({context:{slot:776},value:f.row.account});
 expect((await readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,f.options)).chartEntry).toBeUndefined();
 f.balance.mockResolvedValue({context:{slot:777},value:null});
 expect((await readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,f.options)).balanceRaw).toBe('0');
 expect(f.options.cache.current(f.options.scope,f.position).entry).toBeUndefined();expect(f.accounts).not.toHaveBeenCalled();
});
it('rejects a foreign account owner and falls back from mismatched, stale or future shared balances',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100_000);const f=fixture();
 for(const position of [{...f.position,wallet:PublicKey.default.toBase58()},{...f.position,mint:PublicKey.default.toBase58()},{...f.position,supplyRaw:'1'},{...f.position,balanceUpdatedAt:100_001}]){
   const result=await readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,{...f.options,balance:{position,slot:777,quoteReady:true}});
   expect(result.balanceRaw).toBe('10');
 }
 await readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,{...f.options,balance:{position:f.position,slot:776,quoteReady:true}});
 expect(f.balance).toHaveBeenCalledTimes(5);
 f.balance.mockResolvedValue({context:{slot:777},value:f.token(10n,PublicKey.default)});
 await expect(readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true)).rejects.toThrow('ownership');
});
it('keeps prior proof within its original lifetime when a direct balance refresh fails',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100_000);const f=fixture();
 await readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,f.options);
 f.balance.mockRejectedValue(Error('429: rate limit'));vi.setSystemTime(115_000);
 await expect(readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,f.options)).rejects.toThrow('429');
 expect(f.options.cache.current(f.options.scope,f.position).entry?.updatedAt).toBe(100_000);
 vi.setSystemTime(130_000);expect(f.options.cache.current(f.options.scope,f.position).entry).toBeUndefined();
});
it('suppresses unresolved wallet transactions without starting an indexed request',async()=>{
 const f=fixture();const result=await readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,{...f.options,blocked:true});
 expect(result.chartEntry).toBeUndefined();expect(result.chartEntryNote).toContain('unresolved');expect(f.accounts).not.toHaveBeenCalled();
});
it('requires the direct balance slot to cover confirmed receipt facts even without a caller slot floor',async()=>{
 const f=fixture();f.receipt.feeReceipt!.slot=778;
 const result=await readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true,undefined,undefined,f.options);
 expect(result.chartEntry).toBeUndefined();expect(result.chartEntryNote).toContain('predates');expect(f.accounts).not.toHaveBeenCalled();
});
it('hides a line when Holdings already observes additional known-account inventory without changing the ATA sell quantity',async()=>{
 const f=fixture();const balance={position:{...f.position,balanceRaw:'110'},slot:777,quoteReady:false};
 const result=await readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,{...f.options,balance});
 expect(result.balanceRaw).toBe('10');expect(result.chartEntry).toBeUndefined();expect(result.chartEntryNote).toContain('differ');
 expect(f.balance).toHaveBeenCalledOnce();expect(f.accounts).not.toHaveBeenCalled();
});
it('projects a direct balance without worker options and preserves the legacy tracked-mint read',async()=>{
 const f=fixture();expect((await readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true)).chartEntry).toBeDefined();expect(f.accounts).not.toHaveBeenCalled();
 f.accounts.mockResolvedValue({context:{slot:777},value:[f.row]});
 expect((await readPosition(f.rpc,f.target,f.wallet,DEFAULT_SETTINGS,undefined,true,777,f.mint.toBase58(),f.options)).chartEntry).toBeDefined();expect(f.accounts).toHaveBeenCalledOnce();
});
