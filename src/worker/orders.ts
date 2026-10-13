import { FEE_AUDIT_VERSION } from '../fee-audit-version';
import { browser, type Browser } from 'wxt/browser';
import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { buildHybridTrade } from '../hybrid';
import { preparePhantom, sendWithPhantom, inspectPhantom, type SigningFrame } from '../phantom';
import type { WorkerRequest, WorkerResponse, Receipt, Settings } from '../model';
import { isPending, settleReceipt } from '../receipts';
import { userFacingError } from '../errors';
import { reconcileMissingSignature } from '../reconcile';
import { verifyFeeReceipt, pendingFees } from '../fee-receipt';
import { recordVerifiedTrade, archiveReceipt, receiptBySignature } from '../ledger';
import {logEvent} from '../diagnostics';
import {cleanReceipt} from '../receipt-diagnostics';

export type FrameFor = (sender: Browser.runtime.MessageSender, request: WorkerRequest & { target: unknown }) => Promise<SigningFrame>;

export function createOrders(loadSettings: () => Promise<Settings>, frameFor: FrameFor, invalidatePositions: (wallet: string) => void) {
  const busy = new Set<string>();
  const activeOrders = new Map<string, string>();
  const statusRequests = new Map<string, Promise<Receipt | undefined>>();
  const receiptKey = (wallet: string) => `receipt:${wallet}`;
  const loadReceipt = async (wallet: string): Promise<Receipt | undefined> => (await browser.storage.local.get(receiptKey(wallet)))[receiptKey(wallet)] as Receipt | undefined;
  let receiptWrites:Promise<void>=Promise.resolve();
  const writeLatest=(receipt:Receipt,onlyForSignature?:string)=>{
    receipt=cleanReceipt(receipt);
    const write=receiptWrites.then(async()=>{
      if(onlyForSignature&&(await loadReceipt(receipt.wallet))?.signature!==onlyForSignature)return;
      await browser.storage.local.set({[receiptKey(receipt.wallet)]:receipt});
    });
    receiptWrites=write.catch(()=>{});return write;
  };
  const saveReceipt = async (receipt: Receipt) => {
    await writeLatest(receipt);
    logEvent({level:receipt.status==='FAILED'?'error':'info',component:'orders',type:'trade.state',orderId:receipt.orderId,signature:receipt.signature,details:{state:receipt.status,reason:receipt.error}});
    try { await archiveReceipt(receipt); } catch(error) { logEvent({level:'error',component:'ledger',type:'receipt.archive.failed',orderId:receipt.orderId,signature:receipt.signature,details:{error}}); }
  };
  const feeRequests = new Map<string,Promise<Receipt>>();
  async function audit(receipt: Receipt): Promise<Receipt> {
    if (!receipt.signature) return receipt;
    const existing=feeRequests.get(receipt.signature); if(existing) return existing;
    const job=(async()=>{
      let feeReceipt;
      try { const settings=await loadSettings(); feeReceipt=await verifyFeeReceipt(new Connection(settings.rpcUrl,'confirmed'),receipt); }
      catch(error) { feeReceipt=pendingFees(`Fee verification is unavailable: ${userFacingError(error)}`,'UNAVAILABLE'); }
      // A transient RPC failure must not erase the captured historical FX quote.
      if(!feeReceipt.usd&&receipt.feeReceipt?.usd)feeReceipt={...feeReceipt,usd:receipt.feeReceipt.usd};
      const updated:Receipt={...receipt,feeReceipt,status:feeReceipt.state==='VERIFIED'?(feeReceipt.executionSucceeded?'CONFIRMED':'FAILED'):receipt.status,
        error:feeReceipt.executionError??receipt.error,diagnostic:feeReceipt.diagnostic??receipt.diagnostic};
      try {
        await archiveReceipt(updated);
        if(updated.status==='CONFIRMED') await recordVerifiedTrade({signature:updated.signature!,wallet:updated.wallet,mint:updated.mint,side:updated.side,createdAt:updated.createdAt,feeReceipt});
      } catch { feeReceipt.note+=' Local history could not be saved.'; }
      // An older audit can finish after a new order. Never overwrite that order.
      await writeLatest(updated,receipt.signature);
      if(updated.feeReceipt?.state==='VERIFIED')invalidatePositions(updated.wallet);
      return updated;
    })().finally(()=>feeRequests.delete(receipt.signature!));
    feeRequests.set(receipt.signature,job); return job;
  }
  const scheduleAudit=(receipt:Receipt)=>{if(receipt.signature&&receipt.feeManifest?.length&&(!receipt.feeReceipt||receipt.feeReceipt.state==='PENDING'||receipt.feeReceipt.auditVersion!==FEE_AUDIT_VERSION)) void audit(receipt).catch(error=>{logEvent({level:'warn',component:'audit',type:'fee.audit.failed',signature:receipt.signature,details:{error}});});};



  async function readStatus(wallet: string): Promise<Receipt | undefined> {
    new PublicKey(wallet);
    const receipt = await loadReceipt(wallet);
    if (!isPending(receipt) || !receipt) { if(receipt) scheduleAudit(receipt); return receipt; }
    if (receipt.orderId && activeOrders.get(wallet) === receipt.orderId) return receipt;
    const settings = await loadSettings();
    const rpc = new Connection(settings.rpcUrl, 'confirmed');
    let current = receipt;
    if (!current.signature && current.orderId && current.frame) {
      try {
        const bridge = await inspectPhantom(current.frame, current.orderId);
        if (bridge?.result?.state === 'NOT_SENT') {
          current = { ...current, status: 'FAILED', error: bridge.result.error, diagnostic: bridge.result.diagnostic };
          await saveReceipt(current); return current;
        }
        if (bridge?.result?.signature && bs58.decode(bridge.result.signature).length === 64) current = { ...current, signature: bridge.result.signature, status: 'SUBMITTED' };
        if (bridge?.stage === 'INVOKED') return { ...current, status: 'SIGNING', error: 'Waiting for Phantom approval or response.' };
        if (bridge?.stage === 'PREPARED') {
          // Atomically cancel the prepared call before unlocking. A late old send
          // must observe cancellation rather than opening a second approval.
          const cancelled = await inspectPhantom(current.frame!, current.orderId!, true);
          if (cancelled?.result?.state === 'NOT_SENT') {
            current = { ...current, status: 'FAILED', error: cancelled.result.error, diagnostic: cancelled.result.diagnostic };
            await saveReceipt(current); return current;
          }
          return { ...current, status: 'SIGNING', error: 'The Phantom request has started. Waiting for approval or response.' };
        }
      } catch { /* Recover a lost/legacy bridge from chain history instead. */ }
    }
    if (!current.signature) {
      const recovered = await reconcileMissingSignature(rpc, current);
      await saveReceipt(recovered); scheduleAudit(recovered); return recovered;
    }
    const [result, height] = await Promise.all([
      rpc.getSignatureStatuses([current.signature], { searchTransactionHistory: true }),
      rpc.getBlockHeight('confirmed'),
    ]);
    const updated = settleReceipt(current, result.value[0] ?? null, height);
    await saveReceipt(updated); if(updated.status==='CONFIRMED')invalidatePositions(updated.wallet); scheduleAudit(updated);
    return updated;
  }

  function status(wallet: string): Promise<Receipt | undefined> {
    const existing = statusRequests.get(wallet);
    if (existing) return existing;
    const promise = readStatus(wallet).finally(() => statusRequests.delete(wallet));
    statusRequests.set(wallet, promise); return promise;
  }

  async function trade(request: Extract<WorkerRequest, {type: 'TRADE'}>, sender: Browser.runtime.MessageSender): Promise<WorkerResponse> {
    await frameFor(sender, request);
    invalidatePositions(request.wallet);
    const wallet = new PublicKey(request.wallet);
    if (busy.has(request.wallet)) throw new Error('A trade is already in progress for this wallet.');
    busy.add(request.wallet);
    try {
      const existing = await status(request.wallet);
      if (isPending(existing)) throw new Error('The previous trade is unresolved. Confirm its outcome before submitting another order.');
      if (!request.intent || !['BUY', 'SELL'].includes(request.intent.side)) throw new Error('Invalid trade request.');
      const settings = await loadSettings();
      const rpc = new Connection(settings.rpcUrl, 'confirmed');
      const built = await buildHybridTrade(rpc, request.target, wallet, request.intent, settings);
      const currentFrame = await frameFor(sender, request);
      const orderId = crypto.randomUUID();
      await preparePhantom(currentFrame, request.target, request.wallet, Array.from(built.transaction.serialize()), orderId);
      const receipt: Receipt = {
        orderId, frame: { tabId: currentFrame.tabId, documentId: currentFrame.documentId },
        wallet: request.wallet, mint: built.route.mint.toBase58(), venue: built.route.venue,
        side: request.intent.side, pageUrl: request.target.pageUrl,
        message: bs58.encode(built.transaction.message.serialize()), ...built.latest,
        observedSlot: built.observedSlot,
        inputAmount: built.input?.toString(), feeManifest: 'feeManifest' in built ? built.feeManifest : undefined,
        createdAt: Date.now(), status: 'SIGNING',
      };
      await saveReceipt(receipt);
      activeOrders.set(request.wallet, orderId);
      let result;
      try { result = await sendWithPhantom(currentFrame, orderId); }
      catch (error) { result = { state: 'UNKNOWN', error: `The Phantom request outcome is unresolved: ${userFacingError(error)}` }; }
      if (result.state === 'NOT_SENT') {
        const failed: Receipt = { ...receipt, status: 'FAILED', error: result.error, diagnostic: 'diagnostic' in result ? result.diagnostic : undefined };
        await saveReceipt(failed);
        return { ok: true, receipt: failed };
      }
      const signature = 'signature' in result && typeof result.signature === 'string' ? result.signature : undefined;
      if (signature && bs58.decode(signature).length !== 64) throw new Error('Invalid transaction signature response. Check wallet activity.');
      const submitted: Receipt = { ...receipt, signature, status: signature ? 'SUBMITTED' : 'UNKNOWN', error: 'error' in result ? result.error : undefined, diagnostic: 'diagnostic' in result ? result.diagnostic : undefined };
      await saveReceipt(submitted); scheduleAudit(submitted);
      return { ok: true, receipt: submitted };
    } finally { busy.delete(request.wallet); activeOrders.delete(request.wallet); }
  }
  async function verifyFees(wallet: string, signature: string): Promise<Receipt> {
    new PublicKey(wallet);
    let known = await loadReceipt(wallet);
    if (known?.signature !== signature) known = await receiptBySignature(signature);
    if (!known || known.wallet !== wallet || known.signature !== signature) throw new Error('This signature is not a locally tracked Direct Pump trade.');
    return audit(known);
  }
  return { trade, status, verifyFees, scheduleAudit, loadReceipt, isBusy: (wallet: string) => busy.has(wallet) };
}
