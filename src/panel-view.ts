import { icon } from './icons';
import type { PositionSnapshot, MarketHint, Receipt } from './model';
import { projectPosition } from './position-view';
import { redactUrls } from './errors';
import { formatAmount, formatUsd } from './savings';
import { feeTotals, groupedFees, money, feeMoney } from './dashboard-fees';

export function createPanelView(container: HTMLElement) {
  const host = document.createElement('div');
  host.style.cssText = 'display:block;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial;--surface:#11161d;--border:#29313c;--muted:#9da9ba;--mint:#88f0bb;--rose:#f7a9bc;color:#eff3f8;font:13px/1.5 system-ui,sans-serif;color-scheme:dark}
    *{box-sizing:border-box}section{width:100%;overflow:auto;background:var(--surface);padding:18px}
    header{display:flex;align-items:center;gap:7px}header strong{flex:1;font-size:13px;font-weight:700;letter-spacing:.7px}header strong:before{content:'';display:inline-block;width:6px;height:6px;margin-right:8px;background:var(--mint);border-radius:50%;vertical-align:2px}
    small{color:var(--muted);font-size:11px}p{margin:10px 0;overflow-wrap:anywhere}.token{display:block;text-align:center;font:13px ui-monospace,monospace;color:#e4eaf2;margin:20px 0 16px;text-decoration:none}
    button,input{font:inherit;border:1px solid var(--border);border-radius:9px;background:#1a212b;color:inherit;padding:9px;min-height:38px}
    button{cursor:pointer;font-weight:600;transition:background .12s,border-color .12s}button:hover{border-color:#66758a;background:#25303c}button:disabled{cursor:wait;opacity:.45}button:focus-visible,input:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--mint);outline-offset:3px}
    .icon{width:28px;min-height:28px;padding:4px;background:transparent;border-color:transparent;color:var(--muted)}.icon svg{width:18px;height:18px;display:block;margin:auto}.icon:hover{color:#eff3f8;background:#222b36}
    .wallet-row{display:flex;align-items:center;gap:7px;margin-bottom:22px;padding:9px 10px;background:#171e27;border:1px solid #232d39;border-radius:10px}.connect{flex:1}.wallet{flex:1;color:#b8c8d9;font:11px ui-monospace,monospace}.wallet:before{content:'';display:inline-block;width:5px;height:5px;background:var(--mint);border-radius:50%;margin-right:7px}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:9px 0 10px}.sells{grid-template-columns:repeat(4,minmax(0,1fr))}.buy{background:#18352a;border-color:#2b5140;color:var(--mint)}.buy:hover{background:#214c3a;border-color:#73ba95}.sell{background:#30212b;border-color:#4b303e;color:var(--rose)}.sell:hover{background:#47303c;border-color:#ae738b}
    .custom{display:flex;gap:7px;margin-bottom:22px}.custom input{width:100%;min-width:0;background:#0d1218;font-variant-numeric:tabular-nums}.custom input::placeholder{color:#778597}.custom button{white-space:nowrap;padding:9px 15px}
    .status{border:1px solid #2b394b;border-radius:9px;background:#172332;padding:10px;font-size:11px;color:#afbdd0;min-height:18px;max-height:96px;overflow:auto;margin:17px 0 8px}
    .status.error{background:#3a1e29;border-color:#b25470;color:#ffd4df;font-size:12px;font-weight:600}.status.success{background:#172d23;border-color:#335c43;color:#a7efc7}
    details{font-size:11px;color:#c1cbd8;margin-top:6px}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:130px;overflow:auto;background:#0c1118;padding:8px;border-radius:6px}
    a{color:var(--mint)}label{display:block;font-size:10px;font-weight:700;letter-spacing:1px;color:var(--muted)}footer{border-top:1px solid var(--border);padding-top:13px;margin-top:15px}footer strong{display:block;color:#c4d0df;font-size:11px;font-weight:600}footer small{font-size:10px}.explorer{font-size:11px}
    .savings{margin:0;border:1px solid #2a4536;border-radius:10px;background:#15241d;padding:10px}.savings summary{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:10px;color:#b5d3c2}.savings summary:before{content:'▸';color:var(--mint)}.savings[open] summary:before{content:'▾'}.savings summary span{flex:1}.savings summary strong{color:var(--mint);font-size:15px}.savings-note{display:block;margin:10px 0;font-size:9px}.savings-details{font-size:10px;min-height:28px;padding:5px 10px;background:#20362a;border-color:#315941}.position{margin-top:14px;padding:11px;background:#171f29;border:1px solid #2b3644;border-radius:9px}.position div{display:flex;justify-content:space-between;gap:10px;padding:3px 0;font-size:11px}.position span{color:#a9b7c7}.position strong{font-variant-numeric:tabular-nums}.position small{display:block;font-size:9px;margin-top:6px}.positive{color:var(--mint)}.negative{color:var(--rose)}
    .fee-receipt{margin-top:15px;padding:12px;border:1px solid var(--border);border-radius:12px;background:#0d1218}.receipt-head{display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border);padding-bottom:9px}.receipt-head strong{flex:1;font-size:12px}dl{margin:9px 0}.fee-rows div{display:flex;justify-content:space-between;gap:10px;padding:4px 0;font-size:10px}.fee-rows dt{color:#b5c1d2}.fee-rows dd{margin:0;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;max-width:145px}.fee-rows .zero{background:#172a20;padding:7px 8px;margin-top:4px;border-radius:6px;font-weight:700}.fee-rows .zero dt,.fee-rows .zero dd{color:var(--mint)}.fee-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.fee-actions a{font-size:9px}
    .fee-summary{width:100%;border-collapse:collapse;margin:12px 0;font-size:10px}.fee-summary th{text-align:left;color:var(--muted);font-size:9px;font-weight:500;padding-bottom:6px}.fee-summary td{vertical-align:top;font-variant-numeric:tabular-nums}.fee-summary button{padding:0;border:0;background:none;min-height:24px;font-size:10px;text-align:left;color:#e5edf4;text-decoration:underline;text-decoration-color:#536777;text-underline-offset:3px}.fee-zero-summary{display:flex;justify-content:space-between;gap:9px;background:#172a20;border-radius:6px;padding:8px;font-size:10px;color:var(--mint)}.fee-zero-summary strong{margin-left:4px}.fee-breakdown{margin-top:12px}.fee-breakdown summary{font-size:10px;color:var(--muted)}
    @media(prefers-reduced-motion:reduce){button{transition:none}}[hidden]{display:none!important}
  </style>
  <section aria-label="Direct Pump trading" >
    <header><button class="icon settings" aria-label="Settings" title="Trading settings">${icon('settings')}</button><strong>DIRECT PUMP</strong></header>
    <div class="panel-body">
    <a class="token" target="_blank" rel="noopener noreferrer"></a>
    <div class="wallet-row"><button class="connect" title="Connect Phantom to this site">Connect Phantom</button><span class="wallet" hidden></span></div>
    <label>BUY · SOL</label><div class="grid buys"></div>
    <div class="custom"><input aria-label="Buy amount in SOL" inputmode="decimal" placeholder="Custom amount" maxlength="20"><button class="buy custom-buy">Buy</button></div>
    <label>SELL · Receive SOL</label><div class="grid sells"></div>
    <div class="position" role="region" aria-label="Position" hidden><div><span>Position Value</span><strong class="position-value">—</strong></div><div><span>Est. net PnL</span><strong class="position-pnl">—</strong></div><small class="position-source"></small></div>
    <p class="status" role="status" aria-live="polite">Checking Phantom connection…</p>
    <div class="fee-receipt" role="region" aria-label="Execution fee receipt" hidden>
      <div class="receipt-head"><strong class="receipt-title"></strong></div>
      <table class="fee-summary"><thead><tr><th>Fee total</th><th>Protocol fees</th><th>Network</th></tr></thead><tbody><tr><td><button class="fee-total-value"></button></td><td><button class="fee-protocol-value"></button></td><td class="fee-network-value"></td></tr></tbody></table>
      <div class="fee-zero-summary"><span>Our fee <strong class="our-fee"></strong></span><span>Terminal fee <strong class="terminal-fee"></strong></span></div>
      <details class="fee-breakdown"><summary>Fee breakdown</summary><dl class="fee-rows"></dl></details>
      <div class="fee-actions"><a class="explorer" hidden target="_blank" rel="noopener noreferrer">VIEW ON SOLSCAN ↗</a></div>
    </div>
    <footer><details class="savings" open><summary><span>Fee Saved</span><strong class="saved-usd">$0.00</strong></summary><small class="savings-note">1% of tracked USD volume</small><button class="savings-details">Details ↗</button></details></footer>
    </div>
  </section>`;
  container.append(host);
  const $ = <T extends HTMLElement>(selector: string) => shadow.querySelector<T>(selector)!;
  function renderPosition(position?: PositionSnapshot, market?: MarketHint){
    $('.position').hidden=!position||BigInt(position.balanceRaw)===0n;
    if(!position||BigInt(position.balanceRaw)===0n)return;
    const view=projectPosition(position,market,true);
    $('.position-value').textContent=view.value?formatUsd(view.value):'Unavailable';
    const pnl=$('.position-pnl');pnl.className='position-pnl';
    if(view.pnl!==undefined&&view.bps!==undefined){
      const value=BigInt(view.pnl),bps=BigInt(view.bps),abs=value<0n?-value:value,pct=bps<0n?-bps:bps;
      pnl.textContent=`${value<0n?'-':'+'}${formatUsd(abs.toString())} (${bps<0n?'-':'+'}${pct/100n}.${(pct%100n).toString().padStart(2,'0')}%)`;
      pnl.classList.add(value<0n?'negative':'positive');
    }else pnl.textContent='Unavailable';
    pnl.title=redactUrls(view.note);$('.position-source').textContent=view.source;$('.position-source').title=redactUrls(view.note);
  }
  function renderFees(receipt: Receipt) {
    $('.fee-receipt').hidden=!receipt.signature;
    if(!receipt.signature) return false;
    const f=receipt.feeReceipt;
    const needsFees=!f||f.state==='PENDING';
    $('.receipt-title').textContent=receipt.side==='BUY'?(receipt.inputAmount?`BUY ${formatAmount(receipt.inputAmount)} SOL`:'BUY · SOL'):f?.volumeLamports?`SELL → ${formatAmount(f.volumeLamports)} SOL`:'SELL · Receive SOL';
    const totals=feeTotals(f),amount=(raw?:string)=>money(raw,f,'USD',true);
    const partial=(value:string)=>totals.partial&&value.startsWith('$')?`≥ ${value}`:value;
    $('.fee-total-value').textContent=partial(amount(totals.total));
    $('.fee-total-value').title=totals.partial?'Known fee subtotal: only decoded fees are included. Unknown protocol or asset valuations are not assumed zero. Rent is separate.':'Open fee breakdown';
    $('.fee-protocol-value').textContent=f?.protocolFees.length?partial(amount(totals.protocol)):'Unavailable';
    $('.fee-network-value').textContent=amount(f?.totalNetworkLamports);
    const extra=f?.zeroExtraFeesVerified?'$0.00':'Unavailable';$('.our-fee').textContent=extra;$('.terminal-fee').textContent=extra;
    const rows=$('.fee-rows');rows.replaceChildren();
    const row=(label:string,value:string,zero=false,title='')=>{const el=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;dd.title=title;el.append(dt,dd);if(zero)el.className='zero';rows.append(el);};
    row(totals.partial?'Known protocol subtotal':'Protocol subtotal',f?.protocolFees.length?amount(totals.protocol):'Unavailable');
    for(const fee of groupedFees(f))row(fee.label,feeMoney(fee,f,'USD'));
    row('Network · subtotal',amount(f?.totalNetworkLamports));
    row('Base',amount(f?.baseNetworkLamports));row('Priority',amount(f?.priorityLamports));
    row('Account setup · rent deposit',amount(f?.rentDepositedLamports));row('Rent returned',amount(f?.rentRefundedLamports));
    row('Jito tip',extra);row('Our fee',extra,true);row('Terminal fee',extra,true);
    return needsFees;
  }
  return { host, shadow, $, renderPosition, renderFees };
}
