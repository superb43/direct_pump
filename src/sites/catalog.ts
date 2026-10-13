import type { MarketHint, PageTarget, SiteId } from '../model';

export const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
type SiteDefinition = {
  host: string;
  label: string;
  marketSource: MarketHint['source'];
  kind: PageTarget['kind'];
  parsePath: (path: string) => string | undefined;
  tokenChain: (url: URL) => string | undefined;
};

export const SITE_CATALOG: Record<SiteId, SiteDefinition> = {
  GMGN: {
    host: 'gmgn.ai', label: 'GMGN', marketSource: 'GMGN page', kind: 'MINT',
    parsePath: path => /^\/sol\/token\/([^/]+)\/?$/.exec(path)?.[1]?.split('_').at(-1),
    tokenChain: url => /^\/([a-z0-9-]+)\/token\/[^/]+\/?$/.exec(url.pathname)?.[1],
  },
  AXIOM: {
    host: 'axiom.trade', label: 'Axiom', marketSource: 'Axiom page', kind: 'POOL',
    parsePath: path => /^\/meme\/([^/]+)\/?$/.exec(path)?.[1],
    tokenChain: url => /^\/meme\/[^/]+\/?$/.test(url.pathname) ? 'sol' : undefined,
  },
  FOMO: {
    host: 'fomo.family', label: 'FOMO Family', marketSource: 'FOMO page', kind: 'MINT',
    parsePath: path => /^\/tokens\/solana\/([^/]+)\/?$/.exec(path)?.[1],
    tokenChain: url => /^\/tokens\/([a-z0-9-]+)\/[^/]+\/?$/.exec(url.pathname)?.[1],
  },
};
const entries = Object.entries(SITE_CATALOG) as [SiteId, SiteDefinition][];
export const SITE_MATCHES = entries.map(([, definition]) => `https://${definition.host}/*`);
export const SITE_LABELS = Object.fromEntries(entries.map(([site, definition]) => [site, definition.label])) as Record<SiteId, string>;

export function detectPage(value: string): PageTarget | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  const chain = url.searchParams.get('chain');
  if (chain && !['sol', 'solana'].includes(chain.toLowerCase())) return null;
  const entry = entries.find(([, definition]) => definition.host === url.hostname);
  if (!entry) return null;
  const [site, definition] = entry;
  const address = definition.parsePath(url.pathname);
  return address && ADDRESS.test(address) ? { site, kind: definition.kind, address, pageUrl: url.href } : null;
}

/** Display-only classification; never grants a trading target. */
export function isUnsupportedChainTokenPage(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  const definition = entries.find(([, site]) => site.host === url.hostname)?.[1];
  const pathChain = definition?.tokenChain(url);
  if (!pathChain) return false;
  const queryChain = url.searchParams.get('chain');
  return [pathChain, queryChain].some(chain => !!chain && !['sol', 'solana'].includes(chain.toLowerCase()));
}

export function pageKey(target: PageTarget): string {
  return [target.site, target.kind, target.address].join(':');
}

export function sameTarget(a: PageTarget | null, b: PageTarget | null): boolean {
  return !!a && !!b && pageKey(a) === pageKey(b);
}

export function assertPageTarget(target: PageTarget, currentUrl: string): void {
  if (!sameTarget(target, detectPage(currentUrl))) throw new Error('The token changed. Submit from the current token page.');
}

/** Execution/cache identity also pins discovered mint and pool hints. */
export function targetKey(target: PageTarget): string {
  return [pageKey(target), target.mintHint ?? '', target.poolHint ?? ''].join(':');
}
