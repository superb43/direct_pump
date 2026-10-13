import { execFileSync } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { APP_VERSION } from '../src/app-version.ts';

export function validateReleaseVersions(versions) {
  const version = versions.package;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid project version.');
  for (const [field, value] of Object.entries(versions)) if (value !== version) throw new Error(`Release version differs: ${field}`);
}

export function publicationFiles() {
  return [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
}

export function projectNotices(policy) {
  return Object.fromEntries(['LICENSE', 'COPYRIGHT', 'VENDOR'].map(name => {
    const start = `<!-- ${name}:START -->\n~~~text\n`, end = `~~~\n<!-- ${name}:END -->`;
    if (policy.split(start).length !== 2 || policy.split(end).length !== 2) throw new Error(`Missing or duplicated project notice: ${name}`);
    const from = policy.indexOf(start) + start.length, to = policy.indexOf(end);
    if (to <= from) throw new Error(`Empty or malformed project notice: ${name}`);
    return [name, policy.slice(from, to)];
  }));
}

export async function readProjectNotices() {
  return { ...projectNotices(await readFile('Docs/PROJECT.md', 'utf8')),
    'THIRD_PARTY_NOTICES.md': await readFile('Docs/licenses/NOTICES.md', 'utf8') };
}

export function validatePublicationPaths(files) {
  const privateDirectory = /(^|\/)(?:node_modules|\.git|\.omx|\.codex|\.claude|\.agents|\.impeccable|\.wxt|\.output|server-dist|pro-state|\.private|output|\.playwright-cli)(\/|$)/;
  const privateSuffix = /\.(?:enc|pem|key|sqlite(?:-wal|-shm|-journal)?|db(?:-wal|-shm|-journal)?|sock|log)$/i;
  const internal = /^(?:AGENTS|ARCHITECTURE|DESIGN|PRODUCT)\.md$|^docs\/(?:DEVELOPMENT-HISTORY|PRO-UI-AUDIT|PRO-ONBOARDING|MEDIA)\.md$/i;
  const unsafe = files.filter(file => privateDirectory.test(file) || privateSuffix.test(file) || internal.test(file)
    || /(^|\/)\.env(?:\.|$)/.test(file) && !/(^|\/)\.env\.example$/.test(file));
  if (unsafe.length) throw new Error(`Private/generated publication candidates:\n${unsafe.join('\n')}`);
}

export async function checkPublication() {
  const files = publicationFiles();
  validatePublicationPaths(files);
  for (const file of files) if ((await lstat(file)).isSymbolicLink()) throw new Error(`Publication refuses source symlink: ${file}`);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  validateReleaseVersions({ package: pkg.version, lock: lock.version, lockedRoot: lock.packages[''].version, application: APP_VERSION });
  if (pkg.license !== 'GPL-3.0-only' || lock.packages[''].license !== pkg.license) throw new Error('Project SPDX declarations differ.');
  const hash = value => createHash('sha256').update(value).digest('hex');
  if (hash((await readProjectNotices()).LICENSE) !== hash(await readFile('node_modules/@raydium-io/raydium-sdk-v2/LICENSE'))) throw new Error('GPLv3 text differs from the verified unmodified upstream copy.');
  const required = ['Docs/PROJECT.md', 'Docs/licenses/NOTICES.md', 'Docs/licenses/preferred-sources.json', '.github/CODEOWNERS'];
  for (const file of required) await readFile(file);
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/security.yml', '.github/workflows/release-build.yml']) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/uses:\s*([^\s#]+)/g)) if (!/^[^@]+@[a-f0-9]{40}$/.test(match[1])) throw new Error(`Action is not pinned: ${file}`);
    if (/pull_request_target|self-hosted|contents:\s*write/.test(text)) throw new Error(`Privileged publication workflow requires review: ${file}`);
  }
  console.log(`Publication paths and project declarations: ${files.length} candidates checked. No remote state changed.`);
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await checkPublication();
