import { expect, it } from 'vitest';
import bs58 from 'bs58';
import { depositQrSvg, validDepositAddress } from '../src/pro/wallet-view';

it('accepts only complete 32-byte Solana addresses before generating a receive QR', () => {
  for (const address of ['7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump', bs58.encode(new Uint8Array(32)), bs58.encode(new Uint8Array(32).fill(255))]) {
    expect(validDepositAddress(address)).toBe(true);
    expect(depositQrSvg(address)).toContain('<svg');
  }
  for (const address of ['', 'loading', '<script>', '0'.repeat(44), '1'.repeat(44), bs58.encode(new Uint8Array(31)), bs58.encode(new Uint8Array(33))]) {
    expect(validDepositAddress(address)).toBe(false);
    expect(() => depositQrSvg(address)).toThrow('address unavailable');
  }
});
