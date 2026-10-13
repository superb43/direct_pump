/** Offline Pro discovery gate; all remote requests are blocked. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export default async function verifyProOnboarding(page) {
  const checks=[],captures=[],errors=[];
  const assert=(condition,message)=>{if(!condition)throw new Error(message);checks.push(message);};
  page.on('pageerror',error=>errors.push(String(error)));
  await page.context().route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const messages=async()=>page.evaluate(()=>window.mockRequests??[]);
  const noExecution=async()=>assert((await messages()).every(request=>request.type!=='TRADE'&&(request.type!=='PRO'||request.action==='SETTINGS')),'Browsing and setup discovery issue no trade, enable, disable, pairing or server requests');
  const capture=async name=>{const path=`output/playwright/pro-onboarding/${name}.png`;await page.screenshot({path,animations:'disabled'});captures.push(path);};
  const visit=async(site,width=390)=>{
    if(page.url().startsWith('http://127.0.0.1'))await page.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('dp-pro-mock-storage');localStorage.removeItem('dp-pro-mock-orders');});
    await page.setViewportSize({width,height:600});await page.goto(`http://127.0.0.1:5184/preview/sidepanel.html?pro=unpaired&site=${site}`);await page.evaluate(()=>document.fonts.ready);await page.locator('.token-ticker').waitFor();await page.getByRole('switch').click();await page.locator('[data-preview-notice]').waitFor();
  };
  for(const site of ['GMGN','AXIOM','FOMO']){
    await visit(site);assert(await page.locator('.manual-panel').isHidden(),`${site}: Pro discovery hides manual execution`);await noExecution();
    await page.getByRole('button',{name:'Limit',exact:true}).click();await page.locator('[name=trigger]').fill('250K');await page.locator('[data-review-button]').click();
    const dialog=page.getByRole('dialog',{name:'Set up Pro'});await dialog.waitFor();assert(await dialog.isVisible(),`${site}: Order action opens setup instead of previewing an executable order`);await capture(`choices-${site.toLowerCase()}-390`);
    await page.locator('[data-setup-managed]').click();assert(await page.locator('[data-setup-managed-view] [data-setup-back]').evaluate(element=>element.getRootNode().activeElement===element),'Managed view receives keyboard focus');assert(await page.locator('[data-setup-managed-view]').isVisible(),`${site}: Managed subscription is explicitly coming soon`);
    assert(await page.getByRole('link',{name:'Open Telegram channel'}).getAttribute('href')==='https://t.me/+8DEJUy4u0sk3ZDNl','Managed preview uses the supplied Telegram invitation');await capture(`managed-${site.toLowerCase()}-390`);
    await page.keyboard.press('Escape');assert(await dialog.isHidden(),'Escape dismisses the modal');assert(await page.locator('[data-review-button]').evaluate(element=>element.getRootNode().activeElement===element),'Dismissal restores focus to the initiating order button');
    await page.getByRole('tab',{name:'Wallet',exact:true}).click();await page.locator('[data-copy-deposit]').click();await dialog.waitFor();await page.locator('[data-setup-explore]').click();
    await page.getByRole('tab',{name:'Withdraw',exact:true}).click();await page.locator('[data-withdraw-content] [data-start-pro]').click();await dialog.waitFor();await page.locator('[data-setup-explore]').click();
    await page.getByRole('tab',{name:'Settings',exact:true}).click();await page.locator('[name=slippage]').click();await dialog.waitFor();await page.locator('[data-setup-explore]').click();
    await page.locator('[name=slippage]').focus();await page.keyboard.press('2');await dialog.waitFor();await page.locator('[data-setup-explore]').click();
    await page.getByRole('tab',{name:'Orders',exact:true}).click();await page.locator('[data-refresh]').click();await dialog.waitFor();await page.locator('[data-setup-explore]').click();await noExecution();
    await page.getByRole('switch').click();assert(await page.locator('.manual-panel').isVisible(),`${site}: Turning preview OFF restores the basic panel without a server pause`);await noExecution();
  }
  for(const width of [280,390]){
    await visit('AXIOM',width);await capture(`preview-${width}`);await page.locator('[data-start-pro]').first().click();await capture(`choices-${width}`);
    await page.locator('[data-setup-managed]').click();await capture(`managed-${width}`);await page.locator('[data-setup-back]').filter({visible:true}).click();
    await page.locator('[data-setup-self]').click();await page.locator('[data-setup-self-view] [data-pro=connection] > summary').click();await page.locator('[name=proServer]').waitFor();await capture(`self-hosted-${width}`);
    assert((await messages()).filter(request=>request.type==='PRO').every(request=>request.action==='SETTINGS'),'Opening self-hosted configuration only reads local Pro settings');
    assert(!(await page.locator('.pro-pairing-help').textContent()).includes('ssh -t ora'),'Public pairing help is independent of the owner’s ORA installation');
    const escaped=await page.getByRole('dialog').evaluate(root=>[...root.querySelectorAll('button,input,a')].filter(element=>{const r=element.getBoundingClientRect(),d=root.getBoundingClientRect();return r.width&&(r.left<d.left||r.right>d.right);}).length);
    assert(escaped===0,`${width}px: Setup controls stay inside the dialog`);
    await page.locator('[name=proServer]').fill('https://personal.example');await page.locator('[data-pro=pair]').click();
    assert(await page.locator('[data-pro=status]').textContent().then(text=>text.includes('Generate a code')),'Missing pairing code gives an actionable explanation');await noExecution();await page.keyboard.press('Escape');
    await page.reload();await page.locator('[data-preview-notice]').waitFor();await noExecution();assert(await page.getByRole('switch').getAttribute('aria-checked')==='true','Browsing preference survives a panel reload without enabling execution');
  }
  for(const mode of ['unpaired','malformed-settings']){
    await page.evaluate(()=>sessionStorage.clear());await page.goto(`http://127.0.0.1:5184/preview/sidepanel.html?pro=${mode}&empty`);await page.locator('#empty').waitFor();
    assert(await page.locator('#empty button').count()===0,`${mode}: Empty shell has no Pro or Settings buttons`);
    assert(await page.locator('#error').isHidden(),`${mode}: Normal empty state has no redundant error`);
    assert((await messages()).every(request=>request.type!=='PRO'),`${mode}: Empty shell does not query or change Pro settings`);await noExecution();
  }
  for(const width of [280,390]){
    await page.setViewportSize({width,height:600});await page.evaluate(()=>document.fonts.ready);
    assert(await page.locator('#empty h1').textContent()==='Open a token page to trade','Empty shell leads with the next action');
    assert(await page.locator('.empty-sites').textContent()==='GMGN · AXIOM · FOMO','Supported sites appear once below the guidance');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),`${width}px: Empty shell has no horizontal overflow`);await capture(`empty-${width}`);
  }
  assert(errors.length===0,`No runtime errors (${errors.join('; ')})`);
  return {passed:checks.length,checks,captures,errors,realTrades:0,scope:'Offline Chromium at actual panel dimensions; no real signing, provisioning, payment or external Telegram navigation.'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const session=`pro-onboarding-${process.pid}`;
  const run=args=>spawnSync('playwright-cli',[`--session=${session}`,...args],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
  mkdirSync('output/playwright/pro-onboarding',{recursive:true});
  try{
    const opened=run(['open','http://127.0.0.1:5184/preview/sidepanel.html?pro=unpaired']);if(opened.status!==0)throw new Error(opened.stdout+opened.stderr);
    run(['snapshot']);const result=run(['run-code',verifyProOnboarding.toString()]);writeFileSync('output/playwright/pro-onboarding/browser-checks.log',result.stdout+result.stderr);
    if(result.status!==0||result.stdout.includes('### Error'))throw new Error(result.stdout.split('### Ran Playwright code')[0]+result.stderr);
    const report=JSON.parse(result.stdout.split('### Result\n')[1].split('### Ran Playwright code')[0].trim());writeFileSync('output/playwright/pro-onboarding/browser-checks.json',JSON.stringify(report,null,2));
    console.log(`${report.passed} onboarding checks passed; ${report.captures.length} captures; no real trade or signing.`);
  }catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}finally{run(['close']);}
}
