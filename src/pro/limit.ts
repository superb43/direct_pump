import { unitsUsd, usdUnits } from './contracts';

export function limitScale(side: 'BUY' | 'SELL') {
  return side === 'BUY'
    ? { min: -75, max: -1, initial: -10, presets: [-5, -10, -20, -50], ticks: [-75, -50, -25, -1] }
    : { min: 1, max: 100, initial: 10, presets: [5, 10, 20, 50], ticks: [1, 25, 50, 100] };
}

export function relativeMc(current: string, percent: number): string {
  if (!Number.isInteger(percent) || percent <= -100) throw new Error('Invalid MC percentage.');
  return unitsUsd(usdUnits(current) * BigInt(100 + percent) / 100n);
}

/** Basis points for display only; the absolute target retains every digit. */
export function relativeMcBps(current: string, target: string): number {
  const baseline = usdUnits(current);
  const result = (usdUnits(target) - baseline) * 10000n / baseline;
  // Very large custom targets need a label, never an imprecise slider value.
  return Number(result > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : result);
}

export function signedPercent(percent: number): string {
  return `${percent > 0 ? '+' : ''}${percent}%`;
}
