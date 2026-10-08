import { Buffer } from 'buffer';
import BN from 'bn.js';
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY, type TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, NATIVE_MINT, unpackMint, getTransferFeeConfig } from '@solana/spl-token';
import { Raydium, TxVersion, LAUNCHPAD_PROGRAM, LAUNCHPAD_AUTH, CREATE_CPMM_POOL_PROGRAM, LaunchpadPool, CpmmPoolInfoLayout, anchorDataBuf, parseTokenAccountResp } from '@raydium-io/raydium-sdk-v2';
import { DynamicBondingCurveClient, DYNAMIC_BONDING_CURVE_PROGRAM_ID } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { CpAmm, CP_AMM_PROGRAM_ID, type PoolState } from '@meteora-ag/cp-amm-sdk';
import type { PageTarget, Venue } from './model';
import { selectPoolMint } from './dlmm';

export type DirectRoute = { venue: Exclude<Venue, 'PUMP_CURVE' | 'PUMP_SWAP' | 'JUPITER'>; mint: PublicKey; quoteMint: PublicKey; account: PublicKey };

async function raydium(rpc: Connection, owner: PublicKey, mints: PublicKey[]) {
  const mintAccounts = await rpc.getMultipleAccountsInfo(mints);
  if (mintAccounts.some(info => !info)) throw new Error('Raydium mint information is unavailable.');
  const atas = mints.map((mint, index) => getAssociatedTokenAddressSync(mint, owner, false, mintAccounts[index]!.owner));
  const accounts = await rpc.getMultipleAccountsInfo([owner, ...atas]);
  const parsed = parseTokenAccountResp({ owner, solAccountResp: accounts[0], tokenAccountResp: { context: { slot: 0 }, value: atas.flatMap((pubkey, index) => accounts[index + 1] ? [{ pubkey, account: accounts[index + 1]! }] : []) } });
  // Supply only pair-relevant ATA data. Avoid indexed getTokenAccountsByOwner
  // and avoid starting a websocket subscription inside the MV3 worker.
  return Raydium.load({ connection: rpc, owner, ...parsed, notSubscribeAccountChange: true, disableFeatureCheck: true, disableLoadToken: true, blockhashCommitment: 'confirmed' });
}

async function decodeDirectPool(rpc: Connection, pool: PublicKey, wantedMint?: PublicKey): Promise<DirectRoute | undefined> {
  const info = await rpc.getAccountInfo(pool);
  if (!info) return undefined;
  if (info.owner.equals(LAUNCHPAD_PROGRAM)) {
    const state = LaunchpadPool.decode(info.data);
    if (wantedMint && !state.mintA.equals(wantedMint)) throw new Error('LaunchLab pool does not match the page token.');
    if (state.status !== 0) return findCpmm(rpc, state.mintA, state.mintB);
    return { venue: 'RAYDIUM_LAUNCHLAB', mint: state.mintA, quoteMint: state.mintB, account: pool };
  }
  if (info.owner.equals(CREATE_CPMM_POOL_PROGRAM)) {
    const state = CpmmPoolInfoLayout.decode(info.data);
    const mint = selectPoolMint(state.mintA, state.mintB, wantedMint);
    if (!mint.equals(state.mintA) && !mint.equals(state.mintB)) throw new Error('CPMM pool does not contain the page token.');
    return { venue: 'RAYDIUM_CPMM', mint, quoteMint: mint.equals(state.mintA) ? state.mintB : state.mintA, account: pool };
  }
  if (info.owner.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID)) {
    const client = new DynamicBondingCurveClient(rpc, 'confirmed');
    const wrapped = await client.state.getPool(pool);
    const state = wrapped?.poolState;
    if (!state || (wantedMint && !state.baseMint.equals(wantedMint))) throw new Error('DBC pool does not match the page token.');
    const config = await client.state.getPoolConfig(state.config);
    if (!config) throw new Error('DBC pool configuration was not found.');
    if (state.isMigrated) return findDamm(rpc, state.baseMint, config.quoteMint);
    return { venue: 'METEORA_DBC', mint: state.baseMint, quoteMint: config.quoteMint, account: pool };
  }
  if (info.owner.equals(CP_AMM_PROGRAM_ID)) {
    const state = await new CpAmm(rpc).fetchPoolState(pool);
    const mint = selectPoolMint(state.tokenAMint, state.tokenBMint, wantedMint);
    if (!mint.equals(state.tokenAMint) && !mint.equals(state.tokenBMint)) throw new Error('DAMM pool does not contain the page token.');
    return { venue: 'METEORA_DAMM', mint, quoteMint: mint.equals(state.tokenAMint) ? state.tokenBMint : state.tokenAMint, account: pool };
  }
  return undefined;
}

