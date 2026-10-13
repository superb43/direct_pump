import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, readdir, lstat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, relative } from 'node:path';
import { checkPublication } from './check-publication.mjs';
import { documents } from './third-party-notices.mjs';

const preview = process.argv.includes('--preview');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Release preparation requires Node.js 24 or newer.');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) throw new Error('Invalid release version.');
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!preview) {
  if (dirty) throw new Error('Official artifacts require a clean committed tree. Use --preview only for local review.');
  const tag = execFileSync('git', ['describe', '--tags', '--exact-match', 'HEAD'], { encoding: 'utf8' }).trim();
  if (tag !== `v${pkg.version}`) throw new Error('Release tag must match package.json.');
}
const files = await checkPublication();
const sourceHashes = new Map(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
const thirdParty = await documents();
if (await readFile('licenses/dependencies.json', 'utf8') !== thirdParty.json || await readFile('THIRD_PARTY_NOTICES.md', 'utf8') !== thirdParty.markdown)
  throw new Error('Review and regenerate the third-party inventory before packaging.');
execFileSync('npm', ['run', 'verify'], { stdio: 'inherit' });
if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== commit) throw new Error('Source commit changed during verification.');
const after = await checkPublication();
if (JSON.stringify(after) !== JSON.stringify(files)) throw new Error('Publication candidates changed during verification.');
const manifest = JSON.parse(await readFile('.output/chrome-mv3/manifest.json', 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Extension build version differs from package.json.');

const root = resolve('.'), output = resolve('output/releases');
await mkdir(output, { recursive: true });
const stage = await mkdtemp(join(tmpdir(), 'direct-pump-release-'));
const prefix = `direct-pump-${pkg.version}${preview ? '-preview' : ''}`;
const notes = ['LICENSE', 'COPYRIGHT', 'THIRD_PARTY_NOTICES.md'];
const sha256 = value => createHash('sha256').update(value).digest('hex');

async function copyTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const item of await readdir(source, { withFileTypes: true })) {
    if (['node_modules', '.git', 'build', 'prebuilds'].includes(item.name)) continue;
    const from = join(source, item.name), to = join(destination, item.name);
    if (item.isSymbolicLink()) throw new Error(`Source archive refuses symlinks: ${relative(root, from)}`);
    if (item.isDirectory()) await copyTree(from, to);
    else if (item.isFile() && !item.name.endsWith('.node')) await copyFile(from, to);
  }
}

try {
  const extension = join(stage, 'extension'), server = join(stage, 'server'), source = join(stage, 'source');
  await copyTree('.output/chrome-mv3', extension);
  await mkdir(server); await copyFile('server-dist/cli.mjs', join(server, 'cli.mjs'));
  await copyFile('server-dist/cli.mjs.map', join(server, 'cli.mjs.map'));
  for (const folder of [extension, server]) for (const file of notes) await copyFile(file, join(folder, file));
  await mkdir(join(extension, 'vendor-notices')); await mkdir(join(server, 'vendor-notices'));
  for (const folder of [extension, server]) await copyFile('src/vendor/NOTICE.md', join(folder, 'vendor-notices', 'NOTICE.md'));

  await mkdir(source);
  for (const file of files) {
    const from = resolve(root, file);
    if (!from.startsWith(root + '/') || (await lstat(from)).isSymbolicLink()) throw new Error(`Unsafe source candidate: ${file}`);
    if (sha256(await readFile(from)) !== sourceHashes.get(file)) throw new Error(`Source changed after verification: ${file}`);
    const to = join(source, file); await mkdir(dirname(to), { recursive: true }); await copyFile(from, to);
  }
  // GPL/LGPL dependency sources and all supplied notices accompany the binaries;
  // npm ci + the lockfile remains the documented reproducible build path.
  const included = thirdParty.packages.filter(row => row.bundled);
  for (const row of included) await copyTree(row.lockPath, join(source, 'dependency-sources', row.lockPath));
  const preferred = JSON.parse(await readFile('licenses/preferred-sources.json', 'utf8'));
  const preferredFolder = join(source, 'preferred-upstream-sources'); await mkdir(preferredFolder);
  for (const row of included.filter(row => /GPL-/.test(row.license))) {
    const record = preferred.find(record => record.name === row.name && record.version === row.version && record.verified === true);
    if (!record || !/^https:\/\/codeload\.github\.com\/[^/]+\/[^/]+\/tar\.gz\/[a-f0-9]{40}$/.test(record.url))
      throw new Error(`Reviewed preferred source is missing for ${row.name}@${row.version}`);
    const response = await fetch(record.url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Preferred source fetch failed for ${row.name}`);
    const archive = Buffer.from(await response.arrayBuffer());
    if (sha256(archive) !== record.sha256) throw new Error(`Preferred source digest changed for ${row.name}`);
    await writeFile(join(preferredFolder, `${row.name.replaceAll('/', '__')}@${row.version}.tar.gz`), archive);
  }
  await writeFile(join(source, 'DEPENDENCY-SOURCES.md'), '# Dependency sources\n\n'
    + 'These directories retain the original installed package source, manifests and notices for the conservative application import graph.\n'
    + 'Generated native binaries/build directories and nested node_modules are excluded; their source and build instructions remain in their packages.\n'
    + 'Use Node.js 24 LTS, npm ci, and npm run verify at the project root. The lockfile pins upstream package integrity.\n'
    + 'Pinned full GPL/LGPL upstream repositories (including build files) accompany this package under preferred-upstream-sources; hashes/provenance are in licenses/preferred-sources.json.\n'
    + 'Review preferred-source completeness and publisher-declaration-only notices before publication.\n');
  const metadata = { version: pkg.version, commit, preview, dirty, license: pkg.license, node: process.version,
    packageLockSha256: sha256(await readFile('package-lock.json')), includedDependencyPackages: included.length,
    source: `${prefix}-source.tar.gz`, publication: 'Not published by this tool; maintainer review and approval are required.' };
  await writeFile(join(source, 'PREPARATION.json'), JSON.stringify(metadata, null, 2) + '\n');
  const archives = [`${prefix}-extension.zip`, `${prefix}-server.tar.gz`, `${prefix}-source.tar.gz`];
  if (!preview && execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Release tree became dirty after verification.');
  for (const file of archives) await rm(join(output, file), { force: true });
  execFileSync('zip', ['-q', '-r', join(output, archives[0]), '.'], { cwd: extension });
  // BSD tar otherwise creates AppleDouble files for macOS extended attributes;
  // names such as ._example.test.ts are then mistaken for source on extraction.
  const archiveOptions = { env: { ...process.env, COPYFILE_DISABLE: '1' } };
  execFileSync('tar', ['-czf', join(output, archives[1]), '-C', server, '.'], archiveOptions);
  execFileSync('tar', ['-czf', join(output, archives[2]), '-C', source, '.'], archiveOptions);
  await writeFile(join(output, `${prefix}-SHA256SUMS`), (await Promise.all(archives.map(async file => `${sha256(await readFile(join(output, file)))}  ${file}`))).join('\n') + '\n');
  await writeFile(join(output, `${prefix}-PREPARATION.json`), JSON.stringify(metadata, null, 2) + '\n');
  console.log(`Prepared ${preview ? 'local PREVIEW' : 'tagged build'} artifacts in output/releases; no release, tag, push, signing or deployment performed.`);
} finally { await rm(stage, { recursive: true, force: true }); }
