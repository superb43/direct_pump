import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPageContextReader, CONTEXT_SAMPLE_MS } from '../../src/page-context';
import { SITE_CONTEXTS } from '../fixtures/site-contexts';

afterEach(() => { vi.useRealTimers(); });
describe.each(SITE_CONTEXTS)('$site context observation contract', ({target,source}) => {
  it('shares an observation, resamples for freshness and invalidates changed DOM', () => {
    vi.useFakeTimers();
    const hints=vi.fn(()=>({mintHint:target.mintHint,market:{mint:target.mintHint??target.address,priceUsd:'0.1',source,observedAt:Date.now()}}));
    const reader=createPageContextReader(()=>target.pageUrl,hints);
    const first=reader.read();reader.read();reader.read();
    expect(hints).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(CONTEXT_SAMPLE_MS);
    expect(reader.read().market!.observedAt).toBeGreaterThan(first.market!.observedAt);
    expect(hints).toHaveBeenCalledTimes(2);
    reader.invalidate();reader.read();expect(hints).toHaveBeenCalledTimes(3);
  });
  it('clears unsupported navigation and rejects a price for another mint', () => {
    let url=target.pageUrl;
    const reader=createPageContextReader(()=>url,()=>({mintHint:target.mintHint,market:{mint:'wrong-mint',priceUsd:'1',source,observedAt:Date.now()}}));
    expect(reader.read().market).toBeUndefined();
    url='https://unsupported.test/';expect(reader.read()).toEqual({target:null,market:undefined});
  });
  it('forces a fresh observation before relaying an execution request', () => {
    const hints=vi.fn(()=>({mintHint:target.mintHint}));
    const reader=createPageContextReader(()=>target.pageUrl,hints);
    reader.read();reader.read(true);expect(hints).toHaveBeenCalledTimes(2);
  });
});
