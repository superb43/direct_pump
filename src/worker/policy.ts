import { browser, type Browser } from 'wxt/browser';
import type { WorkerRequest } from '../model';
import { detectPage, sameTarget } from '../sites/catalog';
import { requestPolicy } from '../messages';
import { currentFrameUrl } from '../phantom';

export async function authorizeRequest(request: WorkerRequest, sender: Browser.runtime.MessageSender): Promise<void> {
  if (!request || typeof request !== 'object' || sender.id !== browser.runtime.id || !requestPolicy(request.type)) throw new Error('Invalid request.');
  const policy = requestPolicy(request.type)!.access;
  const url = sender.url ?? '';
  if (policy === 'PRO_PRIVATE') {
    if (!(['/sidepanel.html', '/settings.html', '/dashboard.html'] as const).some(path => url.split(/[?#]/)[0] === browser.runtime.getURL(path))) throw new Error('Pro and diagnostics are only available in native extension pages.');
    return;
  }
  if (policy === 'PORTFOLIO_PRIVATE') {
    if (!(['/sidepanel.html', '/dashboard.html'] as const).some(path => url.split(/[?#]/)[0] === browser.runtime.getURL(path))) throw new Error('Holdings are only available in the extension panel and dashboard.');
    return;
  }
  if (policy === 'SETTINGS_PRIVATE') {
    if (url !== browser.runtime.getURL('/settings.html')) throw new Error('Private settings are only available in the extension Settings page.');
    return;
  }
  if (policy === 'DASHBOARD_PRIVATE') {
    if (url.split(/[?#]/)[0] !== browser.runtime.getURL('/dashboard.html')) throw new Error('Trade history is only available in the extension dashboard.');
    return;
  }
  // Requests requiring a target still pass the exact document and target checks in frameFor.
  if (policy === 'PAGE_TARGET') return;
  if ((['/sidepanel.html', '/settings.html', '/dashboard.html'] as const).some(path => url === browser.runtime.getURL(path))) return;
  if (sender.frameId !== 0 || sender.tab?.id === undefined || !sender.documentId || !url) throw new Error('Request origin is not allowed.');
  const tab = await browser.tabs.get(sender.tab.id);
  const target = detectPage(tab.url ?? '');
  if (!target || new URL(url).origin !== new URL(target.pageUrl).origin) throw new Error('Request must come from a supported token page.');
  const current = detectPage(await currentFrameUrl({tabId: sender.tab.id, documentId: sender.documentId}));
  if (!sameTarget(target, current)) throw new Error('The token page changed.');
}
