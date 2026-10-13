import {expect,it} from 'vitest';
import {chartEntryFromFills,chartEntryFromReceipts,type ChartEntryFill} from '../src/chart-entry';
import type {Receipt} from '../src/model';
const position={mint:'mint',wallet:'wallet',balanceRaw:'200',supplyRaw:'1000000',decimals:2,updatedAt:1};
const fill=(side:'BUY'|'SELL',beforeRaw:string,afterRaw:string,costUsdUnits?:bigint,at=1):ChartEntryFill=>({side,beforeRaw,afterRaw,costUsdUnits,at,valid:true});
it('weights confirmed buys and preserves average exactly through partial sales',()=>{
 const buys=[fill('BUY','0','100',10_000_000_000_000n),fill('BUY','100','200',30_000_000_000_000n,2)];
 expect(chartEntryFromFills(buys,position)).toMatchObject({priceUsd:'20.000000000000',marketCapUsd:'200000.000000000000'});
 expect(chartEntryFromFills([...buys,fill('SELL','200','77',undefined,3)],{...position,balanceRaw:'77'})).toMatchObject({priceUsd:'20.000000000000'});
});
it('clears after full exit and resets on a confirmed fresh entry',()=>{
 const rows=[fill('BUY','0','100',10_000_000_000_000n),fill('SELL','100','0',undefined,2)];
 expect(chartEntryFromFills(rows,{...position,balanceRaw:'0'})).toHaveProperty('unavailable');
 expect(chartEntryFromFills([...rows,fill('BUY','0','200',10_000_000_000_000n,3)],position)).toMatchObject({priceUsd:'5.000000000000'});
});
it('suppresses external inventory, missing costs, incomplete fills and balance drift',()=>{
 for(const rows of [[fill('BUY','10','200',10n)],[fill('BUY','0','200')],[{...fill('BUY','0','200',10n),valid:false}],[fill('BUY','0','201',10n)]])expect(chartEntryFromFills(rows,position)).toHaveProperty('unavailable');
 expect(chartEntryFromFills([fill('BUY','0','100',10n),fill('SELL','120','100',undefined,2)],{...position,balanceRaw:'100'})).toHaveProperty('unavailable');
});
const receipt:Receipt={wallet:'wallet',mint:'mint',signature:'signature',venue:'PUMP_SWAP',side:'BUY',pageUrl:'',message:'',blockhash:'',lastValidBlockHeight:1,createdAt:1,status:'CONFIRMED',inputAmount:'99999999999',feeReceipt:{state:'VERIFIED',checkedAt:1,note:'',protocolFees:[],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:true,executionSucceeded:true,tokenBeforeRaw:'0',tokenAfterRaw:'200',volumeLamports:'1000000000',totalNetworkLamports:'5000000',rentDepositedLamports:'2039280',usd:{priceMicros:'100000000',capturedAt:1,source:'Coinbase spot'}}};
it('uses audited actual volume, excluding fees/setup and requested amount, and deduplicates signatures',()=>{
 expect(chartEntryFromReceipts([receipt,receipt],position)).toMatchObject({priceUsd:'50.000000000000'});
 expect(chartEntryFromReceipts([{...receipt,wallet:'other'}],position)).toHaveProperty('unavailable');
 expect(chartEntryFromReceipts([{...receipt,feeReceipt:{...receipt.feeReceipt!,usd:undefined}}],position)).toHaveProperty('unavailable');
 expect(chartEntryFromReceipts([{...receipt,status:'UNKNOWN',createdAt:0},receipt],position)).toHaveProperty('unavailable');
});
