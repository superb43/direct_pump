import type { Receipt } from './model';

export function isPending(receipt?: Receipt): boolean {
  return !!receipt && ['SIGNING', 'SUBMITTED', 'UNKNOWN'].includes(receipt.status);
}

export function settleReceipt(
  receipt: Receipt,
  signatureStatus: { err: unknown; confirmationStatus?: string | null; slot?: number } | null,
  blockHeight: number,
): Receipt {
  if (signatureStatus?.err) return { ...receipt, status: 'FAILED', error: 'The on-chain transaction failed. Loading failure details…', diagnostic: { stage: 'CHAIN', error: typeof signatureStatus.err === 'string' ? signatureStatus.err : JSON.stringify(signatureStatus.err) } };
  if (signatureStatus && ['confirmed', 'finalized'].includes(signatureStatus.confirmationStatus ?? '')) {
    return { ...receipt, status: 'CONFIRMED', confirmedSlot:signatureStatus.slot??receipt.confirmedSlot, error: undefined };
  }
  if (receipt.signature && !signatureStatus && blockHeight > receipt.lastValidBlockHeight) {
    return { ...receipt, status: 'EXPIRED', error: 'The transaction expired.' };
  }
  return { ...receipt, status: receipt.signature ? 'SUBMITTED' : 'UNKNOWN' };
}
