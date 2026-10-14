import { describe, expect, it, vi } from 'vitest';
import { Connection, Keypair, PublicKey, SystemInstruction, SystemProgram, TransactionMessage, type AccountInfo } from '@solana/web3.js';
import { AccountLayout, AccountState, MintLayout, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, decodeTransferCheckedInstruction, ExtensionType } from '@solana/spl-token';
import { buildWithdrawalTransfer } from '../../server/withdrawal-transfer';
import { SOL } from '../../server/store';

function fixture() {
    const wallet = Keypair.generate().publicKey, recipient = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
    const accounts = new Map<string, AccountInfo<Buffer>>();
    const rpc = {
        getAccountInfo: vi.fn(async (key: PublicKey) => accounts.get(key.toBase58()) ?? null),
        getLatestBlockhash: vi.fn(async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 123 })),
        getFeeForMessage: vi.fn(async () => ({ context: { slot: 1 }, value: 5000 as number | null })),
        getMinimumBalanceForRentExemption: vi.fn(async () => 2039280),
        getBalance: vi.fn(async () => 10_000_000_000),
    };
    const spec = { address: recipient.toBase58(), mint: SOL, amountRaw: '100', decimals: 9, maxNetworkLamports: '3000000' };
    function token(program = TOKEN_PROGRAM_ID, amount = 1000n) {
        const mintData = Buffer.alloc(82);
        MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 1000n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
        accounts.set(mint.toBase58(), info(mintData, program));
        const source = getAssociatedTokenAddressSync(mint, wallet, false, program), dest = getAssociatedTokenAddressSync(mint, recipient, false, program);
        accounts.set(source.toBase58(), info(accountData(mint, wallet, amount), program));
        return { source, dest, spec: { ...spec, mint: mint.toBase58(), decimals: 6 } };
    }
    return { wallet, recipient, mint, accounts, rpc, connection: rpc as unknown as Connection, spec, token };
}
function info(data: Buffer, owner: PublicKey): AccountInfo<Buffer> { return { data, owner, lamports: 2039280, executable: false, rentEpoch: 0 }; }
function accountData(mint: PublicKey, owner: PublicKey, amount: bigint, state = AccountState.Initialized) {
    const data = Buffer.alloc(165);
    AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
    return data;
}

