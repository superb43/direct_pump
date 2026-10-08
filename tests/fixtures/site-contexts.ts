import type { MarketHint, PageTarget, SiteId } from '../../src/model';

export const TEST_MINT = 'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP';
export const TEST_POOL = 'AG1EhPjsBrkxQWkViuLXF6pQnHwfr9f9sdNneeoykcEJ';
export const SITE_CONTEXTS: { site: SiteId; target: PageTarget; source: MarketHint['source'] }[] = [
  { site: 'GMGN', target: { site: 'GMGN', kind: 'MINT', address: TEST_MINT, pageUrl: `https://gmgn.ai/sol/token/${TEST_MINT}` }, source: 'GMGN page' },
  { site: 'AXIOM', target: { site: 'AXIOM', kind: 'POOL', address: TEST_POOL, mintHint: TEST_MINT, pageUrl: `https://axiom.trade/meme/${TEST_POOL}?chain=sol` }, source: 'Axiom page' },
  { site: 'FOMO', target: { site: 'FOMO', kind: 'MINT', address: TEST_MINT, pageUrl: `https://fomo.family/tokens/solana/${TEST_MINT}` }, source: 'FOMO page' },
];
