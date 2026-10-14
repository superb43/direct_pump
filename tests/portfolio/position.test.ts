import {expect,it} from 'vitest';
import {positionBasis} from '../../src/portfolio/position';
import {projectPosition} from '../../src/portfolio/position-view';
import {decimalText,markedValueMicros} from '../../src/market';
import type {Receipt,PositionSnapshot} from '../../src/model';
const trade=(side:'BUY'|'SELL',before:string,after:string,volume:string,time:number):Receipt=>({wallet:'wallet',mint:'mint',venue:'PUMP_SWAP',side,pageUrl:'',message:'',blockhash:'',lastValidBlockHeight:1,createdAt:time,status:'CONFIRMED',feeReceipt:{auditVersion:2,state:'VERIFIED',checkedAt:time,note:'fixture',protocolFees:[],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:true,executionSucceeded:true,tokenBeforeRaw:before,tokenAfterRaw:after,volumeLamports:volume,totalNetworkLamports:'1000000',rentDepositedLamports:'0',rentRefundedLamports:'0',usd:{priceMicros:'100000000',capturedAt:time,source:'Coinbase spot'}}});
it('includes acquisition network costs and allocates remaining cost after a partial sale',()=>{
 const receipts=[trade('BUY','0','100','1000000000',1),trade('SELL','100','50','700000000',2)];
 const basis=positionBasis(receipts,50n);expect(basis.costSol).toBe(500500000n);expect(basis.costUsd).toBe(50050000n);
 expect(positionBasis(receipts,70n)).toMatchObject({costSol:700700000n,costBasisEstimated:true});
});
it('estimates partial-history inventory only from an eligible buy and resets after a full exit',()=>{
 expect(positionBasis([trade('BUY','50','100','1000000000',1)],100n)).toMatchObject({costSol:2002000000n,costBasisEstimated:true});
 expect(positionBasis([],100n).costSol).toBeUndefined();
 expect(positionBasis([trade('SELL','100','50','1000000000',1)],50n).costSol).toBeUndefined();
 const receipts=[trade('BUY','0','100','1000000000',1),trade('SELL','100','0','1200000000',2),trade('BUY','0','20','300000000',3)];
 expect(positionBasis(receipts,20n).costSol).toBe(301000000n);
});
it('subtracts exit network/setup after the fee-inclusive quote and follows live marked price',()=>{
 const snapshot:PositionSnapshot={wallet:'wallet',mint:'mint',balanceRaw:'100',decimals:0,supplyRaw:'1000',updatedAt:Date.now(),costBasisUsdMicros:'101000000',expectedExitLamports:'1200000000',exitNetworkLamports:'1000000',exitSetupLamports:'2000000',solUsd:{priceMicros:'100000000',capturedAt:Date.now(),source:'Coinbase spot'},market:{mint:'mint',observedAt:Date.now(),priceUsd:'1.3',source:'GMGN page'}};
 const initial=projectPosition(snapshot);expect(initial.value).toBe('130000000');expect(initial.pnl).toBe('18700000');
 const live=projectPosition(snapshot,{mint:'mint',observedAt:Date.now(),priceUsd:'2.6',source:'GMGN page'});expect(live.value).toBe('260000000');expect(live.pnl).toBe('138700000');
 const stale=projectPosition({...snapshot,updatedAt:Date.now()-60_000});expect(stale.pnl).toBeUndefined();
});
it('parses small-price notation and MC suffixes without floating point',()=>{
 expect(decimalText('$0.0₅1234')).toBe('0.000001234');expect(decimalText('$1.25M')).toBe('1250000');
 expect(markedValueMicros('5000000',6,'1000000000',{mint:'mint',observedAt:Date.now(),marketCapUsd:'1M',source:'GMGN page'})).toBe(5000000000n);
});
it('does not label a missing quote as an executable sell estimate',()=>{
 const empty:PositionSnapshot={wallet:'wallet',mint:'mint',balanceRaw:'100',decimals:0,supplyRaw:'1000',updatedAt:Date.now(),warning:'Jupiter API key missing.'};
 const view=projectPosition(empty);expect(view.source).toBe('Live price unavailable');expect(view.value).toBeUndefined();expect(view.note).toContain('Jupiter');
});
it('accounts for a second confirmed acquisition in remaining holdings and cost',()=>{
 const receipts=[trade('BUY','0','100','1000000000',1),trade('BUY','100','200','1200000000',2)];
 expect(positionBasis(receipts,200n)).toMatchObject({costSol:2202000000n,costUsd:220200000n});
});
it('measures the current continuous holding episode and resets only on a complete exit',()=>{
 const buy=trade('BUY','0','100','1000000000',1000);buy.feeReceipt!.blockTime=2;
 const second=trade('BUY','100','200','1000000000',3000),partial=trade('SELL','200','50','1000000000',4000);
 expect(positionBasis([partial,second,buy],50n).openedAt).toBe(2000);
 const exit=trade('SELL','50','0','1000000000',5000);expect(positionBasis([buy,second,partial,exit],0n).openedAt).toBeUndefined();
 const reopen=trade('BUY','0','20','1000000000',6000);expect(positionBasis([buy,second,partial,exit,reopen],20n).openedAt).toBe(6000);
 expect(positionBasis([trade('BUY','50','100','1000000000',1000)],100n).openedAt).toBe(1000);
});
it('applies the recorded average to lower or higher liquidity-return inventory with explicit estimate evidence',()=>{
 const receipts=[trade('BUY','0','100','1000000000',1)];
 expect(positionBasis(receipts,80n)).toMatchObject({costSol:800800000n,costUsd:80080000n,costBasisEstimated:true,openedAt:1});
 expect(positionBasis(receipts,120n)).toMatchObject({costSol:1201200000n,costUsd:120120000n,costBasisEstimated:true});
 expect(positionBasis(receipts,120n).warning).toContain('LP/transfer');
 expect(positionBasis(receipts,100n).costBasisEstimated).toBeUndefined();
 expect(positionBasis(receipts,0n)).toMatchObject({costSol:0n,costUsd:0n});
});
it('rebases the recorded average before later purchases and preserves it through partial sales',()=>{
 const buy=trade('BUY','0','100','1000000000',1);
 const added=trade('BUY','80','100','300000000',2);
 expect(positionBasis([buy,added],100n)).toMatchObject({costSol:1101800000n,costUsd:110180000n,costBasisEstimated:true});
 const sold=trade('SELL','100','50','800000000',3);
 expect(positionBasis([buy,added,sold],50n)).toMatchObject({costSol:550900000n,costUsd:55090000n,costBasisEstimated:true});
 const lpSell=trade('SELL','120','60','800000000',2);
 expect(positionBasis([buy,lpSell],60n)).toMatchObject({costSol:600600000n,costBasisEstimated:true});
});
it('clears an estimated episode after a complete exit and uses the fresh acquisition average',()=>{
 const rows=[trade('BUY','0','100','1000000000',1),trade('SELL','120','0','1200000000',2),trade('BUY','0','20','300000000',3)];
 const basis=positionBasis(rows,20n);
 expect(basis).toMatchObject({costSol:301000000n,openedAt:3});expect(basis.costBasisEstimated).toBeUndefined();
 expect(positionBasis(rows.slice(0,2),10n).costSol).toBeUndefined();
});
it('does not make an average out of unaudited, failed or incomplete buys and keeps a SOL-only estimate',()=>{
 for(const patch of [{state:'PENDING' as const},{state:'MISMATCH' as const},{executionSucceeded:false},{zeroExtraFeesVerified:false},{volumeLamports:undefined},{totalNetworkLamports:undefined}]){
  const buy=trade('BUY','0','100','1000000000',1);Object.assign(buy.feeReceipt!,patch);
  expect(positionBasis([buy],80n).costSol).toBeUndefined();
 }
 const buy=trade('BUY','0','100','1000000000',1);delete buy.feeReceipt!.usd;
 expect(positionBasis([buy],80n)).toMatchObject({costSol:800800000n,costUsd:undefined,costBasisEstimated:true});
 expect(positionBasis([buy],80n).warning).toContain('Entry USD price unavailable');
});
it('keeps integer precision when scaling inventory above Number.MAX_SAFE_INTEGER',()=>{
 const qty=900719925474099312345n,cash=9007199254740993000n,balance=qty-123n;
 const buy=trade('BUY','0',qty.toString(),cash.toString(),1);
 expect(positionBasis([buy],balance).costSol).toBe((cash+1000000n)*balance/qty);
});
it('reads adjacent GMGN div labels for price and MC, not unrelated dollar balances',async()=>{
 const {readLiveMarket}=await import('../../src/adapters');
 const labels=[{textContent:'Price:',childElementCount:0,nextElementSibling:{textContent:'$0.015'},parentElement:{textContent:'Price: $0.015'}},{textContent:'MC',childElementCount:0,nextElementSibling:{textContent:'$15M'},parentElement:{textContent:'MC $15M'}},{textContent:'Balance',childElementCount:0,parentElement:{textContent:'Balance $5000'}}];
 const link={getAttribute:()=> 'https://solscan.io/token/DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP'};
 const header={querySelectorAll:()=>[link],parentElement:null};
 const item={matches:()=>true,parentElement:header,querySelectorAll:(selector:string)=>selector.includes('solscan')?[]:labels};
 const page={querySelector:()=>null,querySelectorAll:(selector:string)=>selector.includes('InfoItem')?[item]:[]} as unknown as Document;
 expect(readLiveMarket(page,{site:'GMGN',kind:'MINT',address:'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP',pageUrl:'https://gmgn.ai/sol/token/DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP'})).toMatchObject({mint:'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP',priceUsd:'0.015',marketCapUsd:'15000000'});
});
it('keeps refresh issues visible alongside fresh USD PnL without treating expired conversion as current',()=>{
 const snapshot:PositionSnapshot={wallet:'wallet',mint:'mint',balanceRaw:'100',decimals:0,supplyRaw:'1000',updatedAt:Date.now(),costBasisUsdMicros:'101000000',expectedExitLamports:'1200000000',solUsd:{priceMicros:'100000000',capturedAt:Date.now(),source:'Coinbase spot'},quoteIssue:{kind:'RPC',message:'RPC timeout.',retryable:true},usdIssue:{kind:'USD',message:'USD refresh failed.',retryable:true}};
 expect(projectPosition(snapshot)).toMatchObject({pnl:'19000000',bps:'1881'});
 expect(projectPosition(snapshot).note).toContain('RPC timeout.');expect(projectPosition(snapshot).note).toContain('USD refresh failed.');
 snapshot.solUsd!.capturedAt-=30_001;
 expect(projectPosition(snapshot)).toMatchObject({source:'Live price unavailable'});
 expect(projectPosition(snapshot).pnl).toBeUndefined();
 delete snapshot.quoteIssue;
 expect(projectPosition(snapshot).note).toContain('USD unavailable.');
});
