import { Connection, PublicKey } from '@solana/web3.js';
import type { Browser } from 'wxt/browser';
import type { Settings, WorkerRequest, WorkerResponse, PositionSnapshot, Receipt, PortfolioSnapshot, PortfolioHolding } from '../model';
import { targetKey } from '../sites/catalog';
import { readPosition,positionDisplayRoute } from '../portfolio/position';
import { tokenSymbol, cleanSymbol } from '../token-metadata';
import { readTokenInfo } from '../token-info';
import { readSavings, unauditedReceipts, allReceipts, cacheReceiptSymbol } from '../ledger';
import type { createOrders, FrameFor } from './orders';
import {isDustHolding,visiblePortfolio} from '../portfolio/portfolio';
import { readPortfolioBalances, type BalanceCache, type TrackedBalance } from '../portfolio/portfolio-balances';
import { isPending } from '../receipts/receipts';
import { userFacingError } from '../errors';
import {logEvent} from '../diagnostics/diagnostics';
import {createPriceQuotes,priceQuoteKey,mergePrice,withCurrentUsd} from './price-quotes';
import {currentSolUsd,solUsdSnapshot,solUsdRetryAt} from '../usd-price';
import {createPriceStream,DEFAULT_PRICE_WS} from './price-stream';
import {priceAccounts} from './price-accounts';
import {createChartEntryCache} from '../chart/chart-entry-cache';

type PositionJob = { wallet: string; at: number; pending: boolean; refresh?:boolean; binding?:string; snapshot?:PositionSnapshot;job: Promise<PositionSnapshot> };

type PriceSource={target:string;accounts:string[];pending:boolean;at:number;slot?:number;abort?:AbortController};
type PortfolioJob = { wallet: string; key:string; config:string; settings:Settings; rows:TrackedBalance[]; balanceCache:BalanceCache; orders:ReturnType<typeof createOrders>; sources:Map<string,PriceSource>; slowPrices:Set<string>; attempted:Map<string,number>; revision: number; nextAt: number; failures: number; minSlot?:number; snapshot?: PortfolioSnapshot; pending?: Promise<PortfolioSnapshot> };

