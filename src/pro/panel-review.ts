import {canonicalJson,validateProSpec,usdUnits,unitsUsd,type ProOrder,type ProSpec,type ProExitStep} from './contracts';
import type {ChartEntry} from '../chart/chart-entry';

export class PanelReview<T> {
  private revision=0; private approved?:{spec:T;id:string;session?:ProSession};
  invalidate(){this.revision++;this.approved=undefined;}
  version(){return this.revision;}
  accept(spec:T,version:number,id:string=crypto.randomUUID(),session?:ProSession){if(version!==this.revision)throw new Error('Ticket changed. Review again.');this.approved={spec:structuredClone(spec),id,...session?{session:structuredClone(session)}:{}};}
  current(){if(!this.approved)throw new Error('Review the order first.');return structuredClone(this.approved);}
}
export function isProSideControl(button:Pick<HTMLButtonElement,'matches'|'dataset'>):boolean {
  return button.matches('.pro-sides [data-side]')&&['BUY','SELL'].includes(button.dataset.side??'');
}
/** Shorten generated MC values only when the parser can round-trip every digit. */
export function compactMcInput(value:string):string {
  const units=usdUnits(value),scale=1000000000000n;
  for(const [multiple,suffix,digits]of [[1000000000n,'B',21],[1000000n,'M',18],[1000n,'K',15]] as const){
    const denominator=multiple*scale;if(units<denominator)continue;
    const fraction=(units%denominator).toString().padStart(digits,'0').replace(/0+$/,'');
    if(fraction.length<=12)return `${units/denominator}${fraction?`.${fraction}`:''}${suffix}`;
  }
  return unitsUsd(units).replace(/0+$/,'').replace(/\.$/,'');
}
export function expectedRemainingRaw(baseRaw:string,rows:ProExitStep[]):string {
  if(rows.some(row=>row.remaining))return '0';
  const base=BigInt(baseRaw),used=rows.reduce((sum,row)=>sum+base*BigInt(row.portionBps??0)/10000n,0n);
  return (used>base?0n:base-used).toString();
}
export type ProSession={serverId:string;deviceId:string;wallet:string};
export function sameProSession(left:ProSession|undefined,right:ProSession|undefined):boolean {
  return Boolean(left&&right&&left.serverId===right.serverId&&left.deviceId===right.deviceId&&left.wallet===right.wallet);
}
export function requireReviewSession(reviewed:ProSession|undefined,current:ProSession|undefined):ProSession {
  if(!sameProSession(reviewed,current))throw new Error('Server wallet or pairing changed. Review the order again.');
  return structuredClone(reviewed!);
}
export type PendingOrderReview = {
  id:string;spec:ProSpec;serverId:string;deviceId:string;wallet:string;
  operation:'create'|'edit'|'retry';revision?:number;action?:NonNullable<ProOrder['pendingAction']>;
};
export function restorePendingOrder(value:unknown, binding:Pick<PendingOrderReview,'serverId'|'deviceId'|'wallet'>):PendingOrderReview {
  if(!value||typeof value!=='object')throw new Error('Saved order review is invalid.');
  const pending=value as PendingOrderReview;
  if(pending.serverId!==binding.serverId||pending.deviceId!==binding.deviceId||pending.wallet!==binding.wallet||typeof pending.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?::exit)?$/i.test(pending.id)||!['create','edit','retry'].includes(pending.operation))throw new Error('Saved review does not match the server wallet.');
  if(pending.operation!=='create'&&(!Number.isSafeInteger(pending.revision)||pending.revision!<0))throw new Error('Saved revision is invalid.');
  if(pending.operation==='retry'&&!['create','edit','pause','resume','cancel','protection'].includes(pending.action??''))throw new Error('Saved authorization action is invalid.');
  validateProSpec(pending.spec,pending.spec.expiresAt-1);
  return structuredClone(pending);
}
export function pendingCancellationReview(pending:PendingOrderReview,existing?:ProOrder):PendingOrderReview {
  if(pending.spec.version!==2||pending.operation!=='create')throw new Error('Cancellation recovery requires a saved MC creation intent.');
  if(existing&&(existing.id!==pending.id||canonicalJson(existing.spec)!==canonicalJson(pending.spec)||existing.wallet!==pending.wallet))throw new Error('Server order differs from the saved review.');
  return {...structuredClone(pending),operation:'retry',action:'cancel',revision:existing?.revision??1};
}
export function pendingOrderAcknowledged(pending:PendingOrderReview,existing:ProOrder|undefined):boolean {
  if(!existing||existing.id!==pending.id||existing.wallet!==pending.wallet||canonicalJson(existing.spec)!==canonicalJson(pending.spec))return false;
  if(pending.operation==='create')return true;
  if(pending.operation==='edit')return existing.revision>pending.revision!&&!existing.pendingAction;
  if(existing.pendingAction||existing.revision<pending.revision!)return false;
  if(pending.action==='cancel')return existing.state==='CANCELLED';
  if(pending.action==='pause')return existing.state==='PAUSED';
  const executionStates=['SIGNING','SUBMITTED','UNKNOWN','CONFIRMED','FINALIZED','FAILED','EXPIRED'];
  if(pending.action==='resume')return existing.state==='OPEN'||executionStates.includes(existing.state);
  return ['OPEN','PAUSED','BLOCKED',...executionStates].includes(existing.state);
}
export function strategyAllocation(rows:ProExitStep[]):string {
  return (['TAKE_PROFIT','STOP_LOSS','TRAILING'] as const).map(kind=>{
    const path=rows.filter(row=>row.kind===kind);if(!path.length)return '';
    const allocated=path.some(row=>row.remaining)?10000:path.reduce((sum,row)=>sum+(row.portionBps??0),0);
    const residual=Math.max(0,10000-allocated);const name=kind==='TAKE_PROFIT'?'TP':kind==='STOP_LOSS'?'SL':'Trailing';
    return `${name} ${allocated/100}% · ${residual/100}% left`;
  }).filter(Boolean).join(' | ');
}
/** A display snapshot must bind to the current wallet/mint and agree with verified supply. */
export function validateChartEntry(value:unknown,mint:string,wallet:string,maxAgeMs:number,now=Date.now()):ChartEntry|undefined {
  if(!value||typeof value!=='object')return;
  const entry=value as ChartEntry;
  try {
    if(entry.mint!==mint||entry.wallet!==wallet||!Number.isInteger(entry.decimals)||entry.decimals<0||entry.decimals>18||!Number.isSafeInteger(entry.updatedAt)||now-entry.updatedAt<0||now-entry.updatedAt>maxAgeMs)return;
    if(entry.validUntil!==undefined&&(!Number.isSafeInteger(entry.validUntil)||entry.validUntil<=now||entry.validUntil>entry.updatedAt+maxAgeMs))return;
    if(typeof entry.balanceRaw!=='string'||typeof entry.supplyRaw!=='string'||! /^[1-9][0-9]{0,19}$/.test(entry.balanceRaw)||! /^[1-9][0-9]{0,19}$/.test(entry.supplyRaw))return;
    const balance=BigInt(entry.balanceRaw),supply=BigInt(entry.supplyRaw);
    if(balance>supply||supply>18_446_744_073_709_551_615n||typeof entry.priceUsd!=='string'||typeof entry.marketCapUsd!=='string')return;
    const price=usdUnits(entry.priceUsd),mc=usdUnits(entry.marketCapUsd);
    if(price<=0n||mc<=0n||price*supply/10n**BigInt(entry.decimals)!==mc)return;
    return {...entry};
  }catch{return;}
}
