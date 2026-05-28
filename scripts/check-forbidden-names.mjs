#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const ignoreDirs = new Set(['.git', 'dist', 'node_modules']);
const ignoreFiles = new Set(['scripts/check-forbidden-names.mjs']);
const ignoreExts = new Set(['.tgz', '.zip', '.tar', '.gz', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov', '.webm']);
const blockedTerms = [
  [83, 110, 101, 97, 107, 111, 115, 99, 111, 112, 101],
  [69, 67, 67],
  [69, 118, 101, 114, 121, 116, 104, 105, 110, 103, 32, 67, 108, 97, 117, 100, 101],
  [79, 112, 101, 110, 32, 68, 101, 115, 105, 103, 110],
  [75, 97, 114, 112, 97, 116, 104, 121],
  [66, 77, 65, 68],
  [83, 117, 112, 101, 114, 112, 111, 119, 101, 114, 115],
  [65, 105, 100, 101, 114],
  [79, 112, 101, 110, 72, 97, 110, 100, 115],
  [68, 101, 118, 105, 110],
  [67, 117, 114, 115, 111, 114],
  [67, 108, 97, 117, 100, 101, 32, 67, 111, 100, 101],
  [67, 111, 112, 105, 108, 111, 116],
  [52264, 50857],
  [98, 111, 114, 114, 111, 119],
  [98, 111, 114, 114, 111, 119, 101, 100],
  [98, 111, 114, 114, 111, 119, 105, 110, 103],
  [105, 110, 115, 112, 105, 114, 101, 100],
  [105, 110, 102, 108, 117, 101, 110, 99, 101, 100],
  [100, 101, 114, 105, 118, 101, 100, 32, 102, 114, 111, 109],
  [116, 97, 107, 101, 110, 32, 102, 114, 111, 109],
  [97, 100, 97, 112, 116, 101, 100, 32, 102, 114, 111, 109],
].map((codes) => String.fromCodePoint(...codes));

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const patterns = blockedTerms.map((term) => new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(term)}([^\\p{L}\\p{N}_]|$)`, 'iu'));

function extname(path) {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (ignoreDirs.has(entry)) continue;
    const path = join(dir, entry);
    const rel = relative(root, path);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, files);
      continue;
    }
    if (ignoreExts.has(extname(entry))) continue;
    files.push(rel);
  }
  return files;
}

const hits = [];
for (const file of walk(root)) {
  if (ignoreFiles.has(file)) continue;
  const text = readFileSync(join(root, file), 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      if (pattern.test(line)) hits.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (hits.length > 0) {
  console.error('forbidden-names: failed');
  for (const hit of hits) console.error(hit);
  process.exit(1);
}

console.log('forbidden-names: ok');
