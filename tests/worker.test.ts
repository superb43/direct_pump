import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import bs58 from 'bs58';
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { DEFAULT_SETTINGS, type WorkerRequest, type WorkerResponse, type Receipt } from '../src/model';
import { SITE_CONTEXTS } from './fixtures/site-contexts';

const mocks = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  listener: undefined as unknown, portListener:undefined as unknown,
  stream:vi.fn(),accounts:vi.fn(),change:undefined as unknown,state:undefined as unknown,streamLive:false,usd:vi.fn(),
  currentUrl: '',
  build: vi.fn(), send: vi.fn(), connect: vi.fn(), prepare: vi.fn(), inspect: vi.fn(), frameUrl: vi.fn(), reconcile: vi.fn(), restore: vi.fn(), switch: vi.fn(), token: vi.fn(), openWindow: vi.fn(), openTab:vi.fn(), history:vi.fn(),position:vi.fn(),balances:vi.fn(),quote:vi.fn(),notify:vi.fn(), symbol:vi.fn(), fees: vi.fn(), totals: vi.fn(), record: vi.fn(), archive: vi.fn(),
}));

vi.mock('wxt/browser', () => ({ browser: {
  runtime: { id: 'test-extension', getURL: (path: string) => `chrome-extension://test-extension${path}`, sendMessage:mocks.notify,onConnect:{addListener:(listener:unknown)=>{mocks.portListener=listener;}}, onMessage: { addListener: (listener: unknown) => { mocks.listener = listener; } } },
  tabs: { create:mocks.openTab, get: async () => ({ url: mocks.currentUrl }), query: async () => [], sendMessage: vi.fn() },
  windows: { create: mocks.openWindow },
  storage: { onChanged:{addListener:vi.fn()}, local: {
    get: async (key: string) => ({ [key]: mocks.data[key] }),
    set: async (values: Record<string, unknown>) => { Object.assign(mocks.data, values); },
  } },
  permissions: { contains: async () => true },
} }));
vi.mock('../src/hybrid', () => ({ buildHybridTrade: mocks.build }));
vi.mock('../src/phantom', () => ({ connectPhantom: mocks.connect, sendWithPhantom: mocks.send, preparePhantom: mocks.prepare, inspectPhantom: mocks.inspect, currentFrameUrl: mocks.frameUrl, restorePhantom: mocks.restore, switchPhantom: mocks.switch }));
vi.mock('../src/reconcile', () => ({ reconcileMissingSignature: mocks.reconcile }));
vi.mock('../src/fee-receipt', () => ({ verifyFeeReceipt:mocks.fees, pendingFees:(note:string,state='PENDING')=>({state,note,protocolFees:[],zeroExtraFeesVerified:false}) }));
vi.mock('../src/ledger', () => ({ readSavings:mocks.totals, recordVerifiedTrade:mocks.record, archiveReceipt:mocks.archive, receiptBySignature:async()=>undefined, unauditedReceipts:async()=>[], allReceipts:mocks.history, cacheReceiptSymbol:vi.fn() }));
vi.mock('../src/usd-price',()=>({currentSolUsd:mocks.usd,solUsdSnapshot:vi.fn(async()=>undefined),solUsdRetryAt:()=>0}));
vi.mock('../src/position',()=>({readPosition:mocks.position,quotePosition:mocks.quote}));
vi.mock('../src/portfolio-balances',()=>({readPortfolioBalances:mocks.balances}));
vi.mock('../src/worker/price-accounts',()=>({priceAccounts:mocks.accounts}));
vi.mock('../src/worker/price-stream',()=>({DEFAULT_PRICE_WS:'wss://api.mainnet-beta.solana.com',createPriceStream:mocks.stream}));
vi.mock('../src/token-metadata',async original=>({...await original<typeof import('../src/token-metadata')>(),tokenSymbol:mocks.symbol}));
vi.mock('../src/token-info', () => ({ readTokenInfo: mocks.token }));

const mint = '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
const wallet = '9XDYTfQKwW8sHPqnFdUreMmtmffmkHVPGTNV2e3LKxNW';
const pageUrl = `https://gmgn.ai/sol/token/${mint}`;
const target = { site: 'GMGN' as const, kind: 'MINT' as const, address: mint, pageUrl };
const request: WorkerRequest = { type: 'TRADE', target, wallet, intent: { side: 'BUY', sol: '0.1' } };

const built = () => ({ transaction: new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(wallet), recentBlockhash: PublicKey.default.toBase58(), instructions: [] }).compileToV0Message()), route: { venue: 'PUMP_CURVE', mint: new PublicKey(mint) }, latest: { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 100 }, input: 100_000_000n, minimum: 100n });

async function invoke(request: WorkerRequest, frameId = 0, senderUrl = pageUrl): Promise<WorkerResponse> {
  const listener = mocks.listener as (request: WorkerRequest, sender: object, callback: (response: WorkerResponse) => void) => boolean;
  return new Promise(resolve => listener(request, { id: 'test-extension', frameId, tab: { id: 1 }, documentId: 'document-1', url: senderUrl }, resolve));
}

