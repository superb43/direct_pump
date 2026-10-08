import { Buffer } from 'buffer';
import { Connection, PublicKey, SystemProgram, SystemInstruction, type TransactionInstruction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, NATIVE_MINT,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { getPumpProgram, PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, creatorVaultPda } from '@pump-fun/pump-sdk';
import { OFFLINE_PUMP_AMM_PROGRAM, coinCreatorVaultAuthorityPda, poolV2Pda, userVolumeAccumulatorPda } from '@pump-fun/pump-swap-sdk';
import { readableCoder } from './coder';

export type Policy = {
  wallet: PublicKey; mint: PublicKey; baseProgram: PublicKey;
  quoteMint?: PublicKey; quoteProgram?: PublicKey;
  venue: 'PUMP_CURVE' | 'PUMP_SWAP'; routeAccount: PublicKey; creator: PublicKey;
  side: 'BUY' | 'SELL'; input: bigint; minimum: bigint;
  feeRecipients: PublicKey[]; buybackRecipients: PublicKey[];
};

function requireKey(actual: PublicKey | undefined, expected: PublicKey): void {
  if (!actual?.equals(expected)) throw new Error('Transaction account validation failed.');
}

function requireMember(actual: PublicKey | undefined, allowed: PublicKey[]): void {
  if (!actual || !allowed.some(key => key.equals(actual) && !key.equals(PublicKey.default))) {
    throw new Error('Unknown protocol fee recipient.');
  }
}

export function validateInstructions(instructions: TransactionInstruction[], policy: Policy, connection: Connection): void {
  const { wallet, mint, baseProgram } = policy;
  const quoteMint = policy.quoteMint ?? NATIVE_MINT;
  const quoteProgram = policy.quoteProgram ?? TOKEN_PROGRAM_ID;
  const userBase = getAssociatedTokenAddressSync(mint, wallet, false, baseProgram);
  const userWsol = getAssociatedTokenAddressSync(NATIVE_MINT, wallet);
  const userQuote = getAssociatedTokenAddressSync(quoteMint, wallet, false, quoteProgram);
  const program = policy.venue === 'PUMP_CURVE' ? getPumpProgram(connection) : OFFLINE_PUMP_AMM_PROGRAM;
  const programId = policy.venue === 'PUMP_CURVE' ? PUMP_PROGRAM_ID : PUMP_AMM_PROGRAM_ID;
  const expectedName = policy.side === 'BUY'
    ? (policy.venue === 'PUMP_CURVE' ? 'buyExactQuoteInV2' : 'buyExactQuoteIn')
    : (policy.venue === 'PUMP_CURVE' ? 'sellV2' : 'sell');
  let tradeCount = 0;
  let wrapped = 0n;
  for (const ix of instructions) {
    if (ix.keys.some(key => key.isSigner && !key.pubkey.equals(wallet))) throw new Error('An additional signer was included.');
    if (ix.programId.equals(SystemProgram.programId)) {
      if (SystemInstruction.decodeInstructionType(ix) !== 'Transfer') throw new Error('System instruction is not allowed.');
      const transfer = SystemInstruction.decodeTransfer(ix);
      requireKey(transfer.fromPubkey, wallet);
      requireKey(transfer.toPubkey, userWsol);
      if (!quoteMint.equals(NATIVE_MINT) || policy.venue !== 'PUMP_SWAP' || policy.side !== 'BUY') throw new Error('SOL transfer is not allowed.');
      wrapped += BigInt(transfer.lamports);
      if (wrapped > policy.input) throw new Error('The SOL transfer exceeds the trade budget.');
      continue;
    }
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      if (ix.data.length !== 1 || ix.data[0] !== 1 || ix.keys.length !== 6) throw new Error('Associated token account instruction is not allowed.');
      requireKey(ix.keys[0]?.pubkey, wallet);
      requireKey(ix.keys[2]?.pubkey, wallet);
      requireKey(ix.keys[4]?.pubkey, SystemProgram.programId);
      if (ix.keys[3]?.pubkey.equals(mint)) {
        requireKey(ix.keys[1]?.pubkey, userBase);
        requireKey(ix.keys[5]?.pubkey, baseProgram);
      } else {
        requireKey(ix.keys[3]?.pubkey, quoteMint);
        requireKey(ix.keys[1]?.pubkey, userQuote);
        requireKey(ix.keys[5]?.pubkey, quoteProgram);
      }
      continue;
    }
    if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      if (ix.data.length === 1 && ix.data[0] === 17 && ix.keys.length === 1) {
        requireKey(ix.keys[0]?.pubkey, userWsol); // SyncNative only.
      } else if (ix.data.length === 1 && ix.data[0] === 9 && ix.keys.length === 3) {
        requireKey(ix.keys[0]?.pubkey, userWsol);
        requireKey(ix.keys[1]?.pubkey, wallet);
        requireKey(ix.keys[2]?.pubkey, wallet); // Close only user's WSOL, refund to user.
      } else throw new Error('SPL Token instruction is not allowed.');
      if (policy.venue !== 'PUMP_SWAP') throw new Error('Unexpected WSOL instruction.');
      continue;
    }
    if (!ix.programId.equals(programId)) throw new Error('Solana program is not allowed.');
    const decoded = readableCoder(program.coder.instruction).decode(ix.data);
    const definition = decoded && program.idl.instructions.find(item => item.name === decoded.name);
    if (!decoded || !definition) throw new Error('Unknown protocol instruction.');
    const accounts = new Map<string, PublicKey | undefined>(definition.accounts.map((item, index) => [item.name, ix.keys[index]?.pubkey]));
    const at = (name: string) => accounts.get(name);
    if (decoded.name === 'extendAccount') {
      if (policy.venue !== 'PUMP_SWAP') throw new Error('Unexpected account extension.');
      requireKey(at('account'), policy.routeAccount);
      requireKey(at('user'), wallet);
      continue;
    }
    if (decoded.name !== expectedName) throw new Error('Protocol trade instruction is not allowed.');
    tradeCount++;
    requireKey(at('user'), wallet);
    requireKey(at('baseMint'), mint);
    requireKey(at('quoteMint'), quoteMint);
    requireKey(at('baseTokenProgram'), baseProgram);
    requireKey(at('quoteTokenProgram'), quoteProgram);
    requireKey(at('program'), programId);
    requireKey(at('associatedTokenProgram'), ASSOCIATED_TOKEN_PROGRAM_ID);
    requireKey(at('systemProgram'), SystemProgram.programId);
    const args = decoded.data as Record<string, { toString(): string }>;
    const inputName = policy.side === 'BUY' ? 'spendableQuoteIn' : policy.venue === 'PUMP_CURVE' ? 'amount' : 'baseAmountIn';
    const outputName = policy.side === 'BUY' ? policy.venue === 'PUMP_CURVE' ? 'minTokensOut' : 'minBaseAmountOut' : policy.venue === 'PUMP_CURVE' ? 'minSolOutput' : 'minQuoteAmountOut';
    if (BigInt(args[inputName]!.toString()) !== policy.input || BigInt(args[outputName]!.toString()) !== policy.minimum || policy.minimum <= 0n) {
      throw new Error('Trade amount or minimum output does not match the intended order.');
    }
    if (policy.venue === 'PUMP_CURVE') {
      requireKey(at('bondingCurve'), policy.routeAccount);
      requireKey(at('associatedBaseUser'), userBase);
      requireKey(at('associatedQuoteUser'), userQuote);
      requireKey(at('creatorVault'), creatorVaultPda(policy.creator));
      requireMember(at('feeRecipient'), policy.feeRecipients);
      requireMember(at('buybackFeeRecipient'), policy.buybackRecipients);
      if (ix.keys.length !== definition.accounts.length) throw new Error('Unexpected bonding curve account.');
    } else {
      requireKey(at('pool'), policy.routeAccount);
      requireKey(at('userBaseTokenAccount'), userBase);
      requireKey(at('userQuoteTokenAccount'), userQuote);
      requireKey(at('coinCreatorVaultAuthority'), coinCreatorVaultAuthorityPda(policy.creator));
      requireMember(at('protocolFeeRecipient'), policy.feeRecipients);
      const remaining = ix.keys.slice(definition.accounts.length);
      const buyback = remaining.at(-2)?.pubkey;
      requireMember(buyback, policy.buybackRecipients);
      requireKey(remaining.at(-1)?.pubkey, getAssociatedTokenAddressSync(quoteMint, buyback!, true, quoteProgram));
      const volume = userVolumeAccumulatorPda(wallet);
      const allowed = [poolV2Pda(mint), volume, getAssociatedTokenAddressSync(quoteMint, volume, true, quoteProgram)];
      if (remaining.slice(0, -2).some(item => !allowed.some(key => key.equals(item.pubkey)))) throw new Error('Unexpected swap account.');
    }
  }
  if (tradeCount !== 1) throw new Error('Exactly one trade instruction is required.');
}
