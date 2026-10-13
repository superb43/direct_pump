type BuyExposure = {createdAt:number;state:string;buyRaw:string};
const UNSETTLED = new Set(['AUTHORIZED','SIGNED','SUBMITTED','UNKNOWN','CONFIRMED']);

/** Independent engine/signer journals supply facts to the same conservative policy. */
export function dailyBuyExposure(attempts:readonly BuyExposure[],now=Date.now()):bigint {
  return attempts.reduce((total,attempt)=>total+(attempt.createdAt>=now-86400000||UNSETTLED.has(attempt.state)?BigInt(attempt.buyRaw):0n),0n);
}
