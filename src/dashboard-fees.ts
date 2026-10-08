import type { FeeAmount, FeeReceipt } from './model';
import { formatAmount, formatUsd, volumeUsd } from './savings';

export type DisplayUnit = 'USD' | 'SOL';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
export function feeCategory(label: string): string {
  if (/buyback/i.test(label)) return 'Buyback';
  if (/holder/i.test(label)) return 'Holder rewards';
  if (/creator/i.test(label)) return 'Creator';
  if (/\bLP\b|liquidity/i.test(label)) return 'LP';
  if (/partner/i.test(label)) return 'Partner';
  if (/fund/i.test(label)) return 'Fund';
  if (/platform/i.test(label)) return 'Platform';
  if (/transfer/i.test(label)) return 'Token transfer';
  if (/protocol/i.test(label)) return 'Protocol';
  return label;
}
export function groupedFees(f?: FeeReceipt): FeeAmount[] {
  const groups = new Map<string, FeeAmount>();
  for (const fee of f?.protocolFees ?? []) {
    const label = feeCategory(fee.label), key = `${label}:${fee.mint}:${fee.decimals}`;
    const prior = groups.get(key);
    groups.set(key, { ...fee, label, rawAmount: (BigInt(prior?.rawAmount ?? '0') + BigInt(fee.rawAmount)).toString() });
  }
  return [...groups.values()];
}
export function feeTotals(f?: FeeReceipt) {
  const fees = groupedFees(f);
  const protocol = fees.filter(p => p.mint === SOL_MINT && p.decimals === 9).reduce((sum,p) => sum + BigInt(p.rawAmount), 0n);
  const foreign = fees.some(p => (p.mint !== SOL_MINT || p.decimals !== 9) && BigInt(p.rawAmount) > 0n);
  return {
    protocol: protocol.toString(),
    total: f?.totalNetworkLamports === undefined ? undefined : (protocol + BigInt(f.totalNetworkLamports)).toString(),
    // Network already includes priority. Rent is a deposit, not a trading fee.
    partial: !f || f.protocolBreakdownIncomplete || foreign || !f.zeroExtraFeesVerified,
    foreign,
  };
}
export function money(raw: string | undefined, f: FeeReceipt | undefined, unit: DisplayUnit, precise = false): string {
  if (raw === undefined) return 'Unavailable';
  if (unit === 'SOL') return `${formatAmount(raw)} SOL`;
  if (BigInt(raw) === 0n) return '$0.00';
  if (!f?.usd) return 'Unpriced';
  const micros = volumeUsd(raw,f.usd);
  if (!precise || BigInt(micros) >= 1_000_000n) return formatUsd(micros);
  if (BigInt(micros) === 0n) return '<$0.000001';
  return `$${formatAmount(micros,6)}`;
}
export function feeMoney(fee: FeeAmount, f: FeeReceipt | undefined, unit: DisplayUnit): string {
  if (fee.mint === SOL_MINT && fee.decimals === 9) return money(fee.rawAmount,f,unit,true);
  if (BigInt(fee.rawAmount) === 0n) return unit === 'USD' ? '$0.00' : '0 SOL';
  return `Unpriced · ${formatAmount(fee.rawAmount,fee.decimals)} ${fee.symbol}`;
}
