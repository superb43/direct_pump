import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function prose(markdown) {
  let fence;
  return markdown.split('\n').map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return '';
    }
    return fence ? '' : line;
  }).join('\n');
}

export function headingAnchors(markdown) {
  const anchors = new Set();
  for (const match of prose(markdown).matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = match[1].replace(/<[^>]*>/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    let anchor = slug;
    for (let index = 1; anchors.has(anchor); index++) anchor = `${slug}-${index}`;
    anchors.add(anchor);
  }
  return anchors;
}

function exactFile(file, root) {
  const path = relative(root, file);
  if (path === '..' || path.startsWith('../') || isAbsolute(path)) return false;
  let parent = root;
  for (const part of path.split('/')) {
    if (!existsSync(parent) || !readdirSync(parent).includes(part)) return false;
    parent = resolve(parent, part);
  }
  return existsSync(parent);
}

export function checkDocument(file, root = process.cwd()) {
  root = resolve(root);
  const source = resolve(root, file);
  const text = prose(readFileSync(source, 'utf8'));
  const references = new Map([...text.matchAll(/^\s*\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm)]
    .map(match => [match[1].toLowerCase(), match[2] ?? match[3]]));
  const links = [
    ...[...text.matchAll(/\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))[^)]*\)/g)].map(match => match[1] ?? match[2]),
    ...[...text.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map(match => match[1]),
  ];
  for (const match of text.matchAll(/\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    const label = (match[2] || match[1]).toLowerCase();
    if (!references.has(label)) throw new Error(`${file}: missing link definition [${label}]`);
    links.push(references.get(label));
  }
  let checked = 0;
  for (const link of links) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link)) continue;
    const [url, fragment] = link.split('#');
    const path = decodeURIComponent(url.split('?')[0]);
    if (path && extname(path).toLowerCase() !== '.md') continue;
    if (!path && fragment === undefined) continue;
    const target = path ? resolve(dirname(source), path) : source;
    if (!exactFile(target, root)) throw new Error(`${file}: missing or incorrectly cased document ${link}`);
    if (fragment && !headingAnchors(readFileSync(target, 'utf8')).has(decodeURIComponent(fragment))) {
      throw new Error(`${file}: missing heading anchor ${link}`);
    }
    checked++;
  }
  return checked;
}

export function checkDocs(root = process.cwd()) {
  const files = ['README.md', 'Docs/PROJECT.md'];
  for (const file of ['AGENTS.md', 'ARCHITECTURE.md', 'DESIGN.md', 'PRODUCT.md']) {
    if (existsSync(resolve(root, file))) files.push(file);
  }
  const count = files.reduce((sum, file) => sum + checkDocument(file, root), 0);
  console.log(`Documentation: ${count} local Markdown links/anchors checked in ${files.length} active documents.`);
  return count;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) checkDocs();
