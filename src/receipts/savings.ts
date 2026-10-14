import type { Savings, LedgerTrade, UsdSnapshot } from '../model';

export const EMPTY_SAVINGS: Savings = { volumeUsdMicros: '0', savedUsdMicros: '0', verifiedTrades: 0, pricedTrades: 0, unpricedTrades: 0, benchmarkBps: 100 };
export function priceMicros(value: string): bigint {
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,18})?$/.test(value)) throw new Error('Invalid SOL/USD quote.');
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole!) * 1_000_000n + BigInt(fraction.slice(0,6).padEnd(6,'0'));
  if (result <= 0n) throw new Error('Invalid SOL/USD quote.');
  return result;
}
export function volumeUsd(volumeLamports: string, price: UsdSnapshot): string {
  return (BigInt(volumeLamports) * BigInt(price.priceMicros) / 1_000_000_000n).toString();
}
export function updateSavings(current: Savings, previous: LedgerTrade | undefined, next: LedgerTrade): Savings {
  if(next.feeReceipt.state!=='VERIFIED'||!next.feeReceipt.zeroExtraFeesVerified||!next.feeReceipt.executionSucceeded||(previous&&previous.signature!==next.signature))throw new Error('Only successful verified trades can update savings.');
  const priced = (trade?: LedgerTrade) => trade?.feeReceipt.volumeUsdMicros !== undefined;
  const volume = BigInt(current.volumeUsdMicros) - BigInt(previous?.feeReceipt.volumeUsdMicros ?? '0') + BigInt(next.feeReceipt.volumeUsdMicros ?? '0');
  const verifiedTrades = current.verifiedTrades + (previous ? 0 : 1);
  const pricedTrades = current.pricedTrades + Number(priced(next)) - Number(priced(previous));
  return { volumeUsdMicros: volume.toString(), savedUsdMicros: (volume / 100n).toString(), verifiedTrades, pricedTrades, unpricedTrades: verifiedTrades - pricedTrades, benchmarkBps: 100 };
}
export function formatAmount(raw: string, decimals = 9): string {
  const n = BigInt(raw), scale = 10n ** BigInt(decimals);
  return `${n / scale}${decimals ? `.${(n % scale).toString().padStart(decimals,'0')}`.replace(/0+$/,'').replace(/\.$/,'') : ''}`;
}
export function formatUsd(micros: string): string {
  const cents = (BigInt(micros) + 5_000n) / 10_000n;
  return `$${(cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(cents % 100n).toString().padStart(2,'0')}`;
}
