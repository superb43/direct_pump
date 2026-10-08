import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import bs58 from 'bs58';
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { DEFAULT_SETTINGS, type WorkerRequest, type WorkerResponse, type Receipt } from '../src/model';
import { SITE_CONTEXTS } from './fixtures/site-contexts';

const mocks = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  listener: undefined as unknown,
  currentUrl: '',
  build: vi.fn(), send: vi.fn(), connect: vi.fn(), prepare: vi.fn(), inspect: vi.fn(), frameUrl: vi.fn(), reconcile: vi.fn(), restore: vi.fn(), switch: vi.fn(), token: vi.fn(), openWindow: vi.fn(), openTab:vi.fn(), history:vi.fn(),position:vi.fn(), fees: vi.fn(), totals: vi.fn(), record: vi.fn(), archive: vi.fn(),
}));

vi.mock('wxt/browser', () => ({ browser: {
  runtime: { id: 'test-extension', getURL: (path: string) => `chrome-extension://test-extension${path}`, onMessage: { addListener: (listener: unknown) => { mocks.listener = listener; } } },
  tabs: { create:mocks.openTab, get: async () => ({ url: mocks.currentUrl }), query: async () => [], sendMessage: vi.fn() },
  windows: { create: mocks.openWindow },
  storage: { local: {
    get: async (key: string) => ({ [key]: mocks.data[key] }),
    set: async (values: Record<string, unknown>) => { Object.assign(mocks.data, values); },
  } },
  permissions: { contains: async () => true },
} }));
vi.mock('../src/hybrid', () => ({ buildHybridTrade: mocks.build }));
vi.mock('../src/phantom', () => ({ connectPhantom: mocks.connect, sendWithPhantom: mocks.send, preparePhantom: mocks.prepare, inspectPhantom: mocks.inspect, currentFrameUrl: mocks.frameUrl, restorePhantom: mocks.restore, switchPhantom: mocks.switch }));
vi.mock('../src/reconcile', () => ({ reconcileMissingSignature: mocks.reconcile }));
vi.mock('../src/fee-receipt', () => ({ verifyFeeReceipt:mocks.fees, pendingFees:(note:string,state='PENDING')=>({state,note,protocolFees:[],zeroExtraFeesVerified:false}) }));
vi.mock('../src/ledger', () => ({ readSavings:mocks.totals, recordVerifiedTrade:mocks.record, archiveReceipt:mocks.archive, receiptBySignature:async()=>undefined, unauditedReceipts:async()=>[], allReceipts:mocks.history }));
vi.mock('../src/position',()=>({readPosition:mocks.position}));
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

afterEach(() => vi.restoreAllMocks());

beforeEach(async () => {
  mocks.data = {}; mocks.currentUrl = pageUrl;mocks.position.mockReset();mocks.openTab.mockReset().mockResolvedValue({id:2});mocks.history.mockReset().mockResolvedValue([]);
  mocks.fees.mockReset();mocks.totals.mockReset().mockResolvedValue({volumeUsdMicros:'100000000',savedUsdMicros:'1000000',verifiedTrades:1,pricedTrades:1,unpricedTrades:0,benchmarkBps:100});mocks.record.mockReset().mockResolvedValue(undefined);mocks.archive.mockReset().mockResolvedValue(undefined);
  mocks.build.mockReset().mockResolvedValue(built());
  mocks.send.mockReset().mockResolvedValue({ state: 'NOT_SENT', error: 'Phantom approval was rejected.' });
  mocks.connect.mockReset().mockResolvedValue(wallet);
  mocks.prepare.mockReset().mockResolvedValue(undefined);
  mocks.inspect.mockReset().mockResolvedValue(undefined);
  mocks.frameUrl.mockReset().mockImplementation(async () => mocks.currentUrl);
  mocks.reconcile.mockReset().mockImplementation(async (_rpc, receipt) => receipt);
  mocks.restore.mockReset().mockResolvedValue(wallet); mocks.switch.mockReset().mockResolvedValue(wallet);
  mocks.token.mockReset().mockResolvedValue({ mint, symbol: 'TEST' }); mocks.openWindow.mockReset().mockResolvedValue({ id: 2 });
  vi.stubGlobal('defineBackground', (main: () => void) => ({ main }));
  const background = await import('../entrypoints/background');
  background.default.main();
});

describe('worker execution gates', () => {
  it.each(SITE_CONTEXTS)('$site shares one pending read and keeps unresolved orders/private data guarded', async ({ target: siteTarget, source }) => {
    const startedAt=Date.now();let release!:(value:any)=>void;
    mocks.currentUrl=siteTarget.pageUrl;
    mocks.position.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
    const read:WorkerRequest={type:'POSITION',target:siteTarget,wallet,market:{mint:siteTarget.mintHint??siteTarget.address,observedAt:startedAt,priceUsd:'1',source}};
    const first=invoke(read,0,siteTarget.pageUrl);
    await vi.waitFor(()=>expect(mocks.position).toHaveBeenCalledOnce());
    vi.spyOn(Date,'now').mockReturnValue(startedAt+6_000);
    const second=invoke(read,0,siteTarget.pageUrl);
    await Promise.resolve();await Promise.resolve();
    release({wallet,mint:siteTarget.mintHint??siteTarget.address,balanceRaw:'1',decimals:6,supplyRaw:'100',updatedAt:startedAt+6_000});
    expect((await first).ok&&(await second).ok).toBe(true);expect(mocks.position).toHaveBeenCalledOnce();
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
it('separates fast holdings from cached exit quotes and bypasses both on confirmed refresh',async()=>{
 mocks.position.mockImplementation(async(_rpc,_target,_wallet,_settings,market,holdingsOnly)=>({wallet,mint,balanceRaw:holdingsOnly?'200':'100',decimals:0,supplyRaw:'1000',updatedAt:Date.now(),market}));
 await invoke({type:'POSITION',target,wallet});
 const holdings=await invoke({type:'POSITION',target,wallet,holdingsOnly:true});expect(holdings.ok&&holdings.position?.balanceRaw).toBe('200');
 await invoke({type:'POSITION',target,wallet});expect(mocks.position).toHaveBeenCalledTimes(2);
 await invoke({type:'POSITION',target,wallet,refresh:true});expect(mocks.position).toHaveBeenCalledTimes(3);
 expect(mocks.send).not.toHaveBeenCalled();
});
it('uses the confirmed transaction slot as a floor for immediate balance reads',async()=>{
 mocks.data[`receipt:${wallet}`]={wallet,mint,status:'CONFIRMED',confirmedSlot:777};
 mocks.position.mockResolvedValue({wallet,mint,balanceRaw:'200',decimals:0,supplyRaw:'1000',updatedAt:Date.now()});
 await invoke({type:'POSITION',target,wallet,holdingsOnly:true,refresh:true});
 expect(mocks.position.mock.calls[0]![6]).toBe(777);
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
