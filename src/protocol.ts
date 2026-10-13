import { instructionManifest } from './manifest';
import { Buffer } from 'buffer';
import BN from 'bn.js';
import {
  Connection, PublicKey, TransactionInstruction, TransactionMessage,
  VersionedTransaction, ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, unpackMint,
  unpackAccount, getAssociatedTokenAddressSync, getExtensionTypes, ExtensionType,
} from '@solana/spl-token';
import {
  PUMP_SDK, OnlinePumpSdk, PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID,
  bondingCurvePda, getPumpProgram, getBuyTokenAmountFromSolAmount,
  getSellSolAmountFromTokenAmount,
} from '@pump-fun/pump-sdk';
import {
  PUMP_AMM_SDK, OnlinePumpAmmSdk, OFFLINE_PUMP_AMM_PROGRAM,
  canonicalPumpPoolPda, buyQuoteInput, type SwapSolanaState,
} from '@pump-fun/pump-swap-sdk';
import { parseSol, parseUnits, sellAmount, minimumOutput } from './amounts';
import { validateInstructions, type Policy } from './security';
import { readableCoder } from './coder';
import { simulationFailure } from './simulation';
import type { PageTarget, TradeIntent, Settings } from './model';

const bn = (value: bigint) => new BN(value.toString());

export async function resolveRoute(connection: Connection, target: PageTarget) {
  const address = new PublicKey(target.address);
  const info = await connection.getAccountInfo(address);
  if (!info) throw new Error('No on-chain account was found at this address.');
  if (target.kind === 'POOL') {
    if (!info.owner.equals(PUMP_AMM_PROGRAM_ID)) {
      throw new Error('This address is not a supported PumpSwap pool.');
    }
    const pool = PUMP_AMM_SDK.decodePool(info);
    if (!canonicalPumpPoolPda(pool.baseMint, pool.quoteMint).equals(address)) {
      throw new Error('Direct PumpSwap execution currently requires a canonical pool.');
    }
    return { venue: 'PUMP_SWAP' as const, mint: pool.baseMint, quoteMint: pool.quoteMint, account: address };
  }
  assertTokenProgram(info.owner);
  const curveAddress = bondingCurvePda(address);
  const curveInfo = await connection.getAccountInfo(curveAddress);
  if (!curveInfo || !curveInfo.owner.equals(PUMP_PROGRAM_ID)) {
    throw new Error('This token has no supported Pump bonding curve.');
  }
  const curve = PUMP_SDK.decodeBondingCurve(curveInfo);
  const quoteMint = curve.quoteMint.equals(PublicKey.default) ? NATIVE_MINT : curve.quoteMint;
  if (!curve.complete) return { venue: 'PUMP_CURVE' as const, mint: address, quoteMint, account: curveAddress };
  const poolAddress = canonicalPumpPoolPda(address, quoteMint);
  const poolInfo = await connection.getAccountInfo(poolAddress);
  if (!poolInfo) throw new Error('The token is graduating. Retry when its pool is ready.');
  if (!poolInfo.owner.equals(PUMP_AMM_PROGRAM_ID)) throw new Error('PumpSwap pool owner does not match.');
  const pool = PUMP_AMM_SDK.decodePool(poolInfo);
  if (!pool.baseMint.equals(address)) throw new Error('Pool token mint does not match.');
  if (!pool.quoteMint.equals(quoteMint)) throw new Error('Graduated pool quote mint does not match the curve.');
  return { venue: 'PUMP_SWAP' as const, mint: address, quoteMint, account: poolAddress };
}

export function assertSolQuote(mint: PublicKey): void {
  if (!mint.equals(NATIVE_MINT)) throw new Error(`This pool is not paired with SOL. Quote mint: ${mint.toBase58()}. SOL pairs are currently supported.`);
}

export function assertTokenProgram(program: PublicKey): void {
  if (!program.equals(TOKEN_PROGRAM_ID) && !program.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error('Token program is not supported.');
  }
}

