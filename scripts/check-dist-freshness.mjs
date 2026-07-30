#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';

const pairs = [
  ['src/bin/yam.ts', 'dist/bin/yam.js'],
  ['src/lib/skill-installation.ts', 'dist/lib/skill-installation.js'],
  ['src/lib/external-updates.ts', 'dist/lib/external-updates.js'],
  ['src/lib/trust-kernel.ts', 'dist/lib/trust-kernel.js'],
  ['src/lib/ueye-artifacts.ts', 'dist/lib/ueye-artifacts.js'],
];

const stale = [];
for (const [src, out] of pairs) {
  if (!existsSync(out)) {
    stale.push(`${out} missing`);
    continue;
  }
  if (statSync(out).mtimeMs < statSync(src).mtimeMs) stale.push(`${out} older than ${src}`);
}

if (existsSync('dist/bin/yam.js') && (statSync('dist/bin/yam.js').mode & 0o111) === 0) {
  stale.push('dist/bin/yam.js is not executable');
}

if (stale.length > 0) {
  console.error('dist:freshness: failed');
  for (const item of stale) console.error(item);
  process.exit(1);
}

console.log('dist:freshness: ok');
