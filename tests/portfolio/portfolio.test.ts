import {expect,it} from 'vitest';
import {trackedTokens,holdingDisplay,holdingAge,portfolioPriceStatus,mergePortfolioPrices,isDustHolding,visiblePortfolio} from '../../src/portfolio/portfolio';
import {SITE_CONTEXTS,TEST_MINT} from '../fixtures/site-contexts';
import type {Receipt,PortfolioHolding,PortfolioSnapshot} from '../../src/model';

const receipt=(pageUrl:string,createdAt=1):Receipt=>({wallet:'wallet',mint:TEST_MINT,symbol:'SI',venue:'PUMP_SWAP',side:'BUY',pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt,status:'CONFIRMED'});
it.each(SITE_CONTEXTS)('$site keeps the saved token/pool identity and collapses repeated trades',({target})=>{
 const rows=trackedTokens([receipt(target.pageUrl),{...receipt(target.pageUrl,2),side:'SELL'}, {...receipt(target.pageUrl,3),wallet:'other'}],'wallet');
 expect(rows).toHaveLength(1);expect(rows[0]!.pageUrl).toBe(target.pageUrl);expect(rows[0]!.target.kind).toBe(target.kind);expect(rows[0]!.target.address).toBe(target.address);expect(rows[0]!.target.mintHint).toBe(TEST_MINT);
});
it('replaces unsupported and mismatched mint links with a supported mint page',()=>{
 for(const url of ['javascript:alert(1)','https://attacker.test/token','https://gmgn.ai/sol/token/AG1EhPjsBrkxQWkViuLXF6pQnHwfr9f9sdNneeoykcEJ'])expect(trackedTokens([receipt(url)],'wallet')[0]!.pageUrl).toBe(`https://gmgn.ai/sol/token/${TEST_MINT}`);
});
it('preserves receipt input and first-known symbol while using the latest bound target',()=>{
 const url=SITE_CONTEXTS[1]!.target.pageUrl,rows=[{...receipt(url,1),symbol:'FIRST'},{...receipt(url,2),symbol:'LATER'},{...receipt(url,3),symbol:undefined}];
 const original=structuredClone(rows);expect(trackedTokens(rows,'wallet')[0]).toMatchObject({symbol:'FIRST',pageUrl:url});expect(rows).toEqual(original);
});
const holding=():PortfolioHolding=>({mint:TEST_MINT,position:{wallet:'wallet',mint:TEST_MINT,balanceRaw:'50000000',decimals:6,supplyRaw:'1000000000000',updatedAt:Date.now(),costBasisUsdMicros:'50050000',costBasisSolLamports:'500500000',expectedExitLamports:'700000000',exitNetworkLamports:'1000000',exitSetupLamports:'2000000',solUsd:{priceMicros:'100000000',capturedAt:Date.now(),source:'Coinbase spot'}}});
it('shows remaining inventory and net liquidation PnL after entry and exit costs in both currencies',()=>{
 expect(holdingDisplay(holding())).toMatchObject({quantity:'50',value:'$70.00',basis:'$50.05',pnl:'+$19.65 (+39.26%)',negative:false});
 expect(holdingDisplay(holding(),'SOL')).toMatchObject({value:'0.7 SOL',basis:'0.5005 SOL',pnl:'+0.1965 SOL (+39.26%)'});
});
it('shows history-based basis and PnL without prefixes in both currencies and explains the retained average',()=>{
 const h=holding();h.position!.costBasisEstimated=true;
 expect(holdingDisplay(h)).toMatchObject({basis:'$50.05',pnl:'+$19.65 (+39.26%)',negative:false});
 expect(holdingDisplay(h).note).toContain('LP/transfer gains and losses are not included');
 expect(holdingDisplay(h).note).toContain('Avg cost (including entry costs): $1.001 per token.');
 expect(holdingDisplay(h,'SOL')).toMatchObject({basis:'0.5005 SOL',pnl:'+0.1965 SOL (+39.26%)'});
 const prices:PortfolioSnapshot={wallet:'wallet',updatedAt:Date.now(),holdings:[{...h,position:{...h.position!,costBasisEstimated:false,expectedExitLamports:'900000000'}}]};
 expect(mergePortfolioPrices({wallet:'wallet',updatedAt:Date.now(),holdings:[h]},prices).holdings[0]!.position!.costBasisEstimated).toBe(true);
 const exact={...h,position:{...h.position!,costBasisEstimated:undefined,warning:undefined}};
 prices.holdings[0]!.position!.warning='Trade-history estimate: LP/transfer gains and losses are not included.';
 const refreshed=mergePortfolioPrices({wallet:'wallet',updatedAt:Date.now(),holdings:[exact]},prices).holdings[0]!;
 expect(refreshed.position!.warning).toBeUndefined();expect(holdingDisplay(refreshed).note).not.toContain('Trade-history estimate:');
 h.position!.updatedAt-=60_000;expect(holdingDisplay(h).pnl).toBe('Quote delayed');
});
it('keeps missing balance, basis, price and stale quotes distinct without inventing PnL',()=>{
 expect(holdingDisplay({mint:TEST_MINT,error:'RPC down'})).toMatchObject({quantity:'—',note:'RPC down'});
 const h=holding();delete h.position!.costBasisUsdMicros;delete h.position!.costBasisSolLamports;
 expect(holdingDisplay(h)).toMatchObject({value:'$70.00',pnl:'Cost basis unavailable'});
 const unpriced=holding();delete unpriced.position!.solUsd;
 expect(holdingDisplay(unpriced).pnl).toBe('Quote unavailable');expect(holdingDisplay(unpriced,'SOL').pnl).toContain('+0.1965 SOL');
 const stale=holding();stale.position!.updatedAt-=60_000;
 expect(holdingDisplay(stale).pnl).toBe('Quote delayed');expect(holdingDisplay(stale,'SOL').pnl).toBe('Quote delayed');
});
it('switches holding age at each unit boundary without fractional or subordinate units',()=>{
 const opened=1_000_000;
 for(const [seconds,label] of [[0,'0s'],[59,'59s'],[60,'1m'],[3599,'59m'],[3600,'1h'],[86399,'23h'],[86400,'1d'],[172800,'2d']] as const)expect(holdingAge(opened,opened+seconds*1000)).toBe(label);
 expect(holdingAge(undefined)).toBe('Unavailable');expect(holdingAge(opened,opened-1)).toBe('Unavailable');
});
it('distinguishes actual live prices, automatic quotes and delayed estimates',()=>{
 const h=holding();expect(portfolioPriceStatus({wallet:'wallet',updatedAt:Date.now(),holdings:[{...h,priceMode:'LIVE'}]})).toBe('Live prices');
 expect(portfolioPriceStatus({wallet:'wallet',updatedAt:Date.now(),holdings:[{...h,priceMode:'POLLING'}]})).toBe('Automatic prices · 3s');
 expect(portfolioPriceStatus({wallet:'wallet',updatedAt:Date.now(),holdings:[{...h,priceMode:'STALE'}]})).toBe('Price update delayed');
});
it('merges prices without replacing quantities, basis, holding age or newer estimates',()=>{
 const h=holding();h.position!.openedAt=1000;h.position!.balanceUpdatedAt=100;
 const base={wallet:'wallet',updatedAt:100,holdings:[{...h,priceUpdatedAt:100}]};
 const pushed={wallet:'wallet',updatedAt:999,holdings:[{...h,priceUpdatedAt:200,position:{...h.position!,openedAt:999,costBasisUsdMicros:'1',balanceUpdatedAt:999,expectedExitLamports:'900000000'}}]};
 const result=mergePortfolioPrices(base,pushed);expect(result.updatedAt).toBe(100);expect(result.holdings[0]!.position).toMatchObject({openedAt:1000,balanceUpdatedAt:100,costBasisUsdMicros:h.position!.costBasisUsdMicros,expectedExitLamports:'900000000'});
 pushed.holdings[0]!.position.balanceRaw='999';expect(mergePortfolioPrices(base,pushed).holdings[0]).toEqual(base.holdings[0]);
 pushed.holdings[0]!.position.balanceRaw=h.position!.balanceRaw;pushed.holdings[0]!.priceUpdatedAt=50;expect(mergePortfolioPrices(base,pushed).holdings[0]).toEqual(base.holdings[0]);
});

