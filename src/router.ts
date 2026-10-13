import { Buffer } from 'buffer';
import BN from 'bn.js';
import { Connection, PublicKey, TransactionInstruction, SystemProgram, SystemInstruction, ComputeBudgetProgram, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { jupiterProgram } from './jupiter-coder';
import { jupiterIdl } from './vendor/jupiter-idl';
import type { Settings } from './model';
import { finalizeTrade, assertTransactionSize, TransactionSizeError } from './transactions';
import { readableCoder } from './coder';
import { instructionManifest } from './manifest';

type ApiInstruction = { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string };
export type BuildResponse = { inputMint: string; outputMint: string; inAmount: string; outAmount: string; otherAmountThreshold: string; swapMode: string; slippageBps: number; routePlan: { swapInfo: { ammKey: string; label: string; inputMint: string; outputMint: string } }[]; setupInstructions: ApiInstruction[]; swapInstruction: ApiInstruction; cleanupInstruction?: ApiInstruction | null; otherInstructions?: ApiInstruction[]; tipInstruction?: ApiInstruction | null; addressesByLookupTableAddress?: Record<string, string[]> | null; platformFee?: { feeBps?: number; amount?: string } | null };
export const JUPITER_BUILD_URL = 'https://api.jup.ag/swap/v2/build';
const EXACT_IN = new Set(['route', 'sharedAccountsRoute', 'routeV2', 'sharedAccountsRouteV2']);
const decode = (ix: ApiInstruction) => new TransactionInstruction({ programId: new PublicKey(ix.programId), keys: ix.accounts.map(account => ({ pubkey: new PublicKey(account.pubkey), isSigner: account.isSigner, isWritable: account.isWritable })), data: Buffer.from(ix.data, 'base64') });

export function validateRouterSwap(core: TransactionInstruction, wallet: PublicKey, input: PublicKey, output: PublicKey, amount: bigint, minimum: bigint, slippage: number, inputProgram: PublicKey, outputProgram: PublicKey, expected?: bigint) {
  if (!core.programId.equals(jupiterProgram.programId)) throw new Error('Router returned an unapproved swap program.');
  const coder = readableCoder(jupiterProgram.coder.instruction);
  let decoded;
  try { decoded = coder.decode(core.data); } catch { throw new Error('The Jupiter instruction format is not supported by the pinned decoder. No wallet request was made.'); }
  if (!decoded || !EXACT_IN.has(decoded.name)) throw new Error('Only decoded Jupiter exact-input routes are supported.');
  if (!coder.encode(decoded.name, decoded.data).equals(core.data)) throw new Error('Router instruction contains unparsed or inconsistent bytes.');
  const args = decoded.data as { inAmount: { toString(): string }; quotedOutAmount: { toString(): string }; slippageBps: number; platformFeeBps: number; positiveSlippageBps?: number; routePlan: { swap: Record<string, { shareFeeRate?: { toString(): string } }> }[] };
  if (BigInt(args.inAmount.toString()) !== amount || args.slippageBps !== slippage || args.platformFeeBps !== 0 || (expected !== undefined && BigInt(args.quotedOutAmount.toString()) !== expected) || (args.positiveSlippageBps ?? 0) !== 0) throw new Error('Router amount, slippage or fee does not match the request.');
  if (args.routePlan.some(leg => Object.values(leg.swap).some(swap => swap.shareFeeRate && BigInt(swap.shareFeeRate.toString()) !== 0n))) throw new Error('Router added a LaunchLab referral fee.');
  if (minimum <= 0n || !args.routePlan?.length) throw new Error('Router returned an invalid minimum output or empty path.');
  const quoted=BigInt(args.quotedOutAmount.toString()),factor=BigInt(10_000-slippage);
  let bound=quoted*factor/10_000n;
  // A one-atom floor/ceil difference must not weaken the promised minimum.
  // Strengthen the encoded quote instead of accepting a lower on-chain bound.
  if(expected!==undefined&&minimum===bound+1n&&minimum<=quoted&&factor>0n){
    const protectedQuote=(minimum*10_000n+factor-1n)/factor;
    if(protectedQuote<=18_446_744_073_709_551_615n){
      args.quotedOutAmount=new BN(protectedQuote.toString());
      core.data=coder.encode(decoded.name,args);
      bound=protectedQuote*factor/10_000n;
    }
  }
  if(bound<minimum)throw new Error(`Router on-chain output protection is weaker than the quote: transaction minimum ${bound}, quote minimum ${minimum}, difference ${minimum-bound} raw output units. No wallet request was made.`);
  const definition = jupiterIdl.instructions.find(ix => ix.name === decoded.name)!;
  const names: string[] = definition.accounts.map(account => account.name);
  const at = (name: string) => core.keys[names.indexOf(name)]?.pubkey;
  const key = (name: string, expected: PublicKey) => { if (!at(name)?.equals(expected)) throw new Error(`Router account binding failed (${name}).`); };
  const source = getAssociatedTokenAddressSync(input, wallet, false, inputProgram);
  const destination = getAssociatedTokenAddressSync(output, wallet, false, outputProgram);
  key('userTransferAuthority', wallet);
  key(names.includes('userSourceTokenAccount') ? 'userSourceTokenAccount' : 'sourceTokenAccount', source);
  key(names.includes('userDestinationTokenAccount') ? 'userDestinationTokenAccount' : 'destinationTokenAccount', destination);
  key('destinationMint', output); key('program', jupiterProgram.programId);
  key('eventAuthority', PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], jupiterProgram.programId)[0]);
  if (names.includes('sourceMint')) key('sourceMint', input);
  if (names.includes('sourceTokenProgram')) { key('sourceTokenProgram', inputProgram); key('destinationTokenProgram', outputProgram); }
  if (names.includes('userDestinationTokenAccount')) {
    const forwarded = at('destinationTokenAccount');
    if (!forwarded?.equals(jupiterProgram.programId) && !forwarded?.equals(destination)) throw new Error('Router redirects output to an unknown destination.');
  }
  if (core.keys.some(meta => meta.isSigner && !meta.pubkey.equals(wallet))) throw new Error('Router requires an additional signer.');
}

