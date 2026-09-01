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
  'dist/lib/skill-installation.js',
  'dist/lib/skill-installation.d.ts',
  'dist/lib/external-updates.js',
  'dist/lib/external-updates.d.ts',
  'dist/lib/gate-result.js',
  'dist/lib/gate-result.d.ts',
  'dist/lib/benchmark-promotion.js',
  'dist/lib/benchmark-promotion.d.ts',
  'dist/lib/design-production.js',
  'dist/lib/design-production.d.ts',
  'dist/lib/verification-closure.js',
  'dist/lib/verification-closure.d.ts',
  'dist/lib/media-provider-receipt.js',
  'dist/lib/media-provider-receipt.d.ts',
  'dist/lib/trust-kernel.js',
  'dist/lib/trust-kernel.d.ts',
  'dist/lib/next-step.js',
  'dist/lib/next-step.d.ts',
  'dist/lib/scout-receipt.js',
  'dist/lib/scout-receipt.d.ts',
  'dist/lib/release-registry-status.js',
  'dist/lib/release-registry-status.d.ts',
  'dist/lib/release-auth-readiness.js',
  'dist/lib/release-auth-readiness.d.ts',
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
