import {orderNetworkReservation,strategyNetworkUsed} from './order-budget';
import {deriveExitSpec,orderTriggered,mcTriggered,strategyTrigger,initStrategy,executionSpec,settleStrategy,hasProtection} from './strategy';
import { createServer, createConnection, type Server } from 'node:net';
import { mkdir, chmod, unlink, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { AuthRegistry } from './auth';
import { unlockKeystoreSecret, keystoreWallet } from './keystore';
import { buildProExecution, setupRentLamports } from './execution';
import { RpcMarket } from './market';
import { type MarketPort, type Observation } from './engine';
import { canonicalJson, validateProSpec, usdUnits, type ProOrder, type ProSpec, type AuthProof, type ProHealth, type ProAttempt } from '../src/pro/contracts';
import type { Settings } from '../src/model';
import {claimSignerProcess} from './signer-lock';
import {ServerDiagnostics} from './diagnostics';
import {WithdrawalAuthority} from './withdrawals';
import {SOL} from './store';
import {WalletBusyError,SIGNER_REPLY_LIMIT,PairingCodeError,PAIRING_CODE_HELP} from './errors';
import type {ProBalance} from '../src/pro/contracts';
import {dailyBuyExposure} from './risk-policy';

export type SignerConfig = { serverId: string; socketPath: string; adminSocketPath: string; keystorePath: string; authPath: string; journalPath: string; rpcUrl: string; settings: Settings; limits: ProHealth['limits']; socketMode?: number };
type Signed = { signedTransaction: string; signature: string; blockhash: string; lastValidBlockHeight: number; solUsdUnits: string; networkRaw?:string; inputRaw?:string; strategyStepId?:string };
type JournalAttempt = Signed & ProAttempt & { buyRaw: string; deviceId: string; deferred?:boolean; networkRaw?:string; supplyRaw?:string; ledgerFill?:Awaited<ReturnType<MarketPort['reconcile']>> };
type Authorized = { order: ProOrder; deviceId: string; proof: AuthProof };

export class SigningAuthority {
  readonly auth: AuthRegistry;
  private db: DatabaseSync;
  private key?: Keypair;
  private secret?: Uint8Array;
  private queue: Promise<unknown> = Promise.resolve();
  private market: MarketPort;
  private connection: Connection;
  private wallet = '';
  private observing = false;
  private authorityGeneration = 0;
  private withdrawals:WithdrawalAuthority;
  readonly diagnostics:ServerDiagnostics;
  constructor(readonly config: SignerConfig, market?: MarketPort) {
    this.auth = new AuthRegistry(config.authPath, config.serverId);
    this.db = new DatabaseSync(config.journalPath);
    this.diagnostics=new ServerDiagnostics(`${config.journalPath}.diagnostics.sqlite`);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS authority(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS signing(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS controls(id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
    this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('paused', '1');
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.market = market ?? new RpcMarket(this.connection, new PublicKey('11111111111111111111111111111111'));
    this.withdrawals=new WithdrawalAuthority(this.db,this.auth,this.connection,()=>this.wallet,()=>this.key,config.limits.maxNetworkLamports,(settled)=>this.syncOrderLedger(settled),mint=>this.market.balances(mint));
  }
  async initialize(): Promise<void> {
    this.wallet = await keystoreWallet(this.config.keystorePath);
    if (this.market instanceof RpcMarket) this.market = new RpcMarket(this.connection, new PublicKey(this.wallet),fetch,true);
    if(this.market instanceof RpcMarket)this.market.onStreamError=error=>this.diagnostics.log({level:'warn',component:'market',type:'price.watch.failed',details:{error}});
    await chmod(this.config.journalPath, 0o600);
  }
  status(): 'READY' | 'LOCKED' { return this.key ? 'READY' : 'LOCKED'; }
  isPaused(): boolean { return this.db.prepare('SELECT value FROM meta WHERE key=?').get('paused')?.value !== '0'; }
  async unlock(password: string): Promise<void> {
    const generation=++this.authorityGeneration;
    this.secret?.fill(0);this.secret=undefined;this.key=undefined;
    const secret=await unlockKeystoreSecret(this.config.keystorePath,password);
    if(generation!==this.authorityGeneration){secret.fill(0);throw new Error('Signer authority changed while unlocking.');}
    this.secret=secret;this.key=Keypair.fromSecretKey(secret);
  }
  lock(): void { this.authorityGeneration++;this.secret?.fill(0);this.secret=undefined;this.key = undefined; this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('paused','1'); }
  private serial<T>(job: () => Promise<T>): Promise<T> { const result = this.queue.then(job); this.queue = result.catch(() => undefined); return result; }
  private getOrder(id: string): Authorized {
    const row = this.db.prepare('SELECT value FROM authority WHERE id=?').get(id);
    if (!row) throw new Error('Order is not authorized.');
    return JSON.parse(String(row.value)) as Authorized;
  }
  private putOrder(record: Authorized): void { this.db.prepare('INSERT OR REPLACE INTO authority VALUES(?,?)').run(record.order.id, canonicalJson(record)); }
  private attempts(): JournalAttempt[] { return this.db.prepare('SELECT value FROM signing').all().map(row => JSON.parse(String(row.value)) as JournalAttempt); }
  private putAttempt(attempt: JournalAttempt): void { this.db.prepare('INSERT OR REPLACE INTO signing VALUES(?,?,?)').run(attempt.id, attempt.orderId, canonicalJson(attempt)); }
  private orderRecords():Authorized[]{return this.db.prepare('SELECT value FROM authority').all().map(row=>JSON.parse(String(row.value)) as Authorized);}
  private orderWants(order:ProOrder,attempts:JournalAttempt[]=this.attempts()):Record<string,bigint>{const wants:Record<string,bigint>={[SOL]:orderNetworkReservation(order,attempts)};const asset=order.spec.side==='BUY'?SOL:order.spec.mint;wants[asset]=(wants[asset]??0n)+BigInt(order.spec.kind==='STRATEGY'?order.strategy?.remainingRaw??order.spec.amountRaw:order.spec.amountRaw);return wants;}
  private async syncOrderLedger(requireSettled=false):Promise<void>{
    const fills=new Map<string,Awaited<ReturnType<MarketPort['reconcile']>>>();
    const attempts=this.attempts();
    for(const attempt of attempts.filter(a=>!['FAILED','EXPIRED'].includes(a.state)&&a.signedTransaction)){
      const order=this.getOrder(attempt.orderId).order;
      const fill=attempt.state==='FINALIZED'&&attempt.ledgerFill?attempt.ledgerFill:await this.market.reconcile(attempt,{...order,spec:executionSpec(order,attempt)});fills.set(order.id,fill);
      if(fill.state!=='UNKNOWN'){attempt.state=fill.state;attempt.ledgerFill=fill;this.putAttempt(attempt);if(fill.state==='FINALIZED'&&order.spec.kind==='STRATEGY'){const record=this.getOrder(order.id);const step=record.order.strategy?.steps.find(r=>r.id===attempt.strategyStepId);if(step&&step.state!=='FINALIZED'){settleStrategy(record.order,attempt);if(!['PAUSED','CANCELLED','EXPIRED'].includes(record.order.state))record.order.state=BigInt(record.order.strategy!.remainingRaw)>0n&&record.order.strategy!.steps.some(s=>s.state==='OPEN')?'OPEN':'FINALIZED';this.putOrder(record);}}}
      if(requireSettled&&!['FINALIZED','FAILED','EXPIRED'].includes(attempt.state))throw new Error('Previous trade is awaiting final settlement.');
    }
    const records=this.orderRecords();
    const latest=new Map<string,JournalAttempt>(),byOrder=new Map<string,JournalAttempt[]>(),children=new Set(records.map(record=>record.order.parentId));
    for(const attempt of attempts){let rows=byOrder.get(attempt.orderId);if(!rows){rows=[];byOrder.set(attempt.orderId,rows);}rows.push(attempt);if(attempt.signedTransaction)latest.set(attempt.orderId,attempt);}
    this.db.exec('BEGIN IMMEDIATE');
    try{
    this.db.prepare("DELETE FROM wallet_reservations WHERE owner LIKE 'order:%'").run();
    for(const a of records){
      const owner=`order:${a.order.id}`,attempt=latest.get(a.order.id),fill=fills.get(a.order.id);
      let wants:Record<string,bigint>={};
      if(attempt&&(!['FAILED','EXPIRED','CONFIRMED','FINALIZED'].includes(attempt.state)||a.order.spec.kind==='STRATEGY'&&attempt.state==='CONFIRMED'))wants=this.orderWants(a.order,byOrder.get(a.order.id)??[]);
      else if((!attempt||a.order.spec.kind==='STRATEGY'&&attempt.state==='FINALIZED')&&!['CANCELLED','EXPIRED','FAILED','CONFIRMED','FINALIZED'].includes(a.order.state)&&a.order.spec.expiresAt>Date.now())wants=this.orderWants(a.order,byOrder.get(a.order.id)??[]);
      if(hasProtection(a.order.spec)&&fill?.receivedRaw&&['CONFIRMED','FINALIZED'].includes(fill.state)&&!children.has(a.order.id)){
        // Confirmed entry proceeds stay reserved even while child activation is delayed.
        const expiry=fill.confirmedAt===undefined?Infinity:fill.confirmedAt+(a.order.spec.exitStrategy?.durationMs??a.order.spec.exit?.durationMs??86400_000);
        if(expiry>Date.now()){wants[a.order.spec.mint]=BigInt(fill.receivedRaw);wants[SOL]=(wants[SOL]??0n)+BigInt(a.order.spec.maxNetworkLamports);}
      }
      this.withdrawals.ledger.replace(owner,wants);
    }
    this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  private async authorizeReservation(order:ProOrder):Promise<void>{
    await this.withdrawals.reconcile();await this.syncOrderLedger();
    const balances=await this.market.balances(order.spec.mint),wants=this.orderWants(order);
    // A derived child takes over the independently observed entry-protection reservation.
    const parent=order.parentId?`order:${order.parentId}`:undefined;
    const previous=parent?this.db.prepare('SELECT mint,raw FROM wallet_reservations WHERE owner=?').all(parent):[];
    if(parent)this.withdrawals.ledger.release(parent);
    try{this.withdrawals.ledger.assertAvailable(`order:${order.id}`,wants,balances);}catch(e){if(parent)this.withdrawals.ledger.replace(parent,Object.fromEntries(previous.map(r=>[String(r.mint),BigInt(String(r.raw))])));throw e;}
    this.withdrawals.ledger.replace(`order:${order.id}`,wants);
  }
  withdrawal(method:string,proof?:AuthProof):Promise<unknown>{return this.serial(()=>this.withdrawals.call(method,proof));}
  walletBalances(mint:string):Promise<ProBalance[]>{return this.serial(async()=>{const balances=await this.withdrawals.walletBalances(mint);return Promise.all(balances.map(async b=>({...b,decimals:b.mint===SOL?9:await this.market.tokenDecimals?.(b.mint)??0})));});}
  executionReady():Promise<boolean>{return this.serial(async()=>{await this.withdrawals.reconcile();return !this.withdrawals.hasUnsettled();});}
  reconcileWithdrawals():Promise<void>{return this.serial(()=>this.withdrawals.reconcile());}
  private fresh(o: Observation): void { const now = Date.now(); if (o.quoteAt > now || o.observedAt > now || o.solUsdAt > now || now-o.quoteAt>2000 || now-o.observedAt>5000 || now-o.solUsdAt>30000) throw new Error('Signer price observation is stale.'); usdUnits(o.priceUsd); }
  async registerOrder(order: ProOrder, proof: AuthProof): Promise<void> {
    return this.serial(async () => {
      if (order.wallet !== this.wallet) throw new Error('Signing wallet mismatch.');
      if (order.parentId) {
        const parent = this.getOrder(order.parentId);
        if(parent.order.wallet!==this.wallet||parent.order.spec.version===2&&(JSON.parse(parent.proof.body) as {expectedWallet?:string}).expectedWallet!==this.wallet)throw new Error('Parent signing wallet changed.');
        if (canonicalJson(proof) !== canonicalJson(parent.proof) || order.id !== `${parent.order.id}:exit` || !hasProtection(parent.order.spec) || !this.auth.isActive(parent.deviceId)) throw new Error('Invalid child authorization.');
        const successful=this.attempts().filter(a=>a.orderId===parent.order.id&&a.signature&&!a.deferred&&!['FAILED','EXPIRED'].includes(a.state));
        if(successful.length!==1)throw new Error('Entry fill authority is ambiguous or unavailable.');
        const attempt=successful[0];
        if (!attempt) throw new Error('Entry attempt is not recorded.');
        const fill = await this.market.reconcile(attempt as ProAttempt, parent.order);
        if (!['CONFIRMED','FINALIZED'].includes(fill.state) || !fill.receivedRaw || !fill.fillPriceUsd || fill.tokenDecimals === undefined) throw new Error('Confirmed entry quantity is unavailable.');
        if(fill.confirmedAt===undefined)throw new Error('Entry confirmation time is unavailable.');
        const expected = deriveExitSpec(parent.order, fill.receivedRaw, fill.fillPriceUsd, fill.tokenDecimals,fill.confirmedAt);
        if (canonicalJson(expected) !== canonicalJson(order.spec)) throw new Error('Protection differs from confirmed entry.');
        const existing = this.db.prepare('SELECT value FROM authority WHERE id=?').get(order.id);
        if (existing) { if (canonicalJson((JSON.parse(String(existing.value)) as Authorized).order.spec) !== canonicalJson(order.spec)) throw new Error('Child intent changed.'); return; }
        order={id:order.id,parentId:parent.order.id,revision:1,spec:expected,wallet:this.wallet,state:'OPEN',createdAt:Date.now(),updatedAt:Date.now()};initStrategy(order);
        await this.authorizeReservation(order);
        this.putOrder({ order: { ...order, state:'OPEN' }, deviceId: parent.deviceId, proof });
        return;
      }
      const deviceId = this.auth.verify(proof, false);
      const body = JSON.parse(proof.body) as { orderId?: string; spec?: unknown; revision?: number;action?:string;expectedWallet?:string };
      const spec = validateProSpec(body.spec);
      if((spec.version===2||body.expectedWallet!==undefined)&&body.expectedWallet!==this.wallet)throw new Error("Reviewed signing wallet changed.");
      if (canonicalJson(spec) !== canonicalJson(order.spec)) throw new Error('Order differs from authenticated intent.');
      if (spec.side === 'BUY' && (spec.decimals !== 9 || BigInt(spec.amountRaw) > BigInt(this.config.limits.maxBuyLamports)) || BigInt(spec.maxNetworkLamports) > BigInt(this.config.limits.maxNetworkLamports)) throw new Error('Signer risk limit exceeded.');
      const previous = this.db.prepare('SELECT value FROM authority WHERE id=?').get(order.id);
      const route=order.spec.version===2?'/v2':'/v1';const collection=proof.path.includes('/strategies')?'strategies':'orders';
      const retry=proof.method==='POST'&&proof.path===`${route}/${collection}/${order.id}/retry`&&body.revision===order.revision;
      if(retry&&body.action!==(previous?'edit':'create'))throw new Error('Retry action cannot authorize this order operation.');
      if(previous&&['CANCELLED','EXPIRED','FAILED','CONFIRMED','FINALIZED','SIGNING','SUBMITTED','UNKNOWN'].includes((JSON.parse(String(previous.value)) as Authorized).order.state))throw new Error('Terminal or unresolved order cannot be authorized again.');
      if ((proof.method === 'POST' && proof.path === `${route}/${collection}` && body.orderId === order.id || retry&&!previous) && order.revision === 1) {
        if (previous) {
          const record = JSON.parse(String(previous.value)) as Authorized;
          if (record.deviceId !== deviceId || canonicalJson(record.order.spec) !== canonicalJson(spec)) throw new Error('Order authorization conflict.');
          return;
        }
      } else if ((proof.method === 'PATCH' && proof.path === `${route}/${collection}/${order.id}` || retry) && previous) {
        const record = JSON.parse(String(previous.value)) as Authorized;
        if(retry&&record.deviceId===deviceId&&order.revision===record.order.revision&&canonicalJson(spec)===canonicalJson(record.order.spec))return;
        if (record.deviceId !== deviceId || body.revision !== record.order.revision+(retry?1:0) || order.revision !== record.order.revision+1 || this.attempts().some(a => a.orderId===order.id && !(order.spec.kind==='STRATEGY'?['FAILED','EXPIRED','FINALIZED']:['FAILED','EXPIRED']).includes(a.state))) throw new Error('Order is unresolved or revision changed.');
      } else throw new Error('Invalid order authorization command.');
      if(previous&&order.spec.kind==='STRATEGY'){const old=(JSON.parse(String(previous.value)) as Authorized).order;for(const step of old.strategy?.steps.filter(r=>r.state==='FINALIZED')??[]){if(canonicalJson(old.spec.steps!.find(r=>r.id===step.id))!==canonicalJson(order.spec.steps!.find(r=>r.id===step.id)))throw new Error('Executed strategy steps cannot change.');}order.strategy=old.strategy;if(old.spec.amountRaw!==order.spec.amountRaw)throw new Error('Strategy base quantity is fixed.');if(order.strategy)order.strategy.steps=order.spec.steps!.map(r=>order.strategy!.steps.find(p=>p.id===r.id)??{id:r.id,state:'OPEN'});}
      if(order.spec.kind!=='STRATEGY')order.strategy=undefined;
      if(!previous){order.strategy=undefined;order.highWatermarkMcUsd=undefined;}
      initStrategy(order);
        await this.authorizeReservation(order);
      const previousState=previous?(JSON.parse(String(previous.value)) as Authorized).order.state:'OPEN';
      this.putOrder({ order: { ...order, state:previousState==='PAUSED'?'PAUSED':'OPEN', highWatermark:undefined, highWatermarkMcUsd:undefined, trailActive:false }, deviceId, proof });
    });
  }
  async control(command: string, proof: AuthProof): Promise<void> {
    return this.serial(async () => {
      const deviceId = this.auth.verify(proof, false);
      const reviewedWallet=(JSON.parse(proof.body||'{}') as {expectedWallet?:string}).expectedWallet;
      if(reviewedWallet!==undefined&&reviewedWallet!==this.wallet)throw new Error('Reviewed signing wallet changed.');
      const key = `${deviceId}:${proof.envelope.nonce}`;
      if (this.db.prepare('SELECT id FROM controls WHERE id=?').get(key)) return;
      if (proof.method !== 'POST') throw new Error('Control requires POST.');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        if (command === 'pause-all' && proof.path === '/v1/pause-all') {
          this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('paused','1');
          for (const row of this.db.prepare('SELECT value FROM authority').all()) { const a = JSON.parse(String(row.value)) as Authorized; if (['OPEN','BLOCKED'].includes(a.order.state)) { a.order.state='PAUSED'; this.putOrder(a); } }
        } else if (command === 'resume-engine' && proof.path === '/v1/resume-engine') {
          if (!this.key) throw new Error('Unlock signer from its local console first.');
          this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('paused','0');
        } else {
          const match = /^\/v[12]\/(?:orders|strategies)\/([0-9a-f-]{36}(?::exit)?)\/(pause|resume|cancel|retry)$/.exec(proof.path);
          const body = JSON.parse(proof.body) as { revision?: number; action?:string; spec?:unknown;expectedWallet?:string };
          if((proof.path.startsWith('/v2/')||body.expectedWallet!==undefined)&&body.expectedWallet!==this.wallet)throw new Error('Reviewed signing wallet changed.');
          const retry=match?.[2]==='retry';
          if (!match || command !== (retry?body.action:match[2]) || !['pause','resume','cancel'].includes(command)) throw new Error('Unsupported signer control.');
          const existing=this.db.prepare('SELECT value FROM authority WHERE id=?').get(match[1]!);
          if(!existing&&retry&&command==='cancel'){
            const spec=validateProSpec(body.spec,Math.min(Date.now(),Number((body.spec as ProSpec)?.expiresAt)-1));
            if(spec.version===2&&body.expectedWallet!==this.wallet)throw new Error('Reviewed signing wallet changed.');
            const order:ProOrder={id:match[1]!,spec,revision:body.revision!,wallet:this.wallet,state:'CANCELLED',createdAt:Date.now(),updatedAt:Date.now()};
            if(order.revision!==1)throw new Error('Invalid pending cancellation.');
            this.putOrder({order,deviceId,proof});this.db.prepare('INSERT INTO controls VALUES(?)').run(key);this.db.exec('COMMIT');return;
          }
          const a = this.getOrder(match[1]!);
          if(a.order.spec.version===2&&body.expectedWallet!==this.wallet)throw new Error('Reviewed signing wallet changed.');
          if(a.order.spec.version===2&&retry&&command==='cancel'&&body.revision===a.order.revision&&canonicalJson(body.spec)!==canonicalJson(a.order.spec))throw new Error('Cancellation differs from authenticated order intent.');
          if(retry&&a.deviceId===deviceId&&body.revision===a.order.revision&&a.order.state===(command==='pause'?'PAUSED':command==='cancel'?'CANCELLED':'OPEN')){this.db.exec('COMMIT');return;}
          if(['CANCELLED','EXPIRED','FAILED','CONFIRMED','FINALIZED'].includes(a.order.state))throw new Error('Terminal order cannot be changed.');
          const pendingCancel=retry&&command==='cancel'&&(body.revision===a.order.revision||body.revision===a.order.revision+1);
          if (a.deviceId !== deviceId || !pendingCancel&&body.revision !== a.order.revision+(retry?1:0)) throw new Error('Order revision conflict.');
          if (this.attempts().some(attempt => attempt.orderId===a.order.id && !(a.order.spec.kind==='STRATEGY'?['FAILED','EXPIRED','FINALIZED']:['FAILED','EXPIRED']).includes(attempt.state))) throw new Error('Signed attempt remains in-flight.');
          a.order.state = command === 'pause' ? 'PAUSED' : command === 'cancel' ? 'CANCELLED' : 'OPEN';
          if(pendingCancel){a.order.spec=validateProSpec(body.spec,Math.min(Date.now(),Number((body.spec as ProSpec)?.expiresAt)-1));a.order.revision=body.revision!;}else a.order.revision++;
          if(command==='resume')(a.order as ProOrder & {observedAt?:number}).observedAt=Date.now();
          this.putOrder(a);
        }
        this.db.prepare('INSERT INTO controls VALUES(?)').run(key);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    });
  }
  async observeTrailing(): Promise<void> {
    if(this.market instanceof RpcMarket)this.market.retainWatches(!this.key||this.isPaused()?[]:this.db.prepare('SELECT value FROM authority').all().map(row=>(JSON.parse(String(row.value)) as Authorized).order).filter(order=>(order.spec.kind==='TRAILING'||order.spec.steps?.some(s=>s.kind==='TRAILING'))&&order.state==='OPEN').map(order=>order.spec));
    if (this.observing || !this.key || this.isPaused()) return;
    this.observing = true;
    const generation=this.authorityGeneration;
    try {
      for (const row of this.db.prepare('SELECT value FROM authority').all()) {
        if(generation!==this.authorityGeneration)return;
        const a = JSON.parse(String(row.value)) as Authorized;
        if (!(a.order.spec.kind==='TRAILING'||a.order.spec.steps?.some(s=>s.kind==='TRAILING')) || a.order.state !== 'OPEN') continue;
        const owns=(current:Authorized)=>generation===this.authorityGeneration&&Boolean(this.key)&&!this.isPaused()
          &&current.order.state==='OPEN'&&current.order.revision===a.order.revision
          &&canonicalJson(current.order.spec)===canonicalJson(a.order.spec);
        try {
          const o = await this.market.observation(a.order.spec); this.fresh(o);
          await this.serial(async () => {
            if(generation!==this.authorityGeneration)return;
            const current = this.getOrder(a.order.id);
            if (!owns(current)) return;
            this.fresh(o);
            const previousAt = Number((current.order as ProOrder & { observedAt?: number }).observedAt ?? Date.now());
            if (Date.now()-previousAt>5000) current.order.state='PAUSED';
            else if(current.order.spec.kind==='STRATEGY')strategyTrigger(current.order,o);else orderTriggered(current.order,o);
            (current.order as ProOrder & { observedAt?: number }).observedAt=Date.now();
            this.putOrder(current);
          });
        } catch { await this.serial(async () => { if(generation!==this.authorityGeneration)return;const current=this.getOrder(a.order.id); if(owns(current)){current.order.state='PAUSED';this.putOrder(current);} }); }
      }
    } finally { this.observing=false; }
  }
  async sign(orderId: string, attemptId: string): Promise<Signed> {
    return this.serial(async () => {
      const same=this.attempts().find(a=>a.id===attemptId);
      if(same){if(same.orderId===orderId&&same.deferred)throw new WalletBusyError();if(same.orderId!==orderId||['FAILED','EXPIRED'].includes(same.state))throw new Error('Attempt is fenced or identity mismatched.');return this.recoverSigned(same);}
      if(!this.key||this.isPaused())throw new Error('Signer is locked or paused.');
      await this.withdrawals.reconcile();if(this.withdrawals.hasUnsettled()){
        this.putAttempt({id:attemptId,orderId,state:'FAILED',createdAt:Date.now(),updatedAt:Date.now(),buyRaw:'0',deviceId:'',deferred:true,solUsdUnits:'0',signedTransaction:'',signature:'',blockhash:'',lastValidBlockHeight:0});
        throw new WalletBusyError();
      }
      await this.syncOrderLedger();
      const a=this.getOrder(orderId),s=a.order.spec;
      if(a.order.wallet!==this.wallet||s.version===2&&(JSON.parse(a.proof.body) as {expectedWallet?:string}).expectedWallet!==this.wallet)throw new Error('Signing wallet changed from approved intent.');
      if(!this.auth.isActive(a.deviceId)||a.order.state!=='OPEN'||s.expiresAt<=Date.now())throw new Error('Order is not executable.');
      for(const pending of this.attempts().filter(attempt=>!['FAILED','EXPIRED','FINALIZED'].includes(attempt.state))){
        const fill=await this.market.reconcile(pending as ProAttempt,{...this.getOrder(pending.orderId).order,spec:executionSpec(this.getOrder(pending.orderId).order,pending)});
        if(fill.state==='UNKNOWN')throw new Error('Previous signed transaction is unresolved.');
        pending.state=fill.state;this.putAttempt(pending);
        if(fill.state==='CONFIRMED'&&pending.orderId!==a.order.parentId)throw new Error('Previous confirmation is awaiting final settlement.');
      }
      if(this.attempts().some(attempt=>attempt.orderId===orderId&&!(s.kind==='STRATEGY'?['FAILED','EXPIRED','FINALIZED']:['FAILED','EXPIRED']).includes(attempt.state)))throw new Error('Order already has an execution attempt.');
      const o=await this.market.observation(s);this.fresh(o);
      const ready=orderTriggered(a.order,o);
      this.putOrder(a);if(!ready)throw new Error('Independent signer trigger is not satisfied.');
      const spent=dailyBuyExposure(this.attempts());
      if(s.side==='BUY'&&spent+BigInt(s.amountRaw)>BigInt(this.config.limits.dailyBuyLamports))throw new Error('Daily signer buy cap exceeded.');
      this.withdrawals.ledger.assertAvailable(`order:${a.order.id}`,this.orderWants(a.order),await this.market.balances(s.mint));
      const selected=s.kind==='STRATEGY'?strategyTrigger(a.order,o):undefined;
      const sized=selected?executionSpec(a.order,{inputRaw:selected.amountRaw} as ProAttempt):s;
      const built=await buildProExecution(this.connection,this.key.publicKey,sized,o.solUsdMicros);
      if(Date.now()-o.quoteAt>2000)throw new Error('Price observation expired before signing.');
      if(built.input!==BigInt(sized.amountRaw))throw new Error('Input amount mismatch.');
      const fee=await this.connection.getFeeForMessage(built.transaction.message,'confirmed');
      const rent=await setupRentLamports(this.connection,built.feeManifest);
      const networkUsed=s.version===2&&s.kind==='STRATEGY'?strategyNetworkUsed(a.order,this.attempts()):this.attempts().filter(t=>t.orderId===orderId&&!!t.signature&&['FINALIZED','FAILED'].includes(t.state)).reduce((n,t)=>n+BigInt(t.networkRaw??'0'),0n);
      if(fee.value===null||BigInt(fee.value)+rent+networkUsed>BigInt(s.maxNetworkLamports))throw new Error('Network and setup costs exceed authorization.');
      const transaction=built.transaction;
      // Record the exact unsigned bytes before generating a signature. A crash can never approve a different transaction for this attempt.
      const unsigned=Buffer.from(transaction.serialize()).toString('base64');
      const signing:JournalAttempt={...(selected?{strategyStepId:selected.id,inputRaw:selected.amountRaw}:{}),id:attemptId,orderId,state:'AUTHORIZED',createdAt:Date.now(),updatedAt:Date.now(),supplyRaw:o.supplyRaw,networkRaw:String(BigInt(fee.value!)+rent),buyRaw:s.side==='BUY'?s.amountRaw:'0',deviceId:a.deviceId,solUsdUnits:o.solUsdMicros.toString(),signedTransaction:unsigned,signature:'',blockhash:built.latest.blockhash,lastValidBlockHeight:built.latest.lastValidBlockHeight};
      this.putAttempt(signing);
      if(!this.key||this.isPaused()||!this.auth.isActive(a.deviceId))throw new Error('Signer authorization changed before signing.');
      this.fresh(o);
      transaction.sign([this.key]);
      signing.signedTransaction=Buffer.from(transaction.serialize()).toString('base64');signing.signature=bs58.encode(transaction.signatures[0]!);signing.state='SIGNED';
      this.putAttempt(signing);a.order.state='SIGNING';this.putOrder(a);
      return {signedTransaction:signing.signedTransaction,signature:signing.signature,blockhash:signing.blockhash,lastValidBlockHeight:signing.lastValidBlockHeight,solUsdUnits:signing.solUsdUnits,networkRaw:signing.networkRaw,...(selected?{inputRaw:selected.amountRaw,strategyStepId:selected.id}:{})};
    });
  }
  private async recoverSigned(record:JournalAttempt):Promise<Signed> {
    if(!record.signature){
      if(!this.key||this.isPaused())throw new Error('Unlock and resume required to recover unsigned trading intent.');
      if(!this.auth.isActive(record.deviceId))throw new Error('Device authorization was revoked.');
      const generation=this.authorityGeneration,authority=this.getOrder(record.orderId);
      const assertAuthority=()=>{
        const current=this.getOrder(record.orderId);
        if(!this.key||this.isPaused()||generation!==this.authorityGeneration||!this.auth.isActive(record.deviceId)
          ||current.deviceId!==record.deviceId||!['OPEN','SIGNING'].includes(current.order.state)
          ||current.order.revision!==authority.order.revision||canonicalJson(current.order.spec)!==canonicalJson(authority.order.spec))
          throw new Error('Unsigned order is paused, terminal or its authority changed.');
      };
      assertAuthority();
      if(this.getOrder(record.orderId).order.spec.expiresAt<=Date.now()||await this.connection.getBlockHeight('finalized')>record.lastValidBlockHeight){record.state='EXPIRED';this.putAttempt(record);throw new Error('Unsigned trading attempt expired.');}
      assertAuthority();
      const observation=await this.market.observation(authority.order.spec);this.fresh(observation);
      if(authority.order.spec.version===2){
        if(authority.order.spec.kind==='LIMIT'&&record.solUsdUnits!==observation.solUsdMicros.toString())throw new Error('Unsigned MC limit SOL valuation changed.');
        if(record.supplyRaw!==observation.supplyRaw||!mcTriggered(authority.order,observation))throw new Error('Unsigned MC intent requires fresh matching market conditions.');
        if(authority.order.spec.kind==='STRATEGY'){const step=strategyTrigger(authority.order,observation);if(step?.id!==record.strategyStepId||step?.amountRaw!==record.inputRaw)throw new Error('Unsigned strategy step no longer matches private priority or quantity.');}
      }else{
        const s=authority.order.spec;
        if(!orderTriggered(authority.order,observation)||s.kind==='LIMIT'&&record.solUsdUnits!==observation.solUsdMicros.toString())throw new Error('Unsigned intent requires fresh matching market conditions.');
      }
      await this.withdrawals.reconcile();if(this.withdrawals.hasUnsettled())throw new WalletBusyError();
      await this.syncOrderLedger();this.withdrawals.ledger.assertAvailable(`order:${record.orderId}`,this.orderWants(authority.order),await this.market.balances(authority.order.spec.mint));
      this.fresh(observation);assertAuthority();this.putOrder(authority);
      const tx=VersionedTransaction.deserialize(Buffer.from(record.signedTransaction,'base64'));
      assertAuthority();
      tx.sign([this.key!]);record.signedTransaction=Buffer.from(tx.serialize()).toString('base64');record.signature=bs58.encode(tx.signatures[0]!);record.state='SIGNED';this.putAttempt(record);
    }
    return{signedTransaction:record.signedTransaction,signature:record.signature,blockhash:record.blockhash,lastValidBlockHeight:record.lastValidBlockHeight,solUsdUnits:record.solUsdUnits,networkRaw:record.networkRaw,...(record.inputRaw?{inputRaw:record.inputRaw,strategyStepId:record.strategyStepId}:{})};
  }
  async recover(orderId:string,attemptId:string):Promise<Signed|null>{return this.serial(async()=>{
    const same=this.attempts().find(a=>a.id===attemptId);
    if(same){if(same.orderId!==orderId)throw new Error('Attempt identity mismatch.');if(same.deferred)throw new WalletBusyError();if(['FAILED','EXPIRED'].includes(same.state))return null;return this.recoverSigned(same);}
    // Fence a late arriving sign request before reporting that no approval exists.
    this.putAttempt({id:attemptId,orderId,state:'FAILED',createdAt:Date.now(),updatedAt:Date.now(),buyRaw:'0',deviceId:'',solUsdUnits:'0',signedTransaction:'',signature:'',blockhash:'',lastValidBlockHeight:0});return null;
  });}
  async inspect(orderId?:string):Promise<{order?:ProOrder;paused:boolean}>{return this.serial(async()=>{
    const row=orderId?this.db.prepare('SELECT value FROM authority WHERE id=?').get(orderId):undefined;
    return{order:row?(JSON.parse(String(row.value)) as Authorized).order:undefined,paused:this.isPaused()};
  });}
  close(): void { this.lock();if(this.market instanceof RpcMarket)this.market.close(); this.auth.close();this.diagnostics.close(); this.db.close(); }
}

type Call = { method: string; args?: unknown[] };
export class SignerClient {
  constructor(readonly socketPath: string, readonly adminSocketPath=`${socketPath}.admin`) {}
  call<T>(method:string,args:unknown[]=[],admin=false):Promise<T>{return new Promise((resolve,reject)=>{
    const socket=createConnection(admin?this.adminSocketPath:this.socketPath);let buffer='';let settled=false;
    const fail=(error:Error)=>{if(settled)return;settled=true;socket.destroy();reject(error);};
    socket.setTimeout(30_000,()=>fail(new Error('Signer call outcome is unresolved.')));
    socket.on('connect',()=>socket.end(`${JSON.stringify({method,args})}\n`));
    socket.on('data',(data:Buffer)=>{buffer+=data.toString('utf8');if(buffer.length>SIGNER_REPLY_LIMIT){fail(new Error('Signer reply exceeded limit.'));return;}if(buffer.includes('\n')){try{const reply=JSON.parse(buffer.split('\n')[0]!) as {ok:boolean;data:T;error?:string;errorCode?:string};settled=true;socket.destroy();reply.ok?resolve(reply.data):reject(reply.errorCode==='WALLET_BUSY'?new WalletBusyError():new Error(reply.error??'Signer rejected request.'));}catch{fail(new Error('Invalid signer reply.'));}}});
    socket.on('error',fail);socket.on('close',()=>{if(!settled)fail(new Error('Signer disconnected before acknowledgement.'));});
  });}
  async status():Promise<'READY'|'LOCKED'|'UNAVAILABLE'>{try{return await this.call('status');}catch{return 'UNAVAILABLE';}}
  executionReady():Promise<boolean>{return this.call('executionReady');}
  capabilities():Promise<string[]>{return this.call('capabilities');}
  withdrawal(method:string,proof?:AuthProof):Promise<unknown>{return this.call('withdrawal',[method,proof]);}
  walletBalances(mint:string):Promise<ProBalance[]>{return this.call('walletBalances',[mint]);}
  registerOrder(order:ProOrder,proof:AuthProof):Promise<void>{return this.call('registerOrder',[order,proof]);}
  sign(orderId:string,attemptId:string):Promise<Signed>{return this.call('sign',[orderId,attemptId]);}
  recover(orderId:string,attemptId:string):Promise<Signed|null>{return this.call('recover',[orderId,attemptId]);}
  inspect(orderId?:string):Promise<{order?:ProOrder;paused:boolean}>{return this.call('inspect',[orderId]);}
  control(command:string,proof:AuthProof):Promise<void>{return this.call('control',[command,proof]);}
  verify(proof:AuthProof):Promise<string>{return this.call('verify',[proof]);}
  active(deviceId:string):Promise<boolean>{return this.call('active',[deviceId]);}
  pair(code:string,publicKeySpki:string):Promise<{deviceId:string;serverId:string}>{return this.call('pair',[code,publicKeySpki]);}
  unlock(password:string):Promise<void>{return this.call('unlock',[password],true);}
  issuePairCode():Promise<string>{return this.call('issuePairCode',[],true);}
  revoke(deviceId:string):Promise<void>{return this.call('revoke',[deviceId],true);}
  lock():Promise<void>{return this.call('lock',[],true);}
}

export async function startSignerDaemon(config:SignerConfig):Promise<{authority:SigningAuthority;close:()=>Promise<void>}> {
  process.umask(0o077);
  const release=await claimSignerProcess(`${config.journalPath}.lock`);
  let authority:SigningAuthority;
  try{authority=new SigningAuthority(config);await authority.initialize();}catch(error){await release();throw error;}
  const listen=async(path:string,admin:boolean):Promise<Server>=>{
    await mkdir(dirname(path),{recursive:true,mode:admin?0o700:0o750});
    try{const stat=await lstat(path);if(!stat.isSocket())throw new Error('Refusing to replace a non-socket path.');await unlink(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const server=createServer({allowHalfOpen:true},socket=>{let body='';let done=false;socket.setTimeout(5000,()=>socket.destroy());
      socket.on('data',(data:Buffer)=>{if(done)return;body+=data.toString('utf8');if(body.length>65_536){socket.destroy();return;}if(!body.includes('\n'))return;done=true;
        void(async()=>{try{const call=JSON.parse(body.split('\n')[0]!) as Call;const args=call.args??[];let result:unknown;
          if(!Array.isArray(args))throw new Error('Invalid arguments.');
          if(admin){if(call.method==='unlock')result=await authority.unlock(String(args[0]??''));else if(call.method==='issuePairCode')result=authority.auth.issuePairCode();else if(call.method==='revoke')result=authority.auth.revoke(String(args[0]??''));else if(call.method==='lock')result=authority.lock();else throw new Error('Unknown admin method.');}
          else {if(call.method==='status')result=authority.status();else if(call.method==='verify')result=authority.auth.verify(args[0] as AuthProof);else if(call.method==='active')result=authority.auth.isActive(String(args[0]??''));else if(call.method==='pair')result=authority.auth.pair(String(args[0]??''),String(args[1]??''));else if(call.method==='executionReady')result=await authority.executionReady();else if(call.method==='capabilities')result=['withdrawals-v1','mc-orders-v2','exit-strategies-v2'];else if(call.method==='withdrawal')result=await authority.withdrawal(String(args[0]??''),args[1] as AuthProof|undefined);else if(call.method==='walletBalances')result=await authority.walletBalances(String(args[0]??SOL));else if(call.method==='registerOrder')result=await authority.registerOrder(args[0] as ProOrder,args[1] as AuthProof);else if(call.method==='sign')result=await authority.sign(String(args[0]??''),String(args[1]??''));else if(call.method==='recover')result=await authority.recover(String(args[0]??''),String(args[1]??''));else if(call.method==='inspect')result=await authority.inspect(typeof args[0]==='string'?args[0]:undefined);else if(call.method==='control')result=await authority.control(String(args[0]??''),args[1] as AuthProof);else throw new Error('Unknown signer method.');}
          socket.end(`${JSON.stringify({ok:true,data:result})}\n`);
        }catch(error){authority.diagnostics.log({level:'error',component:'signer',type:'signer.request.rejected',details:{error}});socket.end(`${JSON.stringify({ok:false,error:error instanceof PairingCodeError?PAIRING_CODE_HELP:'Signer rejected request; inspect private server diagnostics.',...(error instanceof WalletBusyError||error instanceof PairingCodeError?{errorCode:error.code}:{})})}\n`);}})();
      });socket.on('error',()=>socket.destroy());
    });await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});await chmod(path,admin?0o600:config.socketMode??0o660);return server;
  };
  let api:Server|undefined,admin:Server|undefined;
  try{api=await listen(config.socketPath,false);admin=await listen(config.adminSocketPath,true);}catch(error){if(api)await new Promise<void>(resolve=>api!.close(()=>resolve()));authority.close();await release();throw error;}
  let reconciling=false;
  const timer=setInterval(()=>{void authority.observeTrailing().catch(()=>{});if(!reconciling){reconciling=true;void authority.reconcileWithdrawals().catch(error=>authority.diagnostics.log({level:'warn',component:'withdrawal',type:'withdrawal.reconcile.failed',details:{error}})).finally(()=>{reconciling=false;});}},1000);
  return{authority,close:async()=>{clearInterval(timer);await Promise.all([new Promise<void>(resolve=>api!.close(()=>resolve())),new Promise<void>(resolve=>admin!.close(()=>resolve()))]);authority.close();await Promise.all([config.socketPath,config.adminSocketPath].map(async path=>{try{await unlink(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}));await release();}};
}
