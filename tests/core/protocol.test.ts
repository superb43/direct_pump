import { Buffer } from 'buffer';
import BN from 'bn.js';
import { describe, expect, it, vi } from 'vitest';
import { Connection, PublicKey, Keypair, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createApproveInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { getPumpProgram, PUMP_SDK, PUMP_PROGRAM_ID, bondingCurvePda } from '@pump-fun/pump-sdk';
import { OFFLINE_PUMP_AMM_PROGRAM, PUMP_AMM_SDK, canonicalPumpPoolPda, pumpPoolAuthorityPda, buyQuoteInput, type SwapSolanaState } from '@pump-fun/pump-swap-sdk';
import { replaceBuyInstruction, assertSolQuote, resolveRoute } from '../../src/protocol';
import { readableCoder } from '../../src/coder';
import { validateInstructions, type Policy } from '../../src/security';

const wallet = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
const mint = new PublicKey('7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump');
const fee = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const buyback = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
const connection = new Connection('https://api.mainnet-beta.solana.com');
const coder = getPumpProgram(connection).coder.instruction;
const policy: Policy = { wallet, mint, baseProgram: TOKEN_2022_PROGRAM_ID, venue: 'PUMP_CURVE', routeAccount: bondingCurvePda(mint), creator: wallet, side: 'BUY', input: 100_000_000n, minimum: 950n, feeRecipients: [fee], buybackRecipients: [buyback] };

async function curveBuy() {
  const ix = await PUMP_SDK.getBuyV2InstructionRaw({ user: wallet, mint, creator: wallet, amount: new BN(1000), quoteAmount: new BN(100_000_000), feeRecipient: fee, buybackFeeRecipient: buyback });
  return replaceBuyInstruction([ix], PUMP_PROGRAM_ID, 'buyV2', 'buyExactQuoteInV2', policy.input, policy.minimum, coder);
}

describe('official SDK exact-budget instruction', () => {
  it('keeps all curve accounts and encodes the exact budget/minimum with official IDL', async () => {
    const original = await PUMP_SDK.getBuyV2InstructionRaw({ user: wallet, mint, creator: wallet, amount: new BN(1000), quoteAmount: new BN(100_000_000), feeRecipient: fee, buybackFeeRecipient: buyback });
    const [exact] = replaceBuyInstruction([original], PUMP_PROGRAM_ID, 'buyV2', 'buyExactQuoteInV2', 100_000_000n, 950n, coder);
    expect(exact!.keys).toEqual(original.keys);
    const decoded = readableCoder(coder).decode(exact!.data)!;
    expect(decoded.name).toBe('buyExactQuoteInV2');
    expect(String(decoded.data.spendableQuoteIn)).toBe('100000000');
    expect(String(decoded.data.minTokensOut)).toBe('950');
  });
  it('encodes PumpSwap exact-input rather than its quote-input max-budget buy', () => {
    const amm = OFFLINE_PUMP_AMM_PROGRAM.coder.instruction;
    const ix = new TransactionInstruction({ programId: OFFLINE_PUMP_AMM_PROGRAM.programId, keys: [], data: amm.encode('buy', { baseAmountOut: new BN(1000), maxQuoteAmountIn: new BN(105_000_000), trackVolume: { 0: true } }) });
    const [exact] = replaceBuyInstruction([ix], ix.programId, 'buy', 'buyExactQuoteIn', 100_000_000n, 950n, amm);
    expect(String(readableCoder(amm).decode(exact!.data)!.data.spendableQuoteIn)).toBe('100000000');
  });
  it('fails closed on changed SDK layout or missing trade instruction', () => {
    expect(() => replaceBuyInstruction([], PUMP_PROGRAM_ID, 'buyV2', 'buyExactQuoteInV2', 100n, 50n, coder)).toThrow();
  });
});

describe('pre-signing transaction policy', () => {
  it('accepts the expected SDK trade', async () => {
    const awaited = await curveBuy();
    expect(() => validateInstructions(awaited, policy, connection)).not.toThrow();
  });
  it('rejects added SOL transfers, token approvals, foreign programs and extra signers', async () => {
    const instructions = await curveBuy();
    const malicious = [
      SystemProgram.transfer({ fromPubkey: wallet, toPubkey: fee, lamports: 1 }),
      createApproveInstruction(mint, fee, wallet, 1n),
      new TransactionInstruction({ programId: fee, keys: [], data: Buffer.alloc(0) }),
      new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: fee, isSigner: true, isWritable: true }], data: Buffer.from([17]) }),
    ];
    for (const ix of malicious) expect(() => validateInstructions([...instructions, ix], policy, connection)).toThrow();
  });
  it('rejects unknown fee recipients and an increased buy budget', async () => {
    const instructions = await curveBuy();
    expect(() => validateInstructions(instructions, { ...policy, feeRecipients: [] }, connection)).toThrow();
    expect(() => validateInstructions(instructions, { ...policy, input: 99_000_000n }, connection)).toThrow();
  });
  it('accepts actual PumpSwap buy/sell bundles including WSOL and missing ATAs', async () => {
    const poolKey = canonicalPumpPoolPda(mint);
    const state = {
      poolKey, poolAccountInfo: null, user: wallet, baseMint: mint,
      baseTokenProgram: TOKEN_2022_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
      userBaseTokenAccount: getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_2022_PROGRAM_ID),
      userQuoteTokenAccount: getAssociatedTokenAddressSync(NATIVE_MINT, wallet),
      userBaseAccountInfo: null, userQuoteAccountInfo: null,
      poolBaseAmount: new BN('1000000000000'), poolQuoteAmount: new BN('10000000000'),
      baseMintAccount: { supply: 1000000000000000n }, feeConfig: null,
      globalConfig: { protocolFeeRecipients: Array(8).fill(fee), buybackFeeRecipients: Array(8).fill(buyback), reservedFeeRecipients: Array(8).fill(fee), lpFeeBasisPoints: new BN(20), protocolFeeBasisPoints: new BN(5), coinCreatorFeeBasisPoints: new BN(30) },
      pool: { creator: pumpPoolAuthorityPda(mint), baseMint: mint, quoteMint: NATIVE_MINT,
        poolBaseTokenAccount: getAssociatedTokenAddressSync(mint, poolKey, true, TOKEN_2022_PROGRAM_ID),
        poolQuoteTokenAccount: getAssociatedTokenAddressSync(NATIVE_MINT, poolKey, true),
        coinCreator: wallet, isMayhemMode: false, isCashbackCoin: false, virtualQuoteReserves: new BN('-1000000'), creatorFeeBps: new BN(0) },
    } as SwapSolanaState;
    const amm = OFFLINE_PUMP_AMM_PROGRAM.coder.instruction;
    const buy = replaceBuyInstruction(await PUMP_AMM_SDK.buyInstructions(state, new BN(1000), new BN(100_000_000)), OFFLINE_PUMP_AMM_PROGRAM.programId, 'buy', 'buyExactQuoteIn', policy.input, policy.minimum, amm);
    const swapPolicy = { ...policy, venue: 'PUMP_SWAP' as const, routeAccount: poolKey };
    expect(() => validateInstructions(buy, swapPolicy, connection)).not.toThrow();
    const sell = await PUMP_AMM_SDK.sellInstructions(state, new BN(1000), new BN(950));
    expect(() => validateInstructions(sell, { ...swapPolicy, side: 'SELL', input: 1000n }, connection)).not.toThrow();
    const quote = (virtualQuoteReserves: BN) => buyQuoteInput({ quote: new BN(100_000_000), slippage: 0, baseReserve: state.poolBaseAmount, quoteReserve: state.poolQuoteAmount, virtualQuoteReserves, globalConfig: state.globalConfig, baseMintAccount: state.baseMintAccount, baseMint: mint, coinCreator: wallet, creator: state.pool.creator, feeConfig: null, quoteMint: NATIVE_MINT });
    expect(quote(new BN('-1000000')).base.gt(quote(new BN(0)).base)).toBe(true);
  });
});

describe('supported-route boundaries', () => {
  it('does not treat a USDC pair as SOL', () => {
    expect(() => assertSolQuote(NATIVE_MINT)).not.toThrow();
    expect(() => assertSolQuote(mint)).toThrow();
  });
  it('rejects a pool owned by an unsupported program before decoding', async () => {
    vi.spyOn(connection, 'getAccountInfo').mockResolvedValueOnce({ data: Buffer.alloc(0), executable: false, lamports: 0, owner: wallet, rentEpoch: 0 });
    await expect(resolveRoute(connection, { site: 'AXIOM', address: mint.toBase58(), kind: 'POOL', pageUrl: '' })).rejects.toThrow('PumpSwap');
    vi.restoreAllMocks();
  });
});
