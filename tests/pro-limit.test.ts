import { describe, expect, it } from 'vitest';
import { limitScale, relativeMc, relativeMcBps } from '../src/pro/limit';

describe('relative MC entry', () => {
  it('keeps buy below and sell above current MC, including every preset', () => {
    for (const side of ['BUY', 'SELL'] as const) {
      const scale = limitScale(side);
      for (const percent of [scale.min, scale.max, scale.initial, ...scale.presets]) {
        expect(side === 'BUY' ? percent < 0 : percent > 0).toBe(true);
        expect(percent).toBeGreaterThanOrEqual(scale.min);
        expect(percent).toBeLessThanOrEqual(scale.max);
      }
    }
  });
  it('uses precise integer targets without passing money through floating point', () => {
    expect(relativeMc('420000', -20)).toBe('336000.000000000000');
    expect(relativeMc('420000', 50)).toBe('630000.000000000000');
    expect(relativeMc('1234567890.123456789123', -10)).toBe('1111111101.111111110210');
    expect(relativeMc('0.000000000020', -75)).toBe('0.000000000005');
    expect(() => relativeMc('420000', -100)).toThrow();
    expect(() => relativeMc('420000', 1.5)).toThrow();
  });
  it('shows the actual signed delta of custom targets without rewriting their precision', () => {
    expect(relativeMcBps('420000', '336000')).toBe(-2000);
    expect(relativeMcBps('420000', '630000')).toBe(5000);
    expect(relativeMcBps('420000', '420000')).toBe(0);
    expect(relativeMcBps('420000', '1260000')).toBe(20000);
    expect(relativeMcBps('100', '112.345678901234')).toBe(1234);
  });
});
