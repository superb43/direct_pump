import {positiveRaw} from './contracts';
export type Recipient = {id:string;version:number;name:string;address:string;active:boolean;createdAt:number};
export type WithdrawalSpec = {requestId:string;recipientId:string;recipientVersion:number;address:string;mint:string;decimals:number;amountRaw:string;maxNetworkLamports:string};
export type WithdrawalPreview = {id:string;spec:WithdrawalSpec;expiresAt:number;totalRaw:string;reservedRaw:string;availableRaw:string;maxRaw:string;feeLamports:string;rentLamports:string};
export type Withdrawal = {id:string;spec:WithdrawalSpec;state:'AUTHORIZED'|'SIGNED'|'SUBMITTED'|'UNKNOWN'|'CONFIRMED'|'FINALIZED'|'FAILED'|'EXPIRED';createdAt:number;updatedAt:number;signature?:string;error?:string};
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateWithdrawalSpec(input:unknown):WithdrawalSpec {
  if(!input||typeof input!=='object')throw new Error('Invalid withdrawal.');
  const s=input as WithdrawalSpec;
  const allowed=['requestId','recipientId','recipientVersion','address','mint','decimals','amountRaw','maxNetworkLamports'];
  if(Object.keys(s).some(k=>!allowed.includes(k))||!UUID.test(s.requestId)||!UUID.test(s.recipientId)||!Number.isSafeInteger(s.recipientVersion)||s.recipientVersion<1||![s.address,s.mint].every(v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v))||!Number.isInteger(s.decimals)||s.decimals<0||s.decimals>18)throw new Error('Invalid withdrawal identity.');
  positiveRaw(s.amountRaw);positiveRaw(s.maxNetworkLamports,'Network budget');
  if(BigInt(s.maxNetworkLamports)<5000n)throw new Error('Network budget is too small.');
  return {...s};
}
