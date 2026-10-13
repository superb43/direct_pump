import { sanitizeDiagnostic, type DiagnosticEvent } from './diagnostic-sanitize';

export const DIAGNOSTIC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const DIAGNOSTIC_MAX_BYTES = 5 * 1024 * 1024;
export const DIAGNOSTIC_DATABASE = 'direct-pump-diagnostics';
const COALESCE_MS = 60_000;
const encoder=new TextEncoder();
const bytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).length;

/** Pure ring policy shared by the persistent store and regression tests. */
export function retainDiagnostics(events: DiagnosticEvent[], now = Date.now(), maxBytes = DIAGNOSTIC_MAX_BYTES): DiagnosticEvent[] {
  const retained = events.filter(event => event.at >= now - DIAGNOSTIC_RETENTION_MS && event.at <= now)
    .map(event => ({ ...event })).sort((a, b) => a.at - b.at);
  let size=bytes(retained),start=0;
  while(start<retained.length&&size>maxBytes){size-=bytes(retained[start])+(retained.length-start>1?1:0);start++;}
  return start?retained.slice(start):retained;
}

export function appendDiagnostic(events: DiagnosticEvent[], event: DiagnosticEvent, now = Date.now()): DiagnosticEvent[] {
  const retained = retainDiagnostics(events, now);
  const fingerprint = (row: DiagnosticEvent) => JSON.stringify({ ...row, at: undefined, count: undefined, firstAt: undefined });
  const identity=event.level==='error'?fingerprint(event):undefined;
  const match = event.level === 'error' && [...retained].reverse().find(row => row.level === 'error' && event.at - row.at >= 0 && event.at - row.at <= COALESCE_MS && fingerprint(row) === identity);
  if (match) {
    match.firstAt ??= match.at;
    match.at = event.at;
    match.count = Math.min(Number.MAX_SAFE_INTEGER, (match.count ?? 1) + 1);
  } else retained.push({ ...event, count: 1 });
  return retainDiagnostics(retained, now);
}

let opened: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (opened) return opened;
  opened = new Promise((resolve, reject) => {
    const request = indexedDB.open(DIAGNOSTIC_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('ring');
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opened = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Diagnostic database blocked.'));
  });
  void opened.catch(() => { opened = undefined; });
  return opened;
}

// A single record and readwrite transaction make retention/coalescing atomic across contexts.
export async function writeDiagnostic(event: DiagnosticEvent): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('ring', 'readwrite');
    const store = tx.objectStore('ring');
    const request = store.get('events');
    request.onsuccess = () => {
      try { store.put(appendDiagnostic(request.result ?? [], sanitizeDiagnostic(event) as DiagnosticEvent), 'events'); }
      catch { tx.abort(); }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Diagnostic write failed.'));
  });
}

export async function readDiagnostics(): Promise<DiagnosticEvent[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ring', 'readwrite');
    const store = tx.objectStore('ring');
    const request = store.get('events');
    let retained: DiagnosticEvent[] = [];
    request.onsuccess = () => {
      try {
        retained = retainDiagnostics(request.result ?? []);
        store.put(retained, 'events');
      } catch { tx.abort(); }
    };
    tx.oncomplete = () => resolve(retained);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Diagnostic read failed.'));
  });
}
