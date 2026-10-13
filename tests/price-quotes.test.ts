import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DEFAULT_SETTINGS,type PositionSnapshot} from '../src/model';
const mocks=vi.hoisted(()=>({quote:vi.fn(),usd:vi.fn()}));
vi.mock('../src/position',()=>({quotePosition:mocks.quote}));
vi.mock('../src/usd-price',()=>({currentSolUsd:mocks.usd,solUsdRetryAt:()=>0}));
vi.mock('../src/diagnostics',()=>({logEvent:vi.fn()}));
import {createPriceQuotes,withCurrentUsd} from '../src/worker/price-quotes';
const wallet='9XDYTfQKwW8sHPqnFdUreMmtmffmkHVPGTNV2e3LKxNW',mint='7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
const target={site:'GMGN' as const,kind:'MINT' as const,address:mint,pageUrl:`https://gmgn.ai/sol/token/${mint}`};
const base=():PositionSnapshot=>({wallet,mint,balanceRaw:'100',decimals:6,supplyRaw:'1000',updatedAt:Date.now(),costBasisSolLamports:'1000'});
const options={blocked:async()=>false};
beforeEach(()=>{vi.useFakeTimers();vi.spyOn(Math,'random').mockReturnValue(0.5);mocks.usd.mockReset().mockReturnValue(undefined);mocks.quote.mockReset().mockImplementation(async(_r,_t,_w,_s,p)=>({...p,updatedAt:Date.now(),expectedExitLamports:'2000'}));});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('shares one in-flight estimate across three readers but preserves each confirmed basis',async()=>{
 const quotes=createPriceQuotes(),first=base();
 const reads=[quotes.request(DEFAULT_SETTINGS,target,first,options),quotes.request(DEFAULT_SETTINGS,target,{...first,costBasisSolLamports:'1500'},options),quotes.request(DEFAULT_SETTINGS,target,first,options)];
 await vi.advanceTimersByTimeAsync(200);const results=await Promise.all(reads);
 expect(mocks.quote).toHaveBeenCalledOnce();expect(results.map(r=>r.costBasisSolLamports)).toEqual(['1000','1500','1000']);
 expect(results.every(r=>r.expectedExitLamports==='2000')).toBe(true);
});
it('never shares estimates across changed target, inventory, wallet, or settings',async()=>{
 const quotes=createPriceQuotes(),snapshot=base();
 const requests=[quotes.request(DEFAULT_SETTINGS,target,snapshot,options),quotes.request(DEFAULT_SETTINGS,{...target,poolHint:mint},snapshot,options),quotes.request(DEFAULT_SETTINGS,target,{...snapshot,balanceRaw:'200'},options),quotes.request({...DEFAULT_SETTINGS,slippageBps:100},target,snapshot,options),quotes.request(DEFAULT_SETTINGS,target,{...snapshot,wallet:mint},options)];
 await vi.advanceTimersByTimeAsync(200);await Promise.all(requests);expect(mocks.quote).toHaveBeenCalledTimes(5);
});
it('keeps the last successful amount and timestamp after transient failure, then recovers',async()=>{
 const quotes=createPriceQuotes();const original=quotes.request(DEFAULT_SETTINGS,target,base(),options);await vi.advanceTimersByTimeAsync(200);const good=await original;
 mocks.quote.mockResolvedValue({...base(),expectedExitLamports:undefined,quoteIssue:{kind:'RPC',message:'RPC timeout',retryable:true}});
 const failure=quotes.request(DEFAULT_SETTINGS,target,base(),{...options,refresh:true});await vi.advanceTimersByTimeAsync(3000);const retained=await failure;
 expect(retained.expectedExitLamports).toBe(good.expectedExitLamports);expect(retained.updatedAt).toBe(good.updatedAt);expect(retained.quoteIssue?.retryAt).toBe(Date.now()+1000);
 await quotes.request(DEFAULT_SETTINGS,target,base(),{...options,refresh:true});expect(mocks.quote).toHaveBeenCalledTimes(2);
 mocks.quote.mockResolvedValue({...base(),updatedAt:Date.now(),expectedExitLamports:'3000'});
 await vi.advanceTimersByTimeAsync(1000);const retry=quotes.request(DEFAULT_SETTINGS,target,base(),{...options,refresh:true});await vi.advanceTimersByTimeAsync(2000);expect((await retry).expectedExitLamports).toBe('3000');expect(mocks.quote).toHaveBeenCalledTimes(3);
});
it('does not refresh authentication failures or override provider Retry-After',async()=>{
 const quotes=createPriceQuotes();mocks.quote.mockResolvedValue({...base(),quoteIssue:{kind:'RPC',message:'RPC authentication failed',status:401,retryable:false}});
 const auth=quotes.request(DEFAULT_SETTINGS,target,base(),options);await vi.advanceTimersByTimeAsync(200);await auth;
 await vi.advanceTimersByTimeAsync(60_000);await quotes.request(DEFAULT_SETTINGS,target,base(),{...options,refresh:true});expect(mocks.quote).toHaveBeenCalledOnce();
 quotes.cancelWallet(wallet);mocks.quote.mockResolvedValue({...base(),quoteIssue:{kind:'RPC',message:'rate limited',status:429,retryable:true,retryAt:Date.now()+20_000}});
 const rate=quotes.request(DEFAULT_SETTINGS,target,base(),options);await vi.advanceTimersByTimeAsync(200);const delayed=await rate;
 await vi.advanceTimersByTimeAsync(15_000);await quotes.request(DEFAULT_SETTINGS,target,base(),{...options,refresh:true});expect(mocks.quote).toHaveBeenCalledTimes(2);expect(delayed.quoteIssue?.retryAt).toBeGreaterThan(Date.now());
});
it('a nonsettling quote releases its slot at 12 seconds and cancellation rejects readers',async()=>{
 const quotes=createPriceQuotes();mocks.quote.mockImplementation(()=>new Promise(()=>{}));
 const hung=quotes.request(DEFAULT_SETTINGS,target,base(),options);await vi.advanceTimersByTimeAsync(12_200);expect((await hung).quoteIssue?.retryable).toBe(true);
 const cancelled=quotes.request(DEFAULT_SETTINGS,target,{...base(),balanceRaw:'2'},options),rejection=expect(cancelled).rejects.toThrow('cancelled');quotes.cancelWallet(wallet);await rejection;
});
it('USD recovery enriches an existing SOL estimate without another quote or timestamp change',async()=>{
 const quotes=createPriceQuotes(),read=quotes.request(DEFAULT_SETTINGS,target,base(),options);await vi.advanceTimersByTimeAsync(200);const original=await read;expect(original.usdIssue?.kind).toBe('USD');
 mocks.usd.mockReturnValue({priceMicros:'100000000',capturedAt:Date.now(),source:'Coinbase spot'});const recovered=withCurrentUsd(original);
 expect(recovered.solUsd).toBeDefined();expect(recovered.usdIssue).toBeUndefined();expect(recovered.updatedAt).toBe(original.updatedAt);expect(mocks.quote).toHaveBeenCalledOnce();
});
it('retains newer required slots during failure backoff and never retries below the observed floor',async()=>{
 const quotes=createPriceQuotes();let failure=true;const slots:number[]=[];
 mocks.quote.mockImplementation(async(rpc,_t,_w,_s,p)=>{const payload=(rpc as unknown as {_rpcRequest:(m:string,p:unknown[])=>Promise<unknown>});await payload._rpcRequest('getAccountInfo',[mint]);return failure?{...p,quoteIssue:{kind:'RPC',message:'Minimum context slot not reached',retryable:true}}:{...p,updatedAt:Date.now(),expectedExitLamports:'3000'};});
 vi.stubGlobal('fetch',vi.fn(async(_u,options)=>{const request=JSON.parse(options.body);slots.push(request.params[1].minContextSlot);return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:null}));}));
 const first=quotes.request(DEFAULT_SETTINGS,target,base(),{...options,slot:200});await vi.advanceTimersByTimeAsync(200);await first;
 await quotes.request(DEFAULT_SETTINGS,target,base(),{...options,slot:201,refresh:true});expect(slots).toEqual([200]);
 await vi.advanceTimersByTimeAsync(1000);failure=false;const retry=quotes.request(DEFAULT_SETTINGS,target,base(),{...options,refresh:true});await vi.advanceTimersByTimeAsync(2000);await retry;
 expect(slots).toEqual([200,201]);vi.unstubAllGlobals();
});
it('does not publish a cancelled result when cancellation happens during the final wallet-lock await',async()=>{
 const published=vi.fn(),quotes=createPriceQuotes(published);let release!:(value:boolean)=>void;
 const blocked=vi.fn().mockResolvedValueOnce(false).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;})).mockResolvedValue(false);
 const old=quotes.request(DEFAULT_SETTINGS,target,base(),{blocked}),rejected=expect(old).rejects.toThrow('cancelled');
 await vi.advanceTimersByTimeAsync(200);expect(release).toBeDefined();quotes.cancelWallet(wallet);await rejected;
 const replacement=quotes.request(DEFAULT_SETTINGS,target,base(),{blocked});release(false);await vi.advanceTimersByTimeAsync(3000);await replacement;
 expect(published).toHaveBeenCalledOnce();expect(mocks.quote).toHaveBeenCalledTimes(2);
});
