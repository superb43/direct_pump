import type { ChartEntry } from './chart-entry';
import type { PageTarget } from '../model';
import { ADDRESS, targetKey } from '../sites/catalog';

export const CHART_OVERLAY_CHANNEL = 'direct-pump:chart-entry:v1';
export const CHART_OVERLAY_LEASE_MS = 12_000;
export type ChartOverlayEntry = Pick<ChartEntry, 'mint' | 'priceUsd' | 'marketCapUsd'>;
export type ChartOverlayCommand = {
  channel: typeof CHART_OVERLAY_CHANNEL;
  key: string;
  entry: ChartOverlayEntry | null;
  expiresAt: number;
};
const positiveDecimal = (value: unknown): value is string => typeof value === 'string'
  && /^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,18})?$/.test(value)
  && Number.isFinite(Number(value)) && Number(value) > 0;
export function validOverlayEntry(value: unknown): value is ChartOverlayEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as ChartOverlayEntry;
  return typeof entry.mint === 'string' && ADDRESS.test(entry.mint) && positiveDecimal(entry.priceUsd) && positiveDecimal(entry.marketCapUsd);
}
export function overlayCommand(target: PageTarget, entry?: ChartEntry, now = Date.now()): ChartOverlayCommand {
  const expectedMint = target.kind === 'MINT' ? target.address : target.mintHint;
  const eligible = entry && entry.mint === expectedMint && validOverlayEntry(entry)
    && Number.isSafeInteger(entry.updatedAt) && entry.updatedAt <= now && now - entry.updatedAt < 90_000
    && (entry.validUntil === undefined || Number.isSafeInteger(entry.validUntil) && entry.validUntil > now && entry.validUntil <= entry.updatedAt + 90_000);
  return {
    channel: CHART_OVERLAY_CHANNEL, key: targetKey(target),
    entry: eligible ? { mint: entry.mint, priceUsd: entry.priceUsd, marketCapUsd: entry.marketCapUsd } : null,
    expiresAt: eligible ? Math.min(now + CHART_OVERLAY_LEASE_MS, entry.updatedAt + 90_000, entry.validUntil ?? Infinity) : now,
  };
}
export function validOverlayCommand(value: unknown, now = Date.now()): value is ChartOverlayCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as ChartOverlayCommand;
  return command.channel === CHART_OVERLAY_CHANNEL && typeof command.key === 'string' && command.key.length < 250
    && Number.isSafeInteger(command.expiresAt) && command.expiresAt <= now + CHART_OVERLAY_LEASE_MS
    && (command.entry === null || validOverlayEntry(command.entry));
}
