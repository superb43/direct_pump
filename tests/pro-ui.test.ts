import bs58 from 'bs58';
import type { ProSpec, ProOrder } from '../src/pro/contracts';
import { describe, expect, it, vi } from 'vitest';
vi.mock('wxt/browser', () => ({ browser: {} }));
import { amountToRaw, rawToAmount, percentageRaw, safeSolscanUrl, trailingSummary, editedSpec, entryProtection } from '../src/pro/view';
describe('Pro exact amounts', () => {
  it('converts SOL and tiny token amounts without floating point loss', () => {
    expect(amountToRaw('0.01', 9)).toBe('10000000');
    expect(amountToRaw('123456789.123456789',9)).toBe('123456789123456789');
    expect(rawToAmount('123456789123456789',9)).toBe('123456789.123456789');
    expect(amountToRaw('0.000000000001',12)).toBe('1');
  });
  it('rejects precision loss, negative, zero and exponent amounts', () => {
    for (const amount of ['0','-1','1e9','0.0000000001','NaN']) expect(() => amountToRaw(amount,9)).toThrow();
  });
  it('freezes percentage from available integer balance and rounds down', () => {
    expect(percentageRaw('101',25)).toBe('25');
    expect(percentageRaw('10000000000000000001',100)).toBe('10000000000000000001');
    expect(() => percentageRaw('100',101)).toThrow();
  });
});

describe('Pro reviewed edits and timeline safety', () => {
  const spec = (): ProSpec => ({ kind: 'TRAILING', side: 'SELL', mint: 'So11111111111111111111111111111111111111112', target: { site: 'GMGN', kind: 'MINT', address: 'So11111111111111111111111111111111111111112', pageUrl: 'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112' }, amountRaw: '100', decimals: 9, expiresAt: Date.now() + 3600000, slippageBps: 100, priorityFeeLamports: 100000, maxNetworkLamports: '5000000', trailingBps: 500 });
  it('keeps protection lifetime separate from entry expiry', () => {
    expect(entryProtection('20','10','1','24')).toEqual({ tpBps: 2000, slBps: 1000, slippageBps: 100, durationMs: 86400000 });
    for (const hours of ['0','-1','0.01','721','NaN']) expect(() => entryProtection('20','10','1',hours)).toThrow();
  });
  it('preserves immutable edit identity while permitting reviewed risk changes', () => {
    const original = spec(); const candidate = { ...original, trailingBps: 1000, target: { ...original.target, address: 'other' } };
    const edited = editedSpec(original, candidate);
    expect(edited.target).toEqual(original.target); expect(edited.trailingBps).toBe(1000);
    expect(() => editedSpec(original, { ...candidate, side: 'BUY' })).toThrow('preserves');
    expect(() => editedSpec(original, { ...candidate, mint: 'other' })).toThrow('preserves');
    expect(() => editedSpec(original, { ...candidate, kind: 'MARKET' })).toThrow('preserves');
  });
  it('derives a tiny-token trailing trigger exactly at twelve decimals', () => {
    const order: ProOrder = { id: 'id', revision: 1, spec: spec(), wallet: 'wallet', state: 'OPEN', createdAt: 0, updatedAt: 0, highWatermark: '0.000000010000', currentPriceUsd: '0.000000009750', trailActive: true };
    expect(trailingSummary(order)).toContain('Trigger 0.000000009500 USD');
    expect(trailingSummary(order)).toContain('Active');
    expect(trailingSummary({ ...order, trailActive: false })).toContain('Awaiting activation');
  });
  it('links only exact base58 64-byte transaction signatures', () => {
    const signature = bs58.encode(new Uint8Array(64).fill(42));
    expect(safeSolscanUrl(signature)).toBe(`https://solscan.io/tx/${signature}`);
    for (const invalid of ['javascript:alert(1)', 'https://evil.example', '<script>', '1'.repeat(88), `${signature}?secret=x`, bs58.encode(new Uint8Array(32).fill(42))]) expect(safeSolscanUrl(invalid)).toBeUndefined();
  });
});
