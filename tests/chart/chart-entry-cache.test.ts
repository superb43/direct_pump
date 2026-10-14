import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createChartEntryCache } from '../../src/chart/chart-entry-cache';
import { overlayCommand } from '../../src/chart/chart-overlay-contract';
import type { Receipt } from '../../src/model';
import { SITE_CONTEXTS } from '../fixtures/site-contexts';

beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(100_000);});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function fixture(){
  const cache=createChartEntryCache();
  const position={wallet:'wallet',mint:SITE_CONTEXTS[0]!.target.address,balanceRaw:'10',supplyRaw:'1000',decimals:0,updatedAt:Date.now()};
  const receipt={wallet:position.wallet,mint:position.mint,side:'BUY',status:'CONFIRMED',createdAt:1,
    feeReceipt:{state:'VERIFIED',executionSucceeded:true,zeroExtraFeesVerified:true,tokenBeforeRaw:'0',tokenAfterRaw:'10',volumeLamports:'1000000000',usd:{priceMicros:'100000000'},slot:777}} as Receipt;
  const input={scope:'rpc+target',position,receipts:[receipt],minContextSlot:777,inventory:{balanceRaw:'10',slot:777,verifiedAt:100_000}};
  return {cache,input,receipt};
}
it('publishes from confirmed known-account balances immediately without an inventory request',()=>{
  const {cache,input}=fixture();
  expect(cache.project(input).entry).toMatchObject({priceUsd:'10.000000000000',updatedAt:100_000,validUntil:130_000});
});
it('never renews old evidence when reusing a balance or recomputing receipt costs',()=>{
  const {cache,input,receipt}=fixture();cache.project(input);vi.setSystemTime(129_999);
  expect(cache.project(input).entry?.validUntil).toBe(130_000);
  const changed={...receipt,feeReceipt:{...receipt.feeReceipt!,usd:{...receipt.feeReceipt!.usd!,priceMicros:'200000000'}}};
  expect(cache.project({...input,receipts:[changed]}).entry).toMatchObject({priceUsd:'20.000000000000',updatedAt:100_000});
  vi.setSystemTime(130_000);expect(cache.project(input).entry).toBeUndefined();expect(cache.current(input.scope,input.position).note).toContain('expired');
  expect(cache.project({...input,inventory:{...input.inventory,verifiedAt:130_000}}).entry?.validUntil).toBe(160_000);
});
it('discards evidence on quantity, supply, wallet or context changes and rejects incomplete recorded costs',()=>{
  const {cache,input}=fixture();cache.project(input);
  for(const position of [{...input.position,balanceRaw:'5'},{...input.position,supplyRaw:'2000'},{...input.position,wallet:'other'}])expect(cache.current(input.scope,position).entry).toBeUndefined();
  expect(cache.current('different-context',input.position).entry).toBeUndefined();
  expect(cache.project({...input,position:{...input.position,balanceRaw:'5'},inventory:{...input.inventory,balanceRaw:'5'}}).entry).toBeUndefined();
});
it('rejects stale slot, mismatched quantity, invalid time and confirmed receipt changes',()=>{
  const {cache,input}=fixture();
  for(const inventory of [{...input.inventory,slot:776},{...input.inventory,balanceRaw:'11'},{...input.inventory,verifiedAt:100_001},{...input.inventory,verifiedAt:NaN}]){
    cache.project(input);expect(cache.project({...input,inventory}).entry).toBeUndefined();expect(cache.current(input.scope,input.position).entry).toBeUndefined();
  }
});
it('clears wallet-wide unresolved transactions and explicit invalidations',()=>{
  const {cache,input}=fixture();cache.project(input);
  expect(cache.project({...input,blocked:true}).note).toContain('unresolved');expect(cache.current(input.scope,input.position).entry).toBeUndefined();
  cache.project(input);cache.invalidatePosition(input.scope,input.position.wallet,input.position.mint);expect(cache.current(input.scope,input.position).entry).toBeUndefined();
  cache.project(input);cache.invalidateWallet(input.position.wallet);expect(cache.current(input.scope,input.position).entry).toBeUndefined();
});
it.each(SITE_CONTEXTS)('$site bounds relay renewal to the original balance snapshot expiry',({target})=>{
  const {cache,input}=fixture();input.position.mint=target.mintHint??target.address;input.receipts[0]!.mint=input.position.mint;
  const entry=cache.project(input).entry!;
  vi.setSystemTime(129_000);expect(overlayCommand(target,entry).expiresAt).toBe(130_000);
  vi.setSystemTime(130_000);expect(overlayCommand(target,entry).entry).toBeNull();
});
