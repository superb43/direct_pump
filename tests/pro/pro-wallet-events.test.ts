import { expect, it, vi } from 'vitest';
import { PublicKey, type AccountChangeCallback, type Connection } from '@solana/web3.js';
import { watchWalletBalance } from '../../server/wallet-events';

function fixture() {
    let callback!: AccountChangeCallback;
    const connection = {
        onAccountChange: vi.fn((_wallet, listener) => { callback = listener; return 7; }),
        removeAccountChangeListener: vi.fn(async () => {}),
    };
    const event = vi.fn();
    const wallet = new PublicKey('11111111111111111111111111111111');
    const stop = watchWalletBalance(connection as unknown as Connection, wallet, { event });
    const change = (lamports: number, slot: number) => callback({
        lamports, owner: wallet, executable: false, data: Buffer.alloc(0), rentEpoch: 0,
    }, { slot });
    return { connection, wallet, event, stop, change };
}

it('observes confirmed external SOL deposits without signer or engine authority', async () => {
    const f = fixture();
    expect(f.connection.onAccountChange).toHaveBeenCalledWith(f.wallet, expect.any(Function), { commitment: 'confirmed' });
    expect(f.event).not.toHaveBeenCalled();
    f.change(1000, 10);
    f.change(2000, 11);
    expect(f.event).toHaveBeenCalledTimes(2);
    expect(f.event).toHaveBeenLastCalledWith('WALLET_BALANCE_CHANGED', 'Server wallet balance changed.');
    await f.stop();
});

it('suppresses unchanged balances, replayed slots and malformed notifications', async () => {
    const f = fixture();
    f.change(1000, 10);
    f.change(1000, 11);
    f.change(2000, 10);
    f.change(1000, 11);
    f.change(NaN, 12);
    f.change(-1, 12);
    f.change(2000, NaN);
    f.change(2000, -1);
    f.change(Number.MAX_SAFE_INTEGER + 1, 12);
    f.change(2000, 12);
    f.change(1000, 13);
    expect(f.event).toHaveBeenCalledTimes(3);
    await f.stop();
});

it('invalidates changed balances within the same confirmed slot', async () => {
    const f = fixture();
    f.change(1000, 10);
    f.change(2000, 10);
    f.change(2000, 10);
    expect(f.event).toHaveBeenCalledTimes(2);
    await f.stop();
});

it('fences callbacks immediately and waits for one unsubscribe before closing the store', async () => {
    const f = fixture();
    let finish!: () => void;
    f.connection.removeAccountChangeListener.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const stopped = f.stop();
    expect(f.stop()).toBe(stopped);
    f.change(1000, 10);
    await Promise.resolve();
    expect(f.connection.removeAccountChangeListener).toHaveBeenCalledExactlyOnceWith(7);
    const close = vi.fn();
    void stopped.then(close);
    expect(close).not.toHaveBeenCalled();
    finish();
    await stopped;
    f.change(2000, 11);
    expect(close).toHaveBeenCalledOnce();
    expect(f.event).not.toHaveBeenCalled();
});

it('keeps startup and shutdown available when optional subscription operations fail', async () => {
    const event = vi.fn();
    const connection = {
        onAccountChange: vi.fn(() => { throw new Error('Unavailable.'); }),
        removeAccountChangeListener: vi.fn(async () => {}),
    };
    const stop = watchWalletBalance(connection, new PublicKey('11111111111111111111111111111111'), { event });
    await expect(stop()).resolves.toBeUndefined();
    expect(connection.removeAccountChangeListener).not.toHaveBeenCalled();
    expect(event).toHaveBeenCalledExactlyOnceWith('WALLET_OBSERVATION_UNAVAILABLE', 'Live wallet updates unavailable.');
    const f = fixture();
    f.connection.removeAccountChangeListener.mockRejectedValue(new Error('Disconnected.'));
    await expect(f.stop()).resolves.toBeUndefined();
    f.change(1000, 10);
    expect(f.event).not.toHaveBeenCalled();
});
