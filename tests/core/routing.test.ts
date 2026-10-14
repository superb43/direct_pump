import { Buffer } from 'buffer';
import { expect, it } from 'vitest';
import BN from 'bn.js';
import { Connection, Keypair, PublicKey, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { CP_AMM_PROGRAM_ID } from '@meteora-ag/cp-amm-sdk';
import { jupiterProgram } from '../../src/jupiter-coder';
import { validateRouterSwap, buildRoutedTrade } from '../../src/router';
import { validateDirectSwap } from '../../src/direct-security';
import type { DirectSwapBundle, DirectRoute } from '../../src/direct-venues';
import { DEFAULT_SETTINGS } from '../../src/model';

const wallet = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
const token = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const pool = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
function routerIx(fee = 0, amount = 100) {
  const args = { routePlan: [{ swap: { Saber: {} }, percent: 100, inputIndex: 0, outputIndex: 1 }], inAmount: new BN(amount), quotedOutAmount: new BN(1000), slippageBps: 500, platformFeeBps: fee };
  return new TransactionInstruction({ programId: jupiterProgram.programId, keys: [TOKEN_PROGRAM_ID, wallet, getAssociatedTokenAddressSync(NATIVE_MINT, wallet), getAssociatedTokenAddressSync(token, wallet), jupiterProgram.programId, token, jupiterProgram.programId, PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], jupiterProgram.programId)[0], jupiterProgram.programId].map((pubkey, index) => ({ pubkey, isSigner: index === 1, isWritable: [2, 3].includes(index) })), data: jupiterProgram.coder.instruction.encode('route', args) });
}

it('accepts a fully decoded router order with zero platform fees and wallet-owned output', () => {
  expect(() => validateRouterSwap(routerIx(), wallet, NATIVE_MINT, token, 100n, 950n, 500, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID)).not.toThrow();
});

it('rejects router fee injection, altered amounts, trailing bytes and forwarded output', () => {
  for (const ix of [routerIx(1), routerIx(0, 101)]) expect(() => validateRouterSwap(ix, wallet, NATIVE_MINT, token, 100n, 950n, 500, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID)).toThrow();
  const trailing = routerIx(); trailing.data = Buffer.concat([trailing.data, Buffer.from([0])]);
  expect(() => validateRouterSwap(trailing, wallet, NATIVE_MINT, token, 100n, 950n, 500, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID)).toThrow();
  const forwarded = routerIx(); forwarded.keys[4]!.pubkey = pool;
  expect(() => validateRouterSwap(forwarded, wallet, NATIVE_MINT, token, 100n, 950n, 500, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID)).toThrow();
});

it('requires a user-supplied API key before making any routed build request', async () => {
  await expect(buildRoutedTrade(new Connection(DEFAULT_SETTINGS.rpcUrl), { venue: 'JUPITER', mint: token, quoteMint: NATIVE_MINT, account: token }, wallet, 'BUY', 100n, DEFAULT_SETTINGS)).rejects.toThrow('Jupiter API key');
});

it('binds direct Meteora swaps to the exact pool, payer, amounts and destination', async () => {
  const data = Buffer.alloc(24); Buffer.from([248,198,158,145,225,117,135,200]).copy(data); data.writeBigUInt64LE(100n, 8); data.writeBigUInt64LE(950n, 16);
  const accounts = [pool, pool, getAssociatedTokenAddressSync(NATIVE_MINT, wallet), getAssociatedTokenAddressSync(token, wallet), pool, pool, token, NATIVE_MINT, wallet, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, CP_AMM_PROGRAM_ID, pool, CP_AMM_PROGRAM_ID];
  const core = new TransactionInstruction({ programId: CP_AMM_PROGRAM_ID, keys: accounts.map((pubkey, index) => ({ pubkey, isSigner: index === 8, isWritable: [1,2,3,4,5].includes(index) })), data });
  const bundle: DirectSwapBundle = { instructions: [core], program: CP_AMM_PROGRAM_ID, input: 100n, minimum: 950n, poolIndex: 1, payerIndex: 8, inputAccountIndex: 2, outputAccountIndex: 3, referralIndex: 11, discriminator: [248,198,158,145,225,117,135,200], expectedAccounts: { 6: token, 7: NATIVE_MINT } };
  const route: DirectRoute = { venue: 'METEORA_DAMM', mint: token, quoteMint: NATIVE_MINT, account: pool };
  await expect(validateDirectSwap(bundle, route, wallet, 'BUY', 100n, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, 2_039_280)).resolves.toBeUndefined();
  core.keys[3]!.pubkey = pool;
  await expect(validateDirectSwap(bundle, route, wallet, 'BUY', 100n, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, 2_039_280)).rejects.toThrow('output account');
});
