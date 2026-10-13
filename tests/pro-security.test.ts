import {DatabaseSync} from 'node:sqlite';
import {ProStore,SOL} from '../server/store';
import {ProEngine,deriveExitSpec,type SignerPort} from '../server/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign as ecSign, randomUUID } from 'node:crypto';
import { Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createKeystore, unlockKeystore, backupKeystore } from '../server/keystore';
import { AuthRegistry } from '../server/auth';
import { SigningAuthority, type SignerConfig } from '../server/signer';
import { DEFAULT_SETTINGS } from '../src/model';
import { authMessage, canonicalJson, validateProSpec, usdUnits, type ProOrder, type ProSpec, type AuthProof } from '../src/pro/contracts';
import type { MarketPort } from '../server/engine';

vi.mock('../server/execution',()=>({
  setupRentLamports:vi.fn(async()=>0n),
  buildProExecution:vi.fn(async(_rpc:Connection,wallet:PublicKey,spec:ProSpec)=>({input:BigInt(spec.amountRaw),minimum:1n,feeManifest:[],latest:{blockhash:'11111111111111111111111111111111',lastValidBlockHeight:999999},transaction:new VersionedTransaction(new TransactionMessage({payerKey:wallet,recentBlockhash:'11111111111111111111111111111111',instructions:[SystemProgram.transfer({fromPubkey:wallet,toPubkey:wallet,lamports:1})]}).compileToV0Message())}))
}));
const directories:string[]=[];
async function folder(){const path=await mkdtemp(join(tmpdir(),'dp-pro-security-'));directories.push(path);return path;}
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(directories.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
const device=()=>generateKeyPairSync('ec',{namedCurve:'prime256v1'});
function proofFor(serverId:string,deviceId:string,privateKey:ReturnType<typeof device>['privateKey'],method:string,path:string,value?:unknown):AuthProof{
  const proof:AuthProof={method,path,body:value===undefined?'':canonicalJson(value),envelope:{deviceId,timestamp:Date.now(),nonce:randomUUID(),signature:''}};
  proof.envelope.signature=ecSign('sha256',Buffer.from(authMessage(serverId,proof)),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64');return proof;
}
function spec():ProSpec{return{kind:'MARKET',side:'BUY',mint:'So11111111111111111111111111111111111111112',target:{site:'GMGN',kind:'MINT',address:'So11111111111111111111111111111111111111112',pageUrl:'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112'},amountRaw:'10000',decimals:9,expiresAt:Date.now()+60000,slippageBps:500,priorityFeeLamports:1000,maxNetworkLamports:'10000'};}

describe('encrypted keystore',()=>{
  it('round-trips identity, encrypts bytes and authenticates password and ciphertext',async()=>{
    const dir=await folder(),path=join(dir,'key.enc');const created=await createKeystore(path,'a-test-only-long-passphrase');const unlocked=await unlockKeystore(path,'a-test-only-long-passphrase');expect(unlocked.publicKey.toBase58()).toBe(created.wallet);
    const contents=await readFile(path,'utf8');expect(contents).not.toContain('a-test-only-long-passphrase');expect(contents).not.toContain(Buffer.from(unlocked.secretKey).toString('base64'));
    await expect(unlockKeystore(path,'another-long-passphrase')).rejects.toThrow('unlock failed');
    const row=JSON.parse(contents);row.tag=Buffer.alloc(16).toString('base64');await writeFile(path,JSON.stringify(row));await expect(unlockKeystore(path,'a-test-only-long-passphrase')).rejects.toThrow('unlock failed');
  });
  it('makes encrypted backup and rejects publicly readable keystore',async()=>{
    const dir=await folder(),path=join(dir,'key.enc');await createKeystore(path,'a-test-only-long-passphrase');const backup=join(dir,'backup.enc');expect(await backupKeystore(path,backup)).toMatch(/^[a-f0-9]{64}$/);expect((await unlockKeystore(backup,'a-test-only-long-passphrase')).publicKey.toBase58()).toBe((await unlockKeystore(path,'a-test-only-long-passphrase')).publicKey.toBase58());await chmod(path,0o644);await expect(unlockKeystore(path,'a-test-only-long-passphrase')).rejects.toThrow('0600');
  });
});
describe('device request authorization',()=>{
  it('binds server, method, body and path; rejects replay, expired code and revoked device',async()=>{
    const dir=await folder(),auth=new AuthRegistry(join(dir,'auth.db'),'server-one'),keys=device();try{
      const publicKeySpki=keys.publicKey.export({format:'der',type:'spki'}).toString('base64'),code=auth.issuePairCode(),paired=auth.pair(code,publicKeySpki);
      expect(()=>auth.pair(code,publicKeySpki)).toThrow('invalid');const request=proofFor('server-one',paired.deviceId,keys.privateKey,'GET','/v1/health');expect(auth.verify(request)).toBe(paired.deviceId);expect(()=>auth.verify(request)).toThrow('replay');
      expect(()=>auth.verify({...request,path:'/v1/orders'},false)).toThrow();expect(()=>auth.verify(proofFor('wrong-server',paired.deviceId,keys.privateKey,'GET','/v1/health'),false)).toThrow();
      const expired=auth.issuePairCode(Date.now()-400000);expect(()=>auth.pair(expired,publicKeySpki)).toThrow('expired');auth.revoke(paired.deviceId);expect(()=>auth.verify(proofFor('server-one',paired.deviceId,keys.privateKey,'GET','/v1/health'))).toThrow('authorized');
    }finally{auth.close();}
  });
});
describe('signer closed authorization journal',()=>{
  async function authority(){
    const dir=await folder(),created=await createKeystore(join(dir,'key.enc'),'a-test-only-long-passphrase');
    const config:SignerConfig={serverId:'server-one',socketPath:join(dir,'api.sock'),adminSocketPath:join(dir,'admin.sock'),keystorePath:join(dir,'key.enc'),authPath:join(dir,'auth.db'),journalPath:join(dir,'journal.db'),rpcUrl:'https://solana-rpc.publicnode.com',settings:DEFAULT_SETTINGS,limits:{maxBuyLamports:'100000',dailyBuyLamports:'200000',maxNetworkLamports:'10000'}};
    const market:MarketPort={observation:async()=>({priceUsd:'1',solUsdMicros:usdUnits('100'),quoteAt:Date.now(),solUsdAt:Date.now(),observedAt:Date.now(),outputRaw:'10000'}),balances:async()=>({So11111111111111111111111111111111111111112:10000000n}),submit:async()=>{throw new Error('No live submission in tests');},reconcile:async()=>({state:'UNKNOWN'})};
    const signer=new SigningAuthority(config,market);await signer.initialize();const keys=device(),paired=signer.auth.pair(signer.auth.issuePairCode(),keys.publicKey.export({format:'der',type:'spki'}).toString('base64'));
    const proof=(method:string,path:string,body?:unknown)=>proofFor(config.serverId,paired.deviceId,keys.privateKey,method,path,path.startsWith('/v2/')&&method!=='GET'?{...(body as Record<string,unknown>),expectedWallet:(body as {expectedWallet?:string})?.expectedWallet??created.wallet}:body);
    const order:ProOrder={id:randomUUID(),revision:1,wallet:created.wallet,spec:spec(),state:'OPEN',createdAt:Date.now(),updatedAt:Date.now()};
    await signer.registerOrder(order,proof('POST','/v1/orders',{orderId:order.id,spec:order.spec}));return{signer,proof,order,market};
  }
  it('reserves reviewed entry and protection caps before entry and hands off one cap after confirmed fill',async()=>{
    const {signer,order,proof,market}=await authority();try{
      await signer.control('cancel',proof('POST',`/v1/orders/${order.id}/cancel`,{revision:1}));
      const mint='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';let sol=25000n,quantity=0n;market.balances=async()=>({[SOL]:sol,[mint]:quantity});
      market.observation=async()=>({priceUsd:'1',solUsdMicros:usdUnits('100'),quoteAt:Date.now(),solUsdAt:Date.now(),observedAt:Date.now(),outputRaw:'123456',supplyRaw:'1000000000000',tokenDecimals:6});
      const entry:ProOrder={...order,id:randomUUID(),spec:{...order.spec,version:2,basis:'MC',mint,exitStrategy:{durationMs:86400000,steps:[{id:randomUUID(),kind:'STOP_LOSS',targetMcUsd:'500000',remaining:true}]}}};
      const entryProof=proof('POST','/v2/orders',{orderId:entry.id,spec:entry.spec});await expect(signer.registerOrder(entry,entryProof)).rejects.toThrow('unreserved');expect((await signer.inspect(entry.id)).order).toBeUndefined();sol=30000n;await signer.registerOrder(entry,entryProof);expect((await signer.walletBalances(mint)).find(r=>r.mint===SOL)?.reservedRaw).toBe('30000');
      await signer.unlock('a-test-only-long-passphrase');await signer.control('resume-engine',proof('POST','/v1/resume-engine'));vi.spyOn(Connection.prototype,'getFeeForMessage').mockResolvedValue({context:{slot:1},value:5000});const signed=await signer.sign(entry.id,randomUUID());expect(signed.networkRaw).toBe('5000');
      const at=Date.now();sol=15000n;quantity=123456n;market.reconcile=async()=>({state:'CONFIRMED',receivedRaw:'123456',fillPriceUsd:'1',tokenDecimals:6,confirmedAt:at});expect((await signer.walletBalances(mint)).find(r=>r.mint===SOL)?.reservedRaw).toBe('10000');
      const child:ProOrder={...entry,id:`${entry.id}:exit`,parentId:entry.id,spec:deriveExitSpec(entry,'123456','1',6,at)};await signer.registerOrder(child,entryProof);const balances=await signer.walletBalances(mint);expect(balances.find(r=>r.mint===SOL)?.reservedRaw).toBe('10000');expect(balances.find(r=>r.mint===mint)?.reservedRaw).toBe('123456');
    }finally{signer.close();}
  });
  it('executes a later split with only remaining authorized SOL cap and preserves cost metadata on exact recovery',async()=>{
    const {signer,order,proof,market}=await authority();try{
      await signer.control('cancel',proof('POST',`/v1/orders/${order.id}/cancel`,{revision:1}));
      const mint='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';let sol=10000n,quantity=1000000n,price='2';market.balances=async()=>({[SOL]:sol,[mint]:quantity});
      market.observation=async()=>({priceUsd:price,solUsdMicros:usdUnits('100'),quoteAt:Date.now(),solUsdAt:Date.now(),observedAt:Date.now(),outputRaw:'100',supplyRaw:'1000000000000',tokenDecimals:6});
      const group:ProOrder={...order,id:randomUUID(),spec:{...order.spec,version:2,basis:'MC',kind:'STRATEGY',side:'SELL',mint,decimals:6,amountRaw:'1000000',steps:[{id:randomUUID(),kind:'TAKE_PROFIT',targetMcUsd:'2000000',portionBps:5000},{id:randomUUID(),kind:'TAKE_PROFIT',targetMcUsd:'3000000',portionBps:5000}]}};
      await signer.registerOrder(group,proof('POST','/v2/strategies',{orderId:group.id,spec:group.spec}));await signer.unlock('a-test-only-long-passphrase');await signer.control('resume-engine',proof('POST','/v1/resume-engine'));vi.spyOn(Connection.prototype,'getFeeForMessage').mockResolvedValue({context:{slot:1},value:5000});const first=await signer.sign(group.id,randomUUID());expect(first.inputRaw).toBe('500000');
      sol=5000n;quantity=500000n;price='3';market.reconcile=async()=>({state:'FINALIZED'});const balances=await signer.walletBalances(mint),balance=balances.find(r=>r.mint===SOL)!;expect(balance.reservedRaw).toBe('5000');expect(balance.availableRaw).toBe('0');
      const attemptId=randomUUID(),second=await signer.sign(group.id,attemptId);expect(second.inputRaw).toBe('500000');expect(second.networkRaw).toBe('5000');expect(await signer.recover(group.id,attemptId)).toEqual(second);
    }finally{signer.close();}
  });
  it('fences an expired local-only MC cancellation and rejects later create or signed uncertainty cancellation',async()=>{
    const {signer,order,proof,market}=await authority();try{
      const draft:ProOrder={...order,id:randomUUID(),spec:{...order.spec,version:2,basis:'MC',expiresAt:Date.now()-1}};
      await signer.control('cancel',proof('POST',`/v2/orders/${draft.id}/retry`,{revision:1,spec:draft.spec,action:'cancel'}));
      expect((await signer.inspect(draft.id)).order?.state).toBe('CANCELLED');
      const renewed={...draft.spec,expiresAt:Date.now()+60000};await expect(signer.registerOrder({...draft,spec:renewed},proof('POST','/v2/orders',{orderId:draft.id,spec:renewed}))).rejects.toThrow('Terminal');
      const arrived:ProOrder={...order,id:randomUUID(),spec:{...order.spec,version:2,basis:'MC'}};
      await signer.registerOrder(arrived,proof('POST','/v2/orders',{orderId:arrived.id,spec:arrived.spec}));
      await expect(signer.control('cancel',proof('POST',`/v2/orders/${arrived.id}/retry`,{revision:1,spec:{...arrived.spec,amountRaw:'10001'},action:'cancel'}))).rejects.toThrow('authenticated order intent');
      await signer.control('cancel',proof('POST',`/v2/orders/${arrived.id}/retry`,{revision:1,spec:arrived.spec,action:'cancel'}));
      expect((await signer.inspect(arrived.id)).order?.state).toBe('CANCELLED');await signer.control('cancel',proof('POST',`/v2/orders/${arrived.id}/retry`,{revision:1,spec:arrived.spec,action:'cancel'}));
      const next:ProOrder={...order,id:randomUUID(),spec:{...order.spec,version:2,basis:'MC'}};
      market.observation=async()=>({priceUsd:'1',solUsdMicros:usdUnits('100'),quoteAt:Date.now(),solUsdAt:Date.now(),observedAt:Date.now(),outputRaw:'100',supplyRaw:'1000000000',tokenDecimals:9});
      await signer.registerOrder(next,proof('POST','/v2/orders',{orderId:next.id,spec:next.spec}));await signer.unlock('a-test-only-long-passphrase');await signer.control('resume-engine',proof('POST','/v1/resume-engine'));vi.spyOn(Connection.prototype,'getFeeForMessage').mockResolvedValue({context:{slot:1},value:5000});await signer.sign(next.id,randomUUID());
      await expect(signer.control('cancel',proof('POST',`/v2/orders/${next.id}/retry`,{revision:1,spec:next.spec,action:'cancel'}))).rejects.toThrow('in-flight');expect((await signer.inspect(next.id)).order?.state).toBe('SIGNING');
    }finally{signer.close();}
  });
  it('independently rejects a changed reviewed wallet for MC registration and controls',async()=>{
    const {signer,order,proof}=await authority();try{
      const next:ProOrder={...order,id:randomUUID(),spec:{...order.spec,version:2,basis:'MC'}};
      await expect(signer.registerOrder(next,proof('POST','/v2/orders',{orderId:next.id,spec:next.spec,expectedWallet:'wrong-wallet'}))).rejects.toThrow('wallet changed');
      await expect(signer.control('cancel',proof('POST',`/v2/orders/${next.id}/retry`,{revision:1,spec:next.spec,action:'cancel',expectedWallet:'wrong-wallet'}))).rejects.toThrow('wallet changed');expect((await signer.inspect(next.id)).order).toBeUndefined();
    }finally{signer.close();}
  });
  it('revalidates unsigned MC recovery and never resumes a paused order implicitly',async()=>{
    const {signer,order,proof,market}=await authority();try{
      await signer.control('cancel',proof('POST',`/v1/orders/${order.id}/cancel`,{revision:1}));
      let price='2';const mint='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      market.balances=async()=>({[SOL]:10000000n,[mint]:1000000n});
      market.observation=async()=>({priceUsd:price,solUsdMicros:usdUnits('100'),quoteAt:Date.now(),solUsdAt:Date.now(),observedAt:Date.now(),outputRaw:'100',supplyRaw:'1000000000000',tokenDecimals:6});
      const next:ProOrder={...order,id:randomUUID(),spec:{...order.spec,version:2,basis:'MC',kind:'TAKE_PROFIT',side:'SELL',mint,amountRaw:'1000000',decimals:6,triggerMcUsd:'2000000'}};
      await signer.registerOrder(next,proof('POST','/v2/orders',{orderId:next.id,spec:next.spec}));await signer.unlock('a-test-only-long-passphrase');await signer.control('resume-engine',proof('POST','/v1/resume-engine'));
      vi.spyOn(Connection.prototype,'getFeeForMessage').mockResolvedValue({context:{slot:1},value:5000});vi.spyOn((signer as unknown as {connection:Connection}).connection,'getBlockHeight').mockResolvedValue(1);
      const signCall=vi.spyOn(VersionedTransaction.prototype,'sign');signCall.mockImplementationOnce(()=>{throw new Error('simulated crash before signature');});
      const attemptId=randomUUID();await expect(signer.sign(next.id,attemptId)).rejects.toThrow('simulated crash');price='1';await expect(signer.recover(next.id,attemptId)).rejects.toThrow('fresh matching');expect(signCall).toHaveBeenCalledTimes(1);
      price='2';await signer.control('pause-all',proof('POST','/v1/pause-all'));await signer.control('resume-engine',proof('POST','/v1/resume-engine'));await expect(signer.recover(next.id,attemptId)).rejects.toThrow('paused');expect(signCall).toHaveBeenCalledTimes(1);
    }finally{signer.close();}
  });
  it('never signs paused v1 unsigned recovery after only the engine is resumed',async()=>{
    const {signer,order,proof}=await authority();try{
      await signer.unlock('a-test-only-long-passphrase');await signer.control('resume-engine',proof('POST','/v1/resume-engine'));
      vi.spyOn(Connection.prototype,'getFeeForMessage').mockResolvedValue({context:{slot:1},value:5000});
      vi.spyOn((signer as unknown as {connection:Connection}).connection,'getBlockHeight').mockResolvedValue(1);
      const signing=vi.spyOn(VersionedTransaction.prototype,'sign').mockImplementation(()=>{throw new Error('No test signature permitted');});
      const attemptId=randomUUID();await expect(signer.sign(order.id,attemptId)).rejects.toThrow('No test signature');
      await signer.control('pause-all',proof('POST','/v1/pause-all'));await signer.control('resume-engine',proof('POST','/v1/resume-engine'));
      await expect(signer.recover(order.id,attemptId)).rejects.toThrow('paused');expect(signing).toHaveBeenCalledTimes(1);
    }finally{signer.close();}
  });
  it.each(['success','failure'] as const)('ignores a stale trailing observation %s after an authenticated edit',async outcome=>{
    const {signer,order,proof,market}=await authority();try{
      const trailing:ProOrder={...order,revision:2,spec:{...order.spec,kind:'TRAILING',side:'SELL',trailingBps:500}};
      await signer.registerOrder(trailing,proof('PATCH',`/v1/orders/${order.id}`,{revision:1,spec:trailing.spec}));
      await signer.unlock('a-test-only-long-passphrase');await signer.control('resume-engine',proof('POST','/v1/resume-engine'));
      let resolve!:(value:Awaited<ReturnType<MarketPort['observation']>>)=>void,reject!:(error:Error)=>void;
      market.observation=()=>new Promise((yes,no)=>{resolve=yes;reject=no;});
      const observing=signer.observeTrailing();while(!resolve)await Promise.resolve();
      const replacement:ProOrder={...trailing,revision:3,spec:{...trailing.spec,trailingBps:1000}};
      await signer.registerOrder(replacement,proof('PATCH',`/v1/orders/${order.id}`,{revision:2,spec:replacement.spec}));
      if(outcome==='success')resolve({priceUsd:'10',solUsdMicros:usdUnits('100'),quoteAt:Date.now(),solUsdAt:Date.now(),observedAt:Date.now(),outputRaw:'100'});
      else reject(new Error('Old observation failed'));
      await observing;const current=(await signer.inspect(order.id)).order!;
      expect(current.revision).toBe(3);expect(current.state).toBe('OPEN');expect(current.highWatermark).toBeUndefined();expect(current.trailActive).toBe(false);
    }finally{signer.close();}
  });
  it('rejects injected residual reservations on nonstrategy edits',async()=>{
    const {signer,order,proof,market}=await authority();try{
      market.balances=async()=>({[SOL]:10000000n});
      const edited:ProOrder={...order,revision:2,strategy:{baseRaw:'0',remainingRaw:'0',steps:[]}};
      await signer.registerOrder(edited,proof('PATCH',`/v1/orders/${order.id}`,{revision:1,spec:edited.spec}));
      expect((await signer.inspect(order.id)).order?.strategy).toBeUndefined();expect((await signer.walletBalances(SOL))[0]?.reservedRaw).toBe('20000');
    }finally{signer.close();}
  });
  it('derives private child inventory after deferred entry and ignores submitted progress',async()=>{
    const {signer,order,proof,market}=await authority();try{
      await signer.control('cancel',proof('POST',`/v1/orders/${order.id}/cancel`,{revision:1}));
      const mint='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';market.balances=async()=>({[SOL]:10000000n,[mint]:1000000n});
      market.observation=async()=>({priceUsd:'1',solUsdMicros:usdUnits('100'),quoteAt:Date.now(),solUsdAt:Date.now(),observedAt:Date.now(),outputRaw:'100',supplyRaw:'1000000000000',tokenDecimals:6});
      const entry:ProOrder={...order,id:randomUUID(),spec:{...order.spec,version:2,basis:'MC',mint,exitStrategy:{durationMs:86400000,steps:[{id:randomUUID(),kind:'STOP_LOSS',targetMcUsd:'500000',remaining:true}]}}};
      const entryProof=proof('POST','/v2/orders',{orderId:entry.id,spec:entry.spec});await signer.registerOrder(entry,entryProof);
      const db=new DatabaseSync(signer.config.journalPath),deferredId=randomUUID();db.prepare('INSERT INTO signing VALUES(?,?,?)').run(deferredId,entry.id,JSON.stringify({id:deferredId,orderId:entry.id,state:'FAILED',deferred:true,signedTransaction:'',signature:'',buyRaw:'0'}));db.close();
      await signer.unlock('a-test-only-long-passphrase');await signer.control('resume-engine',proof('POST','/v1/resume-engine'));vi.spyOn(Connection.prototype,'getFeeForMessage').mockResolvedValue({context:{slot:1},value:5000});await signer.sign(entry.id,randomUUID());
      const at=Date.now();market.reconcile=async()=>({state:'FINALIZED',receivedRaw:'123456',fillPriceUsd:'1',tokenDecimals:6,confirmedAt:at});
      const childSpec=deriveExitSpec(entry,'123456','1',6,at);const child:ProOrder={...entry,id:`${entry.id}:exit`,parentId:entry.id,spec:childSpec,strategy:{baseRaw:'999999999',remainingRaw:'999999999',steps:[]}};
      await signer.registerOrder(child,entryProof);const stored=(await signer.inspect(child.id)).order;expect(stored?.strategy?.baseRaw).toBe('123456');expect(stored?.strategy?.remainingRaw).toBe('123456');expect(stored?.strategy?.steps).toHaveLength(1);
    }finally{signer.close();}
  });
  it('rebuilds MC group quantities privately, sizes fills and keeps paused/cancelled state during ledger sync',async()=>{
    const {signer,order,proof,market}=await authority();try{
      await signer.control('cancel',proof('POST',`/v1/orders/${order.id}/cancel`,{revision:1}));
      const mint='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      market.balances=async()=>({[SOL]:10000000n,[mint]:1000000n});
      market.observation=async()=>({priceUsd:'2',solUsdMicros:usdUnits('100'),quoteAt:Date.now(),solUsdAt:Date.now(),observedAt:Date.now(),outputRaw:'10000',supplyRaw:'1000000000000',tokenDecimals:6});
      const steps=[{id:randomUUID(),kind:'TAKE_PROFIT' as const,targetMcUsd:'2000000',portionBps:2500},{id:randomUUID(),kind:'STOP_LOSS' as const,targetMcUsd:'500000',remaining:true as const}];
      const group:ProOrder={...order,id:randomUUID(),spec:{...order.spec,version:2,basis:'MC',kind:'STRATEGY',side:'SELL',mint,amountRaw:'1000000',decimals:6,steps},strategy:{baseRaw:'9000000',remainingRaw:'9000000',steps:steps.map(r=>({id:r.id,state:'OPEN'}))}};
      await signer.registerOrder(group,proof('POST','/v2/strategies',{orderId:group.id,spec:group.spec}));
      expect((await signer.inspect(group.id)).order?.strategy?.baseRaw).toBe('1000000');
      await signer.unlock('a-test-only-long-passphrase');await signer.control('resume-engine',proof('POST','/v1/resume-engine'));
      vi.spyOn(Connection.prototype,'getFeeForMessage').mockResolvedValue({context:{slot:1},value:5000});
      const signed=await signer.sign(group.id,randomUUID());expect(signed.inputRaw).toBe('250000');expect(signed.strategyStepId).toBe(steps[0]!.id);
      market.reconcile=async()=>({state:'FINALIZED'});await signer.walletBalances(mint);
      expect((await signer.inspect(group.id)).order?.strategy?.remainingRaw).toBe('750000');
      await signer.control('pause',proof('POST',`/v2/strategies/${group.id}/pause`,{revision:1}));await signer.walletBalances(mint);expect((await signer.inspect(group.id)).order?.state).toBe('PAUSED');
      await signer.control('cancel',proof('POST',`/v2/strategies/${group.id}/cancel`,{revision:2}));await signer.walletBalances(mint);expect((await signer.inspect(group.id)).order?.state).toBe('CANCELLED');
    }finally{signer.close();}
  });
  it('keeps wallet reservations in private signer records and rejects competing authorizations',async()=>{
    const {signer,order,proof,market}=await authority();try{
      market.balances=async()=>({So11111111111111111111111111111111111111112:30000n});
      const balance=(await signer.walletBalances(order.spec.mint))[0]!;expect(balance.reservedRaw).toBe('20000');expect(balance.availableRaw).toBe('10000');
      const other:ProOrder={...order,id:randomUUID()};await expect(signer.registerOrder(other,proof('POST','/v1/orders',{orderId:other.id,spec:other.spec}))).rejects.toThrow('unreserved');
      await signer.control('cancel',proof('POST',`/v1/orders/${order.id}/cancel`,{revision:1}));
      await signer.registerOrder(other,proof('POST','/v1/orders',{orderId:other.id,spec:other.spec}));expect((await signer.walletBalances(other.spec.mint))[0]?.reservedRaw).toBe('20000');
    }finally{signer.close();}
  });
  it('serializes concurrent order registration against the same available balance',async()=>{
    const {signer,order,proof,market}=await authority();try{
      await signer.control('cancel',proof('POST',`/v1/orders/${order.id}/cancel`,{revision:1}));market.balances=async()=>({So11111111111111111111111111111111111111112:30000n});
      const orders=[{...order,id:randomUUID()},{...order,id:randomUUID()}];
      const results=await Promise.allSettled(orders.map(o=>signer.registerOrder(o,proof('POST','/v1/orders',{orderId:o.id,spec:o.spec}))));expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await signer.walletBalances(order.spec.mint))[0]?.reservedRaw).toBe('20000');
    }finally{signer.close();}
  });
  it('retains triggered orders during a withdrawal, including a readiness/sign race',async()=>{
    const {signer,order,proof,market}=await authority();const store=new ProStore(':memory:');const journal=new DatabaseSync(signer.config.journalPath);
    try{
      await signer.unlock('a-test-only-long-passphrase');await signer.control('resume-engine',proof('POST','/v1/resume-engine',{}));
      const id=randomUUID();journal.prepare('INSERT INTO withdrawals VALUES(?,?)').run(id,canonicalJson({id,spec:{},deviceId:proof('GET','/v1/health').envelope.deviceId,state:'CONFIRMED',signature:'test-signature',createdAt:Date.now(),updatedAt:Date.now(),lastValidBlockHeight:999999}));
      vi.spyOn(Connection.prototype,'getSignatureStatuses').mockResolvedValue({context:{slot:1},value:[{slot:1,confirmations:1,err:null,confirmationStatus:'confirmed'}]});
      vi.spyOn(Connection.prototype,'getFeeForMessage').mockResolvedValue({context:{slot:1},value:5000});
      const port:SignerPort={status:async()=>signer.status(),registerOrder:signer.registerOrder.bind(signer),sign:signer.sign.bind(signer),control:signer.control.bind(signer),inspect:signer.inspect.bind(signer),recover:signer.recover.bind(signer),executionReady:signer.executionReady.bind(signer)};
      const engine=new ProEngine(store,market,port,order.wallet,signer.config.limits);engine.state='RUNNING';store.save(order);store.reserve(order,await market.balances(SOL));
      await engine.tick();expect(store.order(order.id).state).toBe('OPEN');expect(store.attempts()).toHaveLength(0);
      // Simulate settlement beginning immediately after the readiness response.
      port.executionReady=async()=>true;await engine.tick();expect(store.order(order.id).state).toBe('OPEN');expect(store.attempts()).toHaveLength(0);expect(store.locked(order.wallet)).toBe(false);expect(engine.state).toBe('RUNNING');
      const realSign=port.sign;port.sign=async(orderId,attemptId)=>{try{return await realSign(orderId,attemptId);}catch{throw new Error('busy reply lost');}};
      await engine.tick();expect(store.order(order.id).state).toBe('UNKNOWN');expect(store.attempts()).toHaveLength(1);
      port.sign=realSign;const restarted=new ProEngine(store,market,port,order.wallet,signer.config.limits);restarted.state='RUNNING';await restarted.tick();expect(store.order(order.id).state).toBe('OPEN');expect(store.attempts()).toHaveLength(0);expect(store.locked(order.wallet)).toBe(false);
      journal.prepare("UPDATE withdrawals SET value=json_set(value,'$.state','FINALIZED') WHERE id=?").run(id);
      await engine.tick();expect(store.order(order.id).state).toBe('UNKNOWN');expect(store.attempts()).toHaveLength(1);expect(store.order(order.id).state).not.toBe('FAILED');
    }finally{journal.close();store.close();signer.close();}
  });
  it('does not recover unsigned trading bytes after pause or device revocation',async()=>{
    const {signer,order,proof}=await authority();const journal=new DatabaseSync(signer.config.journalPath);try{
      const wallet=new PublicKey(order.wallet),tx=new VersionedTransaction(new TransactionMessage({payerKey:wallet,recentBlockhash:'11111111111111111111111111111111',instructions:[SystemProgram.transfer({fromPubkey:wallet,toPubkey:wallet,lamports:1})]}).compileToV0Message());
      const id=randomUUID(),deviceId=proof('GET','/v1/health').envelope.deviceId;
      journal.prepare('INSERT INTO signing VALUES(?,?,?)').run(id,order.id,canonicalJson({id,orderId:order.id,state:'AUTHORIZED',createdAt:Date.now(),updatedAt:Date.now(),buyRaw:'0',deviceId,solUsdUnits:'1',signedTransaction:Buffer.from(tx.serialize()).toString('base64'),signature:'',blockhash:'11111111111111111111111111111111',lastValidBlockHeight:999999}));
      await signer.unlock('a-test-only-long-passphrase');await expect(signer.recover(order.id,id)).rejects.toThrow('resume');
      await signer.control('resume-engine',proof('POST','/v1/resume-engine',{}));signer.auth.revoke(deviceId);await expect(signer.recover(order.id,id)).rejects.toThrow('revoked');
      expect(JSON.parse(String(journal.prepare('SELECT value FROM signing WHERE id=?').get(id)?.value)).signature).toBe('');
    }finally{journal.close();signer.close();}
  });
  it('never signs locked/paused or body altered from approved intent',async()=>{const {signer,order,proof}=await authority();try{
    await expect(signer.sign(order.id,randomUUID())).rejects.toThrow('locked');await signer.unlock('a-test-only-long-passphrase');await expect(signer.sign(order.id,randomUUID())).rejects.toThrow('paused');
    await expect(signer.registerOrder({...order,spec:{...order.spec,amountRaw:'90000'}},proof('POST','/v1/orders',{orderId:order.id,spec:order.spec}))).rejects.toThrow('differs');
  }finally{signer.close();}});
  it('reuses exact signed bytes, forbids a second attempt and fences late approval',async()=>{const {signer,order,proof}=await authority();try{
    await signer.unlock('a-test-only-long-passphrase');await signer.control('resume-engine',proof('POST','/v1/resume-engine',{}));vi.spyOn(Connection.prototype,'getFeeForMessage').mockResolvedValue({context:{slot:1},value:5000});
    const id=randomUUID(),first=await signer.sign(order.id,id);expect(first.signature).not.toBe('');expect(await signer.sign(order.id,id)).toEqual(first);expect(await signer.recover(order.id,id)).toEqual(first);
    await expect(signer.sign(order.id,randomUUID())).rejects.toThrow();await expect(signer.control('cancel',proof('POST',`/v1/orders/${order.id}/cancel`,{revision:1}))).rejects.toThrow('in-flight');
    const never=randomUUID();expect(await signer.recover(order.id,never)).toBeNull();await expect(signer.sign(order.id,never)).rejects.toThrow('fenced');
  }finally{signer.close();}});
  it('pause acknowledgement prevents all subsequent authorizations',async()=>{const {signer,order,proof}=await authority();try{await signer.unlock('a-test-only-long-passphrase');await signer.control('resume-engine',proof('POST','/v1/resume-engine',{}));await signer.control('pause-all',proof('POST','/v1/pause-all',{}));await expect(signer.sign(order.id,randomUUID())).rejects.toThrow('paused');}finally{signer.close();}});
  it('does not reinterpret a signed pending cancellation as a create and fences late resume/register',async()=>{
    const {signer,order,proof}=await authority();try{
      const missing:ProOrder={...order,id:randomUUID()};const cancel=proof('POST',`/v1/orders/${missing.id}/retry`,{revision:1,spec:missing.spec,action:'cancel'});
      await expect(signer.registerOrder(missing,cancel)).rejects.toThrow('Retry action');await signer.control('cancel',cancel);expect((await signer.inspect(missing.id)).order?.state).toBe('CANCELLED');
      await expect(signer.registerOrder(missing,proof('POST','/v1/orders',{orderId:missing.id,spec:missing.spec}))).rejects.toThrow('Terminal');
      await expect(signer.control('resume',proof('POST',`/v1/orders/${missing.id}/resume`,{revision:1}))).rejects.toThrow('Terminal');
      await signer.control('cancel',proof('POST',`/v1/orders/${order.id}/retry`,{revision:1,spec:order.spec,action:'cancel'}));expect((await signer.inspect(order.id)).order?.state).toBe('CANCELLED');
      expect((await signer.inspect(order.id)).order?.revision).toBe(1);
      await expect(signer.control('resume',proof('POST',`/v1/orders/${order.id}/resume`,{revision:1}))).rejects.toThrow('Terminal');
    }finally{signer.close();}
  });
  it('authorizes a fresh exact retry edit and accepts cancellation after a lost edit acknowledgement',async()=>{
    const {signer,order,proof}=await authority();try{
      const edited:ProOrder={...order,revision:2,spec:{...order.spec,amountRaw:'20000'}};
      await signer.registerOrder(edited,proof('POST',`/v1/orders/${order.id}/retry`,{revision:2,spec:edited.spec,action:'edit'}));
      await signer.control('cancel',proof('POST',`/v1/orders/${order.id}/retry`,{revision:2,spec:edited.spec,action:'cancel'}));
      const actual=(await signer.inspect(order.id)).order!;expect(actual.state).toBe('CANCELLED');expect(actual.revision).toBe(2);expect(actual.spec).toEqual(edited.spec);
    }finally{signer.close();}
  });
});
it('accepts tiny token prices, bounds fees and rejects incompatible spec fields',()=>{expect(usdUnits('0.000000000001')).toBe(1n);expect(validateProSpec(spec()).amountRaw).toBe('10000');expect(()=>validateProSpec({...spec(),privateKey:'never'})).toThrow('Unknown');expect(()=>validateProSpec({...spec(),slippageBps:9999})).toThrow('Slippage');});
