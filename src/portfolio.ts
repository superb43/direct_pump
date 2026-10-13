import type { PageTarget, PortfolioHolding, Receipt, PortfolioSnapshot } from './model';
import { detectPage } from './sites/catalog';
import { projectPosition, freshPositionUsd, unavailableQuoteLabel } from './position-view';
import { formatAmount } from './savings';
import { receiptUsd, receiptSol, roundedUsdMicros } from './receipt-format';

export function holdingAge(openedAt: number | undefined, now=Date.now()): string {
  if (openedAt === undefined || !Number.isFinite(openedAt) || openedAt <= 0 || openedAt > now) return 'Unavailable';
  const seconds=Math.floor((now-openedAt)/1000);
  if(seconds<60)return `${seconds}s`;
  if(seconds<3600)return `${Math.floor(seconds/60)}m`;
  if(seconds<86400)return `${Math.floor(seconds/3600)}h`;
  return `${Math.floor(seconds/86400)}d`;
}

/** Unknown valuations stay visible; use gross sell value, before network/setup costs. */
export function isDustHolding(holding:PortfolioHolding|undefined):boolean{
  const position=holding?.position;
  if(!position||holding?.priceMode==='STALE'||!freshPositionUsd(position)||Date.now()-position.updatedAt>30_000||position.expectedExitLamports===undefined)return false;
  return BigInt(position.expectedExitLamports)*BigInt(freshPositionUsd(position)!.priceMicros)<100_000n*1_000_000_000n;
}
export function visiblePortfolio(portfolio:PortfolioSnapshot):PortfolioSnapshot{
  return {...portfolio,holdings:portfolio.holdings.filter(holding=>!isDustHolding(holding))};
}

export function portfolioPriceStatus(portfolio:PortfolioSnapshot):string{
  const rows=portfolio.holdings.filter(holding=>holding.position),live=rows.filter(holding=>holding.priceMode==='LIVE').length;
  if(rows.some(holding=>holding.priceMode==='STALE'))return 'Price update delayed';
  if(live===rows.length&&live)return 'Live prices';
  if(live)return 'Live / automatic prices';
  return rows.some(holding=>holding.priceMode==='POLLING')?'Automatic prices · 3s':'Prices updating';
}

/** Totals use precisely the same visible rows and projections as the holdings list. */
export function portfolioTotals(portfolio: PortfolioSnapshot) {
  let value = 0n, pnl = 0n, basis = 0n;
  const balanceUnavailable = !!(portfolio.balanceError && !portfolio.updatedAt);
  let excluded = false, estimated = false;
  for (const holding of portfolio.holdings) {
    const view = holding.position ? projectPosition(holding.position) : undefined;
    if (view?.value === undefined) excluded = true;
    else value += roundedUsdMicros(view.value);
    if (view?.pnl === undefined || view.basis === undefined) excluded = true;
    else { pnl += roundedUsdMicros(view.pnl); basis += BigInt(view.basis); estimated ||= !!holding.position?.costBasisEstimated; }
  }
  return {
    value: balanceUnavailable ? undefined : value.toString(),
    pnl: balanceUnavailable ? undefined : pnl.toString(),
    bps: !balanceUnavailable && basis > 0n ? (pnl * 10_000n / basis).toString() : undefined,
    note: [excluded ? 'Unavailable amounts excluded.' : '', estimated ? 'Includes trade-history estimates; LP/transfer PnL is not included.' : ''].filter(Boolean).join(' '),
  };
}

/** Price pushes never replace confirmed quantities, basis, holding age or balance time. */
export function mergePortfolioPrices(base:PortfolioSnapshot,prices:PortfolioSnapshot|undefined):PortfolioSnapshot{
  if(!prices||base.wallet!==prices.wallet)return base;
  const byMint=new Map<string,PortfolioHolding>();
  for(const holding of prices.holdings)if(!byMint.has(holding.mint))byMint.set(holding.mint,holding);
  return visiblePortfolio({...base,holdings:base.holdings.map(holding=>{
    const price=byMint.get(holding.mint);
    if(!holding.position||!price?.position||holding.position.wallet!==base.wallet||price.position.wallet!==base.wallet||holding.position.mint!==holding.mint||price.position.mint!==holding.mint||price.position.balanceRaw!==holding.position.balanceRaw)return holding;
    if((price.priceUpdatedAt??price.position.updatedAt)<(holding.priceUpdatedAt??holding.position.updatedAt))return holding;
    return {...holding,pricingPending:price.pricingPending,priceMode:price.priceMode,priceUpdatedAt:price.priceUpdatedAt,position:{...holding.position,
      updatedAt:price.position.updatedAt,expectedExitLamports:price.position.expectedExitLamports,exitNetworkLamports:price.position.exitNetworkLamports,exitSetupLamports:price.position.exitSetupLamports,solUsd:price.position.solUsd,pricePool:price.position.pricePool,quoteIssue:price.position.quoteIssue,usdIssue:price.position.usdIssue,warning:holding.position.warning}};
  })});
}

