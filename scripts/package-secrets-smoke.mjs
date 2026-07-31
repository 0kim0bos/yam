#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  formatScanResult,
  MAX_PACKAGE_TEXT_BYTES,
  scanPackageFiles,
} from './check-package-secrets.mjs';
import { findSecretPatternIds } from './secret-patterns.mjs';

const checker = resolve('scripts/check-package-secrets.mjs');
const root = mkdtempSync(join(tmpdir(), 'yam-package-secrets-smoke-'));
const fakeNpmToken = `npm_${'A1'.repeat(18)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createPackage(name, files) {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ name: `yam-secret-fixture-${name}`, version: '1.0.0', files: Object.keys(files) }, null, 2)}\n`,
  );
  for (const [path, contents] of Object.entries(files)) {
    writeFileSync(join(directory, path), contents);
  }
  return directory;
}

function runChecker(cwd) {
  return spawnSync(process.execPath, [checker], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_ignore_scripts: 'true' },
  });
}

try {
  const patternCases = [
    [['-----BEGIN', 'PRIVATE KEY-----'].join(' '), 'private_key'],
    [['-----BEGIN', 'ENCRYPTED PRIVATE KEY-----'].join(' '), 'private_key'],
    [['-----BEGIN', 'PGP PRIVATE KEY BLOCK-----'].join(' '), 'private_key'],
    [fakeNpmToken, 'npm_token'],
    [`_authToken=${'Ab1'.repeat(10)}`, 'npm_auth_token'],
    [`ghp_${'Ab1'.repeat(12)}`, 'github_token'],
    [`github_pat_${'Ab1_'.repeat(20)}`, 'github_fine_grained_token'],
    [`sk-proj-${'Ab1'.repeat(10)}`, 'openai_api_key'],
    [`sk-ant-api03-${'Ab1'.repeat(10)}`, 'anthropic_api_key'],
    [`AKIA${'A1'.repeat(8)}`, 'aws_access_key_id'],
    [`AWS_SECRET_ACCESS_KEY=${'Ab1/'.repeat(10)}`, 'aws_secret_access_key'],
  ];
  for (const [value, patternId] of patternCases) {
    const ids = findSecretPatternIds(value);
    assert(ids.includes(patternId), `${patternId} pattern did not match`);
  }
  const anthropicFixture = patternCases.find(([, patternId]) => patternId === 'anthropic_api_key')?.[0];
  assert(anthropicFixture, 'Anthropic fixture is missing');
  assert(!findSecretPatternIds(anthropicFixture).includes('openai_api_key'), 'Anthropic token was also classified as an OpenAI key');

  const blockedPackage = createPackage('blocked', {
    'leak.txt': `token=${fakeNpmToken}\n`,
  });
  const blocked = runChecker(blockedPackage);
  const blockedOutput = `${blocked.stdout}\n${blocked.stderr}`;
  assert(blocked.status === 1, 'real token fixture was not blocked');
  assert(
    blockedOutput.includes('pattern=npm_token path=leak.txt line=1'),
    'finding did not include the safe pattern/path/line receipt',
  );
  assert(!blockedOutput.includes(fakeNpmToken), 'finding output leaked the matched secret');
  assert(!blockedOutput.includes('token='), 'finding output leaked line contents');

  const filenameSecret = `artifact-${fakeNpmToken}.txt`;
  const filenameBlockedPackage = createPackage('filename-blocked', {
    [filenameSecret]: 'clean contents\n',
  });
  const filenameBlocked = runChecker(filenameBlockedPackage);
  const filenameBlockedOutput = `${filenameBlocked.stdout}\n${filenameBlocked.stderr}`;
  assert(filenameBlocked.status === 1, 'secret-bearing packlist path was not blocked');
  assert(
    filenameBlockedOutput.includes('pattern=npm_token path=artifact-[redacted:npm_token].txt line=0'),
    'secret-bearing packlist path did not produce safe path finding metadata',
  );
  assert(!filenameBlockedOutput.includes(fakeNpmToken), 'secret-bearing packlist path leaked the original secret');

  const safePackage = createPackage('safe', {
    'placeholder.txt': `npm_${'x'.repeat(36)}\n`,
    'provider-placeholders.txt': `sk-${'x'.repeat(24)}\nghp_${'x'.repeat(36)}\nAWS_SECRET_ACCESS_KEY=${'x'.repeat(40)}\n`,
    'regex.txt': String.raw`/npm_[A-Za-z0-9]{36}/` + '\n',
  });
  const safe = runChecker(safePackage);
  assert(safe.status === 0, `placeholder or regex fixture failed: ${safe.stderr}`);

  const boundaries = join(root, 'boundaries');
  mkdirSync(boundaries, { recursive: true });
  writeFileSync(join(boundaries, 'binary.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(fakeNpmToken)]));
  writeFileSync(join(boundaries, 'oversized.txt'), Buffer.alloc(MAX_PACKAGE_TEXT_BYTES + 1, 65));
  writeFileSync(join(boundaries, 'target.txt'), fakeNpmToken);
  writeFileSync(join(boundaries, 'unreadable.txt'), fakeNpmToken);
  writeFileSync(join(boundaries, filenameSecret), 'clean contents\n');
  symlinkSync('target.txt', join(boundaries, 'linked.txt'));
  const boundaryResult = scanPackageFiles({
    root: boundaries,
    filePaths: ['binary.bin', 'oversized.txt', 'linked.txt'],
  });
  assert(boundaryResult.findings.length === 0, 'skipped boundary files were scanned');
  for (const reason of ['binary', 'oversized', 'symlink']) {
    assert(boundaryResult.skipped.some((entry) => entry.reason === reason), `${reason} boundary was not reported`);
  }

  const unreadableMarker = `do-not-print-${fakeNpmToken}`;
  const unreadableResult = scanPackageFiles({
    root: boundaries,
    filePaths: ['unreadable.txt'],
    readFile() {
      throw new Error(unreadableMarker);
    },
  });
  assert(unreadableResult.findings.length === 0, 'unreadable file produced a finding');
  assert(
    unreadableResult.skipped.some((entry) => entry.path === 'unreadable.txt' && entry.reason === 'unreadable'),
    'read failure did not produce the unreadable skip receipt',
  );
  assert(
    !formatScanResult(unreadableResult).join('\n').includes(unreadableMarker),
    'unreadable skip receipt leaked the read error content',
  );

  const secretPathSkipResult = scanPackageFiles({
    root: boundaries,
    filePaths: [filenameSecret],
    readFile() {
      throw new Error('read failed');
    },
  });
  const secretPathSkipOutput = formatScanResult(secretPathSkipResult).join('\n');
  assert(secretPathSkipResult.findings.some((entry) => entry.patternId === 'npm_token' && entry.line === 0), 'secret path did not fail closed');
  assert(secretPathSkipResult.skipped.some((entry) => entry.reason === 'unreadable'), 'secret skipped path did not retain skip metadata');
  assert(secretPathSkipOutput.includes('artifact-[redacted:npm_token].txt'), 'secret skipped path lost useful redacted context');
  assert(!secretPathSkipOutput.includes(fakeNpmToken), 'secret skipped path output leaked the original secret');

  console.log('package-secrets-smoke: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