// RPC requests cannot be cancelled by web3.js; stop waiting and fence follow-up
// reads when the read-only quote deadline expires.
function quoteRead<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return read();
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    read().then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

async function validateRouterSetup(rpc: Connection, instructions: TransactionInstruction[], wallet: PublicKey, input: PublicKey, output: PublicKey, budget: bigint, routeMints: PublicKey[], signal?: AbortSignal) {
  const keys = [...new Map([input, output, ...routeMints].map(mint => [mint.toBase58(), mint])).values()];
  if (keys.length > 18) throw new Error('Router setup contains too many intermediate assets.');
  const mints = await quoteRead(() => rpc.getMultipleAccountsInfo(keys), signal);
  const programs = new Map<string, PublicKey>();
  for (let index = 0; index < keys.length; index++) {
    const info = mints[index];
    if (!info || (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('Router token program is not supported.');
    programs.set(keys[index]!.toBase58(), info.owner);
  }
  const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, wallet);
  let wrapped = 0n; let unwrapped = false;
  for (const ix of instructions) {
    if (ix.keys.some(meta => meta.isSigner && !meta.pubkey.equals(wallet))) throw new Error('Router setup requires an additional signer.');
    const at = (index: number, key: PublicKey) => { if (!ix.keys[index]?.pubkey.equals(key)) throw new Error('Router setup account binding failed.'); };
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      if (ix.keys.length !== 6 || ix.data.length > 1 || (ix.data.length === 1 && ix.data[0] !== 1)) throw new Error('Unknown router ATA operation.');
      at(0, wallet); at(2, wallet); at(4, SystemProgram.programId);
      const mint = ix.keys[3]?.pubkey; const program = mint && programs.get(mint.toBase58());
      if (!mint || !program) throw new Error('Router created an unexpected token account.');
      at(1, getAssociatedTokenAddressSync(mint, wallet, false, program)); at(5, program);
    } else if (ix.programId.equals(SystemProgram.programId)) {
      if (!input.equals(NATIVE_MINT) || SystemInstruction.decodeInstructionType(ix) !== 'Transfer') throw new Error('Unknown router SOL operation.');
      const transfer = SystemInstruction.decodeTransfer(ix);
      if (!transfer.fromPubkey.equals(wallet) || !transfer.toPubkey.equals(wsol)) throw new Error('Unknown router SOL recipient.');
      wrapped += BigInt(transfer.lamports); if (wrapped > budget) throw new Error('Router SOL transfer exceeds the budget.');
    } else if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      if (ix.data.length === 1 && ix.data[0] === 17 && ix.keys.length === 1) at(0, wsol);
      else if (ix.data.length === 1 && ix.data[0] === 9 && ix.keys.length === 3) { at(0, wsol); at(1, wallet); at(2, wallet); unwrapped = true; }
      else throw new Error('Unknown router token instruction.');
    } else throw new Error('Unknown program in router setup.');
  }
  if (output.equals(NATIVE_MINT) && !unwrapped) throw new Error('Router must unwrap the sale proceeds to native SOL.');
  return { inputProgram: programs.get(input.toBase58())!, outputProgram: programs.get(output.toBase58())! };
}

