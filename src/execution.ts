import { Connection, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT, unpackMint } from '@solana/spl-token';
import { bondingCurvePda, PUMP_SDK, PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { PUMP_AMM_SDK, canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import type { PageTarget } from './model';
import { resolveRoute, assertTokenProgram } from './protocol';
import { resolveOtherDirect } from './direct-venues';
import { DLMM_PROGRAM_ID, decodeDlmmPair, selectPoolMint } from './dlmm';

async function validateMint(rpc: Connection, mint: PublicKey) {
  const info = await rpc.getAccountInfo(mint);
  if (!info) throw new Error('The page token mint was not found.');
  if (info.executable) throw new Error('The page token mint account is executable.');
  assertTokenProgram(info.owner);
  if (!unpackMint(mint, info, info.owner).isInitialized) throw new Error('The page token mint is not initialized.');
  return info;
}

function isDiscoveryUnavailable(error: unknown): boolean {
  return /indexed requests require a personal token|excluded from account secondary indexes/i.test(error instanceof Error ? error.message : String(error));
}

function routed(mint: PublicKey, account: PublicKey, reason: string) {
  return { venue: 'JUPITER' as const, mint, quoteMint: NATIVE_MINT, account, routingReason: reason };
}

/** User settlement is always SOL. Pool quote assets are an internal routing detail. */
export async function resolveExecution(rpc: Connection, target: PageTarget,includeAccountInfo=false) {
  const address = new PublicKey(target.address);
  const wanted = target.kind === 'MINT' ? address : target.mintHint ? new PublicKey(target.mintHint) : undefined;
  const explicitPool = target.kind === 'POOL' ? address : target.poolHint ? new PublicKey(target.poolHint) : undefined;
  if (explicitPool) {
    const info = await rpc.getAccountInfo(explicitPool);
    if (!info) throw new Error('The page pool account was not found.');
    if (info.owner.equals(PUMP_PROGRAM_ID)) {
      if (info.executable) throw new Error('The page bonding curve account is executable.');
      if (!wanted) throw new Error('Waiting for the page token mint. Retry when token metadata has loaded.');
      if (!bondingCurvePda(wanted).equals(explicitPool)) throw new Error('The page bonding curve does not match the token mint.');
      const mintInfo=await validateMint(rpc, wanted);
      // The pinned SDK checks the discriminator and supports live curve layouts.
      PUMP_SDK.decodeBondingCurve(info);
      // Preserve the page assertion and its cache/trade identity. Only the
      // verified route lookup uses a mint view of this same token.
      const route = await resolveRoute(rpc, { ...target, kind: 'MINT', address: wanted.toBase58() },{addressInfo:mintInfo,curveInfo:info,includeAccountInfo});
      return route.quoteMint.equals(NATIVE_MINT) ? route : routed(route.mint, route.account, 'NON_SOL_PAIR');
    }
    if (info.owner.equals(DLMM_PROGRAM_ID)) {
      const { tokenX, tokenY } = decodeDlmmPair(info);
      const mint = selectPoolMint(tokenX, tokenY, wanted);
      await validateMint(rpc, mint);
      return routed(mint, explicitPool, 'DLMM_POOL');
    }
    if (info.owner.equals(PUMP_AMM_PROGRAM_ID)) {
      const pool = PUMP_AMM_SDK.decodePool(info);
      const mint = selectPoolMint(pool.baseMint, pool.quoteMint, wanted);
      if (!pool.baseMint.equals(mint) && !pool.quoteMint.equals(mint)) throw new Error('PumpSwap pool does not contain the page token.');
      if (target.kind === 'POOL' && target.mintHint) await validateMint(rpc, mint);
      const counter = pool.baseMint.equals(mint) ? pool.quoteMint : pool.baseMint;
      if (!counter.equals(NATIVE_MINT)) return routed(mint, explicitPool, 'NON_SOL_PAIR');
      // General/inverted PumpSwap pools need whole-route execution. Never pass
      // an inverted pair to a builder whose BUY means quote -> base.
      if (!pool.baseMint.equals(mint) || !canonicalPumpPoolPda(pool.baseMint, pool.quoteMint).equals(explicitPool)) return routed(mint, explicitPool, 'GENERAL_PUMP_SWAP');
      return { venue: 'PUMP_SWAP' as const, mint, quoteMint: counter, account: explicitPool,...includeAccountInfo?{accountInfo:info}:{} };
    }
    try {
      const direct = await resolveOtherDirect(rpc, target);
      if (direct) {
        if (wanted && !direct.mint.equals(wanted)) throw new Error('Pool does not contain the page token.');
        return direct.quoteMint.equals(NATIVE_MINT) ? direct : routed(direct.mint, direct.account, 'NON_SOL_PAIR');
      }
    } catch (error) {
      if (target.kind === 'POOL' || !isDiscoveryUnavailable(error)) throw error;
      return routed(address, explicitPool, 'DISCOVERY_UNAVAILABLE');
    }
    if (target.kind === 'POOL') throw new Error('This pool is not decoded yet. Open a supported token-mint page for SOL routing.');
    // An undecoded hint cannot establish the execution address or quote asset.
    // Routing still binds input/output to the validated page mint.
    return routed(address, explicitPool, 'UNDECODED_POOL');
  }
  const info = await rpc.getAccountInfo(address);
  if (!info) throw new Error('The page token mint was not found.');
  assertTokenProgram(info.owner);
  const curveInfo = await rpc.getAccountInfo(bondingCurvePda(address));
  if (curveInfo?.owner.equals(PUMP_PROGRAM_ID)) {
    const route = await resolveRoute(rpc, target,{addressInfo:info,curveInfo,includeAccountInfo});
    return route.quoteMint.equals(NATIVE_MINT) ? route : routed(route.mint, route.account, 'NON_SOL_PAIR');
  }
  try {
    const direct = await resolveOtherDirect(rpc, target);
    if (direct) return direct.quoteMint.equals(NATIVE_MINT) ? direct : routed(direct.mint, direct.account, 'NON_SOL_PAIR');
  } catch (error) {
    // Indexed discovery is a capability failure, not proof that a mint is
    // untradeable. Full SOL routing can discover its active market independently.
    if (!isDiscoveryUnavailable(error)) throw error;
    return routed(address, address, 'DISCOVERY_UNAVAILABLE');
  }
  return routed(address, address, 'OTHER_VENUE');
}

export type ExecutionRoute = Awaited<ReturnType<typeof resolveExecution>>;
