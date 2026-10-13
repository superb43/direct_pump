import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDocument, checkDocs, headingAnchors } from './check-docs.mjs';

async function fixture(files, run) {
  const root = await mkdtemp(join(tmpdir(), 'direct-pump-docs-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      await mkdir(join(root, name, '..'), { recursive: true });
      await writeFile(join(root, name), text);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('checks relative, fragment, HTML and defined reference links without requiring external URLs', async () => {
  await fixture({ 'README.md': '# Start\n[Here](#start) [Guide](Docs/PROJECT.md#pro-setup) <a href="Docs/PROJECT.md#pro-setup">Pro</a>\n[Setup][pro]\n[pro]: Docs/PROJECT.md#pro-setup\n[External](https://example.invalid/guide.md#missing)', 'Docs/PROJECT.md': '# Project\n## Pro setup\n[Home](../README.md#start)' }, root => {
    assert.equal(checkDocument('README.md', root), 4);
    assert.equal(checkDocument('Docs/PROJECT.md', root), 1);
  });
});

test('rejects missing documents and case mismatches even on a case-insensitive filesystem', async () => {
  await fixture({ 'README.md': '[Guide](docs/PROJECT.md)', 'Docs/PROJECT.md': '# Project' }, async root => {
    assert.throws(() => checkDocument('README.md', root), /incorrectly cased/);
    await writeFile(join(root, 'README.md'), '[Guide](Docs/PRO.md)');
    assert.throws(() => checkDocument('README.md', root), /missing.*document/);
  });
});

test('rejects missing anchors, outside-repository targets and undefined references', async () => {
  await fixture({ 'README.md': '[Lost](#missing)' }, async root => {
    assert.throws(() => checkDocument('README.md', root), /missing heading anchor/);
    await writeFile(join(root, 'README.md'), '[Lost](../outside.md)');
    assert.throws(() => checkDocument('README.md', root), /missing.*document/);
    await writeFile(join(root, 'README.md'), '[Lost][missing]');
    assert.throws(() => checkDocument('README.md', root), /missing link definition/);
  });
});

test('heading anchors retain Unicode and duplicates while ignoring fenced examples', () => {
  assert.deepEqual([...headingAnchors('# 설정 안내\n## Same\n## Same\n## Same-1\n~~~text\n## Ignored\n~~~\n```md\n# Also ignored\n```')], ['설정-안내', 'same', 'same-1', 'same-1-1']);
});

test('a public checkout needs no private docs and history is not active authority', async () => {
  await fixture({ 'README.md': '# Readme', 'Docs/PROJECT.md': '# Project', 'Docs/DESIGN-HISTORY.md': '[Historical](missing.md)' }, async root => {
    assert.equal(checkDocs(root), 0);
    await writeFile(join(root, 'DESIGN.md'), '[Current](missing.md)');
    assert.throws(() => checkDocs(root), /missing.*document/);
  });
});
