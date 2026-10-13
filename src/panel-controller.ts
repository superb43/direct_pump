import { DEFAULT_SETTINGS, type PageTarget, type Receipt, type TradeIntent, type WorkerRequest, type WorkerResponse, type PublicSettings, type PortfolioSnapshot } from './model';
import { redactUrls } from './errors';
import { sameTarget, targetKey } from './sites/catalog';
import type {PositionSnapshot,MarketHint} from './model';
import { createPanelView } from './panel-view';
import { formatUsd } from './savings';
import { parseSol } from './amounts';
import { solIcon } from './icons';
import { receiptFailure } from './receipt-details';
import {mergePortfolioPrices} from './portfolio';
import { browser } from 'wxt/browser';
import { mountProPanel, validateChartEntry } from './pro/panel-view';
import type { ProSettings } from './pro/contracts';
import type { ChartEntry } from './chart-entry';
import { hasProConnection, proPreviewSelected, selectProPreview } from './pro/preview-mode';

export type PanelProMode='UNKNOWN'|'ON'|'OFF'|'PREVIEW';
export function manualExecutionAllowed(native:boolean,mode:PanelProMode):boolean{return !native||mode==='OFF';}

export type SendRequest = (request: WorkerRequest) => Promise<WorkerResponse>;
export function shortAddress(address: string): string { return `${address.slice(0, 6)}…${address.slice(-6)}`; }
export function tokenLabel(symbol: string | undefined, mint: string): string { return `$${symbol ?? 'TOKEN'} (${shortAddress(mint)})`; }

