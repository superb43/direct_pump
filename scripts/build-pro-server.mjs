import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';

const result = await build({
  entryPoints: ['server/cli.ts'],
  outfile: 'server-dist/cli.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  metafile: true,
  // Use the package's existing JS implementation in every deployment environment.
  alias: { 'bigint-buffer': 'bigint-buffer/dist/browser.js' },
  banner: { js: "import { createRequire as dpCreateRequire } from 'node:module'; import { fileURLToPath as dpFileURLToPath } from 'node:url'; import { dirname as dpDirname } from 'node:path'; const require = dpCreateRequire(import.meta.url); const __filename = dpFileURLToPath(import.meta.url); const __dirname = dpDirname(__filename);" },
});
const bigintInputs = Object.keys(result.metafile.inputs).filter(path => path.includes('/bigint-buffer/'));
assert.deepEqual(bigintInputs.map(path => path.slice(path.indexOf('/bigint-buffer/') + 1)), ['bigint-buffer/dist/browser.js']);

// Importing the bundle must neither load native bigint code nor break error stacks.
const smoke = spawnSync(process.execPath, ['--input-type=module', '-e', `
  let nativeBigintAttempted = false;
  const dlopen = process.dlopen;
  process.dlopen = function (module, filename, ...args) {
    if (String(filename).includes('bigint_buffer')) {
      nativeBigintAttempted = true;
      throw new Error('Native bigint loading is forbidden in the Pro bundle');
    }
    return dlopen.call(this, module, filename, ...args);
  };
  await import('./server-dist/cli.mjs');
  if (nativeBigintAttempted) throw new Error('Pro attempted native bigint loading');
  const error = new Error('Pro bundle stack check');
  if (!error.stack?.includes(error.message)) throw new Error('Invalid bundled error stack');
`], { encoding: 'utf8', timeout: 15000 });
if (smoke.status !== 0) throw new Error(`Pro bundle runtime smoke failed: ${smoke.stderr}`);
