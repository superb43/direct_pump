import { describe, expect, it } from 'vitest';
import { detectPage, assertPageTarget } from '../../src/adapters';
import { parseSol, sellAmount, minimumOutput } from '../../src/amounts';
import { validateSettings } from '../../src/settings';
import { DEFAULT_SETTINGS, type Receipt } from '../../src/model';
import { isPending, settleReceipt } from '../../src/receipts/receipts';

const mint = '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
const pool = 'GseMAnNDvntR5uFePZ51yZBXzNSn7GdFPkfHwfr6d77J';

describe('page binding', () => {
  it('extracts GMGN mint and prefixed referral links', () => {
    expect(detectPage(`https://gmgn.ai/sol/token/${mint}`)?.address).toBe(mint);
    expect(detectPage(`https://gmgn.ai/sol/token/ref_${mint}`)?.address).toBe(mint);
  });
  it('uses the Axiom page pool rather than treating it as a mint', () => {
    expect(detectPage(`https://axiom.trade/meme/${pool}?chain=sol`)).toMatchObject({ kind: 'POOL', address: pool });
  });
  it('rejects lookalike hosts, unsupported chains and malformed addresses', () => {
    for (const url of [`https://gmgn.ai.attacker.test/sol/token/${mint}`, `https://axiom.trade/meme/${pool}?chain=eth`, 'https://gmgn.ai/sol/token/invalid', `http://gmgn.ai/sol/token/${mint}`]) expect(detectPage(url)).toBeNull();
  });
  it('invalidates an order after navigation', () => {
    const page = detectPage(`https://gmgn.ai/sol/token/${mint}`)!;
    expect(() => assertPageTarget(page, `https://gmgn.ai/sol/token/${pool}`)).toThrow();
  });
  it('allows query/hash/referral changes for the same token but blocks another chain', () => {
    const page = detectPage(`https://gmgn.ai/sol/token/${mint}`)!;
    expect(() => assertPageTarget(page, `https://gmgn.ai/sol/token/ref_${mint}?tab=holders#chart`)).not.toThrow();
    expect(() => assertPageTarget(page, page.pageUrl + '?chain=eth')).toThrow();
  });
});

describe('integer trading amounts', () => {
  it('converts SOL exactly, including one lamport', () => {
    expect(parseSol('0.1')).toBe(100_000_000n);
    expect(parseSol('0.000000001')).toBe(1n);
  });
  it('rejects float syntax, negative, zero and overflow input', () => {
    for (const input of ['0', '-1', '1e-3', '0.0000000001', 'NaN', '18446744074']) expect(() => parseSol(input)).toThrow();
  });
  it('floors percentages without losing large integer balances', () => {
    expect(sellAmount(9_007_199_254_740_993n, 50)).toBe(4_503_599_627_370_496n);
    expect(sellAmount(101n, 100)).toBe(101n);
    expect(() => sellAmount(1n, 25)).toThrow();
    expect(() => sellAmount(100n, 101)).toThrow();
  });
  it('slippage reduces output rather than increasing the budget', () => {
    expect(minimumOutput(1000n, 500)).toBe(950n);
    expect(() => minimumOutput(1000n, 2001)).toThrow();
    expect(() => minimumOutput(1n, 500)).toThrow();
  });
});

describe('settings validation', () => {
  it('defaults to the user-verified PublicNode endpoint', () => {
    expect(DEFAULT_SETTINGS.rpcUrl).toBe('https://solana-rpc.publicnode.com');
  });
  it('accepts defaults and blocks invalid endpoints/limits', () => {
    expect(validateSettings(DEFAULT_SETTINGS).slippageBps).toBe(500);
    for (const invalid of [
      { rpcUrl: 'http://localhost:8899' }, { rpcUrl: 'https://user:password@rpc.test' },
      { slippageBps: NaN }, { maxBuySol: '11' }, { priorityFeeLamports: 10_000_001 },
    ]) expect(() => validateSettings({ ...DEFAULT_SETTINGS, ...invalid })).toThrow();
    expect(() => validateSettings({})).toThrow();
  });
  it('migrates the optional private price socket and accepts only safe WSS endpoints',()=>{
    expect(validateSettings(DEFAULT_SETTINGS).priceWsUrl).toBe('');expect(validateSettings({...DEFAULT_SETTINGS,priceWsUrl:'wss://prices.test/?key=private'}).priceWsUrl).toContain('wss://prices.test/');
    for(const priceWsUrl of ['ws://prices.test','https://prices.test','wss://user:password@prices.test','wss://prices.test/#key'])expect(()=>validateSettings({...DEFAULT_SETTINGS,priceWsUrl})).toThrow();
  });
});

describe('minimum order recovery', () => {
  const receipt: Receipt = { wallet: mint, mint, venue: 'PUMP_CURVE', side: 'BUY', pageUrl: '', message: '', blockhash: '', lastValidBlockHeight: 100, createdAt: 1, status: 'SUBMITTED', signature: 'sig' };
  it('never equates processed with confirmed', () => {
    expect(settleReceipt(receipt, { err: null, confirmationStatus: 'processed' }, 101).status).toBe('SUBMITTED');
    expect(settleReceipt(receipt, { err: null, confirmationStatus: 'confirmed' }, 101).status).toBe('CONFIRMED');
  });
  it('keeps transmission uncertainty pending, then expires a known absent signature', () => {
    expect(isPending(settleReceipt(receipt, null, 99))).toBe(true);
    expect(settleReceipt(receipt, null, 101).status).toBe('EXPIRED');
    expect(settleReceipt({ ...receipt, signature: undefined }, null, 101).status).toBe('UNKNOWN');
  });
  it('marks on-chain errors terminal and does not request another trade', () => {
    const failed = settleReceipt(receipt, { err: { InstructionError: [0, 'failed'] } }, 99);
    expect(failed.status).toBe('FAILED'); expect(isPending(failed)).toBe(false);
  });
});
