import { Buffer } from 'buffer';
import { expect, it, vi } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { decodeLegacySymbol, cleanSymbol } from '../src/token-info';
import { tokenLabel } from '../src/panel';
import { validateSettings } from '../src/settings';
import { DEFAULT_SETTINGS } from '../src/model';
import { createWalletBridge } from '../src/wallet-bridge';
import { parseUnits } from '../src/amounts';

it('formats the requested token ticker/address label', () => {
  expect(tokenLabel('SI', 'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP')).toBe('$SI (DEW9dS…i98WDP)');
});

it('decodes ticker metadata only when the embedded mint matches', () => {
  const mint = Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey;
  const string = (value: string) => { const bytes = Buffer.from(value); const size = Buffer.alloc(4); size.writeUInt32LE(bytes.length); return Buffer.concat([size, bytes]); };
  const data = Buffer.concat([Buffer.from([4]), Buffer.alloc(32), mint.toBuffer(), string('Sample token'), string('SI\0\0')]);
  expect(decodeLegacySymbol(data, mint)).toBe('SI');
  expect(decodeLegacySymbol(data, PublicKey.default)).toBeUndefined();
  expect(cleanSymbol('$SI\u202e')).toBe('SI');
});

it('migrates old saved settings and validates configurable presets', () => {
  const migrated = validateSettings({ rpcUrl: DEFAULT_SETTINGS.rpcUrl, slippageBps: 500, maxBuySol: '1', priorityFeeLamports: 100_000 });
  expect(migrated.buyPresets).toEqual(DEFAULT_SETTINGS.buyPresets);
  expect(migrated.sellPresets).toContain(75);
  expect(migrated.jupiterApiKey).toBe('');
  expect(() => validateSettings({ ...DEFAULT_SETTINGS, sellPresets: [25, 25] })).toThrow();
  expect(() => validateSettings({ ...DEFAULT_SETTINGS, buyPresets: ['0'] })).toThrow();
});

it('restores an already-connected Phantom account without invoking connect', async () => {
  const connect = vi.fn();
  const provider = { isPhantom: true, isConnected: true, publicKey: { toString: () => 'connected-wallet' }, connect, signAndSendTransaction: vi.fn() };
  const target = { site: 'GMGN' as const, kind: 'MINT' as const, address: 'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP', pageUrl: 'https://gmgn.ai/sol/token/DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP' };
  expect(await createWalletBridge(() => provider, () => target.pageUrl).restore(target)).toEqual({ wallet: 'connected-wallet' });
  expect(connect).not.toHaveBeenCalled();
});

it('never turns a failed silent restore into an authorization popup', async () => {
  const connect = vi.fn().mockRejectedValue({ code: 4001 });
  const provider = { isPhantom: true, isConnected: false, connect, signAndSendTransaction: vi.fn() };
  const target = { site: 'GMGN' as const, kind: 'MINT' as const, address: 'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP', pageUrl: 'https://gmgn.ai/sol/token/DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP' };
  expect(await createWalletBridge(() => provider, () => target.pageUrl).restore(target)).toEqual({});
  expect(connect).toHaveBeenCalledOnce(); expect(connect).toHaveBeenCalledWith({ onlyIfTrusted: true });
});

it('uses actual payment-asset decimals without floating-point amounts', () => {
  expect(parseUnits('0.1', 6)).toBe(100_000n);
  expect(parseUnits('0.1', 8)).toBe(10_000_000n);
  expect(() => parseUnits('0.0000001', 6)).toThrow();
});