export async function prepareBuild(rpc: Connection, build: BuildResponse, wallet: PublicKey, input: PublicKey, output: PublicKey, amount: bigint, slippage: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (build.inputMint !== input.toBase58() || build.outputMint !== output.toBase58() || build.inAmount !== amount.toString() || build.swapMode !== 'ExactIn' || build.slippageBps !== slippage) throw new Error('Jupiter quote does not match the intended SOL trade.');
  if (build.tipInstruction || build.otherInstructions?.length || (build.platformFee?.feeBps ?? 0) !== 0 || BigInt(build.platformFee?.amount ?? '0') !== 0n) throw new Error('Router returned unexpected fees, tips or additional instructions.');
  if (!build.routePlan?.length || build.routePlan.length > 16) throw new Error('Jupiter did not return a supported route.');
  const routeMints = build.routePlan.flatMap(leg => [new PublicKey(leg.swapInfo.inputMint), new PublicKey(leg.swapInfo.outputMint)]);
  const minimum = BigInt(build.otherAmountThreshold), expected = BigInt(build.outAmount);
  if (expected <= 0n || minimum <= 0n || minimum > expected) throw new Error('Jupiter returned invalid output amounts.');
  const core = decode(build.swapInstruction);
  const before = build.setupInstructions.map(decode), after = build.cleanupInstruction ? [decode(build.cleanupInstruction)] : [];
  if (output.equals(NATIVE_MINT) && !after.some(ix => ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data.length === 1 && ix.data[0] === 9 && ix.keys[0]?.pubkey.equals(getAssociatedTokenAddressSync(NATIVE_MINT, wallet)))) throw new Error('Router must unwrap the sale proceeds after the swap.');
  const programs = await validateRouterSetup(rpc, [...before, ...after], wallet, input, output, amount, routeMints, signal);
  validateRouterSwap(core, wallet, input, output, amount, minimum, slippage, programs.inputProgram, programs.outputProgram, expected);
  const tables: AddressLookupTableAccount[] = [];
  for (const [address, expectedKeys] of Object.entries(build.addressesByLookupTableAddress ?? {})) {
    const table = (await quoteRead(() => rpc.getAddressLookupTable(new PublicKey(address)), signal)).value;
    if (!table || expectedKeys.some((key, index) => table.state.addresses[index]?.toBase58() !== key)) throw new Error('Router lookup table does not match on-chain data.');
    tables.push(table);
  }
  return { instructions: [...before, core, ...after], tables, minimum, expected, labels: build.routePlan.map(leg => leg.swapInfo.label) };
}

