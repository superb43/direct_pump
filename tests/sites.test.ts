import { describe, expect, it } from 'vitest';
import { detectPage, sameTarget, targetKey, pageKey, SITE_MATCHES, SITE_LABELS, SITE_CATALOG, isUnsupportedChainTokenPage } from '../src/sites/catalog';
import { readPageHints } from '../src/adapters';
import { decimalText } from '../src/market';
import { SITE_READERS } from '../src/sites/reader';
import { SITE_CONTEXTS } from './fixtures/site-contexts';
const mint = 'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP';
const pool = 'AG1EhPjsBrkxQWkViuLXF6pQnHwfr9f9sdNneeoykcEJ';

// Scoped structural DOM contract; real HTML fixtures run through Brave DOMParser.
function gmgnDocument(labels: unknown[], headerMint = mint): Document {
  const link = { getAttribute: () => `https://solscan.io/token/${headerMint}` };
  const header = { querySelectorAll: (selector: string) => selector.includes('solscan') ? [link] : [], parentElement: null };
  const item = { matches: () => true, parentElement: header, querySelectorAll: (selector: string) => selector.includes('solscan') ? [] : labels };
  return { querySelector: () => null, querySelectorAll: (selector: string) => selector.includes('InfoItem') ? [item] : [] } as unknown as Document;
}

