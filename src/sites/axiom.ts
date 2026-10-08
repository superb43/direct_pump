import type { SiteValues } from './reader';
import { unique, labeledValues, tokenMints } from './dom';

export function axiomHints(document: Document): SiteValues {
  const pair = document.querySelector<HTMLElement>('#pair-name-tooltip');
  if (!pair) return {};
  let region: HTMLElement | null = pair;
  let firstMint: string | undefined;
  for (let depth = 0; region && depth < 5; depth++, region = region.parentElement) {
    const mints = tokenMints(region);
    const mintHint = unique(mints);
    if (mints.length && !mintHint) break;
    if (!mintHint) continue;
    firstMint ??= mintHint;
    if (mintHint !== firstMint) break;
    const values = labeledValues(region);
    if (values.priceUsd || values.marketCapUsd) return { mintHint, ...values };
  }
  return firstMint ? { mintHint: firstMint } : {};
}

