import { Buffer } from 'buffer';
import { readFileSync } from 'node:fs';
import BN from 'bn.js';
import { beforeEach, expect, it, vi } from 'vitest';
import { Connection, PublicKey, Keypair, type AccountInfo } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, MintLayout } from '@solana/spl-token';
import { PUMP_SDK, PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, bondingCurvePda, getPumpProgram } from '@pump-fun/pump-sdk';
import { OFFLINE_PUMP_AMM_PROGRAM, canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { DEFAULT_SETTINGS, type PageTarget } from '../../src/model';
import { pageKey, targetKey } from '../../src/sites/catalog';
import { SITE_CONTEXTS } from '../fixtures/site-contexts';

const builders = vi.hoisted(() => ({ pump: vi.fn(), routed: vi.fn() }));
vi.mock('../../src/protocol', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/protocol')>(),
  buildPumpTrade: builders.pump,
}));
vi.mock('../../src/router', () => ({ buildRoutedTrade: builders.routed }));
import { resolveExecution } from '../../src/execution';
import { buildHybridTrade } from '../../src/hybrid';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/chain/pump-garage.json', import.meta.url), 'utf8'));
const mint = new PublicKey(fixture.mint), curve = new PublicKey(fixture.curve);
const foreign = Keypair.fromSeed(new Uint8Array(32).fill(8)).publicKey;
const wallet = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey;
const rpc = new Connection(DEFAULT_SETTINGS.rpcUrl);
const target: PageTarget = { site: 'AXIOM', kind: 'POOL', address: fixture.curve, mintHint: fixture.mint, pageUrl: `https://axiom.trade/meme/${fixture.curve}?chain=sol&chains=bnb` };
const accounts = new Map<string, AccountInfo<Buffer>>();
const curveInfo = (): AccountInfo<Buffer> => ({ data: Buffer.from(fixture.data, 'base64'), owner: new PublicKey(fixture.owner), executable: false, lamports: 1, rentEpoch: 0 });
const mintInfo = (isInitialized = true): AccountInfo<Buffer> => {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 1_000_000_000_000_000n, decimals: 6, isInitialized, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, data);
  return { ...curveInfo(), data, owner: TOKEN_2022_PROGRAM_ID };
};
async function setCurve(complete: boolean, quoteMint = PublicKey.default) {
  const decoded = PUMP_SDK.decodeBondingCurve(curveInfo());
  accounts.set(curve.toBase58(), { ...curveInfo(), data: await getPumpProgram(rpc).coder.accounts.encode('bondingCurve', { ...decoded, complete, quoteMint }) });
}
async function setGraduatedPool(quoteMint = NATIVE_MINT, baseMint = mint) {
  const pool = canonicalPumpPoolPda(mint, quoteMint);
  const data = await OFFLINE_PUMP_AMM_PROGRAM.coder.accounts.encode('pool', {
    poolBump: 0, index: 0, creator: wallet, baseMint, quoteMint,
    lpMint: foreign, poolBaseTokenAccount: foreign, poolQuoteTokenAccount: foreign,
    lpSupply: new BN(1), coinCreator: wallet, isMayhemMode: false, isCashbackCoin: false,
    virtualQuoteReserves: new BN(0), creatorFeeBps: new BN(0), canEditCreatorFee: false,
  });
  accounts.set(pool.toBase58(), { ...curveInfo(), data, owner: PUMP_AMM_PROGRAM_ID });
  return pool;
}
beforeEach(() => {
  vi.restoreAllMocks();
  builders.pump.mockReset().mockResolvedValue({ route: { venue: 'PUMP_CURVE' } });
  builders.routed.mockReset().mockResolvedValue({ route: { venue: 'JUPITER' } });
  accounts.clear();
  accounts.set(curve.toBase58(), curveInfo());
  accounts.set(mint.toBase58(), mintInfo());
  vi.spyOn(rpc, 'getAccountInfo').mockImplementation(async key => accounts.get(key.toBase58()) ?? null);
});

it('reproduces the public mint/curve relationship and decodes its pregraduation snapshot', () => {
  expect(bondingCurvePda(mint).equals(curve)).toBe(true);
  expect(PUMP_PROGRAM_ID.toBase58()).toBe(fixture.owner);
  expect(TOKEN_2022_PROGRAM_ID.toBase58()).toBe(fixture.mintOwner);
  expect(PUMP_SDK.decodeBondingCurve(curveInfo()).complete).toBe(false);
});

it.each(SITE_CONTEXTS)('resolves the same Pump curve on $site while preserving page and target identity', async ({ target: siteTarget }) => {
  const page = Object.freeze({ ...siteTarget, address: siteTarget.kind === 'POOL' ? fixture.curve : fixture.mint, mintHint: siteTarget.kind === 'POOL' ? fixture.mint : undefined });
  const original = { ...page }, originalPageKey = pageKey(page), originalTargetKey = targetKey(page);
  const route = await resolveExecution(rpc, page);
  expect(route).toMatchObject({ venue: 'PUMP_CURVE', mint, quoteMint: NATIVE_MINT, account: curve });
  expect(page).toEqual(original);
  expect(pageKey(page)).toBe(originalPageKey);
  expect(targetKey(page)).toBe(originalTargetKey);
  expect(rpc.getAccountInfo).toHaveBeenCalledTimes(2);
});