it('filters strictly below $0.1 without rounding and keeps unknown or failed valuations visible',()=>{
 const h=holding();h.position!.expectedExitLamports='999999';
 expect(isDustHolding(h)).toBe(true);
 h.position!.expectedExitLamports='1000000';expect(isDustHolding(h)).toBe(false);
 h.position!.expectedExitLamports='1000001';expect(isDustHolding(h)).toBe(false);
 h.position!.expectedExitLamports='999999';h.priceMode='STALE';expect(isDustHolding(h)).toBe(false);
 delete h.priceMode;delete h.position!.solUsd;expect(isDustHolding(h)).toBe(false);
 expect(visiblePortfolio({wallet:'wallet',updatedAt:1,holdings:[h,{mint:TEST_MINT,error:'Unavailable'}]}).holdings).toHaveLength(2);
});
it('removes dust immediately on a price push without changing the confirmed balance',()=>{
 const h=holding(),base={wallet:'wallet',updatedAt:1,holdings:[h]};
 const prices={wallet:'wallet',updatedAt:1,holdings:[{...h,priceUpdatedAt:Date.now()+1,position:{...h.position!,expectedExitLamports:'999999'}}]};
 expect(mergePortfolioPrices(base,prices).holdings).toEqual([]);expect(base.holdings[0]!.position!.balanceRaw).toBe(h.position!.balanceRaw);
});

