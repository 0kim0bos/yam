import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSecurityStarter, validateSecurityCheck, persistSecurityCheck, SECURITY_AREA_IDS } from './security-check.js';
import type { SecurityCheckInput, SecurityPolicy, SecurityCheckResult } from './security-check.js';

const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ZERO = /^0+$/;
export type SecurityBinding = Record<string, unknown>;
export interface SecurityCommandOptions { cwd?: string; cliPath?: string; stdin?: string }
const hash = (text: string | Buffer) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
function git(cwd: string, args: string[]): string {
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }).trim(); }
  catch { throw new Error('git binding inspection failed'); }
}
function revision(cwd: string, ref: string): string {
  if (!OID.test(ref)) throw new Error('revision must be an exact Git object ID');
  const result = git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (!OID.test(result)) throw new Error('invalid source commit');
  return result;
}
function parseArgs(args: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') continue;
    if (!['--policy', '--policy-digest', '--evidence', '--note', '--stage', '--remote', '--destination', '--source', '--base', '--artifact', '--artifact-digest', '--configuration', '--configuration-digest', '--environment', '--cli'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || out.has(args[i])) throw new Error('invalid or duplicate security option');
    out.set(args[i], args[++i]);
  }
  return out;
}
export function collectSecurityBinding(cwd: string, stage: string, options: Map<string, string>, stdin = ''): SecurityBinding {
  if (stage === 'commit') {
    let base: string;
    try { base = git(cwd, ['rev-parse', '--verify', 'HEAD']); }
    catch { base = execFileSync('git', ['-C', cwd, 'hash-object', '-t', 'tree', '--stdin'], { input: '', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
    return { stage, staged_tree: git(cwd, ['write-tree']), base_revision: base };
  }
  if (stage === 'push') {
    const remote = options.get('--remote');
    if (!remote || /[\r\n\0]/.test(remote)) throw new Error('push requires remote identity');
    const destination = options.get('--destination');
    if (!destination || /[\r\n\0]/.test(destination)) throw new Error('push requires actual Git hook destination');
    const lines = stdin.trim().split('\n').filter(Boolean);
    if (!lines.length || lines.length > 256) throw new Error('push requires exact outgoing refs from hook stdin');
    const push_refs = lines.map(line => {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 4 || !OID.test(fields[1]) || !OID.test(fields[3]) || ZERO.test(fields[1]) || !(fields[0] === 'HEAD' || fields[0].startsWith('refs/')) || !fields[2].startsWith('refs/')) throw new Error('invalid push ref or deletion; deletion requires separate reviewed handling');
      revision(cwd, fields[1]);
      return { local_ref: fields[0], local_oid: fields[1], remote_ref: fields[2], remote_oid: fields[3] };
    });
    if (new Set(push_refs.map(r => r.remote_ref)).size !== push_refs.length) throw new Error('duplicate outgoing destination ref');
    return { stage, destination_digest: hash(destination), push_refs };
  }
  if (stage === 'ci') {
    const source = revision(cwd, options.get('--source') || '');
    const base = revision(cwd, options.get('--base') || '');
    return { stage: 'push', context: 'ci', source_revision: source, base_revision: base, tree: git(cwd, ['rev-parse', `${source}^{tree}`]) };
  }
  if (stage === 'deploy') {
    const source = revision(cwd, options.get('--source') || '');
    const artifact = options.get('--artifact-digest') || '';
    const configuration = options.get('--configuration-digest') || '';
    const environment = options.get('--environment') || '';
    if (!DIGEST.test(artifact) || !DIGEST.test(configuration) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(environment)) throw new Error('deploy requires exact artifact/configuration SHA256 and environment');
    return { stage, source_revision: source, artifact_digest: artifact, configuration_digest: configuration, environment };
  }
  throw new Error('stage must be commit, push, ci or deploy');
}
async function readSafe(file: string): Promise<string> {
  await safeParents(file);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error('invalid security file');
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}
function quote(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }
async function exclusive(file: string, text: string, mode = 0o600): Promise<void> {
  await safeParents(file);
  const handle = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
}
async function gitMetadata(cwd: string): Promise<{ root: string; directory: string; hooks: string; config: string }> {
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  const directory = path.resolve(cwd, git(cwd, ['rev-parse', '--git-dir']));
  const hookOverride = (() => { try { return git(cwd, ['config', '--get', 'core.hooksPath']); } catch { return ''; } })();
  if (hookOverride) throw new Error('custom hooksPath requires explicit manual integration');
  return { root, directory, hooks: path.join(directory, 'hooks'), config: path.join(directory, 'yam-security.json') };
}
async function enableHooks(cwd: string, options: Map<string, string>, cliPath?: string): Promise<Record<string, unknown>> {
  if (process.platform === 'win32') throw new Error('automatic hook setup requires a POSIX Git shell; integrate manually on Windows');
  const metadata = await gitMetadata(cwd);
  const settings = JSON.parse(await readSafe(metadata.config));
  if (settings.schema !== 'yam.security-install.v1' || !DIGEST.test(settings.policy_digest)) throw new Error('security init required before hooks enable');
  const cli = await fs.realpath(cliPath || options.get('--cli') || fileURLToPath(new URL('../bin/yam.js', import.meta.url)));
  const node = await fs.realpath(process.execPath);
  if (!(await fs.stat(cli)).isFile()) throw new Error('built CLI path required');
  const files = ['pre-commit', 'pre-push'].map(name => path.join(metadata.hooks, name));
  for (const file of files) {
    try { await fs.lstat(file); throw new Error('existing Git hooks preserved; use manual integration'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  await fs.mkdir(metadata.hooks, { recursive: true });
  const common = `${quote(node)} ${quote(cli)} security check --policy ${quote(settings.policy)} --policy-digest ${quote(settings.policy_digest)} --evidence ${quote(settings.evidence)} --note ${quote(settings.note)}`;
  const created: string[] = [];
  try {
    for (const [index, file] of files.entries()) {
      const stage = index === 0 ? 'commit' : 'push';
      const remote = index === 1 ? ' --remote "$1" --destination "$2"' : '';
      await exclusive(file, `#!/bin/sh\n# yam.security-hook.v1\nexec ${common} --stage ${stage}${remote}\n`, 0o700);
      created.push(file);
    }
  } catch (error) { for (const file of created) await fs.unlink(file); throw error; }
  return { ok: true, result: 'ENABLED', hooks: ['pre-commit', 'pre-push'], enforcement: 'local_bypassable', ci_required: true };
}
async function safeParents(file: string): Promise<void> {
  let current = path.dirname(path.resolve(file));
  while (current !== path.dirname(current)) {
    try { const info = await fs.lstat(current); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('unsafe security file parent'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    current = path.dirname(current);
  }
}
async function initialize(cwd: string, options: Map<string, string>): Promise<Record<string, unknown>> {
  const metadata = await gitMetadata(cwd);
  const base = path.join(metadata.root, '.yam', 'security');
  const policyPath = path.resolve(metadata.root, options.get('--policy') || '.yam/security/policy.json');
  const evidencePath = path.resolve(metadata.root, options.get('--evidence') || '.yam/security/check.json');
  const notePath = path.resolve(metadata.root, options.get('--note') || '.yam/security/notes.md');
  for (const target of [policyPath, evidencePath, notePath]) {
    if (!target.startsWith(metadata.root + path.sep)) throw new Error('init files must be inside repository');
    await safeParents(target);
  }
  // All areas have explicit trusted requirements; live environment inspection is deferred to deploy.
  const policy: SecurityPolicy = { version: 'security-check-v1', required_at: Object.fromEntries(SECURITY_AREA_IDS.map(id => [id, id === 'SEC-05' ? ['deploy'] : ['commit', 'push', 'deploy']])) };
  const policyText = JSON.stringify(policy, null, 2) + '\n';
  const binding = collectSecurityBinding(metadata.root, 'commit', options);
  const starter = createSecurityStarter({ stage: 'commit', policy, binding: binding as any, environment: 'local', scope: ['initial project security assessment'], checker: 'operator-review-required' });
  starter.policy_digest = hash(policyText);
  const files = [policyPath, evidencePath, metadata.config];
  for (const file of files) {
    try { await fs.lstat(file); throw new Error('security init preserves existing files'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  await safeParents(path.join(base, 'placeholder'));
  await fs.mkdir(base, { recursive: true });
  const created: string[] = [];
  try {
    for (const [file, content] of [
      [policyPath, policyText], [evidencePath, JSON.stringify(starter, null, 2) + '\n'],
      [metadata.config, JSON.stringify({ schema: 'yam.security-install.v1', policy: policyPath, policy_digest: hash(policyText), evidence: evidencePath, note: notePath }, null, 2) + '\n']
    ]) { await exclusive(file, content); created.push(file); }
  } catch (error) { for (const file of created) await fs.unlink(file); throw error; }
  return { ok: true, result: 'INITIALIZED', policy_digest: hash(policyText), evidence: path.relative(metadata.root, evidencePath), hooks_installed: false, evidence_boundary: 'operator_supplied_not_automatic_security_scan' };
}
async function verifyReferencedEvidence(cwd: string, input: SecurityCheckInput): Promise<string[]> {
  const errors: string[] = [];
  for (const area of input.areas || []) {
    if (!SECURITY_AREA_IDS.includes(area.id)) { errors.push('invalid_evidence_area'); continue; }
    if (area.status === 'passed' && !area.evidence?.length) errors.push(`evidence_missing:${area.id}`);
    for (const evidence of area.evidence || []) {
      if (typeof evidence.reference !== 'string' || !evidence.reference || path.isAbsolute(evidence.reference) || /^[a-z]+:/i.test(evidence.reference)) { errors.push(`evidence_reference_invalid:${area.id}`); continue; }
      const file = path.resolve(cwd, evidence.reference);
      if (!file.startsWith(path.resolve(cwd) + path.sep)) { errors.push(`evidence_outside_repository:${area.id}`); continue; }
      try { if (await digestFile(file, 16 * 1024 * 1024) !== evidence.sha256) errors.push(`evidence_digest_mismatch:${area.id}`); }
      catch { errors.push(`evidence_unavailable:${area.id}`); }
    }
  }
  return errors;
}
export async function runSecurityCommand(args: string[], settings: SecurityCommandOptions = {}): Promise<Record<string, unknown>> {
  const cwd = await fs.realpath(path.resolve(settings.cwd || process.cwd()));
  const subcommand = args[0];
  try {
    if (subcommand === 'hooks') {
      if (args[1] !== 'enable') throw new Error('supported hook operation: enable');
      return await enableHooks(cwd, parseArgs(args.slice(2)), settings.cliPath);
    }
    const options = parseArgs(args.slice(1));
    if (subcommand === 'init') return await initialize(cwd, options);
    if (subcommand === 'status') {
      const metadata = await gitMetadata(cwd);
      let configured = false;
      try { const config = JSON.parse(await readSafe(metadata.config)); configured = config.schema === 'yam.security-install.v1'; } catch { /* unavailable is reported */ }
      const installed: string[] = [];
      for (const name of ['pre-commit', 'pre-push']) {
        try { if ((await readSafe(path.join(metadata.hooks, name))).includes('# yam.security-hook.v1')) installed.push(name); } catch { /* unavailable is reported */ }
      }
      return { ok: true, configured, local_hooks: installed, local_hooks_bypassable: true, remote_enforcement: 'not_measured', evidence_boundary: 'operator_supplied_not_automatic_security_scan' };
    }
    if (subcommand !== 'check') throw new Error('supported commands: init, check, hooks enable, status');
    return await check(cwd, options, settings);
  } catch {
    if (subcommand === 'check') {
      const input = createSecurityStarter({ stage: 'commit', binding: { stage: 'commit', invalid_binding: true }, environment: 'local', scope: ['rejected security command'], checker: 'yam-security-check' });
      const result = validateSecurityCheck(input);
      result.errors.push('security_command_failed'); result.blocking.push('integration:security_command_failed'); result.result = 'BLOCKED';
      try { const persisted = await persistSecurityCheck(cwd, input, result); return { ok: false, ...persisted, evidence_boundary: 'operator_supplied_not_automatic_security_scan' }; }
      catch { return { ok: false, result: 'BLOCKED', errors: ['security_command_failed', 'security_note_persistence_failed'] }; }
    }
    return { ok: false, result: 'BLOCKED', errors: ['security_command_failed'], evidence_boundary: 'operator_supplied_not_automatic_security_scan' };
  }
}
async function check(cwd: string, options: Map<string, string>, settings: SecurityCommandOptions): Promise<Record<string, unknown>> {
  const stage = options.get('--stage') || 'commit';
  const normalizedStage = stage === 'ci' ? 'push' : stage;
  let config: any = {};
  try { const metadata = await gitMetadata(cwd); config = JSON.parse(await readSafe(metadata.config)); } catch { /* an explicit trust pin can be provided instead */ }
  const notePath = path.resolve(cwd, options.get('--note') || config.note || '.yam/security/notes.md');
  let input: SecurityCheckInput;
  let binding: SecurityBinding = { stage: normalizedStage, invalid_binding: true };
  let policy: SecurityPolicy = { version: 'security-check-v1', required_at: Object.fromEntries(SECURITY_AREA_IDS.map(id => [id, ['commit', 'push', 'deploy']])) };
  let result: SecurityCheckResult;
  const gateErrors: string[] = [];
  try {
    const policyFile = path.resolve(cwd, options.get('--policy') || config.policy || '.yam/security/policy.json');
    const pin = options.get('--policy-digest') || ((stage !== 'ci' && stage !== 'deploy') ? config.policy_digest : undefined);
    if (!pin || !DIGEST.test(pin)) throw new Error('policy_pin_missing');
    const policyText = await readSafe(policyFile);
    if (hash(policyText) !== pin) throw new Error('policy_pin_mismatch');
    policy = JSON.parse(policyText);
    if (!policy || typeof policy.version !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(policy.version) || Object.keys(policy).some(key => !['version', 'required_at'].includes(key)) || !policy.required_at || Object.keys(policy.required_at).some(key => !SECURITY_AREA_IDS.includes(key as any)) || SECURITY_AREA_IDS.some(id => !Array.isArray(policy.required_at[id]))) throw new Error('policy_invalid');
    for (const id of ['SEC-01', 'SEC-08'] as const) if (!['commit', 'push', 'deploy'].every(s => policy.required_at![id]!.includes(s as any))) throw new Error('mandatory_policy_invalid');
    for (const id of SECURITY_AREA_IDS) if (!policy.required_at[id].length || policy.required_at[id].some(s => !['commit', 'push', 'deploy'].includes(s))) throw new Error('policy_stage_invalid');
    const stdin = stage === 'push' ? (settings.stdin ?? await readSafeStdin()) : '';
    if (stage === 'deploy') {
      for (const [fileOption, digestOption] of [['--artifact', '--artifact-digest'], ['--configuration', '--configuration-digest']]) {
        const file = options.get(fileOption);
        if (!file || await digestFile(path.resolve(cwd, file), 1024 * 1024 * 1024) !== options.get(digestOption)) throw new Error('deployment_file_digest_mismatch');
      }
    }
    binding = collectSecurityBinding(cwd, stage, options, stdin);
    const evidenceText = await readSafe(path.resolve(cwd, options.get('--evidence') || config.evidence || '.yam/security/check.json'));
    input = JSON.parse(evidenceText);
    if (input.policy_digest !== pin) gateErrors.push('policy_digest_mismatch');
    if (input.stage !== normalizedStage) gateErrors.push('stage_mismatch');
    if (SECURITY_AREA_IDS.some(id => !input.areas?.some(area => area.id === id))) gateErrors.push('area_coverage_missing');
    if (input.areas?.some(area => ['SEC-01', 'SEC-08'].includes(area.id) && area.status === 'not_applicable')) gateErrors.push('mandatory_area_not_applicable');
    gateErrors.push(...await verifyReferencedEvidence(cwd, input));
    input = { ...input, retry_of: input.run_id, run_id: `security-${randomUUID()}`, time: new Date().toISOString() };
    result = validateSecurityCheck(input, binding as any, policy);
    if (result.errors.includes('record_contains_secret')) {
      input = createSecurityStarter({ stage: normalizedStage as any, binding: binding as any, environment: 'redacted', scope: ['unsafe supplied record rejected'], checker: 'yam-security-check' });
      result = validateSecurityCheck(input, binding as any);
      gateErrors.push('unsafe_security_record_rejected');
    }
    // Inspect the index/refs once more before persisting so mid-check changes cannot retain PASS.
    const fresh = collectSecurityBinding(cwd, stage, options, stdin);
    if (JSON.stringify(fresh) !== JSON.stringify(binding)) gateErrors.push('binding_changed_during_check');
    if (stage === 'deploy') {
      for (const [fileOption, digestOption] of [['--artifact', '--artifact-digest'], ['--configuration', '--configuration-digest']]) {
        if (await digestFile(path.resolve(cwd, options.get(fileOption)!), 1024 * 1024 * 1024) !== options.get(digestOption)) gateErrors.push('deployment_file_changed_during_check');
      }
    }
  } catch {
    input = createSecurityStarter({ stage: normalizedStage as any, binding: binding as any, environment: stage === 'deploy' ? options.get('--environment') || 'unavailable' : 'local', scope: ['security gate unavailable'], checker: 'yam-security-check' });
    result = validateSecurityCheck(input, binding as any);
    gateErrors.push('security_input_or_binding_unavailable');
  }
  if (gateErrors.length) {
    result.result = 'BLOCKED';
    result.errors = [...new Set([...result.errors, ...gateErrors])];
    result.blocking = [...new Set([...result.blocking, ...gateErrors.map(e => `integration:${e}`)])];
  }
  try {
    const persisted = await persistSecurityCheck(cwd, input, result, { notePath });
    return { ok: persisted.result.result === 'PASS', ...persisted, evidence_boundary: 'operator_supplied_not_automatic_security_scan' };
  } catch { return { ok: false, result: 'BLOCKED', errors: ['security_note_persistence_failed'], evidence_boundary: 'operator_supplied_not_automatic_security_scan' }; }
}
async function readSafeStdin(): Promise<string> {
  const text = readFileSync(0, 'utf8');
  if (text.length > 128 * 1024) throw new Error('push_ref_input_too_large');
  return text;
}

async function digestFile(file: string, limit: number): Promise<string> {
  await safeParents(file);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new Error('invalid digest target');
    const digest = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (position < info.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, info.size - position), position);
      if (!bytesRead) throw new Error('digest target changed during read');
      digest.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error('digest target changed during read');
    return `sha256:${digest.digest('hex')}`;
  } finally { await handle.close(); }
}
