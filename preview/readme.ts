// Documentation fixture only. Render production views with synthetic, offline data.
import './extension-mock';
import type { Receipt, WorkerRequest, WorkerResponse } from '../src/model';

const { browser } = await import('wxt/browser');
const mockSend = browser.runtime.sendMessage.bind(browser.runtime);
const now = Date.now();
const volumes = [0.5, 0.75, 1, 0.5, 1.25, 0.75, 1.5, 1, 0.75, 1.25, 1, 1.5];
let history: Receipt[] | undefined;
browser.runtime.sendMessage = (async (request: WorkerRequest): Promise<WorkerResponse> => {
  const response = await mockSend(request) as WorkerResponse;
  if (!response.ok) return response;
  if (response.portfolio) {
    for (const [index, holding] of response.portfolio.holdings.entries()) {
      const position = holding.position;
      if (!position) continue;
      position.openedAt = now - (index ? 2_880_000 : 1_080_000);
      position.costBasisUsdMicros = index ? '18000000' : '4200000000';
      position.costBasisSolLamports = index ? '150000000' : '35000000000';
      if (index) position.expectedExitLamports = '187500000';
    }
  }
  if (response.receipts?.length) {
    history ??= volumes.map((sol, index) => {
      const receipt = structuredClone(response.receipts![0]!);
      const at = now - (5 - Math.floor(index / 2)) * 86_400_000 - (index % 2 ? 0 : 3_600_000);
      const raw = String(Math.round(sol * 1e9));
      receipt.signature = String(index + 1).padStart(2, '1').repeat(44);
      receipt.side = index % 2 ? 'SELL' : 'BUY';
      receipt.createdAt = at;
      receipt.inputAmount = raw;
      const fee = receipt.feeReceipt!;
      fee.checkedAt = at;
      fee.blockTime = Math.floor(at / 1000);
      fee.note = 'Synthetic README sample. No transaction was sent.';
      fee.volumeLamports = raw;
      fee.volumeUsdMicros = String(Math.round(sol * 120 * 1e6));
      fee.protocolBreakdownIncomplete = false;
      fee.protocolFees[0]!.rawAmount = String(Math.round(sol * 1e9 * 0.01));
      fee.protocolFees[1]!.rawAmount = String(Math.round(sol * 1e9 * 0.0025));
      fee.usd!.capturedAt = at;
      return receipt;
    });
    response.receipts = history;
  }
  if (response.savings) {
    const volume = volumes.reduce((total, sol) => total + Math.round(sol * 120 * 1e6), 0);
    response.savings = {volumeUsdMicros: String(volume), savedUsdMicros: String(volume / 100), verifiedTrades: volumes.length, pricedTrades: volumes.length, unpricedTrades: 0, benchmarkBps: 100};
  }
  return response;
}) as typeof browser.runtime.sendMessage;
const mockTabSend = browser.tabs.sendMessage.bind(browser.tabs);
const readmeTabSend = (async (tabId: number, message: { type: string; request: WorkerRequest }, options?: { frameId?: number; documentId?: string }) => {
  if (message.type === 'PANEL_REQUEST') return browser.runtime.sendMessage(message.request);
  return mockTabSend(tabId, message, options);
}) as typeof browser.tabs.sendMessage;
// WXT wraps tabs separately; update the underlying preview API as well.
(globalThis as unknown as { chrome: typeof browser }).chrome.tabs.sendMessage = readmeTabSend;
browser.tabs.sendMessage = readmeTabSend;

const surface = new URL(location.href).searchParams.get('surface') ?? 'sidepanel';
if (surface === 'sidepanel') {
  document.body.innerHTML = '<main id="trading"></main><div id="empty" hidden><img src="/icon/128.png" width="32" height="32" alt=""><h1>Open a token page to trade</h1><p class="empty-sites">GMGN · AXIOM · FOMO</p><p id="error" role="status" hidden></p></div>';
  await import('../entrypoints/sidepanel/main');
} else if (surface === 'settings' || surface === 'dashboard') {
  const markup = await fetch(`/entrypoints/${surface}/index.html`).then(response => response.text());
  const source = new DOMParser().parseFromString(markup, 'text/html');
  source.querySelectorAll('script').forEach(script => script.remove());
  document.body.innerHTML = source.body.innerHTML;
  if (surface === 'settings') await import('../entrypoints/settings/main');
  else await import('../entrypoints/dashboard/main');
} else {
  throw new Error('Unknown README preview surface.');
}
