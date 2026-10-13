import { SITE_CATALOG } from '../src/sites/catalog';
import type { PageTarget } from '../src/model';
import { parseSol } from '../src/amounts';
import { DEFAULT_SETTINGS, type WorkerRequest } from '../src/model';
import { validateProSpecV2, type ProRequest, type ProSettings, type ProOrder, type ProEvent, type ProHealth } from '../src/pro/contracts';
import { marketCapUsd } from '../src/pro/mc';

let settings = { ...DEFAULT_SETTINGS };
const scenario = new URL(location.href).searchParams;
const requests: WorkerRequest[] = [];
Object.assign(globalThis, { mockRequests: requests });
const mint = 'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP';
const pool = 'AG1EhPjsBrkxQWkViuLXF6pQnHwfr9f9sdNneeoykcEJ';
const requestedSite = new URL(location.href).searchParams.get('site');
let target: PageTarget = requestedSite === 'axiom'
  ? { site:'AXIOM',kind:'POOL',address:pool,mintHint:mint,pageUrl:`https://axiom.trade/meme/${pool}?chain=sol` }
  : requestedSite === 'fomo'
    ? { site:'FOMO',kind:'MINT',address:mint,pageUrl:`https://fomo.family/tokens/solana/${mint}` }
    : { site:'GMGN',kind:'MINT',address:mint,pageUrl:`https://gmgn.ai/sol/token/${mint}` };