describe('three-site contracts', () => {
  it.each([
    'https://fomo.family/tokens/robinhood/0x98096d17e191b3da1d5f99a6d7b3584351b11e18',
    'https://gmgn.ai/eth/token/0x98096d17e191b3da1d5f99a6d7b3584351b11e18',
    ...SITE_CONTEXTS.map(({target}) => `${target.pageUrl.split('?')[0]}?chain=eth`),
  ])('classifies unsupported token chains without granting trading: %s', url => {
    expect(isUnsupportedChainTokenPage(url)).toBe(true);
    expect(detectPage(url)).toBeNull();
  });
  it.each([
    ...SITE_CONTEXTS.map(({target}) => target.pageUrl),
    'https://fomo.family', 'https://fomo.family/tokens/robinhood',
    'https://fomo.family/tokens/solana/invalid',
    'https://example.com/tokens/robinhood/token',
    'https://fomo.family.evil/tokens/robinhood/token',
    'http://fomo.family/tokens/robinhood/token',
    'https://fomo.family:444/tokens/robinhood/token',
    'https://user:pass@fomo.family/tokens/robinhood/token',
    'not a URL',
  ])('keeps supported, missing or untrusted routes out of the chain notice: %s', url => {
    expect(isUnsupportedChainTokenPage(url)).toBe(false);
  });
  it.each(SITE_CONTEXTS)('$site catalog is exhaustive and drives its URL, labels, permissions and market source', ({ site, target, source }) => {
    const definition = SITE_CATALOG[site];
    expect(Object.keys(SITE_CATALOG).sort()).toEqual(SITE_CONTEXTS.map(context => context.site).sort());
    expect(Object.keys(SITE_READERS).sort()).toEqual(Object.keys(SITE_CATALOG).sort());
    expect(detectPage(target.pageUrl)).toMatchObject({ site, kind: target.kind, address: target.address });
    expect(definition.parsePath(new URL(target.pageUrl).pathname)).toBe(target.address);
    expect(definition.parsePath('/unrelated')).toBeUndefined();
    expect(definition.marketSource).toBe(source);
    expect(SITE_LABELS[site]).toBe(definition.label);
    expect(SITE_MATCHES).toContain(`https://${definition.host}/*`);
    for (const url of [target.pageUrl.replace('https:', 'http:'), target.pageUrl.replace(definition.host, `${definition.host}.evil`), `${target.pageUrl.split('?')[0]}?chain=eth`]) expect(detectPage(url)).toBeNull();
  });
  it('parses GMGN prefixed addresses while rejecting extra path segments and invalid addresses', () => {
    expect(detectPage(`https://gmgn.ai/sol/token/prefix_${mint}/`)).toMatchObject({ address: mint });
    for (const { target } of SITE_CONTEXTS) {
      expect(detectPage(target.pageUrl.replace(target.address, 'invalid'))).toBeNull();
      expect(detectPage(target.pageUrl.split('?')[0] + '/extra')).toBeNull();
    }
  });
  it('rejects conflicting price and mint identity in a scoped GMGN header', () => {
    const labels = ['0.015', '2.5'].map(price => ({ textContent: 'Price', childElementCount: 0, nextElementSibling: { textContent: `$${price}` } }));
    const target = SITE_CONTEXTS[0]!.target;
    expect(readPageHints(gmgnDocument(labels), target).market).toBeUndefined();
    expect(readPageHints(gmgnDocument(labels, pool), target)).toEqual({});
  });
  it('supports FOMO Solana tokens and exactly three HTTPS hosts', () => {
    expect(detectPage(`https://fomo.family/tokens/solana/${mint}`)).toMatchObject({ site: 'FOMO', address: mint, kind: 'MINT' });
    expect(SITE_MATCHES).toEqual(['https://gmgn.ai/*', 'https://axiom.trade/*', 'https://fomo.family/*']);
    expect(SITE_LABELS.FOMO).toBe('FOMO Family');
    for (const url of [`http://fomo.family/tokens/solana/${mint}`, `https://fomo.family.evil/tokens/solana/${mint}`, `https://fomo.family/tokens/ethereum/${mint}`, `https://fomo.family/tokens/solana/${mint}?chain=eth`, `https://fomo.family:444/tokens/solana/${mint}`, `https://user:pass@fomo.family/tokens/solana/${mint}`]) expect(detectPage(url)).toBeNull();
  });
  it('keeps page identity stable while separating enriched context cache keys', () => {
    const page = detectPage(`https://axiom.trade/meme/${pool}?chain=sol`)!;
    expect(sameTarget(page, { ...page, mintHint: mint })).toBe(true);
    expect(pageKey(page)).toBe(pageKey({ ...page, mintHint: mint, poolHint: pool }));
    expect(pageKey(page)).not.toBe(pageKey({ ...page, address: mint }));
    expect(sameTarget(null, page)).toBe(false);
    expect(targetKey(page)).not.toBe(targetKey({ ...page, mintHint: mint }));
    expect(targetKey(page)).not.toBe(targetKey({ ...page, poolHint: pool }));
  });
  it('returns no hints from an unavailable document, preserving quote fallback', () => {
    expect(readPageHints({} as Document, detectPage(`https://fomo.family/tokens/solana/${mint}`)!)).toEqual({});
  });
  it('rejects GMGN labels without a matching scoped token header', () => {
    const labels = ['0.015', '2.5'].map(price => ({ textContent: 'Price', childElementCount: 0, nextElementSibling: { textContent: `$${price}` } }));
    const document = { querySelector: () => null, querySelectorAll: () => labels } as unknown as Document;
    expect(readPageHints(document, detectPage(`https://gmgn.ai/sol/token/${mint}`)!).market).toBeUndefined();
  });
  it('preserves exact compact decimals and rejects unbounded zero counts', () => {
    expect(decimalText('$0.0₄2')).toBe('0.00002');
    expect(decimalText('$0.0₉₉2')).toBeUndefined();
  });
  it('keeps Axiom mint identity without using arbitrary dollar text as price', () => {
    const link = { getAttribute: () => `https://solscan.io/token/${mint}` };
    const outer = { querySelectorAll: () => [], parentElement: null };
    const header = { querySelectorAll: (selector: string) => selector.includes('solscan') ? [link] : [{textContent:'$123',childElementCount:0}], parentElement: outer };
    const pair = { querySelectorAll: () => [], parentElement: header };
    const document = {querySelector: () => pair, querySelectorAll: () => []} as unknown as Document;
    expect(readPageHints(document, detectPage(`https://axiom.trade/meme/${pool}`)!)).toEqual({mintHint:mint});
  });
  it('does not convert Axiom market cap into token price', () => {
    const link = { getAttribute: () => `https://solscan.io/token/${mint}` };
    const label = {textContent:'Market cap',childElementCount:0,nextElementSibling:{textContent:'$20K'}};
    const header = { querySelectorAll: (selector: string) => selector.includes('solscan') ? [link] : [label], parentElement: null };
    const pair = { querySelectorAll: () => [], parentElement: header };
    const document = {querySelector: () => pair, querySelectorAll: () => []} as unknown as Document;
    expect(readPageHints(document, detectPage(`https://axiom.trade/meme/${pool}`)!).market).toMatchObject({mint,marketCapUsd:'20000',priceUsd:undefined});
  });
  it('ignores hidden compact zero digits in labeled price values', () => {
    const text = (value:string) => ({nodeType:3,textContent:value});
    const sub = (hidden:boolean,value:string) => ({nodeType:1,tagName:'SUB',matches:()=>hidden,getAttribute:()=>null,childNodes:[text(value)]});
    const value = {childNodes:[text('$0.0'),sub(true,'9'),sub(false,'4'),text('2')]};
    const label = {textContent:'Price',childElementCount:0,nextElementSibling:value};
    const document = gmgnDocument([label]);
    expect(readPageHints(document,detectPage(`https://gmgn.ai/sol/token/${mint}`)!).market?.priceUsd).toBe('0.00002');
  });

  it('rejects ambiguous Axiom header mints before reading a price', () => {
    const links = [mint, pool].map(address => ({ getAttribute: () => `https://solscan.io/token/${address}` }));
    const price = { textContent: 'Price', childElementCount: 0, nextElementSibling: { textContent: '$123' } };
    const header = { querySelectorAll: (selector: string) => selector.includes('solscan') ? links : [price], parentElement: null };
    const pair = { querySelectorAll: () => [], parentElement: header };
    const document = { querySelector: () => pair, querySelectorAll: () => [] } as unknown as Document;
    expect(readPageHints(document, SITE_CONTEXTS[1]!.target)).toEqual({});
  });
  it('scopes FOMO market values to its token header and rejects duplicate or stale identities', () => {
    const label = (name: string, value: string) => ({ textContent: name, childElementCount: 0, nextElementSibling: { textContent: value } });
    const header = { querySelectorAll: () => [label('Price', '$0.00002'), label('Market cap', '$20K')], parentElement: null };
    const identity = { textContent: `${mint.slice(0, 6)}...${mint.slice(-6)}`, childElementCount: 0, parentElement: header };
    let identities = [identity];
    const container = { querySelectorAll: () => identities };
    const document = { querySelector: () => null, querySelectorAll: (selector: string) => selector.includes('@container/token') ? [container] : [label('Price', '$123')] } as unknown as Document;
    const target = SITE_CONTEXTS[2]!.target;
    expect(readPageHints(document, target).market).toMatchObject({ mint, priceUsd: '0.00002', marketCapUsd: '20000', source: 'FOMO page' });
    identities = [identity, { ...identity, parentElement: { ...header } }];
    expect(readPageHints(document, target)).toEqual({});
    identities = [{ ...identity, textContent: `${pool.slice(0, 6)}...${pool.slice(-6)}` }];
    expect(readPageHints(document, target)).toEqual({});
  });

  it('scopes GMGN cap to icon-decorated Basic Data and rejects stale header mint', () => {
    let headerMint = mint;
    const link = { getAttribute: () => `https://solscan.io/token/${headerMint}` };
    const header = { querySelectorAll: (selector:string) => selector.includes('solscan') ? [link] : [], parentElement:null };
    const price = {textContent:'Price',childElementCount:0,nextElementSibling:{textContent:'$0.015'}};
    const item = {matches:()=>true,parentElement:header,querySelectorAll:(selector:string)=>selector.includes('solscan')?[]:[price]};
    const cap = {textContent:'Market cap',childElementCount:0,nextElementSibling:{textContent:'$15M'}};
    const basic = {querySelector:()=>({}),querySelectorAll:()=>[cap],parentElement:null};
    const title = {textContent:'Basic Data\uE185',childElementCount:1,parentElement:basic};
    const document = {createElement:()=>({}),querySelector:()=>null,querySelectorAll:(selector:string)=>selector.includes('InfoItem')?[item]:selector==='span,dt,label,div,p,strong,b'?[title]:[]} as unknown as Document;
    const target = detectPage(`https://gmgn.ai/sol/token/${mint}`)!;
    expect(readPageHints(document,target).market).toMatchObject({priceUsd:'0.015',marketCapUsd:'15000000'});
    headerMint=pool;
    expect(readPageHints(document,target)).toEqual({});
  });

});
