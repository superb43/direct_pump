import { DEFAULT_SETTINGS, type PageTarget, type Receipt, type TradeIntent, type WorkerRequest, type WorkerResponse, type PublicSettings } from './model';
import { redactUrls } from './errors';
import { sameTarget, targetKey } from './sites/catalog';
import type {PositionSnapshot,MarketHint} from './model';
import { createPanelView } from './panel-view';
import { formatUsd } from './savings';

export type SendRequest = (request: WorkerRequest) => Promise<WorkerResponse>;
export function shortAddress(address: string): string { return `${address.slice(0, 6)}…${address.slice(-6)}`; }
export function tokenLabel(symbol: string | undefined, mint: string): string { return `$${symbol ?? 'TOKEN'} (${shortAddress(mint)})`; }

export function mountPanelController(target: PageTarget, send: SendRequest, options: { container: HTMLElement }) {
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
  let walletSequence = 0;
  let walletPoll = false;
  let needsFees = false;
  let latestReceipt: Receipt | undefined;
  let savingsTicks = 0;
  let position:PositionSnapshot|undefined,market:MarketHint|undefined,positionBusy=false,holdingsBusy=false;
  let quoteSequence=0,holdingsSequence=0,lastConfirmed='',refreshAfterTrade=false;
  const renderPosition = () => view.renderPosition(position, market);
  const updateMarket=(value?:MarketHint)=>{
    if (!alive) return;
    marketCandidate = value;
    const expectedMint = target.kind === 'MINT' ? target.address : resolvedMint;
    market = value && expectedMint === value.mint ? value : undefined;
    if(position&&!position.market&&market?.mint===position.mint){position={...position,market};void loadPosition(true).catch(()=>{});}
    renderPosition();
  };
  async function loadHoldings(refresh=false){
    if(!wallet||!assetReady||(!refresh&&holdingsBusy)||busy||pending)return;
    holdingsBusy=true;const account=wallet,sequence=++holdingsSequence;
    try{
      const response=await send({type:'POSITION',target,wallet:account,market,holdingsOnly:true,refresh});
      if(!alive||wallet!==account||sequence!==holdingsSequence||!response.ok||!response.position)return;
      const next=response.position,previous=position;
      if (next.wallet !== account || next.mint !== resolvedMint) return;
      if(previous&&previous.balanceRaw===next.balanceRaw){
        position={...previous,balanceRaw:next.balanceRaw,decimals:next.decimals,supplyRaw:next.supplyRaw,balanceUpdatedAt:next.balanceUpdatedAt,costBasisUsdMicros:next.costBasisUsdMicros,costBasisSolLamports:next.costBasisSolLamports,warning:next.warning??previous.warning};
      }else{position={...next,solUsd:previous?.solUsd};if(!positionBusy)void loadPosition(true).catch(()=>{});}
      renderPosition();
    }finally{if(sequence===holdingsSequence)holdingsBusy=false;}
  }
  async function loadPosition(refresh=false){
    if(!wallet||!assetReady||(!refresh&&positionBusy)||busy||pending)return;
    positionBusy=true;const account=wallet,sequence=++quoteSequence;
    try{
      const response=await send({type:'POSITION',target,wallet:account,market,refresh});
      if(!alive||wallet!==account||sequence!==quoteSequence)return;
      if(response.ok&&response.position){
        const next=response.position;
        if (next.wallet !== account || next.mint !== resolvedMint) return;
        if(position&&(position.balanceUpdatedAt??0)>(next.balanceUpdatedAt??next.updatedAt)&&position.balanceRaw!==next.balanceRaw)return;
        position=position&&(position.balanceUpdatedAt??0)>(next.balanceUpdatedAt??next.updatedAt)?{...next,balanceRaw:position.balanceRaw,balanceUpdatedAt:position.balanceUpdatedAt,costBasisUsdMicros:position.costBasisUsdMicros,costBasisSolLamports:position.costBasisSolLamports}:next;
        renderPosition();
      }else if(!response.ok){$('.position-source').textContent=redactUrls(response.error);}
    }finally{if(sequence===quoteSequence)positionBusy=false;}
  }
  const refreshPosition=(refresh=false)=>{void loadHoldings(refresh).catch(()=>{});void loadPosition(refresh).catch(()=>{});};

  async function loadSavings() {
    const response=await send({type:'SAVINGS'});
    if(!alive) return;
    if(!response.ok||!response.savings){$('.saved-usd').textContent='Unavailable';return;}
    const s=response.savings;
    $('.saved-usd').textContent=s.unpricedTrades&&!s.pricedTrades?'USD unavailable':formatUsd(s.savedUsdMicros);
    $('.savings-note').textContent=`1% of ${formatUsd(s.volumeUsdMicros)} tracked volume${s.unpricedTrades?` · ${s.unpricedTrades} unpriced`:''}`;
  }
  const setStatus = (text: string, kind: 'info' | 'error' | 'success' = 'info') => {
    if (!alive) return;
    const visible = kind === 'info' && !busy && !pending ? assetError ?? settingsError ?? text : text;
    const status = $('.status');
    const severity = visible === assetError || visible === settingsError ? 'error' : kind;
    status.textContent = redactUrls(visible); status.className = `status ${severity}`;
    status.setAttribute('role', severity === 'error' ? 'alert' : 'status');
  };
  const toggle = () => {
    shadow.querySelectorAll<HTMLButtonElement>('.buy,.sell').forEach(button => { button.disabled = busy || pending || !assetReady; });
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
    if (receipt.mint !== resolvedMint) {
      needsFees = false; $('.fee-receipt').hidden = true; $('.explorer').hidden = true;
      setStatus(pending ? 'Another token trade is awaiting resolution.' : assetError ?? 'Choose an amount, then approve in Phantom.');
      toggle();
      return;
    }
    const labels = { SIGNING: receipt.error ?? 'Waiting for Phantom approval…', SUBMITTED: 'Submitted · checking confirmation…', UNKNOWN: receipt.error ?? 'Phantom response is unresolved. Checking the trade result.', CONFIRMED: 'Transaction confirmed.', FAILED: receipt.error ?? 'Transaction failed.', EXPIRED: receipt.error ?? 'Transaction expired. You can submit a new request.' };
    setStatus(labels[receipt.status],receipt.status==='FAILED'?'error':receipt.status==='CONFIRMED'?'success':'info');
    const link = $<HTMLAnchorElement>('.explorer');
    if (receipt.signature) { link.href = `https://solscan.io/tx/${encodeURIComponent(receipt.signature)}`; link.hidden = false; }
    needsFees = view.renderFees(receipt); void loadSavings().catch(()=>{});
    toggle();
    if(receipt.status==='CONFIRMED'){
      const key=`${receipt.signature}:${receipt.feeReceipt?.checkedAt??''}`;
      if(key!==lastConfirmed){lastConfirmed=key;if(busy)refreshAfterTrade=true;else refreshPosition(true);}
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
    wallet = response.wallet; ++quoteSequence;++holdingsSequence;positionBusy=false;holdingsBusy=false;lastConfirmed='';position=undefined; $('.position').hidden=true; pending = false; needsFees=false; latestReceipt=undefined; $('.fee-receipt').hidden=true; renderWallet();
    if (!wallet) { setStatus(assetError ?? 'Connect Phantom once to this site to start trading.'); toggle(); return; }
    setStatus(assetError ?? 'Choose an amount, then approve in Phantom.');
    const account = wallet;
    const status = await send({ type: 'STATUS', wallet: account });
    if (!alive || sequence !== walletSequence || wallet !== account) return;
    if (status.ok && status.receipt) showReceipt(status.receipt);
    else if (!status.ok) setStatus(status.error);
    toggle(); refreshPosition();
  }

  async function run(intent?: TradeIntent) {
    if (!alive || busy || (intent && (pending || !assetReady))) return;
    const tradeTarget = { ...target };
    const tradeIntent = intent && { ...intent };
    walletSequence++; busy = true; toggle();
    $<HTMLAnchorElement>('.explorer').hidden = true; $('.fee-receipt').hidden=true;
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
    finally { busy = false; if (alive){toggle();refreshPosition(refreshAfterTrade);refreshAfterTrade=false;} }
  }

  function renderPresets() {
    $('.buys').replaceChildren(); $('.sells').replaceChildren();
    for (const sol of settings.buyPresets) {
      const button = document.createElement('button'); button.className = 'buy'; button.textContent = sol;
      button.addEventListener('click', event => { if (event.isTrusted) void run({ side: 'BUY', sol }); }); $('.buys').append(button);
    }
    for (const percent of settings.sellPresets) {
      const button = document.createElement('button'); button.className = 'sell'; button.textContent = `${percent}%`;
      button.addEventListener('click', event => { if (event.isTrusted) void run({ side: 'SELL', percent }); }); $('.sells').append(button);
    }
    toggle();
  }
  async function reloadSettings() {
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
    const link = $<HTMLAnchorElement>('.token');
    link.textContent = target.kind === 'MINT' ? tokenLabel(undefined, target.address) : 'Loading token…';
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
      market = marketCandidate?.mint === resolvedMint ? marketCandidate : undefined;
      link.textContent = tokenLabel(response.token.symbol, response.token.mint);
      link.title = response.token.mint; link.href = `https://solscan.io/token/${response.token.mint}`;
      if (response.token.routeError) {
        assetError = response.token.routeError; setStatus(assetError);
        if (latestReceipt) showReceipt(latestReceipt);
        toggle(); return;
      }
      assetError = undefined; assetReady = true; toggle(); refreshPosition();
      if (latestReceipt) showReceipt(latestReceipt);
    } else {
      if (target.kind === 'POOL') link.textContent = `Token unavailable (pool ${shortAddress(target.address)})`;
      if (!response.ok) { assetError = response.error; setStatus(assetError); }
    }
  }

  function updateContext(next: PageTarget) {
    if (!alive || !sameTarget(target, next)) return;
    const changed = targetKey(target) !== targetKey(next);
    target = { ...next };
    if (!changed) return;
    assetReady = false; resolvedMint = undefined; assetError = undefined;
    ++quoteSequence; ++holdingsSequence; positionBusy = false; holdingsBusy = false;
    position = undefined; market = undefined; marketCandidate = undefined;
    needsFees = false; lastConfirmed = ''; refreshAfterTrade = false;
    $('.fee-receipt').hidden = true; $('.explorer').hidden = true;
    renderPosition(); toggle();
    setStatus(pending ? 'A trade is awaiting resolution.' : 'Checking token context…');
    void loadToken();
  }

  $('.connect').addEventListener('click', event => { if (event.isTrusted) void run(); });
  $('.settings').addEventListener('click', async event => {
    if (!event.isTrusted) return;
    try { const response = await send({ type: 'OPEN_SETTINGS' }); if (!response.ok) setStatus(response.error,'error'); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not open settings.','error'); }
  });
  $('.custom-buy').addEventListener('click', event => {
    if (event.isTrusted) void run({ side: 'BUY', sol: $<HTMLInputElement>('input').value.trim() });
  });
  $('.savings-details').addEventListener('click',async event=>{if(!event.isTrusted)return;const response=await send({type:'OPEN_DASHBOARD'});if(!response.ok)setStatus(response.error,'error');});
  for(const selector of ['.fee-total-value','.fee-protocol-value'])$(selector).addEventListener('click',()=>{$<HTMLDetailsElement>('.fee-breakdown').open=!$<HTMLDetailsElement>('.fee-breakdown').open;});
  renderPresets();
  void loadSavings().catch(()=>{if(alive)$('.saved-usd').textContent='Unavailable';});
  void reloadSettings().catch(error => { settingsError = error instanceof Error ? error.message : 'Settings could not be loaded.'; setStatus(settingsError, 'error'); });
  void loadToken();
  void syncWallet('WALLET_RESTORE').catch(error => setStatus(error instanceof Error ? error.message : 'Phantom connection could not be checked.', 'error'));
  let lifecycleTicks = 0;
  const timer = window.setInterval(() => {
    if (!alive) return;
    renderPosition();
    if (busy) return;
    ++lifecycleTicks;
    if (!pending) {
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
  const destroy = () => { alive = false; latestReceipt = undefined; walletSequence++; settingsSequence++; ++tokenSequence; ++quoteSequence;++holdingsSequence;window.clearInterval(timer);host.remove(); };
  return { destroy, reloadSettings, showReceipt, updateContext, updateMarket, refreshPosition, isBusy: () => busy || pending };
}
