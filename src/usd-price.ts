import type { UsdSnapshot } from './model';
import { priceMicros } from './savings';
let cached: UsdSnapshot | undefined;
export async function solUsdSnapshot(blockTime: number): Promise<UsdSnapshot | undefined> {
  const now = Date.now();
  // A current quote cannot reconstruct an old trade's USD value.
  if (Math.abs(now / 1000 - blockTime) > 300) return historicalSolUsd(blockTime);
  if (cached && now - cached.capturedAt < 30_000) return cached;
  try {
    const response = await fetch('https://api.coinbase.com/v2/prices/SOL-USD/spot', { cache:'no-store', signal:AbortSignal.timeout(8_000) });
    if (!response.ok) return undefined;
    const date = response.headers.get('date');
    if (date && Math.abs(now - Date.parse(date)) > 120_000) return undefined;
    const data = (await response.json()) as { data?: { base?: string; currency?: string; amount?: string } };
    if (data.data?.base !== 'SOL' || data.data.currency !== 'USD' || !data.data.amount) return undefined;
    return cached = { priceMicros: priceMicros(data.data.amount).toString(), capturedAt:now, source:'Coinbase spot' };
  } catch { return undefined; }
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
