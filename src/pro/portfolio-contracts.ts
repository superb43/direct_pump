import type {PageTarget} from '../model';
import {detectPage} from '../sites/catalog';
import {validateProSpecV2,type ProSpecV2} from './contracts';
export type ProPortfolioRow={mint:string;target?:PageTarget;decimals:number;totalRaw:string;reservedRaw:string;availableRaw:string;solUsdUnits?:string;valueLamports?:string;costBasisLamports?:string;realizedPnlLamports?:string;unrealizedPnlLamports?:string;unrecoveredLamports?:string;status:'READY'|'UNAVAILABLE';reason?:string};
export type ProPortfolio={wallet:string;updatedAt:number;rows:ProPortfolioRow[];partial:boolean};
export type ProRecoverInitialsPreview={spec?:ProSpecV2;targetLamports:string;expectedNetLamports?:string;shortfallLamports?:string;status:'READY'|'RECOVERED'|'INSUFFICIENT'|'UNAVAILABLE';reason?:string;quoteAt:number};
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid Pro portfolio response.');return v as Record<string,unknown>;};
const only=(r:Record<string,unknown>,fields:string[])=>{if(Object.keys(r).some(k=>!fields.includes(k)))throw Error('Unexpected portfolio response field.');};
const raw=(v:unknown,signed=false)=>typeof v==='string'&&(signed?/^-?(0|[1-9]\d*)$/:/^(0|[1-9]\d*)$/).test(v)&&v.length<=80;
const key=(v:unknown)=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const time=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
export function validateProPortfolio(input:unknown):ProPortfolio{
 const p=record(input);only(p,['wallet','updatedAt','rows','partial']);if(!key(p.wallet)||!time(p.updatedAt)||typeof p.partial!=='boolean'||!Array.isArray(p.rows)||p.rows.length>512)throw Error('Invalid Pro portfolio.');
 const seen=new Set<string>();
 for(const item of p.rows){const r=record(item);only(r,['mint','target','decimals','totalRaw','reservedRaw','availableRaw','solUsdUnits','valueLamports','costBasisLamports','realizedPnlLamports','unrealizedPnlLamports','unrecoveredLamports','status','reason']);if(!key(r.mint)||seen.has(String(r.mint))||!Number.isInteger(r.decimals)||Number(r.decimals)<0||Number(r.decimals)>255||!['READY','UNAVAILABLE'].includes(String(r.status)))throw Error('Invalid Pro portfolio row.');seen.add(String(r.mint));
  for(const f of ['totalRaw','reservedRaw','availableRaw'])if(!raw(r[f]))throw Error('Invalid Pro portfolio balance.');
  const total=BigInt(String(r.totalRaw)),reserved=BigInt(String(r.reservedRaw));if(BigInt(String(r.availableRaw))!==(total>reserved?total-reserved:0n))throw Error('Invalid available balance.');
  for(const f of ['valueLamports','costBasisLamports','realizedPnlLamports','unrealizedPnlLamports','unrecoveredLamports'])if(r[f]!==undefined&&!raw(r[f],f.includes('Pnl')))throw Error('Invalid Pro portfolio amount.');
  if(r.solUsdUnits!==undefined&&(!raw(r.solUsdUnits)||BigInt(String(r.solUsdUnits))<=0n))throw Error('Invalid SOL USD rate.');
  if(r.status==='READY'&&['costBasisLamports','realizedPnlLamports','unrecoveredLamports'].some(f=>r[f]===undefined))throw Error('Incomplete ready portfolio row.');
  if(r.reason!==undefined&&(typeof r.reason!=='string'||r.reason.length>512))throw Error('Invalid portfolio reason.');
  if(r.target!==undefined&&!isProPortfolioTarget(r.target,String(r.mint)))throw Error('Invalid portfolio target.');
 }
 return JSON.parse(JSON.stringify(p)) as ProPortfolio;
}
export function validateProRecoverInitialsPreview(input:unknown):ProRecoverInitialsPreview{
 const r=record(input);only(r,['spec','targetLamports','expectedNetLamports','shortfallLamports','status','reason','quoteAt']);if(!['READY','RECOVERED','INSUFFICIENT','UNAVAILABLE'].includes(String(r.status))||!raw(r.targetLamports)||!time(r.quoteAt))throw Error('Invalid recovery preview.');
 for(const f of ['expectedNetLamports','shortfallLamports'])if(r[f]!==undefined&&!raw(r[f]))throw Error('Invalid recovery amount.');
 if(r.reason!==undefined&&(typeof r.reason!=='string'||r.reason.length>512))throw Error('Invalid recovery reason.');
 if(r.status==='READY'){const spec=validateProSpecV2(r.spec);if(spec.kind!=='MARKET'||spec.side!=='SELL'||r.expectedNetLamports===undefined||BigInt(String(r.expectedNetLamports))<BigInt(String(r.targetLamports)))throw Error('Invalid recovery order.');r.spec=spec;}else if(r.spec!==undefined)throw Error('Unexpected recovery order.');
 return JSON.parse(JSON.stringify(r)) as ProRecoverInitialsPreview;
}

export function isProPortfolioTarget(input:unknown,mint:string):input is PageTarget{
 try{
  const t=record(input);only(t,['site','address','kind','pageUrl','mintHint','poolHint']);
  if(typeof t.pageUrl!=='string'||t.pageUrl.length>4096||!key(t.address)||['mintHint','poolHint'].some(f=>t[f]!==undefined&&!key(t[f])))return false;
  const page=detectPage(t.pageUrl);
  if(!page||page.site!==t.site||page.kind!==t.kind||page.address!==t.address)return false;
  if(t.mintHint!==undefined&&t.mintHint!==mint)return false;
  if(t.kind==='MINT')return t.address===mint;
  return t.kind==='POOL'&&t.mintHint===mint&&(t.poolHint===undefined||t.poolHint===t.address);
 }catch{return false;}
}
