import {validateProSpec,usdUnits,unitsUsd,type ProOrder,type ProSpec,type ProAttempt} from '../src/pro/contracts';
import {marketCapUsd} from '../src/pro/mc';
import type {Observation} from './engine';
export function mcObservation(o:Observation):string {
  if(o.supplyRaw===undefined||o.tokenDecimals===undefined)throw new Error('Verified supply is required for MC orders.');
  return marketCapUsd(o.priceUsd,o.supplyRaw,o.tokenDecimals);
}
export function initStrategy(order:ProOrder):void {
  if(order.spec.kind==='STRATEGY'&&!order.strategy)order.strategy={baseRaw:order.spec.amountRaw,remainingRaw:order.spec.amountRaw,steps:order.spec.steps!.map(s=>({id:s.id,state:'OPEN'}))};
}
export function strategyTrigger(order:ProOrder,o:Observation):{id:string;amountRaw:string}|undefined {
  initStrategy(order);const progress=order.strategy!,p=usdUnits(mcObservation(o));order.currentMcUsd=unitsUsd(p);
  const eligible=order.spec.steps!.filter(step=>{
    const state=progress.steps.find(r=>r.id===step.id)!;if(state.state!=='OPEN')return false;
    if(step.kind==='TAKE_PROFIT')return p>=usdUnits(step.targetMcUsd!);
    if(step.kind==='STOP_LOSS')return p<=usdUnits(step.targetMcUsd!);
    if(!state.trailActive&&(!step.activationMcUsd||p>=usdUnits(step.activationMcUsd)))state.trailActive=true;
    if(!state.trailActive)return false;
    const high=state.highWatermarkMcUsd?usdUnits(state.highWatermarkMcUsd):p;state.highWatermarkMcUsd=unitsUsd(p>high?p:high);
    return p*10000n<=usdUnits(state.highWatermarkMcUsd)*BigInt(10000-step.trailingBps!);
  }).sort((a,b)=>{
    const priority=(k:string)=>k==='STOP_LOSS'?0:k==='TRAILING'?1:2;
    if(priority(a.kind)!==priority(b.kind))return priority(a.kind)-priority(b.kind);
    const av=a.targetMcUsd?usdUnits(a.targetMcUsd):0n,bv=b.targetMcUsd?usdUnits(b.targetMcUsd):0n;
    return av===bv?a.id.localeCompare(b.id):a.kind==='STOP_LOSS'?(av>bv?-1:1):(av<bv?-1:1);
  });
  const step=eligible[0];if(!step)return;
  const remaining=BigInt(progress.remainingRaw),planned=step.remaining?remaining:BigInt(progress.baseRaw)*BigInt(step.portionBps!)/10000n;
  const amount=planned<remaining?planned:remaining;
  if(amount<=0n)throw new Error('Strategy step rounds to zero; revise quantity.');
  return {id:step.id,amountRaw:String(amount)};
}
export function mcTriggered(order:ProOrder,o:Observation):boolean {
  const s=order.spec,p=usdUnits(mcObservation(o));order.currentMcUsd=unitsUsd(p);
  if(s.kind==='MARKET')return true;
  if(s.kind==='STRATEGY')return !!strategyTrigger(order,o);
  if(s.kind==='LIMIT')return s.side==='BUY'?p<=usdUnits(s.triggerMcUsd!):p>=usdUnits(s.triggerMcUsd!);
  if(s.kind==='TAKE_PROFIT')return p>=usdUnits(s.triggerMcUsd!);
  if(s.kind==='STOP_LOSS')return p<=usdUnits(s.triggerMcUsd!);
  if(s.kind==='BRACKET')return p>=usdUnits(s.tpMcUsd!)||p<=usdUnits(s.slMcUsd!);
  if(!order.trailActive&&(!s.activationMcUsd||p>=usdUnits(s.activationMcUsd)))order.trailActive=true;
  if(!order.trailActive)return false;
  const high=order.highWatermarkMcUsd?usdUnits(order.highWatermarkMcUsd):p;order.highWatermarkMcUsd=unitsUsd(p>high?p:high);
  return p*10000n<=usdUnits(order.highWatermarkMcUsd)*BigInt(10000-s.trailingBps!);
}
export function executionSpec(order:ProOrder,attempt:ProAttempt):ProSpec {
  return attempt.inputRaw?{...order.spec,kind:'MARKET',amountRaw:attempt.inputRaw,steps:undefined}:order.spec;
}
export function settleStrategy(order:ProOrder,attempt:ProAttempt):void {
  initStrategy(order);const state=order.strategy!.steps.find(s=>s.id===attempt.strategyStepId);
  if(!state||state.state==='FINALIZED')return;
  state.state='FINALIZED';state.amountRaw=attempt.inputRaw;
  order.strategy!.remainingRaw=String(BigInt(order.strategy!.remainingRaw)-BigInt(attempt.inputRaw!));
  if(BigInt(order.strategy!.remainingRaw)===0n)for(const s of order.strategy!.steps)if(s.state==='OPEN')s.state='CANCELLED';
}
export function hasProtection(spec:ProSpec):boolean{return !!(spec.exit||spec.exitStrategy);}

