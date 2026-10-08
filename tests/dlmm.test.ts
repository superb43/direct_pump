import { Buffer } from 'buffer';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, MintLayout } from '@solana/spl-token';
import { decodeDlmmPair, DLMM_PROGRAM_ID, selectPoolMint } from '../src/dlmm';
import { DEFAULT_SETTINGS, type PageTarget } from '../src/model';

const mocks = vi.hoisted(() => ({ routed: vi.fn() }));
vi.mock('../src/router', () => ({ buildRoutedTrade: mocks.routed }));
import { resolveExecution } from '../src/execution';
import { buildHybridTrade } from '../src/hybrid';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/chain/dlmm-si.json', import.meta.url), 'utf8'));
const mint = new PublicKey(fixture.mint), pool = new PublicKey(fixture.pool);
const foreign = Keypair.fromSeed(new Uint8Array(32).fill(8)).publicKey;
const wallet = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey;
const poolInfo = () => ({ data: Buffer.from(fixture.data, 'base64'), owner: new PublicKey(fixture.owner), lamports: 1, executable: false, rentEpoch: 0 });
const mintData = Buffer.alloc(MintLayout.span);
MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 996_000_000_000_000n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
const target: PageTarget = { site: 'AXIOM', kind: 'POOL', address: pool.toBase58(), mintHint: mint.toBase58(), pageUrl: `https://axiom.trade/meme/${pool}?chain=sol` };
const rpc = new Connection(DEFAULT_SETTINGS.rpcUrl);
beforeEach(() => {
  vi.restoreAllMocks(); mocks.routed.mockReset().mockResolvedValue({ route: { venue: 'JUPITER' } });
  vi.spyOn(rpc, 'getAccountInfo').mockImplementation(async key => key.equals(pool) ? poolInfo() : key.equals(mint) ? { ...poolInfo(), data: mintData, owner: TOKEN_PROGRAM_ID } : null);
});

it('decodes a public SI/SOL pool with the pinned official account schema', () => {
  const pair = decodeDlmmPair(poolInfo());
  expect(pair.tokenX.equals(mint)).toBe(true);
  expect(pair.tokenY.equals(NATIVE_MINT)).toBe(true);
});

it('fails closed on another owner, executable account, discriminator or account length', () => {
  expect(() => decodeDlmmPair({ ...poolInfo(), owner: foreign })).toThrow('owner');
  expect(() => decodeDlmmPair({ ...poolInfo(), executable: true })).toThrow('owner');
  for (const data of [Buffer.alloc(8), Buffer.alloc(905)]) expect(() => decodeDlmmPair({ ...poolInfo(), data })).toThrow('length');
  const invalid = poolInfo(); invalid.data[0] = invalid.data[0]! ^ 1;
  expect(() => decodeDlmmPair(invalid)).toThrow('discriminator');
});

it('requires pool membership and an explicit token hint for two non-SOL assets', () => {
  expect(selectPoolMint(NATIVE_MINT, mint).equals(mint)).toBe(true);
  expect(selectPoolMint(mint, foreign, mint).equals(mint)).toBe(true);
  expect(() => selectPoolMint(mint, foreign)).toThrow('ambiguous');
  expect(() => selectPoolMint(mint, NATIVE_MINT, foreign)).toThrow('does not contain');
});

it('routes validated Axiom DLMM identity into the existing SOL Jupiter builder', async () => {
  const route = await resolveExecution(rpc, target);
  expect(route).toMatchObject({ venue: 'JUPITER', routingReason: 'DLMM_POOL' });
  expect(route.mint.equals(mint)).toBe(true);
  await buildHybridTrade(rpc, target, wallet, { side: 'BUY', sol: '0.1' }, DEFAULT_SETTINGS);
  expect(mocks.routed).toHaveBeenCalledWith(rpc, expect.objectContaining({ mint, quoteMint: NATIVE_MINT }), wallet, 'BUY', 100_000_000n, DEFAULT_SETTINGS);
  expect(target.kind).toBe('POOL'); expect(target.address).toBe(pool.toBase58());
});

it('recognizes the same mint from a FOMO URL with its verified pool hint', async () => {
  const route = await resolveExecution(rpc, { site: 'FOMO', kind: 'MINT', address: mint.toBase58(), poolHint: pool.toBase58(), pageUrl: `https://fomo.family/tokens/solana/${mint}` });
  expect(route.mint.equals(mint)).toBe(true); expect(route.venue).toBe('JUPITER');
});

it('rejects a mismatched DOM mint, invalid token account and unknown pool owner before building', async () => {
  await expect(buildHybridTrade(rpc, { ...target, mintHint: foreign.toBase58() }, wallet, { side: 'BUY', sol: '0.1' }, DEFAULT_SETTINGS)).rejects.toThrow('does not contain');
  vi.mocked(rpc.getAccountInfo).mockImplementation(async key => key.equals(pool) ? poolInfo() : { ...poolInfo(), owner: foreign });
  await expect(resolveExecution(rpc, target)).rejects.toThrow('Token program');
  vi.mocked(rpc.getAccountInfo).mockResolvedValue({ ...poolInfo(), owner: foreign });
  await expect(resolveExecution(rpc, target)).rejects.toThrow('not decoded');
  expect(mocks.routed).not.toHaveBeenCalled();
});

it('never decodes a different program as DLMM', () => {
  expect(DLMM_PROGRAM_ID.toBase58()).toBe(fixture.owner);
});
