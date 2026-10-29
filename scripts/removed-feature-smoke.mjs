// Verify removed commands cannot reactivate through old project files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd(), cli = path.join(root, 'dist/bin/yam.js');
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yam-removed-feature-')));
const states = [];
const run = (args, cwd = scratch, input) => spawnSync(process.execPath, [cli, ...args], { cwd, input, encoding: 'utf8', timeout: 15000 });
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
try {
  const help = run(['help']); assert.equal(help.status, 0); assert(!help.stdout.includes('test-check'));
  for (const name of ['test-check.js', 'test-check.d.ts', 'test-check-setup.js', 'test-check-setup.d.ts']) assert(!fs.existsSync(path.join(root, 'dist/lib', name)));
  const sessions = ['unconfigured', 'shared-legacy', 'private-legacy'];
  for (const session of sessions) {
    const cwd = path.join(scratch, session); fs.mkdirSync(cwd);
    git(cwd, 'init'); git(cwd, 'config', 'user.name', 'Removed feature fixture'); git(cwd, 'config', 'user.email', 'fixture@example.invalid');
    fs.writeFileSync(path.join(cwd, 'app.ts'), 'baseline'); git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'baseline');
    let policy;
    if (session !== 'unconfigured') {
      policy = path.join(cwd, session === 'shared-legacy' ? 'testing/policy.json' : '.yam/testing/policy.json');
      fs.mkdirSync(path.dirname(policy), { recursive: true }); fs.writeFileSync(policy, '{old invalid policy');
    }
    const input = { cwd, session_id: session, turn_id: 'removal', hook_event_name: 'UserPromptSubmit', prompt: 'Change feature' };
    states.push(path.join(os.tmpdir(), `yam-study-note-${process.getuid?.() ?? 'user'}`, createHash('sha256').update(cwd + '\0' + session).digest('hex') + '.json'));
    const prompt = run(['hook', 'run', 'study-note'], cwd, JSON.stringify(input)); assert.equal(prompt.status, 0);
    const context = JSON.parse(prompt.stdout).hookSpecificOutput.additionalContext;
    assert(!/test[ -]?check|approval request|testing\/policy/i.test(context));
    fs.writeFileSync(path.join(cwd, 'app.ts'), 'changed');
    const stop = run(['hook', 'run', 'study-note'], cwd, JSON.stringify({ ...input, hook_event_name: 'Stop', last_assistant_message: 'Study Note:\nChanged feature; inspected code.\n\nNext step:\nReview remaining behavior.' }));
    assert.equal(stop.status, 0); const result = JSON.parse(stop.stdout);
    assert(!/test[ -]?check|approval request/i.test(JSON.stringify(result))); assert.notEqual(result.decision, 'block');
    for (const action of ['init', 'plan', 'approval', 'run', 'check', 'status']) {
      const rejected = run(['test-check', action, '--json'], cwd);
      assert.equal(rejected.status, 1); assert.match(rejected.stderr, /unknown command: test-check/);
    }
    assert(!fs.existsSync(path.join(cwd, '.yam/testing/latest.json')));
    assert(!fs.existsSync(path.join(cwd, '.yam/testing/approval.json')));
    if (policy) assert.equal(fs.readFileSync(policy, 'utf8'), '{old invalid policy');
  }
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/security-check.yml'), 'utf8');
  assert(!/test-check|TEST_PIN|YAM_TEST_POLICY/.test(workflow));
  assert.match(workflow, /Run exact target security checks/); assert.match(workflow, /POLICY_PIN/);
  assert.match(run(['security', '--help']).stdout, /yam security/);
  console.log('removed-feature smoke: PASS (CLI absent, no hook requests, old policies preserved, independent Security check retained)');
} finally {
  for (const file of states) fs.rmSync(file, { force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
}
