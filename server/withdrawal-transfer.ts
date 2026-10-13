import { Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAccountLenForMint, getAssociatedTokenAddressSync, getExtensionTypes, ExtensionType, unpackAccount, unpackMint } from '@solana/spl-token';
import { assertProMintExtensions } from './execution';
import { SOL } from './store';

export interface WithdrawalTransferSpec {
    address: string;
    mint: string;
    amountRaw: string;
    decimals: number;
    maxNetworkLamports: string;
}
const U64_MAX = (1n << 64n) - 1n;
function raw(value: string, label: string, positive = false): bigint {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`Invalid ${label}.`);
    const result = BigInt(value);
    if (result > U64_MAX || positive && result === 0n) throw new Error(`Invalid ${label}.`);
    return result;
}
function rpcLamports(value: number, label: string): bigint {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}.`);
    return BigInt(value);
}

/** Construct an unsigned transfer from independently fetched, confirmed account data. */
export async function buildWithdrawalTransfer(connection: Connection, wallet: PublicKey, spec: WithdrawalTransferSpec) {
    const amount = raw(spec.amountRaw, 'withdrawal amount', true), cap = raw(spec.maxNetworkLamports, 'network fee cap');
    const recipient = new PublicKey(spec.address);
    if (!PublicKey.isOnCurve(recipient.toBytes()) || recipient.equals(wallet)) throw new Error('Recipient must be a different on-curve wallet.');
    if (recipient.toBase58() !== spec.address) throw new Error('Recipient address must be canonical.');
    if (!Number.isInteger(spec.decimals) || spec.decimals < 0 || spec.decimals > 255) throw new Error('Invalid decimals.');
    const recipientInfo = await connection.getAccountInfo(recipient, 'confirmed');
    if (recipientInfo && (recipientInfo.executable || !recipientInfo.owner.equals(SystemProgram.programId) || recipientInfo.data.length !== 0))
        throw new Error('Recipient must be a system wallet.');
    const instructions: TransactionInstruction[] = [];
    let rent = 0n;
    if (spec.mint === SOL) {
        if (spec.decimals !== 9) throw new Error('SOL decimals must be 9.');
        instructions.push(SystemProgram.transfer({ fromPubkey: wallet, toPubkey: recipient, lamports: amount }));
    } else {
        const mintAddress = new PublicKey(spec.mint);
        if (mintAddress.toBase58() !== spec.mint) throw new Error('Mint address must be canonical.');
        const mintInfo = await connection.getAccountInfo(mintAddress, 'confirmed');
        if (!mintInfo || mintInfo.executable) throw new Error('Mint unavailable.');
        assertProMintExtensions({ tlvData: Buffer.alloc(0) }, mintInfo.owner);
        const mint = unpackMint(mintAddress, mintInfo, mintInfo.owner);
        assertProMintExtensions(mint, mintInfo.owner);
        if (!mint.isInitialized || mint.decimals !== spec.decimals) throw new Error('Mint decimals or initialization mismatch.');
        const source = getAssociatedTokenAddressSync(mintAddress, wallet, false, mintInfo.owner);
        const destination = getAssociatedTokenAddressSync(mintAddress, recipient, false, mintInfo.owner);
        const [sourceInfo, destinationInfo] = await Promise.all([
            connection.getAccountInfo(source, 'confirmed'), connection.getAccountInfo(destination, 'confirmed'),
        ]);
        const validateAccount = (address: PublicKey, info: NonNullable<typeof sourceInfo>, owner: PublicKey) => {
            if (info.executable) throw new Error('Invalid token account.');
            const account = unpackAccount(address, info, mintInfo.owner);
            if (!account.mint.equals(mintAddress) || !account.owner.equals(owner) || !account.isInitialized || account.isFrozen)
                throw new Error('Token account authority or state mismatch.');
            if (getExtensionTypes(account.tlvData).some(type => type !== ExtensionType.ImmutableOwner))
                throw new Error('Unsupported token account extension.');
            return account;
        };
        if (!sourceInfo) throw new Error('Source token account unavailable.');
        if (validateAccount(source, sourceInfo, wallet).amount < amount) throw new Error('Insufficient token balance.');
        if (destinationInfo) validateAccount(destination, destinationInfo, recipient);
        else {
            rent = rpcLamports(await connection.getMinimumBalanceForRentExemption(getAccountLenForMint(mint), 'confirmed'), 'account rent');
            instructions.push(createAssociatedTokenAccountIdempotentInstruction(wallet, destination, recipient, mintAddress, mintInfo.owner));
        }
        instructions.push(createTransferCheckedInstruction(source, mintAddress, destination, wallet, amount, spec.decimals, [], mintInfo.owner));
    }
    const latest = await connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({ payerKey: wallet, recentBlockhash: latest.blockhash, instructions }).compileToV0Message();
    const feeResult = await connection.getFeeForMessage(message, 'confirmed');
    if (feeResult.value === null) throw new Error('Withdrawal fee unavailable.');
    const fee = rpcLamports(feeResult.value, 'network fee');
    if (fee + rent > cap) throw new Error('Withdrawal costs exceed network fee cap.');
    const balance = rpcLamports(await connection.getBalance(wallet, 'confirmed'), 'SOL balance');
    if (balance < fee + rent + (spec.mint === SOL ? amount : 0n)) throw new Error('Insufficient SOL balance for withdrawal and costs.');
    return { transaction: new VersionedTransaction(message), blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight, feeLamports: String(fee), rentLamports: String(rent) };
}

/** Cost preview uses the same validation and instruction builder as signing. */
export const estimateWithdrawalTransfer = buildWithdrawalTransfer;
