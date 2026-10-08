import type {PositionSnapshot,MarketHint} from './model';
import {markedValueMicros} from './market';
export function projectPosition(snapshot:PositionSnapshot,live?:MarketHint,liveOnly=false){
 const candidate=liveOnly?live:live??snapshot.market;
 const hint=candidate?.mint===snapshot.mint&&Date.now()-candidate.observedAt>=0&&Date.now()-candidate.observedAt<10_000?candidate:undefined;
 const marked=markedValueMicros(snapshot.balanceRaw,snapshot.decimals,snapshot.supplyRaw,hint);
 const source=hint?.priceUsd?`${hint.source.replace(' page','')} live price`:hint?.marketCapUsd?`${hint.source.replace(' page','')} MC / on-chain supply (estimate)`:snapshot.expectedExitLamports!==undefined&&snapshot.solUsd?'Sell estimate (after venue fees)':'Live price unavailable';
 if(!snapshot.solUsd||snapshot.expectedExitLamports===undefined)return {value:marked?.toString(),source,note:snapshot.warning??'Exit quote unavailable. Net PnL is unavailable.'};
 const quoted=BigInt(snapshot.expectedExitLamports)*BigInt(snapshot.solUsd.priceMicros)/1_000_000_000n;
 const baseline=markedValueMicros(snapshot.balanceRaw,snapshot.decimals,snapshot.supplyRaw,snapshot.market);
 const exit=marked!==undefined&&baseline&&baseline>0n?quoted*marked/baseline:quoted;
 const network=(BigInt(snapshot.exitNetworkLamports??'0')+BigInt(snapshot.exitSetupLamports??'0'))*BigInt(snapshot.solUsd.priceMicros)/1_000_000_000n;
 const basis=snapshot.costBasisUsdMicros!==undefined?BigInt(snapshot.costBasisUsdMicros):snapshot.costBasisSolLamports!==undefined?BigInt(snapshot.costBasisSolLamports)*BigInt(snapshot.solUsd.priceMicros)/1_000_000_000n:undefined;
 if(Date.now()-snapshot.updatedAt>30_000)return {value:(marked??quoted).toString(),source,note:'Exit quote is stale; refreshing net PnL.'};
 if(basis===undefined||basis<=0n)return {value:(marked??quoted).toString(),source,note:snapshot.warning??'Untracked acquisition: cost basis is unavailable.'};
 const pnl=exit-network-basis;
 return {value:(marked??quoted).toString(),pnl:pnl.toString(),bps:(pnl*10_000n/basis).toString(),source,note:`Estimated net open PnL: entry outlays include protocol/network/setup costs; exit quote includes venue fees and price impact, minus exit network/setup. ${snapshot.warning??''}`};
}
