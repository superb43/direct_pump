import { Connection, PublicKey, VersionedMessage, type LoadedAddresses } from '@solana/web3.js';
import bs58 from 'bs58';
import type { Receipt } from './model';
import { PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { LAUNCHPAD_PROGRAM, CREATE_CPMM_POOL_PROGRAM } from '@raydium-io/raydium-sdk-v2';
import { DYNAMIC_BONDING_CURVE_PROGRAM_ID } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { CP_AMM_PROGRAM_ID } from '@meteora-ag/cp-amm-sdk';

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const EXECUTION_PROGRAMS = [PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, LAUNCHPAD_PROGRAM, CREATE_CPMM_POOL_PROGRAM, DYNAMIC_BONDING_CURVE_PROGRAM_ID, CP_AMM_PROGRAM_ID, new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')];

export function matchesTradeMessage(original: string, actual: VersionedMessage, loaded?: LoadedAddresses): boolean {
  if (bs58.encode(actual.serialize()) === original) return true;
  const expected = VersionedMessage.deserialize(bs58.decode(original));
  if (!expected.staticAccountKeys[0]?.equals(actual.staticAccountKeys[0]!)) return false;
  const fingerprint = (message: VersionedMessage, lookups?: LoadedAddresses) => {
    const keys = message.getAccountKeys(lookups ? { accountKeysFromLookups: lookups } : undefined);
    return message.compiledInstructions.filter(ix => {
      const program = keys.get(ix.programIdIndex);
      return program && EXECUTION_PROGRAMS.some(allowed => program.equals(allowed));
    }).map(ix => ({ program: keys.get(ix.programIdIndex)!.toBase58(), data: bs58.encode(ix.data),
      accounts: ix.accountKeyIndexes.map(index => ({ address: keys.get(index)!.toBase58(), signer: message.isAccountSigner(index), writable: message.isAccountWritable(index) })),
    }));
  };
  const intended = fingerprint(expected);
  // Phantom can refresh blockhash/compute-budget instructions. Require the
  // identical payer and all Pump instruction data/accounts before treating a
  // resulting trade as fulfilled; this prevents an accidental duplicate retry.
  return intended.length > 0 && JSON.stringify(intended) === JSON.stringify(fingerprint(actual, loaded));
}

// Read-only recovery. Never resend/re-sign a transaction or reset on elapsed time alone.
export async function reconcileMissingSignature(rpc: Connection, receipt: Receipt): Promise<Receipt> {
  const height = await rpc.getBlockHeight('finalized');
  if (height <= receipt.lastValidBlockHeight) return { ...receipt, status: 'UNKNOWN', error: receipt.error ?? 'The Phantom request outcome is unresolved. Chain history will be checked after expiry.' };
  if (await rpc.getGenesisHash() !== MAINNET_GENESIS) throw new Error('Unresolved trades can only be reconciled on Solana Mainnet.');
  if ((await rpc.isBlockhashValid(receipt.blockhash, { commitment: 'finalized' })).value) return receipt;
  const entries = await rpc.getSignaturesForAddress(new PublicKey(receipt.wallet), { limit: 100 }, 'finalized');
  let covered = false;
  let unavailable = false;
  for (const entry of entries) {
    const transaction = await rpc.getTransaction(entry.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!transaction) { unavailable = true; continue; }
    let matches = false;
    try { matches = matchesTradeMessage(receipt.message, transaction.transaction.message, transaction.meta?.loadedAddresses); }
    catch { unavailable = true; }
    if (matches) {
      if (!transaction.meta) return { ...receipt, signature: entry.signature, status: 'UNKNOWN', error: 'The transaction was found, but execution metadata is missing. Continuing status checks.' };
      return { ...receipt, signature: entry.signature, status: transaction.meta?.err ? 'FAILED' : 'CONFIRMED', error: transaction.meta?.err ? `On-chain transaction failed: ${JSON.stringify(transaction.meta.err)}` : undefined };
    }
    if (receipt.observedSlot !== undefined && entry.slot < receipt.observedSlot - 64) { covered = true; break; }
  }
  if (receipt.observedSlot === undefined && entries.length) {
    // Legacy receipts lack a chain slot. Use chain block heights, never local
    // wall-clock timestamps. 300 is a conservative two-window margin over the
    // Solana 150-block recent-blockhash processing lifetime.
    const oldest = entries.at(-1)!;
    const block = await rpc.getBlock(oldest.slot, { commitment: 'finalized', transactionDetails: 'none' as const, rewards: false, maxSupportedTransactionVersion: 0 });
    covered = !!block && 'blockHeight' in block && typeof block.blockHeight === 'number' && block.blockHeight < receipt.lastValidBlockHeight - 300;
  }
  if (covered && !unavailable) return { ...receipt, status: 'EXPIRED', error: 'The blockhash expired and the covered wallet history contains no matching trade. You can submit a new request.' };
  return { ...receipt, status: 'UNKNOWN', error: 'The previous Phantom request is unresolved. RPC history coverage is insufficient; new orders remain blocked.' };
}
