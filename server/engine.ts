import {orderNetworkReservation} from './order-budget';
import {deriveExitSpec,orderTriggered,mcObservation,strategyTrigger,initStrategy,executionSpec,settleStrategy,hasProtection} from './strategy';
import { randomUUID } from 'node:crypto';
import { canonicalJson, validateProSpec, type ProOrder, type ProAttempt, type ProSpec, type AuthProof, type ProHealth } from '../src/pro/contracts';
import { ProStore, SOL } from './store';
import {WalletBusyError} from './errors';
import {dailyBuyExposure} from './risk-policy';
export type Observation = {
    priceUsd: string;
    solUsdMicros: bigint;
    quoteAt: number;
    solUsdAt: number;
    observedAt: number;
    outputRaw: string;
    supplyRaw?: string;
    tokenDecimals?: number;
};
export interface MarketPort {
    observation(spec: ProSpec): Promise<Observation>;
    tokenDecimals?(mint: string): Promise<number>;
    balances(mint: string): Promise<Record<string, bigint>>;
    submit(bytes: string): Promise<string>;
    reconcile(attempt: ProAttempt, order: ProOrder): Promise<{
        state: 'UNKNOWN' | 'CONFIRMED' | 'FINALIZED' | 'FAILED' | 'EXPIRED';
        receivedRaw?: string;
        fillPriceUsd?: string;
        tokenDecimals?: number;
        confirmedAt?: number;
    }>;
}
export interface SignerPort {
    executionReady?():Promise<boolean>;
    status(): Promise<'READY' | 'LOCKED' | 'UNAVAILABLE'>;
    registerOrder(order: ProOrder, proof: AuthProof): Promise<void>;
    sign(orderId: string, attemptId: string): Promise<{
        signedTransaction: string;
        signature: string;
        blockhash: string;
        lastValidBlockHeight: number; networkRaw?:string; inputRaw?:string;strategyStepId?:string;
    }>;
    control(command: string, proof: AuthProof): Promise<void>;
    inspect(orderId?: string): Promise<{
        order?: ProOrder;
        paused: boolean;
    }>;
    recover?(orderId: string, attemptId: string): Promise<{
        signedTransaction: string;
        signature: string;
        blockhash: string;
        lastValidBlockHeight: number;networkRaw?:string;inputRaw?:string;strategyStepId?:string;
    } | null>;
}
const terminal = new Set(['FINALIZED', 'FAILED', 'CANCELLED', 'EXPIRED']);
export class ProEngine {
    state: 'PAUSED' | 'RUNNING' | 'RECOVERING' = 'RECOVERING';
    private ticking = false;
    private mutating = new Set<string>();
    private async exclusive<T>(id: string, work: () => Promise<T>): Promise<T> { if (this.mutating.has(id))
        throw new Error('Order command is already in progress.'); this.mutating.add(id); try {
        return await work();
    }
    finally {
        this.mutating.delete(id);
    } }
    constructor(readonly store: ProStore, readonly market: MarketPort, readonly signer: SignerPort, readonly wallet: string, readonly limits: ProHealth['limits'], readonly clock = Date.now) {
        for (const order of store.orders())
            if ((order.spec.kind === 'TRAILING'||order.spec.steps?.some(s=>s.kind==='TRAILING')) && !terminal.has(order.state) && !['SIGNING', 'SUBMITTED', 'UNKNOWN', 'CONFIRMED'].includes(order.state)) {
                order.state = 'PAUSED';
                order.reason = 'Explicit resume required after observation gap.';
                store.save(order);
            }
    }
    async health(serverId: string): Promise<ProHealth> {
        const signer = await this.signer.status();
        try {
            if (this.state === 'RUNNING' && (await this.signer.inspect()).paused)
                this.state = 'PAUSED';
        }
        catch {
            if (this.state === 'RUNNING')
                this.state = 'PAUSED';
        }
        return { apiVersion: 1, serverId, wallet: this.wallet, signer, engine: this.state, at: this.clock(), limits: this.limits };
    }
    async preview(input: unknown) {
        const spec = validateProSpec(input, this.clock());
        if (BigInt(spec.maxNetworkLamports) > BigInt(this.limits.maxNetworkLamports) || spec.side === 'BUY' && BigInt(spec.amountRaw) > BigInt(this.limits.maxBuyLamports))
            throw new Error('Order exceeds server risk limits.');
        const observation = await this.market.observation(spec);
        this.fresh(observation);
        return { spec, summary: { ...(spec.version===2?{marketCapUsd:mcObservation(observation),supplyRaw:observation.supplyRaw,tokenDecimals:observation.tokenDecimals,quoteAt:observation.quoteAt}:{}), priceUsd: observation.priceUsd, outputRaw: observation.outputRaw, networkBudgetRaw: spec.maxNetworkLamports } };
    }
    fresh(o: Observation) {
        const now = this.clock();
        if (o.quoteAt > now || o.solUsdAt > now || o.observedAt > now || now - o.quoteAt > 2000 || now - o.solUsdAt > 30000 || now - o.observedAt > 5000)
            throw new Error('Market observation is stale.');
    }
    private stage(order: ProOrder, action: string, proof: AuthProof, targetState: ProOrder['state'], balances?: Record<string, bigint>) {
        this.store.atomic(() => {
            if (balances) {
                if (action === 'protection' && order.parentId)
                    this.store.release(order.parentId);
                this.store.reserve(order, balances);
            }
            order.state = 'BLOCKED';
            order.reason = 'Awaiting signer acknowledgement; this intent is not executable.';
            order.pendingAction = action as ProOrder['pendingAction'];
            this.store.save(order);
            this.store.meta(`mutation:${order.id}`, JSON.stringify({ action, targetState, proof }));
            if (action === 'create' || action === 'edit')
                this.store.meta(`proof:${order.id}`, JSON.stringify(proof));
        });
    }
    private completeMutation(id: string) {
        const raw = this.store.meta(`mutation:${id}`);
        if (!raw)
            return;
        const pending = JSON.parse(raw) as {
            action: string;
            targetState: ProOrder['state'];
        };
        const order = this.store.order(id);
        this.store.atomic(() => {
            order.state = pending.targetState;
            order.reason = undefined;
            order.pendingAction = undefined;
            order.updatedAt = this.clock();
            if (order.state === 'CANCELLED') {
                if(order.parentId){const parent=this.store.order(order.parentId);parent.protectionPending=false;parent.reason='Exit protection cancelled.';this.store.save(parent);const parentAttempt=this.store.attempts().find(a=>a.orderId===parent.id&&a.state==='CONFIRMED');if(parentAttempt&&!this.store.locked(this.wallet))this.store.claim(this.wallet,parentAttempt.id);}
                this.store.release(id);
                if (this.store.meta('protected-wallet') === id)
                    this.store.meta('protected-wallet', '');
            }
            if (pending.action === 'resume')
                this.store.meta(`observation:${id}`, String(this.clock()));
            this.store.save(order);
            this.store.meta(`mutation:${id}`, '');
            if (pending.action === 'protection' && order.parentId) {
                const parent = this.store.order(order.parentId);
                parent.protectionPending = false;
                parent.reason = undefined;
                this.store.meta(`protection-alert:${parent.id}`, '');
                this.store.save(parent);
                const attempt = this.store.attempts().find(a => a.orderId === parent.id && ['CONFIRMED', 'FINALIZED'].includes(a.state));
                if (attempt)
                    this.store.unlock(this.wallet, attempt.id);
                if (parent.state !== 'FINALIZED')
                    this.store.meta('protected-wallet', order.id);
                this.store.event('PROTECTION_ACTIVE', 'Confirmed fill protection activated.', order);
            }
            else
                this.store.event(pending.action.toUpperCase(), 'Signer acknowledged order intent.', order);
        });
    }
    private async recoverMutations() {
        for (const order of this.store.orders()) {
            const raw = this.store.meta(`mutation:${order.id}`);
            if (!raw || this.mutating.has(order.id))
                continue;
            const pending = JSON.parse(raw) as {
                targetState: ProOrder['state'];
            };
            const authoritative = await this.signer.inspect(order.id);
            if (authoritative.order && authoritative.order.revision === order.revision && canonicalJson(authoritative.order.spec) === canonicalJson(order.spec) && authoritative.order.state === pending.targetState)
                this.completeMutation(order.id);
        }
        const global = this.store.meta('engine-mutation');
        if (global) {
            const pending = JSON.parse(global) as {
                action: string;
            };
            const authoritative = await this.signer.inspect();
            if (authoritative.paused === (pending.action === 'pause-all')) {
                this.state = pending.action === 'pause-all' ? 'PAUSED' : 'RUNNING';
                this.store.meta('engine-mutation', '');
            }
        }
    }
    async create(id: string, input: unknown, proof: AuthProof) { return this.exclusive(id, () => this.createIntent(id, input, proof)); }
    private async createIntent(id: string, input: unknown, proof: AuthProof) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
            throw new Error('Order ID must be a UUID.');
        const spec = (await this.preview(input)).spec, existing = this.store.orders().find(o => o.id === id);
        if (existing) {
            if (canonicalJson(existing.spec) !== canonicalJson(spec))
                throw new Error('Order ID already exists with a different intent.');
            return existing;
        }
        const active = this.store.orders().filter(o => !terminal.has(o.state));
        if (active.length >= 20 || new Set([...active.map(o => o.spec.mint), spec.mint]).size > 10)
            throw new Error('Active order capacity exceeded.');
        const balances = await this.market.balances(spec.mint), order: ProOrder = { id, revision: 1, spec, wallet: this.wallet, state: 'BLOCKED', createdAt: this.clock(), updatedAt: this.clock() };
        initStrategy(order);
        this.stage(order, 'create', proof, 'OPEN', balances);
        await this.signer.registerOrder({ ...order, state: 'OPEN' }, proof);
        this.completeMutation(id);
        return this.store.order(id);
    }
    async change(id: string, revision: number, action: 'pause' | 'resume' | 'cancel' | 'edit', proof: AuthProof, input?: unknown) { return this.exclusive(id, () => this.changeIntent(id, revision, action, proof, input)); }
    private async changeIntent(id: string, revision: number, action: 'pause' | 'resume' | 'cancel' | 'edit', proof: AuthProof, input?: unknown) {
        const order = this.store.order(id);
        if (order.revision !== revision)
            throw new Error('Order revision conflict.');
        if (this.store.meta(`mutation:${id}`) || ['SIGNING', 'SUBMITTED', 'UNKNOWN', 'CONFIRMED'].includes(order.state) || terminal.has(order.state))
            throw new Error('Order cannot be changed while unresolved or terminal.');
        const previousState = order.state;
        if (action === 'edit') {
            const replacement=(await this.preview(input)).spec;
            if(order.strategy){if(replacement.kind!=='STRATEGY'||replacement.amountRaw!==order.strategy.baseRaw)throw new Error('Strategy base quantity is fixed.');for(const step of order.strategy.steps.filter(r=>r.state==='FINALIZED'))if(canonicalJson(order.spec.steps!.find(r=>r.id===step.id))!==canonicalJson(replacement.steps!.find(r=>r.id===step.id)))throw new Error('Executed steps cannot change.');order.strategy.steps=replacement.steps!.map(r=>order.strategy!.steps.find(p=>p.id===r.id)??{id:r.id,state:'OPEN'});}
            order.spec = replacement;
            order.highWatermark = undefined;
            order.trailActive = false;
        }
        const balances = action === 'edit' || action === 'resume' ? await this.market.balances(order.spec.mint) : undefined;
        const current=this.store.order(id);
        if(current.revision!==revision||current.state!==previousState||this.store.meta(`mutation:${id}`))throw new Error('Order changed during review. Review again.');
        order.revision++;
        const targetState = action === 'cancel' ? 'CANCELLED' : action === 'pause' || action === 'edit' && previousState === 'PAUSED' ? 'PAUSED' : 'OPEN';
        this.stage(order, action, proof, targetState, balances);
        if (action === 'edit')
            await this.signer.registerOrder({ ...order, state: 'OPEN' }, proof);
        else
            await this.signer.control(action, proof);
        this.completeMutation(id);
        return this.store.order(id);
    }
    async retry(id: string, revision: number, spec: unknown, action: string, proof: AuthProof) {
        return this.exclusive(id, async () => {
            let order = this.store.orders().find(row=>row.id===id);
            if(!order){
                if(action!=='cancel'||revision!==1||!proof.path.startsWith('/v2/')||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(id))throw new Error('Order not found.');
                const cancelled=validateProSpec(spec,Math.min(this.clock(),Number((spec as ProSpec)?.expiresAt)-1));
                if(cancelled.version!==2)throw new Error('Missing-order cancellation requires MC version 2.');
                order={id,revision:1,spec:cancelled,wallet:this.wallet,state:'BLOCKED',createdAt:this.clock(),updatedAt:this.clock()};
                this.stage(order,'cancel',proof,'CANCELLED');
                await this.signer.control('cancel',proof);
                this.completeMutation(id);
                return this.store.order(id);
            }
            if (order.revision !== revision || canonicalJson(spec) !== canonicalJson(order.spec))
                throw new Error('Pending intent differs from retry request.');
            const raw = this.store.meta(`mutation:${id}`);
            if (!raw) {
                if(action!=='cancel'||!proof.path.startsWith('/v2/')||order.state==='CANCELLED')return order;
                if(!['OPEN','PAUSED','BLOCKED'].includes(order.state))throw new Error('Order cannot be cancelled while unresolved or terminal.');
                this.stage(order,'cancel',proof,'CANCELLED');
                await this.signer.control('cancel',proof);
                this.completeMutation(id);
                return this.store.order(id);
            }
            const pending = JSON.parse(raw) as {
                action: string;
                targetState: ProOrder['state'];
                proof: AuthProof;
            };
            if (action !== pending.action && action !== 'cancel')
                throw new Error('Retry action differs from pending command.');
            const acknowledged = (await this.signer.inspect(id)).order;
            if (action !== 'cancel' && acknowledged && acknowledged.revision === revision && canonicalJson(acknowledged.spec) === canonicalJson(order.spec) && ['OPEN', 'PAUSED', 'CANCELLED'].includes(acknowledged.state)) {
                pending.targetState = acknowledged.state;
                this.store.meta(`mutation:${id}`, JSON.stringify(pending));
                this.completeMutation(id);
                return this.store.order(id);
            }
            if (action === 'cancel') {
                this.stage(order, 'cancel', proof, 'CANCELLED');
                await this.signer.control('cancel', proof);
            }
            else if (['create', 'edit', 'protection'].includes(action)) {
                this.stage(order, action, action === 'protection' ? pending.proof : proof, pending.targetState);
                await this.signer.registerOrder({ ...order, state: pending.targetState }, action === 'protection' ? pending.proof : proof);
            }
            else {
                this.stage(order, action, proof, pending.targetState);
                await this.signer.control(action, proof);
            }
            this.completeMutation(id);
            return this.store.order(id);
        });
    }
    async control(action: 'pause-all' | 'resume-engine', proof: AuthProof) {
        this.state = 'PAUSED';
        this.store.atomic(() => {
            this.store.meta('engine-mutation', JSON.stringify({ action, proof }));
            if (action === 'pause-all')
                for (const order of this.store.orders())
                    if (['OPEN', 'BLOCKED'].includes(order.state)) {
                        const mutation = this.store.meta(`mutation:${order.id}`);
                        if (mutation) {
                            const pending = JSON.parse(mutation);
                            if (pending.targetState === 'OPEN') {
                                pending.targetState = 'PAUSED';
                                this.store.meta(`mutation:${order.id}`, JSON.stringify(pending));
                            }
                        }
                        order.state = 'PAUSED';
                        this.store.save(order);
                    }
        });
        await this.signer.control(action, proof);
        this.state = action === 'pause-all' ? 'PAUSED' : 'RUNNING';
        this.store.meta('engine-mutation', '');
        this.store.event(action.toUpperCase(), 'Engine state updated.');
    }
    private deferAttempt(order:ProOrder,attempt:ProAttempt,error:WalletBusyError):void{
        this.store.atomic(()=>{this.store.removeAttempt(attempt.id);this.store.unlock(this.wallet,attempt.id);order.state=this.state==='RUNNING'?'OPEN':'PAUSED';order.reason=error.message;this.store.save(order);});
    }
    private async reconcileAttempt(attempt:ProAttempt):Promise<void>{
        const order = this.store.order(attempt.orderId);
        if (!attempt.signature) {
            if (!this.signer.recover) {
                attempt.state = 'UNKNOWN';
                order.state = 'UNKNOWN';
                this.store.saveAttempt(attempt);
                this.store.save(order);
                return;
            }
            let recovered;
            try {
                recovered = await this.signer.recover(order.id, attempt.id);
            }
            catch (error) {
                if(error instanceof WalletBusyError)this.deferAttempt(order,attempt,error);
                return;
            }
            if (!recovered) {
                this.store.atomic(() => {
                    attempt.state = 'FAILED';
                    order.state = 'FAILED';
                    this.store.saveAttempt(attempt);
                    this.store.save(order);
                    this.store.release(order.id);
                    this.store.unlock(this.wallet, attempt.id);
                    if (this.store.meta('protected-wallet') === order.id)
                        this.store.meta('protected-wallet', '');
                    this.store.event('FAILED', 'Signer proved no authorization existed for this attempt.', order, attempt);
                });
                return;
            }
            Object.assign(attempt, recovered, { state: 'SIGNED' });
            order.signature = recovered.signature;
            this.store.atomic(() => { this.store.saveAttempt(attempt); this.store.save(order); });
            try {
                const signature = await this.market.submit(recovered.signedTransaction);
                if (signature !== recovered.signature)
                    throw new Error('Signature mismatch.');
                attempt.state = 'SUBMITTED';
                order.state = 'SUBMITTED';
            }
            catch {
                attempt.state = 'UNKNOWN';
                order.state = 'UNKNOWN';
            }
            this.store.saveAttempt(attempt);
            this.store.save(order);
        }
        const result = await this.market.reconcile(attempt, {...order,spec:executionSpec(order,attempt)});
        if (result.state === 'UNKNOWN')
            return;
        const changed = attempt.state !== result.state;
        this.store.atomic(() => {
            attempt.state = result.state;
            attempt.updatedAt = this.clock();
            if(result.state==='FINALIZED'&&order.spec.kind==='STRATEGY'){settleStrategy(order,attempt);order.state=BigInt(order.strategy!.remainingRaw)>0n&&order.strategy!.steps.some(s=>s.state==='OPEN')?'OPEN':'FINALIZED';}else order.state = result.state;
            order.updatedAt = this.clock();
            if (result.receivedRaw)
                order.receivedRaw = result.receivedRaw;
            const duration=order.spec.exitStrategy?.durationMs??order.spec.exit?.durationMs??86400000;
            const expiredProtection=hasProtection(order.spec)&&!this.store.orders().some(o=>o.parentId===order.id)&&(this.store.meta(`protection-expired:${order.id}`)==='1'||result.confirmedAt!==undefined&&Number.isSafeInteger(result.confirmedAt)&&result.confirmedAt>0&&result.confirmedAt<=this.clock()+1000&&result.confirmedAt+duration<=this.clock());
            if(expiredProtection){order.protectionPending=false;order.reason='Entry protection expired before activation.';if(this.store.meta(`protection-expired:${order.id}`)!=='1'){this.store.meta(`protection-expired:${order.id}`,'1');this.store.event('PROTECTION_EXPIRED',order.reason,order,attempt);}}
            const needsProtection = ['CONFIRMED','FINALIZED'].includes(result.state) && hasProtection(order.spec) && !expiredProtection && !this.store.orders().some(o => o.parentId === order.id);
            if (needsProtection && result.receivedRaw) {
                order.protectionPending = true;
                this.store.replaceReservations(order.id,[[order.spec.mint,BigInt(result.receivedRaw)],[SOL,BigInt(order.spec.maxNetworkLamports)]]);
            }
            this.store.saveAttempt(attempt);
            this.store.save(order);
            if (result.state === 'FAILED' || result.state === 'EXPIRED' || result.state === 'FINALIZED' && !needsProtection) {
                this.store.release(order.id);
                if(order.state==='OPEN'&&order.strategy)this.store.replaceReservations(order.id,[[order.spec.mint,BigInt(order.strategy.remainingRaw)],[SOL,orderNetworkReservation(order,this.store.attempts())]]);
                this.store.unlock(this.wallet, attempt.id);
                if (this.store.meta('protected-wallet') === order.id)
                    this.store.meta('protected-wallet', '');
            }
            if (result.state === 'FINALIZED' && hasProtection(order.spec) && this.store.meta('protected-wallet') === `${order.id}:exit`)
                this.store.meta('protected-wallet', '');
            if (changed)
                this.store.event(result.state, 'Chain status updated.', order, attempt);
        });
        if (result.receivedRaw && result.fillPriceUsd && this.store.meta(`protection-expired:${order.id}`)!=='1' && hasProtection(order.spec) && !this.store.orders().some(o => o.parentId === order.id))
            await this.activateExit(order, result.receivedRaw, result.fillPriceUsd, result.tokenDecimals, attempt, result.confirmedAt);
    }
    async tick() {
        if (this.ticking)
            return;
        this.ticking = true;
        try {
            try {
                await this.recoverMutations();
            }
            catch { /* Signer outage must not prevent chain reconciliation. */ }
            for (const attempt of this.store.attempts().filter(a => ['AUTHORIZED', 'SIGNED', 'SUBMITTED', 'UNKNOWN', 'CONFIRMED'].includes(a.state) || a.state === 'FINALIZED' && this.store.order(a.orderId).protectionPending)) {
                await this.reconcileAttempt(attempt);
            }
            if (this.state === 'RUNNING' && (await this.signer.inspect()).paused)
                this.state = 'PAUSED';
            if (this.state !== 'RUNNING' || await this.signer.status() !== 'READY' || this.store.locked(this.wallet))
                return;
            const walletReady=!this.signer.executionReady||await this.signer.executionReady();
            for (const order of this.store.orders().filter(o => (o.state === 'OPEN' || o.state === 'BLOCKED') && !this.mutating.has(o.id) && !this.store.meta(`mutation:${o.id}`) && (!this.store.meta('protected-wallet') || o.id === this.store.meta('protected-wallet')))) {
                if (order.spec.expiresAt <= this.clock()) {
                    order.state = 'EXPIRED';
                    this.store.atomic(() => {
                        this.store.release(order.id);
                        if (this.store.meta('protected-wallet') === order.id)
                            this.store.meta('protected-wallet', '');
                        this.store.save(order);
                        this.store.event('EXPIRED', 'Order expired.', order);
                    });
                    continue;
                }
                try {
                    const o = await this.market.observation(order.spec);
                    const current = this.store.order(order.id);
                    if (current.revision !== order.revision || !['OPEN', 'BLOCKED'].includes(current.state) || this.mutating.has(order.id) || this.store.meta(`mutation:${order.id}`))
                        continue;
                    this.fresh(o);
                    const previous = this.store.meta(`observation:${order.id}`);
                    if ((order.spec.kind === 'TRAILING'||order.spec.steps?.some(s=>s.kind==='TRAILING')) && previous && this.clock() - Number(previous) > 5000)
                        throw new Error('Explicit resume required after observation gap.');
                    this.store.meta(`observation:${order.id}`, String(this.clock()));
                    const ready = orderTriggered(order, o);
                    this.store.save(order);
                    if (!ready || !walletReady)
                        continue;
                    if (order.spec.side === 'BUY') {
                        const spent = dailyBuyExposure(this.store.attempts().map(a=>{const spec=this.store.order(a.orderId).spec;return {...a,buyRaw:spec.side==='BUY'?spec.amountRaw:'0'};}),this.clock());
                        if (spent + BigInt(order.spec.amountRaw) > BigInt(this.limits.dailyBuyLamports))
                            throw new Error('Daily buy cap exceeded.');
                    }
                    const balances = await this.market.balances(order.spec.mint);
                    const latest = this.store.order(order.id);
                    if (latest.revision !== order.revision || !['OPEN', 'BLOCKED'].includes(latest.state) || this.mutating.has(order.id) || this.store.meta(`mutation:${order.id}`))
                        continue;
                    const selected=order.spec.kind==='STRATEGY'?strategyTrigger(order,o):undefined;
                    const attempt: ProAttempt = { ...(selected?{strategyStepId:selected.id,inputRaw:selected.amountRaw}:{}), id: randomUUID(), orderId: order.id, state: 'AUTHORIZED', createdAt: this.clock(), updatedAt: this.clock() };
                    this.store.atomic(() => { this.store.reserve(order, balances); this.store.claim(this.wallet, attempt.id); order.state = 'SIGNING'; this.store.save(order); this.store.saveAttempt(attempt); });
                    try {
                        const signed = await this.signer.sign(order.id, attempt.id);
                        Object.assign(attempt, signed, { state: 'SIGNED' });
                        order.signature = signed.signature;
                        this.store.atomic(() => { this.store.saveAttempt(attempt); this.store.save(order); });
                        const returned = await this.market.submit(signed.signedTransaction);
                        if (returned !== signed.signature)
                            throw new Error('RPC returned a different signature.');
                        attempt.state = 'SUBMITTED';
                        order.state = 'SUBMITTED';
                    }
                    catch (error) {
                        if(error instanceof WalletBusyError){
                            this.deferAttempt(order,attempt,error);
                            break;
                        }
                        attempt.state = 'UNKNOWN';
                        order.state = 'UNKNOWN';
                        order.reason = 'Signing or submission outcome uncertain; reconciliation required.';
                    }
                    this.store.atomic(() => { this.store.saveAttempt(attempt); this.store.save(order); this.store.event(order.state, 'Execution attempt recorded.', order, attempt); });
                    break;
                }
                catch (e) {
                    const current = this.store.order(order.id);
                    if (current.revision !== order.revision || current.state === 'PAUSED' || this.mutating.has(order.id) || this.store.meta(`mutation:${order.id}`))
                        continue;
                    order.state = (order.spec.kind === 'TRAILING'||order.spec.steps?.some(s=>s.kind==='TRAILING')) ? 'PAUSED' : 'BLOCKED';
                    order.reason = e instanceof Error ? e.message : 'Order blocked.';
                    this.store.save(order);
                }
            }
        }
        finally {
            this.ticking = false;
        }
    }
    private async activateExit(parent: ProOrder, raw: string, price: string, decimals?: number, attempt?: ProAttempt, confirmedAt?: number) {
        try {
            if (!confirmedAt)
                throw new Error('Confirmed fill timestamp is unavailable.');
            const spec = deriveExitSpec(parent, raw, price, decimals ?? parent.spec.decimals, confirmedAt);
            const child: ProOrder = { id: `${parent.id}:exit`, parentId: parent.id, revision: 1, spec, wallet: this.wallet, state: 'OPEN', createdAt: this.clock(), updatedAt: this.clock() };
            initStrategy(child);
            const balances = await this.market.balances(spec.mint), proof = JSON.parse(this.store.meta(`proof:${parent.id}`)!) as AuthProof;
            this.stage(child, 'protection', proof, 'OPEN', balances);
            await this.signer.registerOrder({ ...child, state: 'OPEN' }, proof);
            this.completeMutation(child.id);
        }
        catch {
            parent.protectionPending = true;
            parent.reason = 'Exit protection is pending authoritative activation; funds remain reserved.';
            this.store.save(parent);
            if (!this.store.meta(`protection-alert:${parent.id}`)) {
                this.store.meta(`protection-alert:${parent.id}`, '1');
                this.store.event('PROTECTION_PENDING', parent.reason, parent, attempt);
            }
        }
    }
}
export {deriveExitSpec} from './strategy';
