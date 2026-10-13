/** Offline history-basis display verification; synthetic holdings, no signing. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

async function verifyBasis(page, baseUrl) {
  const checks=[],captures=[],errors=[];
  const assert=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message);};
  page.on('pageerror',error=>errors.push(String(error)));
  await page.context().route('**/*',route=>new URL(route.request().url()).origin===baseUrl?route.continue():route.abort());
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const site of ['gmgn','axiom','fomo'])for(const width of [280,390]){
    await page.setViewportSize({width,height:900});
    await page.goto(`${baseUrl}/preview/sidepanel.html?holdings&position&basis-estimated&site=${site}`);
    await page.locator('.holdings-row').first().filter({hasText:'QI'}).waitFor();
    await page.evaluate(()=>document.fonts.ready);
    const facts=await page.evaluate(()=>{
      const root=document.querySelector('#trading > div').shadowRoot,row=root.querySelector('.holdings-row');
      return {overflow:document.documentElement.scrollWidth>innerWidth,title:row.title,pnl:row.querySelector('small').textContent,
        positive:row.querySelector('small').classList.contains('positive'),note:root.querySelector('.position-source').textContent,
        requests:window.mockRequests.filter(r=>r.type==='TRADE'||r.type==='PRO'&&r.method&&r.method!=='GET').length};
    });
    const label=`${site}/${width}`;
    assert(!facts.overflow,`${label}: no horizontal overflow`);
    assert(facts.pnl.startsWith('+')&&facts.positive,`${label}: PnL has no Est. prefix and retains its sign color`);
    assert(facts.title.includes('Cost basis: $')&&!facts.title.includes('Cost basis: Est.')&&facts.title.includes('Avg cost (including entry costs)'),`${label}: recorded average and estimated basis are available in the row tooltip`);
    assert(facts.note.includes('LP/transfer PnL is not included'),`${label}: totals explain estimated accounting`);
    assert(facts.requests===0,`${label}: no trade/server mutation`);
    const path=`output/playwright/holdings-basis/${site}-${width}.png`;await page.screenshot({path,animations:'disabled',scale:'css'});captures.push(path);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(`${baseUrl}/preview/dashboard.html?holdings&basis-estimated`);
  await page.locator('#holdings-rows tr').first().filter({hasText:'QI'}).waitFor();
  for(const unit of ['usd','sol']){
    await page.locator(`#unit-${unit}`).click();
    const row=page.locator('#holdings-rows tr').first();
    const basis=await row.locator('td').nth(4).textContent();
    assert(!basis.startsWith('Est.')&&(unit==='usd'?basis.startsWith('$'):basis.endsWith(' SOL')),`dashboard/${unit}: remaining basis has no Est. prefix`);
    assert((await row.locator('td').nth(5).textContent()).startsWith('+'),`dashboard/${unit}: PnL has no Est. prefix`);
    assert((await row.locator('td').nth(5).getAttribute('title')).includes('LP/transfer'),`dashboard/${unit}: explanation remains available`);
    const path=`output/playwright/holdings-basis/dashboard-${unit}.png`;await page.screenshot({path,animations:'disabled',scale:'css'});captures.push(path);
  }
  assert(errors.length===0,`no browser errors: ${errors.join('; ')}`);
  return {checks,captures,realTrades:0,scope:'Offline production views with synthetic data; no live provider or funded trading verification.'};
}

const baseUrl=process.env.DP_BASIS_PREVIEW_URL??'http://127.0.0.1:5193';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl))throw new Error('Use a localhost preview origin.');
const session=`basis-${process.pid}`;
const run=args=>spawnSync('playwright-cli',[`--session=${session}`,...args],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
mkdirSync('output/playwright/holdings-basis',{recursive:true});
try{
  const opened=run(['open',`${baseUrl}/preview/sidepanel.html?holdings&basis-estimated`]);if(opened.status!==0)throw new Error(opened.stdout+opened.stderr);
  const snapshot=run(['snapshot']);if(snapshot.status!==0)throw new Error(snapshot.stdout+snapshot.stderr);
  const result=run(['run-code',`async page => (${verifyBasis.toString()})(page, ${JSON.stringify(baseUrl)})`]);
  writeFileSync('output/playwright/holdings-basis/capture.log',result.stdout+result.stderr);
  if(result.status!==0||result.stdout.includes('### Error'))throw new Error(result.stdout.split('### Ran Playwright code')[0]+result.stderr);
  const report=JSON.parse(result.stdout.split('### Result\n')[1].split('### Ran Playwright code')[0].trim());
  writeFileSync('output/playwright/holdings-basis/capture.json',JSON.stringify(report,null,2));
  console.log(`${report.checks.length} history-basis display checks passed; ${report.captures.length} screenshots; no signing/trading.`);
}finally{run(['close']);}
