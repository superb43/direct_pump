import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validatePublicationPaths, validateReleaseVersions, projectNotices } from './check-publication.mjs';
import { inventory } from './third-party-notices.mjs';

test('public docs, fixtures and credential-free example configuration remain allowed', () => {
  assert.doesNotThrow(() => validatePublicationPaths(['README.md', 'Docs/PROJECT.md', '.env.example', 'tests/fixtures/sites/gmgn.html', 'Docs/licenses/assets/INTER-LICENSE.txt']));
});
test('runtime state, private tooling, actual environment files and encrypted backups cannot become source candidates', () => {
  for (const path of ['.env', '.env.production', 'nested/.env.local', 'pro-state/journal.json', 'wallet.enc', 'backup.key', 'data.sqlite-wal', '.omx/notepad.md', 'node_modules/pkg/index.js', 'output/releases/build.zip', 'server-dist/cli.mjs', 'ARCHITECTURE.md', 'docs/DEVELOPMENT-HISTORY.md', 'Docs/DEVELOPMENT-HISTORY.md']) {
    assert.throws(() => validatePublicationPaths([path]), /Private\/generated publication candidates/);
  }
});
test('consolidated guide retains the full GPL text and rejects lost or duplicated notice boundaries', async () => {
  const policy = await readFile('Docs/PROJECT.md', 'utf8');
  const notices = projectNotices(policy);
  assert.equal(notices.LICENSE, await readFile('node_modules/@raydium-io/raydium-sdk-v2/LICENSE', 'utf8'));
  assert.match(notices.COPYRIGHT, /GPL-3\.0-only/);
  assert.match(notices.VENDOR, /2f540c2107988e0f97efa5917100bb912c96c17a/);
  for (const name of ['LICENSE', 'COPYRIGHT', 'VENDOR']) {
    assert.throws(() => projectNotices(policy.replace(`<!-- ${name}:START -->`, '')), /project notice/);
    assert.throws(() => projectNotices(policy + `\n<!-- ${name}:START -->\n~~~text\n`), /project notice/);
  }
});
test('release version parity rejects each stale lock/application field', () => {
  const versions = { package: '1.2.3', lock: '1.2.3', lockedRoot: '1.2.3', application: '1.2.3' };
  assert.doesNotThrow(() => validateReleaseVersions(versions));
  for (const field of ['lock', 'lockedRoot', 'application']) assert.throws(() => validateReleaseVersions({ ...versions, [field]: '1.2.2' }), /Release version differs/);
});
test('distribution coverage retains injected WXT runtime and upstream prebundled modules', async () => {
  const records = await inventory();
  for (const name of ['wxt', '@wxt-dev/browser', 'agentkeepalive', 'humanize-ms', 'fast-stable-stringify']) {
    const row = records.find(row => row.name === name);
    assert.ok(row?.bundled, `${name} is redistributed or conservatively covered`);
    assert.ok(row.notices.length, `${name} retains reviewed notices`);
  }
  assert.equal(records.find(row => row.name === 'chain')?.bundled, false);
});
