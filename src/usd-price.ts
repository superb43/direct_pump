import type { UsdSnapshot } from './model';
import { priceMicros } from './receipts/savings';
import {logEvent} from './diagnostics/diagnostics';

let cached: UsdSnapshot | undefined;
let pending: Promise<UsdSnapshot | undefined> | undefined;
let failures = 0;
let retryAt = 0;

/** A successful spot observation expires without extending its original timestamp. */
export function currentSolUsd(): UsdSnapshot | undefined {
  return cached && Date.now() - cached.capturedAt < 30_000 ? cached : undefined;
}

export function solUsdRetryAt(): number { return retryAt; }

export async function solUsdSnapshot(blockTime: number): Promise<UsdSnapshot | undefined> {
  // A current quote cannot reconstruct an old trade's USD value.
  if (Math.abs(Date.now() / 1000 - blockTime) > 300) return historicalSolUsd(blockTime);
  const fresh = currentSolUsd();
  if (fresh) return fresh;
  if (pending) return pending;
  if (Date.now() < retryAt) return undefined;
  pending = fetchSpot().finally(() => { pending = undefined; });
  return pending;
}

function retryAfter(response: Response): number {
  if (response.status !== 429) return 0;
  const header = response.headers.get('retry-after');
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Date.now() + seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? date : 0;
}

async function fetchSpot(): Promise<UsdSnapshot | undefined> {
  let providerRetryAt = 0;
  const started=Date.now();let status:number|undefined;
  try {
    const response = await fetch('https://api.coinbase.com/v2/prices/SOL-USD/spot', {
      cache: 'no-store', signal: AbortSignal.timeout(5_000),
    });
    status=response.status;
    providerRetryAt = retryAfter(response);
    if (!response.ok) throw new Error('SOL/USD response unavailable.');
    const date = response.headers.get('date');
    const data = (await response.json()) as { data?: { base?: string; currency?: string; amount?: string } };
    const now = Date.now();
    if (date && (!Number.isFinite(Date.parse(date)) || Math.abs(now - Date.parse(date)) > 120_000)) {
      throw new Error('SOL/USD response date invalid.');
    }
    if (data.data?.base !== 'SOL' || data.data.currency !== 'USD' || !data.data.amount) {
      throw new Error('SOL/USD response invalid.');
    }
    const snapshot: UsdSnapshot = {
      priceMicros: priceMicros(data.data.amount).toString(), capturedAt: now, source: 'Coinbase spot',
    };
    cached = snapshot;
    failures = 0;
    retryAt = 0;
    logEvent({level:'debug',component:'prices',type:'usd.completed',duration:Date.now()-started,details:{source:'Coinbase spot'}});
    return snapshot;
  } catch (error) {
    const delay = Math.min(15_000, 1000 * 2 ** Math.min(failures, 4));
    failures++;
    retryAt = Math.max(providerRetryAt, Date.now() + Math.round(delay * (0.8 + Math.random() * 0.4)));
    logEvent({level:'warn',component:'prices',type:'usd.failed',duration:Date.now()-started,code:status?.toString(),details:{error,status,retry:retryAt}});
    return undefined;
  }
}

const historical=new Map<number,UsdSnapshot>();
async function historicalSolUsd(blockTime:number):Promise<UsdSnapshot|undefined>{
 const minute=Math.floor(blockTime/60)*60;if(historical.has(minute))return historical.get(minute);
 try{
  const params=new URLSearchParams({granularity:'60',start:new Date(minute*1000).toISOString(),end:new Date((minute+60)*1000).toISOString()});
  const response=await fetch(`https://api.exchange.coinbase.com/products/SOL-USD/candles?${params}`,{signal:AbortSignal.timeout(8000)});
  if(!response.ok)return historicalDaily(blockTime);const rows=await response.json() as number[][];
  const row=rows.find(r=>r[0]===minute);if(!row||!Number.isFinite(row[4])||row[4]!<=0)return historicalDaily(blockTime);
  const snapshot:UsdSnapshot={priceMicros:priceMicros(String(row[4])).toString(),capturedAt:(minute+60)*1000,source:'Coinbase 1m candle'};
  historical.set(minute,snapshot);return snapshot;
 }catch{return historicalDaily(blockTime);}
}

const days=new Map<string,UsdSnapshot>();
async function historicalDaily(blockTime:number):Promise<UsdSnapshot|undefined>{
 try{
  const day=new Date(blockTime*1000).toISOString().slice(0,10);
  if(days.has(day))return days.get(day);
  const response=await fetch(`https://api.coinbase.com/v2/prices/SOL-USD/spot?date=${day}`,{signal:AbortSignal.timeout(8000)});
  if(!response.ok)return undefined;const result=await response.json() as {data?:{base:string;currency:string;amount:string}};
  if(result.data?.base!=='SOL'||result.data.currency!=='USD')return undefined;
  const value:UsdSnapshot={priceMicros:priceMicros(result.data.amount).toString(),capturedAt:Date.parse(`${day}T00:00:00Z`),source:'Coinbase daily estimate'};days.set(day,value);return value;
 }catch{return undefined;}
}
