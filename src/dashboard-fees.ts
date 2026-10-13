import type { FeeAmount, FeeReceipt, Receipt } from './model';
import { formatAmount, volumeUsd } from './savings';

import { receiptSol, receiptUsd, type ReceiptRounding } from './receipt-format';

export type DisplayUnit = 'USD' | 'SOL';
export const savingsEligible = (r: Receipt): boolean => r.feeReceipt?.state === 'VERIFIED' && r.feeReceipt.zeroExtraFeesVerified && r.feeReceipt.executionSucceeded === true && r.feeReceipt.volumeUsdMicros !== undefined;
export type DailyFees = { day: string; protocol: bigint; network: bigint; saved: bigint; incomplete: number; unpriced: number };
/** Known costs only; failed transactions still pay network fees, rent stays separate. */
export function dailyFeeTotals(receipts: Receipt[], unit: DisplayUnit): DailyFees[] {
  const days = new Map<string, DailyFees>();
  for (const receipt of receipts) {
    const f = receipt.feeReceipt, totals = feeTotals(f);
    const day = new Date((f?.blockTime ?? receipt.createdAt / 1000) * 1000).toISOString().slice(0, 10);
    const row = days.get(day) ?? { day, protocol: 0n, network: 0n, saved: 0n, incomplete: 0, unpriced: 0 };
    const converted = (raw: string | undefined): bigint | undefined => raw === undefined ? undefined : unit === 'SOL' || BigInt(raw) === 0n ? BigInt(raw) : f?.usd ? BigInt(volumeUsd(raw, f.usd)) : undefined;
    const protocol = f?.executionSucceeded === false ? 0n : f?.protocolFees.length ? converted(totals.protocol) : undefined;
    const network = converted(f?.totalNetworkLamports);
    row.protocol += protocol ?? 0n;
    row.network += network ?? 0n;
    if (protocol === undefined || network === undefined || (f?.executionSucceeded !== false && totals.partial)) row.incomplete++;
    if (unit === 'USD' && f && !f.usd && (BigInt(totals.protocol) > 0n || BigInt(f.totalNetworkLamports ?? '0') > 0n)) row.unpriced++;
    if (savingsEligible(receipt)) row.saved += BigInt((unit === 'USD' ? f?.volumeUsdMicros : f?.volumeLamports) ?? '0');
    days.set(day, row);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-30).map(row => ({ ...row, saved: row.saved / 100n }));
}
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
export function money(raw: string | undefined, f: FeeReceipt | undefined, unit: DisplayUnit, rounding: ReceiptRounding = 'nearest'): string {
  if (raw === undefined) return 'Unavailable';
  if (unit === 'SOL') return receiptSol(raw,rounding);
  if (BigInt(raw) === 0n) return '$0.00';
  if (!f?.usd) return 'Unpriced';
  const micros = volumeUsd(raw,f.usd);
  return BigInt(micros) === 0n ? '<$0.0001' : receiptUsd(micros,rounding);
}
export function subtotalMoney(raw: string | undefined, f: FeeReceipt | undefined, unit: DisplayUnit, partial: boolean): string {
  const value = money(raw,f,unit,partial ? 'down' : 'nearest');
  // Keep conservative rounding; missing components are explained in the details.
  return value;
}
export function exactMoney(raw: string | undefined, f: FeeReceipt | undefined, unit: DisplayUnit): string {
  if (raw === undefined) return 'Unavailable';
  const native = `${formatAmount(raw)} SOL`;
  if (unit === 'SOL' || !f?.usd) return native;
  const value = volumeUsd(raw,f.usd);
  return `${native} · $${formatAmount(value,6)} estimate · ${f.usd.source}`;
}
export function terminalFeeMoney(f: FeeReceipt | undefined, unit: DisplayUnit): string {
  return money('0',f,unit);
}
export function terminalFeeTitle(f: FeeReceipt | undefined): string {
  return 'Direct Pump charges no terminal fee. Protocol fees, network costs and rent are separate.';
}
export function feeMoney(fee: FeeAmount, f: FeeReceipt | undefined, unit: DisplayUnit): string {
  if (fee.mint === SOL_MINT && fee.decimals === 9) return money(fee.rawAmount,f,unit);
  if (BigInt(fee.rawAmount) === 0n) return unit === 'USD' ? '$0.00' : '0 SOL';
  return `Unpriced · ${formatAmount(fee.rawAmount,fee.decimals)} ${fee.symbol}`;
}
