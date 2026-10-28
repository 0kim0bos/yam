import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runTestCheckCommand as command } from '../dist/lib/test-check.js';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yam-test-setup-')));
const bin = path.resolve('dist/bin/yam.js');
const files = ['testing/policy.json', 'testing/yam-adapter.mjs', 'testing/yam-observations.mjs', 'testing/setup.json'];
const results = [];
const hookStateFiles = [];
let sequence = 0;
function fixture(extra = {}) {
  const root = path.join(scratch, String(sequence++)); fs.mkdirSync(root);
  const git = (...args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (name, value) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), typeof value === 'string' ? value : JSON.stringify(value)); };
  write('feature.ts', 'export const feature = 1;'); write('README.md', 'Project documentation.');
  for (const [name, value] of Object.entries(extra)) write(name, value);
  git('init'); git('config', 'user.name', 'Setup fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-m', 'baseline');
  const base = git('rev-parse', 'HEAD');
  return { root, base, git, write, read: name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')), init: (...args) => command(['init', '--base', base, ...args], root) };
}
const test = (name, fn) => { fn(); results.push({ name, result: 'passed' }); };
const absent = f => files.forEach(file => assert(!fs.existsSync(path.join(f.root, file)), file));
try {
  test('missing configuration has an actionable separate setup state', () => {
    const f = fixture(), r = command(['status'], f.root); assert.equal(r.configuration_status, 'not_configured'); assert.equal(r.result, 'BLOCKED'); assert.equal(r.next_action, 'yam test-check init --json');
  });
  test('preview discovers commands and frameworks without executing them or writing files', () => {
    const secret = 'fixture-private-script-value';
    const f = fixture({ 'package.json': { scripts: { test: `vitest run --private=${secret}`, 'test:e2e': 'playwright test', 'test:node': 'node --test tests/unit.mjs', build: 'node build.mjs' } }, 'vitest.config.mjs': 'throw Error("must not run");' });
    const before = f.git('status', '--porcelain'), r = f.init('--dry-run');
    assert.equal(r.operation, 'PREVIEW'); assert.equal(r.approval_granted, false); assert.equal(r.gate_result, 'BLOCKED');
    assert.deepEqual(r.discovered_scripts.map(x => x.framework), ['vitest', 'playwright', 'node-test']);
    assert(!JSON.stringify(r).includes(secret)); assert(r.configuration_files.includes('vitest.config.mjs')); absent(f); assert.equal(f.git('status', '--porcelain'), before);
  });
  test('initializer creates a draft and usable bridge without manufacturing a PASS', () => {
    const f = fixture(), r = f.init(); assert.equal(r.operation, 'INITIALIZED'); assert.equal(r.baseline, f.base); assert.equal(r.configuration_status, 'draft');
    files.forEach(file => assert(fs.existsSync(path.join(f.root, file)))); assert.equal(f.read('testing/policy.json').setup_status, 'draft');
    assert.equal(command(['status'], f.root).configuration_status, 'draft'); assert.equal(command(['check'], f.root).result, 'BLOCKED');
    assert(!fs.existsSync(path.join(f.root, '.yam/testing/latest.json'))); assert(!fs.existsSync(path.join(f.root, 'testing/.yam-init.lock')));
  });
  test('default baseline is captured before setup writes', () => {
    const f = fixture(), r = command(['init'], f.root); assert.equal(r.baseline, f.base); assert.equal(f.read('testing/setup.json').baseline_source, 'current_head');
  });
  test('private receipts do not enter public policy or test discovery', () => {
    const f = fixture({ '.yam/scout/private.md': 'private research', '.env.example': 'PRIVATE_CONFIG=placeholder' });
    const r = f.init(); assert.equal(r.operation, 'INITIALIZED');
    for (const surface of f.read('testing/policy.json').surfaces) assert(surface.paths.every(p => !p.startsWith('.yam') && !p.startsWith('.env')));
    assert.equal(fs.readFileSync(path.join(f.root, '.yam/scout/private.md'), 'utf8'), 'private research');
  });
  test('draft run blocks before executing an edited observer and records the failure', () => {
    const f = fixture(); f.init(); f.write('testing/yam-observations.mjs', `import fs from 'node:fs';fs.writeFileSync('unexpected-observer-run','1');export function observe(){return [];}`);
    const r = command(['run', '--base', f.base], f.root); assert.equal(r.result, 'BLOCKED'); assert(r.errors.includes('project_setup_required')); assert(!fs.existsSync(path.join(f.root, 'unexpected-observer-run')));
    assert(fs.readFileSync(path.join(f.root, '.yam/testing/notes.md'), 'utf8').includes('BLOCKED'));
  });
  test('unconnected bridge emits empty failed observations, never fake counts', () => {
    const f = fixture(); f.init(); const r = spawnSync(process.execPath, ['testing/yam-adapter.mjs'], { cwd: f.root, encoding: 'utf8' });
    assert.equal(r.status, 1); assert.deepEqual(JSON.parse(r.stdout), { schema: 'yam.test-observation.v1', tests: [] });
  });
  test('marking a policy ready is insufficient without actual observations', () => {
    const f = fixture(); f.init(); const p = f.read('testing/policy.json'); p.setup_status = 'ready'; f.write('testing/policy.json', p);
    assert.equal(command(['run', '--base', f.base], f.root).result, 'BLOCKED');
  });
  test('a broad passing suite total cannot replace mapped scenario observations', () => {
    const f = fixture(); f.init(); const p = f.read('testing/policy.json'); p.setup_status = 'ready'; f.write('testing/policy.json', p);
    f.write('testing/yam-observations.mjs', `export function observe(){return [{id:'suite-total',target:'project',scenario:'success',evidence:'unit',status:'passed',tests:176,assertions:176,failed:0,skipped:0,mocked:true}];}`);
    assert.equal(command(['run', '--base', f.base], f.root).result, 'BLOCKED');
  });
  test('existing shared setup and user edits are preserved byte for byte', () => {
    const f = fixture(); f.init(); f.write('testing/yam-observations.mjs', 'user owned edits'); const before = files.map(file => fs.readFileSync(path.join(f.root, file), 'utf8'));
    assert.equal(f.init().operation, 'PRESERVED'); assert.deepEqual(files.map(file => fs.readFileSync(path.join(f.root, file), 'utf8')), before);
  });
  test('existing private policy is preserved without creating a shared policy', () => {
    const f = fixture({ '.yam/testing/policy.json': { schema: 'yam.test-policy.v1', surfaces: [] } }); assert.equal(f.init().operation, 'PRESERVED'); absent(f);
  });
  test('malformed existing policy blocks initialization without replacement', () => {
    const f = fixture({ 'testing/policy.json': '{ broken' }); assert.equal(f.init().ok, false); assert.equal(fs.readFileSync(path.join(f.root, 'testing/policy.json'), 'utf8'), '{ broken');
  });
  test('deleted tracked policy is not silently regenerated', () => {
    const f = fixture({ 'testing/policy.json': { schema: 'yam.test-policy.v1', surfaces: [] } }); fs.unlinkSync(path.join(f.root, 'testing/policy.json')); assert.equal(f.init().ok, false); assert(!fs.existsSync(path.join(f.root, 'testing/policy.json')));
  });
  test('existing observer collision blocks before any policy file is written', () => {
    const f = fixture({ 'testing/yam-observations.mjs': 'keep this' }); assert.equal(f.init().ok, false); assert(!fs.existsSync(path.join(f.root, 'testing/policy.json'))); assert.equal(fs.readFileSync(path.join(f.root, 'testing/yam-observations.mjs'), 'utf8'), 'keep this');
  });
  test('another initializer lock is preserved', () => {
    const f = fixture({ 'testing/.yam-init.lock': 'other owner' }); assert.equal(f.init().ok, false); assert.equal(fs.readFileSync(path.join(f.root, 'testing/.yam-init.lock'), 'utf8'), 'other owner'); absent(f);
  });
  test('partial write failure rolls back only files created in this attempt', () => {
    const f = fixture(), open = fs.openSync;
    try { fs.openSync = (file, ...args) => { if (String(file) === path.join(f.root, 'testing/yam-observations.mjs') && (args[0] & fs.constants.O_CREAT)) throw Object.assign(Error('injected write failure'), { code: 'EIO' }); return open(file, ...args); }; assert.equal(f.init().ok, false); }
    finally { fs.openSync = open; }
    absent(f); assert(!fs.existsSync(path.join(f.root, 'testing/.yam-init.lock')));
  });
  test('invalid baseline names cannot create setup or leak supplied metadata', () => {
    const f = fixture(), r = command(['init', '--base', 'main'], f.root); assert.equal(r.ok, false); assert(r.errors.includes('exact_base_required')); absent(f);
  });
  test('a blob is not accepted as a starting commit', () => {
    const f = fixture(), oid = f.git('rev-parse', 'HEAD:README.md'); assert.equal(command(['init', '--base', oid], f.root).ok, false); absent(f);
  });
  test('unrelated command options are rejected before mutation', () => {
    const f = fixture(); assert.equal(f.init('--stage', 'deploy').ok, false); assert.equal(f.init('--dry-run', '--dry-run').ok, false); absent(f);
  });
  test('DB UI API auth and release risks are visible in the draft without creating DB evidence', () => {
    const f = fixture({ 'migrations/001.sql': 'CREATE FUNCTION public.receiving() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;', 'src/api/orders.ts': '', 'src/auth/session.ts': '', 'src/page.tsx': '', 'package.json': {} });
    const r = f.init(); for (const risk of ['db', 'ui', 'api', 'auth', 'release']) assert(r.detected_risks.includes(risk));
    const p = f.read('testing/policy.json'), db = p.surfaces.find(x => x.id === 'project-db'); assert.equal(db.checks.length, 7); assert(db.checks.every(x => x.environment));
    assert(!fs.existsSync(path.join(f.root, '.yam/testing/environment.json')));
    p.setup_status = 'ready'; f.write('testing/policy.json', p); assert.equal(command(['run', '--base', f.base], f.root).result, 'BLOCKED');
  });
  test('CLI preview works without changing the source tree', () => {
    const f = fixture(), r = spawnSync(process.execPath, [bin, 'test-check', 'init', '--dry-run', '--json'], { cwd: f.root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).operation, 'PREVIEW'); absent(f);
  });
  test('prompt hook guides both missing and draft projects through setup without creating policy files', () => {
    const f = fixture();
    hookStateFiles.push(path.join(os.tmpdir(), `yam-study-note-${process.getuid?.() ?? 'user'}`, createHash('sha256').update(f.root + '\0' + f.root).digest('hex') + '.json'));
    const prompt = turn => {
      const r = spawnSync(process.execPath, [bin, 'hook', 'run', 'study-note'], { input: JSON.stringify({ cwd: f.root, session_id: f.root, turn_id: turn, hook_event_name: 'UserPromptSubmit', prompt: 'implement the requested feature' }), encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    };
    assert.match(prompt('missing'), /Test check setup:.*test-check init/); absent(f);
    f.init(); assert.match(prompt('draft'), /Test check setup:.*connect actual project observations/);
  });
  test('a previous failed receipt cannot hide missing project configuration from the prompt', () => {
    const f = fixture();
    assert.equal(command(['run', '--base', f.base], f.root).result, 'BLOCKED');
    assert(fs.existsSync(path.join(f.root, '.yam/testing/latest.json')));
    hookStateFiles.push(path.join(os.tmpdir(), `yam-study-note-${process.getuid?.() ?? 'user'}`, createHash('sha256').update(f.root + '\0' + f.root).digest('hex') + '.json'));
    const r = spawnSync(process.execPath, [bin, 'hook', 'run', 'study-note'], { input: JSON.stringify({ cwd: f.root, session_id: f.root, turn_id: 'failed-receipt', hook_event_name: 'UserPromptSubmit', prompt: 'implement the requested feature' }), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /Test check setup:.*test-check init/);
    absent(f);
  });
  test('missing Git cannot trigger a filesystem-only initializer', () => {
    const f = fixture(), old = process.env.PATH; try { process.env.PATH = path.join(f.root, 'absent-bin'); assert.equal(f.init().ok, false); } finally { process.env.PATH = old; } absent(f);
  });
  if (process.platform !== 'win32') {
    test('symlinked setup directory cannot redirect writes', () => {
      const f = fixture(), elsewhere = path.join(scratch, 'elsewhere'); fs.mkdirSync(elsewhere); fs.symlinkSync(elsewhere, path.join(f.root, 'testing')); assert.equal(f.init().ok, false); assert.deepEqual(fs.readdirSync(elsewhere), []);
    });
    test('symlinked package metadata cannot be read as project discovery', () => {
      const f = fixture(), elsewhere = path.join(scratch, 'external-package.json'); fs.writeFileSync(elsewhere, '{}'); fs.symlinkSync(elsewhere, path.join(f.root, 'package.json')); assert.equal(f.init().ok, false); absent(f);
    });
  }
  test('a connected observer must actually execute assertions before completion can pass', () => {
    const f = fixture(); f.init(); const p = f.read('testing/policy.json'); p.setup_status = 'ready'; f.write('testing/policy.json', p);
    const program = `const assert=require('node:assert/strict');const tests=[];for(const s of ['success','invalid','boundary']){let assertions=0;if(s==='success'){assert.equal(2+2,4);assertions++;}if(s==='invalid'){assert.throws(()=>JSON.parse('{'));assertions++;}if(s==='boundary'){assert.equal([].length,0);assertions++;}tests.push({id:'logic-'+s,target:'project',scenario:s,evidence:'unit',status:'passed',tests:1,assertions,failed:0,skipped:0,mocked:true});}console.log(JSON.stringify(tests));`;
    f.write('testing/yam-observations.mjs', `export function observe({run}){const r=run('$NODE',['-e',${JSON.stringify(program)}]);if(r.exit_code!==0)throw Error('test_failed');return JSON.parse(r.stdout);}`);
    assert.equal(command(['run', '--base', f.base], f.root).result, 'PASS'); assert.equal(command(['check'], f.root).result, 'PASS');
    f.write('feature.ts', 'changed later'); assert.equal(command(['check'], f.root).result, 'BLOCKED');
  });
  const report = { schema: 'yam.test-check-setup-smoke.v1', status: 'passed', assertions: results.length, cases: results, scope: 'real Git/filesystem/CLI and subprocess assertions; no production environment' };
  console.log(process.argv.includes('--json') ? JSON.stringify(report) : `test-check setup smoke: PASS (${results.length} cases)`);
} finally { for (const file of hookStateFiles) fs.rmSync(file, { force: true }); fs.rmSync(scratch, { recursive: true, force: true }); }
