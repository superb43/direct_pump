import '../src/polyfills';
import { browser, type Browser } from 'wxt/browser';
import { Connection } from '@solana/web3.js';
import { assertPageTarget } from '../src/sites/catalog';
import { createOrders } from '../src/worker/orders';
import { createQueries } from '../src/worker/queries';
import { authorizeRequest } from '../src/worker/policy';
import { connectPhantom, restorePhantom, switchPhantom, currentFrameUrl, type SigningFrame } from '../src/phantom';
import { validateSettings } from '../src/settings';
import { DEFAULT_SETTINGS, type WorkerRequest, type WorkerResponse } from '../src/model';
import { userFacingError } from '../src/errors';
import { GLOBAL_PDA, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { SimulationFailure } from '../src/simulation';
import { applyPresentation } from '../src/presentation';

export default defineBackground(() => {
  const loadSettings = async () => validateSettings((await browser.storage.local.get('settings')).settings ?? DEFAULT_SETTINGS);
  const queries = createQueries(loadSettings, frameFor);
  const orders = createOrders(loadSettings, frameFor, queries.invalidatePositions);
  void loadSettings().then(()=>applyPresentation()).catch(error=>console.error(userFacingError(error)));

  async function frameFor(sender: Browser.runtime.MessageSender, target: WorkerRequest & { target: unknown }): Promise<SigningFrame> {
    if (sender.id !== browser.runtime.id || sender.frameId !== 0 || sender.tab?.id === undefined || !sender.documentId || !sender.url) {
      throw new Error('Request origin is not allowed.');
    }
    const typed = target as Extract<WorkerRequest, { type: 'CONNECT' | 'TRADE' | 'WALLET_RESTORE' | 'WALLET_SWITCH' | 'TOKEN_INFO' }>;
    if (new URL(sender.url).origin !== new URL(typed.target.pageUrl).origin) throw new Error('Page origin does not match the request.');
    const tab = await browser.tabs.get(sender.tab.id);
    assertPageTarget(typed.target, tab.url ?? '');
    const frame = { tabId: sender.tab.id, documentId: sender.documentId, pageUrl: tab.url! };
    // sender.url can retain the initial document URL across SPA history navigation.
    // Validate the current URL in the exact sender document, not that stale snapshot.
    assertPageTarget(typed.target, await currentFrameUrl(frame));
    return frame;
  }

  async function handle(request: WorkerRequest, sender: Browser.runtime.MessageSender): Promise<WorkerResponse> {
    await authorizeRequest(request, sender);
    if (request.type === 'SETTINGS_GET') {
      return { ok: true, settings: await loadSettings() };
    }
    if (request.type === 'SETTINGS_PUBLIC') {
      const { buyPresets, sellPresets, slippageBps, maxBuySol, maxQuoteBuyAmount, priorityFeeLamports } = await loadSettings();
      return { ok: true, publicSettings: { buyPresets, sellPresets, slippageBps, maxBuySol, maxQuoteBuyAmount, priorityFeeLamports } };
    }
    if (request.type === 'OPEN_SETTINGS') {
      await browser.tabs.create({url:browser.runtime.getURL('/settings.html')});
      return { ok: true };
    }
    if (request.type === 'RPC_TEST') {
      const settings = validateSettings({ ...DEFAULT_SETTINGS, rpcUrl: request.rpcUrl });
      const origin = `${new URL(settings.rpcUrl).origin}/*`;
      if (!await browser.permissions.contains({ origins: [origin] })) throw new Error('Access to the selected RPC endpoint was not granted.');
      const account = await new Connection(settings.rpcUrl, 'confirmed').getAccountInfo(GLOBAL_PDA);
      if (!account?.owner.equals(PUMP_PROGRAM_ID)) throw new Error('Could not read the Pump account. Check that this is a Solana Mainnet RPC.');
      return { ok: true };
    }
    if (request.type === 'SETTINGS_SAVE') {
      const settings = validateSettings(request.settings);
      const origin = `${new URL(settings.rpcUrl).origin}/*`;
      if (!await browser.permissions.contains({ origins: [origin] })) throw new Error('Access to the selected RPC endpoint was not granted.');
      await applyPresentation();
      await browser.storage.local.set({ settings });
      return { ok: true, settings };
    }
    if(request.type==='OPEN_DASHBOARD'){
      await browser.tabs.create({url:browser.runtime.getURL('/dashboard.html')});return {ok:true};
    }
    if (request.type === 'MARKET_UPDATE') { await frameFor(sender, request); return {ok:true}; }
    if (request.type === 'POSITION' || request.type === 'TOKEN_INFO' || request.type === 'HISTORY' || request.type === 'SAVINGS') return queries.read(request, sender, orders);
    if (request.type === 'VERIFY_FEES') return {ok:true,receipt:await orders.verifyFees(request.wallet, request.signature)};
    if (request.type === 'STATUS') return {ok:true,receipt:await orders.status(request.wallet)};
    if (request.type === 'CONNECT') return { ok: true, wallet: await connectPhantom(await frameFor(sender, request), request.target) };
    if (request.type === 'WALLET_RESTORE') return { ok: true, wallet: await restorePhantom(await frameFor(sender, request), request.target) };
    if (request.type === 'WALLET_SWITCH') return { ok: true, wallet: await switchPhantom(await frameFor(sender, request), request.target) };
    if (request.type !== 'TRADE') throw new Error('Unknown request.');
    return orders.trade(request, sender);
  }

  browser.runtime.onMessage.addListener((request: WorkerRequest, sender, respond) => {
    handle(request, sender).then(respond).catch(error => respond({ ok: false, error: userFacingError(error), diagnostic: error instanceof SimulationFailure ? error.diagnostic : undefined }));
    return true;
  });
});
