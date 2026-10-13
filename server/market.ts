import {hasProtection} from './strategy';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, unpackAccount, unpackMint } from '@solana/spl-token';
import { resolveExecution } from '../src/execution';
import { buildOtherDirect } from '../src/direct-venues';
import { validateDirectSwap } from '../src/direct-security';
import { prepareBuild, JUPITER_BUILD_URL, type BuildResponse } from '../src/router';
import { NATIVE_MINT } from '@solana/spl-token';
import { buildProExecution,assertProMintExtensions } from './execution';
import { usdUnits, microsUsd, type ProSpec, type ProAttempt, type ProOrder } from '../src/pro/contracts';
import type { MarketPort, Observation } from './engine';
import { SOL } from './store';
import {priceAccounts} from '../src/worker/price-accounts';
import {createPriceStream} from '../src/worker/price-stream';
export function httpsUrl(value: string): string {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
        throw new Error('Server endpoint must use HTTPS without credentials or fragments.');
    return url.toString();
}
export class RpcMarket implements MarketPort {
    private stream?:ReturnType<typeof createPriceStream>;
    private watched=new Map<string,{addresses:string[];at:number}>();
    private discovering=new Set<string>();
    private quoted=new Map<string,Observation>();
    private quoting=new Map<string,Promise<Observation>>();
    private activeQuotes=0;
    private quoteWaiters:Array<()=>void>=[];
    private coalesce:ReturnType<typeof setTimeout>|undefined;
    onInvalidated?:()=>void;
    onStreamError?:(error:unknown)=>void;
    private sol?: {
        value: bigint;
        at: number;
    };
    constructor(readonly connection: Connection, readonly wallet: PublicKey, private request: typeof fetch = fetch,private enableStream=false) { httpsUrl(connection.rpcEndpoint); }
    private watch(spec:ProSpec):void{
      if(!this.enableStream)return;
      if(!this.stream)this.stream=createPriceStream(this.connection.rpcEndpoint.replace(/^https:/,'wss:'),()=>{
        if(!this.coalesce)this.coalesce=setTimeout(()=>{this.coalesce=undefined;this.onInvalidated?.();},200);
      },()=>{});
      const key=JSON.stringify([spec.mint,spec.target.address,spec.target.poolHint]);
      const known=this.watched.get(key);
      if(known&&Date.now()-known.at<60000||this.discovering.has(key))return;
      this.discovering.add(key);
      void priceAccounts(this.connection,spec.target,spec.mint).then(addresses=>{
        if(!this.enableStream)return;
        this.watched.set(key,{addresses,at:Date.now()});
        for(const [entry,value]of this.watched)if(Date.now()-value.at>60000)this.watched.delete(entry);
        this.stream?.update([...new Set([...this.watched.values()].flatMap(value=>value.addresses))]);
      }).catch(error=>{this.onStreamError?.(error);/* Authenticated quotes remain authoritative when subscriptions are unavailable. */}).finally(()=>this.discovering.delete(key));
    }
    close():void{this.enableStream=false;this.stream?.destroy();this.stream=undefined;this.watched.clear();this.quoted.clear();if(this.coalesce)clearTimeout(this.coalesce);}
    retainWatches(specs:ProSpec[]):void{const desired=new Set(specs.map(spec=>JSON.stringify([spec.mint,spec.target.address,spec.target.poolHint])));for(const key of this.watched.keys())if(!desired.has(key))this.watched.delete(key);this.stream?.update([...new Set([...this.watched.values()].flatMap(value=>value.addresses))]);}
    async solPrice() {
        if (this.sol && Date.now() - this.sol.at < 15000)
            return this.sol;
        const response = await this.request('https://api.coinbase.com/v2/prices/SOL-USD/spot', { signal: AbortSignal.timeout(5000), headers: { 'cache-control': 'no-cache' } });
        if (!response.ok)
            throw new Error('SOL USD price unavailable.');
        const sourceTime = Date.parse(response.headers.get('date') ?? '');
        if (!Number.isFinite(sourceTime) || Date.now() - sourceTime > 30000 || sourceTime > Date.now() + 1000)
            throw new Error('SOL USD source timestamp is stale.');
        const data = await response.json() as {
            data?: {
                amount?: string;
                currency?: string;
                base?: string;
            };
        };
        if (data.data?.currency !== 'USD' || data.data.base !== 'SOL' || typeof data.data.amount !== 'string')
            throw new Error('Invalid SOL USD price.');
        this.sol = { value: usdUnits(data.data.amount), at: Math.min(sourceTime, Date.now()) };
        return this.sol;
    }
    async tokenDecimals(mint: string) {
        const key = new PublicKey(mint), info = await this.connection.getAccountInfo(key);
        if (!info)
            throw new Error('Mint unavailable.');
        return unpackMint(key, info, info.owner).decimals;
    }
    async observation(spec:ProSpec):Promise<Observation>{
        this.watch(spec);
        const key=JSON.stringify([spec.mint,spec.side,spec.amountRaw,spec.decimals,spec.target.address,spec.target.poolHint]);
        const cached=this.quoted.get(key);if(cached&&Date.now()-cached.quoteAt<1000)return{...cached};
        const pending=this.quoting.get(key);if(pending)return pending;
        const job=this.boundedObservation(spec).then(value=>{this.quoted.set(key,value);for(const [entry,observation]of this.quoted)if(Date.now()-observation.quoteAt>5000)this.quoted.delete(entry);return value;}).finally(()=>this.quoting.delete(key));
        this.quoting.set(key,job);return job;
    }
    private async boundedObservation(spec:ProSpec):Promise<Observation>{
      if(this.activeQuotes<2)this.activeQuotes++;
      else{if(this.quoteWaiters.length>=20)throw new Error('Quote queue capacity exceeded.');await new Promise<void>(resolve=>this.quoteWaiters.push(resolve));}
      try{return await this.computeObservation(spec);}finally{const next=this.quoteWaiters.shift();if(next)next();else this.activeQuotes--;}
    }
    private async computeObservation(spec: ProSpec): Promise<Observation> {
        const started = Date.now();
        const sol = await this.solPrice(), route = await resolveExecution(this.connection, spec.target);
        if (route.mint.toBase58() !== spec.mint)
            throw new Error('Resolved mint differs from order.');
        const mintInfo = await this.connection.getAccountInfo(route.mint);
        if (!mintInfo)
            throw new Error('Mint unavailable.');
        const decodedMint=unpackMint(route.mint,mintInfo,mintInfo.owner);assertProMintExtensions(decodedMint,mintInfo.owner);
        const decimals = decodedMint.decimals;
        if (spec.side === 'SELL' && spec.decimals !== decimals || spec.side === 'BUY' && spec.decimals !== 9)
            throw new Error('Input decimals do not match on-chain mint.');
        let minimum: bigint;
        if (route.venue === 'PUMP_CURVE' || route.venue === 'PUMP_SWAP')
            minimum = (await buildProExecution(this.connection, this.wallet, spec, sol.value, true)).minimum;
        else if (route.venue === 'JUPITER') {
            const input = spec.side === 'BUY' ? NATIVE_MINT : route.mint, output = spec.side === 'BUY' ? route.mint : NATIVE_MINT;
            const params = new URLSearchParams({ inputMint: input.toBase58(), outputMint: output.toBase58(), amount: spec.amountRaw, taker: this.wallet.toBase58(), slippageBps: String(spec.slippageBps), platformFeeBps: '0', transactionVersion: '0', wrapAndUnwrapSol: 'true', maxAccounts: '64' });
            const response = await this.request(`${JUPITER_BUILD_URL}?${params}`, { headers: { 'x-api-key': process.env.DP_JUPITER_API_KEY ?? '' }, signal: AbortSignal.timeout(5000) });
            if (!response.ok)
                throw new Error('Jupiter quote unavailable.');
            minimum = (await prepareBuild(this.connection, await response.json() as BuildResponse, this.wallet, input, output, BigInt(spec.amountRaw), spec.slippageBps)).expected;
        }
        else {
            const quoteInfo = await this.connection.getAccountInfo(NATIVE_MINT);
            if (!quoteInfo)
                throw new Error('SOL mint unavailable.');
            const bundle = await buildOtherDirect(this.connection, route, this.wallet, spec.side, BigInt(spec.amountRaw), 0);
            await validateDirectSwap(bundle, route, this.wallet, spec.side, BigInt(spec.amountRaw), mintInfo.owner, quoteInfo.owner, await this.connection.getMinimumBalanceForRentExemption(165));
            minimum = bundle.minimum;
        }
        const at = Date.now();
        if (minimum <= 0n)
            throw new Error('Invalid quote.');
        const input = BigInt(spec.amountRaw), scale = 10n ** BigInt(decimals);
        const price = spec.side === 'BUY' ? input * sol.value * scale / (minimum * 1000000000n) : minimum * sol.value * scale / (input * 1000000000n);
        return { priceUsd: microsUsd(price), solUsdMicros: sol.value, solUsdAt: sol.at, quoteAt: started, observedAt: started, outputRaw: String(minimum), tokenDecimals: decimals, supplyRaw: decodedMint.supply.toString() };
    }
    async balances(mint: string) {
        if (mint === SOL)
            return { [SOL]: BigInt(await this.connection.getBalance(this.wallet, 'confirmed')) };
        const key = new PublicKey(mint);
        const info = await this.connection.getAccountInfo(key);
        if (!info)
            throw new Error('Mint unavailable.');
        const parsed = unpackMint(key, info, info.owner);
        if (!Number.isInteger(parsed.decimals))
            throw new Error('Invalid mint.');
        const ata = getAssociatedTokenAddressSync(key, this.wallet, false, info.owner), account = await this.connection.getAccountInfo(ata);
        return { [SOL]: BigInt(await this.connection.getBalance(this.wallet, 'confirmed')), [mint]: account ? unpackAccount(ata, account, info.owner).amount : 0n };
    }
    async submit(bytes: string) { return this.connection.sendRawTransaction(Buffer.from(bytes, 'base64'), { skipPreflight: false, maxRetries: 3, preflightCommitment: 'confirmed' }); }
    async reconcile(attempt: ProAttempt, order: ProOrder) {
        if (!attempt.signature)
            return { state: 'UNKNOWN' as const };
        let status = (await this.connection.getSignatureStatuses([attempt.signature], { searchTransactionHistory: true })).value[0];
        if (!status) {
            const lastValidBlockHeight=attempt.lastValidBlockHeight;
            if(typeof lastValidBlockHeight!=='number'||!Number.isSafeInteger(lastValidBlockHeight)||lastValidBlockHeight<=0||!attempt.blockhash)
                return {state:'UNKNOWN' as const};
            const height=await this.connection.getBlockHeight('finalized');
            if(!Number.isSafeInteger(height)||height<=lastValidBlockHeight||(await this.connection.isBlockhashValid(attempt.blockhash,{commitment:'finalized'})).value!==false)
                return {state:'UNKNOWN' as const};
            // A missing RPC status alone is not proof of non-execution. Require
            // finalized wallet history covering the complete blockhash window.
            const history=await this.connection.getSignaturesForAddress(this.wallet,{limit:100},'finalized');
            if(history.some(entry=>entry.signature===attempt.signature)||!history.length)return {state:'UNKNOWN' as const};
            const oldest=history.at(-1)!;
            if(!Number.isSafeInteger(oldest.slot)||oldest.slot<0)return {state:'UNKNOWN' as const};
            const block=await this.connection.getBlock(oldest.slot,{commitment:'finalized',transactionDetails:'none',rewards:false,maxSupportedTransactionVersion:0});
            if(!block||!('blockHeight' in block)||typeof block.blockHeight!=='number'||!Number.isSafeInteger(block.blockHeight)||block.blockHeight>=lastValidBlockHeight-300)
                return {state:'UNKNOWN' as const};
            status=(await this.connection.getSignatureStatuses([attempt.signature],{searchTransactionHistory:true})).value[0];
            if(!status){
                const transaction=await this.connection.getTransaction(attempt.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
                return {state:transaction===null?'EXPIRED' as const:'UNKNOWN' as const};
            }
        }
        if (status.confirmationStatus !== 'confirmed' && status.confirmationStatus !== 'finalized')
            return { state: 'UNKNOWN' as const };
        if(status.err)return{state:status.confirmationStatus==='finalized'?'FAILED' as const:'UNKNOWN' as const};
        const state = status.confirmationStatus === 'finalized' ? 'FINALIZED' as const : 'CONFIRMED' as const;
        if (order.spec.side !== 'BUY')
            return { state };
        const transaction = await this.connection.getTransaction(attempt.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        if (!transaction?.meta || transaction.meta.err)
            return { state: hasProtection(order.spec) ? 'UNKNOWN' as const : state };
        const totals = (rows: typeof transaction.meta.preTokenBalances) => rows?.filter(r => r.owner === this.wallet.toBase58() && r.mint === order.spec.mint).reduce((s, r) => s + BigInt(r.uiTokenAmount.amount), 0n) ?? 0n;
        const received = totals(transaction.meta.postTokenBalances) - totals(transaction.meta.preTokenBalances);
        if (received <= 0n)
            return { state: hasProtection(order.spec) ? 'UNKNOWN' as const : state };
        const frozen = (attempt as ProAttempt & {
            solUsdUnits?: string;
        }).solUsdUnits;
        if (!frozen && hasProtection(order.spec))
            return { state: 'UNKNOWN' as const };
        const solValue = frozen ? BigInt(frozen) : (await this.solPrice()).value, spent = BigInt(order.spec.amountRaw);
        const tokenDecimals = transaction.meta.postTokenBalances?.find(r => r.owner === this.wallet.toBase58() && r.mint === order.spec.mint)?.uiTokenAmount.decimals;
        if (tokenDecimals === undefined)
            return { state: hasProtection(order.spec) ? 'UNKNOWN' as const : state, receivedRaw: String(received) };
        if (hasProtection(order.spec) && (!transaction.blockTime || !Number.isSafeInteger(transaction.blockTime)))
            return { state: 'UNKNOWN' as const };
        return { state, receivedRaw: String(received), tokenDecimals, confirmedAt: transaction.blockTime ? transaction.blockTime * 1000 : undefined, fillPriceUsd: microsUsd(spent * solValue * 10n ** BigInt(tokenDecimals) / (received * 1000000000n)) };
    }
}
