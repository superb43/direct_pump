import {Buffer} from 'buffer';
import {beforeEach,expect,it,vi} from 'vitest';
import {Connection,Keypair,PublicKey} from '@solana/web3.js';
import {AccountLayout,MintLayout,TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {DEFAULT_SETTINGS,type Receipt} from '../src/model';
const mocks=vi.hoisted(()=>({route:vi.fn(),history:vi.fn()}));
vi.mock('../src/execution',()=>({resolveExecution:mocks.route}));
vi.mock('../src/ledger',()=>({allReceipts:mocks.history}));
import {readPosition} from '../src/position';

const wallet=Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey,mint=Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const target={site:'GMGN' as const,kind:'MINT' as const,address:mint.toBase58(),pageUrl:`https://gmgn.ai/sol/token/${mint}`};
const accountInfo=(data:Buffer)=>({data,owner:TOKEN_PROGRAM_ID,executable:false,lamports:2039280,rentEpoch:0});
function fixture(){
 const data=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data);
 const accountData=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint,owner:wallet,amount:100n,delegateOption:0,delegate:PublicKey.default,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},accountData);
 const rpc=new Connection('https://rpc.test');vi.spyOn(rpc,'getAccountInfo').mockResolvedValue(accountInfo(data));
 const row={pubkey:getAssociatedTokenAddressSync(mint,wallet),account:accountInfo(accountData)};
 const accounts=vi.spyOn(rpc,'getTokenAccountsByOwner').mockResolvedValue({context:{slot:100},value:[row]});
 return {rpc,row,accounts};
}
beforeEach(()=>{
 vi.restoreAllMocks();mocks.route.mockReset().mockRejectedValue(Error('Saved pool unavailable'));
 const receipt:Receipt={wallet:wallet.toBase58(),mint:mint.toBase58(),venue:'PUMP_SWAP',side:'BUY',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:1000,status:'CONFIRMED',feeReceipt:{state:'VERIFIED',checkedAt:0,note:'',protocolFees:[],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:true,executionSucceeded:true,tokenBeforeRaw:'0',tokenAfterRaw:'100',volumeLamports:'100000000',totalNetworkLamports:'1000000'}};
 mocks.history.mockReset().mockResolvedValue([receipt]);
});
it('keeps a positive mint-bound balance and basis visible when its saved pool no longer resolves',async()=>{
 const {rpc}=fixture();const position=await readPosition(rpc,target,wallet,DEFAULT_SETTINGS,undefined,false,100,mint.toBase58());
 expect(position).toMatchObject({mint:mint.toBase58(),wallet:wallet.toBase58(),balanceRaw:'100',costBasisSolLamports:'101000000',openedAt:1000});expect(position.warning).toContain('Saved pool unavailable');expect(position.expectedExitLamports).toBeUndefined();
});
it('excludes a full exit using a confirmed zero balance without requiring an exit route',async()=>{
 const {rpc,accounts}=fixture();accounts.mockResolvedValue({context:{slot:100},value:[]});
 expect((await readPosition(rpc,target,wallet,DEFAULT_SETTINGS,undefined,false,100,mint.toBase58())).balanceRaw).toBe('0');expect(mocks.route).not.toHaveBeenCalled();
});
it('counts non-associated inventory but does not pretend the ATA-only sell path can liquidate it',async()=>{
 const {rpc,row,accounts}=fixture();accounts.mockResolvedValue({context:{slot:100},value:[row,{...row,pubkey:Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey}]});
 const position=await readPosition(rpc,target,wallet,DEFAULT_SETTINGS,undefined,false,100,mint.toBase58());
 expect(position.balanceRaw).toBe('200');expect(position.warning).toContain('outside the associated token account');expect(position.expectedExitLamports).toBeUndefined();expect(mocks.route).not.toHaveBeenCalled();
});
it('rejects a foreign wallet balance and keeps a changed pool mint from supplying the valuation',async()=>{
 const {rpc}=fixture();await expect(readPosition(rpc,target,Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey,DEFAULT_SETTINGS,undefined,false,100,mint.toBase58())).rejects.toThrow('ownership');
 mocks.route.mockResolvedValue({mint:PublicKey.default,venue:'JUPITER'});
 const position=await readPosition(rpc,target,wallet,DEFAULT_SETTINGS,undefined,false,100,mint.toBase58());expect(position.mint).toBe(mint.toBase58());expect(position.warning).toContain('different token');expect(position.expectedExitLamports).toBeUndefined();
});
