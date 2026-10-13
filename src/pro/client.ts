import { UUID, validateWithdrawalSpec } from './withdrawals';
import { browser } from 'wxt/browser';
import { sanitizeDiagnostic } from '../diagnostics';
import { DEFAULT_PRO_SETTINGS, PRO_API_VERSION, authMessage, canonicalJson, validateProSpec, validateProSpecV2, usdUnits, type ProSettings } from './contracts';
import { marketCapUsd } from './mc';

const SETTINGS_KEY = 'proSettings';
const KEY_DATABASE = 'direct-pump-pro-device';
export function validateServerUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Enter an HTTPS server origin without a path, credentials, query or fragment.');
  return url.origin;
}
function identity(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
export function normalizeProSettings(value: unknown): ProSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PRO_SETTINGS };
  const row = value as Record<string, unknown>;
  let serverUrl = '';
  try { if (typeof row.serverUrl === 'string' && row.serverUrl) serverUrl = validateServerUrl(row.serverUrl); }
  catch { return { ...DEFAULT_PRO_SETTINGS }; }
  const paired = Boolean(serverUrl && identity(row.deviceId) && identity(row.serverId));
  return { enabled: row.enabled === true && paired, serverUrl, chromeNotifications: row.chromeNotifications === true,
    ...(paired ? { deviceId: row.deviceId as string, serverId: row.serverId as string } : {}) };
}
export async function loadProSettings(): Promise<ProSettings> {
  return normalizeProSettings((await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
}
export async function saveProSettings(settings: ProSettings): Promise<void> {
  if (settings.serverUrl) validateServerUrl(settings.serverUrl);
  await browser.storage.local.set({ [SETTINGS_KEY]: normalizeProSettings(settings) });
}
export function validateProData(path: string, data: unknown): void {
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : undefined;
  const route = path.split('?')[0] ?? '';
  if (route === '/v1/info' && (!row || !identity(row.serverId) || row.apiVersion !== PRO_API_VERSION)) throw new Error('Incompatible or invalid Pro server info.');
  if (route === '/v1/pair' && (!row || !identity(row.serverId) || !identity(row.deviceId))) throw new Error('Invalid pairing response.');
  if (route === '/v1/health' && (!row || !identity(row.serverId) || row.apiVersion !== PRO_API_VERSION || !['LOCKED','READY','UNAVAILABLE'].includes(String(row.signer)) || !['PAUSED','RUNNING','RECOVERING'].includes(String(row.engine)) || typeof row.wallet !== 'string' || !Number.isSafeInteger(row.at) || !row.limits || typeof row.limits !== 'object')) throw new Error('Invalid server health response.');
  if (route === '/v1/wallet') {
    const balances = Array.isArray(data) ? data : row?.balances;
    if (!Array.isArray(balances) || balances.length > 100 || balances.some(item => !item || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(item.mint) || !Number.isInteger(item.decimals) || item.decimals < 0 || item.decimals > 18 || ['totalRaw','reservedRaw','availableRaw'].some(key => typeof item[key] !== 'string' || !/^[0-9]{1,20}$/.test(item[key])))) throw new Error('Invalid wallet balance response.');
  }
  if (route === '/v1/health' && row?.capabilities !== undefined && (!Array.isArray(row.capabilities) || row.capabilities.some(v => typeof v !== 'string'))) throw new Error('Invalid server capabilities.');
  if (route === '/v1/recipients' || /^\/v1\/recipients\//.test(route)) {
    const recipients = Array.isArray(data) ? data : [data];
    if (recipients.length > 1000 || recipients.some(item => !item || !UUID.test(item.id) || !Number.isSafeInteger(item.version) || item.version < 1 || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 64 || /[\u0000-\u001f\u007f]/.test(item.name) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(item.address) || typeof item.active !== 'boolean' || !Number.isSafeInteger(item.createdAt))) throw new Error('Invalid recipient response.');
  }
  if (route === '/v1/withdrawals/preview') {
    if (!row || typeof row.id !== 'string' || !UUID.test(row.id) || !Number.isSafeInteger(row.expiresAt) || ['totalRaw','reservedRaw','availableRaw','maxRaw','feeLamports','rentLamports'].some(key => typeof row[key] !== 'string' || !/^[0-9]{1,20}$/.test(row[key] as string))) throw new Error('Invalid withdrawal preview.');
    validateWithdrawalSpec(row.spec);
  } else if (route === '/v1/withdrawals' || /^\/v1\/withdrawals\//.test(route)) {
    const withdrawals = Array.isArray(data) ? data : [data];
    if (withdrawals.length > 10000) throw new Error('Invalid withdrawal response.');
    for (const item of withdrawals) {
      if (!item || !UUID.test(item.id) || !Number.isSafeInteger(item.createdAt) || !Number.isSafeInteger(item.updatedAt) || !['AUTHORIZED','SIGNED','SUBMITTED','UNKNOWN','CONFIRMED','FINALIZED','FAILED','EXPIRED'].includes(item.state) || (item.signature !== undefined && (typeof item.signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(item.signature))) || (item.error !== undefined && typeof item.error !== 'string')) throw new Error('Invalid withdrawal response.');
      validateWithdrawalSpec(item.spec);
      if (item.id !== item.spec.requestId) throw new Error('Withdrawal identity mismatch.');
    }
  }
  if (route === '/v1/events') {
    const events = Array.isArray(data) ? data : row?.events;
    if (!Array.isArray(events) || events.length > 500 || events.some(item => !item || !Number.isSafeInteger(item.sequence) || item.sequence < 1 || typeof item.id !== 'string' || item.id.length > 128 || !Number.isSafeInteger(item.at) || typeof item.type !== 'string' || typeof item.message !== 'string')) throw new Error('Invalid event response.');
  }
  if (/^\/v[12]\/(orders|strategies)(?:\/|$)/.test(route)) {
    const orders = Array.isArray(data) ? data : Array.isArray(row?.orders) ? row.orders : [data];
    if (orders.length > 10000) throw new Error('Invalid order response.');
    for (const item of orders) {
      if (!item || typeof item.id !== 'string' || !/^[0-9a-f-]{36}(?::exit)?$/i.test(item.id) || !Number.isSafeInteger(item.revision) || item.revision < 1 || !item.spec || !Number.isSafeInteger(item.createdAt) || !Number.isSafeInteger(item.updatedAt) || !['OPEN','PAUSED','BLOCKED','SIGNING','SUBMITTED','UNKNOWN','CONFIRMED','FINALIZED','FAILED','CANCELLED','EXPIRED'].includes(item.state)) throw new Error('Invalid order response.');
      try {
        validateProSpec(item.spec, item.spec.expiresAt - 1);
        if (item.highWatermark !== undefined) usdUnits(item.highWatermark);
        if (item.currentPriceUsd !== undefined) usdUnits(item.currentPriceUsd);
        if (item.currentMcUsd !== undefined) usdUnits(item.currentMcUsd);
        if (item.highWatermarkMcUsd !== undefined) usdUnits(item.highWatermarkMcUsd);
        if (item.strategy !== undefined) {
          const progress = item.strategy;
          if (!progress || typeof progress !== 'object' || !/^[1-9][0-9]{0,19}$/.test(progress.baseRaw) || !/^[0-9]{1,20}$/.test(progress.remainingRaw) || BigInt(progress.remainingRaw) > BigInt(progress.baseRaw) || !Array.isArray(progress.steps) || progress.steps.length > 10 || new Set(progress.steps.map((step: { id?: unknown }) => step?.id)).size !== progress.steps.length) throw new Error('Invalid strategy progress.');
          for (const step of progress.steps) {
            if (!step || !UUID.test(step.id) || !['OPEN','SIGNING','FINALIZED','CANCELLED'].includes(step.state) || !item.spec.steps?.some((approved: { id: string }) => approved.id === step.id) || step.amountRaw !== undefined && (!/^[0-9]{1,20}$/.test(step.amountRaw) || BigInt(step.amountRaw) > BigInt(progress.baseRaw)) || step.trailActive !== undefined && typeof step.trailActive !== 'boolean') throw new Error('Invalid strategy step progress.');
            if (step.highWatermarkMcUsd !== undefined) usdUnits(step.highWatermarkMcUsd);
          }
        }
      } catch { throw new Error('Invalid order specification response.'); }
    }
  }
  if (route === '/v1/preview') {
    if (!row || !row.spec || typeof row.spec !== 'object') throw new Error('Invalid preview response.');
    try { validateProSpec(row.spec); } catch { throw new Error('Invalid preview specification response.'); }
  }
  if (route === '/v2/preview') {
    if (!row || !row.spec || !row.summary || typeof row.summary !== 'object') throw new Error('Invalid MC preview response.');
    validateProSpecV2(row.spec);
    const summary = row.summary as Record<string, unknown>;
    if (typeof summary.marketCapUsd !== 'string' || typeof summary.priceUsd !== 'string' || typeof summary.supplyRaw !== 'string' || !/^[1-9][0-9]{0,19}$/.test(summary.supplyRaw) || !Number.isInteger(summary.tokenDecimals) || Number(summary.tokenDecimals) < 0 || Number(summary.tokenDecimals) > 18 || !Number.isSafeInteger(summary.quoteAt) || typeof summary.outputRaw !== 'string' || !/^[1-9][0-9]{0,19}$/.test(summary.outputRaw) || typeof summary.networkBudgetRaw !== 'string' || !/^[1-9][0-9]{0,19}$/.test(summary.networkBudgetRaw)) throw new Error('Invalid MC preview observation.');
    if (usdUnits(summary.marketCapUsd) !== usdUnits(marketCapUsd(summary.priceUsd, summary.supplyRaw, Number(summary.tokenDecimals)))) throw new Error('MC preview differs from verified supply and quote.');
  }
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function deviceKey(write?: CryptoKeyPair): Promise<CryptoKeyPair | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('keys', write ? 'readwrite' : 'readonly');
    const req = write ? tx.objectStore('keys').put(write, 'device') : tx.objectStore('keys').get('device');
    tx.oncomplete = () => resolve(write ?? req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
function base64(bytes: ArrayBuffer): string { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
async function request(origin: string, method: string, path: string, body?: string, headers?: Record<string, string> | (() => Promise<Record<string, string>>)): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < (method === 'GET' ? 2 : 1); attempt++) {
      try { const proofHeaders = typeof headers === 'function' ? await headers() : headers; response = await fetch(`${origin}${path}`, { method, body, headers: { 'Content-Type': 'application/json', ...proofHeaders }, signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' }); break; }
      catch (error) { if (controller.signal.aborted || method !== 'GET' || attempt > 0) throw error; }
    }
    if (!response) throw new Error('Server could not be reached.');
    const reply: unknown = await response.json();
    if (!reply || typeof reply !== 'object' || typeof (reply as { ok?: unknown }).ok !== 'boolean') throw new Error('Invalid Pro response envelope.');
    const result = reply as { ok: boolean; data?: unknown; error?: unknown };
    if (!response.ok || !result.ok) throw new Error(typeof result.error === 'string' ? String(sanitizeDiagnostic(result.error)) : `Server returned ${response.status}.`);
    validateProData(path, result.data);
    return result.data;
  } catch (error) {
    throw new Error(String(sanitizeDiagnostic(error instanceof Error ? error.message : 'Pro request failed.')));
  } finally { clearTimeout(timer); }
}
export async function pair(serverUrl: string, code: string): Promise<ProSettings> {
  const origin = validateServerUrl(serverUrl);
  if (!code.trim()) throw new Error('Enter the one-time pairing code.');
  const current = await loadProSettings();
  if (current.enabled) throw new Error('Disable Pro before pairing another server.');
  const info = await request(origin, 'GET', '/v1/info') as { serverId: string };
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicKeySpki = base64(await crypto.subtle.exportKey('spki', keys.publicKey));
  const result = await request(origin, 'POST', '/v1/pair', canonicalJson({ code: code.trim(), publicKeySpki })) as { deviceId: string; serverId: string };
  if (!result.deviceId || !info.serverId || result.serverId !== info.serverId) throw new Error('Pairing server identity mismatch.');
  await deviceKey(keys);
  const settings = { ...current, enabled: false, serverUrl: origin, deviceId: result.deviceId, serverId: result.serverId };
  await saveProSettings(settings);
  await browser.storage.local.remove(['proEventCursor', 'proEventIds']);
  return settings;
}
export type ProSessionBinding = { serverId: string; deviceId: string; wallet: string };
export async function proFetch(method: string, path: string, value?: unknown, expectedSession?: ProSessionBinding): Promise<unknown> {
  const settings = await loadProSettings();
  if (!settings.deviceId || !settings.serverId) throw new Error('Pair your personal server first.');
  if (expectedSession && (settings.serverId !== expectedSession.serverId || settings.deviceId !== expectedSession.deviceId)) throw new Error('Pro session changed. Review the order again for the current server wallet.');
  const key = await deviceKey();
  if (!key) throw new Error('Device key is missing. Pair again.');
  const body = value === undefined ? '' : canonicalJson(value);
  return request(validateServerUrl(settings.serverUrl), method, path, body || undefined, async () => {
    // A read retry gets a fresh nonce; request bytes remain fixed across attempts.
    const envelope = { timestamp: Date.now(), nonce: crypto.randomUUID() };
    const message = authMessage(settings.serverId!, { method, path, body, envelope });
    const signature = base64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, new TextEncoder().encode(message)));
    return { 'x-dp-device': settings.deviceId!, 'x-dp-time': String(envelope.timestamp), 'x-dp-nonce': envelope.nonce, 'x-dp-signature': signature };
  });
}

/** Worker-only read stream. No trading request is retried by this transport. */
export async function streamProEvents(after:number,onEvent:(event:import('./contracts').ProEvent)=>void,signal:AbortSignal):Promise<void>{
  if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid event cursor.');
  const settings=await loadProSettings(),key=await deviceKey();
  if(!settings.enabled||!settings.deviceId||!settings.serverId||!key)throw new Error('Enable paired Pro first.');
  const path=`/v1/events/stream?after=${after}`,envelope={timestamp:Date.now(),nonce:crypto.randomUUID()};
  const signature=base64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,new TextEncoder().encode(authMessage(settings.serverId,{method:'GET',path,body:'',envelope}))));
  const response=await fetch(`${validateServerUrl(settings.serverUrl)}${path}`,{method:'GET',headers:{'x-dp-device':settings.deviceId,'x-dp-time':String(envelope.timestamp),'x-dp-nonce':envelope.nonce,'x-dp-signature':signature},signal,credentials:'omit',redirect:'error',cache:'no-store'});
  if(!response.ok||!response.body||!response.headers.get('content-type')?.includes('text/event-stream'))throw new Error('Event stream unavailable.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  try{while(!signal.aborted){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});
    let boundary:number;while((boundary=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);if(frame.length>65536)throw new Error('Event stream frame exceeded limit.');if(!frame.startsWith('data: '))continue;
      const event=JSON.parse(frame.slice(6)) as import('./contracts').ProEvent;validateProData('/v1/events',[event]);if(event.sequence>after){after=event.sequence;onEvent(event);}
    }
    if(buffer.length>65536)throw new Error('Event stream frame exceeded limit.');
  }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
