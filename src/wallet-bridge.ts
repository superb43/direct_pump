import { VersionedTransaction, type SendOptions } from '@solana/web3.js';
import { assertPageTarget } from './sites/catalog';
import type { PageTarget, TradeDiagnostic } from './model';
import { redactUrls } from './errors';

export type PhantomProvider = {
  isPhantom?: boolean;
  isConnected?: boolean;
  publicKey?: { toString(): string };
  connect(options?: { onlyIfTrusted: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect?(): Promise<void>;
  signAndSendTransaction(transaction: VersionedTransaction, options?: SendOptions): Promise<{ signature: string }>;
};

export type WalletResult = {
  state: 'SUBMITTED' | 'NOT_SENT' | 'UNKNOWN'; invoked: boolean;
  signature?: string; error?: string; diagnostic?: TradeDiagnostic;
};
type PreparedCall = {
  target: PageTarget; wallet: string; transaction: VersionedTransaction;
  stage: 'PREPARED' | 'INVOKED' | 'DONE'; result?: WalletResult; promise?: Promise<WalletResult>;
};

export function walletFailure(error: unknown, invoked: boolean): WalletResult {
  const value = error as { code?: number; message?: string } | null;
  const code = typeof value?.code === 'number' ? value.code : undefined;
  const raw = redactUrls(typeof value?.message === 'string' ? value.message : String(error));
  const explanations: Record<number, string> = {
    4001: 'Phantom approval was rejected.', 4100: 'Phantom has not authorized this account. Reconnect the wallet.',
    [-32000]: 'Phantom rejected the transaction input.',
    [-32002]: 'Approve or reject the existing Phantom request first.',
    [-32003]: 'Phantom did not recognize a valid transaction.',
    [-32601]: 'This Phantom signing method is not supported.',
    [-32602]: 'Invalid transaction parameters were sent to Phantom.',
    4900: 'Phantom could not connect to its network.',
  };
  const rejected = code !== undefined && [4001, 4100, -32000, -32002, -32003, -32601, -32602].includes(code);
  const errorText = `${code !== undefined ? `${explanations[code] ?? 'Phantom error'} (${code})` : invoked ? 'Phantom request failed' : 'Phantom preparation failed'}: ${raw}`;
  return { state: !invoked || rejected ? 'NOT_SENT' : 'UNKNOWN', invoked, error: errorText,
    diagnostic: { stage: invoked ? 'PHANTOM_REQUEST' : 'PHANTOM_PREPARE', code, error: raw } };
}

export function createWalletBridge(getProvider: () => PhantomProvider | undefined, getUrl: () => string) {
  const calls = new Map<string, PreparedCall>();
  function provider(wallet?: string) {
    const value = getProvider();
    if (!value?.isPhantom) throw new Error('Phantom provider was not found.');
    if (wallet && value.publicKey?.toString() !== wallet) throw new Error('The Phantom account changed. Reconnect the wallet.');
    if (wallet && typeof value.signAndSendTransaction !== 'function') throw new Error('Phantom signAndSendTransaction is unavailable.');
    return value;
  }
  return {
    version: 2,
    async restore(target: PageTarget): Promise<{ wallet?: string }> {
      try {
        assertPageTarget(target, getUrl());
        const value = provider();
        if (value.publicKey && value.isConnected !== false) return { wallet: value.publicKey.toString() };
        const response = await value.connect({ onlyIfTrusted: true });
        assertPageTarget(target, getUrl());
        return { wallet: response.publicKey.toString() };
      } catch { return {}; } // Never fall back to a prompting connect on page load.
    },
    async switchWallet(target: PageTarget): Promise<{ wallet?: string; error?: string }> {
      try {
        assertPageTarget(target, getUrl());
        const value = provider();
        if (!value.disconnect) throw new Error('Open Phantom to select another account, then reconnect.');
        await value.disconnect();
        const response = await value.connect();
        assertPageTarget(target, getUrl());
        return { wallet: response.publicKey.toString() };
      } catch (error) { return { error: walletFailure(error, false).error }; }
    },
    async connect(target: PageTarget): Promise<{ wallet?: string; error?: string }> {
      try {
        assertPageTarget(target, getUrl());
        const value = provider();
        let response;
        try { response = await value.connect({ onlyIfTrusted: true }); }
        catch { response = await value.connect(); }
        assertPageTarget(target, getUrl());
        return { wallet: response.publicKey.toString() };
      } catch (error) { return { error: walletFailure(error, false).error }; }
    },
    prepare(id: string, target: PageTarget, wallet: string, bytes: number[]): WalletResult | undefined {
      try {
        assertPageTarget(target, getUrl()); provider(wallet);
        const transaction = VersionedTransaction.deserialize(Uint8Array.from(bytes));
        if (transaction.message.staticAccountKeys[0]?.toBase58() !== wallet) throw new Error('The transaction fee payer does not match the connected Phantom account.');
        if (transaction.message.header.numRequiredSignatures !== 1) throw new Error('The transaction requires an additional signer.');
        calls.set(id, { target, wallet, transaction, stage: 'PREPARED' });
        return undefined;
      } catch (error) { return walletFailure(error, false); }
    },
    async send(id: string): Promise<WalletResult> {
      const call = calls.get(id);
      if (!call) return walletFailure(new Error('No prepared Phantom transaction was found.'), false);
      if (call.result) return call.result;
      if (call.promise) return call.promise;
      try { assertPageTarget(call.target, getUrl()); provider(call.wallet); }
      catch (error) { call.result = walletFailure(error, false); call.stage = 'DONE'; return call.result; }
      call.promise = (async () => {
        call.stage = 'INVOKED';
        let result: WalletResult;
        try {
          const response = await provider(call.wallet).signAndSendTransaction(call.transaction, { preflightCommitment: 'confirmed', skipPreflight: false });
          if (typeof response.signature !== 'string' || !response.signature) throw new Error('The Phantom response did not include a transaction signature.');
          result = { state: 'SUBMITTED', invoked: true, signature: response.signature };
        } catch (error) { result = walletFailure(error, true); }
        call.result = result; call.stage = 'DONE';
        return result;
      })();
      return call.promise;
    },
    inspect(id: string) {
      const call = calls.get(id);
      return call ? { stage: call.stage, result: call.result } : undefined;
    },
    cancelPrepared(id: string) {
      const call = calls.get(id);
      if (call?.stage === 'PREPARED') {
        call.result = walletFailure(new Error('The request was interrupted before invoking Phantom. You can submit a new request.'), false);
        call.stage = 'DONE';
      }
    },
  };
}

export type WalletBridge = ReturnType<typeof createWalletBridge>;
declare global { interface Window {
  phantom?: { solana?: PhantomProvider };
  __directPumpWallet?: WalletBridge;
} }
