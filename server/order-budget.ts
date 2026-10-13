import type {ProOrder,ProAttempt} from '../src/pro/contracts';
// Signed historical costs remain charged even when the transaction failed. An
// unknown historical cost consumes the full cap rather than inventing free SOL.
export function strategyNetworkUsed(order:ProOrder,attempts:ProAttempt[]):bigint {
  const cap=BigInt(order.spec.maxNetworkLamports);let used=0n;
  for(const attempt of attempts){
    if(attempt.orderId!==order.id||!attempt.signature||!['FINALIZED','FAILED'].includes(attempt.state))continue;
    if(typeof attempt.networkRaw!=='string'||!/^\d{1,20}$/.test(attempt.networkRaw))return cap;
    used+=BigInt(attempt.networkRaw);if(used>=cap)return cap;
  }
  return used;
}
export function orderNetworkReservation(order:ProOrder,attempts:ProAttempt[]):bigint {
  const cap=BigInt(order.spec.maxNetworkLamports);
  if(order.spec.version!==2)return cap;
  if(order.spec.side==='BUY'&&order.spec.exitStrategy)return cap*2n;
  if(order.spec.kind==='STRATEGY')return cap-strategyNetworkUsed(order,attempts);
  return cap;
}
