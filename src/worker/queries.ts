import { Connection, PublicKey } from '@solana/web3.js';
import type { Browser } from 'wxt/browser';
import type { Settings, WorkerRequest, WorkerResponse, PositionSnapshot } from '../model';
import { targetKey } from '../sites/catalog';
import { readPosition } from '../position';
import { readTokenInfo } from '../token-info';
import { readSavings, unauditedReceipts, allReceipts } from '../ledger';
import type { createOrders, FrameFor } from './orders';

type PositionJob = { wallet: string; at: number; pending: boolean; job: Promise<PositionSnapshot> };

export function createQueries(loadSettings: () => Promise<Settings>, frameFor: FrameFor) {
  const positions = new Map<string, PositionJob>();
  function invalidatePositions(wallet: string) {
    for (const [key, entry] of positions) if (entry.wallet === wallet) positions.delete(key);
  }
  async function position(request: Extract<WorkerRequest, {type: 'POSITION'}>, sender: Browser.runtime.MessageSender, orders: ReturnType<typeof createOrders>): Promise<WorkerResponse> {
    await frameFor(sender, request);
    const wallet = new PublicKey(request.wallet);
    if (orders.isBusy(request.wallet)) throw new Error('Position updates resume after the active trade.');
    const settings = await loadSettings();
    const key = JSON.stringify([request.wallet, targetKey(request.target), settings.rpcUrl, settings.priorityFeeLamports, settings.slippageBps, settings.jupiterApiKey, request.holdingsOnly ? 'holdings' : 'quote']);
    const cached = positions.get(key);
    const ttl = request.holdingsOnly ? 1_000 : 5_000;
    if (!request.refresh && cached && (cached.pending || Date.now() - cached.at < ttl)) return {ok: true, position: await cached.job};
    // Register receipt + position as one job before the first storage await.
    const job = (async () => {
      const receipt = await orders.loadReceipt(request.wallet);
      const minContextSlot = receipt?.status === 'CONFIRMED' ? receipt.confirmedSlot ?? receipt.feeReceipt?.slot : undefined;
      return readPosition(new Connection(settings.rpcUrl, 'confirmed'), request.target, wallet, settings, request.market, request.holdingsOnly, minContextSlot);
    })();
    const entry = {wallet: request.wallet, at: Date.now(), pending: true, job};
    positions.set(key, entry);
    void job.then(() => { entry.pending = false; entry.at = Date.now(); }, () => {
      if (positions.get(key) === entry) positions.delete(key);
    });
    return {ok: true, position: await job};
  }
  async function read(request: Extract<WorkerRequest, {type: 'POSITION' | 'TOKEN_INFO' | 'HISTORY' | 'SAVINGS'}>, sender: Browser.runtime.MessageSender, orders: ReturnType<typeof createOrders>): Promise<WorkerResponse> {
    if (request.type === 'POSITION') return position(request, sender, orders);
    if (request.type === 'TOKEN_INFO') {
      await frameFor(sender, request);
      const settings = await loadSettings();
      return {ok: true, token: await readTokenInfo(new Connection(settings.rpcUrl, 'confirmed'), request.target)};
    }
    if (request.type === 'HISTORY') return {ok: true, receipts: await allReceipts(request.wallet, request.mint), savings: await readSavings()};
    for (const tracked of await unauditedReceipts()) orders.scheduleAudit(tracked);
    return {ok: true, savings: await readSavings()};
  }
  return {read, invalidatePositions};
}
