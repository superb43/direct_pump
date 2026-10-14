import {Buffer} from 'buffer';
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {Connection,Keypair,PublicKey,type AccountInfo} from '@solana/web3.js';
import {AccountLayout,MintLayout,NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import BN from 'bn.js';
import {GLOBAL_PDA,PUMP_FEE_CONFIG_PDA,PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,PUMP_SDK,OnlinePumpSdk,getSellSolAmountFromTokenAmount,bondingCurvePda} from '@pump-fun/pump-sdk';
import {GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,PUMP_AMM_PROGRAM_ID,PUMP_AMM_SDK,OFFLINE_PUMP_AMM_PROGRAM,OnlinePumpAmmSdk,canonicalPumpPoolPda,pumpPoolAuthorityPda,sellBaseInput} from '@pump-fun/pump-swap-sdk';
import {quotePumpSell,rememberPumpVaults} from '../../src/portfolio/pump-quote';
import {quotePosition,type DisplayRouteCache} from '../../src/portfolio/position';
import * as execution from '../../src/execution';
import {DEFAULT_SETTINGS} from '../../src/model';
import {SITE_CONTEXTS} from '../fixtures/site-contexts';

const wallet=Keypair.fromSeed(new Uint8Array(32).fill(21)).publicKey,mint=Keypair.fromSeed(new Uint8Array(32).fill(22)).publicKey;
const key=(seed:number)=>Keypair.fromSeed(new Uint8Array(32).fill(seed)).publicKey;
const info=(data:Buffer,owner=TOKEN_PROGRAM_ID):AccountInfo<Buffer>=>({data,owner,lamports:1,executable:false,rentEpoch:0});
function mintInfo(supply=1_000_000_000_000_000n){
 const data=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data);return info(data);
}
function vault(mint:PublicKey,owner:PublicKey,amount:bigint){
 const data=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint,owner,amount,delegateOption:0,delegate:PublicKey.default,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},data);return info(data);
}
let endpointSequence=0;
function connection(accounts:Map<string,AccountInfo<Buffer>>){
 const rpc=new Connection(`https://rpc.test/${++endpointSequence}`);
 const single=vi.spyOn(rpc,'getAccountInfo').mockImplementation(async address=>accounts.get(address.toBase58())??null);
 const batch=vi.spyOn(rpc,'getMultipleAccountsInfo').mockImplementation(async addresses=>addresses.map(address=>accounts.get(address.toBase58())??null));
 return {rpc,single,batch};
}
async function swapFixture(){
 const poolKey=canonicalPumpPoolPda(mint),baseVault=key(23),quoteVault=key(24);
 const pool={poolBump:0,index:0,creator:pumpPoolAuthorityPda(mint),baseMint:mint,quoteMint:NATIVE_MINT,lpMint:key(25),poolBaseTokenAccount:baseVault,poolQuoteTokenAccount:quoteVault,lpSupply:new BN(1),coinCreator:wallet,isMayhemMode:false,isCashbackCoin:false,virtualQuoteReserves:new BN(0),creatorFeeBps:new BN(0),canEditCreatorFee:false};
 const data=await OFFLINE_PUMP_AMM_PROGRAM.coder.accounts.encode('pool',pool);
 const globalConfig={lpFeeBasisPoints:new BN(20),protocolFeeBasisPoints:new BN(5),coinCreatorFeeBasisPoints:new BN(30),creatorFeeConfigurable:false} as ReturnType<typeof PUMP_AMM_SDK.decodeGlobalConfig>;
 vi.spyOn(PUMP_AMM_SDK,'decodeGlobalConfig').mockReturnValue(globalConfig);
 const accounts=new Map([[poolKey.toBase58(),info(data,PUMP_AMM_PROGRAM_ID)],[GLOBAL_CONFIG_PDA.toBase58(),info(Buffer.alloc(1),PUMP_AMM_PROGRAM_ID)],
  [mint.toBase58(),mintInfo()],[NATIVE_MINT.toBase58(),mintInfo()],[baseVault.toBase58(),vault(mint,poolKey,1_000_000_000_000n)],[quoteVault.toBase58(),vault(NATIVE_MINT,poolKey,10_000_000_000n)]]);
 const route={venue:'PUMP_SWAP' as const,mint,account:poolKey,quoteMint:NATIVE_MINT};
 return {...connection(accounts),accounts,route,baseVault,quoteVault};
}
afterEach(()=>vi.restoreAllMocks());

