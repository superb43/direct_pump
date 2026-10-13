import {Buffer} from 'buffer';
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {Connection,PublicKey} from '@solana/web3.js';
import {PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk';
const mocks=vi.hoisted(()=>({route:vi.fn()}));
vi.mock('../src/execution',()=>({resolveExecution:mocks.route}));
import {priceAccounts} from '../src/worker/price-accounts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/chain/dlmm-si.json',import.meta.url),'utf8'));
const mint=new PublicKey(fixture.mint),pool=new PublicKey(fixture.pool),target={site:'AXIOM' as const,kind:'POOL' as const,address:fixture.pool,mintHint:fixture.mint,pageUrl:`https://axiom.trade/meme/${fixture.pool}`};
afterEach(()=>vi.restoreAllMocks());
it('monitors the decoded DLMM vaults as well as active-bin pool state',async()=>{
 const rpc=new Connection('https://rpc.test');mocks.route.mockResolvedValue({mint,account:pool,venue:'JUPITER'});
 vi.spyOn(rpc,'getAccountInfo').mockResolvedValue({owner:new PublicKey(fixture.owner),data:Buffer.from(fixture.data,'base64'),lamports:1,executable:false,rentEpoch:0});
 const accounts=await priceAccounts(rpc,target,fixture.mint);expect(accounts[0]).toBe(fixture.pool);expect(accounts).toHaveLength(3);expect(new Set(accounts).size).toBe(3);
});
it('does not subscribe to a token mint or an unrelated token as if it were a price pool',async()=>{
 const rpc=new Connection('https://rpc.test'),read=vi.spyOn(rpc,'getAccountInfo');mocks.route.mockResolvedValue({mint,account:mint,venue:'JUPITER'});expect(await priceAccounts(rpc,target,fixture.mint)).toEqual([]);expect(read).not.toHaveBeenCalled();
 mocks.route.mockResolvedValue({mint:PublicKey.default,account:pool,venue:'PUMP_CURVE'});expect(await priceAccounts(rpc,target,fixture.mint)).toEqual([]);
});
it('monitors verified bonding-curve state without enumerating wallet accounts',async()=>{
 const rpc=new Connection('https://rpc.test');mocks.route.mockResolvedValue({mint,account:pool,venue:'PUMP_CURVE'});vi.spyOn(rpc,'getAccountInfo').mockResolvedValue({owner:PUMP_PROGRAM_ID,data:Buffer.alloc(100),lamports:1,executable:false,rentEpoch:0});
 expect(await priceAccounts(rpc,target,fixture.mint)).toEqual([fixture.pool]);
});
