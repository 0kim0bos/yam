#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

try {
  const version = execFileSync('npm', ['view', pkg.name, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (version === pkg.version) {
    console.error(`registry:check: failed (${pkg.name}@${pkg.version} already exists)`);
    process.exit(1);
  }
  console.log(`registry:check: ok (latest ${version}, local ${pkg.version})`);
} catch (error) {
  const status = typeof error === 'object' && error && 'status' in error ? error.status : undefined;
  if (status === 1) {
    console.log(`registry:check: ok (${pkg.name} not published yet)`);
    process.exit(0);
  }
  throw error;
}
