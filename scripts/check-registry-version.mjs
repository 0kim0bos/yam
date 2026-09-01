#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REGISTRY = 'https://registry.npmjs.org/';

function registryArgs(pkg) {
  return ['view', `${pkg.name}@${pkg.version}`, 'version', '--json', '--registry', REGISTRY];
}

function classify(result) {
  if (result.status === 0) return 'published';
  if (result.status !== 1 || result.signal != null || result.error != null) return 'probe_failed';
  const diagnostic = `${String(result.stdout || '')}\n${String(result.stderr || '')}`;
  const errorCodes = [...new Set(
    [...diagnostic.matchAll(/(?:\bcode\s+|["']code["']\s*:\s*["'])(E[A-Z0-9_]+)/gi)]
      .map((match) => match[1].toUpperCase())
  )];
  const conflictingFailure = /\b(?:E401|E403|ENEEDAUTH|ENETWORK|ETIMEDOUT|ECONN[A-Z0-9_]*|Unauthorized|Forbidden|authentication|network|timed?\s*out|timeout)\b/i.test(diagnostic);
  if (!conflictingFailure && errorCodes.length === 1 && errorCodes[0] === 'E404') return 'not_published';
  return 'probe_failed';
}

function selfTest() {
  const pkg = { name: 'yam-flow', version: '2.8.0' };
  assert.deepEqual(
    registryArgs(pkg),
    ['view', 'yam-flow@2.8.0', 'version', '--json', '--registry', REGISTRY],
    'registry readiness must query the exact immutable version on the official registry'
  );
  assert.equal(classify({ status: 0, stdout: '"2.8.0"', stderr: '' }), 'published');
  assert.equal(classify({ status: 1, stdout: '', stderr: 'npm error code E404\n404 Not Found' }), 'not_published');
  assert.equal(classify({ status: 1, stdout: '', stderr: 'npm error code E401' }), 'probe_failed');
  assert.equal(classify({ status: 1, stdout: '', stderr: 'network timeout' }), 'probe_failed');
  assert.equal(classify({ status: 1, stdout: '', stderr: 'npm error code E404\nnpm error code E401' }), 'probe_failed');
  assert.equal(classify({ status: 1, stdout: '', stderr: 'npm error code E404\nnetwork timeout' }), 'probe_failed');
  assert.equal(classify({ status: 1, stdout: '', stderr: '404 Not Found' }), 'probe_failed');
  assert.equal(classify({ status: 2, stdout: '', stderr: 'npm error code E404\n404 Not Found' }), 'probe_failed');
  assert.equal(classify({ status: null, signal: 'SIGTERM', stdout: '', stderr: 'npm error code E404\n404 Not Found' }), 'probe_failed');
  assert.equal(classify({ status: 1, error: new Error('spawn failed'), stdout: '', stderr: 'npm error code E404\n404 Not Found' }), 'probe_failed');
  console.log('registry:check:smoke: ok');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const result = spawnSync('npm', registryArgs(pkg), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const outcome = classify(result);
  if (outcome === 'not_published') {
    console.log(`registry:check: ok (${pkg.name}@${pkg.version} is not published)`);
  } else if (outcome === 'published') {
    console.error(`registry:check: failed (${pkg.name}@${pkg.version} already exists)`);
    process.exitCode = 1;
  } else {
    const status = typeof result.status === 'number' ? result.status : 'unavailable';
    console.error(`registry:check: failed (exact-version probe did not return E404; exit ${status})`);
    process.exitCode = 1;
  }
}
