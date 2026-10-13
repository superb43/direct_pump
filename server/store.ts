import {orderNetworkReservation} from './order-budget';
import { DatabaseSync } from 'node:sqlite';
import { ServerDiagnostics } from './diagnostics';
import { criticalNotification } from './notify';
import { randomUUID } from 'node:crypto';
import type { ProOrder, ProAttempt, ProEvent } from '../src/pro/contracts';
export const SOL = 'So11111111111111111111111111111111111111112';
export class ProStore {
    readonly db: DatabaseSync;
    readonly diagnostics: ServerDiagnostics;
    constructor(path: string) {
        this.db = new DatabaseSync(path);
        this.diagnostics = new ServerDiagnostics(path === ':memory:' ? ':memory:' : `${path}.diagnostics.sqlite`);
        this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reservations(order_id TEXT,mint TEXT,raw TEXT NOT NULL,PRIMARY KEY(order_id,mint));
      CREATE TABLE IF NOT EXISTS locks(wallet TEXT PRIMARY KEY,attempt_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(event_id TEXT PRIMARY KEY,text TEXT NOT NULL,next_at INTEGER NOT NULL DEFAULT 0,tries INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    }
    atomic<T>(fn: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = fn();
            this.db.exec('COMMIT');
            return result;
        }
        catch (e) {
            this.db.exec('ROLLBACK');
            throw e;
        }
    }
    orders(): ProOrder[] { return this.db.prepare('SELECT json FROM orders').all().map(r => JSON.parse(String(r.json))); }
    order(id: string): ProOrder {
        const r = this.db.prepare('SELECT json FROM orders WHERE id=?').get(id);
        if (!r)
            throw new Error('Order not found.');
        return JSON.parse(String(r.json));
    }
    save(order: ProOrder) { this.db.prepare('INSERT INTO orders VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(order.id, JSON.stringify(order)); }
    attempts(): ProAttempt[] { return this.db.prepare('SELECT json FROM attempts').all().map(r => JSON.parse(String(r.json))); }
    saveAttempt(a: ProAttempt) { this.db.prepare('INSERT INTO attempts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(a.id, a.orderId, JSON.stringify(a)); }
    reserved(mint: string, except?: string): bigint { return this.db.prepare('SELECT raw,order_id FROM reservations WHERE mint=?').all(mint).reduce((sum, r) => sum + (r.order_id === except ? 0n : BigInt(String(r.raw))), 0n); }
    reserve(order: ProOrder, balances: Record<string, bigint>) {
        const wants: Record<string, bigint> = { [SOL]: orderNetworkReservation(order,this.attempts()) };
        const mint = order.spec.side === 'BUY' ? SOL : order.spec.mint;
        wants[mint] = (wants[mint] ?? 0n) + BigInt(order.strategy?.remainingRaw??order.spec.amountRaw);
        for (const [asset, raw] of Object.entries(wants))
            if ((balances[asset] ?? 0n) - this.reserved(asset, order.id) < raw)
                throw new Error('Insufficient unreserved balance.');
        this.replaceReservations(order.id,Object.entries(wants));
    }
    /** Called inside the caller's atomic financial transition. */
    replaceReservations(orderId:string,assets:readonly [string,bigint][]):void{
        this.release(orderId);
        for(const [asset,raw] of assets)this.db.prepare('INSERT INTO reservations VALUES(?,?,?)').run(orderId,asset,String(raw));
    }
    removeAttempt(id:string):void{this.db.prepare('DELETE FROM attempts WHERE id=?').run(id);}
    release(id: string) { this.db.prepare('DELETE FROM reservations WHERE order_id=?').run(id); }
    claim(wallet: string, attempt: string) { this.db.prepare('INSERT INTO locks VALUES(?,?)').run(wallet, attempt); }
    locked(wallet: string) { return !!this.db.prepare('SELECT 1 FROM locks WHERE wallet=?').get(wallet); }
    unlock(wallet: string, attempt: string) { this.db.prepare('DELETE FROM locks WHERE wallet=? AND attempt_id=?').run(wallet, attempt); }
    event(type: string, message: string, order?: ProOrder, attempt?: ProAttempt): ProEvent {
        const event: ProEvent = { sequence: 0, id: randomUUID(), at: Date.now(), type, message, ...order ? { orderId: order.id } : {}, ...attempt ? { attemptId: attempt.id, signature: attempt.signature } : {} };
        const result = this.db.prepare('INSERT INTO events(id,json) VALUES(?,?)').run(event.id, JSON.stringify(event));
        event.sequence = Number(result.lastInsertRowid);
        this.db.prepare('UPDATE events SET json=? WHERE id=?').run(JSON.stringify(event), event.id);
        this.diagnostics.log({ component: 'engine', type: `order.${type.toLowerCase()}`, level: type === 'FAILED' ? 'error' : type === 'UNKNOWN' ? 'warn' : 'info', orderId: event.orderId, attemptId: event.attemptId, signature: event.signature, details: { message } });
        if (criticalNotification(type)) {
            const count = Number(this.db.prepare('SELECT COUNT(*) AS n FROM outbox').get()?.n ?? 0);
            if (count < 10000)
                this.db.prepare('INSERT OR IGNORE INTO outbox(event_id,text) VALUES(?,?)').run(event.id, JSON.stringify(event));
            else
                this.diagnostics.log({ component: 'notify', type: 'alert.queue.full', level: 'error', orderId: event.orderId, attemptId: event.attemptId, signature: event.signature, code: 'OUTBOX_CAPACITY', details: { count } });
        }
        return event;
    }
    events(after = 0): ProEvent[] { return this.db.prepare('SELECT json FROM events WHERE sequence>? ORDER BY sequence LIMIT 500').all(after).map(r => JSON.parse(String(r.json))); }
    latestEvents(limit=30):ProEvent[]{return this.db.prepare('SELECT json FROM events ORDER BY sequence DESC LIMIT ?').all(limit).reverse().map(r=>JSON.parse(String(r.json)));}
    meta(key: string, value?: string): string | undefined {
        if (value !== undefined)
            this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
        return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value as string | undefined;
    }
    close() { this.diagnostics.close(); this.db.close(); }
}
