import type { ProStore } from './store';
import type { ProEvent } from '../src/pro/contracts';
import { sanitizeDiagnostic } from '../src/diagnostics/diagnostics';
export const TELEGRAM_PREFIX = '[DIRECT_PUMP]';
export function criticalNotification(type: string) { return /^(CONFIRMED|FINALIZED|FAILED|EXPIRED|UNKNOWN|PROTECTION_ACTIVE|PROTECTION_PENDING|SERVICE_ERROR|SIGNER_ERROR|RISK_BLOCKED)$/.test(type); }
function notificationText(value: string) {
    try {
        const event = JSON.parse(value) as ProEvent;
        const message = String(sanitizeDiagnostic(event.message));
        return `${TELEGRAM_PREFIX} ${event.type}: ${message}${event.orderId ? `\nOrder ${event.orderId}` : ''}${'withdrawalId' in event ? `\nWithdrawal ${event.withdrawalId}` : ''}${event.signature ? `\nhttps://solscan.io/tx/${event.signature}` : ''}`;
    }
    catch {
        return `${TELEGRAM_PREFIX} ${String(sanitizeDiagnostic(value)).replace(/^\[DIRECT_PUMP\]\s*/, '')}`;
    }
}
export class TelegramOutbox {
    private flushing = false;
    constructor(private store: ProStore, private token = process.env.DP_TELEGRAM_TOKEN, private chatId = process.env.DP_TELEGRAM_CHAT_ID, private request: typeof fetch = fetch, private threadId = process.env.DP_TELEGRAM_THREAD_ID) { }
    async flush(now = Date.now()) {
        if (this.flushing || !this.token || !this.chatId)
            return;
        this.flushing = true;
        try {
            const rows = this.store.db.prepare('SELECT * FROM outbox WHERE next_at<=? LIMIT 20').all(now);
            for (const row of rows)
                try {
                    if (this.threadId && !/^[1-9][0-9]{0,12}$/.test(this.threadId))
                        throw new Error('Invalid Telegram thread configuration.');
                    const response = await this.request(`https://api.telegram.org/bot${this.token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: this.chatId, text: notificationText(String(row.text)), ...this.threadId ? { message_thread_id: Number(this.threadId) } : {} }), signal: AbortSignal.timeout(5000) });
                    if (!response.ok || !(await response.json() as {
                        ok: boolean;
                    }).ok)
                        throw new Error('Delivery failed.');
                    this.store.db.prepare('DELETE FROM outbox WHERE event_id=?').run(String(row.event_id));
                }
                catch {
                    const tries = Math.min(1000000000, Number(row.tries) + 1);
                    this.store.db.prepare('UPDATE outbox SET tries=?,next_at=? WHERE event_id=?').run(tries, now + Math.min(3600000, 1000 * 2 ** Math.min(tries, 12)), String(row.event_id));
                    this.store.diagnostics.log({ component: 'notify', type: 'alert.delivery.failed', level: 'warn', requestId: String(row.event_id), code: 'TELEGRAM_DELIVERY_FAILED', details: { count: tries, retry: tries } });
                }
        }
        catch {
            this.store.diagnostics.log({ component: 'notify', type: 'alert.outbox.failed', level: 'error', code: 'OUTBOX_UNAVAILABLE' });
        }
        finally {
            this.flushing = false;
        }
    }
}