export function createQueries(loadSettings: () => Promise<Settings>, frameFor: FrameFor, onPortfolioUpdate: (wallet: string) => void = () => {}) {
  const confirmedPositions = new Map<string, PositionJob>();
  const chartEntries=createChartEntryCache();
  const portfolios = new Map<string, PortfolioJob>();
  const symbols = new Map<string, {until: number; job: Promise<string | undefined>}>();
  async function receiptSymbols(rows: Receipt[]): Promise<Receipt[]> {
    const missing=[...new Set(rows.filter(row=>!row.symbol).map(row=>row.mint))];
    if(!missing.length)return rows;
    let settings:Settings;
    try {settings=await loadSettings();} catch {return rows;}
    const rpc=quotes.connection(settings.rpcUrl);
    const resolved=new Map<string,string>();
    await Promise.all(missing.map(async mint=>{
      const key=JSON.stringify([settings.rpcUrl,mint]);let entry=symbols.get(key);
      if(!entry||entry.until<Date.now()){
        let timer:ReturnType<typeof setTimeout>;
        const deadline=new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),3_000);});
        const job=Promise.race([Promise.resolve().then(()=>tokenSymbol(rpc,new PublicKey(mint))).catch(()=>undefined),deadline]).then(value=>value?cleanSymbol(value):undefined).finally(()=>clearTimeout(timer));
        entry={until:Date.now()+60_000,job};symbols.set(key,entry);
        if(symbols.size>200)symbols.delete(symbols.keys().next().value!);
      }
      const symbol=await entry.job;if(symbol)resolved.set(mint,symbol);
    }));
    return Promise.all(rows.map(async row=>{
      const symbol=row.symbol??resolved.get(row.mint);if(!symbol)return row;
      if(!row.symbol)try{await cacheReceiptSymbol(row,symbol);}catch{/* Metadata cannot hide confirmed history when local caching fails. */}
      return {...row,symbol};
    }));
  }
  const quotes=createPriceQuotes((key,price)=>{void publishPrice(key,price).catch(()=>{});});
  let usdPending=false;
  const viewers=new Map<object,{wallet:string;mint?:string}>();
  let activeConfig='',stream:ReturnType<typeof createPriceStream>|undefined,streamEndpoint='';
  let watchTimer:ReturnType<typeof setInterval>|undefined;
  const configKey=(settings:Settings)=>JSON.stringify([settings.rpcUrl,settings.priorityFeeLamports,settings.slippageBps,settings.jupiterApiKey,settings.priceWsUrl??'']);
  const watched=(entry:PortfolioJob,mint:string)=>entry.config===activeConfig&&!entry.slowPrices.has(mint)&&!isDustHolding(entry.snapshot?.holdings.find(holding=>holding.mint===mint))&&[...viewers.values()].some(view=>view.wallet===entry.wallet&&(!view.mint||view.mint===mint));
  const notify=(wallet:string)=>{try{onPortfolioUpdate(wallet);}catch{/* Notifications never affect trading. */}};
  const mode=(entry:PortfolioJob,mint:string)=>{const source=entry.sources.get(mint);return source?.accounts.length&&source.accounts.every(address=>stream?.hasLive(address))?'LIVE' as const:'POLLING' as const;};
  function streamState(){
    for(const entry of portfolios.values()){
      let changed=false;
      for(const holding of entry.snapshot?.holdings??[])if(watched(entry,holding.mint)&&holding.priceMode!=='STALE'){
        const next=mode(entry,holding.mint);if(next!==holding.priceMode){holding.priceMode=next;changed=true;}
      }
      if(changed)notify(entry.wallet);
    }
  }
  function syncStream(){
    const addresses=new Set<string>();
    for(const entry of portfolios.values())for(const [mint,source]of entry.sources)if(watched(entry,mint))for(const address of source.accounts)addresses.add(address);
    stream?.update([...addresses]);
  }
  function bindSources(entry:PortfolioJob){
    for(const row of entry.rows){
      const holding=row.holding,mint=holding.mint;
      if(!holding.position||!row.quoteReady||!watched(entry,mint))continue;
      const target=targetKey(row.target),prior=entry.sources.get(mint);
      const known=quotes.accounts(entry.settings,row.target,holding.position);
      if(known){
        if(prior?.target!==target||JSON.stringify(prior.accounts)!==JSON.stringify(known)){
          prior?.abort?.abort();entry.sources.set(mint,{target,accounts:known,pending:false,at:Date.now(),slot:prior?.target===target?prior.slot:undefined});syncStream();streamState();
        }
        continue;
      }
      if(prior?.target===target&&(prior.pending||Date.now()-prior.at<60_000))continue;
      const source:PriceSource={target,accounts:prior?.target===target?prior.accounts:[],slot:prior?.target===target?prior.slot:undefined,pending:true,at:Date.now()},revision=entry.revision;entry.sources.set(mint,source);
      const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8000);source.abort=abort;
      const rpc=quotes.connection(entry.settings.rpcUrl,0,abort.signal);
      void priceAccounts(rpc,row.target,mint).then(accounts=>{
        if(revision===entry.revision&&entry.sources.get(mint)===source)source.accounts=accounts;
      }).catch(error=>{if(!abort.signal.aborted)logEvent({level:'warn',component:'prices',type:'source.failed',details:{mint,error:userFacingError(error)}});}).finally(()=>{clearTimeout(timer);source.pending=false;if(entry.sources.get(mint)===source){syncStream();streamState();}});
    }
  }
  async function publishPrice(key:string,priced:PositionSnapshot){
    for(const entry of portfolios.values()){
      const revision=entry.revision;
      if(entry.orders.isBusy(entry.wallet)||isPending(await entry.orders.loadReceipt(entry.wallet))||entry.revision!==revision)continue;
      const row=entry.rows.find(row=>row.holding.position&&priceQuoteKey(entry.settings,row.target,row.holding.position)===key);
      const current=row&&entry.snapshot?.holdings.find(holding=>holding.mint===row.holding.mint);
      if(!current?.position||current.position.balanceRaw!==priced.balanceRaw)continue;
      current.position=withCurrentUsd(mergePrice(current.position,priced));
      current.priceMode=priced.quoteIssue?'STALE':mode(entry,current.mint);
      current.priceUpdatedAt=priced.expectedExitLamports!==undefined?priced.updatedAt:current.priceUpdatedAt;
      current.pricingPending=false;
      if(!priced.quoteIssue&&current.position.solUsd){if(isDustHolding(current))entry.slowPrices.add(current.mint);else entry.slowPrices.delete(current.mint);}
      if(!priced.quoteIssue&&entry.slowPrices.has(current.mint)){entry.sources.get(current.mint)?.abort?.abort();entry.sources.delete(current.mint);syncStream();}
      else if(!priced.quoteIssue&&priced.pricePool&&entry.sources.get(current.mint)?.accounts[0]!==priced.pricePool){entry.sources.delete(current.mint);bindSources(entry);syncStream();}
      notify(entry.wallet);
    }
  }
  async function updateUsd(){
    if(usdPending)return;
    const needed=[...portfolios.values()].some(entry=>entry.config===activeConfig&&entry.snapshot?.holdings.some(holding=>holding.position?.expectedExitLamports!==undefined&&[...viewers.values()].some(view=>view.wallet===entry.wallet)));
    if(!needed)return;
    const current=currentSolUsd();
    if(!current&&Date.now()<solUsdRetryAt())return;
    usdPending=true;
    try{
      await solUsdSnapshot(Math.floor(Date.now()/1000));
      for(const entry of portfolios.values()){
        let changed=false;
        for(const holding of entry.snapshot?.holdings??[])if(holding.position?.expectedExitLamports!==undefined){
          const next=withCurrentUsd(holding.position);
          if(next.solUsd?.capturedAt!==holding.position.solUsd?.capturedAt||next.usdIssue?.retryAt!==holding.position.usdIssue?.retryAt||!!next.usdIssue!==!!holding.position.usdIssue){holding.position=next;changed=true;}
        }
        if(changed)notify(entry.wallet);
      }
    }finally{usdPending=false;}
  }
  function enqueuePrice(entry:PortfolioJob,row:TrackedBalance,slot=0){
    const mint=row.holding.mint,base=entry.snapshot?.holdings.find(holding=>holding.mint===mint)?.position;
    if(!base||!row.quoteReady)return;
    slot=Math.max(slot,entry.minSlot??0,entry.sources.get(mint)?.slot??0);
    const key=priceQuoteKey(entry.settings,row.target,base);
    if(Date.now()<quotes.retryAt(key))return;
    entry.attempted.set(mint,Date.now());
    const holding=entry.snapshot?.holdings.find(holding=>holding.mint===mint);if(holding)holding.pricingPending=true;
    void quotes.request(entry.settings,row.target,base,{refresh:true,slot,quoteReady:row.quoteReady,blocked:async()=>entry.orders.isBusy(entry.wallet)||isPending(await entry.orders.loadReceipt(entry.wallet))})
      .then(priced=>{if(holding&&entry.snapshot?.holdings.includes(holding))holding.pricingPending=false;void updateUsd();})
      .catch(()=>{if(holding&&entry.snapshot?.holdings.includes(holding))holding.pricingPending=false;});
  }
  function tickPrices(){
    for(const entry of portfolios.values()){
      bindSources(entry);
      for(const row of entry.rows)if(entry.config===activeConfig&&[...viewers.values()].some(view=>view.wallet===entry.wallet&&(!view.mint||view.mint===row.holding.mint))){
        const current=entry.snapshot?.holdings.find(holding=>holding.mint===row.holding.mint);
        const unknown=current?.position?.expectedExitLamports===undefined||!!current.position.quoteIssue;
        const interval=entry.slowPrices.has(row.holding.mint)||isDustHolding(current??row.holding)?60_000:unknown?1000:mode(entry,row.holding.mint)==='LIVE'?15_000:3_000;
        if(Date.now()-(entry.attempted.get(row.holding.mint)??0)>=interval)enqueuePrice(entry,row);
      }
    }
    void updateUsd();
  }
  async function watchPrices(client:object,wallet:string|undefined,mint?:string){
    if(wallet){new PublicKey(wallet);if(mint)new PublicKey(mint);viewers.set(client,{wallet,mint});}else viewers.delete(client);
    for(const entry of portfolios.values())for(const row of entry.rows)if(![...viewers.values()].some(view=>view.wallet===entry.wallet&&(!view.mint||view.mint===row.holding.mint))){if(row.holding.position)quotes.cancelKey(priceQuoteKey(entry.settings,row.target,row.holding.position));entry.attempted.delete(row.holding.mint);entry.sources.get(row.holding.mint)?.abort?.abort();entry.sources.delete(row.holding.mint);const holding=entry.snapshot?.holdings.find(holding=>holding.mint===row.holding.mint);if(holding){holding.pricingPending=false;if(holding.priceMode!=='STALE')holding.priceMode='POLLING';}}
    if(!viewers.size){if(watchTimer!==undefined)clearInterval(watchTimer);watchTimer=undefined;stream?.destroy();stream=undefined;streamEndpoint='';return;}
    const settings=await loadSettings();if(!viewers.size)return;
    activeConfig=configKey(settings);const endpoint=settings.priceWsUrl||DEFAULT_PRICE_WS;
    if(!stream||endpoint!==streamEndpoint){
      stream?.destroy();streamEndpoint=endpoint;
      stream=createPriceStream(endpoint,(address,slot,value,changed=true)=>{
        const observed=new Set<string>();
        for(const entry of portfolios.values())for(const row of entry.rows)if(watched(entry,row.holding.mint)&&entry.sources.get(row.holding.mint)?.accounts.includes(address)){
          const source=entry.sources.get(row.holding.mint)!;source.slot=Math.max(source.slot??0,slot);
          if(!observed.has(entry.settings.rpcUrl)){
            if(value===undefined||!quotes.observe(entry.settings.rpcUrl,endpoint,address,slot,value))quotes.invalidate(entry.settings.rpcUrl,[address]);
            observed.add(entry.settings.rpcUrl);
          }
          if(changed)enqueuePrice(entry,row,slot);
        }
      },streamState);
    }
    if(watchTimer===undefined)watchTimer=setInterval(tickPrices,1000);
    for(const entry of portfolios.values())bindSources(entry);syncStream();tickPrices();
  }
  function invalidatePositions(wallet:string){
    for(const [key,entry]of confirmedPositions)if(entry.wallet===wallet)confirmedPositions.delete(key);
    quotes.cancelWallet(wallet);
    chartEntries.invalidateWallet(wallet);
    for(const entry of portfolios.values())if(entry.wallet===wallet){
      entry.revision++;entry.nextAt=0;entry.pending=undefined;entry.attempted.clear();for(const source of entry.sources.values())source.abort?.abort();entry.sources.clear();entry.slowPrices.clear();entry.rows=[];entry.balanceCache=new Map();

    }
    syncStream();
  }
  function pricePortfolio(entry:PortfolioJob,rows:TrackedBalance[],receipts:Receipt[]){
    bindSources(entry);
    const missing=receipts.filter(receipt=>rows.some(row=>row.holding.mint===receipt.mint&&!row.holding.symbol));
    if(missing.length){const revision=entry.revision;void receiptSymbols(missing).then(symbols=>{if(revision!==entry.revision)return;for(const holding of entry.snapshot?.holdings??[])holding.symbol??=symbols.find(row=>row.mint===holding.mint&&row.symbol)?.symbol;notify(entry.wallet);}).catch(()=>{});}
    for(const row of rows){
      const current=entry.snapshot?.holdings.find(holding=>holding.mint===row.holding.mint);
      const interval=entry.slowPrices.has(row.holding.mint)||isDustHolding(current??row.holding)?60_000:current?.position?.quoteIssue||current?.position?.expectedExitLamports===undefined?1000:15_000;
      if(!entry.attempted.has(row.holding.mint)||Date.now()-entry.attempted.get(row.holding.mint)!>=interval)enqueuePrice(entry,row);
    }
    syncStream();
  }
  async function portfolio(request: Extract<WorkerRequest, {type: 'PORTFOLIO'}>, orders: ReturnType<typeof createOrders>): Promise<WorkerResponse> {
    const wallet=new PublicKey(request.wallet);
    if(orders.isBusy(request.wallet)||isPending(await orders.loadReceipt(request.wallet)))throw new Error('Holdings update automatically after the active trade.');
    const settings=await loadSettings(),config=configKey(settings),key=`${request.wallet}:${config}`;
    let entry=portfolios.get(key);
    if(!entry){entry={wallet:request.wallet,key,config,settings,rows:[],balanceCache:new Map(),orders,sources:new Map(),slowPrices:new Set(),attempted:new Map(),revision:0,nextAt:0,failures:0};portfolios.set(key,entry);}
    if(entry.pending)return {ok:true,portfolio:visiblePortfolio(await entry.pending)};
    if(!request.refresh&&entry.snapshot&&Date.now()<entry.nextAt)return {ok:true,portfolio:visiblePortfolio(entry.snapshot)};
    const active=entry,revision=entry.revision;
    const job=(async():Promise<PortfolioSnapshot>=>{
      try{
        const receipts=await allReceipts(request.wallet),latest=await orders.loadReceipt(request.wallet);
        const minSlot=latest?.status==='CONFIRMED'?latest.confirmedSlot??latest.feeReceipt?.slot:undefined;
        const rpc=quotes.connection(settings.rpcUrl,minSlot);
        const rows=await readPortfolioBalances(rpc,wallet,receipts,minSlot,{cache:active.balanceCache,slowMints:new Set(active.snapshot?.holdings.filter(isDustHolding).map(holding=>holding.mint)),refresh:request.refresh});
        if(revision!==active.revision||orders.isBusy(request.wallet)||isPending(await orders.loadReceipt(request.wallet)))throw new Error('Holdings changed during the read. Retrying automatically.');
        if(rows.length&&rows.every(row=>!row.holding.position))throw new Error(rows[0]!.holding.error??'Balance data is unavailable.');
        const previous=new Map(active.snapshot?.holdings.map(holding=>[holding.mint,holding]));
        const holdings=rows.map(({holding,quoteReady})=>{
          const old=previous.get(holding.mint);
          if(holding.position&&old?.position&&quoteReady&&old.position.balanceRaw===holding.position.balanceRaw){
            holding.position={...old.position,...holding.position,updatedAt:old.position.updatedAt,expectedExitLamports:old.position.expectedExitLamports,exitNetworkLamports:old.position.exitNetworkLamports,exitSetupLamports:old.position.exitSetupLamports,solUsd:old.position.solUsd,warning:holding.position.warning};
            holding.symbol??=old.symbol;holding.pricingPending=old.pricingPending;holding.priceMode=old.priceMode;holding.priceUpdatedAt=old.priceUpdatedAt;
          }else if(holding.position){active.attempted.delete(holding.mint);active.slowPrices.delete(holding.mint);active.sources.get(holding.mint)?.abort?.abort();active.sources.delete(holding.mint);if(old?.position){const prior=active.rows.find(row=>row.holding.mint===holding.mint);if(prior)quotes.cancelKey(priceQuoteKey(active.settings,prior.target,old.position));}holding.pricingPending=quoteReady;}
          return holding;
        });
        active.failures=0;active.nextAt=Date.now()+5_000;
        active.snapshot={wallet:request.wallet,updatedAt:Date.now(),holdings,nextRefreshAt:active.nextAt};
        const previousRows=active.rows;active.rows=rows;active.minSlot=minSlot;
        if(request.refresh)active.attempted.clear();
        const retained=new Set(rows.map(row=>row.holding.mint));
        for(const removed of previousRows)if(!retained.has(removed.holding.mint)&&removed.holding.position)quotes.cancelKey(priceQuoteKey(active.settings,removed.target,removed.holding.position));
        for(const mint of active.sources.keys())if(!retained.has(mint)){active.sources.get(mint)?.abort?.abort();active.sources.delete(mint);active.slowPrices.delete(mint);}
        pricePortfolio(active,rows,receipts);
        return active.snapshot;
      }catch(error){
        if(revision!==active.revision)throw error;
        active.failures++;active.nextAt=Date.now()+Math.min(30_000,5_000*2**Math.min(active.failures-1,3));
        active.snapshot={wallet:request.wallet,updatedAt:active.snapshot?.updatedAt??0,holdings:active.snapshot?.holdings??[],balanceError:userFacingError(error),nextRefreshAt:active.nextAt};
        return active.snapshot;
      }
    })();
    active.pending=job;
    void job.finally(()=>{if(revision===active.revision)active.pending=undefined;}).catch(()=>{});
    return {ok:true,portfolio:visiblePortfolio(await job)};
  }
  async function position(request: Extract<WorkerRequest, {type: 'POSITION'}>, sender: Browser.runtime.MessageSender, orders: ReturnType<typeof createOrders>): Promise<WorkerResponse> {
    await frameFor(sender, request);
    const wallet = new PublicKey(request.wallet);
    if (orders.isBusy(request.wallet)) throw new Error('Position updates resume after the active trade.');
    const settings = await loadSettings();
    const key = JSON.stringify([request.wallet, targetKey(request.target), settings.rpcUrl, settings.priorityFeeLamports, settings.slippageBps, settings.jupiterApiKey]);
    const scope=JSON.stringify([settings.rpcUrl,targetKey(request.target)]);
    let confirmed=confirmedPositions.get(key);
    if(!confirmed||request.refresh&&!(confirmed.pending&&confirmed.refresh)||!confirmed.pending&&Date.now()-confirmed.at>=1000){
      const route=confirmed?.snapshot?positionDisplayRoute(confirmed.snapshot,request.target):undefined;
      let owned!:PositionJob;
      const job=(async()=>{
        const receipt=await orders.loadReceipt(request.wallet);
        const blocked=orders.isBusy(request.wallet)||isPending(receipt),minContextSlot=receipt?.status==='CONFIRMED'?receipt.confirmedSlot??receipt.feeReceipt?.slot:undefined;
        if(blocked)chartEntries.invalidateWallet(request.wallet);
        const holdings=portfolios.get(`${request.wallet}:${configKey(settings)}`);
        const expectedMint=request.target.kind==='MINT'?request.target.address:request.target.mintHint;
        const row=!holdings?.pending&&!holdings?.snapshot?.balanceError?holdings?.rows.find(row=>row.holding.mint===expectedMint):undefined;
        const balance=row?.holding.position&&row.balanceSlot!==undefined?{position:row.holding.position,slot:row.balanceSlot,quoteReady:row.quoteReady}:undefined;
        const snapshot=await readPosition(quotes.connection(settings.rpcUrl,minContextSlot),request.target,wallet,settings,request.market,true,minContextSlot,undefined,
          {cache:chartEntries,scope,balance,blocked,route});
        if(confirmedPositions.get(key)!==owned)throw new Error('Position changed during the read. Read again.');
        return snapshot;
      })();
      owned={wallet:request.wallet,at:Date.now(),pending:true,refresh:request.refresh,job};
      confirmed=owned;confirmedPositions.set(key,owned);
      void job.then(snapshot=>{if(confirmedPositions.get(key)===owned){owned.snapshot=snapshot;owned.pending=false;owned.at=Date.now();}},()=>{if(confirmedPositions.get(key)===owned)confirmedPositions.delete(key);});
    }
    const base=await confirmed.job;
    if(confirmedPositions.get(key)!==confirmed)throw new Error('Position changed during the read. Read again.');
    const attachEntry=async(snapshot:PositionSnapshot):Promise<PositionSnapshot>=>{
      const receipt=await orders.loadReceipt(request.wallet);
      if(orders.isBusy(request.wallet)||isPending(receipt)){chartEntries.invalidateWallet(request.wallet);return {...snapshot,chartEntry:undefined,chartEntryNote:'Avg entry unavailable: a wallet transaction is unresolved.'};}
      const projection=chartEntries.current(scope,snapshot);
      return {...snapshot,chartEntry:projection.entry,chartEntryNote:projection.note};
    };
    if(request.holdingsOnly||base.balanceRaw==='0')return {ok:true,position:await attachEntry(base)};
    const quoteKey=priceQuoteKey(settings,request.target,base);
    const receipt=await orders.loadReceipt(request.wallet);
    const minSlot=receipt?.status==='CONFIRMED'?receipt.confirmedSlot??receipt.feeReceipt?.slot:undefined;
    const priced=await quotes.request(settings,request.target,base,{refresh:request.refresh,slot:minSlot,blocked:async()=>orders.isBusy(request.wallet)||isPending(await orders.loadReceipt(request.wallet))});
    await solUsdSnapshot(Math.floor(Date.now()/1000));
    const latest=confirmedPositions.get(key);
    if(!latest)throw new Error('Position changed during the quote. Read again.');
    const current=await latest.job;
    if(priceQuoteKey(settings,request.target,current)!==quoteKey||orders.isBusy(request.wallet)||isPending(await orders.loadReceipt(request.wallet)))throw new Error('Position changed during the quote. Read again.');
    return {ok:true,position:await attachEntry(withCurrentUsd(mergePrice(current,priced)))};
  }
  async function read(request: Extract<WorkerRequest, {type: 'POSITION' | 'TOKEN_INFO' | 'HISTORY' | 'SAVINGS' | 'PORTFOLIO' | 'PORTFOLIO_PRICES'}>, sender: Browser.runtime.MessageSender, orders: ReturnType<typeof createOrders>): Promise<WorkerResponse> {
    if (request.type === 'PORTFOLIO') return portfolio(request,orders);
    if(request.type==='PORTFOLIO_PRICES'){new PublicKey(request.wallet);const settings=await loadSettings();return {ok:true,portfolio:portfolios.get(`${request.wallet}:${configKey(settings)}`)?.snapshot};}
    if (request.type === 'POSITION') return position(request, sender, orders);
    if (request.type === 'TOKEN_INFO') {
      await frameFor(sender, request);
      const settings = await loadSettings();
      return {ok: true, token: await readTokenInfo(quotes.connection(settings.rpcUrl), request.target)};
    }
    if (request.type === 'HISTORY') return {ok: true, receipts: await receiptSymbols(await allReceipts(request.wallet, request.mint)), savings: await readSavings()};
    for (const tracked of await unauditedReceipts()) orders.scheduleAudit(tracked);
    return {ok: true, savings: await readSavings()};
  }
  const refreshPriceSettings=async()=>{for(const entry of portfolios.values())invalidatePositions(entry.wallet);const client=viewers.keys().next().value;if(client){const view=viewers.get(client)!;await watchPrices(client,view.wallet,view.mint);}};
  return {read, invalidatePositions,watchPrices,refreshPriceSettings};
}
