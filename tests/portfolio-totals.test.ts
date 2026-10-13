import { afterEach, expect, it, vi } from 'vitest';
import type { PortfolioHolding, PortfolioSnapshot } from '../src/model';
import { holdingDisplay, portfolioTotals, visiblePortfolio } from '../src/portfolio';
import { receiptUsd } from '../src/receipt-format';

afterEach(() => vi.useRealTimers());
const holding = (mint: string, value: string, basis: string): PortfolioHolding => ({
  mint, position: { wallet: 'wallet', mint, balanceRaw: '1000000', decimals: 6, supplyRaw: '1000000000',
    updatedAt: Date.now(), expectedExitLamports: (BigInt(value) * 1000n).toString(), costBasisUsdMicros: basis,
    solUsd: { priceMicros: '1000000', capturedAt: Date.now(), source: 'Coinbase spot' } },
});
const portfolio = (holdings: PortfolioHolding[]): PortfolioSnapshot => ({ wallet: 'wallet', updatedAt: Date.now(), holdings });

it('sums both reported holdings and computes percentage from their combined cost basis', () => {
  const rows = [holding('Solamians', '5180000', '1430000'), holding('FARM', '3550000', '5670000')];
  expect(rows.map(row => holdingDisplay(row))).toMatchObject([{value:'$5.18',pnl:'+$3.75 (+262.23%)'}, {value:'$3.55',pnl:'-$2.12 (-37.38%)'}]);
  expect(portfolioTotals(portfolio(rows))).toMatchObject({ value: '8730000', pnl: '1630000', bps: '2295', note: '' });
});
it('includes history estimates in totals with a visible explanation instead of excluding their known basis',()=>{
 const row=holding('QI','5180000','1430000');row.position!.costBasisEstimated=true;
 expect(portfolioTotals(portfolio([row]))).toMatchObject({value:'5180000',pnl:'3750000',bps:'26223',note:'Includes trade-history estimates; LP/transfer PnL is not included.'});
});

it('sums the displayed rounded dollars, including positive and negative PnL', () => {
  const rows = [holding('A', '5184900', '1430000'), holding('B', '3554900', '5670000')];
  expect(rows.map(row => holdingDisplay(row).value)).toEqual(['$5.18', '$3.55']);
  expect(rows.map(row => holdingDisplay(row).pnl)).toEqual(['+$3.75 (+262.58%)', '-$2.12 (-37.30%)']);
  expect(portfolioTotals(portfolio(rows))).toMatchObject({value:'8730000',pnl:'1630000'});
});

it('supports SOL-denominated basis and preserves the per-row network/setup deductions', () => {
  const row = holding('A', '7000000', '5000000');
  delete row.position!.costBasisUsdMicros;
  row.position!.costBasisSolLamports = '5000000000';
  row.position!.exitNetworkLamports = '100000000'; row.position!.exitSetupLamports = '200000000';
  expect(portfolioTotals(portfolio([row]))).toMatchObject({value:'7000000',pnl:'1700000',bps:'3400'});
});

it('excludes unavailable amounts independently without including their basis in the return', () => {
  const row = holding('A', '5180000', '1430000');
  expect(portfolioTotals(portfolio([row, {mint:'B',error:'RPC unavailable'}]))).toMatchObject({value:'5180000',pnl:'3750000',bps:'26223',note:'Unavailable amounts excluded.'});
  const unpriced = holding('B', '3550000', '5670000'); delete unpriced.position!.expectedExitLamports;
  expect(portfolioTotals(portfolio([row,unpriced]))).toMatchObject({value:'5180000',pnl:'3750000',bps:'26223'});
  const untracked = holding('B', '3550000', '5670000'); delete untracked.position!.costBasisUsdMicros;
  expect(portfolioTotals(portfolio([row,untracked]))).toMatchObject({value:'8730000',pnl:'3750000',bps:'26223'});
  expect(portfolioTotals(portfolio([unpriced]))).toMatchObject({value:'0',pnl:'0',bps:undefined});
});

it('uses exactly the visible holdings and preserves known empty and balance-error states', () => {
  const rows = [holding('A', '5180000', '1430000'), holding('dust', '99000', '50000')];
  expect(portfolioTotals(visiblePortfolio(portfolio(rows)))).toMatchObject({value:'5180000',pnl:'3750000'});
  expect(portfolioTotals(portfolio([]))).toMatchObject({value:'0',pnl:'0',bps:undefined,note:''});
  expect(portfolioTotals({...portfolio([]),updatedAt:0,balanceError:'RPC down'})).toMatchObject({value:undefined,pnl:undefined});
  expect(portfolioTotals({...portfolio([rows[0]!]),balanceError:'RPC down'})).toMatchObject({value:'5180000',pnl:'3750000'});
});

it('keeps known values and excludes expired PnL', () => {
  vi.useFakeTimers();
  const row = holding('A', '5180000', '1430000');
  const snapshot = portfolio([row]);
  vi.setSystemTime(Date.now() + 30_001);
  row.position!.solUsd!.capturedAt = Date.now();
  expect(portfolioTotals(snapshot)).toMatchObject({value:'5180000',pnl:'0',bps:undefined});
});

it('keeps integer precision above the safe JavaScript number range', () => {
  const a = holding('A', '900719925474099300', '900719925474000000');
  const b = holding('B', '20000000', '30000000');
  const totals = portfolioTotals(portfolio([a,b]));
  expect(totals.value).toBe('900719925494100000');
  expect(receiptUsd(totals.value!)).toBe('$900,719,925,494.10');
});
