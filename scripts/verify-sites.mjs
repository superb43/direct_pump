/** Read-only DOM verification in an already running Brave on macOS. */
import { build } from 'vite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'direct-pump-sites-'));
const mint = 'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP';
const pool = 'AG1EhPjsBrkxQWkViuLXF6pQnHwfr9f9sdNneeoykcEJ';
const urls = {
  gmgn: `https://gmgn.ai/sol/token/${mint}`,
  axiom: `https://axiom.trade/meme/${pool}?chain=sol`,
  fomo: `https://fomo.family/tokens/solana/${mint}`,
};
const selectTabs = `URL of t contains "gmgn.ai/sol/token/" or URL of t contains "axiom.trade/meme/" or URL of t contains "fomo.family/tokens/solana/"`;
function evaluate(code, all = false) {
  const statement = all ? `set out to out & (execute t javascript ${JSON.stringify(code)}) & linefeed` : `return execute t javascript ${JSON.stringify(code)}`;
  const script = `tell application "Brave Browser"\nset out to ""\nrepeat with w in windows\nrepeat with t in tabs of w\nif ${selectTabs} then\n${statement}\nend if\nend repeat\nend repeat\nreturn out\nend tell`;
  const output = execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 20000 }).trim();
  if (!output) throw new Error('Open a supported token tab in Brave and enable View → Developer → Allow JavaScript from Apple Events.');
  return all ? output.split('\n').filter(Boolean).map(line => JSON.parse(line)) : JSON.parse(output);
}
try {
  const entry = join(temporary, 'probe.ts');
  await writeFile(entry, `export { detectPage } from ${JSON.stringify(join(root, 'src/sites/catalog.ts'))};\nexport { readPageHints } from ${JSON.stringify(join(root, 'src/adapters.ts'))};\n`);
  await build({ configFile: false, logLevel: 'error', build: { lib: { entry, name: 'DirectPumpProbe', formats: ['iife'], fileName: () => 'probe.js' }, outDir: join(temporary, 'out'), minify: false } });
  const bundle = await readFile(join(temporary, 'out/probe.js'), 'utf8');
  const fixtures = await Promise.all(Object.entries(urls).map(async ([name, url]) => ({ name, url, html: await readFile(join(root, `tests/fixtures/sites/${name}.html`), 'utf8') })));
  const results = evaluate(`(() => { ${bundle}
    const fixtures = ${JSON.stringify(fixtures)};
    const rows = [];
    for (const fixture of fixtures) {
      const doc = new DOMParser().parseFromString(fixture.html, 'text/html');
      const target = DirectPumpProbe.detectPage(fixture.url);
      rows.push({ name: fixture.name, hints: DirectPumpProbe.readPageHints(doc, target) });
      if (fixture.name === 'gmgn') {
        doc.querySelector('a[href*="solscan.io/token/"]').href = 'https://solscan.io/token/${pool}';
        rows.push({ name: 'gmgn-stale-mint', hints: DirectPumpProbe.readPageHints(doc, target) });
      }
      if (fixture.name === 'axiom') {
        [...doc.querySelectorAll('span')].find(e => e.textContent === 'Price').textContent = 'Unlabeled';
        rows.push({ name: 'axiom-unlabeled-price', hints: DirectPumpProbe.readPageHints(doc, target) });
      }
      if (fixture.name === 'fomo') {
        const header = doc.querySelector('.min-w-120 > div');
        header.parentElement.append(header.cloneNode(true));
        rows.push({ name: 'fomo-duplicate-header', hints: DirectPumpProbe.readPageHints(doc, target) });
      }
    }
    return JSON.stringify(rows);
  })()`);
  const byName = Object.fromEntries(results.map(row => [row.name, row.hints]));
  assert.equal(byName.gmgn.market.priceUsd, '0.015'); assert.equal(byName.gmgn.market.marketCapUsd, '15000000'); assert.equal(byName.gmgn.poolHint, pool);
  assert.equal(byName.axiom.mintHint, mint); assert.equal(byName.axiom.market.priceUsd, '0.00002'); assert.equal(byName.axiom.market.marketCapUsd, '20000');
  assert.equal(byName.fomo.market.priceUsd, '0.00002'); assert.equal(byName.fomo.market.marketCapUsd, '20000');
  assert.deepEqual(byName['gmgn-stale-mint'], {}); assert.equal(byName['axiom-unlabeled-price'].market?.priceUsd, undefined); assert.deepEqual(byName['fomo-duplicate-header'], {});
  console.log('Browser DOM fixtures: 6 scenarios passed.');
  if (process.argv.includes('--live')) {
    const live = evaluate(`(() => { ${bundle}
      const target=DirectPumpProbe.detectPage(location.href);
      return JSON.stringify({target,hints:target?DirectPumpProbe.readPageHints(document,target):null,phantomAvailable:!!window.phantom?.solana});
    })()`, true);
    assert.deepEqual([...new Set(live.map(row => row.target?.site))].sort(), ['AXIOM','FOMO','GMGN']);
    for (const row of live) {
      assert.ok(row.hints?.market?.priceUsd, `No usable price on ${row.target.site}`);
      assert.equal(row.hints.market.mint, row.target.kind === 'MINT' ? row.target.address : row.hints.mintHint);
      console.log(JSON.stringify({site:row.target.site,kind:row.target.kind,mint:row.hints.market.mint,priceUsd:row.hints.market.priceUsd,marketCapUsd:row.hints.market.marketCapUsd,phantomAvailable:row.phantomAvailable}));
    }
    console.log('Live readers: all three sites passed. No wallet method or trading API called.');
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
