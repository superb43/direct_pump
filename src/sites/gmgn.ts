import type { PageTarget } from '../model';
import type { SiteValues } from './reader';
import { LABELS, unique, labeledValues, tokenMints, readPoolHint } from './dom';
import { decimalText } from './decimal';

export function gmgnHints(document: Document, target: PageTarget): SiteValues {
  const items = [...document.querySelectorAll<HTMLElement>('[data-sentry-component="InfoItem"], [class*="InfoItem"]')]
    .filter(element => element.matches?.('[data-sentry-component="InfoItem"], [class*="InfoItem"]'))
    .filter(element => {
      let region: HTMLElement | null = element;
      for (let depth = 0; region && depth < 6; depth++, region = region.parentElement) {
        const mints = tokenMints(region);
        if (mints.length) return unique(mints) === target.address;
      }
      return false;
    });
  // Missing or stale token identity means no real-DOM hints can be trusted.
  if (!items.length) return {};
  const values = items.map(labeledValues);
  const basics: ParentNode[] = [...document.querySelectorAll<HTMLElement>('[data-sentry-component="BasicData"], [class*="BasicData"]')]
    .filter(element => element.matches?.('[data-sentry-component="BasicData"], [class*="BasicData"]'));
  for (const label of document.querySelectorAll<HTMLElement>(LABELS)) {
    const title = (label.textContent ?? '').replace(/[\uE000-\uF8FF]/g, '').trim();
    if (label.childElementCount > 1 || !/^basic data$/i.test(title)) continue;
    let region = label.parentElement;
    for (let depth = 0; region && depth < 3; depth++, region = region.parentElement) {
      if (region.querySelector('[data-sentry-component="PoolItem"]')) { basics.push(region); break; }
    }
  }
  const dataPrice = document.querySelector<HTMLElement>('[data-price-usd]')?.dataset?.priceUsd;
  const dataCap = document.querySelector<HTMLElement>('[data-market-cap-usd]')?.dataset?.marketCapUsd;
  return {
    poolHint: readPoolHint(document),
    priceUsd: unique([...values.flatMap(value => value.priceUsd ? [value.priceUsd] : []), ...(dataPrice && decimalText(dataPrice) ? [decimalText(dataPrice)!] : [])]),
    marketCapUsd: unique([...values, ...basics.map(labeledValues)].flatMap(value => value.marketCapUsd ? [value.marketCapUsd] : []).concat(dataCap && decimalText(dataCap) ? [decimalText(dataCap)!] : [])),
  };
}

