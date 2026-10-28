import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { initializeTestCheck, inspectTestCheckSetup } from './test-check-setup.js';

const digest = (x: string | Buffer) => `sha256:${createHash('sha256').update(x).digest('hex')}`;
const stable = (x: any): string => Array.isArray(x) ? `[${x.map(stable).join(',')}]` : x && typeof x === 'object'
  ? `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${stable(x[k])}`).join(',')}}` : JSON.stringify(x);
const seal = (x: any) => digest(stable(x));
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/;
const OID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const MAX = 4 * 1024 * 1024;
const STAGES = ['complete', 'commit', 'push', 'ci', 'deploy'];
export const TEST_REQUIREMENTS = {
  docs: ['inspection'], logic: ['success', 'invalid', 'boundary'], api: ['success', 'invalid', 'contract'],
  db: ['success', 'denied', 'invalid', 'readback', 'rollback', 'migration_upgrade', 'migration_fresh'],
  auth: ['success', 'denied', 'cross_scope', 'revoked'], ui: ['success', 'error'],
  release: ['artifact', 'integrity']
} as const;
type Risk = keyof typeof TEST_REQUIREMENTS;
type Check = { id: string; target: string; scenario: string; explanation: string; evidence: 'static' | 'unit' | 'integration' | 'e2e'; command: string[]; environment?: string };
type Surface = { id: string; paths: string[]; risks: Risk[]; targets: string[]; checks: Check[] };
type Policy = { schema: 'yam.test-policy.v1'; setup_status?: 'draft' | 'ready'; surfaces: Surface[] };
type Measurement = { check_id: string; command_digest: string; exit_code: number; output_digest: string; observation: any; errors: string[] };
const POLICY = 'testing/policy.json';
function policyPath(root: string, supplied?: string) { return supplied || (fs.existsSync(path.join(root, POLICY)) || git(root, ['ls-files', '--', POLICY]).trim() ? POLICY : '.yam/testing/policy.json'); }
const unsafe = (v: unknown) => /[\x00-\x1f\x7f<>]|gh[pousr]_[A-Za-z0-9]{20}|AKIA[A-Z0-9]{16}|-----BEGIN.*PRIVATE KEY|(?:token|password|api[_-]?key|secret)\s*[:=]\s*\S{8,}/i.test(String(v));
function fail(code: string): never { throw new Error(code); }
function exact(x: any, keys: string[]) {
  if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some(k => !keys.includes(k))) fail('invalid_fields');
}
function rel(x: string) {
  if (typeof x !== 'string' || !x || path.isAbsolute(x) || /[\\\x00-\x1f]/.test(x) || x.split('/').some(p => ['..', '.', ''].includes(p))) fail('unsafe_path');
  return x;
}
function regular(file: string, max = MAX): Buffer {
  let p = path.parse(path.resolve(file)).root;
  for (const s of path.resolve(file).slice(p.length).split(path.sep).filter(Boolean)) {
    p = path.join(p, s); if (fs.lstatSync(p).isSymbolicLink()) fail('symlink_rejected');
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { const s = fs.fstatSync(fd); if (!s.isFile() || s.size > max || s.nlink !== 1) fail('unsafe_file'); return fs.readFileSync(fd); }
  finally { fs.closeSync(fd); }
}
function git(root: string, args: string[]): string {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 16 * MAX, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  if (r.status !== 0 || r.error) fail('git_unavailable'); return r.stdout;
}
function gitBytes(root: string, args: string[]) {
  const r = spawnSync('git', ['-C', root, ...args], { timeout: 15000, maxBuffer: 32 * MAX });
  if (r.status !== 0 || r.error) fail('git_unavailable'); return r.stdout;
}
function rootOf(cwd: string) { return fs.realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).trim()); }
function skillAliasTarget(file: string) {
  const [tool, directory, name, ...tail] = file.split('/');
  const supported = ['.agent', '.claude', '.codex', '.cursor', '.gemini', '.opencode', '.windsurf'];
  return supported.includes(tool) && directory === 'skills' && !tail.length && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(name || '')
    ? `.agents/skills/${name}` : null;
}
const excluded = (f: string) => !skillAliasTarget(f) && (/^(?:\.git|\.yam|\.codex|\.agents|node_modules|dist|coverage|build|out|\.cache|\.next)(?:\/|$)/.test(f) || /\.(?:tgz|log)$/.test(f));
function aliasIdentity(file: string, bytes: Buffer) {
  if (bytes.toString() !== `../../${skillAliasTarget(file)}`) fail('invalid_skill_alias_target');
  return seal(['120000', digest(bytes)]);
}
const match = (f: string, p: string) => p.endsWith('/**') ? f.startsWith(p.slice(0, -2)) : f === p;
function snapshot(root: string, ref?: string) {
  const files: Record<string, string> = Object.create(null); let total = 0;
  if (ref) {
    if (ref !== 'INDEX' && (!OID.test(ref) || git(root, ['cat-file', '-t', ref]).trim() !== 'commit')) fail('exact_revision_required');
    const rows = ref === 'INDEX' ? git(root, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean).map(row => {
      const tab = row.indexOf('\t'), [mode, oid, stage] = row.slice(0,tab).split(' ');
      if (stage !== '0') fail('unmerged_index'); return `${mode} blob ${oid}\t${row.slice(tab+1)}`;
    }) : git(root, ['ls-tree', '-rz', ref]).split('\0').filter(Boolean);
    const regularEntries = new Set(rows.filter(row => /^(100644|100755) blob /.test(row)).map(row => row.slice(row.indexOf('\t') + 1)));
    for (const row of rows) {
      const tab = row.indexOf('\t'), f = row.slice(tab + 1); if (excluded(f)) continue; rel(f);
      const target = skillAliasTarget(f);
      if (target) {
        if (!row.startsWith('120000 blob ')) fail('invalid_skill_alias');
        const oid = row.slice(0, tab).split(' ')[2];
        if (Number(git(root, ['cat-file', '-s', oid]).trim()) > 2048) fail('invalid_skill_alias_target');
        const bytes = gitBytes(root, ['cat-file', 'blob', oid]);
        const identity = aliasIdentity(f, bytes);
        if (!regularEntries.has(`${target}/SKILL.md`)) fail('invalid_skill_alias_target');
        files[f] = identity; continue;
      }
      if (!/^(100644|100755) blob /.test(row)) fail('unsupported_source_entry');
      const oid = row.slice(0, tab).split(' ')[2];
      const bytes = gitBytes(root, ['cat-file', 'blob', oid]); total += bytes.length;
      if (total > 128 * MAX) fail('source_limit'); files[f] = seal([row.slice(0, 6), digest(bytes)]);
    }
  } else {
    for (const f of [...new Set(git(root, ['ls-files', '-co', '--exclude-standard', '-z']).split('\0').filter(Boolean))].sort()) {
      if (excluded(f)) continue; rel(f); const file = path.join(root, f);
      try { fs.lstatSync(file); } catch (e: any) { if (e.code === 'ENOENT') continue; throw e; }
      const target = skillAliasTarget(f);
      if (target) {
        // Inspect link text and regular target metadata; never traverse the alias.
        for (let parent = path.dirname(file); parent !== root; parent = path.dirname(parent)) {
          const stat = fs.lstatSync(parent);
          if (!stat.isDirectory() || stat.isSymbolicLink()) fail('invalid_skill_alias_target');
        }
        if (!fs.lstatSync(file).isSymbolicLink()) fail('invalid_skill_alias');
        const identity = aliasIdentity(f, Buffer.from(fs.readlinkSync(file)));
        regular(path.join(root, target, 'SKILL.md'));
        files[f] = identity; continue;
      }
      const bytes = regular(file, 32 * MAX); total += bytes.length; if (total > 128 * MAX) fail('source_limit');
      files[f] = seal([(fs.statSync(file).mode & 0o111) ? '100755' : '100644', digest(bytes)]);
    }
  }
  if (Object.keys(files).length > 10000) fail('source_limit');
  return { files, digest: seal(files) };
}
function readPolicy(root: string, file: string, pin?: string): { policy: Policy; digest: string } {
  const bytes = regular(path.join(root, rel(file))), value = JSON.parse(bytes.toString());
  if (pin && (!/^sha256:[a-f0-9]{64}$/.test(pin) || digest(bytes) !== pin)) fail('policy_pin_mismatch');
  exact(value, ['schema', 'setup_status', 'surfaces']);
  if (value.setup_status !== undefined && !['draft', 'ready'].includes(value.setup_status)) fail('invalid_setup_status');
  if (value.schema !== 'yam.test-policy.v1' || !Array.isArray(value.surfaces) || !value.surfaces.length || value.surfaces.length > 128) fail('invalid_policy');
  if (value.surfaces.reduce((n,s) => n + (Array.isArray(s?.checks) ? s.checks.length : 0), 0) > 256) fail('policy_limit');
  const ids = new Set<string>();
  for (const s of value.surfaces) {
    exact(s, ['id', 'paths', 'risks', 'targets', 'checks']);
    if (typeof s.id !== 'string' || !ID.test(s.id) || ids.has(s.id)) fail('duplicate_surface'); ids.add(s.id);
    if (!Array.isArray(s.paths) || !s.paths.length || s.paths.length > 128) fail('invalid_paths');
    for (const p of s.paths) { rel(p); if (p.replace(/\/\*\*$/, '').includes('*') || excluded(p)) fail('invalid_paths'); }
    if (!Array.isArray(s.risks) || !s.risks.length || s.risks.length > 7 || s.risks.some(r => !Object.hasOwn(TEST_REQUIREMENTS, r))) fail('invalid_risks');
    if (!Array.isArray(s.targets) || !s.targets.length || s.targets.length > 128 || new Set(s.targets).size !== s.targets.length || s.targets.some(t => typeof t !== 'string' || !ID.test(t))) fail('invalid_targets');
    if (!Array.isArray(s.checks) || s.checks.length > 256) fail('invalid_checks');
    for (const c of s.checks) {
      exact(c, ['id', 'target', 'scenario', 'explanation', 'evidence', 'command', 'environment']);
      if (typeof c.id !== 'string' || !ID.test(c.id) || ids.has(c.id)) fail('duplicate_check'); ids.add(c.id);
      if (!s.targets.includes(c.target) || typeof c.scenario !== 'string' || !ID.test(c.scenario) || typeof c.explanation !== 'string' || !c.explanation.trim() || c.explanation.length > 500 || unsafe(c.explanation)) fail('invalid_check');
      if (!['static', 'unit', 'integration', 'e2e'].includes(c.evidence)) fail('invalid_evidence');
      if (!Array.isArray(c.command) || !c.command.length || c.command.length > 64 || c.command.some(a => typeof a !== 'string' || !a || a.length > 2048 || unsafe(a))) fail('invalid_command');
      if (c.environment) rel(c.environment);
    }
  }
  return { policy: value, digest: digest(bytes) };
}
function infer(file: string): Risk[] {
  if (/\.sql$|(?:^|\/)(?:migrations|database|db)(?:\/|\.)/i.test(file)) return ['db'];
  const risks: Risk[] = [];
  if (/(?:^|\/)(?:auth|permissions?|sessions?|rls)(?:[./-]|$)/i.test(file) && !/\.md$/.test(file)) risks.push('auth');
  if (/^(?:\.github\/workflows\/)|^(?:package(?:-lock)?\.json|yam\.manifest\.json)$/.test(file)) risks.push('release');
  if (/(?:^|\/)(?:api|routes)(?:\/|\.)/.test(file)) risks.push('api');
  if (/\.(?:tsx|jsx|vue|svelte)$/.test(file)) risks.push('ui');
  return risks.length ? risks : /\.(?:md|txt|rst)$/.test(file) ? ['docs'] : ['logic'];
}
export function planTestCheck(root: string, policy: Policy, base: string) {
  const now = snapshot(root), old = snapshot(root, base);
  const changed = [...new Set([...Object.keys(now.files), ...Object.keys(old.files)])].filter(f => now.files[f] !== old.files[f]).sort();
  const errors: string[] = policy.setup_status === 'draft' ? ['project_setup_required'] : [], selected = new Map<string, Check>();
  const surfaces = policy.surfaces.filter(s => changed.some(f => s.paths.some(p => match(f, p))));
  for (const file of changed) {
    const owners = surfaces.filter(s => s.paths.some(p => match(file, p)));
    if (!owners.length) { errors.push('unmapped_changed_file'); continue; }
    for (const risk of infer(file)) {
      if (!owners.some(s => s.risks.includes(risk))) errors.push(`missing_risk:${risk}`);
    }
    // Bounded SQL discovery is supplementary; dynamic SQL and overloaded signatures need explicit review.
    if (/\.sql$/i.test(file)) {
      let sql = ''; try { sql = regular(path.join(root, file)).toString(); } catch { /* deleted objects are covered by baseline below */ }
      try { sql += '\n' + git(root, ['show', `${base}:${file}`]); } catch { /* new file */ }
      const targets = [...sql.matchAll(/\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|ALTER\s+|DROP\s+)(FUNCTION|PROCEDURE|POLICY|TRIGGER)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([a-zA-Z_][\w.]*)/gi)].map(m => `${m[1].toLowerCase()}:${m[2].toLowerCase()}`);
      for (const target of new Set(targets)) if (!owners.some(s => s.risks.includes('db') && s.targets.includes(target))) errors.push('unmapped_sql_object');
      if (/\bEXECUTE\s+(?!ON\b)|"/i.test(sql)) errors.push('sql_manual_review_required');
    }
  }
  for (const s of surfaces) {
    const required = [...new Set(s.risks.flatMap(r => [...TEST_REQUIREMENTS[r]]))];
    for (const target of s.targets) for (const scenario of required) {
      const candidates = s.checks.filter(c => c.target === target && c.scenario === scenario);
      if (!candidates.length) errors.push(`missing_scenario:${scenario}`);
      candidates.forEach(c => selected.set(c.id, c));
    }
    for (const c of s.checks) selected.set(c.id, c);
    if (s.risks.some(r => ['db', 'auth', 'api', 'ui'].includes(r))) for (const c of s.checks) {
      if (['static', 'unit'].includes(c.evidence)) errors.push(`real_evidence_required:${c.id}`);
      if (s.risks.includes('db') && !c.environment) errors.push(`db_environment_required:${c.id}`);
    }
  }
  return { changed, source_digest: now.digest, checks: [...selected.values()], errors: [...new Set(errors)] };
}
function environment(root: string, c: Check) {
  if (!c.environment) return null;
  const e = JSON.parse(regular(path.join(root, c.environment)).toString());
  if (!e || e.schema !== 'yam.test-environment.v1' || typeof e.engine !== 'string' || !e.engine.trim()
    || typeof e.engine_version !== 'string' || !e.engine_version.trim() || e.source_digest !== snapshot(root).digest
    || !/^sha256:[a-f0-9]{64}$/.test(e.configuration_digest) || !/^sha256:[a-f0-9]{64}$/.test(e.roles_digest)
    || !/^sha256:[a-f0-9]{64}$/.test(e.fixtures_digest) || !Array.isArray(e.migrations)) fail('invalid_environment');
  const files = [...new Set(git(root, ['ls-files', '-co', '--exclude-standard', '-z']).split('\0').filter(f => f && !excluded(f)
    && /(?:^|\/)migrations\//i.test(f) && fs.existsSync(path.join(root,f))))].sort();
  if (files.length !== e.migrations.length || files.some((f,i) => e.migrations[i]?.file !== f
    || e.migrations[i]?.sha256 !== digest(regular(path.join(root,rel(f)))))) fail('migration_inventory_mismatch');
  return e;
}
function validateObservation(c: Check, m: Measurement, expected: any) {
  const errors = Array.isArray(m.errors) && m.errors.every(e => typeof e === 'string' && /^[a-z_]+(?::[a-zA-Z0-9_.:-]+)?$/.test(e)) ? [...m.errors] : ['invalid_measurement']; const o = m.observation;
  if (m.check_id !== c.id || m.command_digest !== seal(c.command) || m.exit_code !== 0) errors.push(`command_failed:${c.id}`);
  if (!o || o.id !== c.id || o.target !== c.target || o.scenario !== c.scenario || o.evidence !== c.evidence || o.status !== 'passed'
    || !Number.isSafeInteger(o.tests) || o.tests < 1 || !Number.isSafeInteger(o.assertions) || o.assertions < 1 || o.failed !== 0 || o.skipped !== 0) errors.push(`invalid_result:${c.id}`);
  if (['integration', 'e2e'].includes(c.evidence) && o?.mocked !== false) errors.push(`mock_substitution:${c.id}`);
  if (c.environment && (!expected || seal(o?.environment ?? null) !== seal(expected))) errors.push(`environment_mismatch:${c.id}`);
  return errors;
}
function evaluate(checks: Check[], measurements: Measurement[], expected: Record<string, any>) {
  const errors: string[] = [];
  if (!Array.isArray(measurements) || measurements.length !== checks.length) return ['measurement_inventory_mismatch'];
  for (const c of checks) {
    const matches = measurements.filter(m => m.check_id === c.id);
    if (matches.length !== 1) errors.push(`measurement_missing:${c.id}`);
    else errors.push(...validateObservation(c, matches[0], expected[c.id]));
  }
  return [...new Set(errors)];
}

function deployment(root: string, artifact?: string, configuration?: string) {
  if (!artifact || !configuration) fail('deployment_files_required');
  return { artifact: rel(artifact), artifact_digest: digest(regular(path.join(root,rel(artifact)), 256 * MAX)),
    configuration: rel(configuration), configuration_digest: digest(regular(path.join(root,rel(configuration)))) };
}

function privateDir(root: string) {
  for (const part of ['.yam', '.yam/testing', '.yam/testing/runs']) {
    const dir = path.join(root, part); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
    const s = fs.lstatSync(dir); if (!s.isDirectory() || s.isSymbolicLink()) fail('unsafe_state_directory');
  }
}
function writeNew(file: string, value: string) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function persist(root: string, r: any, checks: Check[]) {
  privateDir(root); const lock = path.join(root, '.yam/testing/lock'); writeNew(lock, r.run_id);
  try {
    const note = path.join(root, '.yam/testing/notes.md');
    if (fs.existsSync(note)) regular(note, 64 * MAX);
    const lines = ['\n-- Test check --', `Run: ${r.run_id}; Time: ${r.time}`, `Stage: ${r.stage}`, `Policy: ${r.policy_digest || 'unavailable'}`, `Source: ${r.source_digest || 'unavailable'}`, ''];
    checks.forEach((c, i) => { const m = r.measurements.find(x => x.check_id === c.id); lines.push(`${i + 1}. ${c.id} : "${c.explanation}" : ${!m ? '미검증' : m.errors.length ? '점검 실패' : '점검 완료 - 이상 없음'}`); });
    lines.push(`Result: ${r.result}`, `Blocking: ${r.errors.join(', ') || 'none'}`, 'Evidence: adapter-reported assertions; process exit and source identity measured by yam', '-- End Test check --', '');
    const fd = fs.openSync(note, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0), 0o600);
    try { fs.writeFileSync(fd, lines.join('\n')); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    r.note_digest = digest(regular(note, 64 * MAX)); r.digest = seal(r);
    writeNew(path.join(root, `.yam/testing/runs/${r.run_id}.json`), JSON.stringify(r, null, 2) + '\n');
    const latest = path.join(root, '.yam/testing/latest.json'); if (fs.existsSync(latest)) regular(latest);
    const temp = path.join(root, `.yam/testing/${randomUUID()}.tmp`);
    try { writeNew(temp, JSON.stringify(r, null, 2) + '\n'); fs.renameSync(temp, latest); } finally { fs.rmSync(temp, { force: true }); }
  } finally { fs.unlinkSync(lock); }
}
export function runTestCheck(cwd: string, options: { policy?: string; pin?: string; base?: string; stage?: string; source?: string; artifact?: string; configuration?: string } = {}) {
  let root: string; try { root = rootOf(cwd); } catch { return { ok: false, result: 'BLOCKED', errors: ['git_unavailable'] }; }
  const r: any = { schema: 'yam.test-check.v1', run_id: `test-${randomUUID()}`, time: new Date().toISOString(), stage: STAGES.includes(options.stage || 'complete') ? options.stage || 'complete' : 'unavailable', result: 'BLOCKED', errors: [], measurements: [], policy_digest: '', source_digest: '', base: '', expected_environments: {} };
  let checks: Check[] = [];
  try {
    if (!['complete', 'commit', 'push', 'ci', 'deploy'].includes(r.stage)) fail('invalid_stage');
    if (['ci', 'deploy'].includes(r.stage) && (!options.pin || !/^sha256:[a-f0-9]{64}$/.test(options.pin))) fail('trusted_policy_pin_required');
    if (r.stage === 'deploy') r.deployment = deployment(root, options.artifact, options.configuration);
    const p = readPolicy(root, policyPath(root, options.policy), options.pin); r.policy_digest = p.digest;
    if (typeof options.base !== 'string' || !OID.test(options.base)) fail('exact_base_required'); r.base = options.base;
    if (p.policy.setup_status === 'draft') fail('project_setup_required');
    const plan = planTestCheck(root, p.policy, r.base); checks = plan.checks; r.source_digest = plan.source_digest; r.changed = plan.changed;
    r.errors.push(...plan.errors); if (!plan.changed.length) r.errors.push('empty_change_scope');
    for (const c of checks) r.expected_environments[c.id] = environment(root, c);
    const executions = new Map<string, any>();
    if (!r.errors.length) for (const c of checks) {
      const key = seal(c.command); let execution = executions.get(key);
      if (!execution) {
        const command = c.command[0] === '$NODE' ? process.execPath : c.command[0];
        const x = spawnSync(command, c.command.slice(1), { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: MAX, shell: false,
          env: { ...process.env, YAM_TEST_CHECK: '1', YAM_TEST_ARTIFACT: r.deployment?.artifact || '', YAM_TEST_CONFIGURATION: r.deployment?.configuration || '' } });
        let body: any = null; try { body = JSON.parse(x.stdout); } catch { /* fail closed without recording raw output */ }
        execution = { exit_code: x.error ? -1 : x.status ?? -1, output_digest: digest((x.stdout || '') + (x.stderr || '')),
          tests: body?.schema === 'yam.test-observation.v1' && Array.isArray(body.tests) ? body.tests : [] };
        executions.set(key, execution);
      }
      const matches = execution.tests.filter(o => o.id === c.id);
      const o = matches.length === 1 ? matches[0] : null;
      // Store only allowlisted facts. Never persist subprocess text, environment values or arbitrary report fields.
      const observation = o ? { id: c.id, target: o.target === c.target ? c.target : '', scenario: o.scenario === c.scenario ? c.scenario : '',
        evidence: o.evidence === c.evidence ? c.evidence : '', status: o.status === 'passed' ? 'passed' : 'failed',
        tests: Number.isSafeInteger(o.tests) ? o.tests : 0, assertions: Number.isSafeInteger(o.assertions) ? o.assertions : 0,
        failed: Number.isSafeInteger(o.failed) ? o.failed : -1, skipped: Number.isSafeInteger(o.skipped) ? o.skipped : -1, mocked: o.mocked === false ? false : true,
        environment: o.environment == null ? null : seal(o.environment) } : null;
      const expected = r.expected_environments[c.id];
      // Persist environment hashes only, while comparing actual structured measurements before redaction.
      const measurement: Measurement = { check_id: c.id, command_digest: key, exit_code: execution.exit_code, output_digest: execution.output_digest, observation: o, errors: [] };
      measurement.errors = validateObservation(c, measurement, expected); measurement.observation = observation;
      r.measurements.push(measurement);
    }
    r.expected_environments = Object.fromEntries(Object.entries(r.expected_environments).map(([k,v]) => [k, v == null ? null : seal(v)]));
    r.errors.push(...r.measurements.flatMap(m => m.errors));
    if (r.measurements.length !== checks.length) r.errors.push('measurement_inventory_mismatch');
    if (snapshot(root).digest !== r.source_digest) r.errors.push('source_changed_during_tests');
    if (readPolicy(root, policyPath(root, options.policy), options.pin).digest !== r.policy_digest) r.errors.push('policy_changed_during_tests');
    for (const c of checks) if ((environment(root, c) == null ? null : seal(environment(root,c))) !== r.expected_environments[c.id]) r.errors.push('environment_changed_during_tests');
    if (r.stage === 'commit' && snapshot(root, 'INDEX').digest !== r.source_digest) r.errors.push('staged_source_mismatch');
    if (['push', 'ci', 'deploy'].includes(r.stage)) {
      if (!options.source || !OID.test(options.source) || snapshot(root, options.source).digest !== r.source_digest) r.errors.push('source_revision_mismatch');
      if (['ci', 'deploy'].includes(r.stage) && !options.pin) r.errors.push('trusted_policy_pin_required');
    }
    if (r.stage === 'deploy' && seal(deployment(root, options.artifact, options.configuration)) !== seal(r.deployment)) r.errors.push('deployment_changed_during_tests');
    r.errors = [...new Set(r.errors)]; r.result = r.errors.length ? 'BLOCKED' : 'PASS';
  } catch (error: any) { r.errors.push('test_check_setup_failed'); if (/^[a-z_]{1,80}$/.test(error?.message || '')) r.errors.push(error.message); }
  // Environment values from an early setup failure must not escape into receipts.
  r.expected_environments = Object.fromEntries(Object.entries(r.expected_environments).map(([k,v]) => [k, typeof v === 'string' && /^sha256:/.test(v) ? v : null]));
  try { persist(root, r, checks); } catch { return { ok: false, result: 'BLOCKED', errors: [...r.errors, 'test_note_persistence_failed'] }; }
  return { ok: r.result === 'PASS', result: r.result, errors: r.errors, run: r.run_id, note: '.yam/testing/notes.md', receipt: `.yam/testing/runs/${r.run_id}.json`, changed_files: r.changed?.length || 0, checks: checks.length };
}

export function checkTestCheck(cwd: string, options: { policy?: string; pin?: string; stage?: string; source?: string; receipt?: string; artifact?: string; configuration?: string; base?: string } = {}) {
  try {
    const root = rootOf(cwd), { policy, digest: policyDigest } = readPolicy(root, policyPath(root, options.policy), options.pin);
    if (policy.setup_status === 'draft') return { ok: false, result: 'BLOCKED', errors: ['project_setup_required'], next_action: 'connect_project_observations_and_review_scenarios' };
    const r = JSON.parse(regular(path.join(root, rel(options.receipt || '.yam/testing/latest.json'))).toString());
    const { digest: storedDigest, ...body } = r;
    const errors: string[] = [];
    if (r.schema !== 'yam.test-check.v1' || seal(body) !== storedDigest || r.result !== 'PASS' || !Array.isArray(r.errors) || r.errors.length) errors.push('invalid_receipt');
    if (r.policy_digest !== policyDigest) errors.push('policy_changed');
    if (options.base !== undefined && (typeof options.base !== 'string' || !OID.test(options.base) || r.base !== options.base)) errors.push('baseline_mismatch');
    if (!Number.isFinite(Date.parse(r.time)) || Date.now() - Date.parse(r.time) < 0 || Date.now() - Date.parse(r.time) > 24 * 3600000) errors.push('receipt_expired');
    if (snapshot(root).digest !== r.source_digest) errors.push('source_changed');
    const plan = planTestCheck(root, policy, r.base); errors.push(...plan.errors); if (!plan.changed.length) errors.push('empty_change_scope');
    const expected: any = {};
    for (const c of plan.checks) { const e = environment(root,c); expected[c.id] = e == null ? null : seal(e); }
    if (seal(expected) !== seal(r.expected_environments)) errors.push('environment_changed');
    // Observations store only measured environment hashes, not raw values.
    const checks = plan.checks.map(c => ({ ...c, environment: undefined }));
    errors.push(...evaluate(checks, r.measurements, {}));
    for (const c of plan.checks) if (c.environment && r.measurements.find(m => m.check_id === c.id)?.observation?.environment !== expected[c.id]) errors.push('environment_mismatch');
    const note = regular(path.join(root, '.yam/testing/notes.md'), 64 * MAX).toString();
    if (digest(Buffer.from(note)) !== r.note_digest || !note.includes(`Run: ${r.run_id};`) || !note.includes('-- End Test check --')) errors.push('note_missing');
    const stage = options.stage || 'complete';
    if (stage === 'deploy' && (r.stage !== 'deploy' || seal(deployment(root, options.artifact, options.configuration)) !== seal(r.deployment))) errors.push('deployment_identity_mismatch');
    if (!['complete', 'commit', 'push', 'ci', 'deploy'].includes(stage)) errors.push('invalid_stage');
    if (stage === 'commit' && snapshot(root, 'INDEX').digest !== r.source_digest) errors.push('staged_source_mismatch');
    if (['push', 'ci', 'deploy'].includes(stage)) {
      if (!options.source || !OID.test(options.source) || snapshot(root, options.source).digest !== r.source_digest) errors.push('source_revision_mismatch');
      if (['ci', 'deploy'].includes(stage) && !options.pin) errors.push('trusted_policy_pin_required');
    }
    return { ok: errors.length === 0, result: errors.length ? 'BLOCKED' : 'PASS', errors: [...new Set(errors)], run: r.run_id, checks: plan.checks.length };
  } catch { return { ok: false, result: 'BLOCKED', errors: ['test_check_unavailable'] }; }
}

export function testCheckConfigured(cwd: string) {
  try { const root = rootOf(cwd); return fs.existsSync(path.join(root, policyPath(root))) || !!git(root, ['ls-files', '--', POLICY]).trim() || fs.existsSync(path.join(root, '.yam/testing/latest.json')); }
  catch {
    // Git discovery failure must not disable an already configured project's Stop gate.
    let dir = path.resolve(cwd);
    while (true) {
      if ([POLICY, '.yam/testing/policy.json', '.yam/testing/latest.json'].some(f => fs.existsSync(path.join(dir,f)))) return true;
      const parent = path.dirname(dir); if (parent === dir) return false; dir = parent;
    }
  }
}
export function testCheckStop(cwd: string, changed: boolean, message: string, scopeKnown = true) {
  if (!changed || !testCheckConfigured(cwd)) return null;
  // A passing source receipt cannot establish what changed during an unknown turn.
  if (scopeKnown && checkTestCheck(cwd).ok) return null;
  // A formatted status is still an incomplete handoff. Quoted code examples are not.
  let fence = '', fenceLength = 0;
  const handoff = message.split(/\r?\n/).some(line => {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (delimiter) {
      if (!fence) { fence = delimiter[1][0]; fenceLength = delimiter[1].length; }
      else if (delimiter[1][0] === fence && delimiter[1].length >= fenceLength && !delimiter[2].trim()) fence = '';
      return false;
    }
    if (fence) return false;
    const status = line.replace(/^\*\*(Test check: BLOCKED\.?)\*\*/, '$1');
    return /^Test check: BLOCKED(?:[ \t]*[.;:—–-][ \t]*[^\r\n]*)?[ \t]*$/.test(status);
  });
  if (handoff) return { continue: true, systemMessage: 'Test check remains BLOCKED; this is an incomplete-status handoff, not approval of completion, commit or deployment.' };
  if (!scopeKnown) return { decision: 'block', reason: 'yam Test check BLOCKED: current turn change scope is unavailable. Restore the turn baseline and verify actual changes before claiming completion. If unable, report Test check: BLOCKED and the verification limitation to end the handoff. Do not claim complete or repeat the same failed commands without repairing the cause.' };
  return { decision: 'block', reason: 'yam Test check BLOCKED. Run yam test-check run --base <exact-base> --json, then yam test-check check --json. Repair required scenarios/evidence; if unable, report Test check: BLOCKED and the verification limitation. Do not claim complete.' };
}

export function runTestCheckCommand(args: string[], cwd = process.cwd()) {
  const action = args[0]; const options: any = {};
  const names = { '--policy': 'policy', '--policy-digest': 'pin', '--base': 'base', '--stage': 'stage', '--source': 'source', '--receipt': 'receipt', '--artifact': 'artifact', '--configuration': 'configuration' };
  try {
    for (let i=1; i<args.length; i++) { if (args[i] === '--json') continue; if (action === 'init' && args[i] === '--dry-run') { if (options.dryRun) fail('invalid_option'); options.dryRun = true; continue; } const key = names[args[i]]; if (!key || options[key] || !args[i+1] || args[i+1].startsWith('--')) fail('invalid_option'); options[key] = args[++i]; }
    if (action === 'init') {
      if (Object.keys(options).some(key => !['base', 'dryRun'].includes(key))) fail('invalid_option');
      return initializeTestCheck(cwd, options, { infer, requirements: TEST_REQUIREMENTS });
    }
    if (action === 'plan') {
      const root = rootOf(cwd); if (!options.base || !OID.test(options.base)) fail('exact_base_required');
      const { policy, digest: policy_digest } = readPolicy(root, policyPath(root, options.policy), options.pin);
      const plan = planTestCheck(root, policy, options.base);
      return { ok: plan.errors.length === 0, ...plan, checks: plan.checks.map(c => ({id:c.id, target:c.target, scenario:c.scenario, explanation:c.explanation, evidence:c.evidence})), policy_digest };
    }
    if (action === 'run') return runTestCheck(cwd, options);
    if (action === 'check') return checkTestCheck(cwd, options);
    if (action === 'status') {
      const setup = inspectTestCheckSetup(cwd);
      if (setup.configuration_status !== 'configured') return { ok: false, result: 'BLOCKED', configured: setup.configuration_status === 'draft', ...setup,
        errors: [setup.configuration_status === 'unavailable' ? 'test_check_unavailable' : 'project_setup_required'] };
      return { configured: true, ...setup, ...checkTestCheck(cwd, options) };
    }
    return { ok: false, result: 'BLOCKED', errors: ['supported_commands_init_plan_run_check_status'] };
  } catch {
    if (action === 'run') return runTestCheck(cwd, { stage: 'invalid' });
    return { ok: false, result: 'BLOCKED', errors: ['invalid_test_check_command'] };
  }
}
