import type { Receipt } from './model';
import { redactUrls } from './errors';

export function receiptFailure(receipt: Receipt): string | undefined {
  if (receipt.status !== 'FAILED' && receipt.feeReceipt?.executionSucceeded !== false) return undefined;
  return redactUrls(receipt.feeReceipt?.executionError ?? receipt.error ?? 'Transaction failed. Failure details are not available yet.');
}

export function receiptDataNote(receipt: Receipt): string {
  const f = receipt.feeReceipt;
  const notes = [f?.note ?? 'Receipt data is not available yet.', ...(f?.differences ?? [])];
  if (f?.totalNetworkLamports !== undefined && !f.usd) notes.push('Historical SOL/USD price is missing. Confirmed SOL amounts remain available. Refresh can retry the price lookup.');
  if (f?.executionSucceeded && f.volumeLamports === undefined) notes.push('Settled trading volume could not be isolated; it is unavailable, rather than an unpriced amount.');
  if (f?.protocolBreakdownIncomplete) notes.push('Only decoded protocol fees are included in the known subtotal; unavailable components are excluded.');
  return redactUrls(notes.join(' '));
}
