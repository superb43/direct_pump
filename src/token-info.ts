import { Buffer } from 'buffer';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, NATIVE_MINT, getTokenMetadata } from '@solana/spl-token';
import { PUMP_AMM_PROGRAM_ID, PUMP_SDK, bondingCurvePda } from '@pump-fun/pump-sdk';
import { PUMP_AMM_SDK } from '@pump-fun/pump-swap-sdk';
import type { PageTarget, TokenInfo } from './model';
import { resolveExecution } from './execution';
import { userFacingError } from './errors';

const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export function cleanSymbol(symbol: string): string | undefined {
  const clean = symbol.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '').trim().replace(/^\$/, '').slice(0, 24);
  return clean || undefined;
}

export function decodeLegacySymbol(data: Buffer, mint: PublicKey): string | undefined {
  if (data.length < 69 || data[0] !== 4 || !new PublicKey(data.subarray(33, 65)).equals(mint)) return undefined;
  let offset = 65;
  function string() {
    if (offset + 4 > data.length) throw new Error('Truncated metadata.');
    const length = data.readUInt32LE(offset); offset += 4;
    if (length > 1024 || offset + length > data.length) throw new Error('Invalid metadata string length.');
    const text = data.subarray(offset, offset + length).toString('utf8'); offset += length;
    return text;
  }
  try { string(); return cleanSymbol(string()); } catch { return undefined; }
}

export async function tokenSymbol(rpc: Connection, mint: PublicKey): Promise<string | undefined> {
  const account = await rpc.getAccountInfo(mint);
  if (!account) return undefined;
  if (account.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    const metadata = await getTokenMetadata(rpc, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
    if (metadata) return cleanSymbol(metadata.symbol);
  }
  if (!account.owner.equals(TOKEN_PROGRAM_ID) && !account.owner.equals(TOKEN_2022_PROGRAM_ID)) return undefined;
  const address = PublicKey.findProgramAddressSync([Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mint.toBuffer()], METADATA_PROGRAM)[0];
  const metadata = await rpc.getAccountInfo(address);
  return metadata?.owner.equals(METADATA_PROGRAM) ? decodeLegacySymbol(metadata.data, mint) : undefined;
}

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
