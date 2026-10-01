#!/usr/bin/env node
// Project-owned evidence runner. A validated report is not a vulnerability scan.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSecurityStarter } from '../dist/lib/security-check.js';
import { collectSecurityBinding, runSecurityCommand } from '../dist/lib/security-integration.js';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function main() {
const options = new Map();
const allowed = ['--stage', '--policy-digest', '--remote', '--destination', '--source', '--base', '--artifact', '--artifact-digest', '--configuration', '--configuration-digest', '--environment', '--environment-evidence'];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--json') continue;
  const key = process.argv[i];
  if (!allowed.includes(key) || options.has(key) || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error('invalid project security option');
  options.set(key, process.argv[++i]);
}
const stage = options.get('--stage');
const stdin = stage === 'push' ? await new Promise((resolve, reject) => {
  let bytes = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { bytes += chunk; if (bytes.length > 128 * 1024) reject(new Error('push input too large')); });
  process.stdin.on('end', () => resolve(bytes));
  process.stdin.on('error', reject);
}) : '';

async function readRegular(file) {
  const absolute = path.resolve(file);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('unsafe security path');
  }
  const handle = await fs.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error('invalid security evidence file');
    return await handle.readFile();
  } finally { await handle.close(); }
}
async function privateWrite(relative, value) {
  const dir = path.join(root, '.yam/security');
  for (const current of [path.join(root, '.yam'), dir]) {
    await fs.mkdir(current, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('unsafe security directory');
  }
  const destination = path.join(root, relative);
  const existing = await fs.lstat(destination).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)) throw new Error('unsafe security file');
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  try { await fs.rename(temporary, destination); }
  finally { await fs.rm(temporary, { force: true }); }
}

const policyBytes = await readRegular(path.join(root, 'security/policy.json'));
const pin = options.get('--policy-digest');
if (!pin || hash(policyBytes) !== pin) throw new Error('trusted policy digest required');
const policy = JSON.parse(policyBytes);
if (stage === 'deploy') {
  for (const [fileKey, digestKey] of [['--artifact', '--artifact-digest'], ['--configuration', '--configuration-digest']]) {
    if (!options.has(fileKey)) throw new Error('deployment files required');
    const measured = hash(await readRegular(path.resolve(root, options.get(fileKey))));
    if (options.has(digestKey) && options.get(digestKey) !== measured) throw new Error('deployment digest mismatch');
    options.set(digestKey, measured);
  }
}
const binding = collectSecurityBinding(root, stage, options, stdin);
const report = createSecurityStarter({ stage: stage === 'ci' ? 'push' : stage, policy, binding,
  environment: stage === 'deploy' ? options.get('--environment') : 'local-cli',
  scope: ['CLI filesystem and installation boundaries', 'reviewed source inventory', 'exact Git target test snapshots', 'package secrets and CI action pins'],
  checker: 'yam-project-security-v1' });
report.policy_digest = pin;
const results = [];
const reviewBytes = await readRegular(path.join(root, 'security/project-review.json'));
const review = JSON.parse(reviewBytes);
const trees = stage === 'commit' ? [binding.staged_tree] : stage === 'push'
  ? [...new Set(binding.push_refs.map(ref => git('rev-parse', `${ref.local_oid}^{tree}`)))]
  : [git('rev-parse', `${binding.source_revision}^{tree}`)];