it('matches the existing PumpSwap SDK fee/impact estimate with two batches instead of four requests and no wallet reads',async()=>{
 const {rpc,single,batch,route}=await swapFixture(),amount=100_000_000n;
 await rpc.getAccountInfo(mint); // The old quote path read this before the SDK read it again.
 const s=await new OnlinePumpAmmSdk(rpc).swapSolanaState(route.account,wallet);
 const expected=sellBaseInput({base:new BN(amount.toString()),slippage:0,baseReserve:s.poolBaseAmount,quoteReserve:s.poolQuoteAmount,virtualQuoteReserves:s.pool.virtualQuoteReserves,globalConfig:s.globalConfig,baseMintAccount:s.baseMintAccount,baseMint:s.baseMint,coinCreator:s.pool.coinCreator,creator:s.pool.creator,feeConfig:s.feeConfig,quoteMint:s.pool.quoteMint,isMayhemMode:s.pool.isMayhemMode,creatorFeeBps:s.pool.creatorFeeBps}).uiQuote;
 expect(single.mock.calls.length+batch.mock.calls.length).toBe(4);
 single.mockClear();batch.mockClear();
 expect(await quotePumpSell(rpc,route,amount)).toBe(BigInt(expected.toString()));
 expect(single).not.toHaveBeenCalled();expect(batch).toHaveBeenCalledTimes(2);
 const addresses=batch.mock.calls.flatMap(([addresses])=>addresses.map(address=>address.toBase58()));
 expect(addresses).toHaveLength(6);expect(addresses.filter(address=>address===mint.toBase58())).toHaveLength(1);
 expect(addresses).not.toContain(s.userBaseTokenAccount.toBase58());expect(addresses).not.toContain(s.userQuoteTokenAccount.toBase58());
 batch.mockClear();expect(await quotePumpSell(rpc,route,amount)).toBe(BigInt(expected.toString()));
 expect(batch).toHaveBeenCalledTimes(1);expect(batch.mock.calls[0]![0]).toHaveLength(6);
});

it('matches the curve SDK estimate in one batch instead of four requests without a user ATA read',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('../fixtures/chain/pump-garage.json',import.meta.url),'utf8'));
 const mint=new PublicKey(fixture.mint),curve=new PublicKey(fixture.curve);
 const global={creatorFeeConfigurable:false} as ReturnType<typeof PUMP_SDK.decodeGlobal>;
 const feeConfig={feeTiers:[{marketCapLamportsThreshold:new BN(0),fees:{lpFeeBps:new BN(0),protocolFeeBps:new BN(95),creatorFeeBps:new BN(5)}}]} as ReturnType<typeof PUMP_SDK.decodeFeeConfig>;
 vi.spyOn(PUMP_SDK,'decodeGlobal').mockReturnValue(global);vi.spyOn(PUMP_SDK,'decodeFeeConfig').mockReturnValue(feeConfig);
 const accounts=new Map([[mint.toBase58(),mintInfo()],[curve.toBase58(),info(Buffer.from(fixture.data,'base64'),PUMP_PROGRAM_ID)],
  [GLOBAL_PDA.toBase58(),info(Buffer.alloc(1),PUMP_PROGRAM_ID)],[PUMP_FEE_CONFIG_PDA.toBase58(),info(Buffer.alloc(1),PUMP_FEE_PROGRAM_ID)]]);
 const {rpc,single,batch}=connection(accounts),sdk=new OnlinePumpSdk(rpc),amount=100_000_000n;
 await rpc.getAccountInfo(mint);
 const [g,f,state]=await Promise.all([sdk.fetchGlobal(),sdk.fetchFeeConfig(),sdk.fetchBuyState(mint,wallet)]);
 const expected=getSellSolAmountFromTokenAmount({global:g,feeConfig:f,mintSupply:new BN('1000000000000000'),bondingCurve:state.bondingCurve,amount:new BN(amount.toString())});
 expect(single.mock.calls.length+batch.mock.calls.length).toBe(4);single.mockClear();batch.mockClear();
 expect(await quotePumpSell(rpc,{venue:'PUMP_CURVE',mint,account:curve},amount)).toBe(BigInt(expected.toString()));
 expect(single).not.toHaveBeenCalled();expect(batch).toHaveBeenCalledTimes(1);expect(batch.mock.calls[0]![0]).toHaveLength(4);
});