export function mountPanelController(target: PageTarget, send: SendRequest, options: { container: HTMLElement; navigate?: (url: string) => void; watchPrices?: (wallet:string|undefined,active:boolean,mint?:string)=>void; native?: boolean; chartEntry?: (entry: ChartEntry | undefined) => void }) {
  const view = createPanelView(options.container);
  const { host, shadow, $ } = view;

  target = { ...target };
  let tokenSequence = 0;
  let marketCandidate: MarketHint | undefined;
  let settings: PublicSettings = DEFAULT_SETTINGS;
  let wallet: string | undefined;
  let assetReady = false;
  let resolvedMint: string | undefined;
  let settingsSequence = 0;
  let settingsError: string | undefined;
  let assetError: string | undefined;
  let busy = false;
  let pending = false;
  let alive = true;
  let proEnabled=false,proToggleBusy=false,proMode:PanelProMode=options.native?'UNKNOWN':'OFF',proModeReadBusy=false,proModeReadAgain=false;
  let proPanel:ReturnType<typeof mountProPanel>|undefined;
  let previewSelected=proPreviewSelected(),proPanelPreview=false,proConnection=false;
  const proModeKnown=()=>proMode!=='UNKNOWN';
  const proSwitch=$<HTMLButtonElement>('.pro-switch');proSwitch.hidden=!options.native;proSwitch.disabled=Boolean(options.native);if(options.native){proSwitch.textContent='Pro unknown';$('.manual-panel').hidden=true;$('.pro-mode-error').hidden=false;$('.pro-mode-status').textContent='Checking trading mode…';}
  const renderPro=(enabled:boolean)=>{
    const preview=!enabled&&previewSelected,visible=enabled||preview;
    if(!alive||!options.native)return;options.chartEntry?.(undefined);if(position)position={...position,chartEntry:undefined,chartEntryNote:'Avg entry: waiting for the transaction.'};++quoteSequence;++holdingsSequence;positionBusy=false;holdingsBusy=false;proEnabled=enabled;proMode=enabled?'ON':preview?'PREVIEW':'OFF';$('.pro-mode-error').hidden=true;proSwitch.disabled=proToggleBusy;
    proSwitch.setAttribute('aria-checked',String(visible));proSwitch.textContent=visible?'Pro ON':'Pro OFF';
    proSwitch.title=preview?'Browse Pro · server setup required':enabled?'Server Pro enabled':'Explore Pro trading';
    $('.manual-panel').hidden=visible;$('.pro-container').hidden=!visible;
    if(proPanel&&proPanelPreview!==preview){proPanel.destroy();proPanel=undefined;}
    if(visible&&!proPanel){proPanelPreview=preview;proPanel=mountProPanel($('.pro-container'),target,entry=>{if(alive&&proMode==='ON')options.chartEntry?.(entry);},{preview});proPanel.update(target,resolvedMint,market);}
    if(!visible&&proPanel){proPanel.destroy();proPanel=undefined;}
    if(visible)options.watchPrices?.(undefined,false);toggle();
  };
  const renderModeUnknown=(message:string)=>{if(!alive||!options.native)return;options.chartEntry?.(undefined);if(position)position={...position,chartEntry:undefined,chartEntryNote:'Avg entry: waiting for the transaction.'};++quoteSequence;++holdingsSequence;positionBusy=false;holdingsBusy=false;proMode='UNKNOWN';proSwitch.disabled=true;proSwitch.textContent='Pro unknown';$('.manual-panel').hidden=true;$('.pro-container').hidden=true;$('.pro-mode-error').hidden=false;$('.pro-mode-status').textContent=redactUrls(message);proPanel?.destroy();proPanel=undefined;options.watchPrices?.(undefined,false);toggle();};
  const refreshPro=async()=>{
    if(!options.native||!alive)return;if(proModeReadBusy){proModeReadAgain=true;return;}proModeReadBusy=true;
    try{const response=await send({type:'PRO',action:'SETTINGS'});if(!alive)return;if(!response.ok)throw new Error(response.error);if(!response.data||typeof (response.data as ProSettings).enabled!=='boolean')throw new Error('Trading mode could not be verified.');proConnection=hasProConnection(response.data as ProSettings);renderPro((response.data as ProSettings).enabled);}
    catch(error){renderModeUnknown(`Trading mode unavailable. ${error instanceof Error?error.message:'Retry the mode check.'}`);}
    finally{proModeReadBusy=false;if(alive&&proModeReadAgain){proModeReadAgain=false;void refreshPro();}}
  };
  $('.pro-mode-retry').addEventListener('click',()=>void refreshPro());
  proSwitch.addEventListener('click',async()=>{
    if(!proModeKnown()||proToggleBusy||busy||pending)return;options.chartEntry?.(undefined);proToggleBusy=true;proSwitch.disabled=true;
    try{if(proMode==='PREVIEW'||!proEnabled&&!proConnection){previewSelected=proMode!=='PREVIEW';selectProPreview(previewSelected);renderPro(false);return;}selectProPreview(false);previewSelected=false;const response=await send({type:'PRO',action:proEnabled?'DISABLE':'ENABLE'});if(!response.ok)throw new Error(response.error);await refreshPro();}
    catch(error){await refreshPro();if(alive){const message=error instanceof Error?error.message:'Pro mode change failed.';if(proEnabled){const status=$('.pro-container').querySelector<HTMLElement>('[data-status]');if(status)status.textContent=message;}else setStatus(message,'error');}}
    finally{proToggleBusy=false;if(alive)proSwitch.disabled=!proModeKnown();}
  });
  const onProStorage=(changes:Record<string,unknown>,area:string)=>{
    if(area!=='local'||!changes.proSettings)return;
    const {oldValue:before,newValue:after}=changes.proSettings as {oldValue?:ProSettings;newValue?:ProSettings};
    // Notification preferences do not change execution authority or discard drafts.
    const notificationOnly=before&&after&&typeof before.enabled==='boolean'&&typeof after.enabled==='boolean'
      &&typeof before.chromeNotifications==='boolean'&&typeof after.chromeNotifications==='boolean'
      &&before.chromeNotifications!==after.chromeNotifications
      &&(['enabled','serverUrl','serverId','deviceId'] as const).every(key=>before[key]===after[key]);
    if(!notificationOnly)renderModeUnknown('Checking trading mode…');
    void refreshPro();
  };
  if(options.native)browser.storage?.onChanged?.addListener(onProStorage);

  let walletSequence = 0;
  let walletPoll = false;
  let needsFees = false;
  let latestReceipt: Receipt | undefined;
  let successTimer: number | undefined;
  let lastSuccessNotice: string | undefined;
  const clearSuccessTimer = () => { if (successTimer !== undefined) window.clearTimeout(successTimer); successTimer = undefined; };
  let copyTimer:number|undefined;
  const clearCopy=()=>{if(copyTimer!==undefined)window.clearTimeout(copyTimer);copyTimer=undefined;$('.copy-feedback').hidden=true;};
  let savingsTicks = 0;
  let position:PositionSnapshot|undefined,market:MarketHint|undefined,positionBusy=false,holdingsBusy=false;
  let quoteSequence=0,holdingsSequence=0,lastConfirmed='',refreshAfterTrade=false;
  let portfolioSequence=0,portfolioBusy=false,lastPortfolio=false,priceSequence=0,livePriceAt=0,portfolioSnapshot:PortfolioSnapshot|undefined;
  const watchPrices=()=>options.watchPrices?.(wallet,manualExecutionAllowed(Boolean(options.native),proMode)&&!document.hidden&&($<HTMLDetailsElement>('.holdings').open||!!resolvedMint), $<HTMLDetailsElement>('.holdings').open?undefined:resolvedMint);
  function applyPortfolio(snapshot:PortfolioSnapshot){
    if(portfolioSnapshot&&snapshot.updatedAt<portfolioSnapshot.updatedAt)return;
    snapshot=mergePortfolioPrices(snapshot,portfolioSnapshot);portfolioSnapshot=snapshot;
    lastPortfolio=true;view.renderPortfolio(snapshot,options.navigate);
    const holding=snapshot.holdings.find(holding=>holding.mint===resolvedMint),quoted=holding?.position;
    livePriceAt=holding?.priceMode==='LIVE'?holding.priceUpdatedAt??0:0;
    if(quoted&&position&&quoted.balanceRaw===position.balanceRaw&&quoted.updatedAt>=position.updatedAt&&quoted.expectedExitLamports!==undefined){
      position={...quoted,balanceRaw:position.balanceRaw,balanceUpdatedAt:position.balanceUpdatedAt,openedAt:position.openedAt,chartEntry:position.chartEntry,chartEntryNote:position.chartEntryNote};
    }
    renderPosition();
  }
  async function loadPrices(){
    if(!manualExecutionAllowed(Boolean(options.native),proMode)||!wallet||busy||pending||document.hidden)return;
    const account=wallet,sequence=++priceSequence;
    const response=await send({type:'PORTFOLIO_PRICES',wallet:account});
    if(alive&&sequence===priceSequence&&wallet===account&&!busy&&!pending&&response.ok&&response.portfolio?.wallet===account&&portfolioSnapshot){portfolioSnapshot=mergePortfolioPrices(portfolioSnapshot,response.portfolio);applyPortfolio(portfolioSnapshot);}
  }
  async function loadPortfolio(refresh=false) {
    if(!manualExecutionAllowed(Boolean(options.native),proMode)||!wallet||busy||pending||portfolioBusy)return;
    const account=wallet,sequence=++portfolioSequence;portfolioBusy=true;
    $('.holdings').hidden=false;if(!lastPortfolio||refresh)$('.holdings-note').textContent='Updating holdings automatically…';
    $<HTMLButtonElement>('.holdings-refresh').disabled=true;
    try {
      const response=await send({type:'PORTFOLIO',wallet:account,refresh});
      if(!alive||wallet!==account||sequence!==portfolioSequence||busy||pending)return;
      if(response.ok&&response.portfolio?.wallet===account){view.renderPortfolioError();applyPortfolio(response.portfolio);}
      else view.renderPortfolioError(response.ok?'Holdings unavailable.':response.error);
    } catch(error) {if(alive&&wallet===account&&sequence===portfolioSequence)view.renderPortfolioError(error instanceof Error?error.message:'Holdings unavailable.');}
    finally {if(alive&&sequence===portfolioSequence){portfolioBusy=false;$<HTMLButtonElement>('.holdings-refresh').disabled=false;}}
  }
  const renderPosition = () => {
    const expired=position?.chartEntry?.validUntil!==undefined&&Date.now()>=position.chartEntry.validUntil;
    view.renderPosition(expired?{...position!,chartEntryNote:'Avg entry unavailable: wallet verification expired.'}:position);
    if(proMode!=='OFF')return;
    const entry=wallet&&resolvedMint?validateChartEntry(position?.chartEntry,resolvedMint,wallet,30_000):undefined;
    options.chartEntry?.(alive&&assetReady&&!busy&&!pending&&entry&&entry.wallet===wallet&&entry.mint===resolvedMint&&entry.balanceRaw===position?.balanceRaw&&entry.decimals===position.decimals&&entry.supplyRaw===position.supplyRaw&&Date.now()-entry.updatedAt>=0&&Date.now()-entry.updatedAt<=30_000?entry:undefined);
  };
  const updateMarket=(value?:MarketHint)=>{
    if (!alive) return;
    marketCandidate = value;
    const expectedMint = target.kind === 'MINT' ? target.address : resolvedMint;
    market = value && expectedMint === value.mint ? value : undefined;
    proPanel?.update(target,resolvedMint,market);
    if(position&&!position.market&&market?.mint===position.mint&&!(livePriceAt&&Date.now()-livePriceAt<15_000)){position={...position,market};void loadPosition(true).catch(()=>{});}
    renderPosition();
  };
  async function loadHoldings(refresh=false){
    if(!manualExecutionAllowed(Boolean(options.native),proMode)||!wallet||!assetReady||(!refresh&&holdingsBusy)||busy||pending)return;
    holdingsBusy=true;const account=wallet,sequence=++holdingsSequence;
    try{
      const response=await send({type:'POSITION',target,wallet:account,market,holdingsOnly:true,refresh});
      if(!alive||wallet!==account||sequence!==holdingsSequence||busy||pending||!manualExecutionAllowed(Boolean(options.native),proMode)||!response.ok||!response.position)return;
      const next=response.position,previous=position;
      if (next.wallet !== account || next.mint !== resolvedMint) return;
      if(previous&&previous.balanceRaw===next.balanceRaw){
        position={...previous,balanceRaw:next.balanceRaw,decimals:next.decimals,supplyRaw:next.supplyRaw,balanceUpdatedAt:next.balanceUpdatedAt,openedAt:next.openedAt,costBasisUsdMicros:next.costBasisUsdMicros,costBasisSolLamports:next.costBasisSolLamports,costBasisEstimated:next.costBasisEstimated,chartEntry:next.chartEntry,chartEntryNote:next.chartEntryNote,warning:next.warning};
      }else{livePriceAt=0;position={...next,solUsd:previous?.solUsd};if(!positionBusy)void loadPosition(true).catch(()=>{});}
      renderPosition();
    }finally{if(sequence===holdingsSequence)holdingsBusy=false;}
  }
  async function loadPosition(refresh=false){
    if(!manualExecutionAllowed(Boolean(options.native),proMode)||!wallet||!assetReady||(!refresh&&positionBusy)||busy||pending)return;
    if(livePriceAt&&Date.now()-livePriceAt<15_000)return;
    positionBusy=true;const account=wallet,sequence=++quoteSequence;
    try{
      const response=await send({type:'POSITION',target,wallet:account,market,refresh});
      if(!alive||wallet!==account||sequence!==quoteSequence||busy||pending||!manualExecutionAllowed(Boolean(options.native),proMode))return;
      if(response.ok&&response.position){
        const next=response.position;
        if (next.wallet !== account || next.mint !== resolvedMint) return;
        if(position&&next.updatedAt<position.updatedAt)return;
        if(position&&(position.balanceUpdatedAt??0)>(next.balanceUpdatedAt??next.updatedAt)&&position.balanceRaw!==next.balanceRaw)return;
        position=position&&(position.balanceUpdatedAt??0)>(next.balanceUpdatedAt??next.updatedAt)?{...next,balanceRaw:position.balanceRaw,balanceUpdatedAt:position.balanceUpdatedAt,openedAt:position.openedAt,costBasisUsdMicros:position.costBasisUsdMicros,costBasisSolLamports:position.costBasisSolLamports,chartEntry:position.chartEntry,chartEntryNote:position.chartEntryNote}:next;
        renderPosition();
      }else if(!response.ok){$('.position-source').hidden=false;$('.position-source').textContent=redactUrls(response.error);}
    }finally{if(sequence===quoteSequence)positionBusy=false;}
  }
  const refreshPosition=(refresh=false)=>{void loadHoldings(refresh).catch(()=>{});void loadPosition(refresh).catch(()=>{});};

  async function loadSavings() {
    const response=await send({type:'SAVINGS'});
    if(!alive) return;
    if(!response.ok||!response.savings){$('.saved-usd').textContent='Unavailable';return;}
    const s=response.savings;
    $('.saved-usd').textContent=s.unpricedTrades&&!s.pricedTrades?'USD unavailable':formatUsd(s.savedUsdMicros);
  }
  const setStatus = (text: string, kind: 'info' | 'error' | 'success' = 'info', signature?: string) => {
    if (!alive) return;
    clearSuccessTimer();
    const visible = kind === 'info' && !busy && !pending ? assetError ?? settingsError ?? text : text;
    const status = $('.status');
    const severity = visible === assetError || visible === settingsError ? 'error' : kind;
    $('.status-text').textContent = redactUrls(visible); status.hidden = !visible; status.className = `status ${severity}${pending ? ' pending' : ''}`;
    status.setAttribute('role', severity === 'error' ? 'alert' : 'status');
    const link = $<HTMLAnchorElement>('.explorer');
    link.hidden = !visible || !signature;
    if (signature) link.href = `https://solscan.io/tx/${encodeURIComponent(signature)}`;
    else link.removeAttribute('href');
  };
  const toggle = () => {
    if(busy||pending||!assetReady||proMode!=='OFF')options.chartEntry?.(undefined);
    shadow.querySelectorAll<HTMLButtonElement>('.buy,.sell').forEach(button => { button.disabled = !manualExecutionAllowed(Boolean(options.native),proMode) || busy || pending || !assetReady; });
    $<HTMLButtonElement>('.connect').disabled = busy;
  };
  const renderWallet = () => {
    $('.connect').hidden = !!wallet; $('.wallet').hidden = !wallet;
    $('.wallet').textContent = wallet ? `Phantom ${shortAddress(wallet)}` : '';
    $('.wallet').title = wallet ? `${wallet} · Change accounts in Phantom; this panel updates automatically.` : '';
  };

  function showReceipt(receipt: Receipt) {
    if (!alive || receipt.wallet !== wallet) return;
    latestReceipt = receipt;
    pending = ['SIGNING', 'SUBMITTED', 'UNKNOWN'].includes(receipt.status);
    if(pending||(receipt.status==='CONFIRMED'&&`${receipt.signature}:${receipt.feeReceipt?.checkedAt??''}`!==lastConfirmed)){if(position)position={...position,chartEntry:undefined,chartEntryNote:pending?'Avg entry unavailable: a wallet transaction is unresolved.':'Avg entry: verifying updated holdings…'};options.chartEntry?.(undefined);++quoteSequence;++holdingsSequence;positionBusy=false;holdingsBusy=false;}
    if (receipt.mint !== resolvedMint) {
      needsFees = false;
      setStatus(pending ? 'Another token trade is awaiting resolution.' : assetError ?? '');
      toggle();
      if(receipt.status==='CONFIRMED'){++portfolioSequence;portfolioBusy=false;void loadPortfolio(true);}
      return;
    }
    const labels = { SIGNING: receipt.error ?? 'Waiting for Phantom approval…', SUBMITTED: 'Submitted · checking confirmation…', UNKNOWN: receipt.error ?? 'Phantom response is unresolved. Checking the trade result.', CONFIRMED: 'Transaction confirmed.', FAILED: receiptFailure(receipt) ?? 'Transaction failed.', EXPIRED: receipt.error ?? 'Transaction expired. You can submit a new request.' };
    const failure = receiptFailure(receipt);
    const confirmed = receipt.status === 'CONFIRMED' && !failure;
    const noticeKey = `${receipt.mint}:${receipt.side}:${receipt.signature ?? receipt.createdAt}`;
    if (!confirmed || noticeKey !== lastSuccessNotice) {
      const label = confirmed ? `${receipt.side === 'BUY' ? 'Buy' : 'Sell'} confirmed.` : failure ?? labels[receipt.status];
      setStatus(label, failure ? 'error' : confirmed ? 'success' : 'info', receipt.signature);
      if (confirmed) {
        lastSuccessNotice = noticeKey;
        successTimer = window.setTimeout(() => { if (alive) setStatus(''); }, 5_000);
      }
    }
    // Fee audits and receipt recovery continue even without a panel receipt renderer.
    needsFees = !!receipt.signature && (!receipt.feeReceipt || receipt.feeReceipt.state === 'PENDING');
    void loadSavings().catch(()=>{});
    toggle();
    if(receipt.status==='CONFIRMED'){
      const key=`${receipt.signature}:${receipt.feeReceipt?.checkedAt??''}`;
      if(key!==lastConfirmed){lastConfirmed=key;livePriceAt=0;++portfolioSequence;portfolioBusy=false;if(busy)refreshAfterTrade=true;else {refreshPosition(true);void loadPortfolio(true);}}
    }
  }

  async function syncWallet(mode: 'WALLET_RESTORE' | 'CONNECT', context = target) {
    const sequence = ++walletSequence;
    const response = await send({ type: mode, target: context });
    if (!alive || sequence !== walletSequence) return;
    if (!response.ok) { if (mode !== 'WALLET_RESTORE') throw new Error(response.error); return; }
    if (!response.wallet && mode !== 'WALLET_RESTORE') throw new Error('Phantom did not return a connected account.');
    const changed = wallet !== response.wallet;
    if (!changed && mode === 'WALLET_RESTORE') {
      if (!wallet && !busy && !pending) setStatus(assetError ?? 'Connect Phantom once to this site to start trading.');
      return;
    }
    options.chartEntry?.(undefined);wallet = response.wallet; ++priceSequence;++quoteSequence;++holdingsSequence;++portfolioSequence;portfolioSnapshot=undefined;livePriceAt=0;portfolioBusy=false;lastPortfolio=false;view.renderPortfolio();positionBusy=false;holdingsBusy=false;lastConfirmed='';position=undefined; pending = false; needsFees=false; latestReceipt=undefined; lastSuccessNotice=undefined; renderWallet();watchPrices();
    if (!wallet) { setStatus(assetError ?? 'Connect Phantom once to this site to start trading.'); toggle(); return; }
    setStatus(assetError ?? '');
    const account = wallet;
    const status = await send({ type: 'STATUS', wallet: account });
    if (!alive || sequence !== walletSequence || wallet !== account) return;
    if (status.ok && status.receipt) showReceipt(status.receipt);
    else if (!status.ok) setStatus(status.error);
    toggle(); refreshPosition();void loadPortfolio();
  }

  async function run(intent?: TradeIntent) {
    if (!alive || !manualExecutionAllowed(Boolean(options.native),proMode) || busy || (intent && (pending || !assetReady))) return;
    const tradeTarget = { ...target };
    const tradeIntent = intent && { ...intent };
    walletSequence++;++portfolioSequence;portfolioBusy=false; busy = true; if(position)position={...position,chartEntry:undefined,chartEntryNote:'Avg entry: waiting for the transaction.'};++quoteSequence;++holdingsSequence;positionBusy=false;holdingsBusy=false;toggle();
    try {
      if (!wallet || !intent) { setStatus('Connecting Phantom…'); await syncWallet('CONNECT', tradeTarget); }
      if (!alive || pending || !intent) return;
      if (targetKey(target) !== targetKey(tradeTarget)) throw new Error('The token context changed. Submit from the current token page.');
      setStatus('Preparing transaction…');
      const account = wallet!, sequence = walletSequence;
      const response = await send({ type: 'TRADE', target: tradeTarget, wallet: account, intent: tradeIntent! });
      if (!alive || wallet !== account || sequence !== walletSequence) return;
      if (!response.ok) { throw new Error(response.error); }
      if (response.receipt) showReceipt(response.receipt);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Trade request failed.','error'); }
    finally { busy = false; if (alive){toggle();refreshPosition(refreshAfterTrade);void loadPortfolio(refreshAfterTrade);refreshAfterTrade=false;} }
  }

  function renderPresets() {
    $('.buys').replaceChildren(); $('.sells').replaceChildren();
    for (const sol of settings.buyPresets) {
      const button = document.createElement('button'); button.className = 'buy'; button.textContent = sol;
      const unit = document.createElement('span'); unit.innerHTML = solIcon(); button.append(unit);
      button.setAttribute('aria-label', `Buy ${sol} SOL; approve in Phantom`);
      button.addEventListener('click', event => { if (event.isTrusted) void run({ side: 'BUY', sol }); }); $('.buys').append(button);
    }
    for (const percent of settings.sellPresets) {
      const button = document.createElement('button'); button.className = 'sell'; button.textContent = `${percent}%`;
      button.setAttribute('aria-label', `Sell ${percent}% of holdings; receive SOL; approve in Phantom`);
      button.addEventListener('click', event => { if (event.isTrusted) void run({ side: 'SELL', percent }); }); $('.sells').append(button);
    }
    toggle();
  }
  async function reloadSettings() {
    livePriceAt=0;
    const sequence = ++settingsSequence;
    const response = await send({ type: 'SETTINGS_PUBLIC' });
    if (!alive || sequence !== settingsSequence) return;
    if (!response.ok) { settingsError = response.error; setStatus(settingsError, 'error'); return; }
    settingsError = undefined;
    if (response.publicSettings) { settings = response.publicSettings; renderPresets(); }
  }
  async function loadToken() {
    const sequence = ++tokenSequence;
    const context = target;
    const link = $<HTMLButtonElement>('.token-link');
    clearCopy();$<HTMLButtonElement>('.copy-address').disabled=true;
    view.renderToken(undefined,target.kind === 'MINT'?target.address:undefined);
    link.disabled=true;
    link.title = target.address;
    let response: WorkerResponse;
    try { response = await send({ type: 'TOKEN_INFO', target: context }); }
    catch (error) {
      if (alive && sequence === tokenSequence) { assetError = error instanceof Error ? error.message : 'Token could not be loaded.'; setStatus(assetError, 'error'); }
      return;
    }
    if (!alive || sequence !== tokenSequence) return;
    if (response.ok && response.token) {
      resolvedMint = response.token.mint;
      proPanel?.update(target,resolvedMint,marketCandidate);
      watchPrices();
      market = marketCandidate?.mint === resolvedMint ? marketCandidate : undefined;
      view.renderToken(response.token.symbol,response.token.mint);
      $<HTMLButtonElement>('.copy-address').disabled=false;
      link.title = `Copy ${response.token.mint}`; link.disabled=false;
      if (response.token.routeError) {
        assetError = response.token.routeError; setStatus(assetError);
        if (latestReceipt) showReceipt(latestReceipt);
        toggle(); return;
      }
      assetError = undefined; assetReady = true; toggle(); refreshPosition();
      if (latestReceipt) showReceipt(latestReceipt);
    } else {
      if (target.kind === 'POOL') { $('.token-ticker').textContent='Token unavailable';$('.token-address').textContent=`Pool ${shortAddress(target.address)}`; }
      if (!response.ok) { assetError = response.error; setStatus(assetError); }
    }
  }

  function updateContext(next: PageTarget) {
    if (!alive || !sameTarget(target, next)) return;
    const changed = targetKey(target) !== targetKey(next);
    target = { ...next };
    if (!changed) return;
    assetReady = false; resolvedMint = undefined; assetError = undefined;
    proPanel?.update(target,undefined,undefined);
    livePriceAt=0;
    ++quoteSequence; ++holdingsSequence; positionBusy = false; holdingsBusy = false;
    position = undefined; market = undefined; marketCandidate = undefined;
    needsFees = false; lastConfirmed = ''; refreshAfterTrade = false;
    lastSuccessNotice = undefined;
    renderPosition(); toggle();
    setStatus(pending ? 'A trade is awaiting resolution.' : 'Checking token context…');
    void loadToken();
  }

  $('.connect').addEventListener('click', event => { if (event.isTrusted) void run(); });
  $('.settings').addEventListener('click', async event => {
    if (!event.isTrusted) return;
    if (proPanel) { proPanel.openSettings(); return; }
    try { const response = await send({ type: 'OPEN_SETTINGS' }); if (!response.ok) setStatus(response.error,'error'); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not open settings.','error'); }
  });
  const copyMint=async(event:Event)=>{
    if(!event.isTrusted||!resolvedMint)return;
    const mint=resolvedMint,sequence=tokenSequence;clearCopy();$<HTMLButtonElement>('.copy-address').disabled=true;
    let message='Copied',failed=false;
    try{await navigator.clipboard.writeText(mint);}catch{message='Copy failed';failed=true;}
    if(!alive||sequence!==tokenSequence||resolvedMint!==mint)return;
    const feedback=$('.copy-feedback');feedback.textContent=message;feedback.className=`copy-feedback${failed?' error':''}`;feedback.hidden=false;
    $<HTMLButtonElement>('.copy-address').disabled=false;copyTimer=window.setTimeout(clearCopy,1000);
  };
  $('.copy-address').addEventListener('click',copyMint);
  $('.token-link').addEventListener('click',copyMint);
  $('.holdings-refresh').addEventListener('click',event=>{if(event.isTrusted)void loadPortfolio(true);});
  const clearAmountError=()=>{$('.amount-error').hidden=true;$<HTMLInputElement>('input').removeAttribute('aria-invalid');};
  $('input').addEventListener('input',clearAmountError);
  $('.custom-buy').addEventListener('click', event => {
    if(!event.isTrusted||busy||pending||!assetReady)return;
    const sol=$<HTMLInputElement>('input').value.trim();clearAmountError();
    try{parseSol(sol);}catch(error){$('.amount-error').textContent=error instanceof Error?error.message:'Enter a valid SOL amount.';$('.amount-error').hidden=false;$('input').setAttribute('aria-invalid','true');return;}
    void run({side:'BUY',sol});
  });
  $('.savings-details').addEventListener('click',async event=>{if(!event.isTrusted)return;const response=await send({type:'OPEN_DASHBOARD'});if(!response.ok)setStatus(response.error,'error');});
  renderPresets();
  void loadSavings().catch(()=>{if(alive)$('.saved-usd').textContent='Unavailable';});
  void reloadSettings().catch(error => { settingsError = error instanceof Error ? error.message : 'Settings could not be loaded.'; setStatus(settingsError, 'error'); });
  void refreshPro();
  void loadToken();
  void syncWallet('WALLET_RESTORE').catch(error => setStatus(error instanceof Error ? error.message : 'Phantom connection could not be checked.', 'error'));
  let lifecycleTicks = 0;
  const timer = window.setInterval(() => {
    if (!alive) return;
    if(options.native&&proMode==='UNKNOWN'){if(!document.hidden)void refreshPro();return;}
    if(document.hidden||proMode!=='OFF')return;
    renderPosition();
    view.updateHoldingTimes();
    if (busy) return;
    ++lifecycleTicks;
    if (!pending) {
      if(lifecycleTicks%5===0&&$<HTMLDetailsElement>('.holdings').open)void loadPortfolio();
      if (lifecycleTicks % 2 === 0) void loadHoldings().catch(() => {});
      if (lifecycleTicks % 6 === 0) void loadPosition().catch(() => {});
    }
    if (lifecycleTicks % 3 !== 0 || walletPoll) return;
    walletPoll = true;
    void (async () => {
      try {
        if (++savingsTicks % 10 === 0) void loadSavings().catch(() => {});
        await syncWallet('WALLET_RESTORE');
        if (!alive || !wallet || (!pending && !needsFees) || busy) return;
        const account = wallet, sequence = walletSequence;
        const response = await send({ type: 'STATUS', wallet: account });
        if (!alive || wallet !== account || sequence !== walletSequence) return;
        if (response.ok && response.receipt) showReceipt(response.receipt);
        else if (!response.ok) setStatus(response.error, 'error');
      } catch (error) { setStatus(error instanceof Error ? error.message : 'Waiting for the RPC response.', 'error'); }
      finally { walletPoll = false; }
    })();
  }, 1_000);
  const onVisible=()=>{watchPrices();view.updatePortfolioStatus();if(!document.hidden)void loadPortfolio();};
  document.addEventListener?.('visibilitychange',onVisible);
  $('.holdings').addEventListener('toggle',()=>{watchPrices();view.updatePortfolioStatus();if($<HTMLDetailsElement>('.holdings').open)void loadPortfolio();});
  const destroy = () => {options.chartEntry?.(undefined);proPanel?.destroy();if(options.native)browser.storage?.onChanged?.removeListener(onProStorage);options.watchPrices?.(undefined,false);clearCopy();clearSuccessTimer();alive = false; latestReceipt = undefined; walletSequence++; settingsSequence++; ++tokenSequence; ++portfolioSequence; ++priceSequence; ++quoteSequence;++holdingsSequence;window.clearInterval(timer);document.removeEventListener?.('visibilitychange',onVisible);host.remove(); };
  return { destroy, reloadSettings, showReceipt, updateContext, updateMarket, refreshPosition, refreshPortfolio:(account?:string)=>{if(!account||account===wallet)void loadPrices().catch(()=>{});}, isBusy: () => busy || pending };
}
