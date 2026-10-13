/** Opt-in read-only Brave chart gate. Draws illustrative, unsaved lines and removes them. */
import { build } from 'vite';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if (!process.argv.includes('--live')) throw new Error('Explicit opt-in required: node scripts/verify-chart-overlay.mjs --live');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'direct-pump-chart-'));
const output = join(root, 'output/playwright/chart-entry');
function evaluate(code, host, activate = false) {
  const script = `tell application "Brave Browser"\nset out to ""\nset windowIds to id of every window\nrepeat with windowId in windowIds\nset w to window id (contents of windowId)\nrepeat with tabIndex from 1 to count of tabs of w\nset t to tab tabIndex of w\nif ${host ? `URL of t contains "${host}/" and (` : ""}URL of t contains "gmgn.ai/sol/token/" or URL of t contains "axiom.trade/meme/" or URL of t contains "fomo.family/tokens/solana/"${host ? ")" : ""} then\n${activate ? "set index of w to 1\nset active tab index of w to tabIndex\nactivate\n" : ""}set out to out & (execute t javascript ${JSON.stringify(code)}) & linefeed\nend if\nend repeat\nend repeat\nreturn out\nend tell`;
  const result = execFileSync('osascript', ['-'], { input: script, encoding: 'utf8', timeout: 20_000 }).trim();
  if (!result) throw new Error('Open supported token tabs for all three sites in Brave; allow JavaScript from Apple Events.');
  return result.split('\n').filter(Boolean).map(line => JSON.parse(line));
}
try {
  const entry = join(temporary, 'entry.ts');
  await writeFile(entry, `export { createChartOverlay } from ${JSON.stringify(join(root, 'src/chart-overlay.ts'))};\nexport { detectPage, targetKey } from ${JSON.stringify(join(root, 'src/sites/catalog.ts'))};\nexport { readPageHints } from ${JSON.stringify(join(root, 'src/adapters.ts'))};\nexport { readChartBinding } from ${JSON.stringify(join(root, 'src/sites/charts.ts'))};\n`);
  await build({ configFile: false, logLevel: 'error', build: { lib: { entry, name: 'DirectPumpChartProbe', formats: ['iife'], fileName: () => 'probe.js' }, outDir: join(temporary, 'out'), minify: true } });
  const bundle = await readFile(join(temporary, 'out/probe.js'), 'utf8');
  const probe = `${bundle}\n(async () => {
    const checks = [], screenshots = [];
    document.documentElement.dataset.dpChartStage = "started";
    const assert = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); document.documentElement.dataset.dpChartStage = message; };
    const target = DirectPumpChartProbe.detectPage(location.href);
    const current = {...target, ...DirectPumpChartProbe.readPageHints(document, target)};
    const mint = current.kind === 'MINT' ? current.address : current.mintHint;
    const sample = { mint, priceUsd: '0.0238', marketCapUsd: '23800000' };
    let clock = Date.now();
    const command = { channel: 'direct-pump:chart-entry:v1', key: DirectPumpChartProbe.targetKey(current), entry: sample, expiresAt: clock + 12000 };
    const overlay = DirectPumpChartProbe.createChartOverlay(document, () => location.href, () => clock);
    const binding = DirectPumpChartProbe.readChartBinding(document, current, sample);
    let toggled = false, toggle;
    const sleep = ms => new Promise(done => setTimeout(done, ms));
    const awaitLine = async () => {
      for(let i=0; i<30; i++) {
        await overlay.sync();
        const actual = DirectPumpChartProbe.readChartBinding(document, current, sample);
        const shapes = actual?.chart.getAllShapes().filter(shape => {
          try { return actual.chart.getShapeById(shape.id).getProperties().text === 'Avg Entry'; } catch { return false; }
        });
        if (shapes?.length) { assert(shapes.length === 1, 'Exactly one owned line'); return {binding: actual, id: shapes[0].id}; }
        await sleep(100);
      }
      throw new Error('Illustrative line did not appear');
    };
    const capture = async (name, api) => {
      document.documentElement.dataset.dpChartStage = "capturing " + name;
      const canvas = await Promise.race([api.takeClientScreenshot(), sleep(4000).then(() => {throw new Error("Chart screenshot timed out")})]);
      screenshots.push({name, png: canvas.toDataURL('image/png')});
    };
    try {
      assert(Boolean(binding), 'Verified native chart API, identity and USD axis');
      const before = new Set(binding.chart.getAllShapes().map(shape => shape.id));
      overlay.update(command);
      let line = await awaitLine();
      const properties = line.binding.chart.getShapeById(line.id).getProperties();
      assert(properties.linestyle === 1, 'Native dotted horizontal line');
      const point = line.binding.chart.getShapeById(line.id).getPoints()[0];
      assert(point.price === Number(line.binding.basis === 'MC' ? sample.marketCapUsd : sample.priceUsd), 'Line matches chart units');
      assert(!before.has(line.id), 'Only a newly owned drawing is tracked');
      await sleep(250);
      await capture('initial', line.binding.frame.contentWindow.tradingViewApi);
      const frameDocument = line.binding.frame.contentDocument;
      if (current.site === 'GMGN') toggle = document.querySelector('[data-sentry-component="PriceType"]');
      if (current.site === 'AXIOM') toggle = frameDocument.querySelector('[title="Click toggle viewing market cap"]');
      if (current.site === 'FOMO') toggle = frameDocument.querySelector('[title="Toggle chart values between price and market cap"]');
      if (toggle) {
        const originalBasis = line.binding.basis;
        toggle.click(); toggled = true;
        await sleep(600);
        line = await awaitLine();
        assert(line.binding.basis !== originalBasis, 'Mode toggle recognized');
        assert(line.binding.chart.getShapeById(line.id).getPoints()[0].price === Number(line.binding.basis === 'MC' ? sample.marketCapUsd : sample.priceUsd), 'Mode toggle uses corresponding entry units');
        await capture('toggled', line.binding.frame.contentWindow.tradingViewApi);
        toggle = current.site === 'GMGN' ? document.querySelector('[data-sentry-component="PriceType"]') : line.binding.frame.contentDocument.querySelector(current.site === 'AXIOM' ? '[title="Click toggle viewing market cap"]' : '[title="Toggle chart values between price and market cap"]');
        toggle.click(); toggled = false; await sleep(600); line = await awaitLine();
        assert(line.binding.basis === originalBasis, 'Original chart mode restored');
      }
      const scale = line.binding.chart.getPanes()[0].getMainSourcePriceScale();
      const originalMode = scale.getMode();
      try {
        scale.setMode(originalMode === 1 ? 0 : 1); await sleep(100); await overlay.sync();
        assert(line.binding.chart.getShapeById(line.id).getPoints()[0].price === Number(line.binding.basis === 'MC' ? sample.marketCapUsd : sample.priceUsd), 'Log/linear scale retains native price binding');
      } finally { scale.setMode(originalMode); }
      clock = command.expiresAt; await overlay.sync();
      assert(!line.binding.chart.getAllShapes().some(shape => shape.id === line.id), 'Expired lease removes the owned line');
      assert([...before].every(id => line.binding.chart.getAllShapes().some(shape => shape.id === id)), 'Existing site/user drawings preserved');
      document.documentElement.dataset.dpChartResult = JSON.stringify({site: current.site, checks, screenshots, sample: 'Illustrative values only; no wallet, signature or trade', originalTicker: binding.symbol});
    } catch (error) {
      document.documentElement.dataset.dpChartResult = JSON.stringify({site: current.site, error: String(error), checks});
    } finally { overlay.destroy(); if(toggled) { const live=DirectPumpChartProbe.readChartBinding(document,current,sample); const restore=current.site === "GMGN" ? document.querySelector('[data-sentry-component="PriceType"]') : live?.frame.contentDocument.querySelector(current.site === "AXIOM" ? '[title="Click toggle viewing market cap"]' : '[title="Toggle chart values between price and market cap"]'); restore?.click(); } }
  })();`;
  const launchCode = `(() => {
    delete document.documentElement.dataset.dpChartResult; delete document.documentElement.dataset.dpChartStage;
    const script = document.createElement('script');
    script.nonce = [...document.scripts].find(s => s.nonce)?.nonce ?? '';
    const source = ${JSON.stringify(probe)};
    if(location.hostname === 'gmgn.ai') script.textContent = source;
    else { const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'})); script.src = url; script.onload=()=>{script.remove(); URL.revokeObjectURL(url);}; script.onerror=()=>{document.documentElement.dataset.dpChartResult=JSON.stringify({site:location.hostname,error:'MAIN probe source blocked'});script.remove();URL.revokeObjectURL(url);}; }
    document.documentElement.append(script); if(location.hostname === 'gmgn.ai') script.remove();
    return JSON.stringify({site: location.hostname});
  })()`;
  const results = [];
  for (const host of ['gmgn.ai', 'axiom.trade', 'fomo.family']) {
    const launches = evaluate(launchCode, host, true);
    assert.ok(launches.length, `${host} token tab must be open`);
    let siteResults;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(done => setTimeout(done, 500));
      siteResults = evaluate(`document.documentElement.dataset.dpChartResult || JSON.stringify({pending:location.hostname,stage:document.documentElement.dataset.dpChartStage})`, host);
      if (siteResults.every(result => !result.pending)) break;
    }
    results.push(...siteResults);
  }
  await mkdir(output, {recursive:true});
  for (const result of results) {
    for (const screenshot of result.screenshots ?? []) await writeFile(join(output, `${result.site.toLowerCase()}-${screenshot.name}.png`), Buffer.from(screenshot.png.split(',')[1], 'base64'));
    delete result.screenshots;
  }
  await writeFile(join(output, 'live-checks.json'), JSON.stringify(results, null, 2));
  for (const result of results) { console.log(JSON.stringify(result)); assert.ok(!result.error && !result.pending, `${result.site ?? result.pending}: chart overlay failed`); }
  assert.deepEqual([...new Set(results.map(row => row.site))].sort(), ['AXIOM','FOMO','GMGN']);
  evaluate(`(() => {delete document.documentElement.dataset.dpChartResult; delete document.documentElement.dataset.dpChartStage;return JSON.stringify({clean:true})})()`);
  console.log('Live chart overlay: all three sites passed. Illustrative, unsaved drawings removed; no wallet or trading methods called.');
} finally { await rm(temporary, { recursive: true, force: true }); }
