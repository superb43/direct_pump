import {it,expect,vi,beforeEach} from 'vitest';
import type {ProEngine} from '../../server/engine';
import type {ProSpecV2} from '../../src/pro/contracts';
vi.mock('../../server/pro-portfolio',()=>({readProPortfolio:vi.fn()}));
import {readProPortfolio} from '../../server/pro-portfolio';
import {previewRecoverInitials} from '../../server/recover-initials';
import {SOL} from '../../server/store';
const mint='11111111111111111111111111111111';
const spec=():ProSpecV2=>({version:2,basis:'MC',kind:'MARKET',side:'SELL',mint,target:{site:'GMGN',kind:'MINT',address:mint,pageUrl:`https://gmgn.ai/sol/token/${mint}`},amountRaw:'1',decimals:6,expiresAt:Date.now()+60000,slippageBps:100,priorityFeeLamports:0,maxNetworkLamports:'5000'});
function fixture(){
 let reserve=0n,balance=10000n;
 const preview=vi.fn(async(s:ProSpecV2)=>({spec:s,summary:{outputRaw:String(BigInt(s.amountRaw)*10n),quoteAt:Date.now()}}));
 const engine={wallet:mint,clock:Date.now,store:{locked:()=>false,reserved:(asset:string)=>asset===mint?reserve:0n},market:{balances:vi.fn(async()=>({[mint]:balance,[SOL]:100000n}))},preview} as unknown as ProEngine;
 return {engine,preview,setReserve:(v:bigint)=>reserve=v,setBalance:(v:bigint)=>balance=v};
}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(readProPortfolio).mockResolvedValue({wallet:mint,updatedAt:Date.now(),partial:false,rows:[{mint,decimals:6,totalRaw:'10000',availableRaw:'10000',reservedRaw:'0',status:'READY',costBasisLamports:'60000',realizedPnlLamports:'0',unrecoveredLamports:'60000'}]});});
it('discovers the smallest sufficient bounded quantity and replaces the placeholder amount',async()=>{
 const f=fixture(),result=await previewRecoverInitials(f.engine,spec());
 expect(result).toMatchObject({status:'READY',targetLamports:'60000'});
 expect(BigInt(result.spec!.amountRaw)).toBeGreaterThanOrEqual(6500n);expect(BigInt(result.spec!.amountRaw)).toBeLessThan(6510n);
 expect(BigInt(result.expectedNetLamports!)).toBeGreaterThanOrEqual(60000n);expect(f.preview.mock.calls.length).toBeLessThanOrEqual(13);
});
it('blocks reservation shortage instead of substituting an all-token sale',async()=>{
 const f=fixture();f.setReserve(6000n);
 expect(await previewRecoverInitials(f.engine,spec())).toMatchObject({status:'INSUFFICIENT',expectedNetLamports:'35000',shortfallLamports:'25000'});
 expect(f.preview).toHaveBeenCalledTimes(1);
});
it('returns unavailable for incomplete acquisition history and recovered without quoting',async()=>{
 const f=fixture();vi.mocked(readProPortfolio).mockResolvedValueOnce({wallet:mint,updatedAt:Date.now(),partial:true,rows:[]});
 expect(await previewRecoverInitials(f.engine,spec())).toMatchObject({status:'UNAVAILABLE'});expect(f.preview).not.toHaveBeenCalled();
 const p=await readProPortfolio(f.engine,mint);p.rows[0]!.unrecoveredLamports='0';vi.mocked(readProPortfolio).mockResolvedValue(p);
 expect(await previewRecoverInitials(f.engine,spec())).toMatchObject({status:'RECOVERED'});expect(f.preview).not.toHaveBeenCalled();
});
it('rejects changed inventory before preview and changed reservations during quotes',async()=>{
 const f=fixture();f.setBalance(9999n);expect(await previewRecoverInitials(f.engine,spec())).toMatchObject({status:'UNAVAILABLE'});expect(f.preview).not.toHaveBeenCalled();
 f.setBalance(10000n);f.preview.mockImplementation(async(s)=>{f.setReserve(1n);return {spec:s,summary:{outputRaw:String(BigInt(s.amountRaw)*10n),quoteAt:Date.now()}};});
 expect(await previewRecoverInitials(f.engine,spec())).toMatchObject({status:'UNAVAILABLE',reason:expect.stringMatching(/changed/)});
});
it('rejects non-market/non-sell specs without any read or mutation',async()=>{
 const f=fixture();await expect(previewRecoverInitials(f.engine,{...spec(),side:'BUY'})).rejects.toThrow(/Market sell/);expect(readProPortfolio).not.toHaveBeenCalled();
});
