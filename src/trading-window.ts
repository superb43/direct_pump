import { browser } from 'wxt/browser';
import { mountPanel } from './panel';
import { detectPage, sameTarget, pageKey, SITE_LABELS } from './sites/catalog';
import type { PageContext, PageTarget, Receipt, WorkerResponse } from './model';

export function mountTradingWindow() {
  document.body.classList.add('sidepanel');
  const empty = document.querySelector<HTMLElement>('#empty')!;
  const container = document.querySelector<HTMLElement>('#trading')!;
  let tabId: number | undefined;
  let current: PageTarget | undefined;
  let key = '';
  let panel: ReturnType<typeof mountPanel> | undefined;
  let generation = 0;
  let alive = true;
  let requestedPage = '';
  let inFlight: number | undefined;
  const clearPanel = () => { panel?.destroy(); panel = undefined; current = undefined; key = ''; };

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
      if (tabId === undefined || !detected) throw new Error(`Choose a ${Object.values(SITE_LABELS).join(', ')} token tab.`);
      if (current && !sameTarget(current, detected)) clearPanel();
      const selectedTab = tabId;
      const context = await browser.tabs.sendMessage(selectedTab, { type: 'PANEL_CONTEXT' }, { frameId: 0 }) as PageContext;
      if (!alive || sequence !== generation) return;
      if (!context.target || !sameTarget(context.target, detected)) throw new Error('Choose a token page to start trading.');
      const nextKey = `${selectedTab}:${pageKey(context.target)}`;
      if (nextKey !== key) {
        clearPanel(); key = nextKey; current = context.target;
        panel = mountPanel(context.target, request => browser.tabs.sendMessage(selectedTab, { type: 'PANEL_REQUEST', request }, { frameId: 0 }) as Promise<WorkerResponse>, { container });
      }
      current = context.target;
      panel?.updateContext(context.target);
      panel?.updateMarket(context.market);
      empty.hidden = true;
    } catch (error) {
      if (!alive || sequence !== generation) return;
      clearPanel(); empty.hidden = false;
      document.querySelector('#error')!.textContent = error instanceof Error ? error.message : 'Reload the token page after updating the extension.';
    } finally {
      if (ownsRequest && inFlight === sequence) inFlight = undefined;
    }
  }
  const onSettings = () => { void browser.runtime.sendMessage({ type: 'OPEN_SETTINGS' }); };
  document.querySelector('#settings')!.addEventListener('click', onSettings);
  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;
    if (changes.settings) void panel?.reloadSettings();
    for (const [name, change] of Object.entries(changes)) if (name.startsWith('receipt:') && change.newValue) panel?.showReceipt(change.newValue as Receipt);
  };
  const onMarket: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message, sender) => {
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
    alive = false; generation++; window.clearInterval(timer); clearPanel();
    browser.storage?.onChanged?.removeListener(onStorage);
    browser.runtime.onMessage.removeListener(onMarket);
    browser.tabs.onActivated.removeListener(onTab);
    browser.tabs.onUpdated.removeListener(onUpdated);
    document.querySelector('#settings')!.removeEventListener('click', onSettings);
    window.removeEventListener('pagehide', destroy);
  };
  window.addEventListener('pagehide', destroy);
  return { refresh, destroy };
}
