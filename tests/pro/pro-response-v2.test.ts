import { describe, expect, it, vi } from 'vitest';
vi.mock('wxt/browser', () => ({ browser: {} }));
import { validateProData } from '../../src/pro/client';
import type { ProOrder, ProSpecV2 } from '../../src/pro/contracts';

const mint='DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP';
const spec=():ProSpecV2=>({version:2,basis:'MC',kind:'LIMIT',side:'BUY',target:{site:'GMGN',kind:'MINT',address:mint,pageUrl:`https://gmgn.ai/sol/token/${mint}`},mint,amountRaw:'10000000',decimals:9,expiresAt:Date.now()+3600000,slippageBps:100,priorityFeeLamports:100000,maxNetworkLamports:'5000000',triggerMcUsd:'250000'});
const summary=()=>({marketCapUsd:'420000',priceUsd:'0.00042',supplyRaw:'1000000000000000',tokenDecimals:6,quoteAt:Date.now(),outputRaw:'2857142857',networkBudgetRaw:'5000000'});
describe('authenticated MC response validation',()=>{
  it('accepts coherent quote and actual supply rather than assuming a billion tokens',()=>{
    expect(()=>validateProData('/v2/preview',{spec:spec(),summary:summary()})).not.toThrow();
    expect(()=>validateProData('/v2/preview',{spec:spec(),summary:{...summary(),supplyRaw:'2000000000000000',marketCapUsd:'840000'}})).not.toThrow();
  });
  it('rejects substituted MC, missing supply, invalid output and an incompatible spec',()=>{
    for(const changed of [{marketCapUsd:'250000'},{supplyRaw:'0'},{tokenDecimals:99},{outputRaw:'-1'},{quoteAt:'now'}])expect(()=>validateProData('/v2/preview',{spec:spec(),summary:{...summary(),...changed}})).toThrow();
    expect(()=>validateProData('/v2/preview',{spec:{...spec(),version:undefined,basis:undefined},summary:summary()})).toThrow();
  });
  it('validates public group inventory and step identities before rendering',()=>{
    const id='123e4567-e89b-42d3-a456-426614174000',stepId='123e4567-e89b-42d3-a456-426614174001';
    const order:ProOrder={id,revision:1,spec:{...spec(),kind:'STRATEGY',side:'SELL',decimals:6,triggerMcUsd:undefined,steps:[{id:stepId,kind:'TAKE_PROFIT',targetMcUsd:'500000',portionBps:2500}]},wallet:mint,state:'OPEN',createdAt:Date.now(),updatedAt:Date.now(),currentMcUsd:'420000',strategy:{baseRaw:'10000000',remainingRaw:'7500000',steps:[{id:stepId,state:'FINALIZED',amountRaw:'2500000'}]}};
    expect(()=>validateProData('/v2/orders',[order])).not.toThrow();
    expect(()=>validateProData('/v2/strategies',[{...order,strategy:{...order.strategy,remainingRaw:'10000001'}}])).toThrow();
    expect(()=>validateProData(`/v2/orders/${id}`,[{...order,strategy:{...order.strategy,steps:[{id,state:'OPEN'}]}}])).toThrow();
    expect(()=>validateProData('/v2/orders',[{...order,currentMcUsd:'NaN'}])).toThrow();
  });
});
