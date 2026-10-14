/** Synthetic browser regressions; no provider requests, funded accounts or signing. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export default async function verifyProTrading(page,baseUrl='http://127.0.0.1:5173'){
 const checks=[],captures=[],errors=[];
 const assert=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
 page.on('pageerror',error=>errors.push(String(error)));
 await page.context().route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const orders=()=>page.evaluate(()=>window.mockRequests.filter(r=>r.type==='PRO'&&r.method==='POST'&&r.path==='/v2/orders'));
 const visit=async(query,width=390,height=600)=>{
  if(page.url().startsWith(baseUrl))await page.evaluate(()=>{localStorage.removeItem('dp-pro-mock-storage');localStorage.removeItem('dp-pro-mock-orders');sessionStorage.removeItem('dp-pro-preview');});
  await page.setViewportSize({width,height});await page.goto(`${baseUrl}/preview/sidepanel.html?${query}`);
  await page.locator('[data-active-profile] option').waitFor({state:'attached'});await page.locator('[data-review-button]:not([disabled])').waitFor();await page.evaluate(()=>document.fonts.ready);
 };
 const waitOrders=async(count)=>page.waitForFunction(count=>window.mockRequests.filter(r=>r.type==='PRO'&&r.method==='POST'&&r.path==='/v2/orders').length===count,count);
 const capture=async(name)=>{const path=`output/playwright/pro-features/${name}.png`;await page.screenshot({path,fullPage:true,animations:'disabled'});captures.push(path);};
 try {
 for(const site of ['gmgn','axiom','fomo']){
  await visit(`pro=on&site=${site}`);
  await page.locator('[data-preset="0.05"]').dblclick();await waitOrders(1);
  let sent=await orders();assert(sent.length===1&&sent[0].body.spec.amountRaw==='50000000',`${site}: market preset double click creates exactly one exact SOL buy`);
  assert(await page.locator('[data-view=trade] [data-review]').isHidden(),`${site}: default market order has no confirmation screen`);
  if(site==='axiom')assert(sent[0].body.spec.target.kind==='POOL',`${site}: immediate trade preserves POOL identity`);
  await page.getByRole('button',{name:'Sell',exact:true}).click();await page.getByRole('button',{name:'Buy',exact:true}).click();await page.getByRole('button',{name:'Limit',exact:true}).click();
  await page.locator('[name=trigger]').fill('250K');await page.locator('[data-review-button]').click();await page.locator('[data-view=trade] [data-review]').waitFor({state:'visible'});
  assert((await orders()).length===1,`${site}: default Limit requires confirmation`);
  await page.locator('.pro-action-bar [data-confirm]').click();await waitOrders(2);sent=await orders();assert(sent[1].body.spec.kind==='LIMIT'&&sent[1].body.spec.triggerMcUsd==='250000.000000000000',`${site}: confirmed Limit preserves its exact MC target`);
 }
 await visit('pro=on');await page.locator('[data-protection]').evaluate(el=>{el.open=true;});await page.locator('[data-add-entry]').click();await page.locator('[data-entry-steps] [data-step-target]').fill('600K');await page.locator('[data-review-button]').click();await page.locator('[data-view=trade] [data-review]').waitFor({state:'visible'});assert((await orders()).length===0,'Attached exit strategy still requires explicit review under default instant market settings');assert(await page.locator('[data-skip-confirm]').isHidden(),'Attached strategy cannot disable its required review');
 await visit('pro=on&pro-confirm-market');await page.locator('[data-preset="0.1"]').click();await page.locator('[data-view=trade] [data-review]').waitFor({state:'visible'});
 assert((await orders()).length===0,'Market confirmation ON blocks registration before Confirm');
 await page.locator('[data-skip-confirm-value]').check();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dp-pro-mock-storage')??'{}').proTradingPreferences?.confirmMarket===false);
 assert((await orders()).length===0,'Skip future confirmations changes only preferences, never sends the current order');
 await page.locator('.pro-action-bar [data-confirm]').click();await waitOrders(1);
 await page.reload();await page.locator('[data-review-button]:not([disabled])').waitFor();assert((await orders()).length===0,'Reload does not automatically repeat a registered immediate order');
 await page.locator('[data-preset="0.05"]').click();await waitOrders(1);assert(await page.locator('[data-view=trade] [data-review]').isHidden(),'Market confirmation preference survives reload');
 await visit('pro=on');await page.getByRole('tab',{name:'Settings',exact:true}).click();await page.locator('[data-pref=save]:not([disabled])').waitFor();
 await page.locator('[data-pref=clone]').click();await page.locator('[name=profileName]').fill('Fast small');await page.locator('[name=buyPresets]').fill('0.02, 0.07');await page.locator('[name=sellPresets]').fill('10, 100');await page.locator('[name=confirmLimit]').uncheck();await page.locator('[data-pref=save]').click();await page.locator('[data-pref=status]').filter({hasText:'saved'}).waitFor();
 await page.getByRole('tab',{name:'Trade',exact:true}).click();assert(await page.locator('[data-preset="0.07"]').count()===1,'Saved profile replaces actual Trade presets');
 await page.locator('[data-active-profile]').selectOption('default');await page.locator('[data-preset="0.05"]').waitFor();assert(await page.locator('[data-preset="0.07"]').count()===0,'Quick profile selection applies saved defaults without submitting');
 assert((await orders()).length===0,'Profile changes do not create orders');
 await page.getByRole('button',{name:'Limit',exact:true}).click();await page.locator('[name=trigger]').fill('250K');await page.locator('[data-review-button]').click();await waitOrders(1);assert(await page.locator('[data-view=trade] [data-review]').isHidden(),'Limit confirmation OFF submits on Place limit without a review');
 await visit('pro=on');await page.getByRole('button',{name:'Hotkeys OFF',exact:true}).click();await page.getByRole('button',{name:'Hotkeys ON',exact:true}).focus();
 await page.keyboard.down('Space');await page.keyboard.press('2');await page.keyboard.up('Space');await waitOrders(1);assert((await orders())[0].body.spec.amountRaw==='50000000','Trusted native Space+2 submits the configured buy slot once');
 await page.locator('[data-ticket] [name=amount]').focus();await page.keyboard.down('Space');await page.keyboard.press('1');await page.keyboard.up('Space');assert((await orders()).length===1,'Editing an amount suppresses native trading hotkeys');
 await visit('pro=on');await page.getByRole('button',{name:'Sell',exact:true}).click();await page.getByRole('button',{name:'Sell Initials',exact:true}).waitFor({state:'visible'});await page.locator('[data-recover-initials]:not([disabled])').waitFor();await page.locator('[data-recover-initials]').click();await waitOrders(1);
 assert((await orders())[0].body.spec.amountRaw==='24285714286'&&(await orders())[0].body.spec.side==='SELL','Sell Initials submits server-calculated quantity, not a fixed percentage');
 assert((await page.locator('.pro-panel > [data-status]').innerText()).includes('no additional sell is automatic'),'Recovery feedback describes estimate and excludes automatic follow-up');
 for(const scenario of ['pro-recovery-shortfall','pro-history-missing','pro-recovery-done']){
  await visit(`pro=on&${scenario}`);await page.locator('[data-position] h3').waitFor();await page.getByRole('button',{name:'Sell',exact:true}).click();
  if(scenario==='pro-recovery-shortfall'){await page.locator('[data-recover-initials]').click();await page.locator('.pro-panel > [data-status]').filter({hasText:'Shortfall'}).waitFor();}
  else assert(await page.locator('[data-recover-initials]').isDisabled(),`${scenario}: unavailable/completed recovery is disabled`);
  assert((await orders()).length===0,`${scenario}: recovery sends no trade and never implicitly sells all`);
 }
 await visit('pro=on&pro-confirm-market&pro-preview-delayed');await page.locator('[data-review-button]').click();await page.waitForFunction(()=>window.mockRequests.some(r=>r.path==='/v2/preview'));
 await page.evaluate(()=>window.changeMockProWallet('9XDYTfQKwW8sHPqnFdUreMmtmffmkHVPGTNV2e3LKxNW'));await page.waitForFunction(()=>document.querySelector('#trading>div')?.shadowRoot?.querySelector('[data-copy-wallet]')?.title.startsWith('9XDYTf'));
 await page.evaluate(()=>window.releaseMockProPreview());assert((await orders()).length===0,'Late preview after wallet change cannot submit');
 await visit('pro=on&pro-pending-write-delayed');await page.locator('[data-preset="0.01"]').click();await page.waitForFunction(()=>document.body.dataset.pendingWriteWaiting==='true');await page.getByRole('tab',{name:'Settings',exact:true}).click();await page.evaluate(()=>window.releaseMockPendingWrite());await page.waitForFunction(()=>document.querySelector('#trading>div')?.shadowRoot?.querySelector('.pro-panel > [data-status]')?.textContent.includes('Order not submitted'));assert((await orders()).length===0,'Leaving Trade during pending persistence blocks submission');assert(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('dp-pro-mock-storage')??'{}')).some(key=>key.startsWith('proOrderPending:'))),'Cancelled pre-submit intent retains its original saved UUID for explicit resolution');
 await visit('pro=on&pro-register-uncertain');await page.locator('[data-preset="0.01"]').click();await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('dp-pro-mock-storage')??'{}')).some(key=>key.startsWith('proOrderPending:')));
 const original=(await orders())[0].body.orderId;await page.reload();await page.locator('[data-review-button]:not([disabled])').waitFor();assert((await orders()).length===0,'Lost immediate acknowledgement reconciles on reload without another POST');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('dp-pro-mock-orders')??'[]'));assert(saved.length===1&&saved[0].id===original,'Immediate recovery preserves the single original order UUID');
 for(const width of [280,360,390,420]){
  await visit('pro=on',width);await page.locator('[data-position] h3').waitFor();await capture(`trade-${width}`);
  await page.getByRole('button',{name:'Sell',exact:true}).click();await capture(`sell-${width}`);
  await page.getByRole('tab',{name:'Wallet',exact:true}).click();await capture(`wallet-${width}`);
  await page.getByRole('tab',{name:'Settings',exact:true}).click();await page.locator('[data-pref=save]:not([disabled])').waitFor();await capture(`settings-${width}`);
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(overflow.scroll<=overflow.width,`${width}px: settings and trading controls have no horizontal overflow`);
 }
 await visit('pro=on&pro-confirm-market',390,900);await page.locator('[data-preset="0.05"]').click();await page.locator('[data-view=trade] [data-review]').waitFor({state:'visible'});await capture('review-390x900');
 assert(errors.length===0,`No runtime errors in covered mock browser flows (${errors.join('; ')})`);
 return {passed:checks.length,checks,captures,errors,realTrades:0,scope:'Synthetic Chromium native-panel mocks; provider/signer integration excluded.'};
 } catch(error){throw Error(`${error.message} · URL ${page.url()} · Last passed: ${checks.at(-1)??'none'}`);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const session=`pro-trading-${process.pid}`,baseUrl=process.env.DP_PRO_PREVIEW_URL??'http://127.0.0.1:5173';
 const run=args=>spawnSync('playwright-cli',[`--session=${session}`,...args],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
 mkdirSync('output/playwright/pro-features',{recursive:true});
 try{const opened=run(['open',`${baseUrl}/preview/sidepanel.html?pro=on`]);if(opened.status!==0)throw Error(opened.stdout+opened.stderr);run(['snapshot']);const result=run(['run-code',`async page => (${verifyProTrading.toString()})(page, ${JSON.stringify(baseUrl)})`]);writeFileSync('output/playwright/pro-features/browser-checks.log',result.stdout+result.stderr);if(result.status!==0||!result.stdout.includes('### Result\n'))throw Error(result.stdout.split('### Ran Playwright code')[0]+result.stderr);const report=JSON.parse(result.stdout.split('### Result\n')[1].split('### Ran Playwright code')[0].trim());writeFileSync('output/playwright/pro-features/browser-checks.json',JSON.stringify(report,null,2));console.log(`${report.passed} Pro trading browser checks passed; ${report.captures.length} captures; no real trade or signing.`);}catch(error){console.error(error.message);process.exitCode=1;}finally{run(['close']);}
}
