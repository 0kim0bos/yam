import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runTestCheck, checkTestCheck } from '../dist/lib/test-check.js';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yam-skill-alias-')));
const tools = ['.agent', '.claude', '.codex', '.cursor', '.gemini', '.opencode', '.windsurf'];
const alias = '.agent/skills/example';
const target = '../../.agents/skills/example';
const results = [];
const write = (file, value) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), value); };
const git = (...args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const test = (name, fn) => { fn(); results.push({ name, result: 'passed' }); };
const link = (name, destination) => { fs.rmSync(path.join(root, name), { force: true }); fs.symlinkSync(destination, path.join(root, name)); };
const marker = path.join(root, '.yam/adapter-started');
const clear = () => fs.rmSync(marker, { force: true });
try {
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  write('.agents/skills/example/SKILL.md', 'fixture skill');
  for (const dir of tools) { fs.mkdirSync(path.join(root, dir, 'skills'), { recursive: true }); link(dir + '/skills/example', target); }
  write('feature.ts', 'before');
  write('adapter.mjs', `import fs from 'node:fs';const p=JSON.parse(fs.readFileSync('testing/policy.json'));fs.mkdirSync('.yam',{recursive:true});fs.writeFileSync('.yam/adapter-started','started');console.log(JSON.stringify({schema:'yam.test-observation.v1',tests:p.surfaces.flatMap(s=>s.checks.map(c=>({id:c.id,target:c.target,scenario:c.scenario,evidence:'unit',status:'passed',tests:1,assertions:1,failed:0,skipped:0,mocked:false})))}));`);
  const checks = ['success', 'invalid', 'boundary'].map(s => ({ id: s, target: 'feature', scenario: s, explanation: 'Alias fixture ' + s, evidence: 'unit', command: ['$NODE', 'adapter.mjs'] }));
  write('testing/policy.json', JSON.stringify({ schema: 'yam.test-policy.v1', surfaces: [{ id: 'feature', paths: ['feature.ts', 'adapter.mjs', 'testing/**', ...tools.map(d => d + '/skills/example')], risks: ['logic'], targets: ['feature'], checks }] }));
  git('add', '.'); git('commit', '-qm', 'alias baseline'); const base = git('rev-parse', 'HEAD');
  write('feature.ts', 'after');
  const run = () => runTestCheck(root, { base });
  const blocked = () => { clear(); const r = run(); assert.equal(r.result, 'BLOCKED'); assert(!fs.existsSync(marker), 'unsafe source launched an adapter'); };
  test('seven tool aliases work across current and baseline snapshots', () => assert.equal(run().result, 'PASS'));
  test('exact staged tree accepts the same alias contract', () => { git('add', 'feature.ts'); assert.equal(checkTestCheck(root, { stage: 'commit' }).result, 'PASS'); });
  test('alias removal invalidates an old PASS including codex aliases', () => { fs.unlinkSync(path.join(root, '.codex/skills/example')); assert.equal(checkTestCheck(root).result, 'BLOCKED'); link('.codex/skills/example', target); });
  for (const [name, value] of [['absolute', path.join(root, '.agents/skills/example')], ['external', '../../../outside'], ['wrong skill', '../../.agents/skills/other'], ['cycle', 'example'], ['noncanonical', '../../.agents/skills/./example']]) {
    test(name + ' target is rejected', () => { link(alias, value); blocked(); link(alias, target); });
  }
  test('missing target rejected', () => { fs.renameSync(path.join(root, '.agents/skills/example'), path.join(root, '.agents/skills/preserved')); blocked(); fs.renameSync(path.join(root, '.agents/skills/preserved'), path.join(root, '.agents/skills/example')); });
  test('target SKILL.md must be a regular file', () => { fs.renameSync(path.join(root, '.agents/skills/example/SKILL.md'), path.join(root, 'preserved.md')); fs.symlinkSync(path.join(root, 'preserved.md'), path.join(root, '.agents/skills/example/SKILL.md')); blocked(); fs.unlinkSync(path.join(root, '.agents/skills/example/SKILL.md')); fs.renameSync(path.join(root, 'preserved.md'), path.join(root, '.agents/skills/example/SKILL.md')); });
  test('target directories cannot redirect through another link', () => { fs.renameSync(path.join(root,'.agents/skills/example'),path.join(root,'.agents/skills/preserved')); fs.symlinkSync('preserved',path.join(root,'.agents/skills/example')); blocked(); fs.unlinkSync(path.join(root,'.agents/skills/example')); fs.renameSync(path.join(root,'.agents/skills/preserved'),path.join(root,'.agents/skills/example')); });
  test('alias parent links rejected without following them', () => { fs.renameSync(path.join(root, '.agent/skills'), path.join(root, '.agent/preserved')); fs.symlinkSync('preserved', path.join(root, '.agent/skills')); blocked(); fs.unlinkSync(path.join(root, '.agent/skills')); fs.renameSync(path.join(root, '.agent/preserved'), path.join(root, '.agent/skills')); });
  test('ordinary source links remain rejected', () => { fs.symlinkSync('feature.ts', path.join(root, 'source-link.ts')); blocked(); fs.unlinkSync(path.join(root, 'source-link.ts')); });
  test('plain file cannot impersonate an alias', () => { fs.unlinkSync(path.join(root, alias)); write(alias, target); blocked(); link(alias, target); });
  test('alias cannot be used as the policy file', () => { clear(); assert.equal(runTestCheck(root,{base,policy:alias}).result,'BLOCKED'); assert(!fs.existsSync(marker)); });
  test('new alias requires change-to-scenario mapping', () => { write('.agents/skills/extra/SKILL.md','fixture'); link('.agent/skills/extra','../../.agents/skills/extra'); blocked(); fs.unlinkSync(path.join(root,'.agent/skills/extra')); fs.rmSync(path.join(root,'.agents/skills/extra'),{recursive:true}); });
  test('bad index alias rejected even while worktree is valid', () => {
    assert.equal(run().result, 'PASS'); link(alias, '../../../outside'); git('add', alias); link(alias, target);
    assert.equal(checkTestCheck(root, { stage: 'commit' }).result, 'BLOCKED'); git('add', alias);
  });
  test('bad baseline alias rejected while worktree is valid', () => {
    link(alias, '../../../outside'); git('add', alias); git('commit', '-qm', 'bad historical alias'); const badBase = git('rev-parse', 'HEAD'); link(alias, target); clear();
    assert.equal(runTestCheck(root, { base: badBase }).result, 'BLOCKED'); assert(!fs.existsSync(marker));
    git('reset', '--soft', base); git('add', alias, 'feature.ts');
  });
  test('exact outgoing commit and CI retain alias identity', () => {
    assert.equal(run().result, 'PASS'); git('add', 'feature.ts', alias); git('commit', '-qm', 'verified source'); const source = git('rev-parse', 'HEAD');
    assert.equal(checkTestCheck(root, { stage: 'push', source }).result, 'PASS');
    const pin='sha256:'+createHash('sha256').update(fs.readFileSync(path.join(root,'testing/policy.json'))).digest('hex');
    assert.equal(checkTestCheck(root, { stage: 'ci', source, pin }).result, 'PASS');
  });
  console.log(JSON.stringify({ schema: 'yam.skill-alias-smoke.v1', status: 'passed', cases: results.length, results, scope: 'real temporary Git trees, index, filesystem links and subprocess observations; no production application tests' }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
