import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {canonicalJson,type AuthProof,type ProBalance} from '../src/pro/contracts';
import {validateWithdrawalSpec,UUID,type Recipient,type Withdrawal,type WithdrawalPreview,type WithdrawalSpec} from '../src/pro/withdrawals';
import {AuthRegistry} from './auth';
import {SOL} from './store';
import {buildWithdrawalTransfer} from './withdrawal-transfer';

type RecordEntry = Withdrawal & {deviceId:string;signedTransaction:string;blockhash:string;lastValidBlockHeight:number;submittedAt?:number};
type PreviewEntry = WithdrawalPreview & {deviceId:string;snapshot:string};
const terminal=new Set(['FINALIZED','FAILED','EXPIRED']);
export class WalletLedger {
  constructor(private db:DatabaseSync){db.exec('CREATE TABLE IF NOT EXISTS wallet_reservations(owner TEXT,mint TEXT,raw TEXT NOT NULL,PRIMARY KEY(owner,mint));');}
  reserved(mint:string,except?:string):bigint{return this.db.prepare('SELECT owner,raw FROM wallet_reservations WHERE mint=?').all(mint).reduce((sum,r)=>sum+(r.owner===except?0n:BigInt(String(r.raw))),0n);}
  release(owner:string):void{this.db.prepare('DELETE FROM wallet_reservations WHERE owner=?').run(owner);}
  replace(owner:string,wants:Record<string,bigint>):void{this.release(owner);for(const [mint,raw] of Object.entries(wants))if(raw>0n)this.db.prepare('INSERT INTO wallet_reservations VALUES(?,?,?)').run(owner,mint,String(raw));}
  assertAvailable(owner:string,wants:Record<string,bigint>,balances:Record<string,bigint>):void{for(const [mint,raw] of Object.entries(wants))if((balances[mint]??0n)-this.reserved(mint,owner)<raw)throw new Error('Insufficient unreserved balance.');}
  snapshot(balances:Record<string,bigint>):string{return canonicalJson({balances:Object.fromEntries(Object.entries(balances).map(([k,v])=>[k,String(v)])),reservations:this.db.prepare('SELECT owner,mint,raw FROM wallet_reservations ORDER BY owner,mint').all()});}
}
export class WithdrawalAuthority {
  readonly ledger:WalletLedger;
  constructor(private db:DatabaseSync,private auth:AuthRegistry,private connection:Connection,private wallet:()=>string,private key:()=>Keypair|undefined,private maxFee:string,private syncOrders:(requireSettled?:boolean)=>Promise<void>,private balances:(mint:string)=>Promise<Record<string,bigint>>,private build=buildWithdrawalTransfer){
    this.ledger=new WalletLedger(db);
    db.exec('CREATE TABLE IF NOT EXISTS recipients(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS withdrawal_previews(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS withdrawals(id TEXT PRIMARY KEY,value TEXT NOT NULL);');
  }
  private rows<T>(table:'recipients'|'withdrawals'):T[]{return this.db.prepare(`SELECT value FROM ${table} ORDER BY rowid DESC`).all().map(r=>JSON.parse(String(r.value)) as T);}
  private publicRecord(r:RecordEntry):Withdrawal{return {id:r.id,spec:r.spec,state:r.state,createdAt:r.createdAt,updatedAt:r.updatedAt,...r.signature?{signature:r.signature}:{},...r.error?{error:r.error}:{}};}
  private put(r:RecordEntry):void{this.db.prepare('INSERT OR REPLACE INTO withdrawals VALUES(?,?)').run(r.id,canonicalJson(r));}
  private recipient(spec:WithdrawalSpec):Recipient{
    const r=this.rows<Recipient>('recipients').find(r=>r.id===spec.recipientId);
    if(!r?.active||r.version!==spec.recipientVersion||r.address!==spec.address)throw new Error('Saved recipient changed or is inactive.');return r;
  }
  private wants(s:WithdrawalSpec,cost:bigint):Record<string,bigint>{const wants:Record<string,bigint>={[SOL]:cost};wants[s.mint]=(wants[s.mint]??0n)+BigInt(s.amountRaw);return wants;}
  private route(proof:AuthProof,method:string,path:string):void{if(proof.method!==method||proof.path!==path)throw new Error('Withdrawal authorization action mismatch.');}
  async call(method:string,proof?:AuthProof):Promise<unknown>{
    if(method==='withdrawals'&&!proof)return this.rows<RecordEntry>('withdrawals').slice(0,500).map(r=>this.publicRecord(r));
    if(!proof)throw new Error('Device authorization is required.');
    const deviceId=this.auth.verify(proof,false),body=proof.body?JSON.parse(proof.body) as Record<string,unknown>:{};
    if(method==='recipients'){this.route(proof,'GET','/v1/recipients');return this.rows<Recipient>('recipients');}
    if(method==='withdrawals'){this.route(proof,'GET','/v1/withdrawals');return this.rows<RecordEntry>('withdrawals').slice(0,500).map(r=>this.publicRecord(r));}
    if(method==='withdrawal'){
      const match=/^\/v1\/withdrawals\/([^/]+)$/.exec(proof.path);if(proof.method!=='GET'||!match||!UUID.test(match[1]!))throw new Error('Invalid withdrawal status route.');
      const r=this.rows<RecordEntry>('withdrawals').find(r=>r.id===match[1]);if(!r)throw new Error('Withdrawal not found.');return this.publicRecord(r);
    }
    if(method==='addRecipient'){
      this.route(proof,'POST','/v1/recipients');
      if(Object.keys(body).some(k=>!['id','name','address'].includes(k))||!UUID.test(String(body.id))||typeof body.name!=='string'||body.name.trim().length<1||body.name.length>64||/[\u0000-\u001f\u007f]/.test(body.name)||typeof body.address!=='string')throw new Error('Invalid recipient.');
      const address=new PublicKey(body.address);if(!PublicKey.isOnCurve(address.toBytes())||address.toBase58()!==body.address||body.address===this.wallet())throw new Error('Recipient must be a different canonical wallet address.');
      const previous=this.rows<Recipient>('recipients').find(r=>r.id===body.id);
      if(previous){if(previous.address!==body.address||previous.name!==body.name.trim())throw new Error('Saved recipient cannot be overwritten.');return previous;}
      if(this.rows<Recipient>('recipients').length>=100)throw new Error('Recipient capacity reached.');
      const r:Recipient={id:String(body.id),version:1,name:body.name.trim(),address:body.address,active:true,createdAt:Date.now()};this.db.prepare('INSERT INTO recipients VALUES(?,?)').run(r.id,canonicalJson(r));return r;
    }
    if(method==='deactivateRecipient'){
      const match=/^\/v1\/recipients\/([^/]+)\/deactivate$/.exec(proof.path);if(proof.method!=='POST'||!match||Object.keys(body).some(k=>k!=='version'))throw new Error('Invalid recipient action.');
      const r=this.rows<Recipient>('recipients').find(r=>r.id===match[1]);if(!r||r.version!==body.version)throw new Error('Recipient version changed.');r.active=false;this.db.prepare('UPDATE recipients SET value=? WHERE id=?').run(canonicalJson(r),r.id);return r;
    }
    if(method==='preview'){
      this.route(proof,'POST','/v1/withdrawals/preview');const spec=validateWithdrawalSpec(body);this.recipient(spec);
      if(BigInt(spec.maxNetworkLamports)>BigInt(this.maxFee))throw new Error('Withdrawal network cap exceeded.');
      await this.reconcile();await this.syncOrders();const balances=await this.balances(spec.mint);
      const reserved=this.ledger.reserved(spec.mint),total=balances[spec.mint]??0n,available=total>reserved?total-reserved:0n;
      const built=await this.build(this.connection,new PublicKey(this.wallet()),spec);
      const cost=spec.mint===SOL?BigInt(built.feeLamports)+BigInt(built.rentLamports):0n,max=available>cost?available-cost:0n;
      // A nominal amount of one also serves Max discovery. Approval enforces all balances.
      const p:PreviewEntry={id:randomUUID(),spec,expiresAt:Date.now()+120_000,totalRaw:String(total),reservedRaw:String(reserved),availableRaw:String(available),maxRaw:String(max),feeLamports:built.feeLamports,rentLamports:built.rentLamports,deviceId,snapshot:this.ledger.snapshot(balances)};
      this.db.prepare('DELETE FROM withdrawal_previews WHERE CAST(json_extract(value,\'$.expiresAt\') AS INTEGER)<?').run(Date.now());
      if(Number(this.db.prepare('SELECT COUNT(*) AS n FROM withdrawal_previews').get()?.n)>1000)throw new Error('Preview capacity reached.');
      this.db.prepare('INSERT INTO withdrawal_previews VALUES(?,?)').run(p.id,canonicalJson(p));const {deviceId:_,snapshot:__,...publicPreview}=p;return publicPreview;
    }
    if(method!=='approve')throw new Error('Unsupported withdrawal operation.');
    this.route(proof,'POST','/v1/withdrawals');if(Object.keys(body).some(k=>!['previewId','spec'].includes(k)))throw new Error('Invalid withdrawal approval.');
    const spec=validateWithdrawalSpec(body.spec),existing=this.rows<RecordEntry>('withdrawals').find(r=>r.id===spec.requestId);
    if(existing){if(existing.deviceId!==deviceId||canonicalJson(existing.spec)!==canonicalJson(spec))throw new Error('Withdrawal request identity conflict.');return this.publicRecord(existing);}
    const row=this.db.prepare('SELECT value FROM withdrawal_previews WHERE id=?').get(String(body.previewId));if(!row)throw new Error('Review withdrawal first.');const p=JSON.parse(String(row.value)) as PreviewEntry;
    if(p.deviceId!==deviceId||canonicalJson(p.spec)!==canonicalJson(spec)||p.expiresAt<Date.now())throw new Error('Withdrawal preview changed or expired. Review again.');
    this.recipient(spec);if(!this.key())throw new Error('Unlock signer using its local console first.');
    await this.reconcile();await this.syncOrders(true);const balances=await this.balances(spec.mint);
    if(p.snapshot!==this.ledger.snapshot(balances))throw new Error('Balance or reservations changed. Review withdrawal again.');
    if(this.rows<RecordEntry>('withdrawals').some(r=>!terminal.has(r.state)))throw new Error('Previous withdrawal is still settling.');
    const cost=BigInt(p.feeLamports)+BigInt(p.rentLamports);
    const wants=this.wants(spec,cost);
    this.ledger.assertAvailable(`withdrawal:${spec.requestId}`,wants,balances);
    const built=await this.build(this.connection,new PublicKey(this.wallet()),spec);
    if(built.feeLamports!==p.feeLamports||built.rentLamports!==p.rentLamports)throw new Error('Withdrawal costs changed. Review withdrawal again.');
    // Re-fetch after building, before the only signing decision; other signer work is serialized.
    const latest=await this.balances(spec.mint);if(p.snapshot!==this.ledger.snapshot(latest))throw new Error('Balance changed while preparing withdrawal. Review again.');
    if(!this.key()||!this.auth.isActive(deviceId))throw new Error('Signer authorization changed before signing.');
    this.recipient(spec);
    const r:RecordEntry={id:spec.requestId,spec,state:'AUTHORIZED',createdAt:Date.now(),updatedAt:Date.now(),deviceId,signedTransaction:Buffer.from(built.transaction.serialize()).toString('base64'),blockhash:built.blockhash,lastValidBlockHeight:built.lastValidBlockHeight};
    this.db.exec('BEGIN IMMEDIATE');try{this.ledger.replace(`withdrawal:${r.id}`,wants);this.put(r);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
    await this.submit(r);return this.publicRecord(r);
  }
  async walletBalances(mint:string):Promise<ProBalance[]>{await this.reconcile();await this.syncOrders();const balances=await this.balances(mint);return Object.entries(balances).map(([asset,total])=>{const reserved=this.ledger.reserved(asset);return {mint:asset,decimals:asset===SOL?9:0,totalRaw:String(total),reservedRaw:String(reserved),availableRaw:String(total>reserved?total-reserved:0n)};});}
  private async submit(r:RecordEntry):Promise<void>{
    if(!r.signature){const key=this.key();if(!key)return;const tx=VersionedTransaction.deserialize(Buffer.from(r.signedTransaction,'base64'));tx.sign([key]);r.signature=bs58.encode(tx.signatures[0]!);r.signedTransaction=Buffer.from(tx.serialize()).toString('base64');r.state='SIGNED';this.put(r);}
    try{const returned=await this.connection.sendRawTransaction(Buffer.from(r.signedTransaction,'base64'),{skipPreflight:false,maxRetries:0,preflightCommitment:'confirmed'});if(returned!==r.signature)throw new Error('RPC signature mismatch.');r.state='SUBMITTED';}catch{r.state='UNKNOWN';r.error='Submission uncertain; the same transaction is being reconciled.';}
    r.updatedAt=Date.now();r.submittedAt=Date.now();this.put(r);
  }
  async reconcile():Promise<void>{
    for(const r of this.rows<RecordEntry>('withdrawals').filter(r=>!terminal.has(r.state))){
      if(r.signature){
        const result=(await this.connection.getSignatureStatuses([r.signature],{searchTransactionHistory:true})).value[0];
        if(result?.confirmationStatus==='finalized'){r.state=result.err?'FAILED':'FINALIZED';r.error=result.err?'Withdrawal failed on chain.':undefined;}
        else if(result&&!result.err&&['confirmed','finalized'].includes(result.confirmationStatus??'')){r.state='CONFIRMED';r.error=undefined;}
        else if(!result&&await this.connection.getBlockHeight('finalized')>r.lastValidBlockHeight){
          const again=(await this.connection.getSignatureStatuses([r.signature],{searchTransactionHistory:true})).value[0];if(!again)r.state='EXPIRED';
        }
      }else if(await this.connection.getBlockHeight('finalized')>r.lastValidBlockHeight)r.state='EXPIRED';
      r.updatedAt=Date.now();
      this.db.exec('BEGIN IMMEDIATE');try{this.put(r);if(terminal.has(r.state))this.ledger.release(`withdrawal:${r.id}`);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
      if(terminal.has(r.state))continue;
      if(r.state==='CONFIRMED')continue;
      if(r.submittedAt&&Date.now()-r.submittedAt<5000)continue;
      // Revocation/lock blocks recovering an unsigned attempt; already signed bytes keep their identity.
      if(!r.signature&&!this.auth.isActive(r.deviceId))continue;
      await this.submit(r);
    }
  }
  hasUnsettled():boolean{return this.rows<RecordEntry>('withdrawals').some(r=>!terminal.has(r.state));}
}
