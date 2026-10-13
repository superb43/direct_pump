import {usdUnits,unitsUsd} from './contracts';
export function marketCapUsd(priceUsd:string,supplyRaw:string,tokenDecimals:number):string {
  if(!/^[1-9][0-9]*$/.test(supplyRaw)||!Number.isInteger(tokenDecimals)||tokenDecimals<0||tokenDecimals>18)throw new Error('Verified token supply unavailable.');
  return unitsUsd(usdUnits(priceUsd)*BigInt(supplyRaw)/(10n**BigInt(tokenDecimals)));
}
export function parseMcInput(value:string):string {
  const match=/^\s*(\d+(?:\.\d+)?)\s*([kmb])?\s*$/i.exec(value);
  if(!match)throw new Error('Enter a positive MC, for example 250K or 1.2M.');
  return unitsUsd(usdUnits(match[1]!)*({k:1000n,m:1000000n,b:1000000000n}[match[2]?.toLowerCase() as 'k']??1n));
}
export function formatMc(value:string):string {
  const units=usdUnits(value),scale=1000000000000n;
  for(const [n,label]of [[1000000000n,'B'],[1000000n,'M'],[1000n,'K']] as const)if(units>=n*scale){const hundred=units*100n/(n*scale);return `${hundred/100n}.${(hundred%100n).toString().padStart(2,'0')}${label}`;}
  if(units<scale/100n)return unitsUsd(units).replace(/0+$/,'').replace(/\.$/,'');
  return `${units/scale}.${(units%scale).toString().padStart(12,'0').slice(0,2)}`;
}
