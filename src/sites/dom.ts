import type { MarketHint } from '../model';
import { ADDRESS } from './catalog';
import { decimalText } from './decimal';
export const LABELS = 'span,dt,label,div,p,strong,b';

export function unique<T>(values: Iterable<T>): T | undefined {
  const candidates = new Set(values);
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

/** Preserve compact zero notation rendered as a regular digit inside <sub>. */
export function visibleText(element: Element): string {
  if (element.matches?.('[hidden], [aria-hidden="true"]') || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(element.getAttribute?.('style') ?? '')) return '';
  if (!element.childNodes) return element.textContent ?? '';
  return [...element.childNodes].map(node => {
    if (node.nodeType !== 1) return node.textContent ?? '';
    const child = node as Element;
    const text = visibleText(child);
    return child.tagName.toLowerCase() === 'sub' && /^\d+$/.test(text)
      ? [...text].map(digit => '₀₁₂₃₄₅₆₇₈₉'[Number(digit)]).join('') : text;
  }).join('');
}

export function dollarValue(element: Element | null | undefined): string | undefined {
  if (!element) return;
  const text = visibleText(element).trim();
  if (text.length > 160 || (text.match(/\$/g) ?? []).length !== 1) return;
  const match = /\$\s*[\d,]+(?:\.[\d₀-₉]+)?(?:[kmb])?/i.exec(text);
  return match ? decimalText(match[0]) : undefined;
}

export function labeledValues(root: ParentNode): Pick<MarketHint, 'priceUsd' | 'marketCapUsd'> {
  const price: string[] = [], cap: string[] = [];
  for (const label of root.querySelectorAll<HTMLElement>(LABELS)) {
    if (label.childElementCount > 1 || label.closest?.('[hidden], [aria-hidden="true"]')) continue;
    const name = (label.textContent?.trim() ?? '').replace(/[:：]$/, '').trim();
    const values = /^(price|가격)$/i.test(name) ? price : /^(mc|market cap|시가총액)$/i.test(name) ? cap : undefined;
    if (!values) continue;
    const value = dollarValue(label.nextElementSibling) ?? dollarValue(label.parentElement?.nextElementSibling) ?? dollarValue(label.parentElement);
    if (value) values.push(value);
  }
  return { priceUsd: unique(price), marketCapUsd: unique(cap) };
}

export function linkAddress(link: HTMLAnchorElement, kind: 'token' | 'account'): string | undefined {
  try {
    const url = new URL(link.getAttribute('href') ?? '', 'https://solscan.io');
    if (url.protocol !== 'https:' || url.hostname !== 'solscan.io') return;
    const address = new RegExp(`^/${kind}/([^/]+)/?$`).exec(url.pathname)?.[1];
    return address && ADDRESS.test(address) ? address : undefined;
  } catch { return; }
}

export function readPoolHint(document: Document): string | undefined {
  if (typeof document.querySelectorAll !== 'function') return;
  const candidates: string[] = [];
  for (const element of document.querySelectorAll<HTMLElement>('[data-pool-address]')) {
    const address = element.dataset?.poolAddress;
    if (address && ADDRESS.test(address)) candidates.push(address);
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="solscan.io/account/"]')) {
    const region = link.closest?.('[data-sentry-component="PoolInfoTitle"]') ?? link.closest?.('[class*="PoolInfo"]') ?? link.closest?.('div');
    const label = region?.textContent ?? '';
    if (label.length > 250 || !/\b(pool|pair)\b/i.test(label)) continue;
    const address = linkAddress(link, 'account');
    if (address) candidates.push(address);
  }
  return unique(candidates);
}

export function tokenMints(region: ParentNode): string[] {
  return [...region.querySelectorAll<HTMLAnchorElement>('a[href*="solscan.io/token/"]')]
    .flatMap(link => { const mint = linkAddress(link, 'token'); return mint ? [mint] : []; });
}

