import { SITE_MATCHES } from '../src/sites/catalog';
import { createChartOverlay } from '../src/chart-overlay';

export default defineContentScript({
  matches: SITE_MATCHES,
  world: 'MAIN',
  main() {
    const state = window as Window & { __directPumpChartCleanup?: () => void };
    state.__directPumpChartCleanup?.();
    const overlay = createChartOverlay(document, () => location.href);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      overlay.update(event.data);
    };
    window.addEventListener('message', onMessage);
    const timer = window.setInterval(() => { void overlay.sync(); }, 1_000);
    // A cached history page can return without rerunning its content script.
    const onPageHide = () => overlay.reset();
    const cleanup = () => {
      window.clearInterval(timer); window.removeEventListener('message', onMessage);
      window.removeEventListener('pagehide', onPageHide); overlay.destroy();
      if (state.__directPumpChartCleanup === cleanup) delete state.__directPumpChartCleanup;
    };
    state.__directPumpChartCleanup = cleanup;
    window.addEventListener('pagehide', onPageHide);
  },
});