it.each(SITE_CONTEXTS)('$site portfolio stays private and delivers balances before the exit quote',async(context)=>{
 const receipt:Receipt={wallet,mint:context.target.mintHint??context.target.address,symbol:'SI',venue:'PUMP_SWAP',side:'BUY',pageUrl:context.target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED'};
 mocks.history.mockResolvedValue([receipt]);
 const row={holding:{mint:receipt.mint,symbol:'SI',pageUrl:context.target.pageUrl,position:{wallet,mint:receipt.mint,balanceRaw:'10',decimals:6,supplyRaw:'10000',updatedAt:Date.now()}},target:{...context.target,mintHint:receipt.mint},quoteReady:true};
 mocks.balances.mockResolvedValue([row]);let price!:(value:unknown)=>void;mocks.quote.mockImplementation(()=>new Promise(resolve=>{price=resolve;}));
 expect((await invoke({type:'PORTFOLIO',wallet},0,context.target.pageUrl)).ok).toBe(false);
 expect((await invoke({type:'PORTFOLIO',wallet},0,'chrome-extension://test-extension/settings.html')).ok).toBe(false);
 const response=await invoke({type:'PORTFOLIO',wallet},0,'chrome-extension://test-extension/sidepanel.html');
 expect(response.ok&&response.portfolio?.holdings).toMatchObject([{mint:receipt.mint,position:{balanceRaw:'10'},pricingPending:true}]);
 await vi.waitFor(()=>expect(mocks.quote).toHaveBeenCalledOnce());price({...row.holding.position,expectedExitLamports:'1000000000'});
 await vi.waitFor(()=>expect(mocks.notify).toHaveBeenCalledWith({type:'PORTFOLIO_UPDATED',wallet}));
 const cached=await invoke({type:'PORTFOLIO',wallet},0,'chrome-extension://test-extension/dashboard.html');
 expect(cached.ok&&cached.portfolio?.holdings[0]?.position?.expectedExitLamports).toBe('1000000000');expect(mocks.balances).toHaveBeenCalledOnce();expect(mocks.position).not.toHaveBeenCalled();
});
it('reports a balance service failure without claiming zero holdings or repeating blank token rows',async()=>{
 mocks.balances.mockResolvedValue([{holding:{mint,error:'RPC failed [RPC]'},target,quoteReady:false}]);
 const sender='chrome-extension://test-extension/dashboard.html';
 const response=await invoke({type:'PORTFOLIO',wallet},0,sender);
 expect(response.ok&&response.portfolio).toMatchObject({holdings:[],balanceError:'RPC failed [RPC]',updatedAt:0});
 await invoke({type:'PORTFOLIO',wallet},0,sender);expect(mocks.balances).toHaveBeenCalledOnce();expect(mocks.quote).not.toHaveBeenCalled();
});
it('coalesces balance refreshes and keeps a wallet with an unresolved order locked',async()=>{
 let resolve!:(value:unknown)=>void;mocks.balances.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const sender='chrome-extension://test-extension/dashboard.html';
 const first=invoke({type:'PORTFOLIO',wallet},0,sender);await vi.waitFor(()=>expect(mocks.balances).toHaveBeenCalledOnce());
 const second=invoke({type:'PORTFOLIO',wallet,refresh:true},0,sender);for(let i=0;i<20;i++)await Promise.resolve();resolve([]);await first;await second;expect(mocks.balances).toHaveBeenCalledOnce();
 mocks.data[`receipt:${wallet}`]={wallet,mint,status:'UNKNOWN'};const locked=await invoke({type:'PORTFOLIO',wallet,refresh:true},0,sender);expect(locked.ok).toBe(false);expect(mocks.balances).toHaveBeenCalledOnce();
});
it('does not publish a balance read if an unresolved order starts while it is running',async()=>{
 let resolve!:(value:unknown)=>void;mocks.balances.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const reading=invoke({type:'PORTFOLIO',wallet},0,'chrome-extension://test-extension/sidepanel.html');await vi.waitFor(()=>expect(mocks.balances).toHaveBeenCalledOnce());
 mocks.data[`receipt:${wallet}`]={wallet,mint,status:'SUBMITTED'};resolve([]);
 const response=await reading;expect(response.ok&&response.portfolio?.balanceError).toContain('Retrying automatically');expect(mocks.quote).not.toHaveBeenCalled();
});
it('preserves last confirmed balances as stale and backs off after an RPC failure',async()=>{
 const row={holding:{mint,position:{wallet,mint,balanceRaw:'10',decimals:6,supplyRaw:'1000',updatedAt:Date.now()}},target,quoteReady:false};
 mocks.balances.mockResolvedValueOnce([row]).mockRejectedValue(Error('RPC unavailable'));
 const sender='chrome-extension://test-extension/dashboard.html';await invoke({type:'PORTFOLIO',wallet},0,sender);
 const response=await invoke({type:'PORTFOLIO',wallet,refresh:true},0,sender);
 expect(response.ok&&response.portfolio).toMatchObject({balanceError:'RPC unavailable',holdings:[{position:{balanceRaw:'10'}}]});
 const once=Date.now();await invoke({type:'PORTFOLIO',wallet},0,sender);expect(mocks.balances).toHaveBeenCalledTimes(2);
 vi.spyOn(Date,'now').mockReturnValue(once+5_100);const retry=await invoke({type:'PORTFOLIO',wallet},0,sender);
 expect(retry.ok&&retry.portfolio?.nextRefreshAt).toBe(once+15_100);expect(mocks.balances).toHaveBeenCalledTimes(3);
});
it('retains captured historical USD and the specific chain failure when a later audit RPC fails',async()=>{
 const usd={priceMicros:'120000000',capturedAt:1000,source:'Coinbase 1m candle' as const};
 mocks.data[`receipt:${wallet}`]={wallet,mint,status:'FAILED',signature:'known',error:'Slippage limit exceeded',diagnostic:{stage:'CHAIN',code:6004,error:'ExceededSlippage'},feeReceipt:{usd}};
 mocks.fees.mockRejectedValue(Error('RPC unavailable'));
 const response=await invoke({type:'VERIFY_FEES',wallet,signature:'known'},0,'chrome-extension://test-extension/sidepanel.html');
 expect(response.ok&&response.receipt).toMatchObject({status:'FAILED',error:'Slippage limit exceeded',diagnostic:{code:6004},feeReceipt:{state:'UNAVAILABLE',usd,zeroExtraFeesVerified:false}});
 expect(mocks.record).not.toHaveBeenCalled();
});

function pricePort(url='chrome-extension://test-extension/sidepanel.html'){
 const message:((value:any)=>void)[]=[],disconnect:(()=>void)[]=[];
 const port={name:'portfolio-prices',sender:{id:'test-extension',url},onMessage:{addListener:(fn:(value:any)=>void)=>message.push(fn)},onDisconnect:{addListener:(fn:()=>void)=>disconnect.push(fn)},disconnect:vi.fn(()=>{for(const fn of disconnect)fn();})};
 (mocks.portListener as (port:unknown)=>void)(port);
 return {port,send:(value:unknown)=>message[0]!(value)};
}
it('allows price watches only from private views and tears down the shared stream with the last viewer',async()=>{
 const row={holding:{mint,position:{wallet,mint,balanceRaw:'10',decimals:6,supplyRaw:'1000',updatedAt:Date.now()}},target,quoteReady:true};mocks.balances.mockResolvedValue([row]);
 const blocked=pricePort(pageUrl);blocked.send({type:'WATCH',wallet});await vi.waitFor(()=>expect(blocked.port.disconnect).toHaveBeenCalled());expect(mocks.stream).not.toHaveBeenCalled();
 const panel=pricePort(),dashboard=pricePort('chrome-extension://test-extension/dashboard.html');panel.send({type:'WATCH',wallet});dashboard.send({type:'WATCH',wallet});
 await vi.waitFor(()=>expect(mocks.stream).toHaveBeenCalledOnce());await invoke({type:'PORTFOLIO',wallet},0,'chrome-extension://test-extension/sidepanel.html');
 await vi.waitFor(()=>expect(mocks.accounts).toHaveBeenCalledOnce());const stream=mocks.stream.mock.results[0]!.value;
 panel.port.disconnect();expect(stream.destroy).not.toHaveBeenCalled();dashboard.port.disconnect();expect(stream.destroy).toHaveBeenCalledOnce();
});
it('refreshes a websocket-dirty quote before 15s and reads price snapshots without extra balance calls',async()=>{
 const usd={priceMicros:'100000000',capturedAt:Date.now(),source:'Coinbase spot' as const};
 const row={holding:{mint,position:{wallet,mint,balanceRaw:'10',decimals:6,supplyRaw:'1000',updatedAt:Date.now(),costBasisSolLamports:'1000'}},target,quoteReady:true};mocks.balances.mockResolvedValue([row]);
 mocks.quote.mockImplementation(async(_rpc,_target,_owner,_settings,position)=>({...position,updatedAt:Date.now(),expectedExitLamports:'1000000000',solUsd:usd}));
 const watcher=pricePort();watcher.send({type:'WATCH',wallet});await vi.waitFor(()=>expect(mocks.stream).toHaveBeenCalledOnce());await invoke({type:'PORTFOLIO',wallet},0,'chrome-extension://test-extension/sidepanel.html');
 await vi.waitFor(()=>expect(mocks.quote).toHaveBeenCalledOnce());await vi.waitFor(()=>expect(mocks.notify).toHaveBeenCalled());
 mocks.streamLive=true;(mocks.state as ()=>void)();(mocks.change as (address:string,slot:number)=>void)('pool',200);
 await vi.waitFor(()=>expect(mocks.quote).toHaveBeenCalledTimes(2),{timeout:5000});
 const prices=await invoke({type:'PORTFOLIO_PRICES',wallet},0,'chrome-extension://test-extension/dashboard.html');
 expect(prices.ok&&prices.portfolio?.holdings[0]).toMatchObject({priceMode:'LIVE',position:{balanceRaw:'10',expectedExitLamports:'1000000000'}});expect(mocks.balances).toHaveBeenCalledOnce();
 expect((await invoke({type:'PORTFOLIO_PRICES',wallet},0,pageUrl)).ok).toBe(false);watcher.port.disconnect();
});
it('falls back to 3s quotes while websocket subscriptions are unavailable',async()=>{
 vi.useFakeTimers();const usd={priceMicros:'100000000',capturedAt:Date.now(),source:'Coinbase spot' as const};
 mocks.balances.mockResolvedValue([{holding:{mint,position:{wallet,mint,balanceRaw:'10',decimals:6,supplyRaw:'1000',updatedAt:Date.now()}},target,quoteReady:true}]);
 mocks.quote.mockImplementation(async(_rpc,_target,_owner,_settings,position)=>({...position,expectedExitLamports:'1000000000',solUsd:usd,updatedAt:Date.now()}));
 const watcher=pricePort();watcher.send({type:'WATCH',wallet});for(let i=0;i<30;i++)await Promise.resolve();await invoke({type:'PORTFOLIO',wallet},0,'chrome-extension://test-extension/sidepanel.html');
 await vi.advanceTimersByTimeAsync(200);expect(mocks.quote).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(3000);expect(mocks.quote).toHaveBeenCalledTimes(2);expect(mocks.balances).toHaveBeenCalledOnce();
 const prices=await invoke({type:'PORTFOLIO_PRICES',wallet},0,'chrome-extension://test-extension/sidepanel.html');expect(prices.ok&&prices.portfolio?.holdings[0]?.priceMode).toBe('POLLING');watcher.port.disconnect();vi.useRealTimers();
});
it('discards a delayed old-quantity estimate after a confirmed balance change',async()=>{
 const usd={priceMicros:'100000000',capturedAt:Date.now(),source:'Coinbase spot' as const};let amount='10',release!:(value:any)=>void;
 mocks.balances.mockImplementation(async()=>[{holding:{mint,position:{wallet,mint,balanceRaw:amount,decimals:6,supplyRaw:'1000',updatedAt:Date.now()}},target,quoteReady:true}]);
 mocks.quote.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;})).mockImplementation(async(_rpc,_target,_owner,_settings,position)=>({...position,expectedExitLamports:'2000000000',solUsd:usd}));
 await invoke({type:'PORTFOLIO',wallet},0,'chrome-extension://test-extension/sidepanel.html');await vi.waitFor(()=>expect(mocks.quote).toHaveBeenCalledOnce());amount='20';
 await invoke({type:'PORTFOLIO',wallet,refresh:true},0,'chrome-extension://test-extension/sidepanel.html');release({wallet,mint,balanceRaw:'10',decimals:6,supplyRaw:'1000',updatedAt:Date.now(),expectedExitLamports:'9999999999',solUsd:usd});
 await vi.waitFor(()=>expect(mocks.quote).toHaveBeenCalledTimes(2),{timeout:5000});await vi.waitFor(async()=>{const prices=await invoke({type:'PORTFOLIO_PRICES',wallet},0,'chrome-extension://test-extension/sidepanel.html');expect(prices.ok&&prices.portfolio?.holdings[0]?.position).toMatchObject({balanceRaw:'20',expectedExitLamports:'2000000000'});});
});
it('stops dust subscriptions and fast quotes, then restores holdings when the slow revaluation reaches $0.1',async()=>{
 mocks.usd.mockImplementation(()=>({priceMicros:'100000000',capturedAt:Date.now(),source:'Coinbase spot'}));
 vi.useFakeTimers();let expected='500000';
 const usd={priceMicros:'100000000',capturedAt:Date.now(),source:'Coinbase spot' as const};
 mocks.balances.mockImplementation(async()=>[{holding:{mint,position:{wallet,mint,balanceRaw:'10',decimals:6,supplyRaw:'1000',updatedAt:Date.now()}},target,quoteReady:true}]);
 mocks.quote.mockImplementation(async(_rpc,_target,_owner,_settings,position)=>({...position,expectedExitLamports:expected,solUsd:usd,updatedAt:Date.now()}));
 const watcher=pricePort();watcher.send({type:'WATCH',wallet});for(let i=0;i<30;i++)await Promise.resolve();
 const sender='chrome-extension://test-extension/sidepanel.html';await invoke({type:'PORTFOLIO',wallet},0,sender);await vi.advanceTimersByTimeAsync(200);
 expect(mocks.quote).toHaveBeenCalledOnce();expect(mocks.stream.mock.results[0]!.value.update).toHaveBeenLastCalledWith([]);
 const dust=await invoke({type:'PORTFOLIO',wallet},0,sender);expect(dust.ok&&dust.portfolio?.holdings).toEqual([]);
 await vi.advanceTimersByTimeAsync(59_000);expect(mocks.quote).toHaveBeenCalledOnce();
 expected='1000000';await vi.advanceTimersByTimeAsync(1000);expect(mocks.quote).toHaveBeenCalledTimes(2);
 const restored=await invoke({type:'PORTFOLIO',wallet},0,sender);expect(restored.ok&&restored.portfolio?.holdings[0]?.position?.expectedExitLamports).toBe('1000000');
 await vi.advanceTimersByTimeAsync(1000);expect(mocks.stream.mock.results[0]!.value.update).toHaveBeenLastCalledWith(['pool']);watcher.port.disconnect();
});
it('keeps transient failures subscribed and retries within seconds without a websocket retry storm',async()=>{
 vi.useFakeTimers();vi.spyOn(Math,'random').mockReturnValue(0.5);
 mocks.balances.mockImplementation(async()=>[{holding:{mint,position:{wallet,mint,balanceRaw:'10',decimals:6,supplyRaw:'1000',updatedAt:Date.now()}},target,quoteReady:true}]);
 const watcher=pricePort();watcher.send({type:'WATCH',wallet});for(let i=0;i<30;i++)await Promise.resolve();
 const sender='chrome-extension://test-extension/sidepanel.html';await invoke({type:'PORTFOLIO',wallet},0,sender);await vi.advanceTimersByTimeAsync(200);
 const unknown=await invoke({type:'PORTFOLIO',wallet},0,sender);expect(unknown.ok&&unknown.portfolio?.holdings[0]?.priceMode).toBe('STALE');
 expect(mocks.stream.mock.results[0]!.value.update).toHaveBeenLastCalledWith(['pool']);
 for(let slot=1;slot<100;slot++)(mocks.change as (a:string,s:number)=>void)('pool',slot);
 await vi.advanceTimersByTimeAsync(2999);expect(mocks.quote).toHaveBeenCalledOnce();
 mocks.quote.mockImplementation(async(_rpc,_target,_owner,_settings,position)=>({...position,quoteIssue:undefined,updatedAt:Date.now(),expectedExitLamports:'1000000000',solUsd:{priceMicros:'100000000',capturedAt:Date.now(),source:'Coinbase spot'}}));
 await vi.advanceTimersByTimeAsync(1000);expect(mocks.quote).toHaveBeenCalledTimes(2);
 const recovered=await invoke({type:'PORTFOLIO_PRICES',wallet},0,sender);expect(recovered.ok&&recovered.portfolio?.holdings[0]?.position?.quoteIssue).toBeUndefined();watcher.port.disconnect();
});
it('passes the latest websocket slot to SDK account reads instead of pricing older snapshots',async()=>{
 const bodies:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{const request=JSON.parse(String(options.body));bodies.push(request);return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{context:{slot:500},value:{data:['','base64'],owner:PublicKey.default.toBase58(),lamports:1,executable:false,rentEpoch:0}}}),{headers:{'content-type':'application/json'}});}));
 const usd={priceMicros:'100000000',capturedAt:Date.now(),source:'Coinbase spot' as const};mocks.balances.mockResolvedValue([{holding:{mint,position:{wallet,mint,balanceRaw:'10',decimals:6,supplyRaw:'1000',updatedAt:Date.now()}},target,quoteReady:true}]);
 mocks.quote.mockImplementation(async(rpc,_target,_owner,_settings,position)=>{await rpc.getAccountInfo(new PublicKey(mint));return {...position,expectedExitLamports:'1000000000',solUsd:usd};});
 const watcher=pricePort();watcher.send({type:'WATCH',wallet});await vi.waitFor(()=>expect(mocks.stream).toHaveBeenCalledOnce());await invoke({type:'PORTFOLIO',wallet},0,'chrome-extension://test-extension/sidepanel.html');await vi.waitFor(()=>expect(mocks.notify).toHaveBeenCalled());
 (mocks.change as (account:string,slot:number)=>void)('pool',400);(mocks.change as (account:string,slot:number)=>void)('pool',500);
 await vi.waitFor(()=>expect(bodies.some(request=>request.params[1]?.minContextSlot===500)).toBe(true),{timeout:5000});expect(mocks.balances).toHaveBeenCalledOnce();watcher.port.disconnect();
});

