#!/usr/bin/env node
// Explicit isolated live check; never part of install, publish, hooks or CI defaults.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyExternalUpdates } from '../dist/lib/external-updates.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const PRIMARY_HASH = 'c9eb0ef22a05e00e19827a179544fea2bc91b663585f637d428453d3b00ceb17';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function requireContent(result, text) { assert.ok(result.ok && text.includes('Example Domain'), 'extraction must return expected content'); }
function childOf(root, target) { assert.ok(path.resolve(target).startsWith(path.resolve(root) + path.sep), 'scratch path escape'); }
function wheelEntry(name, bytes) {
  assert.match(name, /^[A-Za-z0-9_.+!-]+\.whl$/);
  const parts = name.split('-');
  assert.ok(parts.length >= 5);
  return { name: parts[0].replaceAll('_', '-').toLowerCase(), version: parts[1], filename: name, sha256: hash(bytes) };
}
function verifyPrimary(inventory, version, expected) {
  assert.equal(inventory.find(x => x.name === 'scrapling' && x.version === version)?.sha256, expected, 'primary wheel digest mismatch');
}
if (process.argv.includes('--self-test')) {
  assert.throws(() => requireContent({ ok: true }, ''));
  assert.throws(() => childOf('/tmp/owned', '/tmp/other'));
  assert.equal(wheelEntry('scrapling-0.5.1-py3-none-any.whl', Buffer.from('x')).version, '0.5.1');
  assert.throws(() => verifyPrimary([{ name: 'scrapling', version: '0.5.1', sha256: '0'.repeat(64) }], '0.5.1', PRIMARY_HASH));
  console.log('scrapling compatibility guard self-test: passed');
  process.exit(0);
}
if (process.argv.length !== 3 || process.argv[2] !== '--run') {
  console.error('Usage: node scripts/scrapling-compatibility-live.mjs --self-test | --run (explicit isolated downloads/runtime only)');
  process.exit(2);
}
const runId = new Date().toISOString().replace(/[^0-9]/g, '') + '-' + randomUUID().slice(0, 8);
const output = path.join(project, '.yam', 'mission', 'scrapling-' + runId + '.json');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'yam-scrapling-051-')));
const identity = await fs.lstat(root);
const report = { schema: 'yam.scrapling-compatibility.v1', run_id: runId, started_at: new Date().toISOString(), scratch_root: root, candidate: '0.5.1', release_commit: '3a4bb5b0a008233c85269a0a38a6d08edd4ce329', platform: process.platform + '/' + process.arch, checks: [], processes: [], wheelhouses: [], global_mutation: false, evidence_basis: 'real_runtime_with_local_and_injected_fixtures', success: false, truth_status: 'partial', browser_provenance: { independently_authenticated: false, note: 'Observed installer version and executable digest are recorded; Python hashes do not authenticate the browser binary.' }, network_sandbox: 'not_enforced', global_promotion_authorized: false };
const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: path.join(root, 'home'), TMPDIR: root, TMP: root, TEMP: root, XDG_CACHE_HOME: path.join(root, 'cache'), PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'browsers'), PYTHONDONTWRITEBYTECODE: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1', PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: '30000' };
const active = new Set();
let http, stage = 'preflight';
async function command(id, executable, args, timeout = 180000) {
  console.log(JSON.stringify({ stage: id, state: 'running' }));
  return await new Promise(resolve => {
    const child = spawn(executable, args, { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const entry = { id, pid: child.pid || null, started_at: new Date().toISOString(), exited: false };
    report.processes.push(entry); active.add(child);
    let stdout = '', stderr = '', timed = false, overflow = false;
    let hardTimer;
    const terminate = () => {
      if (hardTimer) return;
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      hardTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 15000);
    };
    const timer = setTimeout(() => { timed = true; terminate(); }, timeout);
    child.stdout.on('data', b => { if (stdout.length + b.length > 2097152) { overflow = true; terminate(); } else stdout += b; });
    child.stderr.on('data', b => { if (stderr.length + b.length > 2097152) { overflow = true; terminate(); } else stderr += b; });
    let settled = false;
    const finish = (code, signal) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(hardTimer); active.delete(child);
      Object.assign(entry, { exited: true, exit_code: code, signal: signal || null, timed_out: timed, output_limit: overflow, stopped_at: new Date().toISOString() });
      resolve({ ok: code === 0 && !timed && !overflow, status: code, stdout, stderr });
    };
    child.on('error', () => finish(null, 'spawn_error'));
    child.on('close', finish);
  });
}
async function required(id, exe, args, timeout) {
  stage = id;
  const r = await command(id, exe, args, timeout);
  report.checks.push({ id, passed: r.ok });
  if (!r.ok) {
    const kind = /CERTIFICATE_VERIFY_FAILED|certificate verify failed/i.test(r.stderr) ? 'certificate' : /No matching distribution|Could not find a version/i.test(r.stderr) ? 'missing_binary_dependency' : 'command_failed';
    report.failure_kind = kind;
    console.error(JSON.stringify({ stage: id, failure_kind: kind, diagnostic: r.stderr.slice(-1800) }));
    throw new Error(id);
  }
  return r;
}
async function snapshot(globalBin) {
  const link = await fs.lstat(globalBin), target = await fs.realpath(globalBin), stat = await fs.stat(target);
  const r = await command('global_readonly_version', globalBin, ['--version'], 30000);
  assert.ok(r.ok); assert.match(r.stdout, /0\.4\.15\b/);
  return { executable: globalBin, target, link_dev: link.dev, link_ino: link.ino, target_dev: stat.dev, target_ino: stat.ino, sha256: hash(await fs.readFile(target)), version: '0.4.15' };
}
async function jsonGet(url, id) {
  assert.match(url, /^https:\/\/pypi\.org\/pypi\/scrapling\/0\.(?:4\.15|5\.1)\/json$/);
  const r = await required(id, '/usr/bin/curl', ['-q', '--fail', '--silent', '--show-error', '--connect-timeout', '5', '--max-time', '30', '--max-filesize', '2097152', url], 35000);
  return JSON.parse(r.stdout);
}
async function wheelhouse(version, python) {
  const metadata = await jsonGet('https://pypi.org/pypi/scrapling/' + version + '/json', 'metadata_' + version);
  assert.equal(metadata.info.version, version);
  const primary = metadata.urls.find(x => x.filename === `scrapling-${version}-py3-none-any.whl` && !x.yanked);
  assert.ok(primary); if (version === '0.5.1') assert.equal(primary.digests.sha256, PRIMARY_HASH);
  const dir = path.join(root, 'wheels-' + version); await fs.mkdir(dir);
  await required('resolve_binary_wheels_' + version, python, ['-m', 'pip', 'download', '--isolated', '--index-url', 'https://pypi.org/simple', '--only-binary=:all:', '--no-cache-dir', '--dest', dir, `scrapling[fetchers]==${version}`], 600000);
  const inventory = [];
  for (const name of (await fs.readdir(dir)).sort()) inventory.push(wheelEntry(name, await fs.readFile(path.join(dir, name))));
  verifyPrimary(inventory, version, primary.digests.sha256);
  assert.equal(new Set(inventory.map(x => x.name)).size, inventory.length, 'ambiguous wheelhouse');
  const lock = inventory.map(x => `${x.name}${x.name === 'scrapling' ? '[fetchers]' : ''}==${x.version} --hash=sha256:${x.sha256}`).join('\n') + '\n';
  const lockPath = path.join(root, 'requirements-' + version + '.txt'); await fs.writeFile(lockPath, lock, { flag: 'wx', mode: 0o600 });
  report.wheelhouses.push({ version, packages: inventory, lock_sha256: hash(lock), coverage: 'all_resolved_python_wheels_for_this_matrix', trust_limit: 'Run-local hashes over artifacts resolved from official PyPI; not a signed or pre-reviewed cross-platform lock.' });
  return { dir, lockPath, metadata };
}
async function install(id, python, wheels) {
  return await required(id, python, ['-m', 'pip', 'install', '--isolated', '--no-index', '--find-links', wheels.dir, '--only-binary=:all:', '--require-hashes', '-r', wheels.lockPath], 300000);
}
async function portClosed(port) {
  return await new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.on('connect', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}
let globalBin;
try {
  await fs.mkdir(env.HOME); await fs.mkdir(path.dirname(output), { recursive: true });
  report.source_digests = {};
  for (const name of ['scrapling-compatibility-live.mjs', 'scrapling-remote-smoke.py']) report.source_digests[name] = hash(await fs.readFile(path.join(project, 'scripts', name)));
  // Use the same explicit runtime selected in the approved matrix, not /usr/bin/python3.
  const python = path.join(os.homedir(), '.homebrew', 'bin', 'python3');
  globalBin = path.join(os.homedir(), '.homebrew', 'bin', 'scrapling');
  report.global_before = await snapshot(globalBin);
  const py = await required('python_matrix_ca', python, ['-c', 'import sys,ssl,json,platform; c=ssl.create_default_context(); print(json.dumps({"version":platform.python_version(),"machine":platform.machine(),"ca_count":len(c.get_ca_certs()),"verify":c.verify_mode==ssl.CERT_REQUIRED,"hostname":c.check_hostname})); assert sys.version_info[:2]==(3,14); assert c.get_ca_certs(); assert c.check_hostname']);
  report.python = JSON.parse(py.stdout.trim());
  const bootstrap = path.join(root, 'bootstrap');
  await required('bootstrap_venv', python, ['-m', 'venv', bootstrap]);
  const bootstrapPython = path.join(bootstrap, 'bin', 'python');
  const fresh = await wheelhouse('0.5.1', bootstrapPython);
  const old = await wheelhouse('0.4.15', bootstrapPython);
  const candidate = path.join(root, 'candidate'), oldEnv = path.join(root, 'environments', '0.4.15');
  for (const [label, target, wheels] of [['candidate', candidate, fresh], ['old', oldEnv, old]]) {
    await required(label + '_venv', python, ['-m', 'venv', target]);
    await install(label + '_locked_offline_install', path.join(target, 'bin', 'python'), wheels);
  }
  const candidatePython = path.join(candidate, 'bin', 'python');
  const bin = path.join(candidate, 'bin', 'scrapling');
  assert.match((await required('candidate_version', bin, ['--version'])).stdout, /0\.5\.1\b/);
  await required('candidate_pip_check', candidatePython, ['-m', 'pip', 'check']);
  await required('candidate_fetch_help', bin, ['extract', 'fetch', '--help']);
  await required('private_browser_install', candidatePython, ['-m', 'patchright', 'install', 'chromium'], 600000);
  const browserInfo = await required('browser_identity', candidatePython, ['-c', 'from patchright.sync_api import sync_playwright; import json; p=sync_playwright().start(); print(json.dumps({"executable":p.chromium.executable_path})); p.stop()']);
  const browser = JSON.parse(browserInfo.stdout.trim()).executable; childOf(root, browser);
  report.browser_provenance.executable_sha256 = hash(await fs.readFile(browser));
  report.browser_provenance.patchright = report.wheelhouses[0].packages.find(x => x.name === 'patchright')?.version;
  http = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><title>Example Domain</title></head><body>local test</body></html>'); });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  report.http_port = http.address().port;
  const url = 'http://127.0.0.1:' + report.http_port;
  for (const mode of ['get', 'fetch']) {
    const out = path.join(root, mode + '.txt');
    const args = ['extract', mode, url, out, '--css-selector', 'title', '--timeout', mode === 'fetch' ? '30000' : '30']; if (mode === 'fetch') args.push('--headless');
    const r = await required('real_cli_' + mode, bin, args, 120000); requireContent(r, await fs.readFile(out, 'utf8'));
  }
  assert.throws(() => requireContent({ ok: true }, '')); report.checks.push({ id: 'zero_exit_empty_content_rejected', passed: true, basis: 'fixture_only' });
  stage = 'remote_lifecycle';
  report.remote_started = true;
  const remote = await command('remote_lifecycle', candidatePython, [path.join(project, 'scripts', 'scrapling-remote-smoke.py'), '--browser', browser, '--root', root], 210000);
  try { report.remote = JSON.parse(remote.stdout.trim()); } catch { throw new Error('remote_result_unavailable'); }
  report.checks.push({ id: 'remote_lifecycle', passed: remote.ok && report.remote.success === true });
  assert.ok(remote.ok && report.remote.success === true);
  const privateBin = path.join(root, 'bin', 'scrapling'), oldBin = path.join(oldEnv, 'bin', 'scrapling');
  await fs.mkdir(path.dirname(privateBin)); await fs.symlink(oldBin, privateBin);
  await fs.writeFile(path.join(oldEnv, '.yam-scrapling-install.json'), JSON.stringify({ schema: 'yam.scrapling-install.v1', version: '0.4.15', executable: oldBin }));
  const oldHash = hash(await fs.readFile(oldBin));
  const updaterRun = async (exe, args) => {
    childOf(root, exe); // Never honor resolveDependencies' merged environment.
    if (args[0] === '-m' && args[1] === 'venv') { childOf(root, args[2]); return command('updater_create_venv', python, args); }
    if (args[0] === '-m' && args[1] === 'pip' && args[2] === 'install') return install('updater_locked_offline_install', exe, fresh);
    if (args[0] === 'install') return { ok: true, status: 0, stdout: 'private browser preinstalled by harness', stderr: '' };
    const mapped = args.map(x => x === 'https://example.com' ? url : x);
    return command('updater_' + path.basename(exe) + '_' + String(args[0]), exe, mapped, 180000);
  };
  const failPath = path.join(root, 'receipt-is-file'); await fs.writeFile(failPath, 'forced write failure');
  report.updater_scenarios = [];
  for (const scenario of ['receipt_failure_rollback', 'success']) {
    stage = 'updater_' + scenario;
    const state = path.join(root, 'state-' + scenario);
    const result = await applyExternalUpdates('2.8.12', { component: 'scrapling' }, { homeDir: env.HOME, env: { YAM_SCRAPLING_PYTHON: path.join(bootstrap, 'bin', 'python') }, run: updaterRun, fetchJson: async u => { assert.equal(u, 'https://pypi.org/pypi/scrapling/json'); return fresh.metadata; }, paths: { stateDir: state, receiptDir: scenario === 'success' ? path.join(state, 'receipts') : failPath, lockFile: path.join(state, 'update.lock'), scraplingRoot: path.join(root, 'environments'), scraplingBin: privateBin } });
    const receipt = result.receipts[0];
    report.updater_scenarios.push({ scenario, success: result.success, persistence: receipt.persistence, automatic_rollback: receipt.rollback_hint.automatic, lock_released: result.lock.released, checks: receipt.checks.map(c => ({ id: c.id, status: c.status })), basis: 'fixture_instrumented_real', substitutions: ['offline hash-locked pip', 'private browser preinstall', 'loopback extraction URL', 'exact metadata'] });
    assert.equal(hash(await fs.readFile(oldBin)), oldHash); assert.equal(result.lock.released, true);
    if (scenario === 'receipt_failure_rollback') { assert.equal(result.success, false); assert.equal(receipt.persistence, 'failed'); assert.equal(receipt.rollback_hint.automatic, true); assert.equal(await fs.realpath(privateBin), await fs.realpath(oldBin)); assert.match((await required('rollback_actual_version', privateBin, ['--version'])).stdout, /0\.4\.15\b/); }
    else { assert.equal(result.success, true); assert.match((await required('switched_actual_version', privateBin, ['--version'])).stdout, /0\.5\.1\b/); }
  }
  report.success = true;
} catch (error) {
  report.failure_stage = stage; report.error = error instanceof assert.AssertionError ? 'assertion_failed:' + error.message.slice(0, 500) : String(error.message).slice(0, 300);
  process.exitCode = 1;
} finally {
  if (http) await new Promise(resolve => http.close(resolve));
  report.http_closed = !http?.listening;
  report.http_port_closed = !report.http_port || await portClosed(report.http_port);
  await Promise.all([...active].map(child => new Promise(resolve => {
    child.once('close', resolve);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { resolve(); }
  })));
  report.all_direct_children_exited = active.size === 0 && report.processes.every(x => x.exited);
  if (globalBin && report.global_before) {
    try { report.global_after = await snapshot(globalBin); report.global_unchanged = JSON.stringify(report.global_before) === JSON.stringify(report.global_after); } catch { report.global_unchanged = false; }
  }
  const same = await fs.lstat(root).then(s => s.dev === identity.dev && s.ino === identity.ino && s.isDirectory() && !s.isSymbolicLink()).catch(() => false);
  report.scratch_removed = false;
  const remoteClean = !report.remote_started || report.remote?.cleanup?.observed === true;
  if (same && report.all_direct_children_exited && remoteClean && report.http_port_closed) { await fs.rm(root, { recursive: true }); report.scratch_removed = await fs.lstat(root).then(() => false, e => e.code === 'ENOENT'); }
  if (!report.global_unchanged || !report.all_direct_children_exited || !report.scratch_removed || !report.http_closed || !report.http_port_closed || !remoteClean) report.success = false;
  report.finished_at = new Date().toISOString(); report.truth_status = report.success ? 'verified' : 'blocked';
  report.digest = hash(JSON.stringify(report));
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ receipt: output, success: report.success, failure_stage: report.failure_stage, error: report.error, cleanup: report.scratch_removed, global_unchanged: report.global_unchanged }));
  if (!report.success) process.exitCode = 1;
}