it.each(SITE_CONTEXTS)('preserves the $site position identity, confirmed inventory and network cost projection',async({target})=>{
 const {rpc,route,batch}=await swapFixture();
 const page={...target,address:target.kind==='POOL'?route.account.toBase58():mint.toBase58(),mintHint:mint.toBase58()};
 const position={wallet:wallet.toBase58(),mint:mint.toBase58(),balanceRaw:'100000000',decimals:6,supplyRaw:'1000000000000000',updatedAt:Date.now(),costBasisSolLamports:'5000'};
 const priced=await quotePosition(rpc,page,wallet,DEFAULT_SETTINGS,position,true,route,{skipUsd:true});
 expect(priced.quoteIssue).toBeUndefined();expect(BigInt(priced.expectedExitLamports!)).toBeGreaterThan(0n);
 expect(priced).toMatchObject({wallet:position.wallet,mint:position.mint,balanceRaw:position.balanceRaw,costBasisSolLamports:'5000',exitNetworkLamports:String(5000+DEFAULT_SETTINGS.priorityFeeLamports),exitSetupLamports:'0'});
 batch.mockClear();
 const refreshed=await quotePosition(rpc,page,wallet,DEFAULT_SETTINGS,{...position},true,{...route},{skipUsd:true});
 expect(refreshed.expectedExitLamports).toBe(priced.expectedExitLamports);expect(batch).toHaveBeenCalledTimes(1);
 const drift=await quotePosition(rpc,page,wallet,DEFAULT_SETTINGS,position,true,{...route,mint:key(26)},{skipUsd:true});
 expect(drift.expectedExitLamports).toBeUndefined();expect(drift.quoteIssue?.message).toContain('different token');
 await expect(quotePosition(rpc,page,key(27),DEFAULT_SETTINGS,position,true,route)).rejects.toThrow('identity');
});

it('uses verified trade addresses on the first quote and keeps wallet, target and RPC bindings separate',async()=>{
 const {rpc,route,baseVault,quoteVault,batch,accounts}=await swapFixture();
 const target={site:'GMGN' as const,kind:'MINT' as const,address:mint.toBase58(),pageUrl:`https://gmgn.ai/sol/token/${mint}`};
 const binding={wallet:wallet.toBase58(),target};
 rememberPumpVaults(rpc,route,{base:baseVault,quote:quoteVault},binding);
 await quotePumpSell(rpc,route,100n,binding);expect(batch).toHaveBeenCalledTimes(1);
 for(const changed of [{...binding,wallet:key(26).toBase58()},{...binding,target:{...target,poolHint:route.account.toBase58()}}]){
  batch.mockClear();await quotePumpSell(rpc,route,100n,changed);expect(batch).toHaveBeenCalledTimes(2);
 }
 const other=connection(accounts);await quotePumpSell(other.rpc,route,100n,binding);expect(other.batch).toHaveBeenCalledTimes(2);
});