export async function buildRoutedTrade(rpc: Connection, route: { venue: 'JUPITER'; mint: PublicKey; quoteMint: PublicKey; account: PublicKey }, wallet: PublicKey, side: 'BUY' | 'SELL', inputAmount: bigint, settings: Settings) {
  if (!settings.jupiterApiKey) throw new Error('Add a Jupiter API key in Settings for automatic SOL routing. Direct SOL pairs need no key.');
  if (!route.quoteMint.equals(NATIVE_MINT)) throw new Error('Routed payment and receipt assets must be SOL.');
  const input = side === 'BUY' ? NATIVE_MINT : route.mint;
  const output = side === 'BUY' ? route.mint : NATIVE_MINT;
  // Metis's default mode optimizes price. Do not force a bridge asset, a venue,
  // a single hop, or latency-oriented mode=fast. Narrow account limits only
  // when the best unconstrained build cannot fit one atomic v0 transaction.
  for (const maxAccounts of [64, 48, 32, 24]) {
    const params = new URLSearchParams({ inputMint: input.toBase58(), outputMint: output.toBase58(), amount: inputAmount.toString(), taker: wallet.toBase58(), slippageBps: String(settings.slippageBps), platformFeeBps: '0', transactionVersion: '0', wrapAndUnwrapSol: 'true', maxAccounts: String(maxAccounts) });
    const response = await fetch(`${JUPITER_BUILD_URL}?${params}`, { headers: { 'x-api-key': settings.jupiterApiKey }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Jupiter API request failed (${response.status}). Check the API key, plan quota and available SOL routes.`);
    const prepared = await prepareBuild(rpc, await response.json() as BuildResponse, wallet, input, output, inputAmount, settings.slippageBps);
    try {
      const finalized = await finalizeTrade(rpc, prepared.instructions, wallet, settings, prepared.tables);
      return { ...finalized, route, input: inputAmount, minimum: prepared.minimum, expected: prepared.expected, routeLabels: prepared.labels, maxAccounts };
    } catch (error) {
      if (!(error instanceof TransactionSizeError) || maxAccounts === 24) throw error;
    }
  }
  throw new Error('No feasible atomic SOL route was found.');
}

/** Validated display estimate. Transaction feasibility is checked without signing,
 * a live blockhash, or simulation; execution must still use buildRoutedTrade. */
export async function quoteRoutedTrade(rpc: Connection, route: { venue: 'JUPITER'; mint: PublicKey; quoteMint: PublicKey; account: PublicKey }, wallet: PublicKey, side: 'BUY' | 'SELL', inputAmount: bigint, settings: Settings, signal?: AbortSignal) {
  if (!settings.jupiterApiKey) throw new Error('Add a Jupiter API key in Settings for automatic SOL routing. Direct SOL pairs need no key.');
  if (!route.quoteMint.equals(NATIVE_MINT)) throw new Error('Routed payment and receipt assets must be SOL.');
  const input = side === 'BUY' ? NATIVE_MINT : route.mint;
  const output = side === 'BUY' ? route.mint : NATIVE_MINT;
  const deadline = AbortSignal.timeout(15_000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (const maxAccounts of [64, 48, 32, 24]) {
    requestSignal.throwIfAborted();
    const params = new URLSearchParams({ inputMint: input.toBase58(), outputMint: output.toBase58(), amount: inputAmount.toString(), taker: wallet.toBase58(), slippageBps: String(settings.slippageBps), platformFeeBps: '0', transactionVersion: '0', wrapAndUnwrapSol: 'true', maxAccounts: String(maxAccounts) });
    const response = await fetch(`${JUPITER_BUILD_URL}?${params}`, { headers: { 'x-api-key': settings.jupiterApiKey }, signal: requestSignal });
    if (!response.ok) {
      const retry = response.headers.get('Retry-After');
      const seconds = retry !== null && retry.trim() !== '' ? Number(retry) : NaN;
      const retryAt = Number.isFinite(seconds) && seconds >= 0 ? Date.now() + seconds * 1000 : retry ? Date.parse(retry) : NaN;
      throw Object.assign(new Error(`Jupiter API request failed (${response.status}). Check the API key, plan quota and available SOL routes.`), { status: response.status, retryAt: Number.isFinite(retryAt) ? retryAt : undefined });
    }
    const build = await quoteRead(() => response.json() as Promise<BuildResponse>, requestSignal);
    const prepared = await prepareBuild(rpc, build, wallet, input, output, inputAmount, settings.slippageBps, requestSignal);
    try {
      // Values change instruction bytes, never their lengths. Match finalizeTrade's
      // two compute-budget instructions so account-limit fallback stays identical.
      const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }), ...prepared.instructions.filter(ix => !ix.programId.equals(ComputeBudgetProgram.programId))];
      const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: PublicKey.default.toBase58(), instructions }).compileToV0Message(prepared.tables));
      assertTransactionSize(transaction);
      return { route, input: inputAmount, minimum: prepared.minimum, expected: prepared.expected, routeLabels: prepared.labels, maxAccounts, feeManifest: instructionManifest(transaction.message, { addressLookupTableAccounts: prepared.tables }) };
    } catch (error) {
      if (!(error instanceof TransactionSizeError) || maxAccounts === 24) throw error;
    }
  }
  throw new Error('No feasible atomic SOL route was found.');
}