async function findCpmm(rpc: Connection, mint: PublicKey, quote: PublicKey): Promise<DirectRoute> {
  const groups = await Promise.all(['mintA', 'mintB'].map(field => rpc.getProgramAccounts(CREATE_CPMM_POOL_PROGRAM, { filters: [{ memcmp: { offset: CpmmPoolInfoLayout.offsetOf(field)!, bytes: mint.toBase58() } }] })));
  const rows = Array.from(new Map(groups.flat().map(row => [row.pubkey.toBase58(), row])).values());
  const matches = rows.filter(row => { const state = CpmmPoolInfoLayout.decode(row.account.data); return (state.mintA.equals(mint) && state.mintB.equals(quote)) || (state.mintB.equals(mint) && state.mintA.equals(quote)); });
  if (matches.length !== 1) throw new Error('The graduated LaunchLab CPMM pool is not ready or is ambiguous.');
  return { venue: 'RAYDIUM_CPMM', mint, quoteMint: quote, account: matches[0]!.pubkey };
}

async function findDamm(rpc: Connection, mint: PublicKey, quote?: PublicKey): Promise<DirectRoute | undefined> {
  const rows = await new CpAmm(rpc).fetchPoolStatesByTokenMint(mint);
  const matches = rows.filter(row => !quote || (row.account.tokenAMint.equals(mint) ? row.account.tokenBMint : row.account.tokenAMint).equals(quote));
  if (matches.length > 1) throw new Error('Multiple Meteora pools were found. A page-bound pool address is required.');
  return matches[0] ? { venue: 'METEORA_DAMM', mint, quoteMint: matches[0].account.tokenAMint.equals(mint) ? matches[0].account.tokenBMint : matches[0].account.tokenAMint, account: matches[0].publicKey } : undefined;
}

export async function resolveOtherDirect(rpc: Connection, target: PageTarget): Promise<DirectRoute | undefined> {
  const wanted = target.kind === 'MINT' ? new PublicKey(target.address) : target.mintHint ? new PublicKey(target.mintHint) : undefined;
  if (target.kind === 'POOL' || target.poolHint) {
    const explicit = await decodeDirectPool(rpc, new PublicKey(target.kind === 'POOL' ? target.address : target.poolHint!), wanted);
    if (explicit) return explicit;
  }
  if (!wanted || target.kind === 'POOL') return undefined;
  const launchRows = await rpc.getProgramAccounts(LAUNCHPAD_PROGRAM, { filters: [{ memcmp: { offset: LaunchpadPool.offsetOf('mintA')!, bytes: wanted.toBase58() } }] });
  if (launchRows.length > 1) throw new Error('Multiple LaunchLab pools were found. A page-bound pool address is required.');
  if (launchRows[0]) return decodeDirectPool(rpc, launchRows[0].pubkey, wanted);
  const client = new DynamicBondingCurveClient(rpc, 'confirmed');
  const dbc = await client.state.getPoolByBaseMint(wanted);
  if (dbc) return decodeDirectPool(rpc, dbc.publicKey, wanted);
  return findDamm(rpc, wanted);
}

export type DirectSwapBundle = {
  instructions: TransactionInstruction[]; program: PublicKey; input: bigint; minimum: bigint;
  poolIndex: number; payerIndex: number; inputAccountIndex: number; outputAccountIndex: number;
  referralIndex?: number;
  discriminator: number[];
  expectedAccounts: Record<number, PublicKey>;
};

