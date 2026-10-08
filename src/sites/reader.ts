import type { MarketHint, PageTarget, SiteId } from '../model';
import { SITE_CATALOG } from './catalog';
import { gmgnHints } from './gmgn';
import { axiomHints } from './axiom';
import { fomoHints } from './fomo';

export type PageHints = { mintHint?: string; poolHint?: string; market?: MarketHint };
export type SiteValues = Pick<PageHints, 'mintHint' | 'poolHint'> & Pick<MarketHint, 'priceUsd' | 'marketCapUsd'>;
export type SiteReader = (document: Document, target: PageTarget) => SiteValues;
export const SITE_READERS: Record<SiteId, SiteReader> = { GMGN: gmgnHints, AXIOM: axiomHints, FOMO: fomoHints };

export function readPageHints(document: Document, target: PageTarget): PageHints {
  if (typeof document.querySelector !== 'function' || typeof document.querySelectorAll !== 'function') return {};
  const values = SITE_READERS[target.site](document, target);
  const mint = target.kind === 'MINT' ? target.address : values.mintHint;
  const market = mint && (values.priceUsd || values.marketCapUsd)
    ? { mint, observedAt: Date.now(), source: SITE_CATALOG[target.site].marketSource, priceUsd: values.priceUsd, marketCapUsd: values.marketCapUsd } : undefined;
  return { ...('mintHint' in values ? { mintHint: values.mintHint } : {}), ...('poolHint' in values ? { poolHint: values.poolHint } : {}), ...(market ? { market } : {}) };
}

export function readLiveMarket(document: Document, target: PageTarget | null): MarketHint | undefined {
  return target ? readPageHints(document, target).market : undefined;
}
