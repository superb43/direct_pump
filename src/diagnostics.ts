import { readDiagnostics, writeDiagnostic } from './diagnostic-store';
import { APP_VERSION } from './app-version';

import {sanitizeDiagnostic,cleanDiagnosticText as cleanText,type DiagnosticValue,type DiagnosticEvent,type DiagnosticInput,type DiagnosticFilter} from './diagnostic-sanitize';
export {sanitizeDiagnostic,DIAGNOSTIC_TEXT_LIMIT} from './diagnostic-sanitize';
export type {DiagnosticLevel,DiagnosticValue,DiagnosticEvent,DiagnosticInput,DiagnosticFilter} from './diagnostic-sanitize';

export const DIAGNOSTIC_DEBUG_MAX_MS = 60 * 60 * 1000;
const DETAIL_KEYS = new Set(['message', 'error', 'reason', 'name', 'code', 'status', 'state', 'previousState', 'nextState', 'operation', 'method', 'route', 'site', 'kind', 'side', 'mint', 'wallet', 'publicKey', 'signature', 'requestId', 'orderId', 'attemptId', 'duration', 'retry', 'count', 'slot', 'blockHeight', 'lastValidBlockHeight', 'network', 'source', 'connected', 'enabled', 'version', 'expected', 'actual', 'cause', 'issues', 'field']);

function eventDetails(input: unknown): DiagnosticValue {
  const sanitized = sanitizeDiagnostic(input);
  function whitelist(value: DiagnosticValue): DiagnosticValue {
    if (Array.isArray(value)) return value.map(whitelist);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => DETAIL_KEYS.has(key)).map(([key, item]) => [key, whitelist(item)]));
    return value;
  }
  return whitelist(sanitized);
}
let debugUntil = 0;
let pending = Promise.resolve();
let queuedWrites = 0;
export function setDebugUntil(ts: number): void {
  debugUntil = Number.isFinite(ts) ? Math.max(0, Math.min(ts, Date.now() + DIAGNOSTIC_DEBUG_MAX_MS)) : 0;
}

/** Never throws or returns a rejected promise into order/trading control flow. */
export function logEvent(input: DiagnosticInput): void {
  try {
    const now = Date.now();
    if (queuedWrites >= 256) return;
    if (input.level === 'debug' && now >= debugUntil || /(?:^|[._:-])price[._:-]?(?:tick|update)(?:$|[._:-])/i.test(input.type)) return;
    if (!['debug', 'info', 'warn', 'error'].includes(input.level)) return;
    const event: DiagnosticEvent = {
      type: cleanText(input.type).slice(0, 120), at: typeof input.at === 'number' && Number.isFinite(input.at) && input.at >= 0 && input.at <= now ? input.at : now, level: input.level,
      component: cleanText(input.component).slice(0, 80), version: cleanText(input.version ?? APP_VERSION).slice(0, 40),
    };
    for (const key of ['requestId', 'orderId', 'attemptId', 'signature', 'code'] as const) {
      if (typeof input[key] === 'string') event[key] = cleanText(input[key]).slice(0, 200);
    }
    if (typeof input.duration === 'number' && Number.isFinite(input.duration) && input.duration >= 0) event.duration = input.duration;
    if (input.details !== undefined) event.details = eventDetails(input.details);
    queuedWrites++;
    pending = pending.then(() => writeDiagnostic(event)).catch(() => {}).finally(() => { queuedWrites--; });
  } catch { /* Diagnostics must never change trade behavior. */ }
}

export async function diagnosticEvents(filter: DiagnosticFilter = {}): Promise<DiagnosticEvent[]> {
  try {
    await pending;
    const events = (await readDiagnostics()).map(event => sanitizeDiagnostic(event) as DiagnosticEvent);
    const selected = events.filter(event => Object.entries(filter).every(([key, value]) => ['since', 'until', 'limit'].includes(key) || event[key as keyof DiagnosticEvent] === value))
      .filter(event => (filter.since === undefined || event.at >= filter.since) && (filter.until === undefined || event.at <= filter.until));
    if (filter.limit === undefined) return selected;
    const limit = Number.isFinite(filter.limit) ? Math.max(0, Math.min(5000, Math.floor(filter.limit))) : 0;
    return limit ? selected.slice(-limit) : [];
  } catch { return []; }
}
export async function exportDiagnostics(): Promise<string> {
  return JSON.stringify({ schemaVersion: 1, exportedAt: Date.now(), events: await diagnosticEvents() }, null, 2);
}