it('ignores stale cached reserves when a pool changes vault addresses and reuses the new addresses next time',async()=>{
 const {rpc,route,accounts,batch}=await swapFixture();
 const first=await quotePumpSell(rpc,route,100_000_000n);
 const original=accounts.get(route.account.toBase58())!,pool=PUMP_AMM_SDK.decodePool(original),base=key(29),quote=key(30);
 accounts.set(route.account.toBase58(),{...original,data:await OFFLINE_PUMP_AMM_PROGRAM.coder.accounts.encode('pool',{...pool,poolBaseTokenAccount:base,poolQuoteTokenAccount:quote})});
 accounts.set(base.toBase58(),vault(mint,route.account,1_000_000_000_000n));accounts.set(quote.toBase58(),vault(NATIVE_MINT,route.account,30_000_000_000n));
 batch.mockClear();const changed=await quotePumpSell(rpc,route,100_000_000n);
 expect(changed).toBeGreaterThan(first);expect(batch).toHaveBeenCalledTimes(2);
 expect(batch.mock.calls[1]![0].map(address=>address.toBase58())).toEqual([base.toBase58(),quote.toBase58()]);
 batch.mockClear();expect(await quotePumpSell(rpc,route,100_000_000n)).toBe(changed);expect(batch).toHaveBeenCalledTimes(1);
});

it('does not accept or save a seeded vault pair that differs from the current pool',async()=>{
 const {rpc,route,batch}=await swapFixture();rememberPumpVaults(rpc,route,{base:key(29),quote:key(30)});
 expect(await quotePumpSell(rpc,route,100_000_000n)).toBeGreaterThan(0n);expect(batch).toHaveBeenCalledTimes(2);
 batch.mockClear();await quotePumpSell(rpc,route,100n);expect(batch).toHaveBeenCalledTimes(1);
});
it('reuses only the display route descriptor and still reads current pricing state',async()=>{
 const {rpc,route,batch}=await swapFixture(),resolve=vi.spyOn(execution,'resolveExecution').mockResolvedValue(route),routeCache:DisplayRouteCache={};
 const target={site:'GMGN' as const,kind:'MINT' as const,address:mint.toBase58(),pageUrl:`https://gmgn.ai/sol/token/${mint}`};
 const position={wallet:wallet.toBase58(),mint:mint.toBase58(),balanceRaw:'100000000',decimals:6,supplyRaw:'1000000000000000',updatedAt:Date.now()};
 const options={skipUsd:true,routeCache};
 const first=await quotePosition(rpc,target,wallet,DEFAULT_SETTINGS,position,true,undefined,options);
 expect(resolve).toHaveBeenCalledOnce();batch.mockClear();
 const next=await quotePosition(rpc,target,wallet,DEFAULT_SETTINGS,{...position},true,undefined,options);
 expect(next.expectedExitLamports).toBe(first.expectedExitLamports);expect(resolve).toHaveBeenCalledOnce();expect(batch).toHaveBeenCalledTimes(1);
 expect(routeCache.route).not.toHaveProperty('accountInfo');
});
it('re-resolves a graduated cached curve and verifies the current PumpSwap pool before pricing it',async()=>{
 const {rpc,route,accounts}=await swapFixture(),curve=bondingCurvePda(mint);
 const fixture=JSON.parse(readFileSync(new URL('../fixtures/chain/pump-garage.json',import.meta.url),'utf8'));
 const curveInfo=info(Buffer.from(fixture.data,'base64'),PUMP_PROGRAM_ID),decoded=PUMP_SDK.decodeBondingCurve(curveInfo);
 vi.spyOn(PUMP_SDK,'decodeBondingCurve').mockReturnValue({...decoded,complete:true});accounts.set(curve.toBase58(),curveInfo);
 const resolve=vi.spyOn(execution,'resolveExecution').mockResolvedValue(route),routeCache:DisplayRouteCache={route:{venue:'PUMP_CURVE',mint,account:curve,quoteMint:NATIVE_MINT}};
 const target={site:'GMGN' as const,kind:'MINT' as const,address:mint.toBase58(),pageUrl:`https://gmgn.ai/sol/token/${mint}`};
 const position={wallet:wallet.toBase58(),mint:mint.toBase58(),balanceRaw:'100000000',decimals:6,supplyRaw:'1000000000000000',updatedAt:Date.now()};
 const priced=await quotePosition(rpc,target,wallet,DEFAULT_SETTINGS,position,true,undefined,{skipUsd:true,routeCache});
 expect(resolve).toHaveBeenCalledOnce();expect(priced.quoteIssue).toBeUndefined();expect(priced.pricePool).toBe(route.account.toBase58());expect(routeCache.route?.venue).toBe('PUMP_SWAP');
 expect(BigInt(priced.expectedExitLamports!)).toBeGreaterThan(0n);
});

