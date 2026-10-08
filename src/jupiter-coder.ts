import { BorshInstructionCoder, type Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { jupiterIdl } from './vendor/jupiter-idl';

export const jupiterProgram = {
  programId: new PublicKey(jupiterIdl.address),
  coder: { instruction: new BorshInstructionCoder(jupiterIdl as unknown as Idl) },
};
