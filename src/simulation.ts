import type { TransactionError, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { pumpIdl, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { OFFLINE_PUMP_AMM_PROGRAM } from '@pump-fun/pump-swap-sdk';
import { readableCoder } from './coder';
import type { TradeDiagnostic } from './model';

export class SimulationFailure extends Error {
  constructor(message: string, readonly diagnostic: TradeDiagnostic) { super(message); }
}

export function simulationFailure(
  error: TransactionError, logs: string[] | null,
  transaction?: VersionedTransaction,
): SimulationFailure {
  const lines = logs ?? [];
  const raw = typeof error === 'string' ? error : JSON.stringify(error);
  const value = typeof error === 'object' ? (error as { InstructionError?: unknown }).InstructionError : undefined;
  const instructionError = Array.isArray(value) ? value : undefined;
  const index = typeof instructionError?.[0] === 'number' ? instructionError[0] : undefined;
  const reason: unknown = instructionError?.[1];
  const customCode = typeof reason === 'object' && reason !== null && 'Custom' in reason && typeof reason.Custom === 'number' ? reason.Custom : undefined;
  const failedProgram = lines.map(line => /^Program ([1-9A-HJ-NP-Za-km-z]+) failed:/.exec(line)?.[1]).find(Boolean);
  const anchorLine = lines.find(line => /Error Code:/.test(line));
  const anchorName = anchorLine && /Error Code:\s*([^ .]+)/.exec(anchorLine)?.[1];
  const anchorMessage = anchorLine && /Error Message:\s*(.+)/.exec(anchorLine)?.[1];
  const definitions = failedProgram === PUMP_PROGRAM_ID.toBase58() ? pumpIdl.errors
    : failedProgram === OFFLINE_PUMP_AMM_PROGRAM.programId.toBase58() ? OFFLINE_PUMP_AMM_PROGRAM.idl.errors : undefined;
  const defined = definitions?.find(item => item.code === customCode);
  const errorName = anchorName ?? defined?.name;
  const explanation = anchorMessage ?? (defined && 'msg' in defined ? defined.msg : undefined);
  const lamports = lines.map(line => /insufficient lamports\s+(\d+),\s*need\s+(\d+)/i.exec(line)).find(Boolean);
  let message: string;
  if (lamports) message = `Insufficient SOL: available ${lamports[1]}lamports; required ${lamports[2]} lamports.`;
  else if (/InsufficientFundsForRent/.test(raw)) message = 'Insufficient SOL for account rent.';
  else if (/insufficient funds/i.test(lines.join('\n')) || /InsufficientFunds/.test(raw)) message = 'Insufficient balance for the trade, network fee or account setup.';
  else if (errorName && /slippage|TooMuchSolRequired|TooLittleSolReceived/i.test(errorName)) message = `Slippage limit exceeded: ${errorName}${explanation ? ` — ${explanation}` : ''}`;
  else if (errorName === 'BondingCurveComplete') message = 'The token graduated during preparation (BondingCurveComplete). Submit a new request on the updated route.';
  else if (errorName) message = `Protocol error: ${errorName}${customCode !== undefined ? ` (${customCode})` : ''}${explanation ? ` — ${explanation}` : ''}`;
  else if (raw === 'BlockhashNotFound') message = 'The transaction blockhash is not valid on this RPC (BlockhashNotFound).';
  else message = `Transaction simulation failed: ${raw}`;
  let instruction: string | undefined;
  if (transaction && index !== undefined) {
    const ix = transaction.message.compiledInstructions[index];
    const program = ix && transaction.message.staticAccountKeys[ix.programIdIndex];
    if (ix && program) {
      const coder = program.equals(PUMP_PROGRAM_ID) ? undefined : program.equals(OFFLINE_PUMP_AMM_PROGRAM.programId) ? readableCoder(OFFLINE_PUMP_AMM_PROGRAM.coder.instruction) : undefined;
      if (coder) instruction = coder.decode(Buffer.from(ix.data))?.name;
      else if (program.equals(PUMP_PROGRAM_ID)) instruction = pumpIdl.instructions.find(item => item.discriminator.every((byte, offset) => ix.data[offset] === byte))?.name;
    }
  }
  return new SimulationFailure(message, {
    stage: 'SIMULATION', code: customCode ?? (typeof reason === 'string' ? reason : raw),
    instructionIndex: index, program: failedProgram, instruction, error: raw, logs: lines,
  });
}
