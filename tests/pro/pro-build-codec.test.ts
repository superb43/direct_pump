import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

const codec = createRequire(import.meta.url)('bigint-buffer/dist/browser.js') as {
  toBigIntBE(bytes: Buffer): bigint;
  toBigIntLE(bytes: Buffer): bigint;
  toBufferBE(value: bigint, width: number): Buffer;
  toBufferLE(value: bigint, width: number): Buffer;
};

it.each([8, 16, 24, 32])('preserves %i-byte unsigned Solana fields with the pure-JS codec', width => {
  const cases = [
    { value: 0n, be: Buffer.alloc(width), le: Buffer.alloc(width) },
    { value: 1n, be: Buffer.concat([Buffer.alloc(width - 1), Buffer.from([1])]), le: Buffer.concat([Buffer.from([1]), Buffer.alloc(width - 1)]) },
    { value: 0x0102030405060708n, be: Buffer.concat([Buffer.alloc(width - 8), Buffer.from('0102030405060708', 'hex')]), le: Buffer.concat([Buffer.from('0807060504030201', 'hex'), Buffer.alloc(width - 8)]) },
    { value: (1n << BigInt(width * 8)) - 1n, be: Buffer.alloc(width, 255), le: Buffer.alloc(width, 255) },
  ];
  for (const { value, be, le } of cases) {
    expect(codec.toBufferBE(value, width)).toEqual(be);
    expect(codec.toBufferLE(value, width)).toEqual(le);
    expect(codec.toBigIntBE(be)).toBe(value);
    expect(codec.toBigIntLE(le)).toBe(value);
  }
});

it('decodes empty and long untrusted buffers without native loading', () => {
  expect(codec.toBigIntBE(Buffer.alloc(0))).toBe(0n);
  expect(codec.toBigIntLE(Buffer.alloc(0))).toBe(0n);
  expect(codec.toBigIntLE(Buffer.alloc(4096, 255))).toBe((1n << 32768n) - 1n);
});
