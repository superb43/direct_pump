import { describe, it, expect, vi } from 'vitest';
import { ProStore, SOL } from '../../server/store';
import { ProEngine, deriveExitSpec, type MarketPort } from '../../server/engine';
import { limitMinimum, setupRentLamports } from '../../server/execution';
import { Connection, PublicKey } from '@solana/web3.js';
import { usdUnits, type ProSpec, type AuthProof } from '../../src/pro/contracts';
const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const id = '12345678-1234-4123-8123-123456789abc';
const proof = {} as AuthProof;
function setup() {
    const store = new ProStore(':memory:');
    const spec: ProSpec = { kind: 'MARKET', side: 'BUY', mint, target: { site: 'GMGN', kind: 'MINT', address: mint, pageUrl: 'https://gmgn.ai' }, amountRaw: '100000000', decimals: 9, expiresAt: Date.now() + 60000, slippageBps: 100, priorityFeeLamports: 0, maxNetworkLamports: '10000' };
    const market: MarketPort = { observation: vi.fn(async () => ({ priceUsd: '1', solUsdMicros: usdUnits('100'), quoteAt: Date.now(), solUsdAt: Date.now(), observedAt: Date.now(), outputRaw: '10000000', tokenDecimals: 6 })), balances: vi.fn(async () => ({ [SOL]: 10000000000n, [mint]: 100000000n })), submit: vi.fn(async () => 'sig'), reconcile: vi.fn(async () => ({ state: 'UNKNOWN' as const })) };
    let paused = true;
    const authority = new Map<string, import('../../src/pro/contracts').ProOrder>();
    const signer = { status: vi.fn(async () => 'READY' as const), inspect: vi.fn(async (orderId?: string) => ({ order: orderId ? authority.get(orderId) : undefined, paused })), registerOrder: vi.fn(async (order: import('../../src/pro/contracts').ProOrder) => { authority.set(order.id, structuredClone({ ...order, state: 'OPEN' as const })); }), control: vi.fn(async (action: string) => {
            if (action === 'resume-engine')
                paused = false;
            else if (action === 'pause-all') {
                paused = true;
                for (const o of authority.values())
                    if (o.state === 'OPEN')
                        o.state = 'PAUSED';
            }
            else
                for (const o of authority.values()) {
                    const pending = store.meta(`mutation:${o.id}`);
                    if (pending && JSON.parse(pending).action === action) {
                        o.revision++;
                        o.state = action === 'pause' ? 'PAUSED' : action === 'cancel' ? 'CANCELLED' : 'OPEN';
                    }
                }
        }), sign: vi.fn(async () => ({ signedTransaction: 'AA==', signature: 'sig', blockhash: 'hash', lastValidBlockHeight: 123 })) };
    const engine = new ProEngine(store, market, signer, 'wallet', { maxBuyLamports: '1000000000', dailyBuyLamports: '2000000000', maxNetworkLamports: '100000' });
    return { store, spec, market, signer, engine, authority };
}
describe('Pro durable execution', () => {
    it('rolls back a duplicate financial asset replacement without releasing existing reservations',()=>{
      const f=setup();try{
        f.store.atomic(()=>f.store.reserve({id,revision:1,spec:f.spec,wallet:'wallet',state:'OPEN',createdAt:0,updatedAt:0},{[SOL]:10000000000n}));
        const before=f.store.reserved(SOL);
        expect(()=>f.store.atomic(()=>f.store.replaceReservations(id,[[SOL,1n],[SOL,2n]]))).toThrow();expect(f.store.reserved(SOL)).toBe(before);
      }finally{f.store.close();}
    });
    it.each(['validation','balance'] as const)('preserves the original order and reservation on edit %s failure',async failure=>{
      const f=setup();try{
        await f.engine.create(id,f.spec,proof);const before=f.store.order(id),reserved=f.store.reserved(SOL);
        if(failure==='balance')vi.mocked(f.market.balances).mockRejectedValueOnce(new Error('Balance unavailable'));
        await expect(f.engine.change(id,1,'edit',proof,failure==='validation'?{}:{...f.spec,amountRaw:'200000000'})).rejects.toThrow();
        expect(f.store.order(id)).toEqual(before);expect(f.store.reserved(SOL)).toBe(reserved);expect(f.store.meta(`mutation:${id}`)).toBeFalsy();
      }finally{f.store.close();}
    });
    it('does not execute an order while its replacement review is being validated',async()=>{
      const f=setup();try{
        await f.engine.create(id,f.spec,proof);await f.engine.control('resume-engine',proof);
        let resolve!:(value:Awaited<ReturnType<MarketPort['observation']>>)=>void;
        const observation={priceUsd:'1',solUsdMicros:usdUnits('100'),quoteAt:Date.now(),solUsdAt:Date.now(),observedAt:Date.now(),outputRaw:'100',tokenDecimals:6};
        vi.mocked(f.market.observation).mockImplementationOnce(()=>new Promise(yes=>{resolve=yes;}));
        const changing=f.engine.change(id,1,'edit',proof,{...f.spec,amountRaw:'200000000'});while(!resolve)await Promise.resolve();
        await f.engine.tick();expect(f.signer.sign).not.toHaveBeenCalled();resolve(observation);await changing;
        expect(f.store.order(id).revision).toBe(2);expect(f.store.order(id).state).toBe('OPEN');
      }finally{f.store.close();}
    });
    it('ignores an older quote failure while a replacement review is still pending',async()=>{
      const f=setup();try{
        await f.engine.create(id,f.spec,proof);await f.engine.control('resume-engine',proof);
        let rejectOld!:(error:Error)=>void,resolveReview!:(value:Awaited<ReturnType<MarketPort['observation']>>)=>void;
        vi.mocked(f.market.observation).mockImplementationOnce(()=>new Promise((_,reject)=>{rejectOld=reject;}));
        const ticking=f.engine.tick();while(!rejectOld)await Promise.resolve();
        vi.mocked(f.market.observation).mockImplementationOnce(()=>new Promise(resolve=>{resolveReview=resolve;}));
        const changing=f.engine.change(id,1,'edit',proof,{...f.spec,amountRaw:'200000000'});while(!resolveReview)await Promise.resolve();
        rejectOld(new Error('Old quote failed'));await ticking;expect(f.store.order(id).state).toBe('OPEN');
        resolveReview({priceUsd:'1',solUsdMicros:usdUnits('100'),quoteAt:Date.now(),solUsdAt:Date.now(),observedAt:Date.now(),outputRaw:'100',tokenDecimals:6});await changing;
        expect(f.store.order(id).revision).toBe(2);expect(f.signer.sign).not.toHaveBeenCalled();
      }finally{f.store.close();}
    });
    it('atomically releases an independently proven expired signed attempt without resubmitting',async()=>{
      const f=setup();try{
        await f.engine.create(id,f.spec,proof);await f.engine.control('resume-engine',proof);await f.engine.tick();
        expect(f.store.locked('wallet')).toBe(true);vi.mocked(f.market.reconcile).mockResolvedValue({state:'EXPIRED'});
        await f.engine.tick();expect(f.store.order(id).state).toBe('EXPIRED');expect(f.store.attempts()[0]?.state).toBe('EXPIRED');
        expect(f.store.locked('wallet')).toBe(false);expect(f.store.reserved(SOL)).toBe(0n);expect(f.market.submit).toHaveBeenCalledTimes(1);
      }finally{f.store.close();}
    });
    it('releases expired unactivated protection only after final chain settlement',async()=>{const f=setup();try{
      await f.engine.create(id,{...f.spec,exit:{tpBps:1000,slBps:500,slippageBps:100,durationMs:60000}},proof);await f.engine.control('resume-engine',proof);await f.engine.tick();
      const fill={receivedRaw:'123456',fillPriceUsd:'1',tokenDecimals:6,confirmedAt:Date.now()-60001};vi.mocked(f.market.reconcile).mockResolvedValue({state:'CONFIRMED',...fill});await f.engine.tick();
      expect(f.store.orders()).toHaveLength(1);expect(f.store.order(id).protectionPending).toBe(false);expect(f.store.locked('wallet')).toBe(true);
      vi.mocked(f.market.reconcile).mockResolvedValue({state:'FINALIZED',...fill});await f.engine.tick();expect(f.store.locked('wallet')).toBe(false);expect(f.store.reserved(mint)).toBe(0n);expect(f.store.events().filter(e=>e.type==='PROTECTION_EXPIRED')).toHaveLength(1);
    }finally{f.store.close();}});
    it('starts recovering, reserves input and fee atomically, requires explicit resume', async () => { const f = setup(); await f.engine.create(id, f.spec, proof); expect(f.store.reserved(SOL)).toBe(100010000n); await f.engine.tick(); expect(f.signer.sign).not.toHaveBeenCalled(); await f.engine.control('resume-engine', proof); await f.engine.tick(); expect(f.store.order(id).state).toBe('SUBMITTED'); expect(f.store.locked('wallet')).toBe(true); f.store.close(); });
    it('never signs again after ambiguous submission or restart', async () => { const f = setup(); vi.mocked(f.market.submit).mockRejectedValue(new Error('timeout')); await f.engine.create(id, f.spec, proof); await f.engine.control('resume-engine', proof); await f.engine.tick(); await f.engine.tick(); expect(f.store.order(id).state).toBe('UNKNOWN'); expect(f.signer.sign).toHaveBeenCalledTimes(1); const restarted = new ProEngine(f.store, f.market, f.signer, 'wallet', f.engine.limits); await restarted.control('resume-engine', proof); await restarted.tick(); expect(f.signer.sign).toHaveBeenCalledTimes(1); f.store.close(); });
    it('blocks external balance reductions without shrinking the intent', async () => { const f = setup(); await f.engine.create(id, f.spec, proof); vi.mocked(f.market.balances).mockResolvedValue({ [SOL]: 100n, [mint]: 0n }); await f.engine.control('resume-engine', proof); await f.engine.tick(); expect(f.store.order(id).state).toBe('BLOCKED'); expect(f.store.order(id).spec.amountRaw).toBe(f.spec.amountRaw); expect(f.signer.sign).not.toHaveBeenCalled(); f.store.close(); });
    it('retains wallet lock across confirmation and releases only at finalized', async () => { const f = setup(); await f.engine.create(id, f.spec, proof); await f.engine.control('resume-engine', proof); await f.engine.tick(); vi.mocked(f.market.reconcile).mockResolvedValue({ state: 'CONFIRMED' }); await f.engine.tick(); expect(f.store.locked('wallet')).toBe(true); vi.mocked(f.market.reconcile).mockResolvedValue({ state: 'FINALIZED' }); await f.engine.tick(); expect(f.store.locked('wallet')).toBe(false); expect(f.store.reserved(SOL)).toBe(0n); f.store.close(); });
    it('keeps trailing high watermark and pauses after a monitoring gap', () => { const f = setup(); f.store.save({ id, wallet: 'wallet', revision: 1, spec: { ...f.spec, kind: 'TRAILING', side: 'SELL', decimals: 6, trailingBps: 100 }, state: 'OPEN', highWatermark: '2', createdAt: Date.now(), updatedAt: Date.now() }); new ProEngine(f.store, f.market, f.signer, 'wallet', f.engine.limits); expect(f.store.order(id).state).toBe('PAUSED'); expect(f.store.order(id).highWatermark).toBe('2'); f.store.close(); });
    it('continues trailing observations during withdrawal settlement without masking genuine gaps',async()=>{
      vi.useFakeTimers();const f=setup();let ready=false;Object.assign(f.signer,{executionReady:async()=>ready});
      try{
        await f.engine.create(id,{...f.spec,kind:'TRAILING',side:'SELL',decimals:6,trailingBps:100},proof);await f.engine.control('resume-engine',proof);
        for(let second=0;second<12;second++){vi.setSystemTime(Date.now()+1000);await f.engine.tick();expect(f.store.order(id).state).toBe('OPEN');}
        expect(f.signer.sign).not.toHaveBeenCalled();expect(f.store.order(id).highWatermark).toBe('1.000000000000');
        // Execution can resume after more than five seconds without a manual resume.
        ready=true;vi.mocked(f.market.observation).mockImplementation(async()=>({priceUsd:'0.98',solUsdMicros:usdUnits('100'),quoteAt:Date.now(),solUsdAt:Date.now(),observedAt:Date.now(),outputRaw:'100',tokenDecimals:6}));await f.engine.tick();expect(f.store.order(id).state).toBe('SUBMITTED');
        // A real gap in observations still requires resume, including during a busy wallet.
        ready=false;f.store.db.prepare('DELETE FROM attempts').run();f.store.db.prepare('DELETE FROM locks').run();const order=f.store.order(id);order.state='OPEN';f.store.save(order);vi.setSystemTime(Date.now()+6000);await f.engine.tick();expect(f.store.order(id).state).toBe('PAUSED');
      }finally{f.store.close();vi.useRealTimers();}
    });
    it('rejects stale quote, oracle and future timestamps', () => {
        const f = setup(), now = Date.now();
        for (const patch of [{ quoteAt: now - 2001 }, { solUsdAt: now - 30001 }, { observedAt: now + 1000 }])
            expect(() => f.engine.fresh({ priceUsd: '1', solUsdMicros: 1n, quoteAt: now, solUsdAt: now, observedAt: now, outputRaw: '1', ...patch })).toThrow();
        f.store.close();
    });
    it('recovers exact signed bytes after a lost signer acknowledgement', async () => { const f = setup(); f.signer.sign.mockRejectedValue(new Error('lost reply')); const recovered = { signedTransaction: 'exact-persisted-bytes', signature: 'sig', blockhash: 'hash', lastValidBlockHeight: 123 }; Object.assign(f.signer, { recover: vi.fn(async () => recovered) }); await f.engine.create(id, f.spec, proof); await f.engine.control('resume-engine', proof); await f.engine.tick(); expect(f.store.order(id).state).toBe('UNKNOWN'); await f.engine.tick(); expect(f.signer.sign).toHaveBeenCalledTimes(1); expect(f.market.submit).toHaveBeenCalledWith('exact-persisted-bytes'); expect(f.store.attempts()[0]?.signedTransaction).toBe('exact-persisted-bytes'); f.store.close(); });
    it('releases a fenced never-authorized attempt without creating another', async () => { const f = setup(); f.signer.sign.mockRejectedValue(new Error('rejected')); Object.assign(f.signer, { recover: vi.fn(async () => null) }); await f.engine.create(id, f.spec, proof); await f.engine.control('resume-engine', proof); await f.engine.tick(); await f.engine.tick(); expect(f.store.order(id).state).toBe('FAILED'); expect(f.store.locked('wallet')).toBe(false); expect(f.signer.sign).toHaveBeenCalledTimes(1); f.store.close(); });
    it('activates exactly one bracket from confirmed received quantity and token decimals', async () => { const f = setup(); await f.engine.create(id, { ...f.spec, exit: { tpBps: 1000, slBps: 500, slippageBps: 100 } }, proof); await f.engine.control('resume-engine', proof); await f.engine.tick(); vi.mocked(f.market.reconcile).mockResolvedValue({ state: 'CONFIRMED', receivedRaw: '123456', fillPriceUsd: '1', tokenDecimals: 6, confirmedAt: Date.now() }); await f.engine.tick(); await f.engine.tick(); const children = f.store.orders().filter(o => o.parentId === id); expect(children).toHaveLength(1); expect(children[0]?.spec.amountRaw).toBe('123456'); expect(children[0]?.spec.decimals).toBe(6); expect(f.store.meta('protected-wallet')).toBe(`${id}:exit`); f.store.close(); });
    it('atomically rejects reservations exceeding available SOL including fees', async () => { const f = setup(); vi.mocked(f.market.balances).mockResolvedValue({ [SOL]: 100000000n, [mint]: 0n }); await expect(f.engine.create(id, f.spec, proof)).rejects.toThrow('Insufficient'); expect(f.store.orders()).toHaveLength(0); expect(f.store.reserved(SOL)).toBe(0n); f.store.close(); });
    it('counts missing ATA setup rent once and excludes existing accounts', async () => { const rpc = { getAccountInfo: vi.fn(async (key: PublicKey) => key.toBase58() === SOL ? { data: Buffer.alloc(165), lamports: 9999 } : null), getMinimumBalanceForRentExemption: vi.fn(async (size: number) => 1000 + size) } as unknown as Connection; const manifest = [{ program: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', accounts: ['payer', mint], data: '2' }, { program: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', accounts: ['payer', mint], data: '2' }, { program: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', accounts: ['payer', SOL], data: '2' }]; expect(await setupRentLamports(rpc, manifest)).toBe(1165n); });
    it('persists the edited reservation and blocks execution after lost acknowledgement', async () => { const f = setup(); await f.engine.create(id, f.spec, proof); await f.engine.control('resume-engine', proof); const original = f.signer.registerOrder.getMockImplementation()!; f.signer.registerOrder.mockImplementationOnce(async (order) => { await original(order); throw new Error('ACK lost'); }); await expect(f.engine.change(id, 1, 'edit', proof, { ...f.spec, amountRaw: '200000000' })).rejects.toThrow(); expect(f.store.order(id).revision).toBe(2); expect(f.store.order(id).spec.amountRaw).toBe('200000000'); expect(f.store.order(id).state).toBe('BLOCKED'); expect(f.store.reserved(SOL)).toBe(200010000n); await f.engine.tick(); expect(f.signer.sign).toHaveBeenCalledTimes(1); expect(f.store.order(id).spec.amountRaw).toBe('200000000'); f.store.close(); });
    it('leaves a staged edit blocked when signer has not accepted it', async () => { const f = setup(); await f.engine.create(id, f.spec, proof); await f.engine.control('resume-engine', proof); f.signer.registerOrder.mockRejectedValueOnce(new Error('Disconnected before acceptance')); await expect(f.engine.change(id, 1, 'edit', proof, { ...f.spec, amountRaw: '200000000' })).rejects.toThrow(); await f.engine.tick(); expect(f.signer.sign).not.toHaveBeenCalled(); expect(f.store.order(id).state).toBe('BLOCKED'); expect(f.store.reserved(SOL)).toBe(200010000n); f.store.close(); });
    it('requires explicit resume after signer lock and unlock instead of failing queued orders', async () => { const f = setup(); await f.engine.create(id, f.spec, proof); await f.engine.control('resume-engine', proof); await f.signer.control('pause-all'); expect((await f.engine.health('server')).engine).toBe('PAUSED'); await f.engine.tick(); expect(f.signer.sign).not.toHaveBeenCalled(); expect(f.store.order(id).state).toBe('OPEN'); await f.engine.control('resume-engine', proof); await f.engine.tick(); expect(f.signer.sign).toHaveBeenCalledTimes(1); f.store.close(); });
    it('starts protection duration at the actual confirmed fill even after entry expires', () => { const f = setup(), confirmedAt = Date.now(); const parent = { id, wallet: 'wallet', revision: 1, spec: { ...f.spec, expiresAt: confirmedAt - 1, exit: { tpBps: 1000, slBps: 500, slippageBps: 100, durationMs: 3600000 } }, state: 'CONFIRMED' as const, createdAt: 0, updatedAt: 0 }; expect(deriveExitSpec(parent, '123', '1', 6, confirmedAt).expiresAt).toBe(confirmedAt + 3600000); f.store.close(); });
    it('releases protected-wallet gating after parent finalization while retaining child reservation', async () => { const f = setup(); await f.engine.create(id, { ...f.spec, exit: { tpBps: 1000, slBps: 500, slippageBps: 100 } }, proof); await f.engine.control('resume-engine', proof); await f.engine.tick(); vi.mocked(f.market.reconcile).mockResolvedValue({ state: 'CONFIRMED', receivedRaw: '123456', fillPriceUsd: '1', tokenDecimals: 6, confirmedAt: Date.now() }); await f.engine.tick(); expect(f.store.meta('protected-wallet')).toBe(`${id}:exit`); vi.mocked(f.market.reconcile).mockResolvedValue({ state: 'FINALIZED', receivedRaw: '123456', fillPriceUsd: '1', tokenDecimals: 6, confirmedAt: Date.now() }); await f.engine.tick(); expect(f.store.meta('protected-wallet')).toBe(''); expect(f.store.reserved(mint)).toBe(123456n); f.store.close(); });
    it('retries an unaccepted staged intent using a fresh signed request without changing its reservation', async () => { const f = setup(); f.signer.registerOrder.mockRejectedValueOnce(new Error('no IPC')); await expect(f.engine.create(id, f.spec, proof)).rejects.toThrow(); const pending = f.store.order(id); expect(pending.pendingAction).toBe('create'); await expect(f.engine.retry(id, 1, { ...pending.spec, amountRaw: '2' }, 'create', proof)).rejects.toThrow('differs'); const recovered = await f.engine.retry(id, 1, pending.spec, 'create', proof); expect(recovered.state).toBe('OPEN'); expect(recovered.pendingAction).toBeUndefined(); expect(f.store.reserved(SOL)).toBe(100010000n); f.store.close(); });
    it('cancels a staged edit without releasing funds before signer acknowledgement', async () => { const f = setup(); await f.engine.create(id, f.spec, proof); f.signer.registerOrder.mockRejectedValueOnce(new Error('no IPC')); await expect(f.engine.change(id, 1, 'edit', proof, { ...f.spec, amountRaw: '200000000' })).rejects.toThrow(); let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; }); const original = f.signer.control.getMockImplementation()!; f.signer.control.mockImplementationOnce(async (action) => { await barrier; await original(action); }); const pending = f.store.order(id), cancel = f.engine.retry(id, 2, pending.spec, 'cancel', proof); await Promise.resolve(); expect(f.store.reserved(SOL)).toBe(200010000n); release(); await cancel; expect(f.store.order(id).state).toBe('CANCELLED'); expect(f.store.reserved(SOL)).toBe(0n); f.store.close(); });
    it('does not resurrect an order paused while its quote request later fails', async () => { const f = setup(); await f.engine.create(id, f.spec, proof); await f.engine.control('resume-engine', proof); let rejectQuote!: (error: Error) => void; vi.mocked(f.market.observation).mockImplementationOnce(() => new Promise((_, reject) => { rejectQuote = reject; })); const ticking = f.engine.tick(); while (!rejectQuote)
        await Promise.resolve(); await f.engine.change(id, 1, 'pause', proof); rejectQuote(new Error('RPC failure')); await ticking; expect(f.store.order(id).state).toBe('PAUSED'); expect(f.store.order(id).revision).toBe(2); expect(f.signer.sign).not.toHaveBeenCalled(); f.store.close(); });
    it('can cancel pending protection without stranding the parent confirmation lock',async()=>{const f=setup();await f.engine.create(id,{...f.spec,exit:{tpBps:1000,slBps:500,slippageBps:100}},proof);await f.engine.control('resume-engine',proof);await f.engine.tick();f.signer.registerOrder.mockRejectedValueOnce(new Error('child IPC failed'));vi.mocked(f.market.reconcile).mockResolvedValue({state:'CONFIRMED',receivedRaw:'123456',fillPriceUsd:'1',tokenDecimals:6,confirmedAt:Date.now()});await f.engine.tick();const child=f.store.order(`${id}:exit`);expect(child.pendingAction).toBe('protection');await f.engine.retry(child.id,child.revision,child.spec,'cancel',proof);expect(f.store.order(id).protectionPending).toBe(false);expect(f.store.locked('wallet')).toBe(true);vi.mocked(f.market.reconcile).mockResolvedValue({state:'FINALIZED'});await f.engine.tick();expect(f.store.locked('wallet')).toBe(false);expect(f.store.reserved(mint)).toBe(0n);f.store.close();});
    it('uses integer limit minimum with ceiling and actual fill for one bracket', () => { const f = setup(); expect(limitMinimum({ ...f.spec, kind: 'LIMIT', triggerPriceUsd: '2', decimals: 6 }, usdUnits('100'))).toBe(5000000n); const child = deriveExitSpec({ id, wallet: 'wallet', revision: 1, spec: { ...f.spec, exit: { tpBps: 1000, slBps: 500, slippageBps: 100 } }, state: 'CONFIRMED', createdAt: 0, updatedAt: 0 }, '123456', '0.000000012345', 6); expect(child.amountRaw).toBe('123456'); expect(child.decimals).toBe(6); expect(usdUnits(child.tpPriceUsd!)).toBe(13579n); expect(usdUnits(child.slPriceUsd!)).toBe(11727n); f.store.close(); });
});
