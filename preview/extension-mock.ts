import { SITE_CATALOG } from '../src/sites/catalog';
import type { PageTarget } from '../src/model';
import { DEFAULT_SETTINGS, type WorkerRequest } from '../src/model';

let settings = { ...DEFAULT_SETTINGS };
const mint = 'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP';
const pool = 'AG1EhPjsBrkxQWkViuLXF6pQnHwfr9f9sdNneeoykcEJ';
const requestedSite = new URL(location.href).searchParams.get('site');
let target: PageTarget = requestedSite === 'axiom'
  ? { site:'AXIOM',kind:'POOL',address:pool,mintHint:mint,pageUrl:`https://axiom.trade/meme/${pool}?chain=sol` }
  : requestedSite === 'fomo'
    ? { site:'FOMO',kind:'MINT',address:mint,pageUrl:`https://fomo.family/tokens/solana/${mint}` }
    : { site:'GMGN',kind:'MINT',address:mint,pageUrl:`https://gmgn.ai/sol/token/${mint}` };
const marketSource = () => SITE_CATALOG[target.site].marketSource;
function mockEvent() {
  const listeners = new Set<(...args: any[]) => void>();
  return { addListener: (listener: (...args: any[]) => void) => listeners.add(listener), removeListener: (listener: (...args: any[]) => void) => listeners.delete(listener), emit: (...args: any[]) => { for (const listener of listeners) listener(...args); } };
}
const onActivated=mockEvent(), onUpdated=mockEvent(), onMessage=mockEvent();
import { type Receipt, type FeeReceipt } from '../src/model';
const feeDemo:FeeReceipt={state:'VERIFIED',checkedAt:Date.now(),auditVersion:2,tokenBeforeRaw:'0',tokenAfterRaw:'500000000000',tokenDeltaRaw:'500000000000',note:'Mock audit only. No real trade was sent.',slot:123456,blockTime:Math.floor(Date.now()/1000),totalNetworkLamports:'205000',baseNetworkLamports:'5000',priorityLamports:'200000',rentDepositedLamports:'2039280',rentRefundedLamports:'0',protocolFees:[{label:'Pump protocol',rawAmount:'2500000',mint:'So11111111111111111111111111111111111111112',decimals:9,symbol:'SOL'},{label:'Pump creator',rawAmount:'625000',mint:'So11111111111111111111111111111111111111112',decimals:9,symbol:'SOL'}],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:true,executionSucceeded:true,volumeLamports:'250000000',volumeUsdMicros:'30000000',usd:{priceMicros:'120000000',capturedAt:Date.now(),source:'Coinbase spot'}};
let marketPrice='0.01';
let wallet = '9XDYTfQKwW8sHPqnFdUreMmtmffmkHVPGTNV2e3LKxNW';
async function send(request: WorkerRequest) {
  if(request.type==='OPEN_DASHBOARD'){document.body.dataset.detailsRequested='true';return {ok:true};}
  if(request.type==='HISTORY')return {ok:true,receipts:['30000000','45000000','550000000'].map((usd,index)=>({signature:String(5+index).repeat(88),wallet,mint,side:index===1?'SELL':'BUY',venue:'PUMP_CURVE',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now()-(2-index)*86400000,status:'CONFIRMED',inputAmount:'250000000',feeReceipt:{...feeDemo,blockTime:Math.floor(Date.now()/1000)-(2-index)*86400,volumeUsdMicros:usd}})),savings:{volumeUsdMicros:'625000000',savedUsdMicros:'6250000',verifiedTrades:3,pricedTrades:3,unpricedTrades:0,benchmarkBps:100}};
  if(request.type==='POSITION')return {ok:true,position:{wallet,mint,balanceRaw:new URL(location.href).searchParams.has('position')?'500000000000':'0',decimals:6,supplyRaw:'1000000000000000',updatedAt:Date.now(),costBasisUsdMicros:'4851987400',expectedExitLamports:marketPrice==='0.02'?'82916666666':'41458333333',exitNetworkLamports:'105000',exitSetupLamports:'0',solUsd:{priceMicros:'120000000',capturedAt:Date.now(),source:'Coinbase spot'},market:{mint,observedAt:Date.now(),priceUsd:marketPrice,source:marketSource()}}};
  if(request.type==='SAVINGS')return {ok:true,savings:{volumeUsdMicros:'625000000',savedUsdMicros:'6250000',verifiedTrades:3,pricedTrades:3,unpricedTrades:0,benchmarkBps:100}};
  if(request.type==='STATUS' && new URL(location.href).searchParams.has('receipt'))return {ok:true,receipt:{signature:'5'.repeat(88),wallet,mint,side:'BUY',venue:'PUMP_CURVE',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',inputAmount:'250000000',feeReceipt:feeDemo} satisfies Receipt};
  if(request.type==='VERIFY_FEES'){document.body.dataset.verifyRequested='true';return {ok:true,receipt:{signature:request.signature,wallet,mint,side:'BUY',venue:'PUMP_CURVE',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',inputAmount:'250000000',feeReceipt:feeDemo} satisfies Receipt};}

  if (request.type === 'SETTINGS_GET') return { ok: true, settings };
  if (request.type === 'SETTINGS_SAVE') { settings = request.settings; return { ok: true }; }
  if (request.type === 'SETTINGS_PUBLIC') return { ok: true, publicSettings: settings };
  if (request.type === 'RPC_TEST') return { ok: true };
  if (request.type === 'OPEN_SETTINGS') { document.body.dataset.settingsOpened = 'true'; return { ok: true }; }
  if (request.type === 'TOKEN_INFO') return { ok: true, token: { mint, symbol: 'SI', venue: new URL(location.href).searchParams.has('router') ? 'JUPITER' : 'PUMP_CURVE', quoteSymbol: new URL(location.href).searchParams.has('router') ? 'WBTC' : 'SOL', quoteMint: new URL(location.href).searchParams.has('router') ? '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh' : 'So11111111111111111111111111111111111111112' } };
  if (request.type === 'WALLET_SWITCH') wallet = '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
  if (['WALLET_SWITCH', 'CONNECT', 'WALLET_RESTORE'].includes(request.type)) return { ok: true, wallet };
  if (request.type === 'TRADE') { document.body.dataset.tradeRequested = 'true'; document.body.dataset.tradeIntent = JSON.stringify(request.intent); return { ok: false, error: new URL(location.href).searchParams.has('error')?'Add a Jupiter API key in Settings for automatic SOL routing. Direct SOL pairs need no key.':'Mock only: no real trade was sent.' }; }
  return { ok: true };
}
Object.assign(globalThis, { chrome: {
  runtime: { id: 'preview', getManifest: () => ({ version: '0.7.1' }), sendMessage: send, onMessage },
  sidePanel:{open:async()=>{document.body.dataset.sidePanelOpened='true';}},
  permissions: { request: async () => true },
  tabs: {
    onActivated, onUpdated,
    query: async () => [{ id: 1, url: target.pageUrl }],
    sendMessage: async (_tab: number, message: { type: string; request: WorkerRequest }) => message.type === 'PANEL_CONTEXT' ? { target: new URL(location.href).searchParams.has('empty') ? null : target, market:{mint,observedAt:Date.now(),priceUsd:marketPrice,source:marketSource()} } : message.type === 'PANEL_REQUEST' ? send(message.request) : { ok: true },
  },
} });

Object.assign(globalThis,{changeMockMarketPrice:(price:string)=>{marketPrice=price;}});
