import type { MarketHint } from './model';

import { decimalE18 } from './sites/decimal';
export { decimalText, decimalE18 } from './sites/decimal';
export function markedValueMicros(balanceRaw:string,decimals:number,supplyRaw:string,hint?:MarketHint):bigint|undefined {
 if(!hint)return;
 if(hint.priceUsd)return BigInt(balanceRaw)*decimalE18(hint.priceUsd)/(10n**BigInt(decimals)*10n**12n);
 if(hint.marketCapUsd&&BigInt(supplyRaw)>0n)return BigInt(balanceRaw)*decimalE18(hint.marketCapUsd)/(BigInt(supplyRaw)*10n**12n);
}
