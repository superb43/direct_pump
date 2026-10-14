import {expect,it} from 'vitest';
import type {ProOrder} from '../../src/pro/contracts';
import type {ProPortfolio} from '../../src/pro/portfolio-contracts';
import {orderUsdValue,strategyRemainingPercent} from '../../src/pro/order-display';

const order={wallet:'wallet',spec:{side:'SELL',mint:'mint',amountRaw:'25000000000',decimals:6}} as ProOrder;
const portfolio:ProPortfolio={wallet:'wallet',updatedAt:1000,partial:false,rows:[{mint:'mint',decimals:6,totalRaw:'50000000000',availableRaw:'50000000000',reservedRaw:'0',valueLamports:'175000000',solUsdUnits:'120000000000000',status:'UNAVAILABLE'}]};
it('values sells and SOL buys in dollars without changing raw intent',()=>{
 expect(orderUsdValue(order,portfolio,1000)).toBe('~$10.50');
 expect(orderUsdValue({...order,spec:{...order.spec,side:'BUY',amountRaw:'20000000',decimals:9}},portfolio,1000)).toBe('~$2.40');
 expect(order.spec.amountRaw).toBe('25000000000');
 expect(orderUsdValue({...order,spec:{...order.spec,amountRaw:'1'}},portfolio,1000)).toBe('<$0.01');
});
it('does not invent dollar values for stale, missing or another wallet data',()=>{
 expect(orderUsdValue(order,undefined,1000)).toBe('USD unavailable');
 expect(orderUsdValue(order,portfolio,31001)).toBe('USD unavailable');
 expect(orderUsdValue({...order,wallet:'other'},portfolio,1000)).toBe('USD unavailable');
 expect(orderUsdValue({...order,spec:{...order.spec,mint:'other'}},portfolio,1000)).toBe('USD unavailable');
 expect(orderUsdValue(order,{...portfolio,rows:[{...portfolio.rows[0]!,totalRaw:'0'}]},1000)).toBe('USD unavailable');
});
it('uses the confirmed strategy base, including buy protection and exact large balances',()=>{
 expect(strategyRemainingPercent({baseRaw:'100000000000000000000',remainingRaw:'75000000000000000000'})).toBe('75.00%');
 expect(strategyRemainingPercent({baseRaw:'1001',remainingRaw:'1'})).toBe('0.09%');
 expect(strategyRemainingPercent({baseRaw:'100',remainingRaw:'100'})).toBe('100.00%');
 expect(strategyRemainingPercent({baseRaw:'100',remainingRaw:'0'})).toBe('0.00%');
 expect(strategyRemainingPercent({baseRaw:'0',remainingRaw:'0'})).toBe('Unavailable');
});
