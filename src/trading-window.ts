import { browser } from 'wxt/browser';
import { mountPanel } from './panel';
import { detectPage, sameTarget, pageKey, isUnsupportedChainTokenPage } from './sites/catalog';
import type { PageContext, PageTarget, Receipt, WorkerResponse } from './model';
import {createPriceWatch} from './price-watch';
import { createChartOverlayRelay } from './chart-overlay-relay';
import { isMissingReceiver, PAGE_CONNECTION_ERROR } from './errors';

export function mountTradingWindow() {
  document.body.classList.add('sidepanel');
  const empty = document.querySelector<HTMLElement>('#empty')!;
  const errorStatus = document.querySelector<HTMLElement>('#error')!;
  const container = document.querySelector<HTMLElement>('#trading')!;
  const emptyHeading = document.querySelector<HTMLElement>('#empty h1')!;
  const emptyDescription = document.querySelector<HTMLElement>('.empty-sites')!;
  let tabId: number | undefined;
  let current: PageTarget | undefined;
  let key = '';
  let panel: ReturnType<typeof mountPanel> | undefined;
  let chartRelay: ReturnType<typeof createChartOverlayRelay> | undefined;
  let generation = 0;
  let alive = true;
  const recoveryAttempts = new Map<string, number>();
  const priceWatch=createPriceWatch();
  let requestedPage = '';
  let inFlight: number | undefined;
  const clearPanel = () => { panel?.destroy(); chartRelay?.destroy(); chartRelay = undefined; panel = undefined; current = undefined; key = ''; };
  const showEmpty = (message = '', unsupportedChain = false) => {
    clearPanel(); empty.hidden = false;
    emptyHeading.textContent = unsupportedChain ? 'Only Solana is supported' : 'Open a token page to trade';
    emptyDescription.textContent = unsupportedChain ? 'Open a Solana token page to trade' : 'GMGN · AXIOM · FOMO';
    errorStatus.textContent = message; errorStatus.hidden = !message;
  };

  async function refresh(force = true) {
    let sequence = force ? ++generation : generation;
    let ownsRequest = false;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!alive || sequence !== generation) return;
      const nextPage = `${tab?.id}:${tab?.url ?? ''}`;
      // Passive polls keep a slow context alive; tab/navigation events can supersede it.
      if (!force && nextPage === requestedPage && inFlight !== undefined) return;
      if (!force) sequence = ++generation;
      requestedPage = nextPage;
      inFlight = sequence;
      ownsRequest = true;
      if (tabId !== tab?.id) clearPanel();
      tabId = tab?.id;
      const detected = detectPage(tab?.url ?? '');
      if (tabId === undefined || !detected) { showEmpty('', isUnsupportedChainTokenPage(tab?.url ?? '')); return; }
      if (current && !sameTarget(current, detected)) clearPanel();
      const selectedTab = tabId;
      let context: PageContext;
      try {
        context = await browser.tabs.sendMessage(selectedTab, { type: 'PANEL_CONTEXT' }, { frameId: 0 }) as PageContext;
      } catch (error) {
        if (!alive || sequence !== generation) return;
        if (!isMissingReceiver(error)) throw error;
        try {
          if (tab?.status === 'loading') throw error;
          // Pin recovery to the current document; navigation must never move an injection.
          const [frame] = await browser.scripting.executeScript({
            target: { tabId: selectedTab, frameIds: [0] }, world: 'ISOLATED', func: () => location.href,
          });
          if (!alive || sequence !== generation) return;
          if (!frame?.documentId || !sameTarget(detected, detectPage(String(frame.result)))) throw error;
          const recoveryKey = `${selectedTab}:${frame.documentId}`;
          const attemptedAt = recoveryAttempts.get(recoveryKey);
          if (attemptedAt !== undefined && Date.now() - attemptedAt < 30_000) throw error;
          recoveryAttempts.set(recoveryKey, Date.now());
          const injectionTarget = { tabId: selectedTab, documentIds: [frame.documentId] };
          await browser.scripting.executeScript({ target: injectionTarget, world: 'MAIN', files: ['/content-scripts/chart.js'] });
          if (!alive || sequence !== generation) return;
          // WXT invalidates the previous content context and removes its listeners/timers.
          await browser.scripting.executeScript({ target: injectionTarget, world: 'ISOLATED', files: ['/content-scripts/content.js'] });
          if (!alive || sequence !== generation) return;
          // Only the context read is retried. Never replay a wallet or trade request.
          context = await browser.tabs.sendMessage(selectedTab, { type: 'PANEL_CONTEXT' }, { documentId: frame.documentId }) as PageContext;
        } catch {
          throw new Error(PAGE_CONNECTION_ERROR);
        }
      }
      if (!alive || sequence !== generation) return;
      if (!context.target) { showEmpty(); return; }
      if (!sameTarget(context.target, detected)) throw new Error('Token page does not match the active tab. Reload the page and try again.');
      const nextKey = `${selectedTab}:${pageKey(context.target)}`;
      if (nextKey !== key) {
        clearPanel(); key = nextKey; current = context.target;
        chartRelay = createChartOverlayRelay(selectedTab, context.target);
        panel = mountPanel(context.target, request => request.type === 'PORTFOLIO'||request.type==='PORTFOLIO_PRICES'||request.type==='PRO'
          ? browser.runtime.sendMessage(request) as Promise<WorkerResponse>
          : (browser.tabs.sendMessage(selectedTab, { type: 'PANEL_REQUEST', request }, { frameId: 0 }) as Promise<WorkerResponse>).catch(error => {
            if (isMissingReceiver(error)) throw new Error(PAGE_CONNECTION_ERROR);
            throw error;
          }), {
            container, native:true, watchPrices:priceWatch.update, chartEntry: chartRelay.updateEntry,
            navigate: url => {if(alive&&tabId===selectedTab&&detectPage(url))void browser.tabs.update(selectedTab,{url}).catch(error=>console.error(String(error)));},
          });
      }
      current = context.target;
      chartRelay?.updateTarget(context.target);
      panel?.updateContext(context.target);
      panel?.updateMarket(context.market);
      errorStatus.textContent = ''; errorStatus.hidden = true;
      empty.hidden = true;
    } catch (error) {
      if (!alive || sequence !== generation) return;
      showEmpty(error instanceof Error ? error.message : 'Reload the token page after updating the extension.');
    } finally {
      if (ownsRequest && inFlight === sequence) inFlight = undefined;
    }
  }
  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;
    if (changes.settings) void panel?.reloadSettings();
    for (const [name, change] of Object.entries(changes)) if (name.startsWith('receipt:') && change.newValue) panel?.showReceipt(change.newValue as Receipt);
  };
  const onMarket: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message, sender) => {
    if(message.type==='PORTFOLIO_UPDATED'&&sender.id===browser.runtime.id&&!sender.tab){panel?.refreshPortfolio(message.wallet);return;}
    if (message.type !== 'MARKET_UPDATE' || sender.id !== browser.runtime.id || sender.tab?.id !== tabId || sender.frameId !== 0) return;
    if (!current || !message.target || !sameTarget(message.target, current)) return;
    panel?.updateMarket(message.market);
  };
  const onTab = () => { void refresh(); };
  const onUpdated: Parameters<typeof browser.tabs.onUpdated.addListener>[0] = (updatedId, change) => {
    if (updatedId === tabId && (change.url || change.status === 'complete')) void refresh();
  };
  browser.runtime.onMessage.addListener(onMarket);
  browser.storage?.onChanged?.addListener(onStorage);
  browser.tabs.onActivated.addListener(onTab);
  browser.tabs.onUpdated.addListener(onUpdated);
  void refresh();
  const timer = window.setInterval(() => { void refresh(false); }, 1_000);
  const destroy = () => {
    if (!alive) return;
    alive = false; generation++; recoveryAttempts.clear(); window.clearInterval(timer); clearPanel();priceWatch.destroy();
    browser.storage?.onChanged?.removeListener(onStorage);
    browser.runtime.onMessage.removeListener(onMarket);
    browser.tabs.onActivated.removeListener(onTab);
    browser.tabs.onUpdated.removeListener(onUpdated);
    window.removeEventListener('pagehide', destroy);
  };
  window.addEventListener('pagehide', destroy);
  return { refresh, destroy };
}
