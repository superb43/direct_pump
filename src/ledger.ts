import { FEE_AUDIT_VERSION } from './fee-audit-version';
import type { LedgerTrade, Savings } from './model';
import { EMPTY_SAVINGS, updateSavings } from './receipts/savings';
import { cleanReceipt } from './receipts/receipt-diagnostics';

const auditState=(r:import('./model').Receipt)=>r.feeManifest?.length&&(!r.feeReceipt||r.feeReceipt.state==='PENDING'||r.feeReceipt.auditVersion!==FEE_AUDIT_VERSION)?'PENDING':'DONE';
let opened: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  return opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('direct-pump-fee-receipts', 4);
    request.onupgradeneeded = () => {
      const db=request.result;
      if(!db.objectStoreNames.contains('trades'))db.createObjectStore('trades',{keyPath:'signature'});
      if(!db.objectStoreNames.contains('totals'))db.createObjectStore('totals');
      if(!db.objectStoreNames.contains('receipts'))db.createObjectStore('receipts',{keyPath:'signature'});
      const receipts=request.transaction!.objectStore('receipts');
      if(!receipts.indexNames.contains('pendingByTime'))receipts.createIndex('pendingByTime',['auditState','createdAt']);
      if(!receipts.indexNames.contains('walletMintTime'))receipts.createIndex('walletMintTime',['wallet','mint','createdAt']);
      const cursor=receipts.openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;row.update({...row.value,auditState:auditState(row.value)});row.continue();};
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opened = undefined; reject(request.error); };
  });
}
export async function readSavings(): Promise<Savings> {
  const db = await database();
  return new Promise((resolve,reject) => {
    const tx = db.transaction('totals','readonly'), req = tx.objectStore('totals').get('savings');
    req.onsuccess = () => resolve(req.result ?? { ...EMPTY_SAVINGS }); req.onerror = () => reject(req.error);
  });
}
export async function recordVerifiedTrade(trade: LedgerTrade): Promise<void> {
  if (trade.feeReceipt.state !== 'VERIFIED' || !trade.feeReceipt.zeroExtraFeesVerified || !trade.feeReceipt.executionSucceeded) return;
  const db = await database();
  await new Promise<void>((resolve,reject) => {
    const tx = db.transaction(['trades','totals'],'readwrite');
    const records = tx.objectStore('trades'), totals = tx.objectStore('totals');
    const previous = records.get(trade.signature), summary = totals.get('savings');
    let reads = 0;
    const write = () => {
      if (++reads !== 2) return;
      let next = trade;
      // Do not erase a captured trade-time USD quote on later verification.
      if (previous.result?.feeReceipt.usd && next.feeReceipt.volumeUsdMicros === undefined) next = { ...next, feeReceipt: { ...next.feeReceipt, usd: previous.result.feeReceipt.usd, volumeUsdMicros: previous.result.feeReceipt.volumeUsdMicros } };
      records.put(next); totals.put(updateSavings(summary.result ?? { ...EMPTY_SAVINGS }, previous.result, next),'savings');
    };
    previous.onsuccess = write; summary.onsuccess = write;
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
  });
}

export async function archiveReceipt(receipt: import('./model').Receipt): Promise<void> {
  receipt=cleanReceipt(receipt);
  if (!receipt.signature) return;
  const db = await database();
  await new Promise<void>((resolve,reject)=>{
    const tx = db.transaction('receipts','readwrite'), store=tx.objectStore('receipts'), request=store.get(receipt.signature!);
    request.onsuccess=()=>{const prior=request.result;let feeReceipt=receipt.feeReceipt??prior?.feeReceipt;
      if(feeReceipt&&prior?.feeReceipt?.terminalFeeSource==='USER_CONFIRMED'&&feeReceipt.terminalFeeLamports===undefined)feeReceipt={...feeReceipt,terminalFeeLamports:prior.feeReceipt.terminalFeeLamports,terminalFeeSource:'USER_CONFIRMED'};
      const row={...receipt,symbol:receipt.symbol??prior?.symbol,feeReceipt};store.put({...row,auditState:auditState(row)});};
    tx.oncomplete=()=>resolve(); tx.onabort=()=>reject(tx.error);
  });
}
export async function receiptBySignature(signature: string): Promise<import('./model').Receipt | undefined> {
  const db = await database();
  return new Promise((resolve,reject)=>{const req=db.transaction('receipts','readonly').objectStore('receipts').get(signature);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
}
export async function unauditedReceipts(): Promise<import('./model').Receipt[]> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const output:import('./model').Receipt[]=[];
    const req=db.transaction('receipts','readonly').objectStore('receipts').index('pendingByTime').openCursor(IDBKeyRange.bound(['PENDING',0],['PENDING',Number.MAX_SAFE_INTEGER]),'prev');
    req.onsuccess=()=>{const row=req.result;if(!row||output.length===5){resolve(output);return;}output.push(row.value);row.continue();};req.onerror=()=>reject(req.error);
  });
}

export async function allReceipts(wallet?:string,mint?:string):Promise<import('./model').Receipt[]>{
 const db=await database();
 return new Promise((resolve,reject)=>{
  const store=db.transaction('receipts','readonly').objectStore('receipts');
  // Array keys sort after string keys: the prefix range includes every mint for
  // this wallet without scanning other wallets or changing the existing index.
  const request=wallet?store.index('walletMintTime').getAll(mint?IDBKeyRange.bound([wallet,mint,0],[wallet,mint,Number.MAX_SAFE_INTEGER]):IDBKeyRange.bound([wallet],[wallet,[]])):store.getAll();
  request.onsuccess=()=>resolve(request.result.filter((r:import('./model').Receipt)=>(!wallet||r.wallet===wallet)&&(!mint||r.mint===mint)).sort((a:import('./model').Receipt,b:import('./model').Receipt)=>a.createdAt-b.createdAt));request.onerror=()=>reject(request.error);
 });
}


/** Store display metadata without replacing a newer receipt/audit snapshot. */
export async function cacheReceiptSymbol(receipt: import('./model').Receipt, symbol: string): Promise<void> {
  if (!receipt.signature) return;
  const db = await database();
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('receipts','readwrite'),store=tx.objectStore('receipts'),request=store.get(receipt.signature!);
    request.onsuccess=()=>{
      const current=request.result;
      if(current&&current.wallet===receipt.wallet&&current.mint===receipt.mint)store.put({...current,symbol});
    };
    tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
  });
}
