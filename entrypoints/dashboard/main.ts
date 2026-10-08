import {browser} from 'wxt/browser';
import {formatAmount,formatUsd,volumeUsd} from '../../src/savings';
import {feeTotals,groupedFees,money,feeMoney,type DisplayUnit} from '../../src/dashboard-fees';
import type {Receipt,WorkerRequest,WorkerResponse} from '../../src/model';
import './style.css';

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
let receipts:Receipt[]=[];
let unit:DisplayUnit='USD';
let selected:Receipt|undefined;
const short=(s:string)=>`${s.slice(0,6)}…${s.slice(-6)}`;
const send=(request:WorkerRequest)=>browser.runtime.sendMessage(request) as Promise<WorkerResponse>;
const refreshHelp='Refresh confirmed trade data and fees. No signing or new trade.';
const counted=(r:Receipt)=>r.feeReceipt?.state==='VERIFIED'&&r.feeReceipt.zeroExtraFeesVerified&&r.feeReceipt.executionSucceeded&&r.feeReceipt.volumeUsdMicros!==undefined;
function showDetails(r:Receipt){
 selected=r;
 const f=r.feeReceipt,totals=feeTotals(f);
 $('detail-title').textContent=`${r.side} · ${short(r.mint)} · Fee breakdown`;
 $('detail-note').textContent=totals.partial?'Only decoded fees are included in this known subtotal. Unavailable protocol or asset valuations are not assumed zero. Account rent is shown separately.':'Fee total includes protocol and network fees. Account rent is shown separately.';
 $('fee-breakdown').replaceChildren();
 const line=(label:string,value:string,cls='')=>{const item=document.createElement('div');item.className=`fee-line ${cls}`;const name=document.createElement('span'),amount=document.createElement('strong');name.textContent=label;amount.textContent=value;item.append(name,amount);$('fee-breakdown').append(item);};
 line(totals.partial?'Fee total · known subtotal':'Fee total',money(totals.total,f,unit,true),'fee-total');
 line(totals.partial?'Protocol fees · known subtotal':'Protocol fees · subtotal',f?.executionSucceeded===false?money('0',f,unit):f?.protocolFees.length?money(totals.protocol,f,unit,true):'Unavailable','fee-group');
 for(const fee of groupedFees(f))line(fee.label,feeMoney(fee,f,unit),'fee-child');
 if(totals.foreign)line('Non-SOL valuation','Unavailable','fee-child');
 line('Network · subtotal',money(f?.totalNetworkLamports,f,unit,true),'fee-group');
 line('Base',money(f?.baseNetworkLamports,f,unit,true),'fee-child');
 line('Priority',money(f?.priorityLamports,f,unit,true),'fee-child');
 for(const name of ['Jito tip','Our fee','Terminal fee'])line(name,f?.zeroExtraFeesVerified?money('0',f,unit):'Unverified','fee-zero');
 line('Account setup · rent deposit',money(f?.rentDepositedLamports,f,unit,true),'fee-group');
 line('Rent returned',money(f?.rentRefundedLamports,f,unit,true),'fee-child');
 if(!$<HTMLDialogElement>('details').open)$<HTMLDialogElement>('details').showModal();
}
function render(){
 const search=$<HTMLInputElement>('search').value.trim().toLowerCase(),side=$<HTMLSelectElement>('side').value;
 const filtered=receipts.filter(r=>(!side||r.side===side)&&(!search||`${r.wallet} ${r.mint} ${r.signature}`.toLowerCase().includes(search)));
 $('turnover-heading').textContent=unit;
 $('rows').replaceChildren();$('empty').hidden=filtered.length>0;
 for(const r of [...filtered].reverse()){
  const row=document.createElement('tr'),f=r.feeReceipt,totals=feeTotals(f);
  const cell=(text:string,cls='')=>{const td=document.createElement('td');td.textContent=text;td.className=cls;row.append(td);return td;};
  const drilldown=(td:HTMLElement,text:string)=>{const button=document.createElement('button');button.className='amount-button';button.textContent=text;button.title='Open itemized fees';button.addEventListener('click',()=>showDetails(r));td.append(button);};
  cell(new Date((f?.blockTime??r.createdAt/1000)*1000).toLocaleString('en-US'));
  const identity=cell(short(r.mint));identity.title=r.mint;const wallet=document.createElement('small');wallet.textContent=short(r.wallet);wallet.title=r.wallet;identity.append(wallet);
  cell(r.side,r.side==='BUY'?'positive':'negative');
  const turnover=cell(unit==='USD'?f?.volumeUsdMicros!==undefined?formatUsd(f.volumeUsdMicros):'Unpriced':money(f?.volumeLamports,f,unit));
  turnover.title=f?.usd?`${f.usd.source} · ${new Date(f.usd.capturedAt).toISOString()}`:'No historical USD price available';
  const subtotal=(value:string)=>totals.partial&&value.startsWith('$')?`≥ ${value}`:totals.partial&&value.endsWith(' SOL')?`≥ ${value}`:value;
  const totalCell=cell('');drilldown(totalCell,subtotal(money(totals.total,f,unit,true)));totalCell.title=totals.partial?'Known fee subtotal. Open the breakdown for unavailable components.':'Protocol plus network fees; rent is separate.';
  const protocol=cell('');drilldown(protocol,f?.protocolFees.length?subtotal(money(totals.protocol,f,unit,true)):f?.executionSucceeded===false?money('0',f,unit):'Unavailable');protocol.title='Open grouped protocol fee breakdown';
  cell(money(f?.totalNetworkLamports,f,unit,true));cell(f?.zeroExtraFeesVerified?money('0',f,unit):'Unverified','zero');cell(f?.zeroExtraFeesVerified?money('0',f,unit):'Unverified','zero');
  const linkCell=cell('');if(r.signature){const link=document.createElement('a');link.href=`https://solscan.io/tx/${encodeURIComponent(r.signature)}`;link.target='_blank';link.rel='noopener noreferrer';link.textContent=short(r.signature);linkCell.append(link);} $('rows').append(row);
 }
 const daily=new Map<string,bigint>();
 for(const r of filtered){const f=r.feeReceipt;if(!counted(r))continue;const raw=unit==='USD'?f?.volumeUsdMicros:f?.volumeLamports;if(raw===undefined)continue;const day=new Date((f?.blockTime??r.createdAt/1000)*1000).toISOString().slice(0,10);daily.set(day,(daily.get(day)??0n)+BigInt(raw));}
 $('chart').replaceChildren();const bars=document.createElement('div');bars.className='bars';const days=[...daily].sort(([a],[b])=>a.localeCompare(b)).slice(-30),max=days.reduce((v,[,x])=>x>v?x:v,1n);
 for(const [day,value]of days){const group=document.createElement('div'),bar=document.createElement('div'),label=document.createElement('small');group.className='bar-group';bar.className='bar';bar.style.height=`${Number(value*140n/max)}px`;bar.title=`${day}: ${unit==='USD'?formatUsd(value.toString()):`${formatAmount(value.toString())} SOL`}`;label.textContent=day.slice(5);group.append(bar,label);bars.append(group);}if(!days.length)bars.textContent='No priced verified volume yet.';$('chart').append(bars);
 const priced=receipts.filter(counted),sum=(field:'volumeUsdMicros'|'volumeLamports')=>priced.reduce((n,r)=>n+BigInt(r.feeReceipt?.[field]??'0'),0n);
 const volume=sum(unit==='USD'?'volumeUsdMicros':'volumeLamports');
 $('saved').textContent=unit==='USD'?formatUsd((volume/100n).toString()):`${formatAmount((volume/100n).toString())} SOL`;
 $('volume').textContent=unit==='USD'?formatUsd(volume.toString()):`${formatAmount(volume.toString())} SOL`;
 $('coverage').textContent=`${priced.length} priced · ${receipts.filter(r=>r.feeReceipt?.state==='VERIFIED'&&r.feeReceipt.executionSucceeded&&!counted(r)).length} unpriced trades`;
 $('count').textContent=String(receipts.length);$('verified').textContent='Local trade history';
 let network=0n,missing=0;
 for(const r of receipts){const f=r.feeReceipt;if(f?.totalNetworkLamports===undefined){missing++;continue;}if(unit==='USD'&&!f.usd&&BigInt(f.totalNetworkLamports)>0n){missing++;continue;}network+=BigInt(unit==='USD'?f.usd?volumeUsd(f.totalNetworkLamports,f.usd):'0':f.totalNetworkLamports);}
 $('network').textContent=`${unit==='USD'?formatUsd(network.toString()):`${formatAmount(network.toString())} SOL`}${missing?' · partial':''}`;
 $('network').title=missing?`${missing} receipts have missing fee or historical price data.`:'Actual network fees including priority; no double counting.';
}
async function load(){const response=await send({type:'HISTORY'});if(!response.ok)throw Error(response.error);receipts=response.receipts??[];render();if(selected){const updated=receipts.find(r=>r.signature===selected?.signature);if(updated)showDetails(updated);}}
$('refresh').title=refreshHelp;
$('refresh').addEventListener('click',async()=>{const button=$<HTMLButtonElement>('refresh');button.disabled=true;$('status').textContent='Refreshing receipt data…';try{for(const r of receipts.filter(r=>r.signature&&r.feeManifest?.length)){const result=await send({type:'VERIFY_FEES',wallet:r.wallet,signature:r.signature!});if(!result.ok)throw Error(result.error);}await load();$('status').textContent='Receipt data refreshed. No new trades were sent.';}catch(error){$('status').textContent=String(error);}finally{button.disabled=false;}});
for(const next of ['USD','SOL'] as const)$(`unit-${next.toLowerCase()}`).addEventListener('click',()=>{unit=next;for(const currency of ['USD','SOL'])$(`unit-${currency.toLowerCase()}`).setAttribute('aria-pressed',String(currency===unit));render();if(selected)showDetails(selected);});
$('search').addEventListener('input',render);$('side').addEventListener('change',render);$('close-details').addEventListener('click',()=>$<HTMLDialogElement>('details').close());$('details').addEventListener('close',()=>{selected=undefined;});
void load().catch(error=>{$('status').textContent=String(error.message);});
