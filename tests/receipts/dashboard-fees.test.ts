import {expect,it} from 'vitest';
import {feeCategory,feeTotals,groupedFees,money,feeMoney,dailyFeeTotals} from '../../src/receipts/dashboard-fees';
import type {FeeReceipt,Receipt} from '../../src/model';
const native='So11111111111111111111111111111111111111112';
const f:FeeReceipt={state:'VERIFIED',checkedAt:0,note:'',totalNetworkLamports:'205000',priorityLamports:'200000',rentDepositedLamports:'2039280',protocolFees:[{label:'Pump protocol',rawAmount:'2500000',mint:native,decimals:9,symbol:'SOL'},{label:'Pump LP',rawAmount:'625000',mint:native,decimals:9,symbol:'SOL'}],protocolBreakdownIncomplete:false,zeroExtraFeesVerified:true,usd:{priceMicros:'120000000',capturedAt:0,source:'Coinbase spot'}};
it('adds protocol and total network once, excluding refundable rent',()=>{expect(feeTotals(f)).toMatchObject({protocol:'3125000',total:'3330000',partial:false});expect(money('3330000',f,'USD')).toBe('$0.40');expect(money('3330000',f,'SOL')).toBe('0.00333 SOL');});
it('labels incomplete decoding, unknown extra fees and foreign amounts as partial',()=>{expect(feeTotals({...f,protocolBreakdownIncomplete:true}).partial).toBe(true);expect(feeTotals({...f,zeroExtraFeesVerified:false}).partial).toBe(true);const foreign={label:'Creator',rawAmount:'1234',mint:'WBTC',decimals:8,symbol:'WBTC'};const fees={...f,protocolFees:[foreign]};expect(feeTotals(fees)).toMatchObject({total:'205000',foreign:true,partial:true});expect(feeMoney(foreign,fees,'USD')).toContain('Unpriced');});
it('does not substitute present-day prices and keeps small USD fees legible',()=>{expect(money('5000',f,'USD')).toBe('$0.0006');expect(money('5000',{...f,usd:undefined},'USD')).toBe('Unpriced');expect(money(undefined,f,'SOL')).toBe('Unavailable');expect(money('0',undefined,'USD')).toBe('$0.00');});
it('groups protocol components without mixing currencies or counting parent subtotals',()=>{const repeated={...f,protocolFees:[...f.protocolFees,{...f.protocolFees[0]!,rawAmount:'500000'}]};expect(groupedFees(repeated)[0]).toMatchObject({label:'Protocol',rawAmount:'3000000'});expect(feeCategory('Pump buyback')).toBe('Buyback');expect(feeCategory('Meteora partner')).toBe('Partner');expect(feeCategory('Raydium fund')).toBe('Fund');});
const receipt=(feeReceipt:FeeReceipt|undefined,day='2026-10-12'):Receipt=>({wallet:'wallet',mint:'mint',side:'SELL',venue:'PUMP_SWAP',status:'CONFIRMED',message:'',pageUrl:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.parse(`${day}T12:00:00Z`),feeReceipt});
it('stacks confirmed daily fees once, includes failed network fees and excludes rent',()=>{
 const successful={...f,executionSucceeded:true,volumeLamports:'250000000',volumeUsdMicros:'30000000'};
 const failed={...f,executionSucceeded:false,protocolFees:[],volumeUsdMicros:undefined};
 expect(dailyFeeTotals([receipt(successful),receipt(failed)],'SOL')).toEqual([{day:'2026-10-12',protocol:3125000n,network:410000n,saved:2500000n,incomplete:0,unpriced:0}]);
 expect(dailyFeeTotals([receipt(successful),receipt(failed)],'USD')).toEqual([{day:'2026-10-12',protocol:375000n,network:49200n,saved:300000n,incomplete:0,unpriced:0}]);
});
it('retains missing days and counts missing/foreign costs without assuming them zero',()=>{
 const unknown={...f,usd:undefined,protocolBreakdownIncomplete:true};
 const foreign={...f,protocolFees:[{label:'Creator',mint:'WBTC',decimals:8,symbol:'WBTC',rawAmount:'10'}]};
 const rows=dailyFeeTotals([receipt(undefined,'2026-10-10'),receipt(unknown),receipt(foreign)],'USD');
 expect(rows[0]).toMatchObject({day:'2026-10-10',incomplete:1,saved:0n});
 expect(rows[1]).toMatchObject({protocol:0n,network:24600n,incomplete:2,unpriced:1,saved:0n});
});
it('uses historical FX per receipt and withholds savings on mismatched plans',()=>{
 const other={...f,usd:{...f.usd!,priceMicros:'60000000'},state:'MISMATCH' as const,executionSucceeded:true,zeroExtraFeesVerified:false,volumeUsdMicros:'30000000'};
 expect(dailyFeeTotals([receipt(f),receipt(other)],'USD')[0]).toMatchObject({protocol:562500n,network:36900n,saved:0n,incomplete:1});
});
it('groups by UTC block time, limits to 30 days and rounds savings after summing',()=>{
 const priced={...f,executionSucceeded:true,volumeUsdMicros:'99',blockTime:Date.parse('2026-10-11T23:59:59Z')/1000};
 expect(dailyFeeTotals([receipt(priced),receipt(priced)],'USD')[0]).toMatchObject({day:'2026-10-11',saved:1n});
 const receipts=Array.from({length:31},(_,i)=>({...receipt(f),createdAt:Date.parse('2026-09-01T12:00:00Z')+i*86400000}));
 const days=dailyFeeTotals(receipts,'SOL');expect(days).toHaveLength(30);expect(days[0]!.day).toBe('2026-09-02');
});