it('accepts a verified curve hint on mint pages and uses the shared Pump builder', async () => {
  const page: PageTarget = { ...target, site: 'FOMO', kind: 'MINT', address: fixture.mint, poolHint: fixture.curve };
  await buildHybridTrade(rpc, page, wallet, { side: 'BUY', sol: '0.1' }, DEFAULT_SETTINGS);
  expect(builders.pump).toHaveBeenCalledWith(rpc, expect.objectContaining({ venue: 'PUMP_CURVE', mint, account: curve }), wallet, { side: 'BUY', sol: '0.1' }, DEFAULT_SETTINGS);
  expect(builders.routed).not.toHaveBeenCalled();
});

it('waits for delayed mint metadata, resolves after it arrives and rejects hint drift before building', async () => {
  await expect(buildHybridTrade(rpc, { ...target, mintHint: undefined }, wallet, { side: 'BUY', sol: '0.1' }, DEFAULT_SETTINGS)).rejects.toThrow('Waiting for the page token mint');
  await expect(buildHybridTrade(rpc, { ...target, mintHint: foreign.toBase58() }, wallet, { side: 'BUY', sol: '0.1' }, DEFAULT_SETTINGS)).rejects.toThrow('does not match the token mint');
  expect(builders.pump).not.toHaveBeenCalled();
  expect(builders.routed).not.toHaveBeenCalled();
  await expect(resolveExecution(rpc, target)).resolves.toMatchObject({ venue: 'PUMP_CURVE', mint });
});

it.each([
  ['unknown owner', () => accounts.set(curve.toBase58(), { ...curveInfo(), owner: foreign })],
  ['executable curve', () => accounts.set(curve.toBase58(), { ...curveInfo(), executable: true })],
  ['truncated curve', () => accounts.set(curve.toBase58(), { ...curveInfo(), data: Buffer.alloc(48) })],
  ['wrong discriminator', () => { const info = curveInfo(); info.data[0] = info.data[0]! ^ 1; accounts.set(curve.toBase58(), info); }],
  ['missing mint', () => accounts.delete(mint.toBase58())],
  ['wrong mint owner', () => accounts.set(mint.toBase58(), { ...mintInfo(), owner: foreign })],
  ['executable mint', () => accounts.set(mint.toBase58(), { ...mintInfo(), executable: true })],
  ['uninitialized mint', () => accounts.set(mint.toBase58(), mintInfo(false))],
  ['invalid mint layout', () => accounts.set(mint.toBase58(), { ...mintInfo(), data: Buffer.alloc(1) })],
] as const)('rejects %s without calling any trade builder', async (_name, corrupt) => {
  corrupt();
  await expect(buildHybridTrade(rpc, target, wallet, { side: 'BUY', sol: '0.1' }, DEFAULT_SETTINGS)).rejects.toThrow();
  expect(builders.pump).not.toHaveBeenCalled();
  expect(builders.routed).not.toHaveBeenCalled();
});

it('keeps the graduation waiting error and resolves a ready canonical PumpSwap pool', async () => {
  await setCurve(true);
  await expect(resolveExecution(rpc, target)).rejects.toThrow('graduating');
  const pool = await setGraduatedPool();
  await expect(resolveExecution(rpc, target)).resolves.toMatchObject({ venue: 'PUMP_SWAP', mint, quoteMint: NATIVE_MINT, account: pool });
});

it('rejects a graduated pool with the wrong owner or mint', async () => {
  await setCurve(true);
  const pool = await setGraduatedPool(NATIVE_MINT, foreign);
  await expect(resolveExecution(rpc, target)).rejects.toThrow('Pool token mint does not match');
  accounts.set(pool.toBase58(), { ...accounts.get(pool.toBase58())!, owner: foreign });
  await expect(resolveExecution(rpc, target)).rejects.toThrow('pool owner does not match');
});

it('keeps existing Jupiter SOL-settlement policy for non-SOL curves before and after graduation', async () => {
  await setCurve(false, foreign);
  await expect(resolveExecution(rpc, target)).resolves.toMatchObject({ venue: 'JUPITER', mint, quoteMint: NATIVE_MINT, account: curve, routingReason: 'NON_SOL_PAIR' });
  await buildHybridTrade(rpc, target, wallet, { side: 'BUY', sol: '0.1' }, DEFAULT_SETTINGS);
  expect(builders.routed).toHaveBeenCalled();
  expect(builders.pump).not.toHaveBeenCalled();
  await setCurve(true, foreign);
  const pool = await setGraduatedPool(foreign);
  await expect(resolveExecution(rpc, target)).resolves.toMatchObject({ venue: 'JUPITER', account: pool, routingReason: 'NON_SOL_PAIR' });
});
