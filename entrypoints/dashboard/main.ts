import {browser} from 'wxt/browser';
import {volumeUsd} from '../../src/receipts/savings';
import {feeTotals,groupedFees,money,feeMoney,subtotalMoney,exactMoney,terminalFeeMoney,terminalFeeTitle,savingsEligible,dailyFeeTotals,type DisplayUnit} from '../../src/receipts/dashboard-fees';
import {receiptSol,receiptUsd,receiptToken} from '../../src/receipts/receipt-format';
import type {Receipt,WorkerRequest,WorkerResponse,PortfolioSnapshot} from '../../src/model';
import {holdingDisplay,holdingAge,portfolioPriceStatus,mergePortfolioPrices} from '../../src/portfolio/portfolio';
import {detectPage} from '../../src/sites/catalog';
import {receiptFailure,receiptDataNote} from '../../src/receipts/receipt-details';
import {redactUrls} from '../../src/errors';
import {createPriceWatch} from '../../src/price-watch';
import './style.css';
import {mountDiagnosticView} from '../../src/diagnostics/diagnostic-view';
import {icon} from '../../src/ui/icons';
import {renderFeeChart} from './chart';

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
mountDiagnosticView(document.querySelector<HTMLElement>('#diagnostics')!);
let receipts:Receipt[]=[];
let unit:DisplayUnit='USD';
let selected:Receipt|undefined;
let portfolio:PortfolioSnapshot|undefined,portfolioSequence=0,portfolioBusy=false;
const priceWatch=createPriceWatch();let priceSequence=0;
const watchPrices=()=>priceWatch.update($<HTMLSelectElement>('holdings-wallet').value,!document.hidden);
async function loadPrices(){
 const wallet=$<HTMLSelectElement>('holdings-wallet').value,sequence=++priceSequence;if(!wallet||document.hidden)return;
 const response=await send({type:'PORTFOLIO_PRICES',wallet});
 if(sequence===priceSequence&&wallet===$<HTMLSelectElement>('holdings-wallet').value&&response.ok&&response.portfolio?.wallet===wallet&&portfolio){portfolio=mergePortfolioPrices(portfolio,response.portfolio);renderPortfolio();}
}
const short=(s:string)=>`${s.slice(0,6)}…${s.slice(-6)}`;
const send=(request:WorkerRequest)=>browser.runtime.sendMessage(request) as Promise<WorkerResponse>;
const refreshHelp='Refresh confirmed trade data and fees. No signing or new trade.';
const counted=savingsEligible;
let chartWidth=0;
const chartResize=new ResizeObserver(([entry])=>{if(entry&&entry.contentRect.width!==chartWidth){chartWidth=entry.contentRect.width;render();}});
chartResize.observe($('chart'));
function showDetails(r:Receipt){
 selected=r;
 const f=r.feeReceipt,totals=feeTotals(f);
 $('detail-title').textContent=`${r.side} · ${receiptToken(r)} · Fee breakdown`;
 $('detail-note').textContent=`${receiptDataNote(r)} Account rent is shown separately.`;
 const failure=receiptFailure(r),diagnostic=f?.diagnostic??r.diagnostic;
 $('detail-failure').hidden=!failure;$('detail-failure').textContent=failure??'';
 $('detail-diagnostic').hidden=!failure||!diagnostic;
 $('detail-logs').textContent=redactUrls([diagnostic?.program?`Program: ${diagnostic.program}`:'',diagnostic?.code!==undefined?`Code: ${diagnostic.code}`:'',diagnostic?.error??'',...(diagnostic?.logs??[])].filter(Boolean).join('\n'));
 $('fee-breakdown').replaceChildren();
 const line=(label:string,value:string,cls='',title='')=>{const item=document.createElement('div');item.className=`fee-line ${cls}`;const name=document.createElement('span'),amount=document.createElement('strong');name.textContent=label;amount.textContent=value;amount.title=title;item.append(name,amount);$('fee-breakdown').append(item);};
 line(totals.partial?'Fee total · known subtotal':'Fee total',money(totals.total,f,unit),'fee-total',exactMoney(totals.total,f,unit));
 line(totals.partial?'Protocol fees · known subtotal':'Protocol fees · subtotal',f?.executionSucceeded===false?money('0',f,unit):f?.protocolFees.length?money(totals.protocol,f,unit):'Unavailable','fee-group');
 for(const fee of groupedFees(f))line(fee.label,feeMoney(fee,f,unit),'fee-child',`${fee.rawAmount} base units (${fee.decimals} decimals)`);
 if(totals.foreign)line('Non-SOL valuation','Unavailable','fee-child');
 line('Network · subtotal',money(f?.totalNetworkLamports,f,unit),'fee-group',exactMoney(f?.totalNetworkLamports,f,unit));
 line('Base',money(f?.baseNetworkLamports,f,unit),'fee-child',exactMoney(f?.baseNetworkLamports,f,unit));
 line('Priority',money(f?.priorityLamports,f,unit),'fee-child',exactMoney(f?.priorityLamports,f,unit));
 line('Jito tip',f?.zeroExtraFeesVerified?money('0',f,unit):'Unverified','fee-zero');
 line('Terminal fee',terminalFeeMoney(f,unit),'fee-zero',terminalFeeTitle(f));
 line('Account setup · rent deposit',money(f?.rentDepositedLamports,f,unit),'fee-group');
 line('Rent returned',money(f?.rentRefundedLamports,f,unit),'fee-child');
 if(!$<HTMLDialogElement>('details').open)$<HTMLDialogElement>('details').showModal();
}
function render(){
 const search=$<HTMLInputElement>('search').value.trim().toLowerCase(),side=$<HTMLSelectElement>('side').value;
 const filtered=receipts.filter(r=>(!side||r.side===side)&&(!search||`${r.symbol??''} ${r.wallet} ${r.mint} ${r.signature}`.toLowerCase().includes(search)));
 $('turnover-heading').textContent=`Trade amount · ${unit}`;
 $('rows').replaceChildren();$('empty').hidden=filtered.length>0;
 for(const r of [...filtered].reverse()){
  const row=document.createElement('tr'),f=r.feeReceipt,totals=feeTotals(f);
  const cell=(text:string,cls='')=>{const td=document.createElement('td');td.textContent=text;td.className=cls;row.append(td);return td;};
  const drilldown=(td:HTMLElement,text:string)=>{const button=document.createElement('button');button.className='amount-button';button.textContent=text;button.title='Open itemized fees';button.addEventListener('click',()=>showDetails(r));td.append(button);};
  cell(new Date((f?.blockTime??r.createdAt/1000)*1000).toLocaleString('en-US'));
  const identity=cell(''),ticker=document.createElement('button');ticker.className='ticker-copy';ticker.title=`Copy token address: ${r.mint}`;ticker.setAttribute('aria-label',`Copy ${receiptToken(r)} token address`);
  const label=document.createElement('span');label.textContent=receiptToken(r);const glyph=document.createElement('span');glyph.innerHTML=icon('copy');ticker.append(label,glyph);
  ticker.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(r.mint);if(!ticker.isConnected)return;glyph.innerHTML=icon('check');ticker.title=`Copied: ${r.mint}`;window.setTimeout(()=>{if(ticker.isConnected){glyph.innerHTML=icon('copy');ticker.title=`Copy token address: ${r.mint}`;}},1200);$('status').textContent=`${receiptToken(r)} token address copied.`;}catch{$('status').textContent='Could not copy token address. Try again.';}});
  identity.append(ticker);const wallet=document.createElement('small');wallet.textContent=short(r.wallet);wallet.title=r.wallet;identity.append(wallet);
  cell(r.side,r.side==='BUY'?'positive':'negative');
  const statusCell=cell('');drilldown(statusCell,r.status==='FAILED'?'TX failed':r.status.toLowerCase());if(receiptFailure(r)){statusCell.className='negative';statusCell.title=receiptFailure(r)!;}
  const turnover=cell(f?.executionSucceeded===false?'—':unit==='USD'?f?.volumeUsdMicros!==undefined?receiptUsd(f.volumeUsdMicros):f?.volumeLamports!==undefined?'Unpriced':'Unavailable':money(f?.volumeLamports,f,unit));
  turnover.title=`${exactMoney(f?.volumeLamports,f,unit)} · ${f?.usd?`${f.usd.source} · ${new Date(f.usd.capturedAt).toISOString()}`:'No historical USD price available'}`;
    const totalCell=cell('');drilldown(totalCell,subtotalMoney(totals.total,f,unit,totals.partial));totalCell.title=`${exactMoney(totals.total,f,unit)} · ${totals.partial?'Known fee subtotal; unavailable components excluded.':'Protocol plus network fees; rent separate.'}`;
  const protocol=cell('');drilldown(protocol,f?.protocolFees.length?subtotalMoney(totals.protocol,f,unit,totals.partial):f?.executionSucceeded===false?money('0',f,unit):'Unavailable');protocol.title=`${exactMoney(totals.protocol,f,unit)} · Open grouped protocol fee breakdown`;
  const networkCell=cell(money(f?.totalNetworkLamports,f,unit));networkCell.title=exactMoney(f?.totalNetworkLamports,f,unit);const terminal=cell(terminalFeeMoney(f,unit),'zero');terminal.title=terminalFeeTitle(f);
  const linkCell=cell('');if(r.signature){const link=document.createElement('a');link.href=`https://solscan.io/tx/${encodeURIComponent(r.signature)}`;link.target='_blank';link.rel='noopener noreferrer';link.textContent=short(r.signature);linkCell.append(link);} $('rows').append(row);
 }
 renderFeeChart($('chart'),dailyFeeTotals(filtered,unit),unit);
 const priced=receipts.filter(counted),sum=(field:'volumeUsdMicros'|'volumeLamports')=>priced.reduce((n,r)=>n+BigInt(r.feeReceipt?.[field]??'0'),0n);
 const volume=sum(unit==='USD'?'volumeUsdMicros':'volumeLamports');
 $('saved').textContent=unit==='USD'?receiptUsd((volume/100n).toString()):receiptSol((volume/100n).toString());
 $('volume').textContent=unit==='USD'?receiptUsd(volume.toString()):receiptSol(volume.toString());
 $('coverage').textContent=`${priced.length} priced · ${receipts.filter(r=>r.feeReceipt?.state==='VERIFIED'&&r.feeReceipt.executionSucceeded&&!counted(r)).length} unpriced trades`;
 $('count').textContent=String(receipts.length);$('verified').textContent='Local trade history';
 let network=0n,missing=0;
 for(const r of receipts){const f=r.feeReceipt;if(f?.totalNetworkLamports===undefined){missing++;continue;}if(unit==='USD'&&!f.usd&&BigInt(f.totalNetworkLamports)>0n){missing++;continue;}network+=BigInt(unit==='USD'?f.usd?volumeUsd(f.totalNetworkLamports,f.usd):'0':f.totalNetworkLamports);}
 $('network').textContent=unit==='USD'?receiptUsd(network.toString()):receiptSol(network.toString());
 $('network').title=missing?`${missing} receipts have missing fee or historical price data.`:'Actual network fees including priority; no double counting.';
}
function renderPortfolio(){
 const rows=$('holdings-rows');rows.replaceChildren();$('holdings-value-heading').textContent=`${unit==='SOL'?'Sell estimate':'Value'} · ${unit}`;
 if(!portfolio)return;
 for(const holding of portfolio.holdings){
  const display=holdingDisplay(holding,unit),row=document.createElement('tr');
  const cell=(text:string)=>{const td=document.createElement('td');td.textContent=text;row.append(td);return td;};
  const identity=cell('');identity.title=holding.mint;
  const label=receiptToken(holding);
  if(holding.pageUrl&&detectPage(holding.pageUrl)){const link=document.createElement('a');link.href=holding.pageUrl;link.textContent=label;link.target='_blank';link.rel='noopener noreferrer';identity.append(link);}else identity.textContent=label;
  cell(display.quantity);
  const age=cell(holdingAge(holding.position?.openedAt));
  if(holding.position?.openedAt){age.dataset.openedAt=String(holding.position.openedAt);age.title=`Position opened ${new Date(holding.position.openedAt).toLocaleString()}`;}
  else age.title='Opening time unavailable';
  cell(display.value);cell(display.basis).title=redactUrls(display.note);
  const pnl=cell(display.pnl);pnl.title=redactUrls(display.note);if(display.pnl.startsWith('+') || display.pnl.startsWith('-'))pnl.className=display.negative?'negative':'positive';
  cell(holding.position?new Date(holding.position.balanceUpdatedAt??holding.position.updatedAt).toLocaleTimeString():'Unavailable');rows.append(row);
 }
 $('holdings-status').textContent=portfolio.balanceError?`${redactUrls(portfolio.balanceError)} Retrying automatically.${portfolio.updatedAt?` Showing balances from ${new Date(portfolio.updatedAt).toLocaleTimeString()}.`:''}`:portfolio.holdings.length?`${portfolioPriceStatus(portfolio)} · Balance ${new Date(portfolio.updatedAt).toLocaleTimeString()}${portfolio.holdings.some(holding=>holding.pricingPending)?' · Pricing…':''}`:'No open tracked positions · Auto · 5s';
}
async function loadPortfolio(refresh=false){
 const wallet=$<HTMLSelectElement>('holdings-wallet').value;if(!wallet||portfolioBusy)return;
 const sequence=++portfolioSequence;portfolioBusy=true;$<HTMLButtonElement>('holdings-refresh').disabled=true;
 if(!portfolio||refresh)$('holdings-status').textContent='Updating holdings automatically…';
 try{const response=await send({type:'PORTFOLIO',wallet,refresh});if(sequence!==portfolioSequence||wallet!==$<HTMLSelectElement>('holdings-wallet').value)return;if(!response.ok)throw Error(response.error);if(!response.portfolio||response.portfolio.wallet!==wallet)throw Error('Holdings unavailable.');if(portfolio&&response.portfolio.updatedAt<portfolio.updatedAt)return;portfolio=mergePortfolioPrices(response.portfolio,portfolio);renderPortfolio();}
 catch(error){if(sequence===portfolioSequence)$('holdings-status').textContent=redactUrls(error instanceof Error?error.message:String(error));}
 finally{if(sequence===portfolioSequence){portfolioBusy=false;$<HTMLButtonElement>('holdings-refresh').disabled=false;}}
}
async function load(){const response=await send({type:'HISTORY'});if(!response.ok)throw Error(response.error);receipts=response.receipts??[];render();if(selected){const updated=receipts.find(r=>r.signature===selected?.signature);if(updated)showDetails(updated);}const selector=$<HTMLSelectElement>('holdings-wallet'),previous=selector.value;selector.replaceChildren();for(const wallet of [...new Set([...receipts].sort((a,b)=>b.createdAt-a.createdAt).map(r=>r.wallet))]){const option=document.createElement('option');option.value=wallet;option.textContent=short(wallet);option.title=wallet;selector.append(option);}if([...selector.options].some(option=>option.value===previous))selector.value=previous;if(!selector.value)$('holdings-status').textContent='No tracked wallets yet.';watchPrices();}
$('refresh').title=refreshHelp;
$('refresh').addEventListener('click',async()=>{const button=$<HTMLButtonElement>('refresh');button.disabled=true;$('status').textContent='Refreshing receipt data…';try{for(const r of receipts.filter(r=>r.signature&&r.feeManifest?.length)){const result=await send({type:'VERIFY_FEES',wallet:r.wallet,signature:r.signature!});if(!result.ok)throw Error(result.error);}await load();await loadPortfolio(true);$('status').textContent='Receipt data refreshed. No new trades were sent.';}catch(error){$('status').textContent=redactUrls(String(error));}finally{button.disabled=false;}});
for(const next of ['USD','SOL'] as const)$(`unit-${next.toLowerCase()}`).addEventListener('click',()=>{unit=next;for(const currency of ['USD','SOL'])$(`unit-${currency.toLowerCase()}`).setAttribute('aria-pressed',String(currency===unit));render();renderPortfolio();if(selected)showDetails(selected);});
$('search').addEventListener('input',render);$('side').addEventListener('change',render);$('close-details').addEventListener('click',()=>$<HTMLDialogElement>('details').close());$('details').addEventListener('close',()=>{selected=undefined;});
$('holdings-wallet').addEventListener('change',()=>{++priceSequence;++portfolioSequence;portfolioBusy=false;portfolio=undefined;watchPrices();renderPortfolio();void loadPortfolio(true);});
$('holdings-refresh').addEventListener('click',()=>{void loadPortfolio(true);});
const portfolioTimer=window.setInterval(()=>{if(!document.hidden)void loadPortfolio();},5_000);
const ageTimer=window.setInterval(()=>{if(!document.hidden)$('holdings-rows').querySelectorAll<HTMLElement>('[data-opened-at]').forEach(element=>{element.textContent=holdingAge(Number(element.dataset.openedAt));});},1000);
const onPortfolioUpdate=(message:{type?:string;wallet?:string},sender:{id?:string;tab?:unknown})=>{if(message.type==='PORTFOLIO_UPDATED'&&sender.id===browser.runtime.id&&!sender.tab&&message.wallet===$<HTMLSelectElement>('holdings-wallet').value&&!document.hidden)void loadPrices().catch(()=>{});};
let receiptTimer:number|undefined;
const onReceipts=(changes:Record<string,{newValue?:unknown}>,area:string)=>{if(area!=='local'||!Object.keys(changes).some(key=>key===`receipt:${$<HTMLSelectElement>('holdings-wallet').value}`))return;if(receiptTimer!==undefined)window.clearTimeout(receiptTimer);receiptTimer=window.setTimeout(()=>{void load().then(()=>loadPortfolio(true)).catch(error=>{$('holdings-status').textContent=redactUrls(String(error));});},250);};
const onVisible=()=>{watchPrices();if(!document.hidden)void loadPortfolio();};
browser.runtime.onMessage.addListener(onPortfolioUpdate);browser.storage?.onChanged?.addListener(onReceipts);document.addEventListener('visibilitychange',onVisible);
window.addEventListener('pagehide',()=>{chartResize.disconnect();priceWatch.destroy();++priceSequence;++portfolioSequence;window.clearInterval(portfolioTimer);window.clearInterval(ageTimer);if(receiptTimer!==undefined)window.clearTimeout(receiptTimer);browser.runtime.onMessage.removeListener(onPortfolioUpdate);browser.storage?.onChanged?.removeListener(onReceipts);document.removeEventListener('visibilitychange',onVisible);});
void load().then(()=>loadPortfolio()).catch(error=>{$('status').textContent=redactUrls(String(error.message));});
