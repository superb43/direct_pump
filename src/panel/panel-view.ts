import { icon, solIcon } from '../ui/icons';
import uiTokens from '../ui/ui-tokens.css?inline';
import panelTheme from './panel-theme.css?inline';
import uiControls from '../ui/ui-controls.css?inline';
import '../ui/ui-fonts.css';
import type { PositionSnapshot, PortfolioSnapshot } from '../model';
import { redactUrls } from '../errors';
import { receiptUsd } from '../receipts/receipt-format';
import { holdingDisplay, holdingAge, portfolioPriceStatus, portfolioTotals } from '../portfolio/portfolio';

export function createPanelView(container: HTMLElement) {
  const host = document.createElement('div');
  host.style.cssText = 'display:block;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${uiTokens}\n${uiControls}\n${panelTheme}</style>
  <section aria-label="Direct Pump trading" >
    <header><button class="icon settings" aria-label="Settings" title="Trading settings">${icon('settings')}</button><strong>DIRECT PUMP</strong><button class="pro-switch" type="button" role="switch" aria-checked="false" title="Use the dedicated server wallet">Pro OFF</button></header>
    <div class="panel-body">
    <div class="token"><button class="token-link" aria-label="Copy token mint address" title="Copy token mint address" disabled><span class="token-ticker"></span>${icon('copy')}</button><div class="token-address-wrap"><button class="copy-address" aria-label="Copy token address" title="Copy token address" disabled><span class="token-address"></span></button><span class="copy-feedback" role="status" aria-live="polite" hidden></span></div></div>
    <div class="pro-mode-error" hidden><p class="pro-mode-status" role="alert"></p><button class="pro-mode-retry" type="button">Retry mode check</button></div><div class="pro-container" hidden></div><div class="manual-panel">
    <div class="wallet-row"><button class="connect dp-primary" title="Connect Phantom to this site">Connect Phantom</button><span class="wallet" hidden></span></div>
    <div class="trade-group buy-group"><label>Buy · ${solIcon()}</label><div class="grid buys"></div>
    <div class="buy-form"><div class="custom"><input aria-label="Buy amount in SOL" aria-describedby="amount-error" inputmode="decimal" placeholder="Custom amount" maxlength="20"><button class="buy custom-buy">Buy</button></div><p id="amount-error" class="amount-error" role="alert" hidden></p></div>
    </div>
    <div class="trade-group sell-group"><label>Sell · Receive ${solIcon()}</label><div class="grid sells"></div></div>
    <div class="status" role="status" aria-live="polite"><span class="status-text">Checking Phantom connection…</span><a class="explorer" hidden target="_blank" rel="noopener noreferrer">Solscan ↗</a></div>
    <div class="position" role="region" aria-label="Holdings totals" hidden><div><span>Position Value</span><strong class="position-value">—</strong></div><div><span>Est. net PnL</span><strong class="position-pnl">—</strong></div><small class="position-source"></small></div>
    <details class="holdings" open hidden><summary class="holdings-title">Holdings</summary><div class="holdings-tools"><button class="holdings-refresh" type="button" aria-label="Retry holdings update" title="Retry holdings update" hidden>${icon('refresh')}</button></div><div class="holdings-list"></div><small class="holdings-note" role="status" aria-live="polite"></small></details>
    <footer><div class="savings"><div class="savings-header"><span>Fee Saved</span><strong class="saved-usd">$0.00</strong></div><button class="savings-details">Details ↗</button></div></footer>
    </div></div>
  </section>`;
  container.append(host);
  const $ = <T extends HTMLElement>(selector: string) => shadow.querySelector<T>(selector)!;
  function renderToken(symbol?:string,mint?:string) {
    $('.token-ticker').textContent=mint?`$${symbol??'TOKEN'}`:'Loading token…';
    $('.token-ticker').title=$('.token-ticker').textContent;
    $('.token-address').textContent=mint?`${mint.slice(0,6)}…${mint.slice(-6)}`:'';
  }
  let hasPortfolio = false, summaryNote = '', currentPosition: PositionSnapshot | undefined;
  let currentPortfolio: PortfolioSnapshot | undefined, portfolioReadError: string | undefined, monitoringSince: number | undefined;
  function updatePortfolioStatus() {
    const active = !document.hidden && !$('.holdings').hidden && $<HTMLDetailsElement>('.holdings').open;
    const now = Date.now();
    if (!active) monitoringSince = undefined;
    else monitoringSince ??= now;
    const portfolio = currentPortfolio;
    const error = portfolioReadError ?? portfolio?.balanceError ?? portfolio?.holdings.find(row => !row.position)?.error;
    const unavailable = portfolio?.holdings.filter(row => !row.position).length ?? 0;
    const delayed = active && !!portfolio && now - Math.max(portfolio.updatedAt, monitoringSince!) >= 15_000;
    $('.holdings-refresh').hidden = !active || !(error || unavailable || delayed);
    if (!portfolio && !error) return;
    const age = portfolio?.updatedAt ? `${Math.max(0, Math.floor((now - portfolio.updatedAt) / 1000))}s since last balance update` : '';
    $('.holdings-title').textContent = !portfolio?.updatedAt && error ? 'Holdings · balance unavailable' : `Holdings${error || unavailable || delayed ? ' · update delayed' : ''}`;
    const pricing = portfolio?.holdings.filter(row => row.pricingPending).length ?? 0;
    const normalNote = portfolio?.holdings.length ? `${portfolioPriceStatus(portfolio)} · Balance ${new Date(portfolio.updatedAt).toLocaleTimeString()}${pricing ? ' · Pricing…' : ''}${unavailable ? ` · ${unavailable} balances unavailable` : ''}` : 'No open tracked positions · Auto · 5s';
    $('.holdings-note').textContent = error ? `${redactUrls(error)} Retrying automatically.${age ? ` ${age}.` : ''}` : delayed ? `Balance update delayed · ${age || 'No successful balance update'}. Retrying automatically.` : normalNote;
  }
  function renderPortfolioError(error?: string) {
    portfolioReadError = error;
    updatePortfolioStatus();
  }
  function renderPosition(position?: PositionSnapshot){
    currentPosition = position;
    $('.position').hidden = !hasPortfolio && !position?.chartEntryNote;
    const text = [summaryNote, position?.chartEntryNote].filter(Boolean).join(' ');
    const note=$('.position-source');note.hidden=!text;note.textContent=redactUrls(text);note.title=note.textContent;
  }
  function renderPortfolio(portfolio?: PortfolioSnapshot, navigate?: (url: string) => void) {
    currentPortfolio = portfolio;
    hasPortfolio = !!portfolio;
    if (!portfolio) {
      summaryNote = ''; $('.position-value').textContent='Unavailable'; $('.position-pnl').textContent='Unavailable';
      $('.holdings').hidden=true; $('.holdings-list').replaceChildren(); portfolioReadError=undefined; updatePortfolioStatus(); renderPosition(); return;
    }
    const totals = portfolioTotals(portfolio);
    summaryNote = totals.note;
    $('.position-value').textContent = totals.value === undefined ? 'Unavailable' : receiptUsd(totals.value);
    $('.position-value').title = 'Sum of available values shown in Holdings.';
    const totalPnl = $('.position-pnl'); totalPnl.className = 'position-pnl';
    if (totals.pnl === undefined) totalPnl.textContent = 'Unavailable';
    else {
      const raw = BigInt(totals.pnl), negative = raw < 0n;
      totalPnl.textContent = `${negative?'-':'+'}${receiptUsd((negative?-raw:raw).toString())}`;
      if (totals.bps !== undefined) {
        const bps = BigInt(totals.bps), pct = bps < 0n ? -bps : bps;
        totalPnl.textContent += ` (${bps<0n?'-':'+'}${pct/100n}.${(pct%100n).toString().padStart(2,'0')}%)`;
      }
      totalPnl.classList.add(negative?'negative':'positive');
    }
    totalPnl.title = 'Sum of available net PnL shown in Holdings. Percentage uses only the included cost basis.';
    renderPosition(currentPosition);
    $('.holdings').hidden = false;
    const list = $('.holdings-list'); list.replaceChildren();
    for (const holding of portfolio.holdings) {
      const display = holdingDisplay(holding), row = document.createElement('button');
      row.className = 'holdings-row'; row.disabled = !holding.pageUrl || !navigate;
      row.title = `${holding.mint} · Cost basis: ${display.basis} · ${redactUrls(display.note)}`;
      const identity = document.createElement('span'), name = document.createElement('strong'), age = document.createElement('time'), amounts = document.createElement('span'), value = document.createElement('span'), pnl = document.createElement('small');
      name.textContent = `$${holding.symbol ?? 'TOKEN'}`; value.textContent = display.value; pnl.textContent = display.pnl;
      age.className='holding-age';age.textContent=holdingAge(holding.position?.openedAt);
      age.hidden=!holding.position;
      if(holding.position?.openedAt){age.setAttribute('data-opened-at',String(holding.position.openedAt));age.title=`Position opened ${new Date(holding.position.openedAt).toLocaleString()}`;}
      else age.title='Opening time unavailable';
      if (display.pnl.startsWith('+') || display.pnl.startsWith('-')) pnl.className = display.negative ? 'negative' : 'positive';
      identity.className='holding-identity';identity.append(name,age);amounts.append(value,pnl); row.append(identity,amounts);
      row.addEventListener('click', event => {if(event.isTrusted && holding.pageUrl)navigate?.(holding.pageUrl);}); list.append(row);
    }
    updatePortfolioStatus();
  }
  function updateHoldingTimes() {
    shadow.querySelectorAll<HTMLElement>('[data-opened-at]').forEach(element=>{element.textContent=holdingAge(Number(element.dataset.openedAt));});
    updatePortfolioStatus();
  }
  return { host, shadow, $, renderToken, renderPosition, renderPortfolio, renderPortfolioError, updatePortfolioStatus, updateHoldingTimes };
}
