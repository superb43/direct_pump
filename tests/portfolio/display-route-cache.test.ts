import {Buffer} from 'buffer';
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {Keypair,PublicKey,type AccountInfo} from '@solana/web3.js';
import {MintLayout,AccountLayout,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {readPosition,positionDisplayRoute} from '../../src/portfolio/position';
import {createChartEntryCache} from '../../src/chart/chart-entry-cache';
import {createPriceRpc} from '../../src/worker/price-rpc';
import {DEFAULT_SETTINGS} from '../../src/model';
import {SITE_CONTEXTS} from '../fixtures/site-contexts';
vi.mock('../../src/ledger',()=>({allReceipts:async()=>[]}));
const chain=JSON.parse(readFileSync(new URL('../fixtures/chain/pump-garage.json',import.meta.url),'utf8'));
function fixture(){
 const mint=new PublicKey(chain.mint),wallet=Keypair.fromSeed(new Uint8Array(32).fill(40)).publicKey,ata=getAssociatedTokenAddressSync(mint,wallet,false,TOKEN_2022_PROGRAM_ID);
 const info=(data:Buffer,owner=TOKEN_2022_PROGRAM_ID):AccountInfo<Buffer>=>({data,owner,lamports:2039280,executable:false,rentEpoch:0});
 const mintInfo=(supply=1_000_000_000_000_000n)=>{const data=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data);return info(data);};
 const data=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint,owner:wallet,amount:10n,delegateOption:0,delegate:PublicKey.default,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},data);
 const accounts=new Map([[mint.toBase58(),mintInfo()],[chain.curve,info(Buffer.from(chain.data,'base64'),new PublicKey(chain.owner))],[ata.toBase58(),info(data)]]);
 const fetcher=vi.fn(async(_url:unknown,options:RequestInit)=>{
  const body=JSON.parse(String(options.body));const account=(address:string)=>{const row=accounts.get(address);return row?{...row,owner:row.owner.toBase58(),data:[row.data.toString('base64'),'base64']}:null;};
  return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{context:{slot:777},value:body.method==='getMultipleAccounts'?body.params[0].map(account):account(body.params[0])}}));
 });vi.stubGlobal('fetch',fetcher);return{mint,wallet,ata,accounts,mintInfo,fetcher,transport:createPriceRpc()};
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it.each(SITE_CONTEXTS)('$site refreshes known route/metadata in one batch and preserves the original Holdings proof time',async({target})=>{
 vi.useFakeTimers();vi.setSystemTime(10_000);const f=fixture();
 const page={...target,address:target.kind==='POOL'?chain.curve:chain.mint,mintHint:chain.mint};
 const options={cache:createChartEntryCache(),scope:'bound-position'};
 const first=await readPosition(f.transport.connection('https://rpc.test',777),page,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,options);
 expect(f.fetcher).toHaveBeenCalledTimes(3);expect(first.balanceRaw).toBe('10');
 vi.setSystemTime(13_000);f.fetcher.mockClear();
 const route=positionDisplayRoute(first,page),shared={...options,route,balance:{position:first,slot:777,quoteReady:true}};
 const refreshed=await readPosition(f.transport.connection('https://rpc.test',777),page,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,shared);
 expect(f.fetcher).toHaveBeenCalledOnce();expect(refreshed.balanceUpdatedAt).toBe(10_000);expect(refreshed.balanceRaw).toBe('10');
 vi.setSystemTime(13_500);f.fetcher.mockClear();f.accounts.set(chain.mint,f.mintInfo(2_000_000_000_000_000n));
 const changed=await readPosition(f.transport.connection('https://rpc.test',777),page,f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,shared);
 expect(f.fetcher).toHaveBeenCalledTimes(2);expect(changed.balanceUpdatedAt).toBe(13_500);expect(changed.supplyRaw).toBe('2000000000000000');
 expect(positionDisplayRoute(first,{...page,poolHint:PublicKey.default.toBase58()})).toBeUndefined();
 await expect(readPosition(f.transport.connection('https://rpc.test',777),{...page,mintHint:PublicKey.default.toBase58()},f.wallet,DEFAULT_SETTINGS,undefined,true,777,undefined,shared)).rejects.toThrow();
});