it('shares the estimate between POSITION and PORTFOLIO across three private viewers',async()=>{
 vi.useFakeTimers();
 const snapshot={wallet,mint,balanceRaw:'100',decimals:0,supplyRaw:'1000',updatedAt:Date.now()};
 mocks.position.mockResolvedValue(snapshot);mocks.balances.mockResolvedValue([{holding:{mint,position:snapshot},target,quoteReady:true}]);
 mocks.quote.mockImplementation(async(_r,_t,_w,_s,p)=>({...p,updatedAt:Date.now(),expectedExitLamports:'1000000000'}));
 const watchers=[pricePort(),pricePort('chrome-extension://test-extension/dashboard.html'),pricePort()];for(const watcher of watchers)watcher.send({type:'WATCH',wallet});
 const current=invoke({type:'POSITION',wallet,target}),list=await invoke({type:'PORTFOLIO',wallet},0,'chrome-extension://test-extension/sidepanel.html');
 expect(list.ok).toBe(true);await vi.advanceTimersByTimeAsync(200);expect((await current).ok).toBe(true);
 expect(mocks.quote).toHaveBeenCalledOnce();expect(mocks.stream).toHaveBeenCalledOnce();
 for(const watcher of watchers)watcher.port.disconnect();
});
it('cancels a removed holding even when it had no websocket source',async()=>{
 vi.useFakeTimers();let release!:(value:unknown)=>void;
 const snapshot={wallet,mint,balanceRaw:'100',decimals:0,supplyRaw:'1000',updatedAt:Date.now()};
 mocks.balances.mockResolvedValueOnce([{holding:{mint,position:snapshot},target,quoteReady:true}]).mockResolvedValue([]);
 mocks.quote.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const sender='chrome-extension://test-extension/sidepanel.html';await invoke({type:'PORTFOLIO',wallet},0,sender);await vi.advanceTimersByTimeAsync(200);
 const signal=mocks.quote.mock.calls[0]![7].signal as AbortSignal;expect(signal.aborted).toBe(false);
 const removed=await invoke({type:'PORTFOLIO',wallet,refresh:true},0,sender);expect(removed.ok&&removed.portfolio?.holdings).toEqual([]);expect(signal.aborted).toBe(true);
 release({...snapshot,expectedExitLamports:'999999999'});await vi.advanceTimersByTimeAsync(1);
 const prices=await invoke({type:'PORTFOLIO_PRICES',wallet},0,sender);expect(prices.ok&&prices.portfolio?.holdings).toEqual([]);
});

