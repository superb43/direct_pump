import { Connection, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import type { PageTarget, TokenInfo } from './model';
import { resolveExecution } from './execution';
import { userFacingError } from './errors';
import { tokenSymbol } from './token-metadata';
export { cleanSymbol, decodeLegacySymbol, tokenSymbol } from './token-metadata';

export async function readTokenInfo(rpc: Connection, target: PageTarget): Promise<TokenInfo> {
  let route;
  try { route = await resolveExecution(rpc, target); }
  catch (error) {
    if (target.kind !== 'MINT') throw error;
    const mint = new PublicKey(target.address);
    return { mint: mint.toBase58(), symbol: await tokenSymbol(rpc, mint), routeError: userFacingError(error) };
  }
  const mint = route.mint;
  let quoteMint: PublicKey | undefined = route.quoteMint;
  const symbol = await tokenSymbol(rpc, mint);
  if (quoteMint?.equals(PublicKey.default)) quoteMint = NATIVE_MINT;
  const quoteSymbol = quoteMint?.equals(NATIVE_MINT) ? 'SOL' : quoteMint ? await tokenSymbol(rpc, quoteMint) : undefined;
  return { venue: route.venue, mint: mint.toBase58(), symbol, quoteMint: quoteMint?.toBase58(), quoteSymbol };
}
