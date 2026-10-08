import { browser } from 'wxt/browser';
import { readPageHints } from '../src/adapters';
import { targetKey, SITE_MATCHES } from '../src/sites/catalog';
import { bindPanelRequest } from '../src/panel-relay';
import { createPageContextReader, CONTEXT_SAMPLE_MS } from '../src/page-context';
import type { PanelMessage } from '../src/messages';

export default defineContentScript({
  matches: SITE_MATCHES,
  main(ctx) {
    const context = createPageContextReader(() => location.href, target => readPageHints(document, target));
    let marketTimer: ReturnType<typeof setTimeout> | undefined;
    let lastKey = '', lastMarket = '', publishedAt = 0;
    const publishMarket = () => {
      marketTimer = undefined;
      const { target, market } = context.read();
      if (!target) { lastKey = ''; lastMarket = ''; return; }
      const key = targetKey(target);
      if (key !== lastKey) { lastKey = key; lastMarket = ''; }
      const fingerprint = JSON.stringify([targetKey(target), market?.mint, market?.priceUsd, market?.marketCapUsd]);
      if (fingerprint === lastMarket && Date.now() - publishedAt < CONTEXT_SAMPLE_MS) return;
      lastMarket = fingerprint; publishedAt = Date.now();
      // Missing or ambiguous marks invalidate the old display value as well.
      void browser.runtime.sendMessage({ type: 'MARKET_UPDATE', target, market }).catch(() => {});
    };
    context.read();
    ctx.setInterval(publishMarket, 500);
    const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => {
      context.invalidate();
      if (marketTimer === undefined) marketTimer = setTimeout(publishMarket, 100);
    });
    observer?.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['data-price-usd', 'data-market-cap-usd', 'href', 'hidden'],
    });
    ctx.onInvalidated(() => { observer?.disconnect(); if (marketTimer !== undefined) clearTimeout(marketTimer); });
    const listener: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message: PanelMessage, sender, reply) => {
      if (sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL('/sidepanel.html')) return;
      if (message.type === 'PANEL_CONTEXT') { reply(context.read()); return; }
      if (message.type === 'PANEL_REQUEST') {
        try {
          const { target, market } = context.read(true);
          const request = bindPanelRequest(message.request, target);
          if (request.type === 'POSITION') request.market = market;
          void browser.runtime.sendMessage(request).then(reply, error => reply({ ok: false, error: String(error.message) }));
        } catch (error) {
          reply({ ok: false, error: error instanceof Error ? error.message : 'Panel request failed.' });
        }
        return true;
      }
    };
    browser.runtime.onMessage.addListener(listener);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(listener));
  },
});
