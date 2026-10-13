import type { ProStore } from './store';
import type { AuthProof, ProEvent } from '../src/pro/contracts';

interface WithdrawalReader {
    withdrawal(method: string, proof?: AuthProof): Promise<unknown>;
}
type PublicStatus = { id: string; state: string; signature?: string };
const alertStates = new Set(['CONFIRMED', 'FINALIZED', 'FAILED', 'UNKNOWN', 'EXPIRED']);

/** Mirror public signer statuses into the existing durable alert stream. Never signs. */
export class WithdrawalService {
    private polling = false;
    private lastFailure = 0;
    constructor(private signer: WithdrawalReader, private store: ProStore) { }
    async poll() {
        if (this.polling) return;
        this.polling = true;
        try {
            const rows = await this.signer.withdrawal('withdrawals');
            if (!Array.isArray(rows)) throw new Error('Invalid withdrawal status response.');
            for (const row of rows as PublicStatus[]) {
                if (!row || typeof row.id !== 'string' || typeof row.state !== 'string')
                    throw new Error('Invalid withdrawal status.');
                const key = `withdrawal-alert:${row.id}`;
                this.store.atomic(() => {
                    const previous = this.store.meta(key);
                    if (previous === row.state) return;
                    const emit = (state: string) => {
                        const event = this.store.event(state, `Withdrawal ${state.toLowerCase()}.`);
                        const withdrawalEvent: ProEvent & { withdrawalId: string } = { ...event, withdrawalId: row.id, ...row.signature ? { signature: row.signature } : {} };
                        const json = JSON.stringify(withdrawalEvent);
                        this.store.db.prepare('UPDATE events SET json=? WHERE id=?').run(json, event.id);
                        this.store.db.prepare('UPDATE outbox SET text=? WHERE event_id=?').run(json, event.id);
                        this.store.diagnostics.log({ component: 'withdrawal', type: `withdrawal.${state.toLowerCase()}`, level: state === 'FAILED' || state === 'EXPIRED' ? 'error' : state === 'UNKNOWN' ? 'warn' : 'info', signature: row.signature, details: { withdrawalId: row.id } });
                    };
                    const confirmedKey = `withdrawal-confirmed-alert:${row.id}`;
                    if ((row.state === 'CONFIRMED' || row.state === 'FINALIZED') && !this.store.meta(confirmedKey)) {
                        emit('CONFIRMED');
                        this.store.meta(confirmedKey, '1');
                    }
                    if (alertStates.has(row.state) && row.state !== 'CONFIRMED') emit(row.state);
                    this.store.meta(key, row.state);
                });
            }
        } catch {
            if (Date.now() - this.lastFailure >= 60000) {
                this.lastFailure = Date.now();
                this.store.diagnostics.log({ component: 'withdrawal', type: 'withdrawal.status.failed', level: 'warn', code: 'WITHDRAWAL_STATUS_UNAVAILABLE' });
            }
        } finally {
            this.polling = false;
        }
    }
}
