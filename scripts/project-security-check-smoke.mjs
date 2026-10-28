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
  // Copy candidate regular files into a separate repository; never write the user's index or object store.
  const fixture = path.join(tmp, 'repo'); await fs.mkdir(fixture);
  const files=[...new Set(execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))];
  for(const file of files) {
    if(/^(?:\.git|\.yam|node_modules|dist)(?:\/|$)/.test(file))continue;
    const from=path.join(root,file),to=path.join(fixture,file);const info=await fs.lstat(from).catch(()=>null);
    if(!info)continue;if(!info.isFile() || info.isSymbolicLink())throw Error('unsupported fixture source');
    await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(from,to);await fs.chmod(to,info.mode & 0o777);
  }
  await fs.symlink(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  await fs.cp(path.join(root, 'dist'), path.join(fixture, 'dist'), { recursive: true });
  git(fixture, 'init'); git(fixture, 'config', 'user.name', 'Security fixture'); git(fixture, 'config', 'user.email', 'fixture@example.invalid');
  git(fixture, 'add', '-A', '--', '.', ':!node_modules'); git(fixture, 'commit', '-m', 'fixture only');
  const testBase = git(fixture, 'rev-parse', 'HEAD');
  await fs.appendFile(path.join(fixture, 'CHANGELOG.md'), '\nFixture candidate change.\n');
  git(fixture, 'add', 'CHANGELOG.md'); git(fixture, 'commit', '-m', 'fixture candidate');
  const source = git(fixture, 'rev-parse', 'HEAD');
  const testPin = hash(await fs.readFile(path.join(fixture, 'testing/policy.json')));
  const prepareTests = stage => {
    const args = [path.join(fixture, 'dist/bin/yam.js'), 'test-check', 'run', '--base', testBase];
    if(stage === 'deploy') args.push('--stage','deploy','--source',source,'--artifact','artifact.tgz','--configuration','.yam/deploy-config.json','--policy-digest',testPin);
    const result = spawnSync(process.execPath,args,{cwd:fixture,encoding:'utf8',timeout:300000,maxBuffer:8*1024*1024});
    assert.equal(result.status,0,result.stdout || result.stderr);
  };
  prepareTests('complete');
  const pin = hash(await fs.readFile(path.join(fixture, 'security/policy.json')));
  const run = (args, expected) => {
    const result = spawnSync(process.execPath, ['scripts/project-security-check.mjs', ...args, '--policy-digest', pin, '--test-policy-digest', testPin], {
      cwd: fixture, encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024
    });
    assert.equal(result.error, undefined); assert.equal(result.status, expected, result.stdout || result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(run(['--stage', 'commit'], 0).result.result, 'PASS');
  const packed = spawnSync('npm',['pack','--ignore-scripts','--json','--pack-destination',tmp],{cwd:fixture,encoding:'utf8',timeout:60000,env:{...process.env,npm_config_cache:path.join(tmp,'npm-cache')}});
  assert.equal(packed.status,0);
  const packedInfo=JSON.parse(packed.stdout)[0];
  await fs.copyFile(path.join(tmp,packedInfo.filename),path.join(fixture,'artifact.tgz'));
  await fs.writeFile(path.join(fixture, '.yam/deploy-config.json'), '{}');
  prepareTests('deploy');
  const deploy = ['--stage', 'deploy', '--source', source, '--artifact', 'artifact.tgz', '--configuration', '.yam/deploy-config.json', '--environment', 'fixture'];
  const blocked = run(deploy, 1); assert(blocked.result.blocking.some(value => value.includes('SEC-05')), JSON.stringify(blocked));
  await fs.writeFile(path.join(fixture, '.yam/environment.json'), JSON.stringify({ schema: 'yam.deployment-inspection.v1', result: 'passed', checked_at: new Date().toISOString(),
    source_revision: source, environment: 'fixture', checker: 'explicit test fixture inspection', artifact_digest: hash(await fs.readFile(path.join(fixture,'artifact.tgz'))), configuration_digest: hash('{}'),
    checks: [{ target: 'fixture publication authorization', result: 'passed' }] }));
  assert.equal(run([...deploy, '--environment-evidence', '.yam/environment.json'], 0).result.result, 'PASS');
  await fs.appendFile(path.join(fixture, 'src/lib/security-check.ts'), '\n// source divergence fixture\n');
  git(fixture, 'add', 'src/lib/security-check.ts');
  assert.equal(run(['--stage', 'commit'], 1).result.result, 'BLOCKED');
  const notes = await fs.readFile(path.join(fixture, '.yam/security/notes.md'), 'utf8');
  assert.equal((notes.match(/-- Security check --/g) || []).length, 4);
  console.log('project-security-check smoke: PASS (exact snapshot, deferred environment, deploy proof fixture, changed source blocked, all notes retained)');
} finally { await fs.rm(tmp, { recursive: true, force: true }); }
