import { it, expect, vi } from 'vitest';
import { Connection, PublicKey } from '@solana/web3.js';
import { MintLayout, TOKEN_PROGRAM_ID, NATIVE_MINT } from '@solana/spl-token';
import { RpcMarket } from '../../server/market';
import { buildOtherDirect } from '../../src/direct-venues';
import { usdUnits, type ProSpec } from '../../src/pro/contracts';
vi.mock('../../src/execution', () => ({ resolveExecution: vi.fn(async () => ({ venue: 'RAYDIUM_CPMM', mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), quoteMint: NATIVE_MINT, account: NATIVE_MINT })) }));
vi.mock('../../src/direct-venues', () => ({ buildOtherDirect: vi.fn(async (_rpc, _route, _wallet, _side, _input, slippage) => ({ minimum: slippage === 0 ? 1000000000n : 800000000n })) }));
vi.mock('../../src/direct-security', () => ({ validateDirectSwap: vi.fn(async () => { }) }));
it('coalesces identical observations and bounds concurrent quote work without refreshing cached timestamps',async()=>{
  const market=new RpcMarket({rpcEndpoint:'https://rpc.example'} as Connection,PublicKey.default);
  const quoteAt=Date.now(),releases:Array<()=>void>=[];
  const compute=vi.spyOn(market as unknown as {computeObservation:(spec:ProSpec)=>Promise<import('../../server/engine').Observation>},'computeObservation').mockImplementation(async()=>{
    await new Promise<void>(resolve=>releases.push(resolve));return{priceUsd:'1',solUsdMicros:usdUnits('1'),quoteAt,observedAt:quoteAt,solUsdAt:quoteAt,outputRaw:'100'};
  });
  const base={mint:'So11111111111111111111111111111111111111112',side:'BUY',amountRaw:'100',decimals:9,target:{address:'mint'}} as ProSpec;
  const a=market.observation(base),same=market.observation(base),b=market.observation({...base,amountRaw:'101'}),c=market.observation({...base,amountRaw:'102'});
  await Promise.resolve();expect(compute).toHaveBeenCalledTimes(2);releases.shift()!();await a;await same;
  await Promise.resolve();expect(compute).toHaveBeenCalledTimes(3);releases.splice(0).forEach(release=>release());await b;await c;
  expect((await market.observation(base)).quoteAt).toBe(quoteAt);expect(compute).toHaveBeenCalledTimes(3);market.close();
});
it('does not release a failed transaction until the failed status is finalized',async()=>{
  const status={err:{InstructionError:[0,'Custom']},confirmationStatus:'processed'};
  const rpc={rpcEndpoint:'https://rpc.example',getSignatureStatuses:vi.fn(async()=>({value:[status]}))} as unknown as Connection;
  const market=new RpcMarket(rpc,PublicKey.default);
  const attempt={signature:'fixture'} as import('../../src/pro/contracts').ProAttempt;
  const order={} as import('../../src/pro/contracts').ProOrder;
  expect((await market.reconcile(attempt,order)).state).toBe('UNKNOWN');status.confirmationStatus='confirmed';expect((await market.reconcile(attempt,order)).state).toBe('UNKNOWN');status.confirmationStatus='finalized';expect((await market.reconcile(attempt,order)).state).toBe('FAILED');
});
it('uses fee-inclusive expected mark independent of selected execution slippage', async () => { const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; const data = Buffer.alloc(82); MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 1000000n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, data); const rpc = { rpcEndpoint: 'https://rpc.example', getAccountInfo: vi.fn(async () => ({ data, owner: TOKEN_PROGRAM_ID, lamports: 1, executable: false, rentEpoch: 0 })), getMinimumBalanceForRentExemption: vi.fn(async () => 1) } as unknown as Connection; const market = new RpcMarket(rpc, PublicKey.default); vi.spyOn(market, 'solPrice').mockResolvedValue({ value: usdUnits('1'), at: Date.now() }); const spec: ProSpec = { kind: 'BRACKET', side: 'SELL', target: { site: 'GMGN', kind: 'MINT', address: mint, pageUrl: 'https://gmgn.ai' }, mint, amountRaw: '1000000', decimals: 6, expiresAt: Date.now() + 60000, slippageBps: 2000, priorityFeeLamports: 0, maxNetworkLamports: '10000', tpPriceUsd: '1.1', slPriceUsd: '0.9' }; expect((await market.observation(spec)).priceUsd).toBe('1.000000000000'); expect(vi.mocked(buildOtherDirect).mock.calls[0]?.[5]).toBe(0); });
it('retains MC attached-entry uncertainty until confirmed quantity and timestamp are available',async()=>{
  const rpc={rpcEndpoint:'https://rpc.example',getSignatureStatuses:vi.fn(async()=>({value:[{err:null,confirmationStatus:'finalized'}]})),getTransaction:vi.fn(async()=>null)} as unknown as Connection;
  const market=new RpcMarket(rpc,PublicKey.default);
  const attempt={signature:'fixture',solUsdUnits:usdUnits('100').toString()} as import('../../src/pro/contracts').ProAttempt;
  const order={spec:{side:'BUY',version:2,basis:'MC',exitStrategy:{durationMs:86400000,steps:[]}}} as unknown as import('../../src/pro/contracts').ProOrder;
  expect((await market.reconcile(attempt,order)).state).toBe('UNKNOWN');market.close();
});
it('expires a missing signature only with finalized expiry and covered wallet history',async()=>{
  const statuses=vi.fn(async()=>({value:[null]}));
  const rpc={rpcEndpoint:'https://rpc.example',getSignatureStatuses:statuses,getBlockHeight:vi.fn(async()=>1000),
    isBlockhashValid:vi.fn(async()=>({value:false})),getSignaturesForAddress:vi.fn(async()=>[{signature:'older',slot:10}]),
    getBlock:vi.fn(async()=>({blockHeight:100})),getTransaction:vi.fn(async()=>null)} as unknown as Connection;
  const market=new RpcMarket(rpc,PublicKey.default);
  const attempt={signature:'missing',blockhash:'saved-hash',lastValidBlockHeight:500} as import('../../src/pro/contracts').ProAttempt;
  expect((await market.reconcile(attempt,{} as import('../../src/pro/contracts').ProOrder)).state).toBe('EXPIRED');
  expect(statuses).toHaveBeenCalledTimes(2);expect(rpc.getTransaction).toHaveBeenCalledWith('missing',{commitment:'finalized',maxSupportedTransactionVersion:0});market.close();
});
it.each(['valid-height','valid-hash','uncovered','history-match','transaction-found'] as const)('retains missing-signature uncertainty with %s evidence',async evidence=>{
  const rpc={rpcEndpoint:'https://rpc.example',getSignatureStatuses:vi.fn(async()=>({value:[null]})),getBlockHeight:vi.fn(async()=>evidence==='valid-height'?500:1000),
    isBlockhashValid:vi.fn(async()=>({value:evidence==='valid-hash'})),getSignaturesForAddress:vi.fn(async()=>[{signature:evidence==='history-match'?'missing':'older',slot:10}]),
    getBlock:vi.fn(async()=>({blockHeight:evidence==='uncovered'?400:100})),getTransaction:vi.fn(async()=>evidence==='transaction-found'?{}:null)} as unknown as Connection;
  const market=new RpcMarket(rpc,PublicKey.default),attempt={signature:'missing',blockhash:'saved-hash',lastValidBlockHeight:500} as import('../../src/pro/contracts').ProAttempt;
  expect((await market.reconcile(attempt,{} as import('../../src/pro/contracts').ProOrder)).state).toBe('UNKNOWN');market.close();
});
it('retains a finalized status found by the repeated history lookup',async()=>{
  const rpc={rpcEndpoint:'https://rpc.example',getSignatureStatuses:vi.fn().mockResolvedValueOnce({value:[null]}).mockResolvedValueOnce({value:[{confirmationStatus:'finalized',err:null}]}),
    getBlockHeight:vi.fn(async()=>1000),isBlockhashValid:vi.fn(async()=>({value:false})),getSignaturesForAddress:vi.fn(async()=>[{signature:'older',slot:10}]),
    getBlock:vi.fn(async()=>({blockHeight:100}))} as unknown as Connection;
  const market=new RpcMarket(rpc,PublicKey.default),attempt={signature:'missing',blockhash:'saved-hash',lastValidBlockHeight:500} as import('../../src/pro/contracts').ProAttempt;
  expect((await market.reconcile(attempt,{spec:{side:'SELL'}} as import('../../src/pro/contracts').ProOrder)).state).toBe('FINALIZED');market.close();
});
