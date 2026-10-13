import type { PageTarget } from '../model';

export const PRO_API_VERSION = 1;
export const PRICE_SCALE = 1_000_000_000_000n;
export type ProKind = 'MARKET' | 'LIMIT' | 'BRACKET' | 'TRAILING' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'STRATEGY';
export type ProState = 'OPEN' | 'PAUSED' | 'BLOCKED' | 'SIGNING' | 'SUBMITTED' | 'UNKNOWN' | 'CONFIRMED' | 'FINALIZED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
export type ProExitStep = { id:string; kind:"TAKE_PROFIT"|"STOP_LOSS"|"TRAILING"; targetMcUsd?:string; activationMcUsd?:string; trailingBps?:number; portionBps?:number; remaining?:true };
export type ProStrategyProgress = { baseRaw:string; remainingRaw:string; steps:Array<{id:string;state:"OPEN"|"SIGNING"|"FINALIZED"|"CANCELLED";amountRaw?:string;highWatermarkMcUsd?:string;trailActive?:boolean}> };
export type ProSpec = {
  version?:2; basis?:"MC"; triggerMcUsd?:string; tpMcUsd?:string; slMcUsd?:string; activationMcUsd?:string; steps?:ProExitStep[]; exitStrategy?:{steps:ProExitStep[];durationMs:number};
  kind: ProKind; side: 'BUY' | 'SELL'; target: PageTarget; mint: string;
  amountRaw: string; decimals: number; expiresAt: number; slippageBps: number;
  priorityFeeLamports: number; maxNetworkLamports: string;
  triggerPriceUsd?: string; tpPriceUsd?: string; slPriceUsd?: string;
  trailingBps?: number; activationPriceUsd?: string;
  exit?: { tpBps: number; slBps: number; slippageBps: number; durationMs?: number };
};
export type ProSpecV2 = ProSpec & {version:2;basis:"MC"};
export type ProOrder = {
  currentMcUsd?:string; highWatermarkMcUsd?:string; strategy?:ProStrategyProgress;
  id: string; revision: number; spec: ProSpec; wallet: string; state: ProState;
  createdAt: number; updatedAt: number; reason?: string; highWatermark?: string;
  trailActive?: boolean; currentPriceUsd?: string; signature?: string;
  parentId?: string; receivedRaw?: string; protectionPending?: boolean;
  pendingAction?: 'create'|'edit'|'pause'|'resume'|'cancel'|'protection';
};
export type ProAttempt = {
  id: string; orderId: string; state: 'AUTHORIZED' | 'SIGNED' | 'SUBMITTED' | 'UNKNOWN' | 'CONFIRMED' | 'FINALIZED' | 'FAILED' | 'EXPIRED';
  signedTransaction?: string; signature?: string; blockhash?: string; lastValidBlockHeight?: number;
  createdAt: number; updatedAt: number; error?: string;
  networkRaw?:string; solUsdUnits?: string; strategyStepId?:string; inputRaw?:string;
};
export type ProEvent = { sequence: number; id: string; at: number; type: string; orderId?: string; attemptId?: string; withdrawalId?: string; signature?: string; message: string };
export type ProSettings = { enabled: boolean; serverUrl: string; serverId?: string; deviceId?: string; chromeNotifications: boolean };
export const DEFAULT_PRO_SETTINGS: ProSettings = { enabled: false, serverUrl: '', chromeNotifications: false };
export type ProHealth = {
  apiVersion: number; capabilities?: string[]; serverId: string; wallet: string; signer: 'LOCKED' | 'READY' | 'UNAVAILABLE';
  engine: 'PAUSED' | 'RUNNING' | 'RECOVERING'; at: number;
  limits: { maxBuyLamports: string; dailyBuyLamports: string; maxNetworkLamports: string };
};
export type ProBalance = { mint: string; decimals: number; totalRaw: string; reservedRaw: string; availableRaw: string };
export type AuthEnvelope = { deviceId: string; timestamp: number; nonce: string; signature: string };
export type AuthProof = { envelope: AuthEnvelope; method: string; path: string; body: string };
export type ProReply = { ok: true; data?: unknown } | { ok: false; error: string };
export type ProRequest = { type: 'PRO'; action: 'SETTINGS' | 'PAIR' | 'ENABLE' | 'DISABLE' | 'REQUEST' | 'EXPORT' | 'DEBUG'; settings?: ProSettings; serverUrl?: string; code?: string; method?: string; path?: string; body?: unknown; target?: PageTarget; expectedSession?:{serverId:string;deviceId:string;wallet:string} };

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).filter(key => row[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(',')}}`;
  }
  throw new Error('Invalid JSON value.');
}

export function authMessage(serverId: string, proof: Omit<AuthProof, 'envelope'> & { envelope: Pick<AuthEnvelope, 'timestamp' | 'nonce'> }): string {
  return [serverId, proof.method, proof.path, String(proof.envelope.timestamp), proof.envelope.nonce, proof.body].join('\n');
}

export function positiveRaw(value: unknown, name = 'Amount'): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value) > 18_446_744_073_709_551_615n) throw new Error(`${name} must be a positive raw integer.`);
  return value;
}

export function usdUnits(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1,12})?$/.test(value)) throw new Error('Price must have at most twelve decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole!) * PRICE_SCALE + BigInt(fraction.padEnd(12, '0'));
  if (result <= 0n) throw new Error('Price must be positive.');
  return result;
}
export function unitsUsd(value: bigint): string { return `${value / PRICE_SCALE}.${(value % PRICE_SCALE).toString().padStart(12, '0')}`; }
export const usdMicros = usdUnits;
export const microsUsd = unitsUsd;

export function validateProSpec(input: unknown, now = Date.now()): ProSpec {
  if (!input || typeof input !== 'object') throw new Error('Invalid order.');
  if ((input as ProSpec).version === 2 || (input as ProSpec).basis === 'MC') return validateProSpecV2(input,now);
  const s = input as ProSpec;
  if (!['MARKET', 'LIMIT', 'BRACKET', 'TRAILING'].includes(s.kind) || !['BUY', 'SELL'].includes(s.side)) throw new Error('Invalid order type.');
  if (!s.target || !['GMGN', 'AXIOM', 'FOMO'].includes(s.target.site) || !['MINT', 'POOL'].includes(s.target.kind) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.mint)) throw new Error('Invalid token identity.');
  positiveRaw(s.amountRaw); positiveRaw(s.maxNetworkLamports, 'Network budget');
  if (!Number.isInteger(s.decimals) || s.decimals < 0 || s.decimals > 18) throw new Error('Invalid token decimals.');
  if (!Number.isSafeInteger(s.expiresAt) || s.expiresAt <= now || s.expiresAt > now + 30 * 86400_000) throw new Error('Order expiry must be within 30 days.');
  if (!Number.isInteger(s.slippageBps) || s.slippageBps < 1 || s.slippageBps > 2000) throw new Error('Slippage must be between 0.01% and 20%.');
  if (!Number.isSafeInteger(s.priorityFeeLamports) || s.priorityFeeLamports < 0 || s.priorityFeeLamports > 10_000_000) throw new Error('Invalid priority fee.');
  if (BigInt(s.maxNetworkLamports) < BigInt(s.priorityFeeLamports) + 5000n) throw new Error('Network budget cannot cover the selected fee.');
  if (s.kind === 'LIMIT') { if (!s.triggerPriceUsd) throw new Error('Limit price is required.'); usdMicros(s.triggerPriceUsd); }
  if (s.kind === 'BRACKET') {
    if (s.side !== 'SELL' || !s.tpPriceUsd || !s.slPriceUsd || usdMicros(s.tpPriceUsd) <= usdMicros(s.slPriceUsd)) throw new Error('TP must be above SL for a sell bracket.');
  }
  if (s.kind === 'TRAILING') {
    if (s.side !== 'SELL' || !Number.isInteger(s.trailingBps) || s.trailingBps! < 50 || s.trailingBps! > 9000) throw new Error('Trailing sell distance must be 0.5%–90%.');
    if (s.activationPriceUsd) usdMicros(s.activationPriceUsd);
  }
  if (s.exit && (s.side !== 'BUY' || !['MARKET', 'LIMIT'].includes(s.kind) || !Number.isInteger(s.exit.tpBps) || s.exit.tpBps < 1 || s.exit.tpBps > 100_000 || !Number.isInteger(s.exit.slBps) || s.exit.slBps < 1 || s.exit.slBps >= 10_000 || !Number.isInteger(s.exit.slippageBps) || s.exit.slippageBps < 1 || s.exit.slippageBps > 2000)) throw new Error('Invalid entry protection.');
  if(s.exit&&s.exit.durationMs!==undefined&&(!Number.isSafeInteger(s.exit.durationMs)||s.exit.durationMs<60_000||s.exit.durationMs>30*86400_000))throw new Error('Protection duration must be one minute to 30 days.');
  const allowed = new Set(['kind','side','target','mint','amountRaw','decimals','expiresAt','slippageBps','priorityFeeLamports','maxNetworkLamports','triggerPriceUsd','tpPriceUsd','slPriceUsd','trailingBps','activationPriceUsd','exit']);
  if (Object.keys(s).some(key => !allowed.has(key))) throw new Error('Unknown order field.');
  if (s.kind !== 'LIMIT' && s.triggerPriceUsd !== undefined || s.kind !== 'BRACKET' && (s.tpPriceUsd !== undefined || s.slPriceUsd !== undefined) || s.kind !== 'TRAILING' && (s.trailingBps !== undefined || s.activationPriceUsd !== undefined)) throw new Error('Fields do not match the order type.');
  const result=JSON.parse(canonicalJson(s)) as ProSpec;
  if(result.exit)result.exit.durationMs??=86400_000;
  return result;
}

export function validateProSpecV2(input:unknown,now=Date.now()):ProSpecV2 {
  if(!input||typeof input!=='object')throw new Error('Invalid MC order.');
  const s=input as ProSpecV2;
  if(s.version!==2||s.basis!=='MC'||!['MARKET','LIMIT','TAKE_PROFIT','STOP_LOSS','BRACKET','TRAILING','STRATEGY'].includes(s.kind))throw new Error('MC version 2 is required.');
  const common={kind:'MARKET',side:s.side,target:s.target,mint:s.mint,amountRaw:s.amountRaw,decimals:s.decimals,expiresAt:s.expiresAt,slippageBps:s.slippageBps,priorityFeeLamports:s.priorityFeeLamports,maxNetworkLamports:s.maxNetworkLamports};
  validateProSpec(common,now);
  const allowed=new Set([...Object.keys(common),'version','basis','triggerMcUsd','tpMcUsd','slMcUsd','activationMcUsd','trailingBps','steps','exitStrategy']);
  if(Object.keys(s).some(k=>!allowed.has(k)))throw new Error('Unknown MC order field.');
  if(s.kind==='LIMIT'){if(!s.triggerMcUsd)throw new Error('Limit MC required.');usdUnits(s.triggerMcUsd);}
  if(['TAKE_PROFIT','STOP_LOSS'].includes(s.kind)){if(s.side!=='SELL'||!s.triggerMcUsd)throw new Error('Sell trigger MC required.');usdUnits(s.triggerMcUsd);}
  if(s.kind==='BRACKET'&&(s.side!=='SELL'||!s.tpMcUsd||!s.slMcUsd||usdUnits(s.tpMcUsd)<=usdUnits(s.slMcUsd)))throw new Error('TP MC must exceed SL MC.');
  if(s.kind==='TRAILING'){if(s.side!=='SELL'||!Number.isInteger(s.trailingBps)||s.trailingBps!<50||s.trailingBps!>9000)throw new Error('Trailing distance must be 0.5%–90%.');if(s.activationMcUsd)usdUnits(s.activationMcUsd);}
  const steps=(rows:ProExitStep[])=>{
    if(!Array.isArray(rows)||rows.length<1||rows.length>10)throw new Error('Strategy requires 1–10 steps.');
    const ids=new Set<string>(),totals=new Map<string,number>();
    for(const step of rows){
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(step.id)||ids.has(step.id))throw new Error('Step IDs must be unique UUIDs.');ids.add(step.id);
      if(Object.keys(step).some(k=>!['id','kind','targetMcUsd','activationMcUsd','trailingBps','portionBps','remaining'].includes(k)))throw new Error('Unknown strategy step field.');
      if(!['TAKE_PROFIT','STOP_LOSS','TRAILING'].includes(step.kind))throw new Error('Invalid strategy step.');
      if(step.remaining!==undefined&&step.remaining!==true)throw new Error('Remaining must be true.');
      if(step.remaining===true?step.portionBps!==undefined:!Number.isInteger(step.portionBps)||step.portionBps!<1||step.portionBps!>10000)throw new Error('Choose a portion or remaining quantity.');
      if(step.kind==='TRAILING'){if(step.targetMcUsd!==undefined||!Number.isInteger(step.trailingBps)||step.trailingBps!<50||step.trailingBps!>9000)throw new Error('Invalid trailing step.');if(step.activationMcUsd)usdUnits(step.activationMcUsd);}
      else {if(!step.targetMcUsd||step.activationMcUsd!==undefined||step.trailingBps!==undefined)throw new Error('Step MC required.');usdUnits(step.targetMcUsd);}
      totals.set(step.kind,(totals.get(step.kind)??0)+(step.portionBps??0));
    }
    if([...totals.values()].some(n=>n>10000))throw new Error('Each exit path cannot exceed 100%.');
  };
  if(s.kind==='STRATEGY'){if(s.side!=='SELL')throw new Error('Strategy must sell.');steps(s.steps!);}else if(s.steps!==undefined)throw new Error('Steps require a strategy.');
  if(s.exitStrategy){if(s.side!=='BUY'||!['MARKET','LIMIT'].includes(s.kind)||!Number.isSafeInteger(s.exitStrategy.durationMs)||s.exitStrategy.durationMs<60000||s.exitStrategy.durationMs>30*86400000||Object.keys(s.exitStrategy).some(k=>!['steps','durationMs'].includes(k)))throw new Error('Invalid entry strategy.');steps(s.exitStrategy.steps);}
  if(!['LIMIT','TAKE_PROFIT','STOP_LOSS'].includes(s.kind)&&s.triggerMcUsd!==undefined||s.kind!=='BRACKET'&&(s.tpMcUsd!==undefined||s.slMcUsd!==undefined)||s.kind!=='TRAILING'&&(s.activationMcUsd!==undefined||s.trailingBps!==undefined))throw new Error('MC fields do not match order type.');
  return JSON.parse(canonicalJson(s)) as ProSpecV2;
}
