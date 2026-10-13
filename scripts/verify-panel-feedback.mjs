/** Offline Basic feedback regression; production views, synthetic receipts, no signing. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

async function verifyFeedback(page, baseUrl) {
  const checks = [], captures = [], errors = [];
  const assert = (ok, message) => { if (!ok) throw new Error(message); checks.push(message); };
  page.on('pageerror', error => errors.push(String(error)));
  await page.context().route('**/*', route => new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort());
  await page.clock.install();
  const visit = async (site, state, width, motion = 'reduce') => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto(`${baseUrl}/preview/sidepanel.html?holdings&position&receipt&site=${site}&status=${state}`);
    await page.locator('.status-text').filter({ hasText: state === 'CONFIRMED' ? 'Buy confirmed.' : state === 'FAILED' ? 'Slippage' : state === 'SIGNING' ? 'Phantom approval' : state === 'SUBMITTED' ? 'Submitted' : state === 'UNKNOWN' ? 'unresolved' : 'expired' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
  };
  const capture = async name => {
    const path = `output/playwright/trade-feedback/${name}.png`;
    await page.screenshot({ path, animations: 'disabled', scale: 'css' });
    captures.push(path);
  };
  for (const site of ['gmgn', 'axiom', 'fomo']) {
    for (const width of [280, 390]) {
      for (const state of ['SIGNING', 'SUBMITTED', 'UNKNOWN', 'CONFIRMED', 'FAILED', 'EXPIRED']) {
        await visit(site, state, width);
        const facts = await page.evaluate(() => {
          const root = document.querySelector('#trading > div').shadowRoot;
          const status = root.querySelector('.status'), sell = root.querySelector('.sell-group');
          return {
            afterSell: sell.nextElementSibling === status,
            beforePosition: status.nextElementSibling === root.querySelector('.position'),
            overflow: document.documentElement.scrollWidth > innerWidth,
            pending: status.classList.contains('pending'),
            alert: status.getAttribute('role') === 'alert',
            wheel: getComputedStyle(status, '::before').animationName,
            link: root.querySelector('.explorer').getAttribute('href'),
          };
        });
        const label = `${site}/${width}/${state}`;
        assert(facts.afterSell && facts.beforePosition, `${label}: feedback is directly below Sell`);
        assert(!facts.overflow, `${label}: no horizontal overflow`);
        assert(await page.locator('.fee-receipt').count() === 0, `${label}: no detailed panel receipt`);
        assert(facts.pending === ['SIGNING', 'SUBMITTED', 'UNKNOWN'].includes(state), `${label}: indicator follows unresolved status`);
        assert(facts.wheel === 'none', `${label}: reduced motion disables spinning`);
        if (state === 'FAILED') assert(facts.alert, `${label}: failure uses alert semantics`);
        if (state === 'SIGNING' || state === 'UNKNOWN') assert(!facts.link, `${label}: no stale signature link`);
        else assert(facts.link?.startsWith('https://solscan.io/tx/'), `${label}: signature-bound explorer link`);
        if (site === 'gmgn' || width === 390 && ['UNKNOWN', 'FAILED'].includes(state)) await capture(`${site}-${width}-${state.toLowerCase()}`);
        await page.clock.runFor(5_001);
        assert(await page.locator('.status').isVisible() === (state !== 'CONFIRMED'), `${label}: only confirmed feedback auto-hides`);
        if (state === 'CONFIRMED') {
          await page.clock.runFor(3_000);
          assert(await page.locator('.status').isHidden(), `${label}: fee audit polling does not revive success`);
        }
      }
    }
  }
  await visit('gmgn', 'SIGNING', 390, 'no-preference');
  assert(await page.locator('.status').evaluate(e => getComputedStyle(e, '::before').animationName) === 'status-spin', 'normal motion: pending indicator spins');
  await visit('gmgn', 'CONFIRMED', 390);
  await page.locator('.savings-details').click();
  assert(await page.evaluate(() => window.mockRequests.filter(r => r.type === 'OPEN_DASHBOARD').length) === 1, 'Details retains receipt dashboard navigation');
  assert(await page.evaluate(() => window.mockRequests.filter(r => r.type === 'TRADE' || r.type === 'PRO' && r.method && r.method !== 'GET').length) === 0, 'no trade or server mutation issued');
  await page.goto(`${baseUrl}/preview/dashboard.html?status=FAILED&holdings`);
  await page.getByRole('button', { name: 'TX failed', exact: true }).click();
  await page.locator('#detail-diagnostic summary').click();
  assert((await page.locator('#detail-logs').textContent()).includes('6004'), 'receipt dashboard retains failure diagnostics');
  assert(errors.length === 0, `no browser errors: ${errors.join('; ')}`);
  return { checks, captures, realTrades: 0, scope: 'Offline production views; no remote provider, signing or funded trade validation.' };
}

const baseUrl = process.env.DP_FEEDBACK_PREVIEW_URL ?? 'http://127.0.0.1:5193';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) throw new Error('Use a localhost preview origin.');
const session = `feedback-${process.pid}`;
const run = args => spawnSync('playwright-cli', [`--session=${session}`, ...args], { encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
mkdirSync('output/playwright/trade-feedback', { recursive: true });
try {
  const opened = run(['open', `${baseUrl}/preview/sidepanel.html?holdings&receipt`]);
  if (opened.status !== 0) throw new Error(opened.stdout + opened.stderr);
  const snapshot = run(['snapshot']);
  if (snapshot.status !== 0) throw new Error(snapshot.stdout + snapshot.stderr);
  const result = run(['run-code', `async page => (${verifyFeedback.toString()})(page, ${JSON.stringify(baseUrl)})`]);
  writeFileSync('output/playwright/trade-feedback/capture.log', result.stdout + result.stderr);
  if (result.status !== 0 || result.stdout.includes('### Error')) throw new Error(result.stdout.split('### Ran Playwright code')[0] + result.stderr);
  const report = JSON.parse(result.stdout.split('### Result\n')[1].split('### Ran Playwright code')[0].trim());
  writeFileSync('output/playwright/trade-feedback/capture.json', JSON.stringify(report, null, 2));
  console.log(`${report.checks.length} feedback checks passed; ${report.captures.length} captures; no signing or trade.`);
} finally {
  run(['close']);
}
