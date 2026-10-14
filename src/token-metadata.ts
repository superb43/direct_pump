import { Buffer } from 'buffer';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,unpackMint,getExtensionData,ExtensionType } from '@solana/spl-token';

const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

import { cleanSymbol } from './token-label';
export { cleanSymbol } from './token-label';

export function decodeLegacySymbol(data: Buffer, mint: PublicKey): string | undefined {
  if (data.length < 69 || data[0] !== 4 || !new PublicKey(data.subarray(33, 65)).equals(mint)) return undefined;
  let offset = 65;
  function string() {
    if (offset + 4 > data.length) throw new Error('Truncated metadata.');
    const length = data.readUInt32LE(offset); offset += 4;
    if (length > 1024 || offset + length > data.length) throw new Error('Invalid metadata string length.');
    const text = data.subarray(offset, offset + length).toString('utf8'); offset += length;
    return text;
  }
  try { string(); return cleanSymbol(string()); } catch { return undefined; }
}

/** Token Metadata TLV layout: update authority, mint, three strings, then key/value pairs. */
export function decodeToken2022Symbol(data:Buffer,mint:PublicKey):string|undefined{
  if(data.length<64)throw new Error('Truncated Token-2022 metadata.');
  const metadataMint=new PublicKey(data.subarray(32,64));let offset=64;
  function string(){
    if(offset+4>data.length)throw new Error('Truncated Token-2022 metadata.');
    const length=data.readUInt32LE(offset);offset+=4;
    if(length>data.length-offset)throw new Error('Truncated Token-2022 metadata string.');
    const text=data.subarray(offset,offset+length).toString('utf8');offset+=length;return text;
  }
  string();const symbol=string();string();
  if(offset+4>data.length)throw new Error('Truncated Token-2022 additional metadata.');
  const count=data.readUInt32LE(offset);offset+=4;
  if(count>Math.floor((data.length-offset)/8))throw new Error('Invalid Token-2022 additional metadata.');
  for(let index=0;index<count;index++){string();string();}
  return metadataMint.equals(mint)?cleanSymbol(symbol):undefined;
}

export async function tokenSymbol(rpc: Connection, mint: PublicKey): Promise<string | undefined> {
  const account = await rpc.getAccountInfo(mint);
  if (!account) return undefined;
  if (account.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    const metadata=getExtensionData(ExtensionType.TokenMetadata,unpackMint(mint,account,TOKEN_2022_PROGRAM_ID).tlvData);
    if(metadata)return decodeToken2022Symbol(metadata,mint);
  }
  if (!account.owner.equals(TOKEN_PROGRAM_ID) && !account.owner.equals(TOKEN_2022_PROGRAM_ID)) return undefined;
  const address = PublicKey.findProgramAddressSync([Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mint.toBuffer()], METADATA_PROGRAM)[0];
  const metadata = await rpc.getAccountInfo(address);
  return metadata?.owner.equals(METADATA_PROGRAM) ? decodeLegacySymbol(metadata.data, mint) : undefined;
}

