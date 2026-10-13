import type { Connection, PublicKey } from '@solana/web3.js';
import type { ProStore } from './store';

export function watchWalletBalance(
    connection: Pick<Connection, 'onAccountChange' | 'removeAccountChangeListener'>,
    wallet: PublicKey,
    store: Pick<ProStore, 'event'>,
): () => Promise<void> {
    let stopped = false, lastSlot = -1, lastLamports: number | undefined;
    let subscription: number | undefined;
    let cleanup: Promise<void> | undefined;
    try {
        subscription = connection.onAccountChange(wallet, (account, context) => {
            if (stopped || !Number.isSafeInteger(context.slot) || context.slot < 0 ||
                !Number.isSafeInteger(account.lamports) || account.lamports < 0 || context.slot < lastSlot) return;
            lastSlot = context.slot;
            if (account.lamports === lastLamports) return;
            lastLamports = account.lamports;
            store.event('WALLET_BALANCE_CHANGED', 'Server wallet balance changed.');
        }, { commitment: 'confirmed' });
    } catch {
        // Optional observation must not prevent the API from starting.
        stopped = true;
        store.event('WALLET_OBSERVATION_UNAVAILABLE', 'Live wallet updates unavailable.');
    }
    return () => {
        stopped = true;
        cleanup ??= subscription === undefined ? Promise.resolve() :
            Promise.resolve().then(() => connection.removeAccountChangeListener(subscription!)).catch(() => {});
        return cleanup;
    };
}
