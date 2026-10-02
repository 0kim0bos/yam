import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const MAX_BYTES = 256 * 1024;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** Select an upgrade-stable alias only when it resolves to the running Node binary. */
export async function selectHookNode(executable = process.execPath, searchPath = process.env.PATH || '') {
  const real = await fsp.realpath(executable);
  const running = await fsp.stat(real);
  const candidates = searchPath.split(path.delimiter).filter((dir) => path.isAbsolute(dir))
    .map((dir) => path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node'));
  for (const candidate of candidates) {
    try {
      const canonical = await fsp.realpath(candidate);
      const stat = await fsp.stat(canonical);
      await fsp.access(candidate, fs.constants.X_OK);
      if (stat.isFile() && stat.dev === running.dev && stat.ino === running.ino && canonical === real) {
        return { executable: candidate, canonical, selection: 'verified_runtime_alias', dev: stat.dev, ino: stat.ino };
      }
    } catch { /* An unverified PATH candidate is never executed. */ }
  }
  return { executable: real, canonical: real, selection: 'current_runtime_fallback', dev: running.dev, ino: running.ino };
}

export function summarizeHookDiscovery(value: unknown, cwd: string, commands: Record<string, string[]>, configPath?: string) {
  const input = value as { data?: Array<{ cwd?: string; hooks?: Array<Record<string, unknown>>; errors?: unknown[]; warnings?: unknown[] }> };
  if (!Array.isArray(input?.data)) return { state: 'unknown', reason: 'unsupported_response_schema', profiles: {} };
  const entry = input.data.find((row) => row.cwd === cwd);
  if (!entry || !Array.isArray(entry.hooks) || !Array.isArray(entry.errors) || !Array.isArray(entry.warnings)) {
    return { state: 'unknown', reason: 'missing_cwd_or_unsupported_response', profiles: {} };
  }
  const profiles = Object.fromEntries(Object.entries(commands).map(([profile, expected]) => {
    const matches = entry.hooks.filter((hook) => hook.handlerType === 'command' && expected.includes(String(hook.command))
      && (!configPath || hook.sourcePath === configPath));
    const approved = matches.filter((hook) => hook.enabled === true && ['trusted', 'managed'].includes(String(hook.trustStatus)));
    const expectedEvents = profile === 'study-note' ? ['userPromptSubmit', 'stop'] : ['userPromptSubmit'];
    return [profile, { state: matches.length ? 'discovered' : 'not_discovered', enabled_trusted: approved.length,
      eligible_event_coverage: expectedEvents.every((event) => approved.filter((hook) => hook.eventName === event).length === 1),
      discovered_count: matches.length, trust_statuses: [...new Set(matches.map((hook) => String(hook.trustStatus)))],
      execution_observed: false }];
  }));
  return { state: entry.errors.length ? 'partial' : 'queried', reason: entry.errors.length ? 'host_discovery_errors' : '',
    profiles, warning_count: entry.warnings.length, error_count: entry.errors.length };
}

/** Opt-in discovery in a new app-server process, not the active desktop session. */
export async function probeHookDiscovery(options: { executable: string; cwd: string; commands: Record<string, string[]>; configPath?: string; timeoutMs?: number }) {
  const timeoutMs = Math.min(Math.max(options.timeoutMs || 5000, 100), 10000);
  return new Promise<Record<string, unknown>>((resolve) => {
    let finished = false;
    let stopping = false;
    let failure = '';
    let result: Record<string, unknown>;
    let buffer = '';
    let total = 0;
    let timer: NodeJS.Timeout;
    let killTimer: NodeJS.Timeout;
    const child = spawn(options.executable, ['app-server'], { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const stop = (reason = '') => {
      if (stopping) return;
      stopping = true;
      failure = reason;
      child.stdin.end();
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 500);
    };
    const send = (value: unknown) => { if (!stopping) child.stdin.write(`${JSON.stringify(value)}\n`); };
    child.stdin.on('error', () => stop('protocol_stdin_failed'));
    child.on('error', () => { failure = 'host_unavailable'; });
    child.stderr.on('data', (chunk) => { total += chunk.length; if (total > MAX_BYTES) stop('output_limit'); });
    child.stdout.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) return stop('output_limit');
      buffer += chunk.toString('utf8');
      let index: number;
      while (!stopping && (index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let message;
        try { message = JSON.parse(line); } catch { stop('invalid_protocol_json'); break; }
        if (message.id === 0) {
          if (message.error) { stop('initialization_rejected'); break; }
          send({ method: 'initialized', params: {} });
          send({ method: 'hooks/list', id: 1, params: { cwds: [options.cwd] } });
        } else if (message.id === 1) {
          if (message.error) { stop('hooks_list_unsupported_or_rejected'); break; }
          result = summarizeHookDiscovery(message.result, options.cwd, options.commands, options.configPath);
          stop();
        } else if (message.id != null && message.method) {
          stop('unexpected_server_request');
        }
      }
    });
    child.on('close', (_code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(killTimer);
      resolve({ ...(result || { state: 'unknown', profiles: {} }), ...(failure ? { state: 'unknown', reason: failure } : {}),
        host_context: 'separate_app_server_probe', active_session_loaded: 'not_measured',
        execution_observed: false, process_exit_observed: true, termination_signal: signal || null,
        truth_status: 'partial', reason: failure || (result ? result.reason : 'host_exited_before_response') });
    });
    timer = setTimeout(() => stop('probe_timeout'), timeoutMs);
    send({ method: 'initialize', id: 0, params: { clientInfo: { name: 'yam_hook_probe', version: '1' }, capabilities: { experimentalApi: true } } });
  });
}