/** The saved pool URL remains a pool assertion; never turn an Axiom mint into a pool. */
export function walletReceiptsByMint(receipts:readonly Receipt[],wallet:string):Map<string,Receipt[]>{
  const grouped=new Map<string,Receipt[]>();
  for(const receipt of receipts)if(receipt.wallet===wallet){let rows=grouped.get(receipt.mint);if(!rows){rows=[];grouped.set(receipt.mint,rows);}rows.push(receipt);}
  return grouped;
}
export function trackedTokens(receipts: Receipt[], wallet: string): (PortfolioHolding & { target: PageTarget })[] {
  const tokens = new Map<string, PortfolioHolding & { target: PageTarget }>();
  const symbols=new Map<string,string>();
  for(const receipt of receipts)if(receipt.wallet===wallet&&receipt.symbol&&!symbols.has(receipt.mint))symbols.set(receipt.mint,receipt.symbol);
  for (const receipt of receipts.filter(row=>row.wallet===wallet).sort((a,b) => b.createdAt-a.createdAt)) {
    if (tokens.has(receipt.mint)) continue;
    const page = detectPage(receipt.pageUrl);
    const valid = page && (page.kind === 'POOL' || page.address === receipt.mint);
    const target: PageTarget = valid ? { ...page, mintHint: receipt.mint } : {
      site: 'GMGN', kind: 'MINT', address: receipt.mint, mintHint: receipt.mint,
      pageUrl: `https://gmgn.ai/sol/token/${receipt.mint}`,
    };
    tokens.set(receipt.mint, { mint: receipt.mint, symbol: receipt.symbol ?? symbols.get(receipt.mint), pageUrl: target.pageUrl, target });
  }
  return [...tokens.values()];
}

export function holdingDisplay(holding: PortfolioHolding, unit: 'USD' | 'SOL' = 'USD') {
  const snapshot = holding.position;
  if (!snapshot) return { value: '—', pnl: 'Balance unavailable', quantity: '—', basis: '—', note: holding.error ?? 'Balance unavailable', negative: false };
  const view = projectPosition(snapshot);
  const age=holding.priceUpdatedAt?` · Price updated ${new Date(holding.priceUpdatedAt).toLocaleTimeString()}`:'';
  const value = unit === 'SOL' ? snapshot.expectedExitLamports === undefined ? 'Unavailable' : receiptSol(snapshot.expectedExitLamports) : view.value === undefined ? 'Unavailable' : receiptUsd(view.value);
  const quantity = formatAmount(snapshot.balanceRaw, snapshot.decimals);
  const basis = unit === 'SOL' ? snapshot.costBasisSolLamports === undefined ? 'Unavailable' : receiptSol(snapshot.costBasisSolLamports) : snapshot.costBasisUsdMicros !== undefined ? receiptUsd(snapshot.costBasisUsdMicros)
    : snapshot.costBasisSolLamports !== undefined ? `${formatAmount(snapshot.costBasisSolLamports)} SOL` : 'Unavailable';
  const balance=BigInt(snapshot.balanceRaw),tokenScale=10n**BigInt(snapshot.decimals);
  const average=balance>0n&&snapshot.costBasisUsdMicros!==undefined&&unit==='USD'
    ? `$${formatAmount((BigInt(snapshot.costBasisUsdMicros)*tokenScale*1_000_000_000_000n/balance).toString(),18)}`
    : balance>0n&&snapshot.costBasisSolLamports!==undefined?`${formatAmount((BigInt(snapshot.costBasisSolLamports)*tokenScale*1_000_000_000n/balance).toString(),18)} SOL`:undefined;
  const note=[view.note,average?`Avg cost (including entry costs): ${average} per token.`:''].filter(Boolean).join(' ');
  const solBasis = snapshot.costBasisSolLamports === undefined ? undefined : BigInt(snapshot.costBasisSolLamports);
  const solPnl = solBasis !== undefined && solBasis > 0n && snapshot.expectedExitLamports !== undefined && Date.now()-snapshot.updatedAt <= 30_000
    ? BigInt(snapshot.expectedExitLamports)-BigInt(snapshot.exitNetworkLamports??'0')-BigInt(snapshot.exitSetupLamports??'0')-solBasis : undefined;
  const pnl = unit === 'SOL' ? solPnl?.toString() : view.pnl;
  const pct = unit === 'SOL' ? solPnl === undefined ? undefined : (solPnl*10_000n/solBasis!).toString() : view.bps;
  if (pnl === undefined || pct === undefined) return { value:holding.pricingPending&&value==='Unavailable'?'Pricing…':value, quantity, basis, pnl: snapshot.costBasisSolLamports === undefined && snapshot.costBasisUsdMicros === undefined ? 'Cost basis unavailable' : holding.pricingPending?'Calculating…':unavailableQuoteLabel(snapshot,unit), note: holding.pricingPending?`Price and net PnL update automatically. ${note}`:note, negative: false };
  const raw = BigInt(pnl), bps = BigInt(pct), negative = raw < 0n, absBps = bps < 0n ? -bps : bps;
  return { value, quantity, basis, negative, pnl: `${negative ? '-' : '+'}${(unit === 'SOL' ? receiptSol : receiptUsd)((negative ? -raw : raw).toString())} (${bps < 0n ? '-' : '+'}${absBps/100n}.${(absBps%100n).toString().padStart(2,'0')}%)`, note: `${note}${age}` };
}
