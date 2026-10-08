import type { MarketHint, PageContext, PageTarget } from './model';
import { detectPage } from './sites/catalog';

type Hints = Pick<PageTarget, 'mintHint' | 'poolHint'> & { market?: MarketHint };
export const CONTEXT_SAMPLE_MS = 5_000;

/** Own one DOM observation; lightweight URL polling does not rescan the page. */
export function createPageContextReader(url: () => string, hints: (target: PageTarget) => Hints) {
  let context: PageContext = { target: null };
  let lastUrl = '', sampledAt = 0, dirty = true;
  function read(force = false): PageContext {
    const currentUrl = url();
    if (!force && !dirty && currentUrl === lastUrl && Date.now() - sampledAt < CONTEXT_SAMPLE_MS) return context;
    const page = detectPage(currentUrl);
    const observation = page ? hints(page) : {};
    const target = page ? { ...page, mintHint: observation.mintHint, poolHint: observation.poolHint } : null;
    const mint = target?.kind === 'MINT' ? target.address : target?.mintHint;
    context = { target, market: observation.market?.mint === mint ? observation.market : undefined };
    lastUrl = currentUrl; sampledAt = Date.now(); dirty = false;
    return context;
  }
  return { read, invalidate: () => { dirty = true; } };
}
