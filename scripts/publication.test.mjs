import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicationPaths, validateReleaseVersions } from './check-publication.mjs';
import { inventory } from './third-party-notices.mjs';

test('public docs, fixtures and credential-free example configuration remain allowed', () => {
  assert.doesNotThrow(() => validatePublicationPaths(['README.md', 'docs/ARCHITECTURE.md', '.env.example', 'tests/fixtures/sites/gmgn.html', 'public/fonts/INTER-LICENSE.txt']));
});
test('runtime state, private tooling, actual environment files and encrypted backups cannot become source candidates', () => {
  for (const path of ['.env', '.env.production', 'nested/.env.local', 'pro-state/journal.json', 'wallet.enc', 'backup.key', 'data.sqlite-wal', '.omx/notepad.md', 'node_modules/pkg/index.js', 'output/releases/build.zip', 'server-dist/cli.mjs', 'ARCHITECTURE.md', 'docs/DEVELOPMENT-HISTORY.md']) {
    assert.throws(() => validatePublicationPaths([path]), /Private\/generated publication candidates/);
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
