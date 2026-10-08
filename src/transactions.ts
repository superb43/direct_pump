import { instructionManifest } from './manifest';
import { Connection, PublicKey, ComputeBudgetProgram, TransactionMessage, VersionedTransaction, type TransactionInstruction, type AddressLookupTableAccount } from '@solana/web3.js';
import type { Settings } from './model';
import { simulationFailure } from './simulation';

export class TransactionSizeError extends Error {
  constructor() { super('Transaction exceeds the v0 size limit. No wallet request was made.'); this.name = 'TransactionSizeError'; }
}
export function assertTransactionSize(transaction: VersionedTransaction): void {
  try { if (transaction.serialize().length > 1232) throw new TransactionSizeError(); }
  catch (error) {
    if (error instanceof TransactionSizeError || (error instanceof RangeError && /overrun|offset|encoding/i.test(error.message))) throw new TransactionSizeError();
    throw error;
  }
}

export async function finalizeTrade(rpc: Connection, instructions: TransactionInstruction[], wallet: PublicKey, settings: Settings, tables: AddressLookupTableAccount[] = []) {
  const latest = await rpc.getLatestBlockhashAndContext('confirmed');
  const core = instructions.filter(ix => !ix.programId.equals(ComputeBudgetProgram.programId));
  const make = (units: number, price: number) => new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: latest.value.blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }), ...core] }).compileToV0Message(tables));
  const probe = make(1_400_000, 0);
  assertTransactionSize(probe);
  const result = await rpc.simulateTransaction(probe, { sigVerify: false, commitment: 'confirmed' });
  if (result.value.err) throw simulationFailure(result.value.err, result.value.logs, probe);
  if (!result.value.unitsConsumed) throw new Error('Simulation did not return compute usage.');
  const units = Math.min(1_400_000, Math.ceil(result.value.unitsConsumed * 1.15));
  const transaction = make(units, Math.floor(settings.priorityFeeLamports * 1_000_000 / units));
  const final = await rpc.simulateTransaction(transaction, { sigVerify: false, commitment: 'confirmed' });
  if (final.value.err) throw simulationFailure(final.value.err, final.value.logs, transaction);
  return { transaction, feeManifest: instructionManifest(transaction.message, { addressLookupTableAccounts: tables }), latest: latest.value, observedSlot: latest.context.slot };
}
