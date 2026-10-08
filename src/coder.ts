import type { Buffer } from 'buffer';

export type ReadableCoder = {
  encode(name: string, data: object): Buffer;
  decode(data: Buffer): { name: string; data: Record<string, unknown> } | null;
};

// Anchor's public InstructionCoder interface omits BorshInstructionCoder.decode.
export function readableCoder(coder: unknown): ReadableCoder {
  if (!coder || typeof (coder as ReadableCoder).decode !== 'function') {
    throw new Error('The SDK instruction decoder is unavailable.');
  }
  return coder as ReadableCoder;
}
