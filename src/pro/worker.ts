import { browser } from 'wxt/browser';
import { loadProSettings, saveProSettings, pair, proFetch, streamProEvents } from './client';
import { exportDiagnostics, setDebugUntil,logEvent } from '../diagnostics/diagnostics';
import { canonicalJson, PRO_API_VERSION } from './contracts';
import type { ProEvent, ProHealth, ProReply, ProSettings, ProRequest } from './contracts';
import type {Browser} from 'wxt/browser';
import {defaultPreferences,validateTradingPreferences} from './trading-preferences';
export type {ProRequest} from './contracts';
export function allowedProRequest(method: string, path: string): boolean {
  if(method==='GET'&&/^\/v1\/portfolio(?:\?mint=[1-9A-HJ-NP-Za-km-z]{32,44})?$/.test(path))return true;
  if(method==='POST'&&path==='/v2/recover-initials/preview')return true;
  if(method==='GET'&&/^\/v1\/chart-entry\?mint=[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(path))return true;
  const latest=method==='GET'?/^\/v1\/events\?latest=([1-9][0-9]{0,2})$/.exec(path):null;
  if(latest)return Number(latest[1])<=500;
  const v2Order = /^\/v2\/(orders|strategies)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?::exit)?$/i;
  if (method === 'GET' && /^\/v2\/(orders|strategies)$/.test(path)) return true;
  if (method === 'PATCH' && v2Order.test(path)) return true;
  if (method === 'POST' && (/^\/v2\/(preview|orders|strategies)$/.test(path) || v2Order.test(path.replace(/\/(pause|resume|cancel|retry)$/, '')) && /\/(pause|resume|cancel|retry)$/.test(path))) return true;
  if (method === 'GET') return /^\/v1\/withdrawals\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(path) || /^\/v1\/(health|diagnostics|orders|recipients|withdrawals)$/.test(path) || /^\/v1\/events(?:\?after=\d+)?$/.test(path) || /^\/v1\/wallet(?:\?mint=[1-9A-HJ-NP-Za-km-z]{32,44})?$/.test(path);
  if(method==='PATCH')return /^\/v1\/orders\/[0-9a-f-]{36}(?::exit)?$/.test(path);
  return method === 'POST' && (/^\/v1\/recipients\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/deactivate$/i.test(path) || /^\/v1\/(preview|orders|pause-all|resume-engine|diagnostics\/debug|recipients|withdrawals|withdrawals\/preview)$/.test(path) || /^\/v1\/orders\/[0-9a-f-]{36}(?::exit)?\/(pause|resume|cancel|retry)$/.test(path));
}
export function createProWorker() {
  let polling = false;
  let operation = Promise.resolve();
  async function chartEntry(request:ProRequest):Promise<ProReply>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      return await Promise.race([ (async():Promise<ProReply>=>{
        const before=await loadProSettings();
        if(!before.enabled||!before.serverId||!before.deviceId)throw new Error('Enable paired Pro before reading chart entry.');
        const result=await execute(request);
        const after=await loadProSettings();
        if(!after.enabled||before.serverUrl!==after.serverUrl||before.serverId!==after.serverId||before.deviceId!==after.deviceId)throw new Error('Pro session changed during chart entry read.');
        return result;
      })(),new Promise<ProReply>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Chart entry read timed out.')),8000);})]);
    }catch(error){return {ok:false,error:error instanceof Error?error.message:'Chart entry unavailable.'};}
    finally{if(timer)clearTimeout(timer);}
  }
  async function execute(request: ProRequest): Promise<ProReply> {
    try {
      let data: unknown;
      switch (request.action) {
        case 'PREFERENCES_GET': {
          const stored=(await browser.storage.local.get('proTradingPreferences')).proTradingPreferences;
          data=stored===undefined?defaultPreferences():validateTradingPreferences(stored);break;
        }
        case 'PREFERENCES_SAVE': {
          const preferences=validateTradingPreferences(request.preferences);
          await browser.storage.local.set({proTradingPreferences:preferences});
          data=preferences;break;
        }
        case 'SETTINGS': {
          const current = await loadProSettings();
          if (request.settings) {
            if (request.settings.serverUrl !== current.serverUrl || request.settings.enabled !== current.enabled) throw new Error('Use pairing and enable/disable controls to change the Pro session.');
            await saveProSettings({ ...current, chromeNotifications: request.settings.chromeNotifications });
          }
          data = await loadProSettings(); break;
        }
        case 'PAIR': data = await pair(request.serverUrl ?? '', request.code ?? ''); break;
        case 'ENABLE': {
          const current = await loadProSettings();
          if (!current.deviceId || !current.serverId) throw new Error('Pair your personal server in Settings first.');
          const health = await proFetch('GET', '/v1/health') as ProHealth;
          if (health.apiVersion !== PRO_API_VERSION) throw new Error('Incompatible Pro server API version.');
          if (health.serverId !== current.serverId) throw new Error('Server identity mismatch.');
          if (health.signer !== 'READY') throw new Error('Unlock the signer on its private server console before enabling Pro.');
          // The user's switch authorizes engine resume, never resuming individual paused orders.
          // Persist ON first so a lost acknowledgement cannot conceal possibly running orders.
          await saveProSettings({ ...current, enabled: true });
          try {
            await proFetch('POST', '/v1/resume-engine', {});
            const resumed = await proFetch('GET', '/v1/health') as ProHealth;
            if (resumed.engine !== 'RUNNING' || resumed.signer !== 'READY') throw new Error('Engine readiness was not confirmed.');
            data = resumed;
          } catch {
            throw new Error('Start unconfirmed: Pro remains enabled. Reconnect and check the engine before registering orders.');
          }
          break;
        }
        case 'DISABLE': {
          const current = await loadProSettings();
          try { await proFetch('POST', '/v1/pause-all', {}); }
          catch { throw new Error('Stop unconfirmed: server pause could not be confirmed. Pro remains enabled; reconnect and retry.'); }
          await saveProSettings({ ...current, enabled: false }); data = await loadProSettings(); break;
        }
        case 'REQUEST': {
          const method = request.method ?? 'GET'; const path = request.path ?? '';
          if (!allowedProRequest(method, path)) throw new Error('Unsupported Pro API request.');
          if (method !== 'GET' && !(await loadProSettings()).enabled) throw new Error('Enable Pro before changing orders.');
          let body = request.body;
          if (method !== 'GET' && path.startsWith('/v2/')) {
            const expected = request.expectedSession;
            if (!expected || !expected.serverId || !expected.deviceId || !expected.wallet) throw new Error('Review the order against the current server wallet first.');
            const current = await loadProSettings();
            if (current.serverId !== expected.serverId || current.deviceId !== expected.deviceId) throw new Error('Pro session changed. Review the order again.');
            const health = await proFetch('GET', '/v1/health', undefined, expected) as ProHealth;
            if (health.serverId !== expected.serverId || health.wallet !== expected.wallet) throw new Error('Server wallet changed. Review the order again.');
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid reviewed order body.');
            // Wallet identity is part of the authenticated body, not a caller-controlled spec field.
            body = { ...body, expectedWallet: expected.wallet };
          }
          // Preference saves and order mutations share this queue. Fence the captured
          // native-view policy immediately before dispatch, including after health reads.
          if((method==='POST'&&/^\/v2\/(orders|strategies)$/.test(path))||request.expectedPreferences!==undefined){
            const stored=(await browser.storage.local.get('proTradingPreferences')).proTradingPreferences;
            const preferences=stored===undefined?defaultPreferences():validateTradingPreferences(stored);
            if(request.expectedPreferences!==canonicalJson(preferences))throw new Error('Trading preferences changed. Review the order again.');
          }
          data = await proFetch(method, path, body, request.expectedSession); break;
        }
        case 'EXPORT': data = { browser: JSON.parse(await exportDiagnostics()), server: await proFetch('GET', '/v1/diagnostics') }; break;
        case 'DEBUG':
          setDebugUntil(Date.now()+15*60_000);
          if((await loadProSettings()).enabled)await proFetch('POST','/v1/diagnostics/debug',{minutes:15});
          data={debugUntil:Date.now()+15*60_000};break;
        default: throw new Error('Unsupported Pro action.');
      }
      return { ok: true, data };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Pro request failed.' }; }
  }
  return {
    watchEvents(port:Browser.runtime.Port):void{
      let controller:AbortController|undefined,closed=false;
      port.onMessage.addListener(message=>{
        if(closed||message?.type!=='WATCH'||!Number.isSafeInteger(message.after)||message.after<0){port.disconnect();return;}
        controller?.abort();controller=new AbortController();const current=controller;
        void streamProEvents(message.after,(event)=>{if(!closed&&!current.signal.aborted)port.postMessage({type:'PRO_EVENT',event});},current.signal).catch(error=>{if(!current.signal.aborted)logEvent({level:'error',component:'pro.stream',type:'pro.stream.interrupted',details:{error}});}).finally(()=>{if(!closed&&controller===current)port.disconnect();});
      });
      port.onDisconnect.addListener(()=>{closed=true;controller?.abort();});
    },
    handle(request: ProRequest): Promise<ProReply> {
      if(request.action==='REQUEST'&&(request.method??'GET')==='GET'&&/^(?:\/v1\/chart-entry\?mint=[1-9A-HJ-NP-Za-km-z]{32,44}|\/v1\/portfolio(?:\?mint=[1-9A-HJ-NP-Za-km-z]{32,44})?)$/.test(request.path??''))return chartEntry(request);
      // Serialize session changes and mutations, including disable, to preserve intent.
      const result = operation.then(() => execute(request));
      operation = result.then(() => undefined, () => undefined);
      return result;
    },
    async pollNotifications(): Promise<void> {
      if (polling) return; polling = true;
      try {
        const settings = await loadProSettings();
        if (!settings.enabled || !settings.chromeNotifications || !await browser.permissions.contains({ permissions: ['notifications'] })) return;
        const stored = await browser.storage.local.get(['proEventCursor', 'proEventIds']);
        const cursor = Number(stored.proEventCursor ?? 0);
        const data = await proFetch('GET', `/v1/events?after=${cursor}`) as ProEvent[] | { events: ProEvent[] };
        const events = Array.isArray(data) ? data : data.events;
        const seen = new Set<string>(Array.isArray(stored.proEventIds) ? stored.proEventIds.filter((id): id is string => typeof id === 'string') : []);
        let next = cursor;
        for (const event of events) {
          next = Math.max(next, event.sequence);
          if (seen.has(event.id)) continue;
          seen.add(event.id);
          await browser.notifications.create(event.id, { type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title: 'Direct Pump Pro', message: `${event.type}${event.orderId ? ` · ${event.orderId.slice(0, 8)}` : ''}` });
        }
        await browser.storage.local.set({ proEventCursor: next, proEventIds: [...seen].slice(-1000) });
      } catch { /* A failed poll never changes execution state or acknowledgement cursor. */ }
      finally { polling = false; }
    },
  };
}
