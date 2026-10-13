import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { PublicKey, type AccountInfo } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { Buffer } from 'buffer';
import { DLMM_IDL } from './vendor/dlmm-idl';

export const DLMM_PROGRAM_ID = new PublicKey(DLMM_IDL.address);
const coder = new BorshAccountsCoder(DLMM_IDL);

/** Identify pool assets only. DLMM swaps use the validated Jupiter path. */
export function decodeDlmmPair(info: AccountInfo<Buffer>): { tokenX: PublicKey; tokenY: PublicKey } {
  if (!info.owner.equals(DLMM_PROGRAM_ID) || info.executable) throw new Error('DLMM pool owner does not match.');
  if (info.data.length !== coder.size('LbPair')) throw new Error('Unsupported DLMM pool account length.');
  let pair: { token_x_mint: PublicKey; token_y_mint: PublicKey };
  try { pair = coder.decode('LbPair', info.data); }
  catch { throw new Error('Unsupported DLMM pool discriminator or layout.'); }
  if (pair.token_x_mint.equals(pair.token_y_mint) || pair.token_x_mint.equals(PublicKey.default) || pair.token_y_mint.equals(PublicKey.default)) {
    throw new Error('Invalid DLMM pool token pair.');
  }
  return { tokenX: pair.token_x_mint, tokenY: pair.token_y_mint };
}

export function dlmmPriceVaults(info:AccountInfo<Buffer>):PublicKey[]{
  decodeDlmmPair(info);
  const pair=coder.decode('LbPair',info.data) as {reserve_x:PublicKey;reserve_y:PublicKey};
  return [pair.reserve_x,pair.reserve_y];
}

export function selectPoolMint(tokenA: PublicKey, tokenB: PublicKey, wanted?: PublicKey): PublicKey {
  if (wanted) {
    if (!wanted.equals(tokenA) && !wanted.equals(tokenB)) throw new Error('Pool does not contain the page token.');
    return wanted;
  }
  if (tokenA.equals(NATIVE_MINT) !== tokenB.equals(NATIVE_MINT)) return tokenA.equals(NATIVE_MINT) ? tokenB : tokenA;
  throw new Error('Pool token is ambiguous. A verified token mint hint is required.');
}
