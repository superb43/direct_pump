import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createWalletBridge, walletFailure, type PhantomProvider } from '../../src/wallet-bridge';
import type { PageTarget } from '../../src/model';

const wallet = '9XDYTfQKwW8sHPqnFdUreMmtmffmkHVPGTNV2e3LKxNW';
const target: PageTarget = { site: 'GMGN', kind: 'MINT', address: '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump', pageUrl: 'https://gmgn.ai/sol/token/7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump' };
const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(wallet), recentBlockhash: PublicKey.default.toBase58(), instructions: [] }).compileToV0Message());
let provider: PhantomProvider;
let url: string;
beforeEach(() => {
  url = target.pageUrl;
  provider = { isPhantom: true, publicKey: { toString: () => wallet }, connect: vi.fn().mockResolvedValue({ publicKey: { toString: () => wallet } }), signAndSendTransaction: vi.fn().mockResolvedValue({ signature: 'sig' }) };
});

describe('Phantom native versioned transaction bridge', () => {
  it('passes the full VersionedTransaction and never calls the old raw-message request API', async () => {
    const bridge = createWalletBridge(() => provider, () => url);
    expect(bridge.prepare('order', target, wallet, Array.from(transaction.serialize()))).toBeUndefined();
    expect((await bridge.send('order')).state).toBe('SUBMITTED');
    const sent = vi.mocked(provider.signAndSendTransaction).mock.calls[0]![0];
    expect(sent).toBeInstanceOf(VersionedTransaction);
    expect(sent.message.serialize()).toEqual(transaction.message.serialize());
  });
  it('preserves valid context across same-token query/hash navigation', async () => {
    const bridge = createWalletBridge(() => provider, () => url);
    url += '?tab=holders#chart';
    bridge.prepare('order', target, wallet, Array.from(transaction.serialize()));
    expect((await bridge.send('order')).state).toBe('SUBMITTED');
  });
  it('blocks changed tokens or wallet before invoking Phantom', async () => {
    const bridge = createWalletBridge(() => provider, () => url);
    bridge.prepare('order', target, wallet, Array.from(transaction.serialize()));
    url = 'https://gmgn.ai/sol/token/' + wallet;
    expect((await bridge.send('order')).state).toBe('NOT_SENT');
    expect(provider.signAndSendTransaction).not.toHaveBeenCalled();
    url = target.pageUrl; provider.publicKey = { toString: () => target.address };
    expect(bridge.prepare('next', target, wallet, Array.from(transaction.serialize()))?.state).toBe('NOT_SENT');
  });
  it('does not invoke Phantom with malformed bytes', () => {
    const bridge = createWalletBridge(() => provider, () => url);
    expect(bridge.prepare('order', target, wallet, [1, 2, 3])?.state).toBe('NOT_SENT');
    expect(provider.signAndSendTransaction).not.toHaveBeenCalled();
  });
  it.each([4001, 4100, -32000, -32002, -32003, -32601, -32602])('returns rejection code %s as NOT_SENT rather than UNKNOWN', async code => {
    vi.mocked(provider.signAndSendTransaction).mockRejectedValue({ code, message: 'precise wallet reason' });
    const bridge = createWalletBridge(() => provider, () => url);
    bridge.prepare('order', target, wallet, Array.from(transaction.serialize()));
    const result = await bridge.send('order');
    expect(result.state).toBe('NOT_SENT'); expect(result.diagnostic?.code).toBe(code);
    expect(result.error).toContain('precise wallet reason');
  });
  it('keeps genuine request uncertainty without discarding the actual error', () => {
    const result = walletFailure({ code: -32603, message: 'response lost' }, true);
    expect(result.state).toBe('UNKNOWN'); expect(result.error).toContain('response lost');
  });
  it('does not invoke twice when the same order is consumed concurrently', async () => {
    const bridge = createWalletBridge(() => provider, () => url);
    bridge.prepare('order', target, wallet, Array.from(transaction.serialize()));
    await Promise.all([bridge.send('order'), bridge.send('order')]);
    expect(provider.signAndSendTransaction).toHaveBeenCalledOnce();
  });
  it('atomically cancels a prepared call so a late old invocation cannot sign', async () => {
    const bridge = createWalletBridge(() => provider, () => url);
    bridge.prepare('order', target, wallet, Array.from(transaction.serialize())); bridge.cancelPrepared('order');
    expect((await bridge.send('order')).state).toBe('NOT_SENT');
    expect(provider.signAndSendTransaction).not.toHaveBeenCalled();
  });
});
