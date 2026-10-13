import type {PositionSnapshot,MarketHint} from './model';
import {markedValueMicros} from './market';
export function freshPositionUsd(snapshot:PositionSnapshot){
 const age=snapshot.solUsd?Date.now()-snapshot.solUsd.capturedAt:Infinity;
 return age>=0&&age<=30_000?snapshot.solUsd:undefined;
}
export function unavailableQuoteLabel(snapshot:PositionSnapshot,unit:'USD'|'SOL'='USD'):string{
 const issue=snapshot.quoteIssue;
 if(issue&&!issue.retryable)return issue.status===401||issue.status===403||/api[ _-]?key/i.test(issue.message)?'Check settings':'Quote unavailable';
 if(issue?.retryable||Date.now()-snapshot.updatedAt>30_000)return 'Quote delayed';
 if(unit==='USD'&&!freshPositionUsd(snapshot)&&snapshot.usdIssue)return 'USD unavailable';
 return 'Quote unavailable';
}
function positionWarnings(snapshot:PositionSnapshot):string{
 const estimate=snapshot.costBasisEstimated&&!snapshot.warning?.includes('Trade-history estimate:')?'Trade-history estimate: LP/transfer gains and losses are not included.':undefined;
 return [...new Set([snapshot.warning,estimate,snapshot.quoteIssue?.message,snapshot.usdIssue?.message].filter(Boolean))].join(' ');
}
export function projectPosition(snapshot:PositionSnapshot,live?:MarketHint,liveOnly=false){
 const candidate=liveOnly?live:live??snapshot.market;
 const hint=candidate?.mint===snapshot.mint&&Date.now()-candidate.observedAt>=0&&Date.now()-candidate.observedAt<10_000?candidate:undefined;
 const marked=markedValueMicros(snapshot.balanceRaw,snapshot.decimals,snapshot.supplyRaw,hint);
 const usd=freshPositionUsd(snapshot),warnings=positionWarnings(snapshot);
 const source=hint?.priceUsd?`${hint.source.replace(' page','')} live price`:hint?.marketCapUsd?`${hint.source.replace(' page','')} MC / on-chain supply (estimate)`:snapshot.expectedExitLamports!==undefined&&usd?'Sell estimate (after venue fees)':'Live price unavailable';
 if(!usd||snapshot.expectedExitLamports===undefined)return {value:marked?.toString(),source,note:`${unavailableQuoteLabel(snapshot)}. ${snapshot.expectedExitLamports!==undefined&&!usd?'USD net PnL':'Net PnL'} is unavailable. ${warnings}`.trim()};
 const quoted=BigInt(snapshot.expectedExitLamports)*BigInt(usd.priceMicros)/1_000_000_000n;
 const baseline=markedValueMicros(snapshot.balanceRaw,snapshot.decimals,snapshot.supplyRaw,snapshot.market);
 const exit=marked!==undefined&&baseline&&baseline>0n?quoted*marked/baseline:quoted;
 const network=(BigInt(snapshot.exitNetworkLamports??'0')+BigInt(snapshot.exitSetupLamports??'0'))*BigInt(usd.priceMicros)/1_000_000_000n;
 const basis=snapshot.costBasisUsdMicros!==undefined?BigInt(snapshot.costBasisUsdMicros):snapshot.costBasisSolLamports!==undefined?BigInt(snapshot.costBasisSolLamports)*BigInt(usd.priceMicros)/1_000_000_000n:undefined;
 if(Date.now()-snapshot.updatedAt>30_000)return {value:(marked??quoted).toString(),source,note:`Exit quote is stale; refreshing net PnL. ${warnings}`.trim()};
 if(basis===undefined||basis<=0n)return {value:(marked??quoted).toString(),source,note:`Untracked acquisition: cost basis is unavailable. ${warnings}`.trim()};
 const pnl=exit-network-basis;
 return {value:(marked??quoted).toString(),pnl:pnl.toString(),basis:basis.toString(),bps:(pnl*10_000n/basis).toString(),source,note:`Estimated net open PnL: entry outlays include protocol/network/setup costs; exit quote includes venue fees and price impact, minus exit network/setup. ${warnings}`};
}
