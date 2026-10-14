import { browser } from 'wxt/browser';
import type { ChartEntry } from './chart-entry';
import type { PageTarget } from '../model';
import { overlayCommand } from './chart-overlay-contract';
import { targetKey } from '../sites/catalog';

/** Native-view lease; only display values, never Pro requests, enter the page. */
export function createChartOverlayRelay(tabId: number, initial: PageTarget) {
  let target = { ...initial }, entry: ChartEntry | undefined;
  let alive = true, sent = false, sending = false, queued = false;
  async function publish() {
    if (sending) { queued = true; return; }
    sending = true;
    try {
      do {
        queued = false;
        const command = overlayCommand(target, alive ? entry : undefined);
        if (!sent && !command.entry) continue;
        sent = true;
        await browser.tabs.sendMessage(tabId, { type: 'PANEL_CHART_ENTRY', command }, { frameId: 0 }).catch(() => {});
      } while (queued);
    } finally { sending = false; }
  }
  const timer = window.setInterval(() => { if (alive && entry) void publish(); }, 4_000);
  return {
    updateEntry(next?: ChartEntry) {
      if (!alive || JSON.stringify(entry) === JSON.stringify(next)) return;
      entry = next; void publish();
    },
    updateTarget(next: PageTarget) {
      if (!alive) return;
      const changed = targetKey(next) !== targetKey(target);
      target = { ...next };
      if (changed) { entry = undefined; void publish(); }
    },
    destroy() { if (!alive) return; alive = false; entry = undefined; window.clearInterval(timer); void publish(); },
  };
}