async function clock(rpc: Connection) {
  const account = await rpc.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  if (!account || account.data.length < 40) throw new Error('Could not read the Solana clock.');
  return { slot: new BN(account.data.readBigUInt64LE(0).toString()), epoch: Number(account.data.readBigUInt64LE(16)), timestamp: new BN(account.data.readBigInt64LE(32).toString()) };
}

export async function buildOtherDirect(rpc: Connection, route: DirectRoute, wallet: PublicKey, side: 'BUY' | 'SELL', amount: bigint, slippageBps: number): Promise<DirectSwapBundle> {
  const amountIn = new BN(amount.toString());
  if (route.venue === 'METEORA_DBC') {
    const client = new DynamicBondingCurveClient(rpc, 'confirmed');
    const state = await client.state.getPool(route.account);
    if (!state) throw new Error('DBC pool was not found.');
    const config = await client.state.getPoolConfig(state.poolState.config);
    if (!config) throw new Error('DBC configuration was not found.');
    const now = await clock(rpc);
    const quote = client.pool.swapQuote({ virtualPool: state, config, swapBaseForQuote: side === 'SELL', amountIn, slippageBps, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint: config.activationType === 0 ? now.slot : now.timestamp });
    const tx = await client.pool.swap({ owner: wallet, pool: route.account, amountIn, minimumAmountOut: quote.minimumAmountOut, swapBaseForQuote: side === 'SELL', referralTokenAccount: null });
    return { instructions: tx.instructions, program: DYNAMIC_BONDING_CURVE_PROGRAM_ID, input: amount, minimum: BigInt(quote.minimumAmountOut.toString()), poolIndex: 2, payerIndex: 9, inputAccountIndex: 3, outputAccountIndex: 4, referralIndex: 12, discriminator: [248,198,158,145,225,117,135,200], expectedAccounts: { 1: state.poolState.config, 5: state.poolState.baseVault, 6: state.poolState.quoteVault, 7: route.mint, 8: route.quoteMint } };
  }
  if (route.venue === 'METEORA_DAMM') {
    const client = new CpAmm(rpc);
    const state = await client.fetchPoolState(route.account);
    const [a, b, now] = await Promise.all([rpc.getAccountInfo(state.tokenAMint), rpc.getAccountInfo(state.tokenBMint), clock(rpc)]);
    if (!a || !b) throw new Error('DAMM mint accounts were not found.');
    const mintA = unpackMint(state.tokenAMint, a, a.owner); const mintB = unpackMint(state.tokenBMint, b, b.owner);
    const inputMint = side === 'BUY' ? route.quoteMint : route.mint;
    const outputMint = side === 'BUY' ? route.mint : route.quoteMint;
    const quote = client.getQuote({ inAmount: amountIn, inputTokenMint: inputMint, slippage: slippageBps / 100, poolState: state, currentTime: now.timestamp.toNumber(), currentSlot: now.slot.toNumber(), tokenADecimal: mintA.decimals, tokenBDecimal: mintB.decimals, inputTokenInfo: { mint: inputMint.equals(state.tokenAMint) ? mintA : mintB, currentEpoch: now.epoch }, outputTokenInfo: { mint: outputMint.equals(state.tokenAMint) ? mintA : mintB, currentEpoch: now.epoch }, hasReferral: false });
    const tx = await client.swap({ payer: wallet, pool: route.account, inputTokenMint: inputMint, outputTokenMint: outputMint, amountIn, minimumAmountOut: quote.minSwapOutAmount, tokenAMint: state.tokenAMint, tokenBMint: state.tokenBMint, tokenAVault: state.tokenAVault, tokenBVault: state.tokenBVault, tokenAProgram: a.owner, tokenBProgram: b.owner, referralTokenAccount: null, poolState: state });
    return { instructions: tx.instructions, program: CP_AMM_PROGRAM_ID, input: amount, minimum: BigInt(quote.minSwapOutAmount.toString()), poolIndex: 1, payerIndex: 8, inputAccountIndex: 2, outputAccountIndex: 3, referralIndex: 11, discriminator: [248,198,158,145,225,117,135,200], expectedAccounts: { 4: state.tokenAVault, 5: state.tokenBVault, 6: state.tokenAMint, 7: state.tokenBMint, 9: a.owner, 10: b.owner } };
  }
  const client = await raydium(rpc, wallet, [route.mint, route.quoteMint]);
  if (route.venue === 'RAYDIUM_LAUNCHLAB') {
    const pool = await client.launchpad.getRpcPoolInfo({ poolId: route.account });
    const [a, b] = await Promise.all([rpc.getAccountInfo(route.mint), rpc.getAccountInfo(route.quoteMint)]);
    if (!a || !b) throw new Error('LaunchLab mint accounts were not found.');
    const common = { mintA: route.mint, mintB: route.quoteMint, mintAProgram: a.owner, mintBProgram: b.owner, poolInfo: pool, configInfo: pool.configInfo, slippage: new BN(slippageBps), shareFeeRate: new BN(0), txVersion: TxVersion.LEGACY as const, associatedOnly: true, checkCreateATAOwner: true, skipCheckMintA: true, skipCheckMintB: true, transferFeeConfigA: getTransferFeeConfig(unpackMint(route.mint, a, a.owner)) ?? undefined, transferFeeConfigB: getTransferFeeConfig(unpackMint(route.quoteMint, b, b.owner)) ?? undefined };
    const built = side === 'BUY' ? await client.launchpad.buyToken({ ...common, buyAmount: amountIn }) : await client.launchpad.sellToken({ ...common, sellAmount: amountIn });
    if (built.signers.length) throw new Error('This SDK transaction requires a local signer and is not supported.');
    const core = built.transaction.instructions.find(ix => ix.programId.equals(LAUNCHPAD_PROGRAM));
    if (!core || core.data.length !== 32 || core.data.readBigUInt64LE(24) !== 0n) throw new Error('Unsupported LaunchLab swap format or nonzero referral fee.');
    if (core.keys.length !== 18) throw new Error('LaunchLab includes unexpected referral or additional accounts.');
    return { instructions: built.transaction.instructions, program: LAUNCHPAD_PROGRAM, input: core.data.readBigUInt64LE(8), minimum: core.data.readBigUInt64LE(16), poolIndex: 4, payerIndex: 0, inputAccountIndex: side === 'BUY' ? 6 : 5, outputAccountIndex: side === 'BUY' ? 5 : 6, discriminator: Array.from(side === 'BUY' ? anchorDataBuf.buyExactIn : anchorDataBuf.sellExactIn), expectedAccounts: { 1: LAUNCHPAD_AUTH, 2: pool.configId, 3: pool.platformId, 7: pool.vaultA, 8: pool.vaultB, 9: route.mint, 10: route.quoteMint, 11: a.owner, 12: b.owner } };
  }
  const state = await client.cpmm.getPoolInfoFromRpc(route.account.toBase58());
  const outputMint = side === 'BUY' ? route.mint : route.quoteMint;
  const inputMint = side === 'BUY' ? route.quoteMint : route.mint;
  const quote = client.cpmm.computeSwapAmount({ pool: state.computePoolInfo, amountIn, outputMint, slippage: slippageBps / 10_000, swapBaseIn: true });
  const built = await client.cpmm.swap({ poolInfo: state.poolInfo, poolKeys: state.poolKeys, payer: wallet, baseIn: inputMint.equals(new PublicKey(state.poolInfo.mintA.address)), inputAmount: amountIn, swapResult: quote.swapResult, slippage: slippageBps / 10_000, txVersion: TxVersion.LEGACY, config: { associatedOnly: true, checkCreateATAOwner: true } });
  if (built.signers.length) throw new Error('This SDK transaction requires a local signer and is not supported.');
  const core = built.transaction.instructions.find(ix => ix.programId.equals(CREATE_CPMM_POOL_PROGRAM));
  if (!core || core.data.length !== 24) throw new Error('Unsupported CPMM swap format.');
  return { instructions: built.transaction.instructions, program: CREATE_CPMM_POOL_PROGRAM, input: core.data.readBigUInt64LE(8), minimum: core.data.readBigUInt64LE(16), poolIndex: 3, payerIndex: 0, inputAccountIndex: 4, outputAccountIndex: 5, discriminator: [143,190,90,218,196,30,51,222], expectedAccounts: { 10: inputMint, 11: outputMint } };
}