describe('independent withdrawal transfer builder', () => {
    it('builds only an exact unsigned SOL transfer to the reviewed recipient', async () => {
        const f = fixture();
        const result = await buildWithdrawalTransfer(f.connection, f.wallet, f.spec);
        const decoded = TransactionMessage.decompile(result.transaction.message);
        expect(decoded.instructions).toHaveLength(1);
        const transfer = SystemInstruction.decodeTransfer(decoded.instructions[0]!);
        expect(transfer.toPubkey.equals(f.recipient)).toBe(true);
        expect(transfer.fromPubkey.equals(f.wallet)).toBe(true);
        expect(transfer.lamports).toBe(100n);
        expect(result.feeLamports).toBe('5000');
        expect(result.rentLamports).toBe('0');
        expect(result.transaction.signatures[0]!.every(byte => byte === 0)).toBe(true);
    });
    it('creates missing ATA idempotently and sends TransferChecked with exact u64 amount', async () => {
        const f = fixture(), amount = (1n << 64n) - 1n, t = f.token(TOKEN_PROGRAM_ID, amount);
        const result = await buildWithdrawalTransfer(f.connection, f.wallet, { ...t.spec, amountRaw: String(amount) });
        const instructions = TransactionMessage.decompile(result.transaction.message).instructions;
        expect(instructions).toHaveLength(2);
        expect(instructions[0]!.data).toEqual(Buffer.from([1]));
        const transfer = decodeTransferCheckedInstruction(instructions[1]!);
        expect(transfer.data.amount).toBe(amount);
        expect(transfer.data.decimals).toBe(6);
        expect(transfer.keys.destination.pubkey.equals(t.dest)).toBe(true);
        expect(result.rentLamports).toBe('2039280');
    });
    it('reuses a validated destination ATA without rent', async () => {
        const f = fixture(), t = f.token();
        f.accounts.set(t.dest.toBase58(), info(accountData(f.mint, f.recipient, 0n), TOKEN_PROGRAM_ID));
        const result = await buildWithdrawalTransfer(f.connection, f.wallet, t.spec);
        expect(TransactionMessage.decompile(result.transaction.message).instructions).toHaveLength(1);
        expect(result.rentLamports).toBe('0');
    });
    it('supports plain Token2022 using its program for both instructions', async () => {
        const f = fixture(), t = f.token(TOKEN_2022_PROGRAM_ID);
        const result = await buildWithdrawalTransfer(f.connection, f.wallet, t.spec);
        const instructions = TransactionMessage.decompile(result.transaction.message).instructions;
        expect(instructions[1]!.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    });
    it('accepts metadata-only Token2022 mint and immutable-owner accounts', async () => {
        const f = fixture(), t = f.token(TOKEN_2022_PROGRAM_ID);
        const mintInfo = f.accounts.get(f.mint.toBase58())!;
        const data = Buffer.alloc(174); mintInfo.data.copy(data); data[165] = 1;
        data.writeUInt16LE(ExtensionType.MetadataPointer, 166);
        data.writeUInt16LE(ExtensionType.TokenMetadata, 170);
        f.accounts.set(f.mint.toBase58(), { ...mintInfo, data });
        const sourceInfo = f.accounts.get(t.source.toBase58())!;
        const account = Buffer.alloc(170); sourceInfo.data.copy(account); account[165] = 2;
        account.writeUInt16LE(ExtensionType.ImmutableOwner, 166);
        f.accounts.set(t.source.toBase58(), { ...sourceInfo, data: account });
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, t.spec)).resolves.toMatchObject({ rentLamports: '2039280' });
        account.writeUInt16LE(ExtensionType.MemoTransfer, 166);
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, t.spec)).rejects.toThrow('Unsupported token account extension');
    });
    it('rejects own-wallet, off-curve and program recipients', async () => {
        const f = fixture();
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, { ...f.spec, address: f.wallet.toBase58() })).rejects.toThrow('different on-curve');
        const [pda] = PublicKey.findProgramAddressSync([Buffer.from('test')], SystemProgram.programId);
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, { ...f.spec, address: pda.toBase58() })).rejects.toThrow('on-curve');
        f.accounts.set(f.recipient.toBase58(), info(Buffer.alloc(0), TOKEN_PROGRAM_ID));
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, f.spec)).rejects.toThrow('system wallet');
    });
    it.each(['0', '-1', '01', '1.5', '18446744073709551616'])('rejects invalid or overflowing amount %s', async amountRaw => {
        const f = fixture();
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, { ...f.spec, amountRaw })).rejects.toThrow('amount');
    });
    it('rejects changed mint decimals, wrong authority, frozen accounts and missing balance', async () => {
        const f = fixture(), t = f.token();
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, { ...t.spec, decimals: 9 })).rejects.toThrow('decimals');
        f.accounts.set(t.source.toBase58(), info(accountData(f.mint, f.recipient, 1000n), TOKEN_PROGRAM_ID));
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, t.spec)).rejects.toThrow('authority');
        f.accounts.set(t.source.toBase58(), info(accountData(f.mint, f.wallet, 1000n, AccountState.Frozen), TOKEN_PROGRAM_ID));
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, t.spec)).rejects.toThrow('state');
        f.accounts.set(t.source.toBase58(), info(accountData(f.mint, f.wallet, 99n), TOKEN_PROGRAM_ID));
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, t.spec)).rejects.toThrow('Insufficient token');
    });
    it('rejects unsafe mint extensions and destination accounts', async () => {
        const f = fixture(), t = f.token(TOKEN_2022_PROGRAM_ID);
        const base = f.accounts.get(f.mint.toBase58())!;
        const extended = Buffer.alloc(170); base.data.copy(extended); extended[165] = 1;
        extended.writeUInt16LE(ExtensionType.TransferHook, 166);
        f.accounts.set(f.mint.toBase58(), { ...base, data: extended });
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, t.spec)).rejects.toThrow('Pro does not support');
        f.accounts.set(f.mint.toBase58(), base);
        f.accounts.set(t.dest.toBase58(), info(accountData(f.mint, f.wallet, 0n), TOKEN_2022_PROGRAM_ID));
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, t.spec)).rejects.toThrow('authority');
    });
    it('fails closed on fee/rent cap, unavailable fee and insufficient SOL', async () => {
        const f = fixture(), t = f.token();
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, { ...t.spec, maxNetworkLamports: '5000' })).rejects.toThrow('cap');
        f.rpc.getFeeForMessage.mockResolvedValue({ context: { slot: 1 }, value: null });
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, f.spec)).rejects.toThrow('fee unavailable');
        f.rpc.getFeeForMessage.mockResolvedValue({ context: { slot: 1 }, value: 5000 });
        f.rpc.getBalance.mockResolvedValue(5099);
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, f.spec)).rejects.toThrow('Insufficient SOL');
        f.rpc.getBalance.mockResolvedValue(Number.MAX_SAFE_INTEGER + 1);
        await expect(buildWithdrawalTransfer(f.connection, f.wallet, f.spec)).rejects.toThrow('Invalid SOL balance');
    });
});
