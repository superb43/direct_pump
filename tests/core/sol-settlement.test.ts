import { Buffer } from 'buffer';
import { beforeEach, expect, it, vi } from 'vitest';
import BN from 'bn.js';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, MintLayout, AccountLayout, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { DEFAULT_SETTINGS } from '../../src/model';

const mocks = vi.hoisted(() => ({ direct: vi.fn(), native: vi.fn(), routed: vi.fn(), pool: vi.fn() }));
vi.mock('../../src/direct-venues', () => ({ resolveOtherDirect: mocks.direct, buildOtherDirect: vi.fn() }));
vi.mock('../../src/protocol', async original => ({ ...await original<typeof import('../../src/protocol')>(), buildPumpTrade: mocks.native }));
vi.mock('../../src/router', () => ({ buildRoutedTrade: mocks.routed }));
vi.mock('@pump-fun/pump-swap-sdk', async original => ({ ...await original<typeof import('@pump-fun/pump-swap-sdk')>(), PUMP_AMM_SDK: { decodePool: mocks.pool } }));
import { resolveExecution, buildHybridTrade } from '../../src/hybrid';

const mint = new PublicKey('9XKzy4KahcZaGJPJtz1PtqGPB3CiseoBrx7TcQhEpump');
const wbtc = new PublicKey('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
const wallet = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey;
const pool = new PublicKey('5a7QurJLARt146JajJYPe5nh6vLyFpN2QrHUSLqbsCZy');
const target = { site: 'GMGN' as const, kind: 'MINT' as const, address: mint.toBase58(), poolHint: pool.toBase58(), pageUrl: `https://gmgn.ai/sol/token/${mint}` };
const info = (owner: PublicKey, data = Buffer.alloc(0)) => ({ owner, data, lamports: 1, executable: false, rentEpoch: 0 });
const mintData = Buffer.alloc(MintLayout.span);
MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 1_000_000_000n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
const rpc = new Connection(DEFAULT_SETTINGS.rpcUrl);
beforeEach(() => {
  vi.restoreAllMocks(); mocks.direct.mockReset(); mocks.native.mockReset(); mocks.routed.mockReset().mockResolvedValue({ route: { venue: 'JUPITER' } });
  mocks.pool.mockReset().mockReturnValue({ baseMint: mint, quoteMint: wbtc });
  vi.spyOn(rpc, 'getAccountInfo').mockImplementation(async key => key.equals(pool) ? info(PUMP_AMM_PROGRAM_ID) : key.equals(mint) ? info(TOKEN_PROGRAM_ID, mintData) : null);
});
it('converts a canonical WBTC PumpSwap pair into whole-route SOL execution', async () => {
  const route = await resolveExecution(rpc, target);
  expect(route.venue).toBe('JUPITER'); expect(route.quoteMint.equals(NATIVE_MINT)).toBe(true); expect(route.mint.equals(mint)).toBe(true);
  await buildHybridTrade(rpc, target, wallet, { side: 'BUY', sol: '0.1' }, DEFAULT_SETTINGS);
  expect(mocks.routed).toHaveBeenCalledWith(rpc, expect.objectContaining({ venue: 'JUPITER' }), wallet, 'BUY', 100_000_000n, DEFAULT_SETTINGS);
  // No WBTC mint, ATA or balance was fetched.
  const calls = vi.mocked(rpc.getAccountInfo).mock.calls.map(([key]) => key.toBase58());
  expect(calls).not.toContain(wbtc.toBase58()); expect(mocks.native).not.toHaveBeenCalled();
});
it('keeps a native canonical PumpSwap pair direct', async () => {
  const canonical = canonicalPumpPoolPda(mint, NATIVE_MINT);
  mocks.pool.mockReturnValue({ baseMint: mint, quoteMint: NATIVE_MINT });
  vi.mocked(rpc.getAccountInfo).mockImplementation(async key => key.equals(canonical) ? info(PUMP_AMM_PROGRAM_ID) : key.equals(mint) ? info(TOKEN_PROGRAM_ID, mintData) : null);
  await buildHybridTrade(rpc, { ...target, poolHint: canonical.toBase58() }, wallet, { side: 'BUY', sol: '0.1' }, DEFAULT_SETTINGS);
  expect(mocks.native).toHaveBeenCalledWith(rpc, expect.objectContaining({ venue: 'PUMP_SWAP', account: canonical, mint }), wallet, { side: 'BUY', sol: '0.1' }, DEFAULT_SETTINGS);
  expect(mocks.routed).not.toHaveBeenCalled();
});
it('routes inverted/general PumpSwap pools without pretending target is base', async () => {
  mocks.pool.mockReturnValue({ baseMint: NATIVE_MINT, quoteMint: mint });
  const route = await resolveExecution(rpc, target);
  expect(route.venue).toBe('JUPITER'); expect(route.mint.equals(mint)).toBe(true); expect(route.quoteMint.equals(NATIVE_MINT)).toBe(true);
});
it('rejects pool-token mismatch, stale quote-asset buys and oversized SOL input before routing', async () => {
  mocks.pool.mockReturnValue({ baseMint: NATIVE_MINT, quoteMint: wbtc });
  await expect(resolveExecution(rpc, target)).rejects.toThrow('does not contain');
  await expect(buildHybridTrade(rpc, target, wallet, { side: 'BUY', amount: '0.1', paymentMint: wbtc.toBase58() }, DEFAULT_SETTINGS)).rejects.toThrow('now use SOL');
  await expect(buildHybridTrade(rpc, target, wallet, { side: 'BUY', sol: '2' }, { ...DEFAULT_SETTINGS, spendLimitsEnabled: true })).rejects.toThrow('Maximum buy');
  expect(mocks.routed).not.toHaveBeenCalled();
});
it('uses token balance percentage for sell and SOL as its routed output', async () => {
  const ata = getAssociatedTokenAddressSync(mint, wallet);
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint, owner: wallet, amount: 1_000_000n, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
  vi.mocked(rpc.getAccountInfo).mockImplementation(async key => key.equals(pool) ? info(PUMP_AMM_PROGRAM_ID) : key.equals(mint) ? info(TOKEN_PROGRAM_ID, mintData) : key.equals(ata) ? info(TOKEN_PROGRAM_ID, data) : null);
  await buildHybridTrade(rpc, target, wallet, { side: 'SELL', percent: 50 }, DEFAULT_SETTINGS);
  expect(mocks.routed).toHaveBeenCalledWith(rpc, expect.objectContaining({ quoteMint: NATIVE_MINT }), wallet, 'SELL', 500_000n, DEFAULT_SETTINGS);
});
it('routes non-SOL LaunchLab pairs and permits routing when indexed discovery is unavailable', async () => {
  const noHint = { ...target, poolHint: undefined };
  mocks.direct.mockResolvedValue({ venue: 'RAYDIUM_LAUNCHLAB', mint, quoteMint: wbtc, account: pool });
  expect((await resolveExecution(rpc, noHint)).venue).toBe('JUPITER');
  mocks.direct.mockRejectedValue(new Error('Indexed requests require a personal token.'));
  expect((await resolveExecution(rpc, noHint)).venue).toBe('JUPITER');
  mocks.direct.mockRejectedValue(new Error('Multiple pools are ambiguous.'));
  await expect(resolveExecution(rpc, noHint)).rejects.toThrow('ambiguous');
});
