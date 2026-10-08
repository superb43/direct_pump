import type { PageTarget } from '../model';
import type { SiteValues } from './reader';
import { unique, labeledValues } from './dom';

export function fomoHints(document: Document, target: PageTarget): SiteValues {
  const abbreviation = `${target.address.slice(0, 6)}...${target.address.slice(-6)}`;
  const containers = [...document.querySelectorAll<HTMLElement>('[class~="@container/token"]')];
  const matches: HTMLElement[] = [];
  for (const container of containers) {
    for (const element of container.querySelectorAll<HTMLElement>('span,div,p,a,button')) {
      const text = (element.textContent ?? '').replace(/…/g, '...').replace(/\s/g, '');
      if (element.childElementCount || text !== abbreviation) continue;
      let region = element.parentElement;
      for (let depth = 0; region && region !== container && depth < 5; depth++, region = region.parentElement) {
        const values = labeledValues(region);
        if (values.priceUsd || values.marketCapUsd) { matches.push(region); break; }
      }
    }
  }
  // More than one header for this address is ambiguous during navigation/rendering.
  const header = unique(matches);
  return header ? labeledValues(header) : {};
}

