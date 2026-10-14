import {Buffer} from 'buffer';
import {afterEach,expect,it,vi} from 'vitest';
import {Connection,Keypair,PublicKey} from '@solana/web3.js';
import {MintLayout,TOKEN_2022_PROGRAM_ID,ExtensionType,AccountType,getTokenMetadata} from '@solana/spl-token';
import {tokenSymbol,decodeToken2022Symbol} from '../../src/token-metadata';
const mint=Keypair.fromSeed(new Uint8Array(32).fill(39)).publicKey;
function text(value:string){const bytes=Buffer.from(value),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);return Buffer.concat([header,bytes]);}
function fixture(){
 const count=Buffer.alloc(4);count.writeUInt32LE(1);
 const metadata=Buffer.concat([PublicKey.default.toBuffer(),mint.toBuffer(),text('Verified token'),text(' TOKEN '),text('ipfs://metadata'),count,text('key'),text('value')]);
 const data=Buffer.alloc(170+metadata.length);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:100n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data);
 data[165]=AccountType.Mint;data.writeUInt16LE(ExtensionType.TokenMetadata,166);data.writeUInt16LE(metadata.length,168);metadata.copy(data,170);
 const rpc=new Connection('https://rpc.test'),read=vi.spyOn(rpc,'getAccountInfo').mockResolvedValue({data,owner:TOKEN_2022_PROGRAM_ID,executable:false,lamports:1,rentEpoch:0});return{metadata,rpc,read};
}
afterEach(()=>vi.restoreAllMocks());
it('matches the pinned SDK metadata decoder while fetching the mint once',async()=>{
 const {rpc,read,metadata}=fixture(),reference=await getTokenMetadata(rpc,mint,'confirmed',TOKEN_2022_PROGRAM_ID);
 expect(reference?.symbol).toBe(' TOKEN ');read.mockClear();
 expect(await tokenSymbol(rpc,mint)).toBe('TOKEN');expect(read).toHaveBeenCalledOnce();expect(decodeToken2022Symbol(metadata,mint)).toBe(reference?.symbol.trim());
});
it('rejects foreign mint metadata, truncated strings and malformed additional fields',()=>{
 const {metadata}=fixture();expect(decodeToken2022Symbol(metadata,PublicKey.default)).toBeUndefined();
 for(const bytes of [metadata.subarray(0,63),metadata.subarray(0,69),metadata.subarray(0,metadata.length-1)])expect(()=>decodeToken2022Symbol(bytes,mint)).toThrow();
});
