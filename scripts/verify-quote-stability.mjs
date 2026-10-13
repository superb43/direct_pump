/** Offline current-source quote display gate. No provider requests or wallet actions. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export default async function verifyQuoteStability(page, baseUrl='http://127.0.0.1:5173') {
  const checks=[], captures=[], errors=[], blocked=[], states=[];
  const assert=(condition,message)=>{if(!condition)throw new Error(message);checks.push(message);};
  page.on('pageerror',error=>errors.push(String(error)));
  const origin=new URL(baseUrl).origin;
  await page.context().route('**/*',route=>{
    if(new URL(route.request().url()).origin===origin)return route.continue();
    blocked.push(route.request().url());return route.abort();
  });
  const capture=async(name)=>{
    const path=`output/playwright/quote-stability/${name}.png`;
    await page.screenshot({path,animations:'disabled'});captures.push(path);
  };
  const bounds=()=>page.evaluate(()=>{
    const root=document.querySelector('#trading>div')?.shadowRoot;
    const rows=[...root.querySelectorAll('.holdings-row')];
    return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,
      hidden:rows.filter(row=>row.getBoundingClientRect().height===0).length,
      escaped:rows.filter(row=>{const r=row.getBoundingClientRect();return r.left<-.5||r.right>innerWidth+.5;}).length,
      clipped:rows.flatMap(row=>[...row.querySelectorAll('small,strong')]).filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.textContent),
      labels:rows.map(row=>row.querySelector('small').textContent),titles:rows.map(row=>row.title)};
  });
  const visit=async(width)=>{
    await page.setViewportSize({width,height:600});
    await page.goto(`${baseUrl}/preview/sidepanel.html?position&holdings`);
    await page.evaluate(()=>document.fonts.ready);
    await page.locator('.holdings-row').first().waitFor();
    if(!await page.locator('.holdings').evaluate(element=>element.open))await page.locator('.holdings summary').click();
    await page.locator('.holdings-row').first().waitFor({state:'visible'});
    await page.locator('.holdings-list').scrollIntoViewIfNeeded();
    assert(await page.locator('.holdings-row').count()===2,`${width}px: both confirmed holdings render`);
  };
  for(const width of [280,360,390,420]){
    await visit(width);
    const result=await bounds();states.push({state:'normal',...result});
    assert(result.documentWidth<=width&&result.escaped===0&&result.hidden===0,`${width}px: normal holdings fit the panel`);
    assert(result.clipped.length===0,`${width}px: normal holding labels are not clipped`);
    assert(result.labels.every(label=>/^[-+]/.test(label)),`${width}px: normal holdings retain computed PnL`);
    await capture(`normal-${width}`);
  }
  const scenarios=[
    {id:'usd-unavailable',label:'USD unavailable',message:'USD provider temporarily unavailable.'},
    {id:'quote-delayed',label:'Quote delayed',message:'RPC timeout; retry scheduled.'},
    {id:'check-settings',label:'Check settings',message:'RPC access denied (403). Check Settings.'},
  ];
  for(const width of [280,390])for(const scenario of scenarios){
    await visit(width);
    await page.evaluate(state=>{
      const original=chrome.runtime.sendMessage;
      window.quoteGateCalls=[];
      chrome.runtime.sendMessage=async function(request,...args){
        window.quoteGateCalls.push(request.type);
        const response=await original.call(this,request,...args);
        if(!['PORTFOLIO','PORTFOLIO_PRICES'].includes(request.type)||!response.portfolio)return response;
        const snapshot=structuredClone(response);
        for(const holding of snapshot.portfolio.holdings){
          const position=holding.position;
          if(!position||position.wallet!==snapshot.portfolio.wallet||position.mint!==holding.mint)throw new Error('Quote fixture identity mismatch');
          holding.priceUpdatedAt=Date.now()+1000;holding.pricingPending=false;
          if(state.id==='usd-unavailable'){
            delete position.solUsd;
            position.usdIssue={kind:'USD',message:state.message,retryable:true,retryAt:Date.now()+2000};
          }else if(state.id==='quote-delayed'){
            position.updatedAt=Date.now()-31_000;holding.priceMode='STALE';
            position.quoteIssue={kind:'RPC',message:state.message,retryable:true,retryAt:Date.now()+2000};
          }else{
            delete position.expectedExitLamports;holding.priceMode='STALE';
            position.quoteIssue={kind:'RPC',message:state.message,retryable:false,status:403};
          }
        }
        return snapshot;
      };
      window.pushMockPrice('41458333333');
    },scenario);
    await page.waitForFunction(label=>{
      const rows=[...document.querySelector('#trading>div').shadowRoot.querySelectorAll('.holdings-row small')];
      return rows.length===2&&rows.every(row=>row.textContent===label);
    },scenario.label);
    await page.locator('.holdings-list').scrollIntoViewIfNeeded();
    const result=await bounds();states.push({state:scenario.id,...result});
    assert(result.documentWidth<=width&&result.escaped===0&&result.hidden===0,`${width}px: ${scenario.label} holdings fit the panel`);
    assert(result.clipped.length===0,`${width}px: ${scenario.label} labels are not clipped`);
    assert(result.titles.every(title=>title.includes(scenario.message)),`${width}px: ${scenario.label} tooltip retains the actual failure reason`);
    assert(await page.evaluate(()=>window.quoteGateCalls.includes('PORTFOLIO_PRICES')),`${width}px: ${scenario.label} uses the controller price push path`);
    await capture(`${scenario.id}-${width}`);
  }
  assert(errors.length===0,`No runtime errors (${errors.join('; ')})`);
  assert(await page.evaluate(()=>!document.body.dataset.tradeRequested&&!window.mockRequests.some(request=>request.type==='TRADE'||request.type==='PRO'&&request.method==='POST')),'No trade, signing, or funded server request');
  return {passed:checks.length,checks,captures,states,errors,blocked,realTrades:0,scope:'Offline Chromium current-source side panel, mocked worker response failures; no provider/signing integration.'};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const session=`quote-stability-${process.pid}`;
  const baseUrl=process.env.DP_QUOTE_PREVIEW_URL??'http://127.0.0.1:5173';
  const run=args=>spawnSync('playwright-cli',[`--session=${session}`,...args],{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
  mkdirSync('output/playwright/quote-stability',{recursive:true});
  try{
    const opened=run(['open','about:blank']);if(opened.status!==0)throw new Error(opened.stdout+opened.stderr);
    const result=run(['run-code',`async page => (${verifyQuoteStability.toString()})(page, ${JSON.stringify(baseUrl)})`]);
    writeFileSync('output/playwright/quote-stability/browser-checks.log',result.stdout+result.stderr);
    if(result.status!==0||!result.stdout.includes('### Result\n'))throw new Error(result.stdout+result.stderr);
    const report=JSON.parse(result.stdout.split('### Result\n')[1].split('### Ran Playwright code')[0].trim());
    writeFileSync('output/playwright/quote-stability/browser-checks.json',JSON.stringify(report,null,2));
    console.log(`${report.passed} browser checks passed; ${report.captures.length} captures; no real trade or signing.`);
  }catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}finally{run(['close']);}
}