afterEach(() => {vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});

beforeEach(async () => {
  mocks.usd.mockReset().mockReturnValue(undefined);mocks.data = {}; mocks.currentUrl = pageUrl;mocks.streamLive=false;mocks.accounts.mockReset().mockResolvedValue(['pool']);mocks.stream.mockReset().mockImplementation((_url,change,state)=>{mocks.change=change;mocks.state=state;return {update:vi.fn(),destroy:vi.fn(),hasLive:()=>mocks.streamLive};});mocks.position.mockReset();mocks.balances.mockReset().mockResolvedValue([]);mocks.quote.mockReset().mockImplementation(async (_rpc,_target,_wallet,_settings,position)=>({...position,warning:'Quote unavailable',quoteIssue:{kind:'RPC',message:'RPC unavailable',retryable:true}}));mocks.notify.mockReset().mockResolvedValue(undefined);mocks.openTab.mockReset().mockResolvedValue({id:2});mocks.history.mockReset().mockResolvedValue([]);
  mocks.fees.mockReset();mocks.totals.mockReset().mockResolvedValue({volumeUsdMicros:'100000000',savedUsdMicros:'1000000',verifiedTrades:1,pricedTrades:1,unpricedTrades:0,benchmarkBps:100});mocks.record.mockReset().mockResolvedValue(undefined);mocks.archive.mockReset().mockResolvedValue(undefined);
  mocks.build.mockReset().mockResolvedValue(built());
  mocks.send.mockReset().mockResolvedValue({ state: 'NOT_SENT', error: 'Phantom approval was rejected.' });
  mocks.connect.mockReset().mockResolvedValue(wallet);
  mocks.prepare.mockReset().mockResolvedValue(undefined);
  mocks.inspect.mockReset().mockResolvedValue(undefined);
  mocks.frameUrl.mockReset().mockImplementation(async () => mocks.currentUrl);
  mocks.reconcile.mockReset().mockImplementation(async (_rpc, receipt) => receipt);
  mocks.restore.mockReset().mockResolvedValue(wallet); mocks.switch.mockReset().mockResolvedValue(wallet);
  mocks.symbol.mockReset().mockResolvedValue('TEST');mocks.token.mockReset().mockResolvedValue({ mint, symbol: 'TEST' }); mocks.openWindow.mockReset().mockResolvedValue({ id: 2 });
  vi.stubGlobal('defineBackground', (main: () => void) => ({ main }));
  const background = await import('../entrypoints/background');
  background.default.main();
});

