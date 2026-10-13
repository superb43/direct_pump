import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const digest = value => createHash('sha256').update(value).digest('hex');
const noticeName = /^(license|licence|copying|notice)(?:[._-].*)?$/i;
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

/** Conservative application import graph; no source or wallet code is executed. */
export async function applicationInputs() {
  const inputs = new Set();
  const embedded = new Map();
  const assets = { name: 'notice-assets', setup(builder) {
    builder.onResolve({ filter: /\.(css|svg)(\?(inline|raw))?$/ }, args => ({ path: args.path, namespace: 'notice-assets' }));
    builder.onLoad({ filter: /.*/, namespace: 'notice-assets' }, () => ({ contents: 'export default "";', loader: 'js' }));
  } };
  for (const [entry, platform, external] of [
    ['entrypoints/background.ts', 'browser', ['wxt/browser', 'util']],
    ['entrypoints/sidepanel/main.ts', 'browser', ['wxt/browser', 'util']],
    ['entrypoints/dashboard/main.ts', 'browser', ['wxt/browser', 'util']],
    ['entrypoints/settings/main.ts', 'browser', ['wxt/browser', 'util']],
    ['entrypoints/content.ts', 'browser', ['wxt/browser', 'util']],
    ['entrypoints/chart.content.ts', 'browser', ['wxt/browser', 'util']],
    ['entrypoints/phantom-main.ts', 'browser', ['wxt/browser', 'util']],
    ['server/cli.ts', 'node', []],
  ]) {
    const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, sourcemap: 'external', outfile: 'notice-trace.mjs', platform,
      format: 'esm', logLevel: 'silent', plugins: [assets], external,
      define: { 'process.env.ANCHOR_BROWSER': '"true"' } });
    for (const file of Object.keys(result.metafile.inputs)) inputs.add(file);
    for (const map of result.outputFiles.filter(file => file.path.endsWith('.map'))) {
      for (const source of JSON.parse(map.text).sources) {
        const encoded = /\/\.pnpm\/([^/]+)\/node_modules\//.exec(source)?.[1]?.split('_')[0];
        if (!encoded) continue;
        const at = encoded.lastIndexOf('@');
        const name = encoded.slice(0, at).replace('+', '/'), version = encoded.slice(at + 1);
        embedded.set(`${name}@${version}`, { name, version });
      }
    }
  }
  // WXT injects these runtime helpers after processing the raw entrypoints.
  const runtime = await build({ stdin: { contents: 'export {browser} from "wxt/browser"; export {ContentScriptContext} from "wxt/utils/content-script-context"; export * from "wxt/utils/define-content-script"; export * from "wxt/utils/define-background"; export * from "wxt/utils/define-unlisted-script";', resolveDir: process.cwd(), loader: 'js' },
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', logLevel: 'silent' });
  for (const file of Object.keys(runtime.metafile.inputs)) inputs.add(file);
  return { inputs, embedded: [...embedded.values()] };
}

export async function inventory() {
  const lock = await readJson('package-lock.json');
  const upstream = await readJson('Docs/licenses/upstream-evidence.json');
  const { inputs, embedded } = await applicationInputs();
  const packages = [];
  for (const [path, locked] of Object.entries(lock.packages)) {
    if (!path) continue;
    const runtimeInput = [...inputs].some(file => file.startsWith(`${path}/`));
    if (locked.dev && !runtimeInput) continue;
    // Lockfile platform build-tool packages must not make the report host-specific.
    if (locked.optional && /^node_modules\/@(?:rollup\/rollup-|esbuild\/)/.test(path)) {
      if ([...inputs].some(file => file.startsWith(`${path}/`))) throw new Error(`Build-tool binary imported by application: ${path}`);
      packages.push({ name: path.split('node_modules/').at(-1), version: locked.version, lockPath: path,
        license: locked.license ?? 'NOASSERTION', bundled: false, integrity: locked.integrity, notices: [] });
      continue;
    }
    if (!existsSync(`${path}/package.json`)) {
      // Platform-specific optional packages absent from this host are not bundled.
      if (locked.optional) continue;
      throw new Error(`Missing locked production package: ${path}; run npm ci.`);
    }
    const manifest = await readJson(`${path}/package.json`);
    if (manifest.version !== locked.version) throw new Error(`Installed version differs from lock: ${path}`);
    const name = manifest.name;
    // Upstream packages can prebundle modules, so preserve the complete locked
    // production closure as well as framework code injected from dev packages.
    const bundled = runtimeInput || !locked.dev && path !== 'node_modules/chain';
    const evidence = upstream.find(row => row.lockPath === path && row.version === locked.version);
    let license = locked.license ?? manifest.license ?? manifest.licenses?.map(value => typeof value === 'string' ? value : value.type).join(' OR ');
    const files = (await readdir(path, { withFileTypes: true })).filter(file => file.isFile() && noticeName.test(file.name)).map(file => `${path}/${file.name}`).sort();
    if (!license && name === 'text-encoding-utf-8' && locked.version === '1.0.2') {
      const text = await readFile(`${path}/LICENSE.md`, 'utf8');
      if (text.includes('This is free and unencumbered software released into the public domain.')) license = 'Unlicense';
    }
    const notices = [];
    for (const file of files) notices.push({ path: file, text: await readFile(file, 'utf8') });
    for (const file of evidence?.noticeFiles ?? []) {
      const text = await readFile(file.path, 'utf8');
      if (digest(text) !== file.sha256) throw new Error(`Upstream notice digest changed: ${file.path}`);
      notices.push({ path: file.path, text, source: file.url, kind: file.kind ?? 'upstream-license-text' });
    }
    if (bundled && (!license || !notices.length)) throw new Error(`Bundled package lacks reviewed license/notice: ${name}@${locked.version}`);
    packages.push({ name, version: locked.version, lockPath: path, license: license ?? 'NOASSERTION', bundled,
      integrity: locked.integrity, repository: manifest.repository, notices });
  }
  for (const module of embedded) {
    if (!packages.some(row => row.name === module.name && row.version === module.version && row.bundled))
      throw new Error(`Prebundled module lacks matching reviewed lock/source coverage: ${module.name}@${module.version}`);
  }
  return packages.sort((a, b) => a.lockPath.localeCompare(b.lockPath, 'en'));
}

export async function documents() {
  const packages = await inventory();
  const application = await readJson('package.json');
  const records = packages.map(({ notices, ...row }) => ({ ...row, notices: notices.map(({ text, ...file }) => ({ ...file, sha256: digest(text) })) }));
  const json = JSON.stringify({ schemaVersion: 1, projectLicense: application.license,
    scope: 'Complete locked production closure and injected framework runtime. Included is conservative (upstream prebundles may embed modules), not a legal opinion.',
    packages: records }, null, 2) + '\n';
  const sections = new Map();
  for (const row of packages.filter(row => row.bundled)) for (const notice of row.notices) {
    const hash = digest(notice.text);
    let section = sections.get(hash);
    if (!section) { section = { text: notice.text, packages: new Set(), sources: new Set() }; sections.set(hash, section); }
    section.packages.add(`${row.name}@${row.version}`);
    if (notice.source) section.sources.add(notice.source);
  }
  let markdown = '# Third-party notices\n\nGenerated by `node scripts/third-party-notices.mjs --write` from the installed lockfile.\n'
    + 'Original Direct Pump application code uses GPL-3.0-only; the components below retain their own terms.\n'
    + 'This inventory does not replace review of distribution scope, Corresponding Source or trademark rights.\n\n'
    + 'Do not redistribute node_modules wholesale. The locked `chain@0.4.2` package has no reviewed license grant and is not in the application import graph; adding it to a bundle blocks this check.\n\n'
    + 'Vendored protocol schema provenance is retained in the project guide in the matching source package. Binary archives include those notices in vendor-notices/NOTICE.md.\n'
    + 'Inter and Geist fonts retain SIL OFL-1.1 terms and Lucide its original license. Full asset notice texts appear below; their originals accompany the matching source package.\n'
    + 'The Solana mark is third-party branding; its presence identifies the network and does not claim endorsement.\n\n'
    + '| Package | License declaration | Conservative distribution coverage |\n| --- | --- | --- |\n';
  for (const row of packages) markdown += `| ${row.name}@${row.version} | ${String(row.license).replaceAll('|', '\\|')} | ${row.bundled ? 'Included' : 'Not included'} |\n`;
  markdown += '\n## Included license and notice texts\n';
  for (const section of sections.values()) markdown += `\n### ${[...section.packages].sort().join(', ')}\n\n`
    + [...section.sources].sort().map(url => `Source: ${url}\n\n`).join('') + `~~~text\n${section.text.trimEnd()}\n~~~\n`;
  for (const file of ['Docs/licenses/assets/INTER-LICENSE.txt', 'Docs/licenses/assets/GEIST-LICENSE.txt', 'Docs/licenses/assets/lucide-LICENSE.txt']) {
    markdown += `\n### ${file}\n\n~~~text\n${(await readFile(file, 'utf8')).trimEnd()}\n~~~\n`;
  }
  return { json, markdown, packages };
}

if (process.argv[1]?.endsWith('/third-party-notices.mjs') || process.argv[1] === 'scripts/third-party-notices.mjs') {
  const result = await documents();
  if (process.argv.includes('--write')) {
    await writeFile('Docs/licenses/dependencies.json', result.json);
    await writeFile('Docs/licenses/NOTICES.md', result.markdown);
  } else {
    if (await readFile('Docs/licenses/dependencies.json', 'utf8') !== result.json || await readFile('Docs/licenses/NOTICES.md', 'utf8') !== result.markdown)
      throw new Error('Third-party inventory is stale; regenerate and review it.');
  }
  console.log(`Third-party inventory: ${result.packages.length} locked/runtime packages; ${result.packages.filter(row => row.bundled).length} in conservative distribution coverage.`);
}
