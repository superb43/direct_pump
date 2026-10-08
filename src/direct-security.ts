import { PublicKey, SystemProgram, SystemInstruction, ComputeBudgetProgram } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import type { DirectRoute, DirectSwapBundle } from './direct-venues';

export async function validateDirectSwap(bundle: DirectSwapBundle, route: DirectRoute, wallet: PublicKey, side: 'BUY' | 'SELL', budget: bigint, baseProgram: PublicKey, quoteProgram: PublicKey, rent: number) {
  const inputMint = side === 'BUY' ? route.quoteMint : route.mint;
  const outputMint = side === 'BUY' ? route.mint : route.quoteMint;
  const inputProgram = side === 'BUY' ? quoteProgram : baseProgram;
  const outputProgram = side === 'BUY' ? baseProgram : quoteProgram;
  const userInput = getAssociatedTokenAddressSync(inputMint, wallet, false, inputProgram);
  const userOutput = getAssociatedTokenAddressSync(outputMint, wallet, false, outputProgram);
  const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, wallet);
  const temporary = new Set<string>();
  const ownAccounts = new Set([userInput.toBase58(), userOutput.toBase58(), wsol.toBase58()]);
  let coreCount = 0;
  let transferred = 0n;
  const key = (actual: PublicKey | undefined, expected: PublicKey) => { if (!actual?.equals(expected)) throw new Error('Direct swap account binding failed.'); };
  for (const ix of bundle.instructions) {
    if (ix.keys.some(meta => meta.isSigner && !meta.pubkey.equals(wallet))) throw new Error('Direct swap requires an additional signer.');
    if (ix.programId.equals(ComputeBudgetProgram.programId)) continue; // Replaced by the local bounded compute budget.
    if (ix.programId.equals(bundle.program)) {
      coreCount++;
      if (!bundle.discriminator.every((byte, index) => ix.data[index] === byte)) throw new Error('Direct protocol instruction is not an approved swap.');
      if (ix.data.length !== 24 && ix.data.length !== 32) throw new Error('Unsupported direct swap instruction layout.');
      if (ix.data.readBigUInt64LE(8) !== bundle.input || ix.data.readBigUInt64LE(16) !== bundle.minimum || bundle.input <= 0n || bundle.input > budget || bundle.minimum <= 0n) throw new Error('Direct swap amounts do not match the budget and minimum output.');
      key(ix.keys[bundle.poolIndex]?.pubkey, route.account); key(ix.keys[bundle.payerIndex]?.pubkey, wallet);
      for (const [index, expected] of Object.entries(bundle.expectedAccounts)) key(ix.keys[Number(index)]?.pubkey, expected);
      const source = ix.keys[bundle.inputAccountIndex]?.pubkey;
      const destination = ix.keys[bundle.outputAccountIndex]?.pubkey;
      if (!source?.equals(userInput) && !(inputMint.equals(NATIVE_MINT) && source && temporary.has(source.toBase58()))) throw new Error('Direct swap input account is not owned by the connected wallet.');
      if (!destination?.equals(userOutput) && !(outputMint.equals(NATIVE_MINT) && destination && temporary.has(destination.toBase58()))) throw new Error('Direct swap output account is not owned by the connected wallet.');
      if (bundle.referralIndex !== undefined) key(ix.keys[bundle.referralIndex]?.pubkey, bundle.program);
      continue;
    }
    if (ix.programId.equals(SystemProgram.programId)) {
      const type = SystemInstruction.decodeInstructionType(ix);
      if (type === 'CreateWithSeed') {
        const create = SystemInstruction.decodeCreateWithSeed(ix);
        key(create.fromPubkey, wallet); key(create.basePubkey, wallet); key(create.programId, TOKEN_PROGRAM_ID);
        if (create.space !== 165 || BigInt(create.lamports) > (inputMint.equals(NATIVE_MINT) ? budget : 0n) + BigInt(rent)) throw new Error('Unexpected temporary account size or funding.');
        transferred += BigInt(create.lamports) > BigInt(rent) ? BigInt(create.lamports) - BigInt(rent) : 0n;
        if (transferred > budget) throw new Error('Temporary account funding exceeds the trade budget.');
        key(create.newAccountPubkey, await PublicKey.createWithSeed(wallet, create.seed, TOKEN_PROGRAM_ID));
        temporary.add(create.newAccountPubkey.toBase58()); ownAccounts.add(create.newAccountPubkey.toBase58());
      } else if (type === 'Transfer') {
        const transfer = SystemInstruction.decodeTransfer(ix); key(transfer.fromPubkey, wallet);
        if (!inputMint.equals(NATIVE_MINT) || (!transfer.toPubkey.equals(wsol) && !temporary.has(transfer.toPubkey.toBase58()))) throw new Error('Unknown SOL transfer in direct swap.');
        transferred += BigInt(transfer.lamports);
        if (transferred > budget) throw new Error('Direct swap SOL funding exceeds the budget.');
      } else throw new Error('Unsupported System instruction in direct swap.');
      continue;
    }
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      if (ix.data.length > 1 || (ix.data.length === 1 && ix.data[0] !== 1) || ix.keys.length !== 6) throw new Error('Unexpected ATA instruction in direct swap.');
      key(ix.keys[0]?.pubkey, wallet); key(ix.keys[2]?.pubkey, wallet);
      const mint = ix.keys[3]?.pubkey; const program = ix.keys[5]?.pubkey;
      if (!mint || !program || (!mint.equals(inputMint) && !mint.equals(outputMint))) throw new Error('Unexpected ATA mint in direct swap.');
      key(program, mint.equals(inputMint) ? inputProgram : outputProgram);
      key(ix.keys[1]?.pubkey, getAssociatedTokenAddressSync(mint, wallet, false, program));
      continue;
    }
    if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      const account = ix.keys[0]?.pubkey;
      if (!account || !ownAccounts.has(account.toBase58())) throw new Error('Unexpected token setup account.');
      if (ix.data[0] === 17 && ix.data.length === 1 && ix.keys.length === 1) continue;
      if (ix.data[0] === 9 && ix.data.length === 1 && ix.keys.length === 3) {
        if (!account.equals(wsol) && !temporary.has(account.toBase58())) throw new Error('Only a temporary WSOL account may be closed.');
        key(ix.keys[1]?.pubkey, wallet); key(ix.keys[2]?.pubkey, wallet); continue;
      }
      if (ix.data[0] === 1 && ix.data.length === 1 && temporary.has(account.toBase58())) {
        key(ix.keys[1]?.pubkey, NATIVE_MINT); key(ix.keys[2]?.pubkey, wallet); continue;
      }
      throw new Error('Unexpected token instruction in direct swap.');
    }
    throw new Error('Unexpected program in direct swap.');
  }
  if (coreCount !== 1) throw new Error('Exactly one direct swap instruction is required.');
}