const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'yam-project-security-')));
try {
  for (const [index, tree] of trees.entries()) {
    const snapshot = path.join(scratch, String(index));
    await fs.mkdir(snapshot);
    const archive = execFileSync('git', ['-C', root, 'archive', '--format=tar', tree], { maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-xf', '-', '-C', snapshot], { input: archive, stdio: ['pipe', 'pipe', 'pipe'] });
    // A clean snapshot prevents unstaged code from standing in for checked revisions.
    const inventory = git('ls-tree', '-r', '--name-only', tree).split('\n').filter(name => /^(src\/|scripts\/|\.github\/workflows\/)/.test(name) || ['package.json', 'package-lock.json', 'tsconfig.json'].includes(name)).sort();
    let reviewPassed = review.schema === 'yam.project-security-review.v1' && JSON.stringify(inventory) === JSON.stringify(review.source_inventory);
    for (const [file, expected] of Object.entries(review.files || {})) {
      try { if (hash(await readRegular(path.join(snapshot, file))) !== expected) reviewPassed = false; }
      catch { reviewPassed = false; }
    }
    results.push({ tree, check: 'reviewed-source-digests', passed: reviewPassed });
    // Reuse local tools only with the exact reviewed dependency lock.
    const lockMatches = hash(await readRegular(path.join(snapshot, 'package-lock.json'))) === hash(await readRegular(path.join(root, 'package-lock.json')));
    results.push({ tree, check: 'dependency-lock-matches-installed-toolchain', passed: lockMatches });
    if (!reviewPassed || !lockMatches) continue;
    await fs.symlink(path.join(root, 'node_modules'), path.join(snapshot, 'node_modules'), 'dir');
    const commands = [
      ['npm', ['run', 'typecheck']], ['npm', ['run', 'build']],
      [process.execPath, ['scripts/security-check-smoke.mjs']],
      [process.execPath, ['scripts/security-integration-smoke.mjs']],
      [process.execPath, ['scripts/install-transaction-smoke.mjs']],
      [process.execPath, ['scripts/external-updates-smoke.mjs']],
      [process.execPath, ['scripts/check-package-secrets.mjs']],
      [process.execPath, ['scripts/check-workflow-pins.mjs']],
      ['npm', ['audit', '--audit-level=high', '--ignore-scripts', '--json']]
    ];
    for (const [executable, args] of commands) {
      const execution = spawnSync(executable, args, { cwd: snapshot, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024,
        env: { PATH: process.env.PATH, HOME: scratch, TMPDIR: scratch, CI: 'true' } });
      // Raw subprocess output is never stored: fixture payloads may resemble credentials.
      results.push({ tree, check: args.join(' '), passed: execution.status === 0 && !execution.error, exit_code: execution.status,
        output_digest: hash(`${execution.stdout || ''}${execution.stderr || ''}`) });
      if (execution.status !== 0 || execution.error) break;
    }
  }
} finally { await fs.rm(scratch, { recursive: true, force: true }); }

let environmentProof;
if (stage === 'deploy' && options.has('--environment-evidence')) {
  const ref = options.get('--environment-evidence');
  if (path.isAbsolute(ref) || !path.resolve(root, ref).startsWith(root + path.sep)) throw new Error('environment evidence must be repository-local');
  const bytes = await readRegular(path.join(root, ref));
  const doc = JSON.parse(bytes);
  const recent = typeof doc.checked_at === 'string' && Date.now() - Date.parse(doc.checked_at) >= 0 && Date.now() - Date.parse(doc.checked_at) < 30 * 60 * 1000;
  if (doc.schema === 'yam.deployment-inspection.v1' && doc.result === 'passed' && doc.source_revision === binding.source_revision && doc.artifact_digest === binding.artifact_digest && doc.configuration_digest === binding.configuration_digest && doc.environment === binding.environment && recent && typeof doc.checker === 'string' && doc.checker.trim() && Array.isArray(doc.checks) && doc.checks.length && doc.checks.every(check => check.result === 'passed' && typeof check.target === 'string' && check.target.trim())) {
    environmentProof = { reference: ref, sha256: hash(bytes), checker: doc.checker, checked_at: doc.checked_at, result: 'passed' };
  }
}
const proofRef = `.yam/security/project-evidence-${report.run_id}.json`;
const successful = results.length >= trees.length * 11 && results.every(result => result.passed);
const proof = { schema: 'yam.project-security-evidence.v1', checked_at: report.time, binding, policy_digest: pin,
  review_digest: hash(reviewBytes), result: successful ? 'passed' : 'blocked', checks: results,
  limitations: ['source review is identified engineering judgment', 'not a comprehensive vulnerability scan', 'no real deployment is executed', 'installed tooling reuses the matching local dependency lock'] };
await privateWrite(proofRef, proof);
const proofBytes = await readRegular(path.join(root, proofRef));
const evidence = [{ reference: proofRef, sha256: hash(proofBytes), checker: report.checker, checked_at: report.time, result: successful ? 'passed' : 'blocked' },
  { reference: 'security/project-review.json', sha256: hash(reviewBytes), checker: review.reviewer, checked_at: review.reviewed_at, result: successful ? 'passed' : 'blocked' }];
for (const area of report.areas) {
  if (!successful) { area.reason = 'Reviewed source digests or exact target checks failed; inspect sanitized project evidence before retry.'; continue; }
  if (area.id === 'SEC-05') {
    if (environmentProof) { area.status = 'passed'; area.evidence = [environmentProof]; }
    else area.reason = 'Actual publication environment inspection is required at deploy; build and configuration hashes do not prove remote state.';
  } else if (['SEC-04', 'SEC-06'].includes(area.id)) {
    area.status = 'not_applicable'; area.reason = review.areas[area.id]; area.evidence = evidence;
  } else { area.status = 'passed'; area.evidence = evidence; }
}
await privateWrite('.yam/security/check.json', report);
const args = ['check', '--stage', stage, '--policy', 'security/policy.json', '--policy-digest', pin, '--evidence', '.yam/security/check.json', '--json'];
for (const [key, value] of options) if (!['--stage', '--policy-digest', '--environment-evidence'].includes(key)) args.push(key, value);
const outcome = await runSecurityCommand(args, { cwd: root, stdin });
console.log(JSON.stringify(outcome));
process.exitCode = outcome.ok ? 0 : 1;
}
try { await main(); }
catch (error) {
  // Malformed options and unavailable evidence also leave a sanitized failed note.
  const failed = await runSecurityCommand(['check', '--invalid-project-security-option', 'rejected'], { cwd: root });
  console.log(JSON.stringify({ ...failed, project_check_error: 'project_evidence_generation_failed', error_kind: /^[A-Z_]+$/.test(error?.code || '') ? error.code : 'REJECTED' }));
  process.exitCode = 1;
}
