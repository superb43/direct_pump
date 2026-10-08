import { expect, it } from 'vitest';
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { buildTrade, resolveRoute } from '../src/protocol';
import { DEFAULT_SETTINGS } from '../src/model';
import { buildHybridTrade, resolveExecution } from '../src/hybrid';

// Explicit opt-in: public account reads + unsigned simulateTransaction only.
// No wallet provider, private key, signature or sendTransaction call is used.
it.skipIf(process.env.DIRECT_PUMP_READONLY_SMOKE !== '1')('resolves the previously reported MSTRx-paired mint', async () => {
  const rpc = new Connection(DEFAULT_SETTINGS.rpcUrl, 'confirmed');
  const mint = 'TvoocF7zk7fH1sYKgF9WtVLVKnj5M53AeYcXwmGpump';
  const route = await resolveRoute(rpc, { site: 'GMGN', kind: 'MINT', address: mint, pageUrl: `https://gmgn.ai/sol/token/${mint}` });
  expect(route.quoteMint.toBase58()).toBe('XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ');
}, 30_000);

it.skipIf(process.env.DIRECT_PUMP_READONLY_SMOKE !== '1')('builds and simulates a SOL mint with funded public fixture state', async () => {
  const rpc = new Connection(DEFAULT_SETTINGS.rpcUrl, 'confirmed');
  const global = await new OnlinePumpSdk(rpc).fetchGlobal();
  const candidates = [global.authority, global.withdrawAuthority, global.reservedFeeRecipient, ...global.reservedFeeRecipients, global.feeRecipient, ...global.feeRecipients].filter(key => PublicKey.isOnCurve(key.toBytes()));
  const accounts = await rpc.getMultipleAccountsInfo(candidates);
  const index = accounts.findIndex(account => account?.owner.equals(SystemProgram.programId) && account.lamports > 100_000_000);
  if (index < 0) throw new Error('No funded public fixture account is available for unsigned simulation.');
  const mint = process.env.DIRECT_PUMP_SMOKE_MINT ?? '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
  const target = { site: 'GMGN' as const, kind: 'MINT' as const, address: mint, pageUrl: `https://gmgn.ai/sol/token/${mint}` };
  const built = await buildTrade(rpc, target, candidates[index]!, { side: 'BUY', sol: '0.01' }, DEFAULT_SETTINGS);
  expect(built.input).toBe(10_000_000n);
  expect(built.minimum > 0n).toBe(true);
  console.info('READ_ONLY_SIMULATION_PASS', { mint, venue: built.route.venue, bytes: built.transaction.serialize().length });
}, 60_000);

it.skipIf(process.env.DIRECT_PUMP_READONLY_SMOKE !== '1')('builds and simulates a direct Raydium CPMM swap with a page-bound pool', async () => {
  const rpc = new Connection(DEFAULT_SETTINGS.rpcUrl, 'confirmed');
  const global = await new OnlinePumpSdk(rpc).fetchGlobal();
  const candidates = [global.authority, global.withdrawAuthority, global.reservedFeeRecipient, ...global.reservedFeeRecipients, global.feeRecipient, ...global.feeRecipients].filter(key => PublicKey.isOnCurve(key.toBytes()));
  const accounts = await rpc.getMultipleAccountsInfo(candidates);
  const index = accounts.findIndex(account => account?.owner.equals(SystemProgram.programId) && account.lamports > 100_000_000);
  if (index < 0) throw new Error('No funded public fixture account is available.');
  const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const target = { site: 'GMGN' as const, kind: 'MINT' as const, address: mint, pageUrl: `https://gmgn.ai/sol/token/${mint}`, poolHint: '47hq28mcL7q5GhBg7epyGF2dnuJd4MKFt8QhT7CzYUp4' };
  const built = await buildHybridTrade(rpc, target, candidates[index]!, { side: 'BUY', amount: '0.01', paymentMint: 'So11111111111111111111111111111111111111112' }, DEFAULT_SETTINGS);
  expect(built.route.venue).toBe('RAYDIUM_CPMM'); expect(built.minimum > 0n).toBe(true);
  console.info('READ_ONLY_DIRECT_CPMM_PASS', { bytes: built.transaction.serialize().length });
}, 60_000);

// Route/state reads only: no Jupiter API key or transaction execution required.
it.skipIf(process.env.DIRECT_PUMP_READONLY_SMOKE !== '1')('SOL settlement resolves the reported WBTC pair and Meteora comparison', async () => {
  const rpc = new Connection(DEFAULT_SETTINGS.rpcUrl, 'confirmed');
  for (const [mint,pool,venue] of [
    ['9XKzy4KahcZaGJPJtz1PtqGPB3CiseoBrx7TcQhEpump','5a7QurJLARt146JajJYPe5nh6vLyFpN2QrHUSLqbsCZy','JUPITER'],
    ['GYu5QuXGKniVuxjqAG2AR9kja7roG5QoS8eQuFrLZ2z7','GDG2GPJ3aVQR4PCZGbPrQiTSb33T3oDa7hTKNnuUr1xh','JUPITER'],
    ['BrAQDWn9zqTXoyWBGkAr7ovCb6PQCRF57JqUQyuYoSC4','5PCLbLXtPFA5pgMV5xNz5cXJ623oXKoRqFTBeXihnWdH','METEORA_DAMM'],
  ]) {
    const route = await resolveExecution(rpc,{site:'GMGN',kind:'MINT',address:mint!,poolHint:pool,pageUrl:`https://gmgn.ai/sol/token/${mint}`});
    expect(route.venue).toBe(venue); expect(route.mint.toBase58()).toBe(mint); expect(route.quoteMint.toBase58()).toBe('So11111111111111111111111111111111111111112');
    console.info('SOL_SETTLEMENT_ROUTE_PASS',{mint,venue:route.venue});
  }
},30_000);