it.each(SITE_CONTEXTS)('$site cannot reach Pro execution or diagnostics through the site relay',async({target:siteTarget})=>{
  mocks.currentUrl=siteTarget.pageUrl;
  expect((await invoke({type:'PRO',action:'ENABLE'},0,siteTarget.pageUrl)).ok).toBe(false);
  expect((await invoke({type:'PRO',action:'REQUEST',method:'POST',path:'/v1/resume-engine'},0,siteTarget.pageUrl)).ok).toBe(false);
  expect((await invoke({type:'DIAGNOSTICS',action:'EXPORT'},0,siteTarget.pageUrl)).ok).toBe(false);
  expect(mocks.build).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
});
it('reads Pro mode only from native views without opening a trading tab or signing',async()=>{
  const result=await invoke({type:'PRO',action:'SETTINGS'},0,'chrome-extension://test-extension/sidepanel.html');
  expect(result.ok).toBe(true);expect(mocks.openTab).not.toHaveBeenCalled();
  expect((await invoke({type:'PRO',action:'SETTINGS'},0,'chrome-extension://test-extension/pro.html')).ok).toBe(false);
  expect(mocks.build).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
});

describe('worker execution gates', () => {
  it.each(SITE_CONTEXTS)('$site shares one pending read and keeps unresolved orders/private data guarded', async ({ target: siteTarget, source }) => {
    vi.useFakeTimers();const startedAt=Date.now();let release!:(value:any)=>void;
    mocks.currentUrl=siteTarget.pageUrl;
    mocks.position.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
    const read:WorkerRequest={type:'POSITION',target:siteTarget,wallet,market:{mint:siteTarget.mintHint??siteTarget.address,observedAt:startedAt,priceUsd:'1',source}};
    const first=invoke(read,0,siteTarget.pageUrl);
    await vi.waitFor(()=>expect(mocks.position).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(6_000);
    const second=invoke(read,0,siteTarget.pageUrl);
    await Promise.resolve();await Promise.resolve();
    release({wallet,mint:siteTarget.mintHint??siteTarget.address,balanceRaw:'1',decimals:6,supplyRaw:'100',updatedAt:startedAt+6_000});
    await vi.advanceTimersByTimeAsync(200);expect((await first).ok&&(await second).ok).toBe(true);expect(mocks.position).toHaveBeenCalledOnce();
    mocks.data[`receipt:${wallet}`]={wallet,mint,venue:'PUMP_CURVE',side:'BUY',pageUrl,message:'',blockhash:'',lastValidBlockHeight:100,createdAt:startedAt,status:'UNKNOWN'};
    expect((await invoke({...request,target:siteTarget},0,siteTarget.pageUrl)).ok).toBe(false);
    expect(mocks.build).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
    expect((await invoke({type:'SETTINGS_GET'},0,siteTarget.pageUrl)).ok).toBe(false);
    expect((await invoke({type:'HISTORY'},0,siteTarget.pageUrl)).ok).toBe(false);
  });
  it('shares the whole in-flight position lookup before awaiting receipt storage', async () => {
    mocks.position.mockResolvedValue({wallet,mint,balanceRaw:'1',decimals:6,supplyRaw:'1000',updatedAt:Date.now()});
    const read:WorkerRequest={type:'POSITION',target,wallet};
    const [a,b]=await Promise.all([invoke(read),invoke(read)]);
    expect(a.ok&&b.ok).toBe(true);
    expect(mocks.position).toHaveBeenCalledOnce();
  });
  it('keeps the quoted baseline mark unchanged when a live mark changes during cache reuse',async()=>{
    const market={mint,source:'GMGN page' as const,observedAt:Date.now(),priceUsd:'1.3'};
    mocks.position.mockResolvedValue({wallet,mint,balanceRaw:'100',decimals:0,supplyRaw:'1000',updatedAt:Date.now(),market});
    await invoke({type:'POSITION',target,wallet,market});
    const cached=await invoke({type:'POSITION',target,wallet,market:{...market,priceUsd:'2.6'}});
    expect(cached.ok&&cached.position?.market?.priceUsd).toBe('1.3');expect(mocks.position).toHaveBeenCalledOnce();expect(mocks.send).not.toHaveBeenCalled();
  });
  it('keeps full receipt history in the private dashboard and opens it in a tab',async()=>{
    expect((await invoke({type:'HISTORY'})).ok).toBe(false);
    expect((await invoke({type:'HISTORY'},0,'chrome-extension://test-extension/dashboard.html')).ok).toBe(true);
    expect((await invoke({type:'OPEN_DASHBOARD'})).ok).toBe(true);expect(mocks.openTab).toHaveBeenCalledWith({url:'chrome-extension://test-extension/dashboard.html'});
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('verifies only tracked signatures without invoking any signer and returns the 1% totals',async()=>{
    const sig=bs58.encode(new Uint8Array(64).fill(3));
    const receipt={wallet,mint,venue:'PUMP_CURVE',side:'BUY',pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',signature:sig};
    mocks.data[`receipt:${wallet}`]=receipt;
    mocks.fees.mockResolvedValue({state:'VERIFIED',checkedAt:Date.now(),note:'Fixture audit',protocolFees:[],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:true,executionSucceeded:true,volumeLamports:'100000000',volumeUsdMicros:'100000000'});
    const result=await invoke({type:'VERIFY_FEES',wallet,signature:sig});
    expect(result.ok&&result.receipt?.feeReceipt?.state).toBe('VERIFIED');expect(mocks.record).toHaveBeenCalledOnce();
    expect((await invoke({type:'VERIFY_FEES',wallet,signature:'not-tracked'})).ok).toBe(false);
    const totals=await invoke({type:'SAVINGS'});expect(totals.ok&&totals.savings?.savedUsdMicros).toBe('1000000');
    expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();expect(mocks.connect).not.toHaveBeenCalled();
  });
  it('an old fee audit cannot overwrite a newer order for the wallet',async()=>{
    const sig=bs58.encode(new Uint8Array(64).fill(4));
    mocks.data[`receipt:${wallet}`]={wallet,mint,venue:'PUMP_CURVE',side:'BUY',pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',signature:sig};
    let finish!:(value:unknown)=>void;mocks.fees.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=invoke({type:'VERIFY_FEES',wallet,signature:sig});
    await vi.waitFor(()=>expect(finish).toBeDefined());
    mocks.data[`receipt:${wallet}`]={wallet,status:'SIGNING',orderId:'new-order'};
    finish({state:'UNAVAILABLE',note:'Fixture',protocolFees:[],zeroExtraFeesVerified:false});await pending;
    expect(mocks.data[`receipt:${wallet}`]).toMatchObject({orderId:'new-order',status:'SIGNING'});
  });
  it('toolbar opens Settings but cannot read private credentials', async () => {
    const popup = 'chrome-extension://test-extension/sidepanel.html';
    expect((await invoke({ type: 'OPEN_SETTINGS' }, 0, popup)).ok).toBe(true);
    expect((await invoke({ type: 'SETTINGS_GET' }, 0, popup)).ok).toBe(false);
    expect((await invoke({ type: 'SETTINGS_GET' }, 0, 'chrome-extension://test-extension/settings.html')).ok).toBe(true);
  });
  it('restores the trusted wallet without a prompting connect and opens settings in an extension window', async () => {
    const restored = await invoke({ type: 'WALLET_RESTORE', target });
    expect(restored.ok && restored.wallet).toBe(wallet); expect(mocks.connect).not.toHaveBeenCalled();
    expect((await invoke({ type: 'OPEN_SETTINGS' })).ok).toBe(true);
    expect(mocks.openTab).toHaveBeenCalledWith({url:'chrome-extension://test-extension/settings.html'});
  });
  it('never returns RPC URLs or router API keys in public panel settings', async () => {
    mocks.data.settings = { rpcUrl: 'https://rpc.test/?api-key=rpc-secret', slippageBps: 500, maxBuySol: '1', priorityFeeLamports: 100_000, jupiterApiKey: 'router-secret' };
    const response = await invoke({ type: 'SETTINGS_PUBLIC' });
    expect(JSON.stringify(response)).not.toContain('secret'); expect(JSON.stringify(response)).not.toContain('rpcUrl');
  });
  it('checks RPC account access only from settings without wallet calls', async () => {
    const rpc = vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue({ data: Buffer.alloc(0), executable: false, lamports: 0, owner: new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'), rentEpoch: 0 });
    const test: WorkerRequest = { type: 'RPC_TEST', rpcUrl: 'https://rpc.test/?api-key=secret' };
    expect((await invoke(test)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect((await invoke(test, 0, 'chrome-extension://test-extension/settings.html')).ok).toBe(true);
    expect(rpc).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('returns actionable 403 guidance for the read-only RPC test', async () => {
    vi.spyOn(Connection.prototype, 'getAccountInfo').mockRejectedValue(new Error('403 Access forbidden https://rpc.test/?api-key=secret'));
    const response = await invoke({ type: 'RPC_TEST', rpcUrl: 'https://rpc.test/?api-key=secret' }, 0, 'chrome-extension://test-extension/settings.html');
    expect(!response.ok && response.error).toContain('RPC access denied');
    expect(!response.ok && response.error).not.toContain('secret');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('does not open Phantom after failed construction/simulation', async () => {
    mocks.build.mockRejectedValue(new Error('Transaction simulation failed.'));
    const response = await invoke(request);
    expect(response.ok).toBe(false); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('rejects stale page and iframe requests before building', async () => {
    mocks.currentUrl = 'https://gmgn.ai/';
    expect((await invoke(request)).ok).toBe(false);
    expect((await invoke(request, 1)).ok).toBe(false);
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it('accepts SPA navigation despite the sender original URL and ignores non-token query changes', async () => {
    mocks.currentUrl = pageUrl + '?tab=holders#chart';
    const response = await invoke(request, 0, 'https://gmgn.ai/');
    expect(response.ok).toBe(true);
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  it('rejects a changed token in the exact sender document even if tabs.get is stale', async () => {
    mocks.frameUrl.mockResolvedValue('https://gmgn.ai/sol/token/9XDYTfQKwW8sHPqnFdUreMmtmffmkHVPGTNV2e3LKxNW');
    expect((await invoke(request)).ok).toBe(false); expect(mocks.build).not.toHaveBeenCalled();
  });
  it('invalidates navigation during preparation before signing', async () => {
    mocks.build.mockImplementation(async () => { mocks.currentUrl = 'https://gmgn.ai/'; return built(); });
    expect((await invoke(request)).ok).toBe(false); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('locks concurrent wallet orders and saves status before opening Phantom', async () => {
    let finish!: () => void;
    mocks.build.mockImplementation(() => new Promise(resolve => { finish = () => resolve(built()); }));
    const first = invoke(request);
    await vi.waitFor(() => expect(mocks.build).toHaveBeenCalledOnce());
    expect((await invoke(request)).ok).toBe(false);
    mocks.send.mockImplementation(async () => {
      expect((mocks.data[`receipt:${wallet}`] as Receipt).status).toBe('SIGNING');
      return { state: 'NOT_SENT', error: 'rejected' };
    });
    finish(); await first;
    expect(mocks.send).toHaveBeenCalledOnce();
    expect((mocks.data[`receipt:${wallet}`] as Receipt).status).toBe('FAILED');
  });
  it('persists ambiguous transmission and blocks the next order without retry', async () => {
    mocks.send.mockRejectedValue(new Error('worker response lost'));
    const first = await invoke(request);
    expect(first.ok && first.receipt?.status).toBe('UNKNOWN');
    expect((await invoke(request)).ok).toBe(false);
    expect(mocks.build).toHaveBeenCalledOnce(); expect(mocks.send).toHaveBeenCalledOnce();
  });
  it('never persists UNKNOWN or sends when the Phantom bridge cannot prepare', async () => {
    mocks.prepare.mockRejectedValue(new Error('Could not load the Phantom bridge.'));
    const response = await invoke(request);
    expect(response.ok).toBe(false); expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.data[`receipt:${wallet}`]).toBeUndefined();
  });
  it('recovers a bridge rejection after restart as FAILED rather than UNKNOWN', async () => {
    mocks.data[`receipt:${wallet}`] = { wallet, mint, venue: 'PUMP_CURVE', side: 'BUY', pageUrl, message: '', blockhash: '', lastValidBlockHeight: 100, createdAt: 1, status: 'UNKNOWN', orderId: 'old', frame: { tabId: 1, documentId: 'document-1' } };
    mocks.inspect.mockResolvedValue({ stage: 'DONE', result: { state: 'NOT_SENT', invoked: true, error: 'Invalid transaction (-32003)' } });
    const response = await invoke({ type: 'STATUS', wallet });
    expect(response.ok && response.receipt?.status).toBe('FAILED');
    expect(mocks.reconcile).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('cancels a prepared bridge call before releasing a stale order', async () => {
    mocks.data[`receipt:${wallet}`] = { wallet, mint, venue: 'PUMP_CURVE', side: 'BUY', pageUrl, message: '', blockhash: '', lastValidBlockHeight: 100, createdAt: 1, status: 'SIGNING', orderId: 'old', frame: { tabId: 1, documentId: 'document-1' } };
    mocks.inspect.mockResolvedValueOnce({ stage: 'PREPARED' }).mockResolvedValueOnce({ stage: 'DONE', result: { state: 'NOT_SENT', invoked: false, error: 'cancelled before invocation' } });
    const response = await invoke({ type: 'STATUS', wallet });
    expect(response.ok && response.receipt?.status).toBe('FAILED');
    expect(mocks.inspect.mock.calls[1]?.[2]).toBe(true); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('includes precise simulation error and logs in the error response without opening Phantom', async () => {
    const { SimulationFailure } = await import('../src/simulation');
    mocks.build.mockRejectedValue(new SimulationFailure('Protocol error: InvalidAccountData', { stage: 'SIMULATION', code: 'InvalidAccountData', error: 'InvalidAccountData', logs: ['Program X failed: invalid account data'] }));
    const response = await invoke(request);
    expect(!response.ok && response.diagnostic?.logs).toEqual(['Program X failed: invalid account data']);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('persists a valid signature without treating broadcast as confirmed', async () => {
    const signature = bs58.encode(new Uint8Array(64).fill(1));
    mocks.send.mockResolvedValue({ state: 'SUBMITTED', signature });
    const response = await invoke(request);
    expect(response.ok && response.receipt?.status).toBe('SUBMITTED');
    expect(response.ok && response.receipt?.signature).toBe(signature);
  });
});
it('shares confirmed holdings with exit quotes and coalesces simultaneous confirmed refreshes',async()=>{
 let balance='100';
 mocks.position.mockImplementation(async(_rpc,_target,_wallet,_settings,market)=>({wallet,mint,balanceRaw:balance,decimals:0,supplyRaw:'1000',updatedAt:Date.now(),market}));
 const quoted=await invoke({type:'POSITION',target,wallet});expect(quoted.ok&&quoted.position?.balanceRaw).toBe('100');
 const holdings=await invoke({type:'POSITION',target,wallet,holdingsOnly:true});expect(holdings.ok&&holdings.position?.balanceRaw).toBe('100');
 await invoke({type:'POSITION',target,wallet});expect(mocks.position).toHaveBeenCalledOnce();expect(mocks.quote).toHaveBeenCalledOnce();
 balance='200';const refreshed=await Promise.all([invoke({type:'POSITION',target,wallet,holdingsOnly:true,refresh:true}),invoke({type:'POSITION',target,wallet,refresh:true})]);
 expect(refreshed.every(r=>r.ok&&r.position?.balanceRaw==='200')).toBe(true);expect(mocks.position).toHaveBeenCalledTimes(2);expect(mocks.quote).toHaveBeenCalledTimes(2);
 expect(mocks.send).not.toHaveBeenCalled();
});
it.each(SITE_CONTEXTS)('$site shares one pending confirmed snapshot across holdings and quote readers',async(context)=>{
 mocks.currentUrl=context.target.pageUrl;mocks.frameUrl.mockResolvedValue(context.target.pageUrl);
 const resolved=context.target.mintHint??context.target.address;
 let release!:(value:unknown)=>void;mocks.position.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const quote=invoke({type:'POSITION',target:context.target,wallet},0,context.target.pageUrl);
 await vi.waitFor(()=>expect(mocks.position).toHaveBeenCalledOnce());
 const holdings=invoke({type:'POSITION',target:context.target,wallet,holdingsOnly:true},0,context.target.pageUrl);
 for(let i=0;i<16;i++)await Promise.resolve();expect(mocks.position).toHaveBeenCalledOnce();expect(mocks.quote).not.toHaveBeenCalled();
 release({wallet,mint:resolved,balanceRaw:'10',decimals:0,supplyRaw:'1000',updatedAt:Date.now()});
 const rows=await Promise.all([quote,holdings]);expect(rows.every(r=>r.ok&&r.position?.balanceRaw==='10')).toBe(true);expect(mocks.quote).toHaveBeenCalledOnce();expect(mocks.send).not.toHaveBeenCalled();
});
it('rejects a delayed old-quantity quote after a newer confirmed holdings snapshot',async()=>{
 vi.useFakeTimers();let balance='100',release!:(value:unknown)=>void;
 mocks.position.mockImplementation(async()=>({wallet,mint,balanceRaw:balance,decimals:0,supplyRaw:'1000',updatedAt:Date.now()}));
 mocks.quote.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const old=invoke({type:'POSITION',target,wallet});await vi.advanceTimersByTimeAsync(200);expect(release).toBeDefined();
 balance='200';const latest=await invoke({type:'POSITION',target,wallet,holdingsOnly:true,refresh:true});expect(latest.ok&&latest.position?.balanceRaw).toBe('200');
 release({wallet,mint,balanceRaw:'100',decimals:0,supplyRaw:'1000',updatedAt:Date.now(),expectedExitLamports:'1000'});expect((await old).ok).toBe(false);
 const correction=invoke({type:'POSITION',target,wallet});await vi.advanceTimersByTimeAsync(200);const corrected=await correction;expect(corrected.ok&&corrected.position?.balanceRaw).toBe('200');
});
it('uses the confirmed transaction slot as a floor for immediate balance reads',async()=>{
 mocks.data[`receipt:${wallet}`]={wallet,mint,status:'CONFIRMED',confirmedSlot:777};
 mocks.position.mockResolvedValue({wallet,mint,balanceRaw:'200',decimals:0,supplyRaw:'1000',updatedAt:Date.now()});
 await invoke({type:'POSITION',target,wallet,holdingsOnly:true,refresh:true});
 expect(mocks.position.mock.calls[0]![6]).toBe(777);
});
it.each(SITE_CONTEXTS)('$site passes the existing Holdings balance proof to the current-position chart path',async({target:siteTarget})=>{
 mocks.currentUrl=siteTarget.pageUrl;
 const currentMint=siteTarget.mintHint??siteTarget.address;
 const position={wallet,mint:currentMint,balanceRaw:'100',decimals:6,supplyRaw:'1000',updatedAt:Date.now(),balanceUpdatedAt:Date.now()};
 const row={holding:{mint:currentMint,position},target:siteTarget,quoteReady:true,balanceSlot:777};
 mocks.balances.mockResolvedValue([row]);mocks.position.mockResolvedValue(position);
 await invoke({type:'PORTFOLIO',wallet},0,'chrome-extension://test-extension/sidepanel.html');
 await invoke({type:'POSITION',target:siteTarget,wallet,holdingsOnly:true,refresh:true},0,siteTarget.pageUrl);
 expect(mocks.position.mock.lastCall?.[8].balance).toEqual({position,slot:777,quoteReady:true});
 row.quoteReady=false;
 await invoke({type:'POSITION',target:siteTarget,wallet,holdingsOnly:true,refresh:true},0,siteTarget.pageUrl);
 expect(mocks.position.mock.lastCall?.[8].balance).toEqual({position,slot:777,quoteReady:false});
});

it('rejects unsupported top frames for public status and open actions',async()=>{
 mocks.currentUrl='https://example.com/token';
 for(const request of [{type:'STATUS',wallet},{type:'SAVINGS'},{type:'OPEN_SETTINGS'},{type:'OPEN_DASHBOARD'},{type:'SETTINGS_PUBLIC'}] as WorkerRequest[])
  expect((await invoke(request,0,mocks.currentUrl)).ok).toBe(false);
 expect(mocks.openTab).not.toHaveBeenCalled();
});
it('does not reuse position quotes across pool hints or slippage settings',async()=>{
 mocks.position.mockResolvedValue({wallet,mint,balanceRaw:'100',decimals:0,supplyRaw:'1000',updatedAt:Date.now()});
 await invoke({type:'POSITION',target,wallet});
 await invoke({type:'POSITION',target:{...target,poolHint:wallet},wallet});
 mocks.data.settings={...DEFAULT_SETTINGS,slippageBps:100};
 await invoke({type:'POSITION',target:{...target,poolHint:wallet},wallet});
 expect(mocks.position).toHaveBeenCalledTimes(3);
});
it('a failed older refresh does not evict a newer position request',async()=>{
 let fail!:(error:Error)=>void;
 mocks.position.mockImplementationOnce(()=>new Promise((_resolve,reject)=>{fail=reject;}));
 const old=invoke({type:'POSITION',target,wallet});
 await vi.waitFor(()=>expect(fail).toBeDefined());
 mocks.position.mockResolvedValue({wallet,mint,balanceRaw:'200',decimals:0,supplyRaw:'1000',updatedAt:Date.now()});
 await invoke({type:'POSITION',target,wallet,refresh:true});
 fail(new Error('old request failed'));await old;
 const cached=await invoke({type:'POSITION',target,wallet});
 expect(cached.ok&&cached.position?.balanceRaw).toBe('200');expect(mocks.position).toHaveBeenCalledTimes(2);
});
it('locks a pending wallet across GMGN and Axiom',async()=>{
 mocks.send.mockResolvedValue({state:'UNKNOWN',error:'lost reply'});
 await invoke(request);
 const axiomUrl=`https://axiom.trade/meme/${wallet}?chain=sol`;
 mocks.currentUrl=axiomUrl;
 const next=await invoke({...request,target:{site:'AXIOM',kind:'POOL',address:wallet,pageUrl:axiomUrl}},0,axiomUrl);
 expect(next.ok).toBe(false);expect(mocks.build).toHaveBeenCalledOnce();expect(mocks.send).toHaveBeenCalledOnce();
});

it('accepts FOMO token senders and keeps private settings and history private',async()=>{
 const fomoUrl=`https://fomo.family/tokens/solana/${mint}`;
 const fomo={site:'FOMO' as const,kind:'MINT' as const,address:mint,pageUrl:fomoUrl};
 mocks.currentUrl=fomoUrl;
 expect((await invoke({type:'WALLET_RESTORE',target:fomo},0,fomoUrl)).ok).toBe(true);
 expect((await invoke({type:'SETTINGS_PUBLIC'},0,fomoUrl)).ok).toBe(true);
 expect((await invoke({type:'SETTINGS_GET'},0,fomoUrl)).ok).toBe(false);
 expect((await invoke({type:'HISTORY'},0,fomoUrl)).ok).toBe(false);
});
it('rejects stale exact documents and iframes for targetless status requests',async()=>{
 mocks.frameUrl.mockResolvedValue('https://gmgn.ai/');
 expect((await invoke({type:'STATUS',wallet})).ok).toBe(false);
 mocks.frameUrl.mockResolvedValue(pageUrl);
 expect((await invoke({type:'STATUS',wallet},1)).ok).toBe(false);
});


it('enriches historical receipts with one metadata lookup per mint and retains all records on metadata failure',async()=>{
 const receipt={wallet,mint,venue:'PUMP_SWAP',side:'BUY',pageUrl,message:'',blockhash:'',lastValidBlockHeight:0,createdAt:1,status:'CONFIRMED',signature:'a'} as Receipt;
 mocks.history.mockResolvedValue([receipt,{...receipt,signature:'b'}]);mocks.symbol.mockResolvedValue('Topless');
 const response=await invoke({type:'HISTORY'},0,'chrome-extension://test-extension/dashboard.html');
 expect(response.ok&&response.receipts?.map(r=>r.symbol)).toEqual(['Topless','Topless']);expect(mocks.symbol).toHaveBeenCalledOnce();
 mocks.history.mockResolvedValue([{...receipt,mint:wallet,signature:'c'}]);mocks.symbol.mockRejectedValue(new Error('metadata unavailable'));
 const failed=await invoke({type:'HISTORY'},0,'chrome-extension://test-extension/dashboard.html');
 expect(failed.ok&&failed.receipts?.length).toBe(1);expect(failed.ok&&failed.receipts?.[0]?.symbol).toBeUndefined();
});
