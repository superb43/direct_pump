import {afterEach,expect,it,vi} from 'vitest';
import type {Receipt} from '../../src/model';

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
it('reads wallet history through the existing compound index and preserves ordered wallet/mint filtering',async()=>{
  const rows=[{wallet:'wallet',mint:'mint-b',createdAt:20},{wallet:'other',mint:'mint-a',createdAt:1},{wallet:'wallet',mint:'mint-a',createdAt:10}] as Receipt[];
  const request=()=>{const req:{result:Receipt[];onsuccess?:()=>void}={result:rows};queueMicrotask(()=>req.onsuccess?.());return req;};
  const indexed=vi.fn(request),full=vi.fn(request),index=vi.fn(()=>({getAll:indexed}));
  const db={transaction:()=>({objectStore:()=>({getAll:full,index})})};
  vi.stubGlobal('indexedDB',{open:()=>{const req:{result:typeof db;onsuccess?:()=>void}={result:db};queueMicrotask(()=>req.onsuccess?.());return req;}});
  vi.stubGlobal('IDBKeyRange',{bound:(lower:unknown,upper:unknown)=>({lower,upper})});
  const {allReceipts}=await import('../../src/ledger');
  expect((await allReceipts('wallet')).map(row=>row.createdAt)).toEqual([10,20]);expect(full).not.toHaveBeenCalled();expect(index).toHaveBeenCalledWith('walletMintTime');
  expect((await allReceipts('wallet','mint-b')).map(row=>row.createdAt)).toEqual([20]);
  expect((await allReceipts()).map(row=>row.createdAt)).toEqual([1,10,20]);expect(full).toHaveBeenCalledOnce();
});
