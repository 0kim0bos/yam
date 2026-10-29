// Focused regression contract for the explicit Test check approval lifecycle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runTestCheckCommand as command, testCheckStop, planTestCheck } from '../dist/lib/test-check.js';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yam-test-approval-')));
const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const cases = [];
const hookStateFiles = [];
let index = 0;
function fixture({ changed = true, ready = true } = {}) {
  const root = path.join(scratch, String(index++)); fs.mkdirSync(root);
  const git = (...args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (name, value) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), typeof value === 'string' ? value : JSON.stringify(value)); };
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const checks = ['success', 'invalid', 'boundary'].map(scenario => ({
    id: `feature-${scenario}`, target: 'feature', scenario, explanation: `feature ${scenario}`,
    evidence: 'unit', command: ['$NODE', 'adapter.cjs']
  }));
  write('feature.ts', 'export const feature = 1;'); write('README.md', 'Initial documentation.'); write('src/runtime.ts', 'export const active = false;');
  write('adapter.cjs', `const fs=require('node:fs'); const p=JSON.parse(fs.readFileSync('testing/policy.json')); const tests=p.surfaces.flatMap(s=>s.checks).map(c=>({id:c.id,target:c.target,scenario:c.scenario,evidence:c.evidence,status:'passed',tests:1,assertions:1,failed:0,skipped:0,mocked:false,environment:c.environment?JSON.parse(fs.readFileSync(c.environment)):null})); const names=['DATABASE_URL','DIRECT_URL','SUPABASE_DB_URL','SUPABASE_SERVICE_ROLE_KEY','PGHOST','PGPASSWORD','POSTGRES_PASSWORD']; if(names.some(k=>process.env[k])) process.exit(17); fs.mkdirSync('.yam',{recursive:true}); fs.writeFileSync('.yam/adapter-ran','yes'); console.log(JSON.stringify({schema:'yam.test-observation.v1',tests}));`);
  const docsCheck = { id: 'feature-inspection', target: 'feature', scenario: 'inspection', explanation: 'inspect documentation', evidence: 'static', command: ['$NODE', 'adapter.cjs'] };
  write('testing/policy.json', { schema: 'yam.test-policy.v1', setup_status: ready ? 'ready' : 'draft', execution: {
    approval: 'required', trigger: 'changed_surface', commit: 'security_only', push: 'security_only', deploy: 'test_required'
  }, surfaces: [{ id: 'feature', paths: ['feature.ts', 'adapter.cjs', 'testing/**', 'README.md', 'src/**', 'docs/**'], risks: ['logic', 'docs'], targets: ['feature'], checks: [...checks, docsCheck] }] });
  if (changed) write('feature.ts', 'export const feature = 2;');
  git('init'); git('config', 'user.name', 'Approval smoke'); git('config', 'user.email', 'approval@example.invalid'); git('add', '.'); git('commit', '-m', 'baseline');
  const base = git('rev-parse', 'HEAD');
  if (changed) { write('feature.ts', 'export const feature = 3;'); }
  return { root, base, git, write, read };
}
const test = (name, fn) => { fn(); cases.push(name); };
try {
  const f = fixture();
  const source = () => f.git('rev-parse', 'HEAD');
  const req = (stage = 'complete') => command(['approval', 'request', '--base', f.base, '--stage', stage], f.root);
  const approve = (stage = 'complete') => command(['approval', 'approve', '--base', f.base, '--stage', stage], f.root);
  const run = (stage = 'complete', extra = []) => command(['run', '--base', f.base, '--stage', stage, ...extra], f.root);

  test('request includes a real plan and rejects empty, invalid-base, and unmapped change scopes', () => {
    const request = req(); assert.equal(request.result, 'approval_required');
    assert.equal(request.plan?.checks?.length, 4); assert.deepEqual(request.plan?.errors, []);
    const empty = fixture({ changed: false });
    assert.equal(command(['approval', 'request', '--base', empty.base], empty.root).result, 'BLOCKED');
    assert.equal(command(['approval', 'request', '--base', 'not-a-commit'], f.root).result, 'BLOCKED');
    assert.equal(command(['approval', 'request', '--base', '0'.repeat(40)], f.root).result, 'BLOCKED');
    const missing = fixture(); const missingPolicy = missing.read('testing/policy.json'); missingPolicy.surfaces[0].checks = missingPolicy.surfaces[0].checks.filter(c => c.scenario !== 'success'); missing.write('testing/policy.json', missingPolicy);
    const missingPlan = command(['approval', 'request', '--base', missing.base], missing.root); assert.equal(missingPlan.result, 'BLOCKED'); assert(missingPlan.errors.some(x => x.startsWith('missing_scenario:')));
    f.write('unmapped.ts', 'export const x = 1;');
    assert.equal(req().result, 'BLOCKED'); f.write('unmapped.ts', ''); fs.rmSync(path.join(f.root, 'unmapped.ts'));
  });

  test('approval and deferral are explicit transitions bound to exact plan identity', () => {
    req(); assert.equal(command(['approval', 'defer', '--base', f.base], f.root).result, 'deferred');
    assert.equal(run().result, 'BLOCKED');
    assert.equal(command(['approval', 'status'], f.root).approval.status, 'deferred');
    req(); assert.equal(approve().result, 'approved');
    assert.equal(command(['approval', 'status'], f.root).approval.status, 'approved');
  });

  test('approved completion cannot authorize CI or deployment; deferred execution never starts', () => {
    f.git('add', '.'); f.git('commit', '-m', 'candidate source');
    f.write('.yam/artifact.tgz', 'candidate artifact'); f.write('.yam/deploy.json', '{}');
    req(); assert.equal(command(['approval', 'defer', '--base', f.base], f.root).result, 'deferred');
    fs.rmSync(path.join(f.root, '.yam/adapter-ran'), { force: true });
    assert.equal(run().result, 'BLOCKED'); assert(!fs.existsSync(path.join(f.root, '.yam/adapter-ran')));
    req(); approve();
    const pin = hash(fs.readFileSync(path.join(f.root, 'testing/policy.json')));
    assert.equal(run('ci', ['--source', source(), '--policy-digest', pin]).result, 'BLOCKED');
    assert.equal(run('deploy', ['--source', source(), '--policy-digest', pin, '--artifact', '.yam/artifact.tgz', '--configuration', '.yam/deploy.json']).result, 'BLOCKED');
    assert(!fs.existsSync(path.join(f.root, '.yam/adapter-ran')));
    assert.equal(command(['run', '--base', f.base, '--stage', 'commit'], f.root).result, 'DEFERRED');
    assert.equal(command(['run', '--base', f.base, '--stage', 'push'], f.root).result, 'DEFERRED');
  });

  test('CI and deployment require their own approved plan and exact artifact', () => {
    const p = fixture(); p.git('add', 'feature.ts'); p.git('commit', '-m', 'candidate');
    const pin = hash(fs.readFileSync(path.join(p.root, 'testing/policy.json')));
    const opts = ['--base', p.base, '--source', p.git('rev-parse', 'HEAD'), '--policy-digest', pin];
    for (const action of ['request', 'approve']) assert.equal(command(['approval', action, ...opts.filter((v,i) => i < 2 || i >= 4), '--stage', 'ci'], p.root).ok, true);
    assert.equal(command(['run', ...opts, '--stage', 'ci'], p.root).result, 'PASS');
    assert.equal(command(['check', ...opts, '--stage', 'ci'], p.root).result, 'PASS');
    p.write('.yam/artifact.tgz', 'candidate artifact'); p.write('.yam/deploy.json', '{}');
    const deploy = [...opts, '--stage', 'deploy', '--artifact', '.yam/artifact.tgz', '--configuration', '.yam/deploy.json'];
    assert.equal(command(['run', ...deploy], p.root).result, 'BLOCKED');
    const approveOpts = deploy.filter((v,i) => i < 2 || i >= 4);
    for (const action of ['request', 'approve']) assert.equal(command(['approval', action, ...approveOpts], p.root).ok, true);
    p.write('.yam/artifact.tgz', 'changed after approval');
    fs.rmSync(path.join(p.root, '.yam/adapter-ran'), { force: true });
    assert.equal(command(['run', ...deploy], p.root).result, 'BLOCKED'); assert(!fs.existsSync(path.join(p.root, '.yam/adapter-ran')));
    p.write('.yam/artifact.tgz', 'candidate artifact');
    assert.equal(command(['run', ...deploy], p.root).result, 'PASS');
    assert.equal(command(['check', ...deploy], p.root).result, 'PASS');
    assert.equal(command(['check', ...opts, '--stage', 'ci'], p.root).result, 'BLOCKED');
    p.write('.yam/deploy.json', '{"changed":true}');
    assert.equal(command(['check', ...deploy], p.root).result, 'BLOCKED');
  });

  test('source and policy edits invalidate approval; environment changes invalidate DB approval', () => {
    req(); approve(); f.write('feature.ts', 'export const feature = 4;'); assert.equal(run().result, 'BLOCKED');
    f.write('feature.ts', 'export const feature = 3;');
    req(); approve(); const policy = f.read('testing/policy.json'); policy.surfaces[0].checks[0].explanation = 'changed policy'; f.write('testing/policy.json', policy);
    assert.equal(run().result, 'BLOCKED');
    const db = fixture(); db.write('migrations/001.sql', 'CREATE FUNCTION public.receiving() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;');
    const dbPolicy = db.read('testing/policy.json');
    dbPolicy.surfaces.push({ id: 'db', paths: ['migrations/**'], risks: ['db'], targets: ['function:public.receiving'], checks: ['success','denied','invalid','readback','rollback','migration_upgrade','migration_fresh'].map(scenario => ({
      id: `db-${scenario}`, target: 'function:public.receiving', scenario, explanation: `db ${scenario}`, evidence: 'integration', command: ['$NODE', 'adapter.cjs'], environment: '.yam/testing/environment.json'
    })) }); db.write('testing/policy.json', dbPolicy);
    const plan = planTestCheck(db.root, dbPolicy, db.base);
    const env = { schema: 'yam.test-environment.v1', engine: 'postgres', engine_version: '17', source_digest: plan.source_digest,
      configuration_digest: hash('config'), roles_digest: hash('roles'), fixtures_digest: hash('fixtures'),
      safety: { kind: 'disposable', production: false, external_effects: false },
      migrations: [{ file: 'migrations/001.sql', sha256: hash(fs.readFileSync(path.join(db.root, 'migrations/001.sql'))) }] };
    db.write('.yam/testing/environment.json', env);
    assert.equal(command(['approval', 'request', '--base', db.base], db.root).result, 'approval_required');
    assert.equal(command(['approval', 'approve', '--base', db.base], db.root).result, 'approved');
    db.write('.yam/testing/environment.json', { ...env, configuration_digest: hash('changed-config') });
    assert.equal(command(['run', '--base', db.base], db.root).result, 'BLOCKED');
    const unsafeDb = fixture(); unsafeDb.write('migrations/001.sql', 'CREATE FUNCTION public.receiving() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;');
    const p = unsafeDb.read('testing/policy.json'); p.surfaces[0].risks = ['logic'];
    p.surfaces.push({ id: 'db', paths: ['migrations/**'], risks: ['db'], targets: ['function:public.receiving'], checks: ['success','denied','invalid','readback','rollback','migration_upgrade','migration_fresh'].map(scenario => ({
      id: `db-${scenario}`, target: 'function:public.receiving', scenario, explanation: `db ${scenario}`, evidence: 'integration', command: ['$NODE', 'adapter.cjs'], environment: '.yam/testing/environment.json'
    })) }); unsafeDb.write('testing/policy.json', p);
    const unsafePlan = planTestCheck(unsafeDb.root, p, unsafeDb.base);
    unsafeDb.write('.yam/testing/environment.json', { ...env, source_digest: unsafePlan.source_digest, safety: undefined });
    assert.equal(command(['approval', 'request', '--base', unsafeDb.base], unsafeDb.root).result, 'BLOCKED');
  });

  test('Stop hook skips docs-only changes and requests approval for functional changes without executing adapter', () => {
    const h = fixture({ changed: false });
    const bin = path.resolve('dist/bin/yam.js');
    const invoke = input => { const p = spawnSync(process.execPath, [bin, 'hook', 'run', 'study-note'], { cwd: h.root, input: JSON.stringify(input), encoding: 'utf8' }); assert.equal(p.status, 0, p.stderr); return JSON.parse(p.stdout); };
    const session = `approval-${path.basename(h.root)}`;
    hookStateFiles.push(path.join(os.tmpdir(), `yam-study-note-${process.getuid?.() ?? 'user'}`, hash(`${h.root}\0${session}`).slice(7) + '.json'));
    const prompt = (turn, message) => invoke({ cwd: h.root, session_id: session, turn_id: turn, hook_event_name: 'UserPromptSubmit', prompt: message });
    const stop = turn => invoke({ cwd: h.root, session_id: session, turn_id: turn, hook_event_name: 'Stop', last_assistant_message: 'Implementation complete.' });
    prompt('docs', 'edit README only'); h.write('README.md', 'updated docs');
    const docs = stop('docs'); assert(!/Test check/i.test(docs.systemMessage || '')); assert(!fs.existsSync(path.join(h.root, '.yam/testing/approval.json')));
    h.git('add', 'README.md'); h.git('commit', '-m', 'docs change');
    prompt('runtime', 'edit runtime implementation'); h.write('docs/runtime.ts', 'export const active = true;');
    const runtime = stop('runtime'); assert.match(runtime.systemMessage || '', /approval_required/); assert.equal(h.read('.yam/testing/approval.json').status, 'approval_required');
    assert(!fs.existsSync(path.join(h.root, '.yam/adapter-ran')));
  });

  test('adapters do not inherit common database credentials', () => {
    req(); approve();
    const previous = {};
    for (const key of ['DATABASE_URL', 'DIRECT_URL', 'SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PGHOST', 'PGPASSWORD', 'POSTGRES_PASSWORD']) {
      previous[key] = process.env[key]; process.env[key] = 'postgres://production.invalid/secret';
    }
    try { assert.equal(run().result, 'PASS'); }
    finally { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; }
  });

  test('stale PASS asks for a fresh approval and remains a nonblocking handoff', () => {
    const p = fixture();
    command(['approval', 'request', '--base', p.base], p.root);
    command(['approval', 'approve', '--base', p.base], p.root);
    assert.equal(command(['run', '--base', p.base], p.root).result, 'PASS');
    p.write('feature.ts', 'changed after PASS');
    const stop = testCheckStop(p.root, true, 'Implementation complete.', true, ['feature.ts'], p.base);
    assert.equal(stop.continue, true); assert.match(stop.systemMessage, /approval_required/);
    assert.equal(command(['approval', 'status'], p.root).approval.status, 'approval_required');
  });

  test('expired and corrupt approvals block without launching adapters', () => {
    const p = fixture();
    command(['approval', 'request', '--base', p.base], p.root); command(['approval', 'approve', '--base', p.base], p.root);
    const approvalPath = path.join(p.root, '.yam/testing/approval.json');
    const approval = p.read('.yam/testing/approval.json'); approval.requested_at = new Date(Date.now() - 25 * 3600000).toISOString();
    const { digest: _digest, ...body } = approval; approval.digest = hash(stable(body)); p.write('.yam/testing/approval.json', approval);
    fs.rmSync(path.join(p.root, '.yam/adapter-ran'), { force: true });
    assert.equal(command(['run', '--base', p.base], p.root).result, 'BLOCKED');
    assert(!fs.existsSync(path.join(p.root, '.yam/adapter-ran')));
    command(['approval', 'request', '--base', p.base], p.root); command(['approval', 'approve', '--base', p.base], p.root);
    const corrupted = p.read('.yam/testing/approval.json'); corrupted.status = 'approved'; corrupted.digest = 'sha256:' + '0'.repeat(64); p.write('.yam/testing/approval.json', corrupted);
    assert.equal(command(['run', '--base', p.base], p.root).result, 'BLOCKED');
    assert(!fs.existsSync(path.join(p.root, '.yam/adapter-ran'))); assert(fs.existsSync(approvalPath));
  });

  test('an empty, nonexistent object ID and a missing required scenario cannot create approval', () => {
    const p = fixture({ changed: false });
    assert.equal(command(['approval', 'request', '--base', p.base], p.root).result, 'BLOCKED');
    assert.equal(command(['approval', 'request', '--base', 'f'.repeat(40)], p.root).result, 'BLOCKED');
    const changed = fixture(); const policy = changed.read('testing/policy.json');
    policy.surfaces[0].checks = policy.surfaces[0].checks.filter(check => check.scenario !== 'success'); changed.write('testing/policy.json', policy);
    const missing = command(['approval', 'request', '--base', changed.base], changed.root);
    assert.equal(missing.result, 'BLOCKED'); assert(missing.errors.some(error => error.startsWith('missing_scenario:')));
  });

  test('a note persistence failure blocks the run even after explicit approval', () => {
    const p = fixture(); command(['approval', 'request', '--base', p.base], p.root); command(['approval', 'approve', '--base', p.base], p.root);
    fs.mkdirSync(path.join(p.root, '.yam/testing'), { recursive: true }); fs.writeFileSync(path.join(p.root, '.yam/testing/lock'), 'other writer');
    const result = command(['run', '--base', p.base], p.root);
    assert.equal(result.result, 'BLOCKED'); assert(result.errors.includes('test_note_persistence_failed'));
  });
  test('missing DB environment and corrupt approval never cause a forced-run Stop loop', () => {
    const p = fixture();
    const policy = p.read('testing/policy.json');
    policy.surfaces.push({id:'db',paths:['migrations/**'],risks:['db'],targets:['function:public.receiving'],checks:['success','denied','invalid','readback','rollback','migration_upgrade','migration_fresh'].map(scenario=>({id:'db-'+scenario,target:'function:public.receiving',scenario,explanation:scenario,evidence:'integration',environment:'.yam/testing/environment.json',command:['$NODE','adapter.cjs']}))});
    p.write('testing/policy.json',policy);p.write('migrations/001.sql','CREATE FUNCTION public.receiving() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;');
    for (let i=0;i<3;i++) {
      const result=testCheckStop(p.root,true,'Verification incomplete.',true,['migrations/001.sql'],p.base);
      assert.equal(result.continue,true);assert.match(result.systemMessage,/BLOCKED/);assert(!result.decision);
      assert(!fs.existsSync(path.join(p.root,'.yam/adapter-ran')));
    }
    const corrupt=fixture();command(['approval','request','--base',corrupt.base],corrupt.root);corrupt.write('.yam/testing/approval.json','{invalid');
    assert.equal(testCheckStop(corrupt.root,true,'Verification incomplete.',true,['feature.ts'],corrupt.base).continue,true);
  });
  test('a terminal decision cannot display PASS when its receipt or note is missing', () => {
    const p=fixture();command(['approval','request','--base',p.base],p.root);command(['approval','approve','--base',p.base],p.root);
    assert.equal(command(['run','--base',p.base],p.root).result,'PASS');
    fs.unlinkSync(path.join(p.root,'.yam/testing/latest.json'));
    const result=testCheckStop(p.root,true,'Verification incomplete.',true,['feature.ts'],p.base);
    assert.equal(result.continue,true);assert.match(result.systemMessage,/^Test check: BLOCKED/);
    assert.equal(command(['check'],p.root).result,'BLOCKED');
  });
  test('late decision persistence failure never returns a passing run', () => {
    const p = fixture();
    const adapter = fs.readFileSync(path.join(p.root, 'adapter.cjs'), 'utf8');
    p.write('adapter.cjs', adapter + "fs.writeFileSync('.yam/testing/lock','late-writer');");
    assert.equal(command(['approval', 'request', '--base', p.base], p.root).ok, true);
    assert.equal(command(['approval', 'approve', '--base', p.base], p.root).ok, true);
    const result = command(['run', '--base', p.base], p.root);
    assert.equal(result.ok, false); assert.equal(result.result, 'BLOCKED');
    assert.equal(fs.readFileSync(path.join(p.root, '.yam/testing/lock'), 'utf8'), 'late-writer');
    assert.equal(command(['check'], p.root).result, 'BLOCKED');
  });
  const report = { schema: 'yam.test-check-approval-smoke.v1', status: 'passed', assertions: cases.length, cases, scope: 'real temporary Git/process/filesystem fixtures; DB environment is only checked for credential non-inheritance' };
  console.log(process.argv.includes('--json') ? JSON.stringify(report) : `test-check approval smoke: PASS (${cases.length} cases)`);
} finally { for (const file of hookStateFiles) fs.rmSync(file, { force: true }); fs.rmSync(scratch, { recursive: true, force: true }); }