it('separates USD failures from a valid SOL PnL and rejects expired USD estimates',()=>{
 const h=holding();h.position!.usdIssue={kind:'USD',message:'USD provider unavailable.',retryable:true};
 expect(holdingDisplay(h).pnl).toContain('+$19.65');
 expect(holdingDisplay(h).note).toContain('USD provider unavailable.');
 h.position!.solUsd!.capturedAt-=30_001;
 expect(holdingDisplay(h)).toMatchObject({value:'Unavailable',pnl:'USD unavailable'});
 expect(holdingDisplay(h,'SOL').pnl).toContain('+0.1965 SOL');
 expect(isDustHolding(h)).toBe(false);
 delete h.position!.solUsd;
 expect(holdingDisplay(h).pnl).toBe('USD unavailable');
});
it('keeps fresh retained PnL and exposes the failed refresh reason in its note',()=>{
 const h=holding();h.position!.quoteIssue={kind:'RPC',message:'RPC timeout; retry scheduled.',retryable:true};
 expect(holdingDisplay(h)).toMatchObject({pnl:'+$19.65 (+39.26%)'});
 expect(holdingDisplay(h).note).toContain('RPC timeout; retry scheduled.');
 h.position!.updatedAt-=30_001;
 expect(holdingDisplay(h).pnl).toBe('Quote delayed');
 delete h.position!.expectedExitLamports;
 h.position!.quoteIssue={kind:'RPC',message:'RPC unauthorized.',retryable:false,status:401};
 expect(holdingDisplay(h).pnl).toBe('Check settings');
 h.position!.quoteIssue={kind:'ROUTE',message:'Jupiter API key missing.',retryable:false};
 expect(holdingDisplay(h).pnl).toBe('Check settings');
 h.position!.quoteIssue={kind:'ROUTE',message:'No sell route available.',retryable:false};
 expect(holdingDisplay(h).pnl).toBe('Quote unavailable');
 delete h.position!.costBasisSolLamports;delete h.position!.costBasisUsdMicros;
 expect(holdingDisplay(h).pnl).toBe('Cost basis unavailable');
 h.position!.costBasisSolLamports='500500000';h.pricingPending=true;
 expect(holdingDisplay(h).pnl).toBe('Calculating…');
 expect(holdingDisplay(h).note).toContain('No sell route available.');
});
it('merges issue state but refuses snapshot wallet or mint mismatches',()=>{
 const h=holding(),base={wallet:'wallet',updatedAt:100,holdings:[h]};
 const issue={kind:'RPC' as const,message:'RPC unavailable.',retryable:true};
 const pushed:PortfolioSnapshot={wallet:'wallet',updatedAt:200,holdings:[{...h,priceUpdatedAt:Date.now()+1,position:{...h.position!,quoteIssue:issue,usdIssue:{kind:'USD' as const,message:'USD down.',retryable:true}}}]};
 expect(mergePortfolioPrices(base,pushed).holdings[0]!.position).toMatchObject({quoteIssue:issue,usdIssue:{kind:'USD'}});
 for(const field of ['wallet','mint'] as const){
  const bad={...pushed,holdings:[{...pushed.holdings[0]!,position:{...pushed.holdings[0]!.position!,[field]:'other'}}]};
  expect(mergePortfolioPrices(base,bad).holdings[0]).toEqual(h);
  const badBase={...base,holdings:[{...h,position:{...h.position!,[field]:'other'}}]};
  expect(mergePortfolioPrices(badBase,pushed).holdings[0]).toEqual(badBase.holdings[0]);
 }
 pushed.holdings[0]!.position!.quoteIssue=undefined;pushed.holdings[0]!.position!.usdIssue=undefined;
 const recovered=mergePortfolioPrices(mergePortfolioPrices(base,{...pushed,holdings:[{...pushed.holdings[0]!,position:{...pushed.holdings[0]!.position!,quoteIssue:issue}}]}),pushed);
 expect(recovered.holdings[0]!.position!.quoteIssue).toBeUndefined();
});
