/** The signer durably fenced this attempt without generating any signature. */
export class WalletBusyError extends Error {
  readonly code='WALLET_BUSY';
  constructor(){super('Wallet execution is settling; this order remains queued.');}
}
export const SIGNER_REPLY_LIMIT=1_048_576;
/** Expected pairing failure; safe to disclose without private signer diagnostics. */
export class PairingCodeError extends Error {
  readonly code='PAIRING_CODE_INVALID';
  constructor(){super('Pairing code is invalid or expired.');}
}
export const PAIRING_CODE_HELP='Pairing code is invalid, expired, or already used. Generate a new code on your server and try again within 5 minutes.';
