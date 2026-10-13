import bs58 from 'bs58';
import { validateProSpec, usdUnits, unitsUsd, type ProSpec, type ProOrder } from './contracts';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export function amountToRaw(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) throw new Error('Enter a positive decimal amount.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error(`Amount supports at most ${decimals} decimals.`);
  const raw = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (raw <= 0n) throw new Error('Amount must be positive.');
  return raw.toString();
}
export function rawToAmount(raw: string, decimals: number): string {
  const value = BigInt(raw); const scale = 10n ** BigInt(decimals);
  return decimals ? `${value / scale}.${(value % scale).toString().padStart(decimals, '0')}` : value.toString();
}
export function percentageRaw(available: string, percent: number): string {
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) throw new Error('Select 1–100%.');
  return (BigInt(available) * BigInt(percent) / 100n).toString();
}
export function safeSolscanUrl(signature: unknown): string | undefined {
  if (typeof signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) return;
  try { if (bs58.decode(signature).length === 64) return `https://solscan.io/tx/${signature}`; } catch { /* Invalid base58 is never a navigation target. */ }
}
export function trailingSummary(order: ProOrder): string {
  if (order.spec.kind !== 'TRAILING') return '';
  const trigger = order.highWatermark && order.spec.trailingBps !== undefined
    ? unitsUsd(usdUnits(order.highWatermark) * BigInt(10000 - order.spec.trailingBps) / 10000n) : 'not established';
  return `High ${order.highWatermark ?? 'not observed'} USD · Current ${order.currentPriceUsd ?? 'unavailable'} USD · Trigger ${trigger} USD · ${order.trailActive ? 'Active' : 'Awaiting activation'}${order.spec.activationPriceUsd ? ` at ${order.spec.activationPriceUsd} USD` : ' on first observation'}. Resume preserves the watermark; editing resets it.`;
}
export function entryProtection(tp: string, sl: string, slippage: string, hours: string): NonNullable<ProSpec['exit']> & { durationMs: number } {
  const durationMs = Math.round(Number(hours) * 3600_000);
  if (!Number.isSafeInteger(durationMs) || durationMs < 60_000 || durationMs > 30 * 86400_000) throw new Error('Protection lifetime must be one minute to 720 hours.');
  return { tpBps: Math.round(Number(tp) * 100), slBps: Math.round(Number(sl) * 100), slippageBps: Math.round(Number(slippage) * 100), durationMs };
}
export function editedSpec(original: ProSpec, candidate: ProSpec): ProSpec {
  if (candidate.mint !== original.mint || candidate.side !== original.side || candidate.kind !== original.kind) throw new Error('Editing preserves the token, side and order type.');
  return validateProSpec({ ...candidate, target: original.target, mint: original.mint, side: original.side, kind: original.kind, decimals: original.decimals });
}