export function replaceBuyInstruction(
  instructions: TransactionInstruction[], program: PublicKey,
  originalName: string, exactName: string, input: bigint, minimum: bigint,
  coder: ReturnType<typeof getPumpProgram>['coder']['instruction'],
): TransactionInstruction[] {
  let replaced = 0;
  const output = instructions.map(ix => {
    if (!ix.programId.equals(program)) return ix;
    const decoded = readableCoder(coder).decode(ix.data);
    if (decoded?.name !== originalName) return ix;
    replaced++;
    const args = exactName === 'buyExactQuoteInV2'
      ? { spendableQuoteIn: bn(input), minTokensOut: bn(minimum) }
      : { spendableQuoteIn: bn(input), minBaseAmountOut: bn(minimum), trackVolume: { 0: true } };
    // Reuse the pinned SDK's complete account list; encode using its official IDL.
    const data = coder.encode(exactName, args);
    return new TransactionInstruction({ programId: ix.programId, keys: ix.keys, data });
  });
  if (replaced !== 1) throw new Error('The SDK buy instruction layout changed.');
  return output;
}

async function validateSwapAccounts(connection: Connection, state: SwapSolanaState) {
  if (!state.pool.baseMint.equals(state.baseMint)) {
    throw new Error('Pool pair information does not match.');
  }
  for (const [vault, mint, program] of [
    [state.pool.poolBaseTokenAccount, state.baseMint, state.baseTokenProgram],
    [state.pool.poolQuoteTokenAccount, state.pool.quoteMint, state.quoteTokenProgram],
  ] as const) {
    const expected = getAssociatedTokenAddressSync(mint, state.poolKey, true, program);
    if (!expected.equals(vault)) throw new Error('Pool vault address does not match.');
    const account = unpackAccount(vault, await connection.getAccountInfo(vault), program);
    if (!account.owner.equals(state.poolKey) || !account.mint.equals(mint)) {
      throw new Error('Pool vault owner or mint does not match.');
    }
  }
}

export async function buildTrade(
  connection: Connection, target: PageTarget, wallet: PublicKey,
  intent: TradeIntent, settings: Settings,
) {
  return buildPumpTrade(connection, await resolveRoute(connection, target), wallet, intent, settings);
}

/** Quotes use the fee-inclusive SDK expectation; execution keeps its slippage floor. */
export function pumpOutputBound(expected:bigint,slippageBps:number,quoteOnly=false):bigint{
  if(quoteOnly){if(expected<=0n||expected>18_446_744_073_709_551_615n)throw new Error('Invalid expected quote output.');return expected;}
  return minimumOutput(expected,slippageBps);
}

