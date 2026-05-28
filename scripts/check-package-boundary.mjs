#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const cache = join(tmpdir(), 'yam-npm-cache');
mkdirSync(cache, { recursive: true });
const env = { ...process.env, npm_config_cache: cache };
const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8', env });
const packs = JSON.parse(output);
const files = packs[0]?.files?.map((file) => file.path) ?? [];
const blocked = [
  /^\.git\//,
  /^\.codex\//,
  /^\.agents\//,
  /^node_modules\//,
  /^coverage\//,
  /^tmp\//,
  /^logs\//,
  /^\.env/,
  /^\.npmrc$/,
  /^\.pypirc$/,
  /^\.netrc$/,
  /^.*\.tgz$/,
  /^.*\.map$/,
  /^.*\.pem$/,
  /^.*\.key$/,
  /^.*\.sqlite3?$/,
  /^.*\.dump$/,
];
const required = [
  'dist/bin/yam.js',
  'dist/lib/trust-kernel.js',
  'dist/lib/trust-kernel.d.ts',
  'README.md',
  'LICENSE',
  'package.json',
];

const blockedHits = files.filter((file) => blocked.some((pattern) => pattern.test(file)));
const missing = required.filter((file) => !files.includes(file));

if (blockedHits.length > 0 || missing.length > 0) {
  console.error('package-boundary: failed');
  for (const hit of blockedHits) console.error(`blocked package file: ${hit}`);
  for (const file of missing) console.error(`missing required package file: ${file}`);
  process.exit(1);
}

console.log(`package-boundary: ok (${files.length} files)`);