const marketSource = () => SITE_CATALOG[target.site].marketSource;
const requestedStatus=new URL(location.href).searchParams.get('status');
const receiptStatus:Receipt['status']=['SIGNING','SUBMITTED','UNKNOWN','CONFIRMED','FAILED','EXPIRED'].includes(requestedStatus??'')?requestedStatus as Receipt['status']:'CONFIRMED';
function mockEvent() {
  const listeners = new Set<(...args: any[]) => void>();
  return { addListener: (listener: (...args: any[]) => void) => listeners.add(listener), removeListener: (listener: (...args: any[]) => void) => listeners.delete(listener), emit: (...args: any[]) => { for (const listener of listeners) listener(...args); } };
}
const onActivated=mockEvent(), onUpdated=mockEvent(), onMessage=mockEvent(), onStorage=mockEvent();
let portfolioReads=0,priceReads=0,balanceAt=Date.now(),mockQuote='41458333333',mockMode:import('../src/model').PriceMode='LIVE',previewPricesReady=!new URL(location.href).searchParams.has('pending-prices');
import { type Receipt, type FeeReceipt } from '../src/model';
const historyAt=Date.parse('2026-10-08T12:00:00Z');
const previewOpenedAt=Date.now()-52_000,previewCatOpenedAt=Date.now()-5_700_000;
const feeDemo:FeeReceipt={state:'VERIFIED',checkedAt:Date.now(),auditVersion:3,tokenBeforeRaw:'0',tokenAfterRaw:'500000000000',tokenDeltaRaw:'500000000000',note:'Mock audit only. No real trade was sent.',slot:123456,blockTime:Math.floor(Date.now()/1000),totalNetworkLamports:'205000',baseNetworkLamports:'5000',priorityLamports:'200000',rentDepositedLamports:'2039280',rentRefundedLamports:'0',protocolFees:[{label:'Pump protocol',rawAmount:'2500000',mint:'So11111111111111111111111111111111111111112',decimals:9,symbol:'SOL'},{label:'Pump creator',rawAmount:'625000',mint:'So11111111111111111111111111111111111111112',decimals:9,symbol:'SOL'}],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:true,executionSucceeded:true,volumeLamports:'250000000',volumeUsdMicros:'30000000',usd:{priceMicros:'120000000',capturedAt:Date.now(),source:'Coinbase spot'}};
let marketPrice=scenario.has('pro')?'0.00042':'0.01';
let wallet = '9XDYTfQKwW8sHPqnFdUreMmtmffmkHVPGTNV2e3LKxNW';
let serverWallet='7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
const solMint='So11111111111111111111111111111111111111112';
let proSettings:ProSettings={enabled:['on','offline','stop-fail','locked','old-server'].includes(scenario.get('pro')??''),serverUrl:scenario.has('pro')&&scenario.get('pro')!=='unpaired'?'https://mock.invalid':'',chromeNotifications:false,...scenario.has('pro')&&scenario.get('pro')!=='unpaired'?{serverId:'preview-server',deviceId:'preview-device'}:{}};
let proEngine:ProHealth['engine']=scenario.get('pro-engine')==='PAUSED'?'PAUSED':proSettings.enabled?'RUNNING':'PAUSED';
let proSigner:ProHealth['signer']=scenario.get('pro')==='locked'?'LOCKED':'READY';
const mockStored:Record<string,unknown>=JSON.parse(localStorage.getItem('dp-pro-mock-storage')??'{}');
const proOrders:ProOrder[]=JSON.parse(localStorage.getItem('dp-pro-mock-orders')??'[]'),proEvents:ProEvent[]=[];
let mockSolAvailable='1630000000';
let mockOrderAckLost=false;let releaseProPreview:(()=>void)|undefined;
const proPorts:Array<{name:string;onMessage:ReturnType<typeof mockEvent>;onDisconnect:ReturnType<typeof mockEvent>;postMessage:(message:unknown)=>void;disconnect:()=>void}>=[];
const proBase={version:2 as const,basis:'MC' as const,side:'SELL' as const,target,mint,amountRaw:'10000000000',decimals:6,expiresAt:Date.now()+86400000,slippageBps:100,priorityFeeLamports:100000,maxNetworkLamports:'5000000'};
if(scenario.has('pro-orders')&&!proOrders.length){
  const steps=[{id:'123e4567-e89b-42d3-a456-426614174011',kind:'TAKE_PROFIT' as const,targetMcUsd:'525000',portionBps:2500},{id:'123e4567-e89b-42d3-a456-426614174012',kind:'TAKE_PROFIT' as const,targetMcUsd:'630000',portionBps:2500},{id:'123e4567-e89b-42d3-a456-426614174013',kind:'STOP_LOSS' as const,targetMcUsd:'336000',remaining:true as const}];
  const state=scenario.get('pro-order-state') as ProOrder['state']|null;
  proOrders.push({id:'123e4567-e89b-42d3-a456-426614174000',revision:1,spec:{...proBase,kind:'STRATEGY',steps},wallet:serverWallet,state:state??'OPEN',createdAt:Date.now(),updatedAt:Date.now(),currentMcUsd:'420000',strategy:{baseRaw:proBase.amountRaw,remainingRaw:proBase.amountRaw,steps:steps.map(step=>({id:step.id,state:'OPEN'}))},...state==='UNKNOWN'?{reason:'Network outcome unconfirmed. Reserved funds stay locked.'}:{}});
  proOrders.push({id:'123e4567-e89b-42d3-a456-426614174001',revision:1,spec:{...proBase,amountRaw:'2500000000',kind:'TRAILING',activationMcUsd:'500000',trailingBps:500},wallet:serverWallet,state:'OPEN',createdAt:Date.now(),updatedAt:Date.now(),currentMcUsd:'420000',trailActive:false});
}
if(scenario.has('pro-buy-orders')){
  const base={...proBase,kind:'MARKET' as const,side:'BUY' as const,decimals:9};
  for(const [index,amount,protectedBuy]of [[0,'20000000',true],[1,'30000000',false]] as const){proOrders.push({id:`123e4567-e89b-42d3-a456-42661417430${index}`,revision:1,spec:{...base,amountRaw:amount,...protectedBuy?{exitStrategy:{durationMs:86400000,steps:[{id:'123e4567-e89b-42d3-a456-426614174310',kind:'TAKE_PROFIT' as const,targetMcUsd:'600000',portionBps:2500}]}}:{}},wallet:serverWallet,state:'OPEN',createdAt:previewOpenedAt,updatedAt:previewOpenedAt});}
}
function publishPro(){
  localStorage.setItem('dp-pro-mock-orders',JSON.stringify(proOrders));
  const event:ProEvent={sequence:proEvents.length+1,id:crypto.randomUUID(),at:Date.now(),type:'ORDER_UPDATED',message:'Mock order changed; no real trade was sent.'};proEvents.push(event);
  for(const port of proPorts)if(port.name==='pro-events')port.onMessage.emit({type:'PRO_EVENT',event});
}
function changeProSettings(next:ProSettings){const oldValue=proSettings;proSettings={...next};onStorage.emit({proSettings:{oldValue,newValue:proSettings}},'local');}
async function sendMockPro(request:ProRequest):Promise<unknown>{
  if(request.action==='SETTINGS'&&scenario.get('pro')==='malformed-settings')return {ok:true,data:{serverId:'preview-server',deviceId:'preview-device',enabled:'false'}};
  if(request.action==='SETTINGS'){
    if(scenario.get('pro')==='settings-error')return {ok:false,error:'Mock mode settings unavailable.'};
    if(request.settings)changeProSettings({...proSettings,...request.settings});
    return {ok:true,data:{...proSettings}};
  }
  if(request.action==='ENABLE'){
    if(!proSettings.deviceId)return{ok:false,error:'Pair your personal server in Settings first.'};
    if(proSigner!=='READY')return{ok:false,error:'Unlock the signer on its private server console before enabling Pro.'};
    proEngine='RUNNING';changeProSettings({...proSettings,enabled:true});return{ok:true,data:{}};
  }
  if(request.action==='DISABLE'){
    if(scenario.get('pro')==='stop-fail'||scenario.get('pro')==='offline')return{ok:false,error:'Stop unconfirmed: server pause could not be confirmed. Pro remains enabled; reconnect and retry.'};
    proEngine='PAUSED';for(const order of proOrders)if(['OPEN','BLOCKED'].includes(order.state))order.state='PAUSED';changeProSettings({...proSettings,enabled:false});return{ok:true,data:{...proSettings}};
  }
  if(request.action!=='REQUEST')return{ok:false,error:'This preview supports native panel orders only.'};
  if(scenario.get('pro')==='offline')return{ok:false,error:'Personal server unavailable. Reconnect to check existing orders.'};
  const path=request.path??'',method=request.method??'GET';
  if(method==='GET'&&((scenario.has('pro-balance-fail')&&path.startsWith('/v1/wallet'))||(scenario.has('pro-events-fail')&&path.startsWith('/v1/events'))))return{ok:false,error:'Mock requested data unavailable.'};
  if(method==='GET'&&scenario.has('pro-token-fail')&&path.startsWith('/v1/wallet?'))return{ok:false,error:'Mock token mint unavailable.'};
  if(method!=='GET'&&path.startsWith('/v2/')&&(request.expectedSession?.serverId!=='preview-server'||request.expectedSession.deviceId!=='preview-device'||request.expectedSession.wallet!==serverWallet))return{ok:false,error:'Reviewed mock wallet/session changed. Review again.'};
  if(method==='POST'&&path==='/v1/resume-engine'){if(proSigner!=='READY')return{ok:false,error:'Signer locked.'};proEngine='RUNNING';return{ok:true,data:{}};}
  if(method==='GET'&&path==='/v1/health')return{ok:true,data:{apiVersion:1,serverId:'preview-server',wallet:serverWallet,signer:proSigner,engine:proEngine,at:Date.now(),capabilities:scenario.get('pro')==='old-server'?[]:['mc-orders-v2','exit-strategies-v2','withdrawals-v1'],limits:{maxBuyLamports:'1000000000',dailyBuyLamports:'10000000000',maxNetworkLamports:'5000000'}} satisfies ProHealth};
  if(method==='GET'&&path.startsWith('/v1/wallet'))return{ok:true,data:[{mint:solMint,decimals:9,totalRaw:'1750000000',reservedRaw:'120000000',availableRaw:mockSolAvailable},{mint,decimals:6,totalRaw:'50000000000',reservedRaw:'12500000000',availableRaw:'37500000000'}]};
  if(method==='GET'&&/^\/v[12]\/orders$/.test(path))return mockOrderAckLost?{ok:false,error:'Mock connection lost; reload to reconcile the registered order.'}:{ok:true,data:structuredClone(proOrders)};
  if(method==='GET'&&path==='/v2/strategies')return{ok:true,data:structuredClone(proOrders.filter(order=>order.spec.kind==='STRATEGY'))};
  if(method==='GET'&&path.startsWith('/v1/events'))return{ok:true,data:structuredClone(proEvents.filter(event=>event.sequence>Number(new URL(path,'https://mock.invalid').searchParams.get('after')??0)))};
  if(method==='GET'&&path==='/v1/recipients')return{ok:true,data:[{id:'123e4567-e89b-42d3-a456-426614174101',version:1,name:'Saved wallet',address:wallet,active:true,createdAt:previewOpenedAt}]};
  if(method==='GET'&&path==='/v1/withdrawals')return{ok:true,data:[]};
  if(method==='POST'&&path==='/v1/withdrawals/preview'){
    const isSol=(request.body as {mint:string}).mint===solMint;
    const available=isSol?BigInt(mockSolAvailable):37500000000n,cost=isSol?5000n:0n;
    return{ok:true,data:{id:crypto.randomUUID(),spec:structuredClone(request.body),expiresAt:Date.now()+60000,totalRaw:isSol?String(available+120000000n):'50000000000',reservedRaw:isSol?'120000000':'12500000000',availableRaw:String(available),maxRaw:String(available>cost?available-cost:0n),feeLamports:'5000',rentLamports:'0'}};
  }
  if(method==='POST'&&path==='/v2/preview'){
    if(scenario.has('pro-preview-delayed'))await new Promise<void>(resolve=>{releaseProPreview=resolve;});
    try{
      const spec=validateProSpecV2((request.body as {spec:unknown}).spec),priceUsd='0.00042',supplyRaw='1000000000000000',tokenDecimals=6;
      const outputRaw=spec.side==='BUY'?(BigInt(spec.amountRaw)*120n*1000000n*100000n/(1000000000n*42n)).toString():(BigInt(spec.amountRaw)*42n*1000000000n/(100000n*120n*1000000n)).toString();
      return{ok:true,data:{spec,summary:{marketCapUsd:marketCapUsd(priceUsd,supplyRaw,tokenDecimals),priceUsd,supplyRaw,tokenDecimals,quoteAt:Date.now(),outputRaw,networkBudgetRaw:spec.maxNetworkLamports}}};
    }catch(error){return{ok:false,error:error instanceof Error?error.message:'Invalid mock order.'};}
  }
  if(method==='POST'&&/^\/v2\/(orders|strategies)$/.test(path)){
    const body=request.body as {orderId:string;spec:unknown};
    let order=proOrders.find(order=>order.id===body.orderId);
    if(!order){const spec=validateProSpecV2(body.spec);order={id:body.orderId,revision:1,spec,wallet:serverWallet,state:proEngine==='RUNNING'?'OPEN':'PAUSED',createdAt:Date.now(),updatedAt:Date.now(),currentMcUsd:'420000',...spec.steps?{strategy:{baseRaw:spec.amountRaw,remainingRaw:spec.amountRaw,steps:spec.steps.map(step=>({id:step.id,state:'OPEN' as const}))}}:{}};proOrders.unshift(order);publishPro();}
    document.body.dataset.proRegistered=order.id;
    if(scenario.has('pro-register-uncertain')){mockOrderAckLost=true;return{ok:false,error:'Mock acknowledgement lost. Check orders before retrying the same request.'};}
    return{ok:true,data:structuredClone(order)};
  }
  const action=/^\/v[12]\/(orders|strategies)\/([^/]+)\/(pause|resume|cancel|retry)$/.exec(path);
  if(method==='POST'&&action){let order=proOrders.find(order=>order.id===action[2]);const intent=action[3]==='retry'?(request.body as {action:string}).action:action[3];if(!order&&action[3]==='retry'&&intent==='cancel'){const original=(request.body as {spec:{expiresAt:number}}).spec;const spec=validateProSpecV2(original,original.expiresAt-1);order={id:action[2]!,revision:1,spec,wallet:serverWallet,state:'CANCELLED',createdAt:Date.now(),updatedAt:Date.now()};proOrders.push(order);}if(!order)return{ok:false,error:'Order not found.'};order.state=intent==='cancel'?'CANCELLED':intent==='pause'?'PAUSED':'OPEN';order.revision++;publishPro();return{ok:true,data:structuredClone(order)};}
  if(method==='PATCH'&&/^\/v2\/(orders|strategies)\//.test(path)){const order=proOrders.find(order=>order.id===path.split('/').pop());if(!order)return{ok:false,error:'Order not found.'};order.spec=validateProSpecV2((request.body as {spec:unknown}).spec);order.revision++;publishPro();return{ok:true,data:structuredClone(order)};}
  return{ok:false,error:'Unsupported mock Pro endpoint.'};
}
async function send(request: WorkerRequest) {
  requests.push(request);
  if(request.type==='PRO')return sendMockPro(request);
  if (request.type === 'HISTORY' && scenario.has('empty-history')) return { ok: true, receipts: [] };
  if (['CONNECT', 'WALLET_RESTORE'].includes(request.type) && scenario.has('wallet-error')) return { ok: false, error: 'Phantom connection was rejected. Connect Phantom to try again.' };
  if (request.type === 'TOKEN_INFO' && scenario.has('metadata-error')) return { ok: false, error: 'Token information is unavailable. Reload the supported token page.' };
  if(request.type==='PORTFOLIO'||request.type==='PORTFOLIO_PRICES'){
    if(request.type==='PORTFOLIO'){document.body.dataset.portfolioReads=String(++portfolioReads);balanceAt=Date.now();}else document.body.dataset.priceReads=String(++priceReads);
    if(new URL(location.href).searchParams.has('balance-error'))return {ok:true,portfolio:{wallet:request.wallet,updatedAt:0,holdings:[],balanceError:'Balance service temporarily unavailable. Retrying automatically.'}};
    const result={ok:true,portfolio:{wallet:request.wallet,updatedAt:balanceAt,holdings:new URL(location.href).searchParams.has('holdings')?[{mint,symbol:'SI',pageUrl:target.pageUrl,position:{wallet:request.wallet,mint,balanceRaw:'500000000000',openedAt:previewOpenedAt,decimals:6,supplyRaw:'1000000000000000',updatedAt:Date.now(),costBasisUsdMicros:'4851987400',costBasisSolLamports:'40433228333',expectedExitLamports:mockQuote,exitNetworkLamports:'105000',exitSetupLamports:'0',solUsd:{priceMicros:'120000000',capturedAt:Date.now(),source:'Coinbase spot' as const}}},{mint:'7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump',symbol:'[cat]',pageUrl:'https://fomo.family/tokens/solana/7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump',position:{wallet:request.wallet,mint:'7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump',balanceRaw:'125000000',openedAt:previewCatOpenedAt,decimals:6,supplyRaw:'1000000000000',updatedAt:Date.now(),costBasisUsdMicros:'20000000',costBasisSolLamports:'166666666',expectedExitLamports:'125000000',exitNetworkLamports:'105000',solUsd:{priceMicros:'120000000',capturedAt:Date.now(),source:'Coinbase spot' as const}}}]:[]}};
    for(const holding of result.portfolio.holdings){Object.assign(holding,{priceMode:mockMode,priceUpdatedAt:Date.now()});(holding.position as import('../src/model').PositionSnapshot).balanceUpdatedAt=balanceAt;}
    if(scenario.has('basis-estimated'))for(const holding of result.portfolio.holdings){if(holding.mint===mint){holding.symbol='QI';const position=holding.position as import('../src/model').PositionSnapshot;position.costBasisEstimated=true;position.warning='Trade-history estimate: LP/transfer gains and losses are not included.';}}
    if(!previewPricesReady)for(const holding of result.portfolio.holdings){delete (holding.position as import('../src/model').PositionSnapshot).expectedExitLamports;delete (holding.position as import('../src/model').PositionSnapshot).solUsd;(holding as import('../src/model').PortfolioHolding).pricingPending=true;}
    return result;
  }
  if(request.type==='OPEN_DASHBOARD'){document.body.dataset.detailsRequested='true';return {ok:true};}
  if(request.type==='HISTORY')return {ok:true,receipts:['30000000','45000000','550000000'].map((usd,index)=>({signature:String(5+index).repeat(88),wallet,mint,symbol:'SI',side:index===1?'SELL':'BUY',venue:'PUMP_CURVE',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:historyAt-(2-index)*86400000,status:receiptStatus==='FAILED'&&index===1?'FAILED':'CONFIRMED',error:receiptStatus==='FAILED'&&index===1?'Slippage limit exceeded: ExceededSlippage':undefined,diagnostic:receiptStatus==='FAILED'&&index===1?{stage:'CHAIN',code:6004,error:'InstructionError: Custom 6004',logs:['Error Code: ExceededSlippage. Error Message: ExceededSlippage.']}:undefined,inputAmount:'250000000',feeReceipt:{...feeDemo,blockTime:Math.floor(historyAt/1000)-(2-index)*86400,executionSucceeded:!(receiptStatus==='FAILED'&&index===1),protocolFees:receiptStatus==='FAILED'&&index===1?[]:feeDemo.protocolFees,volumeLamports:receiptStatus==='FAILED'&&index===1?undefined:feeDemo.volumeLamports,volumeUsdMicros:receiptStatus==='FAILED'&&index===1?undefined:usd}})),savings:{volumeUsdMicros:'625000000',savedUsdMicros:'6250000',verifiedTrades:3,pricedTrades:3,unpricedTrades:0,benchmarkBps:100}};
  if(request.type==='POSITION'&&scenario.has('chart-entry')){
    const updatedAt=Date.now()-(scenario.get('chart-entry')==='expired'?31000:scenario.get('chart-entry')==='limited'?15000:0);
    return {ok:true,position:{wallet,mint,balanceRaw:'500000000000',openedAt:previewOpenedAt,decimals:6,supplyRaw:'1000000000000000',updatedAt:Date.now(),costBasisUsdMicros:'4851987400',expectedExitLamports:'41458333333',exitNetworkLamports:'105000',exitSetupLamports:'0',solUsd:{priceMicros:'120000000',capturedAt:Date.now(),source:'Coinbase spot'},chartEntry:scenario.get('chart-entry')==='denied'?undefined:{wallet,mint,balanceRaw:'500000000000',supplyRaw:'1000000000000000',decimals:6,priceUsd:'0.010000000000',marketCapUsd:'10000000.000000000000',updatedAt,validUntil:updatedAt+30000},chartEntryNote:scenario.get('chart-entry')==='denied'?'Avg entry unavailable: RPC inventory access denied (403). Check RPC access in Settings.':scenario.get('chart-entry')==='limited'?'Avg entry verification delayed: RPC rate limit (429). Last verified value shown.':undefined}};
  }
  if(request.type==='POSITION')return {ok:true,position:{wallet,mint,balanceRaw:new URL(location.href).searchParams.has('position')?'500000000000':'0',openedAt:previewOpenedAt,decimals:6,supplyRaw:'1000000000000000',updatedAt:Date.now(),costBasisUsdMicros:'4851987400',expectedExitLamports:marketPrice==='0.02'?'82916666666':'41458333333',exitNetworkLamports:'105000',exitSetupLamports:'0',solUsd:{priceMicros:'120000000',capturedAt:Date.now(),source:'Coinbase spot'},market:{mint,observedAt:Date.now(),priceUsd:marketPrice,source:marketSource()}}};
  if(request.type==='SAVINGS')return {ok:true,savings:{volumeUsdMicros:'625000000',savedUsdMicros:'6250000',verifiedTrades:3,pricedTrades:3,unpricedTrades:0,benchmarkBps:100}};
  if(request.type==='STATUS' && new URL(location.href).searchParams.has('receipt'))return {ok:true,receipt:{signature:receiptStatus==='SIGNING'||receiptStatus==='UNKNOWN'?undefined:'5'.repeat(88),wallet,mint,side:'BUY',venue:'PUMP_CURVE',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:receiptStatus,error:receiptStatus==='FAILED'?'Slippage limit exceeded: ExceededSlippage':undefined,diagnostic:receiptStatus==='FAILED'?{stage:'CHAIN',code:6004,program:'PumpSwap',error:'InstructionError: Custom 6004',logs:['Error Code: ExceededSlippage. Error Message: Slippage limit exceeded.']}:undefined,inputAmount:'250000000',feeReceipt:receiptStatus==='CONFIRMED'?new URL(location.href).searchParams.has('fees-pending')?{...feeDemo,state:'PENDING'}:feeDemo:undefined} satisfies Receipt};
  if(request.type==='VERIFY_FEES'){document.body.dataset.verifyRequested='true';return {ok:true,receipt:{signature:request.signature,wallet,mint,side:'BUY',venue:'PUMP_CURVE',pageUrl:target.pageUrl,message:'',blockhash:'',lastValidBlockHeight:1,createdAt:Date.now(),status:'CONFIRMED',inputAmount:'250000000',feeReceipt:feeDemo} satisfies Receipt};}

  if (request.type === 'SETTINGS_GET') return { ok: true, settings };
  if (request.type === 'SETTINGS_SAVE') { settings = request.settings; return { ok: true }; }
  if (request.type === 'SETTINGS_PUBLIC') return { ok: true, publicSettings: settings };
  if (request.type === 'RPC_TEST') return new URL(location.href).searchParams.has('rpc-error')?{ok:false,error:'RPC endpoint unavailable. Check the URL or try another endpoint.'}:{ok:true};
  if (request.type === 'OPEN_SETTINGS') { document.body.dataset.settingsOpened = 'true'; return { ok: true }; }
  if (request.type === 'TOKEN_INFO') return { ok: true, token: { mint, symbol: scenario.has('long-token') ? 'VERYLONGTOKENNAMEWITHNOSPACES' : 'SI', venue: new URL(location.href).searchParams.has('router') ? 'JUPITER' : 'PUMP_CURVE', quoteSymbol: new URL(location.href).searchParams.has('router') ? 'WBTC' : 'SOL', quoteMint: new URL(location.href).searchParams.has('router') ? '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh' : 'So11111111111111111111111111111111111111112' } };
  if (request.type === 'WALLET_SWITCH') wallet = '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
  if (['WALLET_SWITCH', 'CONNECT', 'WALLET_RESTORE'].includes(request.type)) return { ok: true, wallet };
  if (request.type === 'TRADE') { if(request.intent.side==='BUY'&&'sol' in request.intent){try{parseSol(request.intent.sol);}catch(error){return {ok:false,error:error instanceof Error?error.message:'Invalid amount'};}} document.body.dataset.tradeRequested = 'true'; document.body.dataset.tradeIntent = JSON.stringify(request.intent); return { ok: false, error: scenario.has('insufficient') ? 'Insufficient SOL for this order and network fees.' : scenario.has('error')?'Add a Jupiter API key in Settings for automatic SOL routing. Direct SOL pairs need no key.':'Mock only: no real trade was sent.' }; }
  return { ok: true };
}
Object.assign(globalThis, { chrome: {
  runtime: { id: 'preview', getURL:(path:string)=>`chrome-extension://preview${path}`,getManifest: () => ({ version: new URL(location.href).searchParams.has('baseline')?'0.7.5':'0.7.9' }), sendMessage: send, onMessage,connect:({name}:{name:string})=>{const port={name,onMessage:mockEvent(),onDisconnect:mockEvent(),postMessage:(_message:unknown)=>{},disconnect(){const index=proPorts.indexOf(port);if(index>=0)proPorts.splice(index,1);port.onDisconnect.emit();}};proPorts.push(port);return port;} },
  storage:{onChanged:onStorage,local:{get:async()=>({...mockStored,proSettings:{...proSettings}}),set:async(value:Record<string,unknown>&{proSettings?:ProSettings})=>{if(value.proSettings)changeProSettings(value.proSettings);for(const [key,data]of Object.entries(value))if(key!=='proSettings')mockStored[key]=data;localStorage.setItem('dp-pro-mock-storage',JSON.stringify(mockStored));},remove:async(keys:string|string[])=>{for(const key of Array.isArray(keys)?keys:[keys])delete mockStored[key];localStorage.setItem('dp-pro-mock-storage',JSON.stringify(mockStored));}}},
  sidePanel:{open:async()=>{document.body.dataset.sidePanelOpened='true';}},
  permissions: { request: async () => !scenario.has('permissions-denied') },
  tabs: {
    create:async()=>{document.body.dataset.createdTabs=String(Number(document.body.dataset.createdTabs??0)+1);},
    update:async (_tab:number,properties:{url:string})=>{document.body.dataset.openedToken=properties.url;},
    onActivated, onUpdated,
    query: async () => [{ id: 1, url: scenario.get('tab-url') ?? target.pageUrl }],
    sendMessage: async (_tab: number, message: { type: string; request: WorkerRequest }) => message.type === 'PANEL_CONTEXT' ? { target: new URL(location.href).searchParams.has('empty') ? null : target, market:{mint,observedAt:Date.now(),priceUsd:marketPrice,...scenario.has('pro')?{marketCapUsd:'420000'}:{},source:marketSource()} } : message.type === 'PANEL_REQUEST' ? send(message.request) : { ok: true },
  },
} });

Object.assign(globalThis,{changeMockProWallet:(address:string)=>{serverWallet=address;publishPro();},unpairMockPro:()=>{changeProSettings({...proSettings,serverUrl:'',serverId:undefined,deviceId:undefined});publishPro();},releaseMockProPreview:()=>{releaseProPreview?.();releaseProPreview=undefined;},recoverMockProData:()=>{for(const key of ['pro-balance-fail','pro-events-fail','pro-token-fail'])scenario.delete(key);publishPro();},pushMockProBalance:(raw:string)=>{mockSolAvailable=raw;publishPro();},changeMockMarketPrice:(price:string)=>{marketPrice=price;},releaseMockPrices:()=>{previewPricesReady=true;onMessage.emit({type:'PORTFOLIO_UPDATED',wallet},{id:'preview'});},pushMockPrice:(quote:string,mode:import('../src/model').PriceMode='LIVE')=>{mockQuote=quote;mockMode=mode;onMessage.emit({type:'PORTFOLIO_UPDATED',wallet},{id:'preview'});}});
Object.assign(globalThis,{changeMockProWallet:(next:string)=>{serverWallet=next;publishPro();}});