async function safeObservationDirectory(cwd: string, create: boolean) {
  const root = await fsp.realpath(cwd);
  let current = root;
  const identities: Array<{ target: string; dev: number; ino: number }> = [];
  for (const part of ['', '.yam', 'hooks']) {
    if (part) current = path.join(current, part);
    if (create && part) await fsp.mkdir(current, { mode: 0o700 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fsp.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe_observation_directory');
    identities.push({ target: current, dev: stat.dev, ino: stat.ino });
  }
  return { directory: current, identities };
}

async function checkParents(identities: Array<{ target: string; dev: number; ino: number }>) {
  for (const identity of identities) {
    const stat = await fsp.lstat(identity.target);
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev !== identity.dev || stat.ino !== identity.ino) throw new Error('observation_parent_changed');
  }
}

async function configurationDigest(cwd: string) {
  const paths = [path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'hooks.json'), path.join(await fsp.realpath(cwd), '.codex', 'hooks.json')];
  const values = [];
  for (const target of paths) {
    try {
      const before = await fsp.lstat(target);
      if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_BYTES) throw new Error('unsafe_hook_configuration');
      const handle = await fsp.open(target, fs.constants.O_RDONLY | (process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW || 0));
      try {
        const stat = await handle.stat();
        if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size > MAX_BYTES) throw new Error('hook_configuration_changed');
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_BYTES) throw new Error('hook_configuration_limit');
        values.push(sha(buffer.subarray(0, bytesRead).toString('utf8')));
      } finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      values.push('absent');
    }
  }
  return sha(JSON.stringify(values));
}

export async function recordHookObservation(cwd: string, profile: string, event: string, entrypoint: string) {
  if (!['lite', 'study-note'].includes(profile) || !['UserPromptSubmit', 'Stop'].includes(event)) throw new Error('unsupported_observation');
  const { directory, identities } = await safeObservationDirectory(cwd, true);
  const value = { schema: 'yam.hook-observation.v1', profile, event, observed_at: new Date().toISOString(),
    cwd_digest: sha(await fsp.realpath(cwd)), entrypoint_digest: sha(await fsp.readFile(entrypoint, 'utf8')),
    configuration_digest: await configurationDigest(cwd),
    host_authenticated: false, evidence_kind: 'local_entrypoint_invocation' };
  const target = path.join(directory, `${profile}.json`);
  const noFollow = process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW || 0;
  const before = await fsp.lstat(target).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
  if (before && (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)) throw new Error('unsafe_observation_file');
  const handle = await fsp.open(target, fs.constants.O_WRONLY | noFollow | (before ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL), 0o600);
  try {
    const stat = await handle.stat();
    const pathname = await fsp.lstat(target);
    if (!stat.isFile() || stat.nlink !== 1 || pathname.isSymbolicLink() || pathname.dev !== stat.dev || pathname.ino !== stat.ino
      || (before && (before.dev !== stat.dev || before.ino !== stat.ino))) throw new Error('unsafe_observation_file');
    await checkParents(identities);
    await handle.chmod(0o600);
    await handle.truncate(0);
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await checkParents(identities);
    const after = await fsp.lstat(target);
    if (after.isSymbolicLink() || after.dev !== stat.dev || after.ino !== stat.ino) throw new Error('observation_identity_changed');
  } finally { await handle.close(); }
}

export async function inspectHookObservation(cwd: string, profile: string, entrypoint: string) {
  try {
    if (!['lite', 'study-note'].includes(profile)) throw new Error('unsupported_profile');
    const { directory, identities } = await safeObservationDirectory(cwd, false);
    const target = path.join(directory, `${profile}.json`);
    const before = await fsp.lstat(target);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 4096 || before.nlink !== 1) throw new Error('unsafe_observation_file');
    const handle = await fsp.open(target, fs.constants.O_RDONLY | (process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW || 0));
    let value;
    try {
      const stat = await handle.stat();
      if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size > 4096) throw new Error('observation_identity_changed');
      const data = Buffer.alloc(4097); const { bytesRead } = await handle.read(data, 0, data.length, 0);
      if (bytesRead > 4096) throw new Error('observation_limit');
      value = JSON.parse(data.subarray(0, bytesRead).toString('utf8'));
      await checkParents(identities);
    } finally { await handle.close(); }
    const age = Date.now() - Date.parse(value.observed_at);
    if (value.schema !== 'yam.hook-observation.v1' || value.profile !== profile || !['UserPromptSubmit', 'Stop'].includes(value.event)
      || value.host_authenticated !== false || value.evidence_kind !== 'local_entrypoint_invocation'
      || !Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000
      || value.cwd_digest !== sha(await fsp.realpath(cwd)) || value.configuration_digest !== await configurationDigest(cwd)
      || value.entrypoint_digest !== sha(await fsp.readFile(entrypoint, 'utf8'))) {
      return { state: 'unknown', reason: 'stale_or_mismatched_observation', truth_status: 'partial', host_authenticated: false };
    }
    return { state: 'entrypoint_observed', observed_at: value.observed_at, event: value.event,
      host_authenticated: false, truth_status: 'partial', reason: 'local_same_user_evidence_not_host_attestation' };
  } catch (error) {
    return { state: 'not_observed', reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no_observation' : 'observation_unreadable_or_unsafe',
      host_authenticated: false, truth_status: 'partial' };
  }
}