export function orderTriggered(order:ProOrder,o:Observation):boolean {
    if(order.spec.version===2)return mcTriggered(order,o);
    const p = usdUnits(o.priceUsd), s = order.spec;
    order.currentPriceUsd = o.priceUsd;
    if (s.kind === 'MARKET')
        return true;
    if (s.kind === 'LIMIT')
        return s.side === 'BUY' ? p <= usdUnits(s.triggerPriceUsd!) : p >= usdUnits(s.triggerPriceUsd!);
    if (s.kind === 'BRACKET')
        return p >= usdUnits(s.tpPriceUsd!) || p <= usdUnits(s.slPriceUsd!);
    if (!order.trailActive && (!s.activationPriceUsd || p >= usdUnits(s.activationPriceUsd)))
        order.trailActive = true;
    if (!order.trailActive)
        return false;
    const high = order.highWatermark ? usdUnits(order.highWatermark) : p;
    order.highWatermark = unitsUsd(p > high ? p : high);
    return p * 10000n <= usdUnits(order.highWatermark) * BigInt(10000 - s.trailingBps!);
}

export function deriveExitSpec(parent: ProOrder, receivedRaw: string, fillPriceUsd: string, tokenDecimals: number, confirmedAt = Date.now()): ProSpec {
    if (!Number.isSafeInteger(confirmedAt) || confirmedAt <= 0 || confirmedAt > Date.now() + 1000) throw new Error('Confirmed fill timestamp is unavailable.');
    if(parent.spec.exitStrategy){const spec:ProSpec={...parent.spec,kind:"STRATEGY",side:"SELL",amountRaw:receivedRaw,decimals:tokenDecimals,expiresAt:confirmedAt+parent.spec.exitStrategy.durationMs,steps:parent.spec.exitStrategy.steps};delete spec.exitStrategy;delete spec.triggerMcUsd;return validateProSpec(spec);}
    const exit = parent.spec.exit;
    if (!exit)
        throw new Error('Parent has no protection.');
    const p = usdUnits(fillPriceUsd);
    const spec: ProSpec = { ...parent.spec, kind: 'BRACKET', side: 'SELL', amountRaw: receivedRaw, decimals: tokenDecimals, expiresAt: confirmedAt + (exit.durationMs ?? 86400000), slippageBps: exit.slippageBps, tpPriceUsd: unitsUsd(p * BigInt(10000 + exit.tpBps) / 10000n), slPriceUsd: unitsUsd(p * BigInt(10000 - exit.slBps) / 10000n) };
    delete spec.exit;
    delete spec.triggerPriceUsd;
    return validateProSpec(spec);
}
