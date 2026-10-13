import { DatabaseSync } from 'node:sqlite';
import { APP_VERSION } from '../src/app-version';
import { sanitizeDiagnostic, type DiagnosticEvent, type DiagnosticInput } from '../src/diagnostic-sanitize';
export const DIAGNOSTIC_RETENTION_MS = 30 * 86400000;
export const DIAGNOSTIC_MAX_BYTES = 250 * 1024 * 1024;
export class ServerDiagnostics {
    readonly db: DatabaseSync;
    private debugUntil = 0;
    private nextPrune = 0;
    constructor(path: string, readonly maxBytes = DIAGNOSTIC_MAX_BYTES, readonly clock = Date.now) {
        this.db = new DatabaseSync(path);
        this.db.exec(`PRAGMA page_size=4096;PRAGMA auto_vacuum=FULL;PRAGMA journal_mode=DELETE;PRAGMA secure_delete=ON;PRAGMA busy_timeout=1000;PRAGMA max_page_count=${Math.max(16, Math.floor(maxBytes / 4096))};CREATE TABLE IF NOT EXISTS diagnostics(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,json TEXT NOT NULL);CREATE INDEX IF NOT EXISTS diagnostics_at ON diagnostics(at);`);
        this.prune();
    }
    setDebug(minutes: number) { if (!Number.isInteger(minutes) || minutes < 0 || minutes > 60)
        throw new Error('Debug duration must be between 0 and 60 minutes.'); this.debugUntil = this.clock() + minutes * 60000; return { debugUntil: minutes ? this.debugUntil : 0 }; }
    log(input: DiagnosticInput): void {
        try {
            const now = this.clock();
            if (input.level === 'debug' && now >= this.debugUntil)
                return;
            if (/(?:price[._-]?(?:tick|update))|^tick$/i.test(input.type))
                return;
            const clean = sanitizeDiagnostic(input) as Record<string, unknown>;
            const event: DiagnosticEvent = { type: String(clean.type ?? 'unknown').slice(0, 120), component: String(clean.component ?? 'server').slice(0, 80), level: input.level, at: now, version: APP_VERSION };
            for (const key of ['requestId', 'orderId', 'attemptId', 'signature', 'code'] as const)
                if (typeof clean[key] === 'string')
                    event[key] = (clean[key] as string).slice(0, 200);
            if (typeof input.duration === 'number' && Number.isFinite(input.duration) && input.duration >= 0)
                event.duration = input.duration;
            if (clean.details !== undefined)
                event.details = sanitizeDiagnostic(clean.details);
            if (now >= this.nextPrune) {
                this.prune();
                this.nextPrune = now + 60000;
            }
            const value = JSON.stringify(event);
            try {
                this.db.prepare('INSERT INTO diagnostics(at,json) VALUES(?,?)').run(now, value);
            }
            catch {
                this.prune(true);
                this.db.prepare('INSERT INTO diagnostics(at,json) VALUES(?,?)').run(now, value);
            }
        }
        catch { /* Diagnostics cannot change execution or API behavior. */ }
    }
    prune(force = false) { this.db.prepare('DELETE FROM diagnostics WHERE at<?').run(this.clock() - DIAGNOSTIC_RETENTION_MS); const pages = Number(this.db.prepare('PRAGMA page_count').get()?.page_count ?? 0); if (force || pages * 4096 >= this.maxBytes * 0.9) {
        this.db.exec('DELETE FROM diagnostics WHERE id IN(SELECT id FROM diagnostics ORDER BY id LIMIT (SELECT MAX(1,COUNT(*)/4) FROM diagnostics))');
    } }
    latest(limit = 500): DiagnosticEvent[] { const count = Math.max(0, Math.min(5000, Math.floor(limit))); return this.db.prepare('SELECT json FROM diagnostics ORDER BY id DESC LIMIT ?').all(count).reverse().map(row => sanitizeDiagnostic(JSON.parse(String(row.json))) as DiagnosticEvent); }
    close() { this.db.close(); }
}
