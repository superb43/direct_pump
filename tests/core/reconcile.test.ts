import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'buffer';
import { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { matchesTradeMessage, reconcileMissingSignature } from '../../src/reconcile';
import type { Receipt } from '../../src/model';

const wallet = new PublicKey('9XDYTfQKwW8sHPqnFdUreMmtmffmkHVPGTNV2e3LKxNW');
const mint = new PublicKey('7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump');
const message = (blockhash = PublicKey.default.toBase58(), data = 1) => new TransactionMessage({ payerKey: wallet, recentBlockhash: blockhash, instructions: [new TransactionInstruction({ programId: PUMP_PROGRAM_ID, keys: [{ pubkey: mint, isSigner: false, isWritable: true }], data: Buffer.from([data]) })] }).compileToV0Message();
const receipt: Receipt = { wallet: wallet.toBase58(), mint: mint.toBase58(), venue: 'PUMP_CURVE', side: 'BUY', pageUrl: '', message: bs58.encode(message().serialize()), blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 1000, observedSlot: 1500, createdAt: Date.now(), status: 'UNKNOWN' };

function mockRpc() {
  const rpc = {
    getBlockHeight: vi.fn().mockResolvedValue(2000),
    getGenesisHash: vi.fn().mockResolvedValue('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'),
    isBlockhashValid: vi.fn().mockResolvedValue({ value: false }),
    getSignaturesForAddress: vi.fn().mockResolvedValue([{ signature: 'older', slot: 1000 }]),
    getTransaction: vi.fn().mockResolvedValue({ transaction: { message: message(PublicKey.default.toBase58(), 2) }, meta: { err: null } }),
    getBlock: vi.fn().mockResolvedValue({ blockHeight: 500 }),
  };
  return { methods: rpc, rpc: rpc as unknown as Connection };
}

describe('read-only unresolved order recovery', () => {
  it('recovers a finalized matching trade rather than submitting another', async () => {
    const { rpc, methods } = mockRpc();
    methods.getSignaturesForAddress.mockResolvedValue([{ signature: 'found', slot: 1600 }]);
    methods.getTransaction.mockResolvedValue({ transaction: { message: message() }, meta: { err: null } });
    const result = await reconcileMissingSignature(rpc, receipt);
    expect(result.status).toBe('CONFIRMED'); expect(result.signature).toBe('found');
  });
  it('recognizes unchanged Pump intent if Phantom refreshes the recent blockhash', () => {
    expect(matchesTradeMessage(receipt.message, message(wallet.toBase58()))).toBe(true);
    expect(matchesTradeMessage(receipt.message, message(wallet.toBase58(), 2))).toBe(false);
  });
  it('releases only after finalized expiration and history coverage', async () => {
    const { rpc, methods } = mockRpc();
    expect((await reconcileMissingSignature(rpc, receipt)).status).toBe('EXPIRED');
    methods.getTransaction.mockResolvedValue(null as never);
    expect((await reconcileMissingSignature(rpc, receipt)).status).toBe('UNKNOWN');
  });
  it('does not equate an empty or truncated wallet history with absence', async () => {
    const { rpc, methods } = mockRpc();
    methods.getSignaturesForAddress.mockResolvedValue([]);
    expect((await reconcileMissingSignature(rpc, receipt)).status).toBe('UNKNOWN');
    methods.getSignaturesForAddress.mockResolvedValue([{ signature: 'recent', slot: 1600 }]);
    expect((await reconcileMissingSignature(rpc, receipt)).status).toBe('UNKNOWN');
  });
  it('uses chain block heights for legacy receipts instead of wall-clock estimates', async () => {
    const { rpc, methods } = mockRpc();
    expect((await reconcileMissingSignature(rpc, { ...receipt, observedSlot: undefined, createdAt: 0 })).status).toBe('EXPIRED');
    expect(methods.getBlock).toHaveBeenCalledOnce();
    methods.getBlock.mockResolvedValue({ blockHeight: 999 });
    expect((await reconcileMissingSignature(rpc, { ...receipt, observedSlot: undefined })).status).toBe('UNKNOWN');
  });
  it('retains pending state before expiry and rejects the wrong cluster', async () => {
    const { rpc, methods } = mockRpc(); methods.getBlockHeight.mockResolvedValue(900);
    expect((await reconcileMissingSignature(rpc, receipt)).status).toBe('UNKNOWN');
    expect(methods.getSignaturesForAddress).not.toHaveBeenCalled();
    methods.getBlockHeight.mockResolvedValue(2000); methods.getGenesisHash.mockResolvedValue('devnet');
    await expect(reconcileMissingSignature(rpc, receipt)).rejects.toThrow('Mainnet');
  });
});
