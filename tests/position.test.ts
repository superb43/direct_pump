import {expect,it} from 'vitest';
import {positionBasis} from '../src/position';
import {projectPosition} from '../src/position-view';
import {decimalText,markedValueMicros} from '../src/market';
import type {Receipt,PositionSnapshot} from '../src/model';
const trade=(side:'BUY'|'SELL',before:string,after:string,volume:string,time:number):Receipt=>({wallet:'wallet',mint:'mint',venue:'PUMP_SWAP',side,pageUrl:'',message:'',blockhash:'',lastValidBlockHeight:1,createdAt:time,status:'CONFIRMED',feeReceipt:{auditVersion:2,state:'VERIFIED',checkedAt:time,note:'fixture',protocolFees:[],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:true,executionSucceeded:true,tokenBeforeRaw:before,tokenAfterRaw:after,volumeLamports:volume,totalNetworkLamports:'1000000',rentDepositedLamports:'0',rentRefundedLamports:'0',usd:{priceMicros:'100000000',capturedAt:time,source:'Coinbase spot'}}});
it('includes acquisition network costs and allocates remaining cost after a partial sale',()=>{
 const receipts=[trade('BUY','0','100','1000000000',1),trade('SELL','100','50','700000000',2)];
 const basis=positionBasis(receipts,50n);expect(basis.costSol).toBe(500500000n);expect(basis.costUsd).toBe(50050000n);
 expect(positionBasis(receipts,70n).costSol).toBeUndefined();
});
it('does not fabricate basis for external inventory and resets after a full exit',()=>{
 expect(positionBasis([trade('BUY','50','100','1000000000',1)],100n).costSol).toBeUndefined();
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
it('reads adjacent GMGN div labels for price and MC, not unrelated dollar balances',async()=>{
 const {readLiveMarket}=await import('../src/adapters');
 const labels=[{textContent:'Price:',childElementCount:0,nextElementSibling:{textContent:'$0.015'},parentElement:{textContent:'Price: $0.015'}},{textContent:'MC',childElementCount:0,nextElementSibling:{textContent:'$15M'},parentElement:{textContent:'MC $15M'}},{textContent:'Balance',childElementCount:0,parentElement:{textContent:'Balance $5000'}}];
 const link={getAttribute:()=> 'https://solscan.io/token/DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP'};
 const header={querySelectorAll:()=>[link],parentElement:null};
 const item={matches:()=>true,parentElement:header,querySelectorAll:(selector:string)=>selector.includes('solscan')?[]:labels};
 const page={querySelector:()=>null,querySelectorAll:(selector:string)=>selector.includes('InfoItem')?[item]:[]} as unknown as Document;
 expect(readLiveMarket(page,{site:'GMGN',kind:'MINT',address:'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP',pageUrl:'https://gmgn.ai/sol/token/DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP'})).toMatchObject({mint:'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP',priceUsd:'0.015',marketCapUsd:'15000000'});
});
