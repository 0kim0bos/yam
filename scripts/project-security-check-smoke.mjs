import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = process.cwd();
const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'yam-project-gate-smoke-')));
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try {
  // Separate index and fixture repository; the user's index and refs are untouched.
  const index = path.join(tmp, 'fixture-index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  execFileSync('git', ['read-tree', 'HEAD'], { cwd: root, env });
  execFileSync('git', ['add', '-A'], { cwd: root, env });
  const tree = execFileSync('git', ['write-tree'], { cwd: root, env, encoding: 'utf8' }).trim();
  const fixture = path.join(tmp, 'repo'); await fs.mkdir(fixture);
  execFileSync('tar', ['-xf', '-', '-C', fixture], { input: execFileSync('git', ['archive', tree], { cwd: root, maxBuffer: 64 * 1024 * 1024 }) });
  await fs.symlink(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  await fs.cp(path.join(root, 'dist'), path.join(fixture, 'dist'), { recursive: true });
  git(fixture, 'init'); git(fixture, 'config', 'user.name', 'Security fixture'); git(fixture, 'config', 'user.email', 'fixture@example.invalid');
  git(fixture, 'add', '-A', '--', '.', ':!node_modules'); git(fixture, 'commit', '-m', 'fixture only');
  const source = git(fixture, 'rev-parse', 'HEAD');
  const pin = hash(await fs.readFile(path.join(fixture, 'security/policy.json')));
  const run = (args, expected) => {
    const result = spawnSync(process.execPath, ['scripts/project-security-check.mjs', ...args, '--policy-digest', pin], {
      cwd: fixture, encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024
    });
    assert.equal(result.error, undefined); assert.equal(result.status, expected, result.stdout || result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(run(['--stage', 'commit'], 0).result.result, 'PASS');
  await fs.writeFile(path.join(fixture, 'artifact.tgz'), 'fixture artifact');
  await fs.writeFile(path.join(fixture, 'deploy-config.json'), '{}');
  const deploy = ['--stage', 'deploy', '--source', source, '--artifact', 'artifact.tgz', '--configuration', 'deploy-config.json', '--environment', 'fixture'];
  const blocked = run(deploy, 1); assert(blocked.result.blocking.some(value => value.includes('SEC-05')), JSON.stringify(blocked));
  await fs.writeFile(path.join(fixture, 'environment.json'), JSON.stringify({ schema: 'yam.deployment-inspection.v1', result: 'passed', checked_at: new Date().toISOString(),
    source_revision: source, environment: 'fixture', checker: 'explicit test fixture inspection', artifact_digest: hash('fixture artifact'), configuration_digest: hash('{}'),
    checks: [{ target: 'fixture publication authorization', result: 'passed' }] }));
  assert.equal(run([...deploy, '--environment-evidence', 'environment.json'], 0).result.result, 'PASS');
  await fs.appendFile(path.join(fixture, 'src/lib/security-check.ts'), '\n// source divergence fixture\n');
  git(fixture, 'add', 'src/lib/security-check.ts');
  assert.equal(run(['--stage', 'commit'], 1).result.result, 'BLOCKED');
  const notes = await fs.readFile(path.join(fixture, '.yam/security/notes.md'), 'utf8');
  assert.equal((notes.match(/-- Security check --/g) || []).length, 4);
  console.log('project-security-check smoke: PASS (exact snapshot, deferred environment, deploy proof fixture, changed source blocked, all notes retained)');
} finally { await fs.rm(tmp, { recursive: true, force: true }); }
