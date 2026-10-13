import { browser,type Browser } from 'wxt/browser';
import type { MarketHint, PageTarget } from '../model';
import type { ChartEntry } from '../chart-entry';
import {canonicalJson,validateProSpecV2,type ProBalance,type ProHealth,type ProSettings,type ProSpec,type ProOrder,type ProEvent} from './contracts';
import { sendPro, mountProSettings } from './settings-view';
import { icon, solIcon } from '../icons';
import { amountToRaw, rawToAmount, percentageRaw, SOL_MINT } from './view';
import { mountWithdrawalView } from './withdrawal-view';
import { mountProWallet } from './wallet-view';
import { limitScale, relativeMc, relativeMcBps, signedPercent } from './limit';
import {usdUnits,unitsUsd} from './contracts';
import { parseMcInput, formatMc, marketCapUsd } from './mc';
import panelCss from './panel.css?inline';
import { mountProOnboarding } from './onboarding-view';

type Kind = 'MARKET'|'LIMIT'|'TAKE_PROFIT'|'STOP_LOSS'|'BRACKET'|'TRAILING'|'STRATEGY';
type Step = {id:string;kind:'TAKE_PROFIT'|'STOP_LOSS'|'TRAILING';targetMcUsd?:string;activationMcUsd?:string;trailingBps?:number;portionBps?:number;remaining?:true};
type Spec = Omit<ProSpec,'kind'> & {version:2;basis:'MC';kind:Kind;triggerMcUsd?:string;tpMcUsd?:string;slMcUsd?:string;activationMcUsd?:string;steps?:Step[];exitStrategy?:{steps:Step[];durationMs:number}};
import {PanelReview,isProSideControl,compactMcInput,expectedRemainingRaw,sameProSession,requireReviewSession,restorePendingOrder,pendingCancellationReview,pendingOrderAcknowledged,strategyAllocation,validateChartEntry,type ProSession,type PendingOrderReview} from './panel-review';
export {PanelReview,isProSideControl,compactMcInput,expectedRemainingRaw,sameProSession,requireReviewSession,restorePendingOrder,pendingCancellationReview,pendingOrderAcknowledged,strategyAllocation,validateChartEntry} from './panel-review';
export type {ProSession,PendingOrderReview} from './panel-review';
const compactAmount=(raw:string,decimals:number)=>rawToAmount(raw,decimals).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
const html = (value:string) => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function mountProPanel(container:HTMLElement, initial:PageTarget, chartEntry?:(entry:ChartEntry|undefined)=>void, options: {preview?: boolean} = {}){
  const preview=options.preview===true;
  const formId=`pro-ticket-${crypto.randomUUID()}`;
  container.innerHTML=`<style>${panelCss}</style><div class="pro-panel" data-preview="${preview}">
    <div class="pro-preview-notice" data-preview-notice hidden><div><strong>Pro preview</strong><p>Connect a server to trade.</p></div><button type="button" data-start-pro>Set up Pro</button></div>
    <div class="pro-mark"><strong data-mc>MC unavailable</strong><small data-source>Waiting for verified quote</small></div>
    <div class="pro-wallet"><span>Server wallet <span data-ready-badge role="img" aria-label="Signer ready, engine running" title="Signer ready, engine running" hidden>${icon('check')}</span></span><button type="button" class="pro-wallet-copy" data-copy-wallet disabled aria-label="Server wallet unavailable"><span data-address>Loading…</span>${icon('copy')}</button></div><div data-balance class="pro-balance">Loading available balance…</div>
    <div class="pro-engine"><p data-health class="pro-caption"></p><button type="button" data-resume-engine hidden>Resume engine</button></div>
    <p class="pro-notice" data-pending-notice role="status" hidden></p><p class="pro-status" data-status role="status" aria-live="polite"></p>
    <section data-view="trade" id="${formId}-trade" role="tabpanel" aria-labelledby="${formId}-trade-tab">
      <form data-ticket id="${formId}">
        <div class="pro-segments pro-sides"><button type="button" data-side="BUY" aria-pressed="true">Buy</button><button type="button" data-side="SELL" aria-pressed="false">Sell</button></div>
        <div class="pro-types" role="group" aria-label="Order type"></div>
        <label class="pro-amount"><span data-amount-label>Amount · SOL</span><input name="amount" inputmode="decimal" value="0.01" required autocomplete="off"></label><div class="pro-presets"></div><div data-conditions></div>
        <details data-protection><summary><span class="pro-protection-title">TP / SL</span><span data-protection-count></span></summary><div data-entry-steps></div><small data-entry-allocation></small><button type="button" data-add-entry>Add exit step</button></details>

      </form>
      <section data-review hidden aria-label="Order review"><h3>Review order</h3><dl data-review-summary></dl><button type="button" data-back>Back to ticket</button><button type="button" data-resolve-pending hidden>Review cancellation</button></section>
    </section>
    <section class="pro-order-section" data-view="orders" id="${formId}-orders" role="tabpanel" aria-labelledby="${formId}-orders-tab" hidden>
      <div class="pro-list-tools"><div class="pro-segments"><button type="button" data-list="orders" aria-pressed="true">Orders</button><button type="button" data-list="activity" aria-pressed="false">Activity</button></div><select data-scope aria-label="Order token filter"><option value="token">This token</option><option value="all">All tokens</option></select><button type="button" data-refresh aria-label="Refresh orders">Refresh</button></div><div data-orders></div><div data-events hidden></div>
    </section>
    <section data-withdraw data-view="wallet" id="${formId}-wallet" role="tabpanel" aria-labelledby="${formId}-wallet-tab" hidden></section>
    <section data-view="settings" id="${formId}-settings" role="tabpanel" aria-labelledby="${formId}-settings-tab" hidden><h2>Settings</h2>        <fieldset class="pro-execution"><legend>Execution</legend><div class="pro-fields"><label>Slippage %<input form="${formId}" name="slippage" value="1" inputmode="decimal"></label><label>Expires · hours<input form="${formId}" name="expires" value="24" type="number" min="0.017" max="720" step="any"></label><label><span class="pro-field-label">Priority fee ${solIcon()}</span><input form="${formId}" name="priority" value="0.0001" inputmode="decimal"></label><label><span class="pro-field-label">Network budget ${solIcon()}</span><input form="${formId}" name="budget" value="0.005" inputmode="decimal"></label></div></fieldset><div data-server-settings></div><a class="dp-feedback-link" href="https://t.me/+bWgImSypdyBiODNl" target="_blank" rel="noopener noreferrer">Send feedback ↗</a></section>
    <div class="pro-action-bar" data-action-bar><button data-review-button class="pro-primary" type="submit" form="${formId}">Review buy</button><button type="button" data-confirm class="pro-primary" hidden>Confirm & register</button></div>
    <div class="pro-tabs" role="tablist" aria-label="Pro sections">
      <button type="button" role="tab" data-pro-view="trade" id="${formId}-trade-tab" aria-controls="${formId}-trade" aria-selected="true">${icon('trade')}<span>Trade</span></button>
      <button type="button" role="tab" data-pro-view="orders" id="${formId}-orders-tab" aria-controls="${formId}-orders" aria-selected="false" tabindex="-1">${icon('orders')}<span>Orders</span></button>
      <button type="button" role="tab" data-pro-view="wallet" id="${formId}-wallet-tab" aria-controls="${formId}-wallet" aria-selected="false" tabindex="-1">${icon('wallet')}<span>Wallet</span></button>
      <button type="button" role="tab" data-pro-view="settings" id="${formId}-settings-tab" aria-controls="${formId}-settings" aria-selected="false" tabindex="-1">${icon('settings')}<span>Settings</span></button>
    </div>
  </div>`;
  const mountedRoot=container.querySelector<HTMLElement>('.pro-panel')!;
  const node=<T extends HTMLElement=HTMLElement>(key:string)=>container.querySelector<T>(key==='confirm'?'.pro-action-bar [data-confirm]':`[data-${key}]`)!;
  const setup=mountProOnboarding(container);
  node('preview-notice').hidden=!preview;
  const form=node<HTMLFormElement>('ticket');const field=(name:string)=>form.elements.namedItem(name) as HTMLInputElement;
  let alive=true,target={...initial},mint=initial.mintHint??(initial.kind==='MINT'?initial.address:''),side:'BUY'|'SELL'='BUY',kind:Kind='MARKET',busy=false,ready=false,settings:ProSettings|undefined,health:ProHealth|undefined,currentMc:string|undefined,quoteAt:number|undefined,hint:MarketHint|undefined,editing:{id:string;revision:number}|undefined,refreshing=false,epoch=0;
  let unconfirmedId:string|undefined,pendingKey:string|undefined,loadedPendingKey:string|undefined,durablePending:PendingOrderReview|undefined,pendingBlocked=false;
  let session:ProSession|undefined;
  let entrySnapshot:ChartEntry|undefined,entrySequence=0,entryReadBusy=false,entryReadQueued=false;
  const clearEntry=()=>{++entrySequence;entrySnapshot=undefined;chartEntry?.(undefined);};
  const publishEntry=()=>chartEntry?.(alive&&settings?.enabled&&!busy&&!durablePending&&!pendingBlocked&&!withdrawalPending&&!unknownOrders&&session?validateChartEntry(entrySnapshot,mint,session.wallet,90_000):undefined);
  let reviewedOperation:Pick<PendingOrderReview,'operation'|'revision'|'action'>={operation:'create'};
  let balanceDecimals:number|undefined,quoteTimer:number|undefined;
  let eventPort:Browser.runtime.Port|undefined,streamSession:string|undefined,eventCursor=0,reconnectTimer:number|undefined,coalesceTimer:number|undefined,refreshQueued=false,lastSyncAt=0;
  const verifiedSupply=new Map<string,{supplyRaw:string;decimals:number;at:number}>();
  const review=new PanelReview<ProSpec>(); const abort=new AbortController();
  type Destination='trade'|'orders'|'wallet'|'settings';
  let connectionSettings:ReturnType<typeof mountProSettings>|undefined;
  let destination:Destination='trade',unknownOrders=0,withdrawalPending=false;
  const pendingNotice=()=>{if(!alive)return;if(durablePending||withdrawalPending||unknownOrders||pendingBlocked)clearEntry();const messages=[durablePending?'Order outcome unconfirmed. Open Trade to review the saved intent.':'',unknownOrders?'Unresolved orders keep funds reserved. Check Orders.':'',withdrawalPending?'Unresolved withdrawal. Check Wallet before sending again.':''].filter(Boolean);node('pending-notice').textContent=messages.join(' ');node('pending-notice').hidden=!messages.length;};
  const wallet=mountProWallet(node('withdraw'),node<HTMLButtonElement>('copy-wallet'),()=>void refreshWallet());
  const withdrawalChanged=(pending:boolean)=>{if(pending&&!withdrawalPending){wallet.showWithdraw();refreshQueued=true;}withdrawalPending=pending;pendingNotice();};
  let withdrawals=preview?{refresh:async()=>{},destroy:()=>{}}:mountWithdrawalView(node('withdraw-content'),()=>mint,withdrawalChanged);
  if(preview){node('withdraw-content').innerHTML='<h3>Withdraw</h3><p>Connect your server to view available funds and withdraw.</p><button type="button" data-start-pro>Set up Pro</button>';node('deposit-address').textContent='Connect your server to get your deposit address.';node<HTMLButtonElement>('copy-deposit').disabled=false;node<HTMLButtonElement>('copy-wallet').disabled=false;node('orders').innerHTML='<p>Your server orders will appear here after setup.</p><button type="button" data-start-pro>Set up Pro</button>';node('events').textContent='Connect your server to see order activity.';}
  function selectView(next:Destination){destination=next;container.querySelector<HTMLElement>('.pro-panel')!.dataset.destination=next;container.querySelectorAll<HTMLElement>('[data-view]').forEach(panel=>{panel.hidden=panel.dataset.view!==next;});container.querySelectorAll<HTMLButtonElement>('[data-pro-view]').forEach(tab=>{const selected=tab.dataset.proView===next;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});node('action-bar').hidden=next!=='trade';pendingNotice();}
  async function refreshWallet(){if(health&&settings?.deviceId)try{await withdrawals.refresh(health,settings.enabled,settings.deviceId,wallet.withdrawalVisible());}catch(error){status(error instanceof Error?error.message:'Wallet unavailable.');}}
  async function navigate(next:Destination){if(next==='settings'&&destination!==next)connectionSettings?.collapseConnection();selectView(next);if(next==='settings'&&!connectionSettings&&!preview)connectionSettings=mountProSettings(node('server-settings'));if(next==='settings'&&preview)node('server-settings').innerHTML='<h3>Server connection</h3><p>Choose your own server or follow managed Pro launch updates.</p><button type="button" data-start-pro>Set up Pro</button>';if(next==='wallet'){if(withdrawalPending)wallet.showWithdraw();await refreshWallet();}}
  const captureSession=()=>{if(!session)throw new Error('Server wallet is still loading.');return structuredClone(session);};
  const api=async(method:string,path:string,body?:unknown,expectedSession?:ProSession)=>{
    if(preview){setup.open();throw new Error('Set up Pro before using server actions.');}
    const owner=method==='GET'?undefined:requireReviewSession(expectedSession??session,session);
    return sendPro({action:'REQUEST',method,path,body,...owner?{expectedSession:owner}:{}});
  };
  function refreshChartEntry(owner:ProSession,version:number){
    if(!chartEntry||!alive||document.hidden)return;
    if(!settings?.enabled||!health?.capabilities?.includes('chart-entry-v1')||!mint||busy||durablePending||pendingBlocked||withdrawalPending||unknownOrders){clearEntry();return;}
    // One detached read at a time, including across context changes. The worker
    // bounds the authenticated request; historical RPC must never hold the ticket refresh.
    if(entryReadBusy){entryReadQueued=true;return;}
    entryReadBusy=true;const requestedMint=mint,requestedEntrySequence=entrySequence;
    const current=()=>alive&&version===epoch&&mint===requestedMint&&entrySequence===requestedEntrySequence&&sameProSession(owner,session)&&settings?.serverId===owner.serverId&&settings?.deviceId===owner.deviceId;
    void api('GET',`/v1/chart-entry?mint=${encodeURIComponent(requestedMint)}`).then(value=>{
      if(!current())return;
      entrySnapshot=validateChartEntry(value,requestedMint,owner.wallet,90_000);publishEntry();
    }).catch(()=>{if(current())clearEntry();}).finally(()=>{
      entryReadBusy=false;
      if(entryReadQueued){entryReadQueued=false;if(alive&&session)refreshChartEntry(captureSession(),epoch);}
    });
  }
  const invalidate=()=>{review.invalidate();node('resolve-pending').hidden=true;node('review').hidden=true;form.hidden=false;node('review-button').hidden=false;node('confirm').hidden=true;};
  const status=(message:string)=>{if(alive)node('status').textContent=message;};
  const controls=()=>{if(!alive||container.querySelector('.pro-panel')!==mountedRoot)return;pendingNotice();const healthy=ready&&health?.engine==='RUNNING';mountedRoot.dataset.ready=String(healthy);node('ready-badge').hidden=!healthy;for(const name of ['slippage','expires','priority','budget'])field(name).disabled=busy||Boolean(durablePending)||pendingBlocked;node<HTMLButtonElement>('back').disabled=busy||Boolean(durablePending);node<HTMLButtonElement>('resolve-pending').disabled=busy;node<HTMLButtonElement>('review-button').disabled=busy||(!ready&&!preview)||!mint||Boolean(durablePending)||pendingBlocked;let bindingValid=false;try{bindingValid=sameProSession(review.current().session,session);}catch{/* No accepted review. */}node<HTMLButtonElement>('confirm').disabled=busy||!ready||pendingBlocked||!bindingValid;syncLimit();};
  const run=async(job:()=>Promise<void>)=>{if(!alive)return;if(preview){setup.open();return;}if(busy)return;busy=true;clearEntry();controls();try{await job();}catch(error){status(error instanceof Error?error.message:'Pro request failed.');}finally{busy=false;controls();}};
  const setMcField=(name:string,value:string|undefined)=>{const input=field(name);input.value=value?compactMcInput(value):'';input.title=value?`Exact MC ${value}`:'';if(name==='trigger')syncLimit();};
  const mcInput=(name:string,label:string)=>`<label>${label}<input name="${name}" inputmode="decimal" placeholder="250K" required autocomplete="off"></label>`;
  function applyRelative(percent:number){
    if(kind!=='LIMIT'||busy||durablePending||pendingBlocked)return;
    const current=liveMc(),scale=limitScale(side);
    if(!current||percent<scale.min||percent>scale.max)return;
    invalidate();setMcField('trigger',relativeMc(current,percent));
  }
  function syncLimit(){
    if(kind!=='LIMIT'||!field('targetSlider'))return;
    const current=liveMc(),scale=limitScale(side),slider=field('targetSlider');
    const locked=busy||Boolean(durablePending)||pendingBlocked;
    node('limit-current').textContent=current?`Current MC ${formatMc(current)}`:'Current MC unavailable';
    slider.disabled=!current||locked;
    container.querySelectorAll<HTMLButtonElement>('[data-relative]').forEach(button=>{button.disabled=!current||locked;button.setAttribute('aria-pressed','false');});
    node('limit-slider').hidden=false;
    node('limit-note').textContent=current?'':'Enter Target MC directly, or wait for a current MC.';
    node('limit-percent').textContent='Choose target';
    if(!current)return;
    try{
      const target=parseMcInput(field('trigger').value),bps=relativeMcBps(current,target);
      node('limit-percent').textContent=signedPercent(bps/100);
      const custom=bps<scale.min*100||bps>scale.max*100;
      node('limit-slider').hidden=custom;
      node('limit-note').textContent=custom?'Custom target · outside slider range. Choose a preset to return.':'';
      if(!custom){slider.value=String(Math.round(bps/100));slider.setAttribute('aria-valuetext',`${signedPercent(bps/100)} · Target MC ${formatMc(target)}`);}
      container.querySelectorAll<HTMLButtonElement>('[data-relative]').forEach(button=>{
        button.setAttribute('aria-pressed',String(usdUnits(relativeMc(current,Number(button.dataset.relative)))===usdUnits(target)));
      });
    }catch{node('limit-percent').textContent='Choose target';}
  }
  function stepRow(parent:HTMLElement, values?:Partial<Step>){
    if(parent.children.length>=10){status('Maximum 10 exit steps.');return;}
    const row=document.createElement('div');row.className='pro-step';row.dataset.id=values?.id??crypto.randomUUID();
    row.innerHTML=`<label class="pro-step-type">Exit type<select aria-label="Exit type"><option value="TAKE_PROFIT">Take profit</option><option value="STOP_LOSS">Stop loss</option><option value="TRAILING">Trailing</option></select></label><label><span data-step-label>Target MC</span><input data-step-target placeholder="250K" inputmode="decimal" aria-label="Exit target MC"></label><label>Portion %<input data-step-portion value="25" inputmode="decimal" aria-label="Strategy start quantity percentage"></label><label class="pro-check"><input data-step-remaining type="checkbox"> All remaining</label><label data-step-activation hidden>Activation MC (optional)<input data-step-activation-value inputmode="decimal" placeholder="Immediate"></label><button type="button" data-remove aria-label="Remove exit step" title="Remove exit step">${icon('x')}</button>`;
    const select=row.querySelector('select')!;const targetField=row.querySelector<HTMLInputElement>('[data-step-target]')!;
    const update=()=>{row.querySelector<HTMLInputElement>('[data-step-portion]')!.disabled=row.querySelector<HTMLInputElement>('[data-step-remaining]')!.checked;const trailing=select.value==='TRAILING';row.querySelector<HTMLElement>('[data-step-label]')!.textContent=trailing?'Drawdown %':'Target MC';row.querySelector<HTMLElement>('[data-step-activation]')!.hidden=!trailing;};
    if(values){select.value=values.kind??'TAKE_PROFIT';targetField.value=values.kind==='TRAILING'?String((values.trailingBps??500)/100):values.targetMcUsd?compactMcInput(values.targetMcUsd):'';if(values.targetMcUsd)targetField.title=`Exact MC ${values.targetMcUsd}`;row.querySelector<HTMLInputElement>('[data-step-portion]')!.value=String((values.portionBps??2500)/100);row.querySelector<HTMLInputElement>('[data-step-remaining]')!.checked=values.remaining===true;const activation=row.querySelector<HTMLInputElement>('[data-step-activation-value]')!;activation.value=values.activationMcUsd?compactMcInput(values.activationMcUsd):'';if(values.activationMcUsd)activation.title=`Exact MC ${values.activationMcUsd}`;}
    select.addEventListener('change',()=>{targetField.value='';update();invalidate();updateAllocations();});row.querySelector('[data-step-remaining]')!.addEventListener('change',update);row.querySelector('[data-remove]')!.addEventListener('click',()=>{row.remove();invalidate();updateAllocations();});update();parent.append(row);updateAllocations();
  }
  function steps(parent:HTMLElement):Step[]{
    const result=[...parent.children].map(element=>{const row=element as HTMLElement;const input=(key:string)=>row.querySelector<HTMLInputElement>(`[data-step-${key}]`)!;const step:Step={id:row.dataset.id!,kind:row.querySelector('select')!.value as Step['kind']};if(input('remaining').checked)step.remaining=true;else step.portionBps=Math.round(Number(input('portion').value)*100);if(step.kind==='TRAILING'){step.trailingBps=Math.round(Number(input('target').value)*100);if(input('activation-value').value)step.activationMcUsd=parseMcInput(input('activation-value').value);}else step.targetMcUsd=parseMcInput(input('target').value);return step;});
    return result;
  }
  function updateAllocations(){node('protection-count').textContent=node('entry-steps').children.length?`${node('entry-steps').children.length} ${node('entry-steps').children.length===1?'exit':'exits'}`:'';
    for(const [source,output]of [['steps','allocation'],['entry-steps','entry-allocation']] as const){
      const parent=container.querySelector<HTMLElement>(`[data-${source}]`),summary=container.querySelector<HTMLElement>(`[data-${output}]`);if(!parent||!summary)continue;
      const rows=[...parent.children].map(element=>{const row=element as HTMLElement;return {kind:row.querySelector('select')!.value as Step['kind'],portionBps:Math.round(Number(row.querySelector<HTMLInputElement>('[data-step-portion]')!.value)*100),remaining:row.querySelector<HTMLInputElement>('[data-step-remaining]')!.checked?true as const:undefined,id:row.dataset.id!};});
      summary.textContent=strategyAllocation(rows);if(side==='SELL'&&balanceDecimals!==undefined){try{const raw=amountToRaw(field('amount').value,balanceDecimals);summary.textContent+=` · Start ${compactAmount(raw,balanceDecimals)} tokens`;for(const kind of ['TAKE_PROFIT','STOP_LOSS','TRAILING'] as const){const path=rows.filter(row=>row.kind===kind);if(!path.length)continue;const allocated=path.some(row=>row.remaining)?10000:path.reduce((sum,row)=>sum+(row.portionBps??0),0);if(Number.isInteger(allocated)&&allocated<=10000)summary.textContent+=` · ${kind==='TAKE_PROFIT'?'TP':kind==='STOP_LOSS'?'SL':'Trailing'} residual ${compactAmount(expectedRemainingRaw(raw,path),balanceDecimals)} tokens`;}}catch{/* Amount is incomplete while editing. */}}
    }
  }
  function renderTicket(preserveEdit=false){
    field('amount').readOnly=false;invalidate();if(!preserveEdit)editing=undefined;field('amount').value=side==='BUY'?'0.01':'';
    node('amount-label').innerHTML=side==='BUY'?`Amount ${solIcon()}`:'Amount · token units';
    node('protection').hidden=side!=='BUY';node('review-button').textContent=`Review ${side.toLowerCase()}`;node('review-button').dataset.side=side;
    container.querySelectorAll<HTMLButtonElement>('.pro-sides [data-side]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.side===side)));
    const types:Kind[]=side==='BUY'?['MARKET','LIMIT']:['MARKET','LIMIT','BRACKET','TRAILING','STRATEGY'];const labels:Record<string,string>={MARKET:'Market',LIMIT:'Limit',BRACKET:'TP·SL',TRAILING:'Trailing',STRATEGY:'Split exit'};
    container.querySelector('.pro-types')!.classList.toggle('pro-types-sell',side==='SELL');
    container.querySelector('.pro-types')!.innerHTML=types.map(type=>`<button type="button" data-kind="${type}" aria-pressed="${kind===type}">${labels[type]}</button>`).join('');
    container.querySelector('.pro-presets')!.innerHTML=(side==='BUY'?['0.01','0.05','0.1','0.5']:['25','50','75','100']).map(value=>`<button type="button" data-preset="${value}">${value}${side==='SELL'?'%':solIcon()}</button>`).join('');
    const scale=limitScale(side);
    const conditions=node('conditions');conditions.innerHTML=kind==='LIMIT'?`<div class="pro-limit-target">${mcInput('trigger','Target MC')}<small data-limit-current></small></div><div class="pro-mc-chips" role="group" aria-label="Target MC presets">${scale.presets.map(p=>`<button type="button" data-relative="${p}" aria-pressed="false">${signedPercent(p)}</button>`).join('')}</div><div class="pro-limit-heading"><label for="${formId}-slider">Change from current MC</label><output data-limit-percent></output></div><div data-limit-slider><input id="${formId}-slider" name="targetSlider" aria-label="Change from current MC" type="range" min="${scale.min}" max="${scale.max}" value="${scale.initial}" step="1"><div class="pro-limit-ticks" aria-hidden="true">${scale.ticks.map(p=>`<span style="--tick-position:${(p-scale.min)/(scale.max-scale.min)*100}%">${signedPercent(p)}</span>`).join('')}</div></div><small data-limit-note></small>`:kind==='BRACKET'?`<label>Protection<select name="protectionMode"><option value="both">Take profit + stop loss</option><option value="tp">Take profit only</option><option value="sl">Stop loss only</option></select></label><div class="pro-fields">${mcInput('tp','Take profit MC')}${mcInput('sl','Stop loss MC')}</div>`:kind==='TRAILING'?`<div class="pro-fields"><label>Drawdown %<input name="trailing" value="5" inputmode="decimal" required></label><label>Start tracking<select name="trailMode"><option value="immediate">Immediately</option><option value="activation">At target MC</option></select></label><label data-activation hidden>Activation MC<input name="activation" placeholder="250K" inputmode="decimal"></label></div><small>Tracks the highest verified MC, then sells on drawdown.</small>`:kind==='STRATEGY'?`<div data-steps></div><small data-allocation></small><div class="pro-step-tools"><button type="button" data-add>Add step</button><button type="button" data-template>25 / 25 / 50</button></div><small>Portions use strategy start quantity. Steps share the remaining balance.</small>`:'';
    if(kind==='STRATEGY')stepRow(node('steps'));if(kind==='LIMIT'&&liveMc())setMcField('trigger',relativeMc(liveMc()!,scale.initial));syncLimit();updateAllocations();controls();
  }
  container.addEventListener('input',event=>{const input=event.target as HTMLInputElement;if(input.form!==form)return;if(input.name==='targetSlider'){applyRelative(Number(input.value));return;}if(input.name==='trigger')syncLimit();if(['trigger','tp','sl','activation'].includes(input.name)||input.hasAttribute('data-step-activation-value')||input.hasAttribute('data-step-target')&&input.closest('.pro-step')?.querySelector('select')?.value!=='TRAILING'){try{input.title=`Exact MC ${parseMcInput(input.value)}`;}catch{input.title='';}}invalidate();updateAllocations();});
  container.addEventListener('change',event=>{if((event.target as HTMLInputElement).form!==form)return;invalidate();const name=(event.target as HTMLInputElement).name;if(name==='protectionMode'){const mode=field(name).value;field('tp').closest('label')!.hidden=mode==='sl';field('tp').required=mode!=='sl';field('sl').closest('label')!.hidden=mode==='tp';field('sl').required=mode!=='tp';}if(name==='trailMode')node('activation').hidden=field(name).value==='immediate';if(name==='targetSlider')applyRelative(Number(field(name).value));});
  container.addEventListener('click',event=>{const button=(event.target as Element).closest<HTMLButtonElement>('button');if(!button)return;
    if(button.dataset.proView){void navigate(button.dataset.proView as Destination);return;}
    if(durablePending&&(isProSideControl(button)||button.dataset.kind||button.dataset.preset||button.hasAttribute('data-add')||button.hasAttribute('data-template')))return;
    if(isProSideControl(button)){side=button.dataset.side as typeof side;kind='MARKET';renderTicket();}
    if(button.dataset.kind){kind=button.dataset.kind as Kind;renderTicket();}
    if(button.dataset.preset&&preview&&side==='BUY'){invalidate();field('amount').value=button.dataset.preset;}
    else if(button.dataset.preset)void run(async()=>{invalidate();const version=review.version();if(side==='BUY')field('amount').value=button.dataset.preset!;else{const balance=await paymentBalance();if(!alive||version!==review.version())return;field('amount').value=compactAmount(percentageRaw(balance.availableRaw,Number(button.dataset.preset)),balance.decimals);updateAllocations();status('Quantity frozen from a fresh confirmed available balance.');}});
    if(button.dataset.relative)applyRelative(Number(button.dataset.relative));
    if(button.hasAttribute('data-add')){stepRow(node('steps'));invalidate();}
    if(button.hasAttribute('data-add-entry')){stepRow(node('entry-steps'));invalidate();}
    if(button.hasAttribute('data-template')){node('steps').replaceChildren();[25,25,50].forEach((portion,i)=>stepRow(node('steps'),{kind:'TAKE_PROFIT',portionBps:portion*100,targetMcUsd:liveMc()?unitsUsd(usdUnits(liveMc()!)*BigInt(120+i*30)/100n):''}));invalidate();}
    if(button===node('back')&&!unconfirmedId){invalidate();field('amount').focus();}
    if(button.dataset.list){const orders=button.dataset.list==='orders';node('orders').hidden=!orders;node('events').hidden=orders;container.querySelectorAll('[data-list]').forEach(b=>b.setAttribute('aria-pressed',String((b as HTMLElement).dataset.list===button.dataset.list)));}
  },{signal:abort.signal});
  container.addEventListener('focusin',event=>{
    const input=event.target as HTMLElement;if(!input.matches('input,select'))return;
    requestAnimationFrame(()=>{if(!alive)return;const rect=input.getBoundingClientRect(),bar=node('action-bar').getBoundingClientRect();const bottom=node('action-bar').hidden?container.querySelector('.pro-tabs')!.getBoundingClientRect().top-16:bar.top-16;
      if(rect.bottom>bottom)window.scrollBy({top:rect.bottom-bottom,behavior:'auto'});else if(rect.top<12)window.scrollBy({top:rect.top-12,behavior:'auto'});
    });
  },{signal:abort.signal});
  async function paymentBalance():Promise<ProBalance>{const version=epoch;const data=await api('GET',`/v1/wallet?mint=${encodeURIComponent(mint)}`) as ProBalance[]|{balances:ProBalance[]};if(!alive||version!==epoch)throw new Error('Token changed. Review again.');const rows=Array.isArray(data)?data:data.balances;const balance=rows.find(b=>b.mint===(side==='BUY'?SOL_MINT:mint));if(!balance)throw new Error('Confirmed balance or token decimals unavailable.');balanceDecimals=balance.decimals;updateAllocations();return balance;}
  form.addEventListener('submit',event=>{event.preventDefault();if(destination!=='trade')return;void run(async()=>{
    if(durablePending||pendingBlocked)throw new Error('Resolve the saved order outcome before starting a new review.');
    const owner=captureSession();invalidate();const version=review.version();const balance=await paymentBalance();if(version!==review.version())throw new Error('Ticket changed. Review again.');
    const spec:Spec={version:2,basis:'MC',kind,side,target:{...target},mint,amountRaw:amountToRaw(field('amount').value,balance.decimals),decimals:balance.decimals,expiresAt:Date.now()+Math.round(Number(field('expires').value)*3600000),slippageBps:Math.round(Number(field('slippage').value)*100),priorityFeeLamports:field('priority').value==='0'?0:Number(amountToRaw(field('priority').value,9)),maxNetworkLamports:amountToRaw(field('budget').value,9)};
    if(kind==='LIMIT')spec.triggerMcUsd=parseMcInput(field('trigger').value);
    if(kind==='BRACKET'){const mode=field('protectionMode').value;spec.kind=mode==='tp'?'TAKE_PROFIT':mode==='sl'?'STOP_LOSS':'BRACKET';if(mode==='tp')spec.triggerMcUsd=parseMcInput(field('tp').value);else if(mode==='sl')spec.triggerMcUsd=parseMcInput(field('sl').value);else{spec.tpMcUsd=parseMcInput(field('tp').value);spec.slMcUsd=parseMcInput(field('sl').value);}}
    if(kind==='TRAILING'){spec.trailingBps=Math.round(Number(field('trailing').value)*100);if(field('trailMode').value==='activation')spec.activationMcUsd=parseMcInput(field('activation').value);}
    if((kind==='STRATEGY'||side==='BUY'&&node('entry-steps').children.length>0)&&!health?.capabilities?.includes('exit-strategies-v2'))throw new Error('Server upgrade required for exit strategies.');if(kind==='STRATEGY')spec.steps=steps(node('steps'));if(side==='BUY'&&node('entry-steps').children.length>0)spec.exitStrategy={steps:steps(node('entry-steps')),durationMs:86400000};
    validateProSpecV2(spec);const preview=await api('POST','/v2/preview',{spec},owner) as {spec:Spec;summary:{marketCapUsd:string;quoteAt:number;supplyRaw:string;tokenDecimals:number}};
    if(!alive)return;if(canonicalJson(validateProSpecV2(preview.spec))!==canonicalJson(validateProSpecV2(spec)))throw new Error('Server review differs from the requested order. Review again.');requireReviewSession(owner,session);review.accept(preview.spec,version,editing?.id,owner);verifiedSupply.set(spec.mint,{supplyRaw:preview.summary.supplyRaw,decimals:preview.summary.tokenDecimals,at:preview.summary.quoteAt});reviewedOperation=editing?{operation:'edit',revision:editing.revision}:{operation:'create'};currentMc=preview.summary.marketCapUsd;quoteAt=preview.summary.quoteAt;renderMark();if(quoteTimer!==undefined)window.clearTimeout(quoteTimer);quoteTimer=window.setTimeout(renderMark,Math.max(0,2001-(Date.now()-quoteAt)));renderReview(preview.spec);status('Automatic server execution. Confirm registers this reviewed order.');
  });});
  function renderReview(spec:ProSpec,recovered=false){
    const mode=reviewedOperation.operation==='retry'?`Review ${reviewedOperation.action==='cancel'?'cancellation':'authorization retry'}`:reviewedOperation.operation==='edit'?'Review order edit':'Review order';
    node('review').querySelector('h3')!.textContent=mode;
    const targets=[spec.triggerMcUsd&&['Target MC',spec.triggerMcUsd],spec.tpMcUsd&&['Take profit MC',spec.tpMcUsd],spec.slMcUsd&&['Stop loss MC',spec.slMcUsd],spec.activationMcUsd&&['Activation MC',spec.activationMcUsd]].filter(Boolean);
    node('review-summary').innerHTML=`<div><dt>Order</dt><dd>${spec.side} ${html(spec.kind.replaceAll('_',' '))}</dd></div><div><dt>Token</dt><dd>${html(spec.mint)}</dd></div><div><dt>Quantity</dt><dd>${html(compactAmount(spec.amountRaw,spec.decimals))} ${spec.side==='BUY'?solIcon():'tokens'}</dd></div><div><dt>Wallet</dt><dd>${html(review.current().session?.wallet??durablePending?.wallet??'Unavailable')}</dd></div>${!recovered&&currentMc?`<div><dt>Quote MC</dt><dd>${html(formatMc(currentMc))}</dd></div>`:''}${targets.map(row=>{const[label,value]=row as string[];return `<div><dt>${label}</dt><dd>${html(formatMc(value!))}</dd></div>`;}).join('')}${spec.trailingBps?`<div><dt>Drawdown</dt><dd>${spec.trailingBps/100}%</dd></div>`:''}${(spec.steps??spec.exitStrategy?.steps??[]).map(step=>`<div><dt>${step.kind.replaceAll('_',' ')}</dt><dd>${step.remaining?'All remaining':`${(step.portionBps??0)/100}%`} · ${step.targetMcUsd?html(formatMc(step.targetMcUsd)):`${(step.trailingBps??0)/100}% drawdown${step.activationMcUsd?` from MC ${html(formatMc(step.activationMcUsd))}`:' · immediate'}`}</dd></div>`).join('')}${spec.steps?.length?`<div><dt>Strategy start</dt><dd>${compactAmount(spec.amountRaw,spec.decimals)} tokens · fixed</dd></div>`:''}${(spec.steps??spec.exitStrategy?.steps)?.length?`<div><dt>Exit allocations</dt><dd>${html(strategyAllocation(spec.steps??spec.exitStrategy!.steps))}</dd></div>`:''}${spec.steps?(['TAKE_PROFIT','STOP_LOSS','TRAILING'] as const).map(kind=>{const path=spec.steps!.filter(step=>step.kind===kind);return path.length?`<div><dt>${kind==='TAKE_PROFIT'?'TP':kind==='STOP_LOSS'?'SL':'Trailing'} residual</dt><dd>${compactAmount(expectedRemainingRaw(spec.amountRaw,path),spec.decimals)} tokens</dd></div>`:'';}).join(''):''}${spec.exitStrategy?`<div><dt>Protection quantity</dt><dd>Actual confirmed buy fill</dd></div><div><dt>Protection lifetime</dt><dd>${spec.exitStrategy.durationMs/3600000}h after confirmed entry</dd></div>`:''}<div><dt>Slippage</dt><dd>${spec.slippageBps/100}%</dd></div><div><dt>Priority fee</dt><dd>${compactAmount(String(spec.priorityFeeLamports),9)} ${solIcon()}</dd></div>${spec.version===2&&spec.exitStrategy?`<div><dt>Entry network cap</dt><dd>${compactAmount(spec.maxNetworkLamports,9)} ${solIcon()}</dd></div><div><dt>Protection network cap</dt><dd>${compactAmount(spec.maxNetworkLamports,9)} ${solIcon()}</dd></div><div><dt>Upfront reserve</dt><dd>${compactAmount(String(BigInt(spec.amountRaw)+2n*BigInt(spec.maxNetworkLamports)),9)} ${solIcon()}</dd></div>`:`<div><dt>Network cap</dt><dd>${compactAmount(spec.maxNetworkLamports,9)} ${solIcon()}</dd></div>`}<div><dt>Expires</dt><dd>${new Date(spec.expiresAt).toLocaleString()}</dd></div>${spec.version!==2?'<div><dt>Legacy order</dt><dd>Existing conditions preserved</dd></div>':''}`;
    form.hidden=true;node('review').hidden=false;node('review-button').hidden=true;node('confirm').hidden=false;node('action-bar').hidden=destination!=='trade';
    node('confirm').dataset.side=spec.side;node('confirm').textContent=recovered?'Check status & retry same intent':reviewedOperation.operation==='retry'?`Confirm ${reviewedOperation.action==='cancel'?'cancellation':'retry'}`:reviewedOperation.operation==='edit'?'Confirm reviewed edit':'Confirm & register';
    node('resolve-pending').hidden=!(durablePending?.operation==='create'&&durablePending.spec.version===2&&reviewedOperation.action!=='cancel');node<HTMLButtonElement>('back').disabled=Boolean(durablePending);const heading=node('review').querySelector<HTMLElement>('h3')!;heading.tabIndex=-1;if(destination==='trade'){heading.focus({preventScroll:true});heading.scrollIntoView({block:'start',behavior:'auto'});}
  }
  async function clearPending(key=pendingKey){if(key)await browser.storage.local.remove(key);if(key!==pendingKey)return;durablePending=undefined;unconfirmedId=undefined;node<HTMLButtonElement>('back').disabled=false;}
  async function reconcilePending(orders:ProOrder[],intent=durablePending){
    if(!intent)return false;const contextVersion=epoch,owner=requireReviewSession(intent,session);
    const existing=orders.find(order=>order.id===intent.id);if(!existing)return false;
    if(existing.wallet!==intent.wallet||canonicalJson(existing.spec)!==canonicalJson(intent.spec)){
      // An edit that has not reached the server still returns the previous revision.
      if(intent.operation==='edit'&&existing.revision===intent.revision)return false;
      pendingBlocked=true;throw new Error('Pending order ID has different server intent. Check server history before changing the saved review.');
    }
    if(!pendingOrderAcknowledged(intent,existing))return false;
    await clearPending();if(!alive||contextVersion!==epoch||!sameProSession(owner,session))return true;invalidate();editing=undefined;status('Previously reviewed request is recorded on the server.');return true;
  }
  node('resolve-pending').addEventListener('click',()=>void run(async()=>{
    if(!durablePending)throw new Error('No saved creation intent remains.');
    const original=structuredClone(durablePending),owner=requireReviewSession(original,session),contextVersion=epoch;
    const data=await api('GET','/v2/orders') as ProOrder[]|{orders:ProOrder[]};
    if(!alive||contextVersion!==epoch)return;requireReviewSession(owner,session);
    const cancellation=pendingCancellationReview(original,(Array.isArray(data)?data:data.orders).find(order=>order.id===original.id));
    reviewedOperation={operation:'retry',revision:cancellation.revision,action:'cancel'};review.invalidate();review.accept(cancellation.spec,review.version(),cancellation.id,owner);renderReview(cancellation.spec);
    status('Confirm cancellation to fence this original order ID on the signer. Funds stay locked unless cancellation is acknowledged.');
  }));
  node('confirm').addEventListener('click',()=>void run(async()=>{
    const approved=review.current(),contextVersion=epoch,owner=requireReviewSession(review.current().session,session);
    if(!settings?.deviceId||!health?.wallet||!pendingKey)throw new Error('Server wallet is still loading.');const intentKey=pendingKey;
    if(durablePending){
      const data=await api('GET',durablePending.spec.version===2?'/v2/orders':'/v1/orders') as ProOrder[]|{orders:ProOrder[]};
      requireReviewSession(owner,session);const intent={...durablePending,...reviewedOperation};if(await reconcilePending(Array.isArray(data)?data:data.orders,intent))return;
    }
    if(!alive||contextVersion!==epoch)return;
    if(approved.spec.expiresAt<=Date.now()&&!durablePending)throw new Error('Review expired. Review the order again.');
    requireReviewSession(owner,session);const pending:PendingOrderReview=durablePending?{...durablePending,...reviewedOperation}:{id:approved.id,spec:approved.spec,...owner,...reviewedOperation};
    if(pending.id!==approved.id||canonicalJson(pending.spec)!==canonicalJson(approved.spec))throw new Error('A different order outcome remains unconfirmed.');
    await browser.storage.local.set({[intentKey]:pending});if(!alive||intentKey!==pendingKey||!sameProSession(owner,session))return;durablePending=structuredClone(pending);unconfirmedId=pending.id;node<HTMLButtonElement>('back').disabled=true;controls();if(contextVersion!==epoch){reviewedOperation={operation:pending.operation,revision:pending.revision,action:pending.action};review.invalidate();review.accept(pending.spec,review.version(),pending.id,pending);renderReview(pending.spec,true);return;}
    const version=pending.spec.version===2?'v2':'v1';
    try{
      if(pending.operation==='edit')await api('PATCH',`/${version}/orders/${pending.id}`,{revision:pending.revision,spec:pending.spec},owner);
      else if(pending.operation==='retry'){const result=await api('POST',`/${version}/orders/${pending.id}/retry`,{revision:pending.revision,spec:pending.spec,action:pending.action},owner) as ProOrder;if(!pendingOrderAcknowledged(pending,result))throw new Error('Requested authorization outcome is not yet acknowledged.');}
      else await api('POST',pending.spec.kind==='STRATEGY'?'/v2/strategies':'/v2/orders',{orderId:pending.id,spec:pending.spec},owner);
      // Keep the record on navigation; a remount will reconcile this same UUID.
      if(!alive||contextVersion!==epoch||intentKey!==pendingKey)return;
      await clearPending(intentKey);invalidate();editing=undefined;status('Reviewed request accepted.');await refresh();
    }catch(error){if(alive&&contextVersion===epoch&&intentKey===pendingKey)renderReview(pending.spec,true);throw new Error(`Outcome unconfirmed for ${pending.id}. Check status and retry the same saved intent. ${error instanceof Error?error.message:''}`);}
  }));
  function liveMc(){return currentMc&&quoteAt&&Date.now()-quoteAt<=2000?currentMc:hint?.marketCapUsd;}
  function renderMark(){
    const fresh=Boolean(currentMc&&quoteAt&&Date.now()-quoteAt<=2000),value=fresh?currentMc:hint?.marketCapUsd??currentMc;
    node('mc').textContent=`MC ${value?formatMc(value):'unavailable'}`;
    syncLimit();
    node('source').textContent=fresh?'Server quote · just verified':hint?.marketCapUsd?`${hint.source} · provisional`:currentMc?`Last server quote · ${quoteAt?new Date(quoteAt).toLocaleTimeString():'time unavailable'} · stale`:'Review to obtain a verified MC quote';
  }
  function renderOrders(rows:ProOrder[]){unknownOrders=rows.filter(order=>order.state==='UNKNOWN').length;pendingNotice();const list=node('orders');list.replaceChildren();for(const order of rows.filter(o=>node<HTMLSelectElement>('scope').value==='all'||o.spec.mint===mint)){const spec=order.spec as unknown as Spec,orderSession=captureSession();const row=document.createElement('article');row.className='pro-order';const title=document.createElement('strong');title.textContent=`${spec.side} ${spec.kind.replaceAll('_',' ')}`;const heading=document.createElement('div');heading.className='pro-order-heading';const state=document.createElement('span');state.className='pro-order-state';state.dataset.state=order.state;state.textContent=order.state;heading.append(title,state);row.append(heading);const text=document.createElement('p');text.innerHTML=`${html(compactAmount(spec.amountRaw,spec.decimals))} ${spec.side==='BUY'?solIcon():'tokens'}${spec.version===2?'':' · Legacy order · cancel to replace'}${spec.triggerMcUsd?` · MC ${html(formatMc(spec.triggerMcUsd))}`:''}${spec.tpMcUsd?` · TP ${html(formatMc(spec.tpMcUsd))}`:''}${spec.slMcUsd?` · SL ${html(formatMc(spec.slMcUsd))}`:''}`;row.append(text);
    if(spec.version!==2){const conversion=document.createElement('small'),supply=verifiedSupply.get(spec.mint);const values:[string,string|undefined][]=[['Target',spec.triggerPriceUsd],['TP',spec.tpPriceUsd],['SL',spec.slPriceUsd],['Activation',spec.activationPriceUsd]];
      conversion.textContent=supply?`Legacy MC equivalent · ${values.filter(([,value])=>value).map(([label,value])=>`${label} ${formatMc(marketCapUsd(value!,supply.supplyRaw,supply.decimals))}`).join(' · ')||'Market order'} · supply verified ${new Date(supply.at).toLocaleTimeString()}`:'Trigger MC unavailable · legacy USD intent preserved';row.append(conversion);
    }
    const reason=document.createElement('small');reason.textContent=[order.reason,order.state==='UNKNOWN'?'Outcome unknown. Reserved funds remain locked.':'',order.protectionPending?'Entry protection pending.':''].filter(Boolean).join(' ');row.append(reason);
    const trail=order as ProOrder&{highWatermarkMcUsd?:string;currentMcUsd?:string};if(spec.kind==='TRAILING'){const detail=document.createElement('p');detail.textContent=`${order.trailActive?'Tracking':'Awaiting activation'} · High MC ${trail.highWatermarkMcUsd?formatMc(trail.highWatermarkMcUsd):'unavailable'} · Current MC ${trail.currentMcUsd?formatMc(trail.currentMcUsd):'unavailable'} · Trigger MC ${trail.highWatermarkMcUsd&&spec.trailingBps?formatMc(unitsUsd(usdUnits(trail.highWatermarkMcUsd)*BigInt(10000-spec.trailingBps)/10000n)):'unavailable'}`;row.append(detail);}
    if(spec.version===2&&spec.mint===mint&&['OPEN','PAUSED','BLOCKED'].includes(order.state)){
      const edit=document.createElement('button');edit.type='button';edit.textContent='Edit';edit.disabled=!settings?.enabled;
      edit.addEventListener('click',()=>{if(busy||durablePending||!sameProSession(orderSession,session))return;selectView('trade');side=spec.side;balanceDecimals=spec.decimals;kind=['TAKE_PROFIT','STOP_LOSS'].includes(spec.kind)?'BRACKET':spec.kind;renderTicket();editing={id:order.id,revision:order.revision};field('amount').value=compactAmount(spec.amountRaw,spec.decimals);field('amount').readOnly=spec.kind==='STRATEGY'&&Boolean(order.strategy);field('slippage').value=String(spec.slippageBps/100);field('priority').value=rawToAmount(String(spec.priorityFeeLamports),9);field('budget').value=rawToAmount(spec.maxNetworkLamports,9);field('expires').value=String(Math.max(.017,(spec.expiresAt-Date.now())/3600000));
      if(kind==='LIMIT')setMcField('trigger',spec.triggerMcUsd);
      if(kind==='BRACKET'){field('protectionMode').value=spec.kind==='TAKE_PROFIT'?'tp':spec.kind==='STOP_LOSS'?'sl':'both';setMcField('tp',spec.tpMcUsd??(spec.kind==='TAKE_PROFIT'?spec.triggerMcUsd:undefined));setMcField('sl',spec.slMcUsd??(spec.kind==='STOP_LOSS'?spec.triggerMcUsd:undefined));for(const [name,show]of [['tp',spec.kind!=='STOP_LOSS'],['sl',spec.kind!=='TAKE_PROFIT']] as const){field(name).required=show;field(name).closest('label')!.hidden=!show;}}
      if(kind==='TRAILING'){field('trailing').value=String((spec.trailingBps??500)/100);field('trailMode').value=spec.activationMcUsd?'activation':'immediate';node('activation').hidden=!spec.activationMcUsd;setMcField('activation',spec.activationMcUsd);}
      if(kind==='STRATEGY'){container.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button=>button.disabled=Boolean(order.strategy));node('steps').replaceChildren();(spec.steps??[]).forEach(step=>stepRow(node('steps'),step));for(const element of node('steps').children){const row=element as HTMLElement;if(order.strategy?.steps.some(step=>step.id===row.dataset.id&&step.state==='FINALIZED')){row.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('input,select,button').forEach(control=>control.disabled=true);const caption=document.createElement('small');caption.textContent='Executed step · fixed';row.append(caption);}}}
      node('entry-steps').replaceChildren();if(spec.exitStrategy){spec.exitStrategy.steps.forEach(step=>stepRow(node('entry-steps'),step));}
      updateAllocations();status('Editing unexecuted order. Review before confirming. Trailing edit resets its watermark.');form.scrollIntoView?.({block:'start'});});row.append(edit);
    }
    const progress=order as ProOrder&{strategy?:{remainingRaw:string;steps:{id:string;state:string}[]}};
    if(progress.strategy){const detail=document.createElement('p');detail.textContent=`Remaining ${rawToAmount(progress.strategy.remainingRaw,spec.decimals)} tokens · ${progress.strategy.steps.map(step=>step.state).join(' / ')}`;row.append(detail);}
    if(order.pendingAction){
      for(const requested of [order.pendingAction,'cancel'] as const){
        const button=document.createElement('button');button.type='button';button.textContent=requested==='cancel'?'Review cancellation':'Review authorization retry';button.disabled=!settings?.enabled;
        button.addEventListener('click',()=>void run(async()=>{
          if(durablePending)throw new Error('Resolve the saved order outcome first.');
          selectView('trade');const owner=captureSession(),reviewVersion=review.version(),contextVersion=epoch;const data=await api('GET',spec.version===2?'/v2/orders':'/v1/orders') as ProOrder[]|{orders:ProOrder[]};
          if(!alive||contextVersion!==epoch||reviewVersion!==review.version())throw new Error('Context changed. Review the authorization again.');const fresh=(Array.isArray(data)?data:data.orders).find(candidate=>candidate.id===order.id);
          requireReviewSession(owner,session);if(!fresh?.pendingAction)throw new Error('Pending authorization changed. Refresh orders.');
          if(requested!=='cancel'&&requested!==fresh.pendingAction)throw new Error('Pending action changed. Review again.');
          reviewedOperation={operation:'retry',revision:fresh.revision,action:requested};editing=undefined;review.invalidate();review.accept(fresh.spec,review.version(),fresh.id,owner);renderReview(fresh.spec);status(`Review ${requested==='cancel'?'cancelling':'retrying'} the exact pending ${fresh.pendingAction} intent. No new order ID is created.`);
        }));row.append(button);
      }
    }
    for(const action of order.pendingAction?[]:order.state==='PAUSED'?['resume','cancel']:['OPEN','BLOCKED'].includes(order.state)?['pause','cancel']:[]){const button=document.createElement('button');button.type='button';button.textContent=action[0]!.toUpperCase()+action.slice(1);button.disabled=!settings?.enabled;button.addEventListener('click',()=>void run(async()=>{await api('POST',`/${spec.version===2?'v2':'v1'}/orders/${order.id}/${action}`,{revision:order.revision},orderSession);await refresh();}));row.append(button);}const actions=[...row.querySelectorAll(':scope>button')];if(actions.length){const group=document.createElement('div');group.className='pro-order-actions';group.append(...actions);row.append(group);}list.append(row);}if(!list.children.length)list.textContent='No orders for this token.';}
  function stopEvents(){
    if(reconnectTimer!==undefined)window.clearTimeout(reconnectTimer);reconnectTimer=undefined;
    if(coalesceTimer!==undefined)window.clearTimeout(coalesceTimer);coalesceTimer=undefined;refreshQueued=false;
    const old=eventPort;eventPort=undefined;old?.disconnect();
  }
  function startEvents(session=streamSession){
    if(!alive||document.hidden||!settings?.enabled||!session||!browser.runtime?.connect)return;
    if(session!==streamSession){stopEvents();streamSession=session;eventCursor=0;}
    if(eventPort||reconnectTimer!==undefined)return;
    try{
      const port=browser.runtime.connect({name:'pro-events'});eventPort=port;
      port.onMessage.addListener((message:{type?:string;event?:ProEvent})=>{
        if(!alive||eventPort!==port||document.hidden||message.type!=='PRO_EVENT'||!message.event||!Number.isSafeInteger(message.event.sequence)||message.event.sequence<=eventCursor)return;
        clearEntry();eventCursor=message.event.sequence;
        if(coalesceTimer!==undefined)return;
        coalesceTimer=window.setTimeout(()=>{coalesceTimer=undefined;if(refreshing)refreshQueued=true;else void refresh();},200);
      });
      port.onDisconnect.addListener(()=>{if(eventPort!==port)return;eventPort=undefined;if(coalesceTimer!==undefined)window.clearTimeout(coalesceTimer);coalesceTimer=undefined;
        if(alive&&!document.hidden&&settings?.enabled)reconnectTimer=window.setTimeout(()=>{reconnectTimer=undefined;startEvents();},2000);
      });
      port.postMessage({type:'WATCH',after:eventCursor});
    }catch{eventPort=undefined;if(alive&&!document.hidden)reconnectTimer=window.setTimeout(()=>{reconnectTimer=undefined;startEvents();},2000);}
  }
  function resetSession(next:ProSession|undefined){
    clearEntry();epoch++;session=next?structuredClone(next):undefined;ready=false;stopEvents();streamSession=undefined;eventCursor=0;
    if(quoteTimer!==undefined)window.clearTimeout(quoteTimer);currentMc=undefined;quoteAt=undefined;verifiedSupply.clear();balanceDecimals=undefined;
    durablePending=undefined;unconfirmedId=undefined;pendingKey=undefined;loadedPendingKey=undefined;pendingBlocked=true;editing=undefined;
    withdrawals.destroy();withdrawalPending=false;unknownOrders=0;withdrawals=mountWithdrawalView(node('withdraw-content'),()=>mint,withdrawalChanged);wallet.update();selectView('trade');
    renderTicket();node('entry-steps').replaceChildren();updateAllocations();renderMark();
  }
  async function refresh(){
    if(!alive||refreshing||document.hidden)return;if(preview){node('health').textContent='Preview · server not connected';node('address').textContent='Not connected';node('balance').textContent='Available balance appears after setup.';controls();return;}refreshing=true;let version=epoch,balanceLoaded=false;
    try{
      const nextSettings=await sendPro({action:'SETTINGS'}) as ProSettings;if(!alive||version!==epoch)return;
      if(session&&(nextSettings.serverId!==session.serverId||nextSettings.deviceId!==session.deviceId)){resetSession(undefined);version=epoch;}
      settings=nextSettings;
      if(!settings.deviceId||!settings.serverId){wallet.update();clearEntry();ready=false;node('health').textContent='Pair your personal server in Settings.';node('balance').textContent='Pair server to load available balance.';return;}
      const nextHealth=await api('GET','/v1/health') as ProHealth;if(!alive||version!==epoch)return;
      if(nextHealth.serverId!==settings.serverId)throw new Error('Server identity changed. Pair the server again.');
      const nextSession:ProSession={serverId:nextHealth.serverId,deviceId:settings.deviceId,wallet:nextHealth.wallet};
      if(!sameProSession(session,nextSession)){resetSession(nextSession);version=epoch;}
      health=nextHealth;const owner=captureSession();const nextStreamSession=`${owner.serverId}:${owner.deviceId}:${owner.wallet}`;
      if(streamSession!==nextStreamSession){stopEvents();streamSession=nextStreamSession;eventCursor=0;}
      ready=settings.enabled&&health.signer==='READY'&&health.capabilities?.includes('mc-orders-v2')===true;
      node('health').textContent=health.capabilities?.includes('mc-orders-v2')?`Signer ${health.signer} · Engine ${health.engine}`:'Server upgrade required for MC orders.';
      node('resume-engine').hidden=!settings.enabled||health.signer!=='READY'||health.engine==='RUNNING';wallet.update({key:`${owner.serverId}:${owner.deviceId}:${owner.wallet}`,address:owner.wallet});
      pendingKey=`proOrderPending:${owner.serverId}:${owner.deviceId}:${owner.wallet}`;
      if(loadedPendingKey!==pendingKey){
        durablePending=undefined;unconfirmedId=undefined;pendingBlocked=true;const stored=(await browser.storage.local.get(pendingKey))[pendingKey];if(!alive||version!==epoch)return;requireReviewSession(owner,session);
        loadedPendingKey=pendingKey;pendingBlocked=false;
        if(stored!==undefined){try{durablePending=restorePendingOrder(stored,owner);unconfirmedId=durablePending.id;reviewedOperation={operation:durablePending.operation,revision:durablePending.revision,action:durablePending.action};review.invalidate();review.accept(durablePending.spec,review.version(),durablePending.id,owner);renderReview(durablePending.spec,true);status('A saved order outcome is unconfirmed. New registration waits for reconciliation.');}catch(error){pendingBlocked=true;throw error;}}
      }
      const balanceRequest=api('GET','/v1/wallet').then(balances=>{
        if(!alive||version!==epoch)return;requireReviewSession(owner,session);
        const rows=Array.isArray(balances)?balances as ProBalance[]:(balances as {balances:ProBalance[]}).balances,sol=rows.find(balance=>balance.mint===SOL_MINT);
        if(!sol)throw new Error('Confirmed SOL balance unavailable.');
        node('balance').innerHTML=`<span data-stat="available"><small>Available</small><strong>${html(compactAmount(sol.availableRaw,9))} ${solIcon()}</strong></span><span data-stat="reserved"><small>Reserved</small><strong>${html(compactAmount(sol.reservedRaw,9))} ${solIcon()}</strong></span>`;balanceLoaded=true;
      });
      const results=await Promise.allSettled([balanceRequest,api('GET',health.capabilities?.includes('mc-orders-v2')?'/v2/orders':'/v1/orders'),api('GET','/v1/events?latest=30'),withdrawals.refresh(health,settings.enabled,settings.deviceId,destination==='wallet'&&wallet.withdrawalVisible())]);
      if(!alive||version!==epoch)return;requireReviewSession(owner,session);
      const orders=results[1].status==='fulfilled'?results[1].value:undefined,events=results[2].status==='fulfilled'?results[2].value:undefined;
      if(orders!==undefined){
      const orderRows=Array.isArray(orders)?orders as ProOrder[]:(orders as {orders:ProOrder[]}).orders;
      await reconcilePending(orderRows);if(!alive||version!==epoch)return;requireReviewSession(owner,session);renderOrders(orderRows);
      }else node('orders').textContent='Orders unavailable. Refresh to retry.';
      if(events!==undefined){
      const timeline=Array.isArray(events)?events as ProEvent[]:(events as {events:ProEvent[]}).events;eventCursor=Math.max(eventCursor,...timeline.map(event=>event.sequence));startEvents(nextStreamSession);node('events').replaceChildren();
      for(const event of timeline.slice(-30).reverse()){const row=document.createElement('p');row.textContent=`${new Date(event.at).toLocaleTimeString()} · ${event.message}`;node('events').append(row);}if(!timeline.length)node('events').textContent='No activity yet.';
      }else node('events').textContent='Activity unavailable. Refresh to retry.';
      const failure=results.find(result=>result.status==='rejected');if(failure?.status==='rejected')throw failure.reason;lastSyncAt=Date.now();
      refreshChartEntry(owner,version);
    }catch(error){if(alive&&version===epoch){clearEntry();ready=false;if(!balanceLoaded)node('balance').textContent='Balance unavailable. Reconnecting…';status(error instanceof Error?error.message:'Server unavailable.');}}
    finally{refreshing=false;controls();if(alive&&(version!==epoch||refreshQueued)){refreshQueued=false;void refresh();}}
  }
  container.addEventListener('click',event=>{const element=event.target as Element;if(element.closest('[data-start-pro]')){event.preventDefault();setup.open();return;}if(preview&&element.closest('[data-review-button],[data-confirm],[data-copy-wallet],[data-copy-deposit],[data-refresh],.pro-execution input')){event.preventDefault();event.stopImmediatePropagation();setup.open();}},{capture:true,signal:abort.signal});
  if(preview)for(const name of ['slippage','expires','priority','budget'])field(name).readOnly=true;
  container.addEventListener('keydown',event=>{const key=event as KeyboardEvent;if(preview&&(event.target as Element).closest('.pro-execution input')&&!key.ctrlKey&&!key.metaKey&&(key.key.length===1||['Enter','Backspace','Delete','ArrowUp','ArrowDown'].includes(key.key))){event.preventDefault();event.stopImmediatePropagation();setup.open();}},{capture:true,signal:abort.signal});
  container.addEventListener('submit',event=>{if(preview){event.preventDefault();event.stopImmediatePropagation();setup.open();}},{capture:true,signal:abort.signal});
  node('resume-engine').addEventListener('click',()=>void run(async()=>{if(!settings?.enabled||health?.signer!=='READY')throw new Error('Unlock the server signer before resuming.');await api('POST','/v1/resume-engine',{});await refresh();status(health?.engine==='RUNNING'?'Engine running. Paused orders remain paused.':'Engine start is unconfirmed. Check server state before trading.');}));
  node('refresh').addEventListener('click',()=>void refresh());node('scope').addEventListener('change',()=>void refresh());
  container.addEventListener('invalid',event=>{const input=event.target as HTMLInputElement;if(input.form!==form||form.contains(input))return;event.preventDefault();selectView('settings');input.focus();status(`Check ${input.name} in Settings. ${input.validationMessage}`);},{capture:true,signal:abort.signal});
  container.addEventListener('keydown',event=>{if(destination==='settings'&&(event as KeyboardEvent).key==='Enter'&&(event.target as HTMLInputElement).form===form)event.preventDefault();},{signal:abort.signal});
  container.querySelector('.pro-tabs')!.addEventListener('keydown',event=>{
    const key=(event as KeyboardEvent).key;if(!['ArrowLeft','ArrowRight','Home','End'].includes(key))return;
    const tabs=[...container.querySelectorAll<HTMLButtonElement>('[data-pro-view]')],current=tabs.indexOf(event.target as HTMLButtonElement);if(current<0)return;
    event.preventDefault();const index=key==='Home'?0:key==='End'?tabs.length-1:(current+(key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    void navigate(tabs[index]!.dataset.proView as Destination);tabs[index]!.focus();
  },{signal:abort.signal});
  renderTicket();void refresh();const timer=window.setInterval(()=>{publishEntry();renderMark();if(!eventPort||!ready||health?.engine!=='RUNNING'||Date.now()-lastSyncAt>=60000)void refresh();},15000);const visible=()=>{if(document.hidden){stopEvents();clearEntry();}else void refresh();};document.addEventListener('visibilitychange',visible,{signal:abort.signal});
  return {refresh,openSettings(){void navigate('settings');},update(next:PageTarget,nextMint?:string,market?:MarketHint){const changed=JSON.stringify(target)!==JSON.stringify(next)||mint!==(nextMint??(next.mintHint??(next.kind==='MINT'?next.address:'')));target={...next};mint=nextMint??(next.mintHint??(next.kind==='MINT'?next.address:''));hint=market;if(changed){clearEntry();epoch++;if(quoteTimer!==undefined)window.clearTimeout(quoteTimer);currentMc=undefined;quoteAt=undefined;renderTicket();if(durablePending){reviewedOperation={operation:durablePending.operation,revision:durablePending.revision,action:durablePending.action};review.accept(durablePending.spec,review.version(),durablePending.id,durablePending);renderReview(durablePending.spec,true);}node('entry-steps').replaceChildren();updateAllocations();void refresh();}renderMark();controls();},destroy(){setup.destroy();clearEntry();alive=false;epoch++;ready=false;stopEvents();review.invalidate();abort.abort();withdrawals.destroy();wallet.destroy();connectionSettings?.destroy();window.clearInterval(timer);if(quoteTimer!==undefined)window.clearTimeout(quoteTimer);if(container.querySelector('.pro-panel')===mountedRoot)container.replaceChildren();}};
}
