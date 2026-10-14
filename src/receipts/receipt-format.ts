import type { Receipt } from '../model';
import { cleanSymbol } from '../token-label';

// Formatting is integer-only and never changes stored amounts or signing limits.
export type ReceiptRounding = 'nearest' | 'down';

function rounded(raw: bigint, inputDecimals: number, fractionDigits: number, minimumDigits = 0, rounding: ReceiptRounding = 'nearest'): string {
  const factor = 10n ** BigInt(Math.max(0, inputDecimals - fractionDigits));
  const value = (raw + (rounding === 'nearest' ? factor / 2n : 0n)) / factor;
  const decimals = Math.min(inputDecimals, fractionDigits), scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let fraction = (value % scale).toString().padStart(decimals, '0');
  while (fraction.length > minimumDigits && fraction.endsWith('0')) fraction = fraction.slice(0,-1);
  return whole + (fraction ? `.${fraction}` : '');
}
export function receiptSol(lamports: string, rounding: ReceiptRounding = 'nearest'): string {
  const raw = BigInt(lamports);
  if (raw < 0n) throw new Error('Receipt amounts cannot be negative.');
  if (raw > 0n && raw < 1_000n) return '<0.000001 SOL';
  return `${rounded(raw,9,6,0,rounding)} SOL`;
}
function usdFractionDigits(raw: bigint): number {
  return raw >= 1_000_000n ? 2 : raw >= 10_000n ? 3 : 4;
}
/** Sum the amounts users see, without parsing formatted currency or changing stored values. */
export function roundedUsdMicros(micros: string): bigint {
  const raw = BigInt(micros), magnitude = raw < 0n ? -raw : raw;
  if (magnitude < 100n) return raw;
  const factor = 10n ** BigInt(6 - usdFractionDigits(magnitude));
  const value = (magnitude + factor / 2n) / factor * factor;
  return raw < 0n ? -value : value;
}
export function receiptUsd(micros: string, rounding: ReceiptRounding = 'nearest'): string {
  const raw = BigInt(micros);
  if (raw < 0n) throw new Error('Receipt amounts cannot be negative.');
  if (raw > 0n && raw < 100n) return '<$0.0001';
  const decimals = usdFractionDigits(raw);
  return `$${rounded(raw,6,decimals,2,rounding)}`;
}
export function receiptToken(receipt: Pick<Receipt,'symbol'>): string {
  return `$${receipt.symbol ? cleanSymbol(receipt.symbol) ?? 'TOKEN' : 'TOKEN'}`;
}
