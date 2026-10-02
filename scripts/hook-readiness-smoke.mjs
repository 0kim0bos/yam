import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.YAM_HOOK_TEST_MODULE || new URL('../dist/lib/hook-readiness.js', import.meta.url).pathname;
const { selectHookNode, summarizeHookDiscovery, probeHookDiscovery, recordHookObservation, inspectHookObservation } = await import(pathToFileURL(modulePath));
const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'yam-hook-readiness-'));
const oldHome = process.env.CODEX_HOME;
try {
  process.env.CODEX_HOME = path.join(root, 'codex-home');
  await fsp.mkdir(process.env.CODEX_HOME);
  const aliasDir = path.join(root, 'alias'); await fsp.mkdir(aliasDir);
  await fsp.symlink(process.execPath, path.join(aliasDir, 'node'));
  const selected = await selectHookNode(process.execPath, aliasDir);
  assert.equal(selected.selection, 'verified_runtime_alias');
  assert.equal(selected.executable, path.join(aliasDir, 'node'));
  const unrelated = path.join(root, 'unrelated'); await fsp.mkdir(unrelated);
  await fsp.writeFile(path.join(unrelated, 'node'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  assert.equal((await selectHookNode(process.execPath, unrelated)).selection, 'current_runtime_fallback');
  const commands = { lite: ['node yam.js hook run lite'], 'study-note': ['node yam.js hook run study-note'] };
  const sourcePath = path.join(root, '.codex', 'hooks.json');
  const row = { cwd: root, hooks: [{ handlerType: 'command', command: commands.lite[0], sourcePath, enabled: true,
    trustStatus: 'trusted', eventName: 'userPromptSubmit' }], errors: [], warnings: [] };
  const summary = summarizeHookDiscovery({ data: [row] }, root, commands, sourcePath);
  assert.equal(summary.profiles.lite.state, 'discovered');
  assert.equal(summary.profiles.lite.eligible_event_coverage, true);
  assert.equal(summary.profiles.lite.execution_observed, false);
  assert.equal(summarizeHookDiscovery({ data: [row] }, root, commands, 'other').profiles.lite.state, 'not_discovered');
  row.hooks[0].trustStatus = 'modified';
  assert.equal(summarizeHookDiscovery({ data: [row] }, root, commands, sourcePath).profiles.lite.eligible_event_coverage, false);
  assert.equal(summarizeHookDiscovery({}, root, commands).state, 'unknown');

  const entrypoint = path.join(root, 'yam.js'); await fsp.writeFile(entrypoint, 'fixture');
  assert.equal((await inspectHookObservation(root, 'lite', entrypoint)).state, 'not_observed');
  await recordHookObservation(root, 'lite', 'UserPromptSubmit', entrypoint);
  let observed = await inspectHookObservation(root, 'lite', entrypoint);
  assert.equal(observed.state, 'entrypoint_observed'); assert.equal(observed.host_authenticated, false);
  const observation = path.join(root, '.yam', 'hooks', 'lite.json');
  const text = await fsp.readFile(observation, 'utf8');
  assert(!text.includes(root)); assert(!text.includes('prompt'));
  assert.equal((await fsp.stat(observation)).mode & 0o777, 0o600);
  await fsp.writeFile(path.join(process.env.CODEX_HOME, 'hooks.json'), '{}');
  assert.equal((await inspectHookObservation(root, 'lite', entrypoint)).state, 'unknown');
  await recordHookObservation(root, 'lite', 'UserPromptSubmit', entrypoint);
  await fsp.writeFile(entrypoint, 'changed');
  assert.equal((await inspectHookObservation(root, 'lite', entrypoint)).state, 'unknown');
  await fsp.rm(observation);
  const protectedFile = path.join(root, 'protected'); await fsp.writeFile(protectedFile, 'preserve');
  await fsp.symlink(protectedFile, observation);
  await assert.rejects(recordHookObservation(root, 'lite', 'UserPromptSubmit', entrypoint));
  assert.equal(await fsp.readFile(protectedFile, 'utf8'), 'preserve');
  await fsp.rm(observation);
  await fsp.rm(path.join(root, '.yam', 'hooks'), { recursive: true });
  await fsp.symlink(unrelated, path.join(root, '.yam', 'hooks'));
  await assert.rejects(recordHookObservation(root, 'lite', 'UserPromptSubmit', entrypoint));

  const fake = path.join(root, 'codex-fixture');
  await fsp.writeFile(fake, `#!${process.execPath}\nimport('node:readline').then(({createInterface})=>{createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line); if(m.id===0) console.log(JSON.stringify({id:0,result:{}})); else if(m.method==='hooks/list') console.log(JSON.stringify({id:1,result:${JSON.stringify({ data: [row] })}})); else if(m.method!=='initialized') process.exit(98);});});\n`, { mode: 0o755 });
  const probe = await probeHookDiscovery({ executable: fake, cwd: root, commands, configPath: sourcePath });
  assert.equal(probe.state, 'queried'); assert.equal(probe.active_session_loaded, 'not_measured');
  assert.equal(probe.process_exit_observed, true); assert.equal(probe.execution_observed, false);
  assert.equal(probe.reason, '');
  const unavailable = await probeHookDiscovery({ executable: path.join(root, 'absent'), cwd: root, commands });
  assert.equal(unavailable.state, 'unknown'); assert.equal(unavailable.reason, 'host_unavailable');
  const stall = path.join(root, 'stall'); await fsp.writeFile(stall, `#!${process.execPath}\nsetInterval(()=>{},1000);\n`, { mode: 0o755 });
  const timeout = await probeHookDiscovery({ executable: stall, cwd: root, commands, timeoutMs: 100 });
  assert.equal(timeout.reason, 'probe_timeout'); assert.equal(timeout.process_exit_observed, true);
  console.log('hook-readiness-smoke: ok (identity, discovery/trust, bounded probe exit, private observation, drift, symlink refusal)');
} finally {
  if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome;
  await fsp.rm(root, { recursive: true, force: true });
}
