import {expect,it} from 'vitest';
import {receiptSol,receiptUsd,receiptToken} from '../src/receipt-format';
import {subtotalMoney,terminalFeeMoney,terminalFeeTitle} from '../src/dashboard-fees';
import type {FeeReceipt} from '../src/model';
it('rounds SOL to six decimal places with integer arithmetic and never hides lamports as zero',()=>{
 expect(receiptSol('17822497')).toBe('0.017822 SOL');expect(receiptSol('123458')).toBe('0.000123 SOL');
 expect(receiptSol('228500')).toBe('0.000229 SOL');expect(receiptSol('10000000')).toBe('0.01 SOL');
 expect(receiptSol('1')).toBe('<0.000001 SOL');expect(receiptSol('999')).toBe('<0.000001 SOL');
 expect(receiptSol('1000')).toBe('0.000001 SOL');expect(receiptSol('0')).toBe('0 SOL');
 expect(receiptSol('9007199254740993000')).toBe('9,007,199,254.740993 SOL');
});
it('adapts USD precision to magnitude, trims noise and handles rounding carry',()=>{
 expect(receiptUsd('1162800')).toBe('$1.16');expect(receiptUsd('26560')).toBe('$0.027');
 expect(receiptUsd('14357')).toBe('$0.014');expect(receiptUsd('600')).toBe('$0.0006');
 expect(receiptUsd('99')).toBe('<$0.0001');expect(receiptUsd('0')).toBe('$0.00');
 expect(receiptUsd('999999')).toBe('$1.00');expect(receiptUsd('1000005')).toBe('$1.00');
 expect(receiptUsd('1250050')).toBe('$1.25');expect(receiptUsd('1255000')).toBe('$1.26');
});
it('shows known fee subtotals without lower-bound symbols and retains downward rounding',()=>{
 const f={usd:{priceMicros:'116280000',capturedAt:0,source:'Coinbase 1m candle'}} as FeeReceipt;
 expect(subtotalMoney('228458',f,'USD',true)).toBe('$0.026');
 expect(subtotalMoney('228999',f,'SOL',true)).toBe('0.000228 SOL');
 expect(subtotalMoney('1',f,'SOL',true)).toBe('<0.000001 SOL');
 expect(subtotalMoney('1',f,'USD',true)).toBe('<$0.0001');
 expect(subtotalMoney('1',f,'SOL',false)).toBe('<0.000001 SOL');
});
it('always shows terminal zero without changing verification or savings gates',()=>{
 const f={state:'UNAVAILABLE',zeroExtraFeesVerified:false,terminalFeeLamports:'0',terminalFeeSource:'USER_CONFIRMED'} as FeeReceipt;
 expect(terminalFeeMoney(f,'USD')).toBe('$0.00');expect(terminalFeeMoney(f,'SOL')).toBe('0 SOL');
 expect(terminalFeeTitle(f)).toContain('no terminal fee');expect(f.zeroExtraFeesVerified).toBe(false);expect(f.state).toBe('UNAVAILABLE');
 expect(terminalFeeMoney(undefined,'USD')).toBe('$0.00');
 for(const state of ['PENDING','VERIFIED','UNAVAILABLE','MISMATCH'] as const){expect(terminalFeeMoney({...f,state,terminalFeeLamports:undefined},'SOL')).toBe('0 SOL');}
});
it('displays sanitized tickers, never substitutes a mint as the ticker',()=>{
 expect(receiptToken({symbol:'Topless'})).toBe('$Topless');expect(receiptToken({symbol:'$Clubhouse\u202e'})).toBe('$Clubhouse');
 expect(receiptToken({})).toBe('$TOKEN');
});
