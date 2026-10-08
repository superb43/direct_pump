import { VersionedMessage, ComputeBudgetProgram, type AddressLookupTableAccount, type LoadedAddresses } from '@solana/web3.js';
import bs58 from 'bs58';
import type { ManifestInstruction } from './model';

export function instructionManifest(message: VersionedMessage, resolution?: { addressLookupTableAccounts: AddressLookupTableAccount[] } | { accountKeysFromLookups: LoadedAddresses }): ManifestInstruction[] {
  const keys = message.getAccountKeys(resolution);
  return message.compiledInstructions.filter(ix => !keys.get(ix.programIdIndex)!.equals(ComputeBudgetProgram.programId)).map(ix => ({ program: keys.get(ix.programIdIndex)!.toBase58(), data: bs58.encode(ix.data), accounts: ix.accountKeyIndexes.map(index => keys.get(index)!.toBase58()) }));
}

export function manifestDifferences(expected: ManifestInstruction[], actual: ManifestInstruction[]): string[] {
  const differences:string[]=[];
  if(expected.length!==actual.length)differences.push(`Instruction count: expected ${expected.length}, actual ${actual.length}.`);
  for(let index=0;index<Math.max(expected.length,actual.length);index++){
    const a=expected[index],b=actual[index];
    if(!a||!b){differences.push(`Instruction ${index}: ${a?'missing':'unexpected'} instruction.`);continue;}
    if(a.program!==b.program)differences.push(`Instruction ${index}: program changed (${a.program} → ${b.program}).`);
    if(a.data!==b.data)differences.push(`Instruction ${index}: encoded data changed.`);
    if(a.accounts.length!==b.accounts.length||a.accounts.some((key,i)=>key!==b.accounts[i]))differences.push(`Instruction ${index}: accounts changed.`);
  }
  return differences;
}
