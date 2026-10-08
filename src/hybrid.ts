import { Connection, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT, getAssociatedTokenAddressSync, unpackAccount } from '@solana/spl-token';
import type { PageTarget, Settings, TradeIntent } from './model';
import { parseSol, sellAmount } from './amounts';
import { buildPumpTrade, assertTokenProgram } from './protocol';
import { resolveExecution } from './execution';
import { buildOtherDirect } from './direct-venues';
import { validateDirectSwap } from './direct-security';
import { finalizeTrade } from './transactions';
import { buildRoutedTrade } from './router';

export { resolveExecution } from './execution';

export async function buildHybridTrade(rpc: Connection, target: PageTarget, wallet: PublicKey, intent: TradeIntent, settings: Settings) {
  if (intent.side === 'BUY' && 'paymentMint' in intent && intent.paymentMint !== NATIVE_MINT.toBase58()) throw new Error('Buy amounts now use SOL. Reload the token page before trading.');
  const solInput = intent.side === 'BUY' ? parseSol('sol' in intent ? intent.sol : intent.amount) : undefined;
  if (solInput && settings.spendLimitsEnabled && solInput > parseSol(settings.maxBuySol)) throw new Error(`Maximum buy is ${settings.maxBuySol} SOL.`);
  const normalized: TradeIntent = intent.side === 'BUY' ? { side: 'BUY', sol: 'sol' in intent ? intent.sol : intent.amount } : intent;
  const route = await resolveExecution(rpc, target);
  if (route.venue === 'PUMP_CURVE' || route.venue === 'PUMP_SWAP') return buildPumpTrade(rpc, route, wallet, normalized, settings);
  const baseInfo = await rpc.getAccountInfo(route.mint);
  if (!baseInfo) throw new Error('Token mint was not found.');
  assertTokenProgram(baseInfo.owner);
  // Parse sells only. SOL buys never require or spend a quote-asset balance.
  let input = solInput!;
  if (intent.side === 'SELL') {
    const baseAta = getAssociatedTokenAddressSync(route.mint, wallet, false, baseInfo.owner);
    const account = await rpc.getAccountInfo(baseAta);
    input = sellAmount(account ? unpackAccount(baseAta, account, baseInfo.owner).amount : 0n, intent.percent);
  }
  if (route.venue === 'JUPITER') return buildRoutedTrade(rpc, route, wallet, intent.side, input, settings);
  const quoteInfo = await rpc.getAccountInfo(NATIVE_MINT);
  if (!quoteInfo) throw new Error('SOL mint was not found.');
  const bundle = await buildOtherDirect(rpc, route, wallet, intent.side, input, settings.slippageBps);
  await validateDirectSwap(bundle, route, wallet, intent.side, input, baseInfo.owner, quoteInfo.owner, await rpc.getMinimumBalanceForRentExemption(165));
  const finalized = await finalizeTrade(rpc, bundle.instructions, wallet, settings);
  return { ...finalized, route, input: bundle.input, minimum: bundle.minimum };
}