it('reads changed reserves and fees afresh rather than retaining stale pricing state',async()=>{
 const {rpc,accounts,route,quoteVault}=await swapFixture();
 const first=await quotePumpSell(rpc,route,100_000_000n);
 accounts.set(quoteVault.toBase58(),vault(NATIVE_MINT,route.account,20_000_000_000n));
 const second=await quotePumpSell(rpc,route,100_000_000n);expect(second).toBeGreaterThan(first);
 vi.mocked(PUMP_AMM_SDK.decodeGlobalConfig).mockReturnValue({...PUMP_AMM_SDK.decodeGlobalConfig(accounts.get(GLOBAL_CONFIG_PDA.toBase58())!),protocolFeeBasisPoints:new BN(500)});
 expect(await quotePumpSell(rpc,route,100_000_000n)).toBeLessThan(second);
});

it('rejects missing pricing accounts, changed pool identity, foreign vault mints and RPC failure',async()=>{
 const {rpc,accounts,route,baseVault}=await swapFixture();
 const original=accounts.get(baseVault.toBase58())!;accounts.delete(baseVault.toBase58());
 await expect(quotePumpSell(rpc,route,100n)).rejects.toThrow('vault');
 accounts.set(baseVault.toBase58(),vault(key(26),route.account,100n));
 await expect(quotePumpSell(rpc,route,100n)).rejects.toThrow('identity');accounts.set(baseVault.toBase58(),original);
 await expect(quotePumpSell(rpc,{...route,mint:NATIVE_MINT},100n)).rejects.toThrow('identity');
 vi.mocked(rpc.getMultipleAccountsInfo).mockRejectedValueOnce(new Error('RPC 429'));
 await expect(quotePumpSell(rpc,route,100n)).rejects.toThrow('RPC 429');
 expect(accounts.has(PUMP_AMM_FEE_CONFIG_PDA.toBase58())).toBe(false); // Missing optional AMM fee config retains SDK behavior.
});

it('keeps a temporarily missing mint retryable without inventing a sell estimate',async()=>{
 const {rpc,accounts,route}=await swapFixture();accounts.delete(mint.toBase58());
 const position={wallet:wallet.toBase58(),mint:mint.toBase58(),balanceRaw:'100',decimals:6,supplyRaw:'1000000000000000',updatedAt:Date.now()};
 const target={site:'GMGN' as const,kind:'MINT' as const,address:mint.toBase58(),pageUrl:`https://gmgn.ai/sol/token/${mint}`};
 const priced=await quotePosition(rpc,target,wallet,DEFAULT_SETTINGS,position,true,route,{skipUsd:true});
 expect(priced.expectedExitLamports).toBeUndefined();expect(priced.quoteIssue).toMatchObject({retryable:true});
});

it.each(['completed','non-SOL'] as const)('rejects a curve that became %s after route resolution',async change=>{
 const fixture=JSON.parse(readFileSync(new URL('../fixtures/chain/pump-garage.json',import.meta.url),'utf8'));
 const mint=new PublicKey(fixture.mint),curve=new PublicKey(fixture.curve),curveInfo=info(Buffer.from(fixture.data,'base64'),PUMP_PROGRAM_ID);
 const decoded=PUMP_SDK.decodeBondingCurve(curveInfo);
 vi.spyOn(PUMP_SDK,'decodeBondingCurve').mockReturnValue({...decoded,...change==='completed'?{complete:true}:{quoteMint:key(28)}});
 const {rpc}=connection(new Map([[mint.toBase58(),mintInfo()],[curve.toBase58(),curveInfo]]));
 await expect(quotePumpSell(rpc,{venue:'PUMP_CURVE',mint,account:curve},100n)).rejects.toThrow(change==='completed'?'completed':'SOL');
});