export async function buildPumpTrade(
  connection: Connection, route: Awaited<ReturnType<typeof resolveRoute>>, wallet: PublicKey,
  intent: TradeIntent, settings: Settings,
  options: { exactInput?: bigint; minimumOutput?: bigint; quoteOnly?: boolean } = {},
) {
  const mintInfo = await connection.getAccountInfo(route.mint);
  if (!mintInfo) throw new Error('Token mint account was not found.');
  assertTokenProgram(mintInfo.owner);
  const mint = unpackMint(route.mint, mintInfo, mintInfo.owner);
  const supportedExtensions = new Set([ExtensionType.MetadataPointer, ExtensionType.TokenMetadata]);
  if (getExtensionTypes(mint.tlvData).some(type => !supportedExtensions.has(type))) {
    throw new Error('Unsupported Token-2022 extension.');
  }
  const ata = getAssociatedTokenAddressSync(route.mint, wallet, false, mintInfo.owner);
  const accountInfo = await connection.getAccountInfo(ata);
  const balance = accountInfo ? unpackAccount(ata, accountInfo, mintInfo.owner).amount : 0n;
  const quoteInfo = await connection.getAccountInfo(route.quoteMint);
  if (!quoteInfo) throw new Error('Quote mint account was not found.');
  assertTokenProgram(quoteInfo.owner);
  const quote = unpackMint(route.quoteMint, quoteInfo, quoteInfo.owner);
  const nativeQuote = route.quoteMint.equals(NATIVE_MINT);
  if (intent.side === 'BUY' && 'sol' in intent && !nativeQuote) throw new Error(`This pool requires quote asset ${route.quoteMint.toBase58()}. Reload the panel to use its payment-asset amount.`);
  if (intent.side === 'BUY' && 'paymentMint' in intent && intent.paymentMint !== route.quoteMint.toBase58()) throw new Error('The selected payment asset does not match this pool.');
  const input = options.exactInput ?? (intent.side === 'BUY' ? parseUnits('amount' in intent ? intent.amount : intent.sol, quote.decimals) : sellAmount(balance, intent.percent));
  if (input <= 0n || intent.side === 'SELL' && input > balance) throw new Error('Insufficient reserved input balance.');
  const maximum = nativeQuote ? settings.maxBuySol : settings.maxQuoteBuyAmount;
  if (settings.spendLimitsEnabled && intent.side === 'BUY' && input > parseUnits(maximum, quote.decimals)) {
    throw new Error(`Maximum buy is ${maximum} units of the payment asset.`);
  }
  if (intent.side === 'BUY' && !nativeQuote) {
    const quoteAta = getAssociatedTokenAddressSync(route.quoteMint, wallet, false, quoteInfo.owner);
    const quoteAccount = await connection.getAccountInfo(quoteAta);
    const available = quoteAccount ? unpackAccount(quoteAta, quoteAccount, quoteInfo.owner).amount : 0n;
    if (available < input) throw new Error(`Insufficient payment-asset balance. Required ${input} raw units; available ${available}. Quote mint: ${route.quoteMint.toBase58()}.`);
  }
  let instructions: TransactionInstruction[];
  let policy: Policy;
  if (route.venue === 'PUMP_CURVE') {
    const online = new OnlinePumpSdk(connection);
    const [global, feeConfig, state] = await Promise.all([
      online.fetchGlobal(), online.fetchFeeConfig(),
      online.fetchBuyState(route.mint, wallet, mintInfo.owner),
    ]);
    if (state.bondingCurve.complete) throw new Error('The token graduated. Submit a new request from its current page.');
    if (!state.quoteMint.equals(route.quoteMint) || !state.quoteTokenProgram.equals(quoteInfo.owner)) throw new Error('Curve payment-asset information changed.');
    let minimum: bigint;
    if (intent.side === 'BUY') {
      const expected = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: bn(mint.supply), bondingCurve: state.bondingCurve, amount: bn(input), quoteMint: route.quoteMint });
      minimum = pumpOutputBound(BigInt(expected.toString()), settings.slippageBps, options.quoteOnly);
      if (options.minimumOutput && minimum < options.minimumOutput) minimum = options.minimumOutput;
      instructions = await PUMP_SDK.buyV2Instructions({ global, ...state, mint: route.mint, user: wallet, amount: expected, quoteAmount: bn(input), slippage: 0, tokenProgram: mintInfo.owner });
      instructions = replaceBuyInstruction(instructions, PUMP_PROGRAM_ID, 'buyV2', 'buyExactQuoteInV2', input, minimum, getPumpProgram(connection).coder.instruction);
    } else {
      const expected = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply: bn(mint.supply), bondingCurve: state.bondingCurve, amount: bn(input) });
      minimum = pumpOutputBound(BigInt(expected.toString()), settings.slippageBps, options.quoteOnly);
      if (options.minimumOutput && minimum < options.minimumOutput) minimum = options.minimumOutput;
      instructions = await PUMP_SDK.sellV2Instructions({ global, ...state, mint: route.mint, user: wallet, amount: bn(input), quoteAmount: bn(minimum), slippage: 0, tokenProgram: mintInfo.owner });
    }
    policy = { wallet, mint: route.mint, baseProgram: mintInfo.owner, quoteMint: route.quoteMint, quoteProgram: quoteInfo.owner, venue: route.venue, routeAccount: route.account, creator: state.bondingCurve.creator, side: intent.side, input, minimum,
      feeRecipients: state.bondingCurve.isMayhemMode ? [global.reservedFeeRecipient, ...global.reservedFeeRecipients] : [global.feeRecipient, ...global.feeRecipients], buybackRecipients: global.buybackFeeRecipients };
  } else {
    const state = await new OnlinePumpAmmSdk(connection).swapSolanaState(route.account, wallet);
    await validateSwapAccounts(connection, state);
    if (!state.poolKey.equals(route.account) || !state.baseMint.equals(route.mint) || !state.baseTokenProgram.equals(mintInfo.owner) || !state.pool.quoteMint.equals(route.quoteMint) || !state.quoteTokenProgram.equals(quoteInfo.owner) || !canonicalPumpPoolPda(state.baseMint, state.pool.quoteMint).equals(route.account)) throw new Error('Pool token information changed.');
    let minimum: bigint;
    if (intent.side === 'BUY') {
      const quote = buyQuoteInput({ quote: bn(input), slippage: 0, baseReserve: state.poolBaseAmount, quoteReserve: state.poolQuoteAmount, virtualQuoteReserves: state.pool.virtualQuoteReserves, globalConfig: state.globalConfig, baseMintAccount: state.baseMintAccount, baseMint: state.baseMint, coinCreator: state.pool.coinCreator, creator: state.pool.creator, feeConfig: state.feeConfig, quoteMint: state.pool.quoteMint, isMayhemMode: state.pool.isMayhemMode, creatorFeeBps: state.pool.creatorFeeBps });
      minimum = pumpOutputBound(BigInt(quote.base.toString()), settings.slippageBps, options.quoteOnly);
      if (options.minimumOutput && minimum < options.minimumOutput) minimum = options.minimumOutput;
      instructions = await PUMP_AMM_SDK.buyInstructions(state, quote.base, bn(input));
      instructions = replaceBuyInstruction(instructions, PUMP_AMM_PROGRAM_ID, 'buy', 'buyExactQuoteIn', input, minimum, OFFLINE_PUMP_AMM_PROGRAM.coder.instruction);
    } else {
      instructions = await PUMP_AMM_SDK.sellBaseInput(state, bn(input), settings.slippageBps / 100);
      const coder = readableCoder(OFFLINE_PUMP_AMM_PROGRAM.coder.instruction);
      const swap = instructions.find(ix => ix.programId.equals(PUMP_AMM_PROGRAM_ID) && coder.decode(ix.data)?.name === 'sell');
      const decoded = swap && coder.decode(swap.data);
      minimum = BigInt((decoded?.data as { minQuoteAmountOut: BN }).minQuoteAmountOut.toString());
      if (options.minimumOutput && minimum < options.minimumOutput && swap && decoded) {
        minimum = options.minimumOutput;
        (decoded.data as { minQuoteAmountOut: BN }).minQuoteAmountOut = bn(minimum);
        swap.data = OFFLINE_PUMP_AMM_PROGRAM.coder.instruction.encode(decoded.name, decoded.data);
      }
      if (minimum <= 0n) throw new Error('Insufficient liquidity.');
    }
    policy = { wallet, mint: route.mint, baseProgram: mintInfo.owner, quoteMint: route.quoteMint, quoteProgram: quoteInfo.owner, venue: route.venue, routeAccount: route.account, creator: state.pool.coinCreator, side: intent.side, input, minimum,
      feeRecipients: state.pool.isMayhemMode ? state.globalConfig.reservedFeeRecipients : state.globalConfig.protocolFeeRecipients, buybackRecipients: state.globalConfig.buybackFeeRecipients };
  }
  validateInstructions(instructions, policy, connection);
  const latestResponse = await connection.getLatestBlockhashAndContext('confirmed');
  const latest = latestResponse.value;
  const makeTransaction = (limit: number, microLamports: number) => new VersionedTransaction(
    new TransactionMessage({ payerKey: wallet, recentBlockhash: latest.blockhash, instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: limit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports }), ...instructions,
    ] }).compileToV0Message(),
  );
  const probe = makeTransaction(1_400_000, 0);
  if (probe.serialize().length > 1232) throw new Error('This transaction exceeds the supported size limit.');
  if (options.quoteOnly) return { transaction: probe, feeManifest: instructionManifest(probe.message), route, latest, observedSlot: latestResponse.context.slot, input, minimum: policy.minimum };
  const simulation = await connection.simulateTransaction(probe, { sigVerify: false, commitment: 'confirmed' });
  if (simulation.value.err) throw simulationFailure(simulation.value.err, simulation.value.logs, probe);
  if (!simulation.value.unitsConsumed) throw new Error('The RPC simulation response did not include unitsConsumed.');
  const units = Math.min(1_400_000, Math.ceil(simulation.value.unitsConsumed * 1.15));
  const microLamports = Math.floor(settings.priorityFeeLamports * 1_000_000 / units);
  const transaction = makeTransaction(units, microLamports);
  const finalSimulation = await connection.simulateTransaction(transaction, { sigVerify: false, commitment: 'confirmed' });
  if (finalSimulation.value.err) throw simulationFailure(finalSimulation.value.err, finalSimulation.value.logs, transaction);
  return { transaction, feeManifest: instructionManifest(transaction.message), route, latest, observedSlot: latestResponse.context.slot, input, minimum: policy.minimum };
}
