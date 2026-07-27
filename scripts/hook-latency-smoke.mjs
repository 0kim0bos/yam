#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const smokeBudgetMs = 3_500;
const expectedBin = 'dist/bin/yam.js';
const bin = join(root, expectedBin);

assert(packageJson.bin?.yam === expectedBin, `package bin should point to ${expectedBin}`);
assert(existsSync(bin), `built package CLI missing: ${bin}; run npm run build first`);

const sandbox = mkdtempSync(join(tmpdir(), 'yam-hook-latency-'));
const isolatedHome = join(sandbox, 'home');
const hookConfigProject = join(sandbox, 'hook-config');
mkdirSync(isolatedHome);
mkdirSync(hookConfigProject);

const env = {
  ...process.env,
  HOME: isolatedHome,
  USERPROFILE: isolatedHome,
  XDG_CONFIG_HOME: join(isolatedHome, '.config'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_OPTIONAL_LOCKS: '0',
};

const cases = [
  { name: 'scope-empty', changed: 0 },
  { name: 'single-file', changed: 1 },
  { name: 'many-files', changed: 12 },
];
const measurements = [];
let configuredHookTimeoutMs = 0;

try {
  configuredHookTimeoutMs = readConfiguredHookTimeoutMs();
  assert(configuredHookTimeoutMs === 5_000, 'study-note handlers should retain the configured 5s timeout');
  assert(smokeBudgetMs < configuredHookTimeoutMs, 'smoke budget must remain below the configured hook timeout');
  for (const fixture of cases) measurements.push(runFixture(fixture));
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

assert(!existsSync(sandbox), 'temporary hook latency fixtures should be removed');
console.log(`hook-latency-smoke: ok (per-run budget ${smokeBudgetMs}ms < configured timeout ${configuredHookTimeoutMs}ms)`);
for (const measurement of measurements) {
  console.log(
    `- ${measurement.name}: lite ${measurement.liteMs.toFixed(1)}ms, `
    + `study-note prompt ${measurement.studyNotePromptMs.toFixed(1)}ms, `
    + `study-note Stop ${measurement.studyNoteStopMs.toFixed(1)}ms, `
    + `${measurement.changed} changed file(s)`,
  );
}
console.log('- cleanup: temporary repositories and isolated config home removed');

function runFixture({ name, changed }) {
  const project = join(sandbox, name);
  mkdirSync(project);
  git(project, ['init', '-q']);

  const files = Array.from(
    { length: Math.max(changed, 1) },
    (_, index) => changed > 1 ? `changed-${String(index + 1).padStart(2, '0')}.txt` : 'tracked.txt',
  );
  for (const file of files) writeFileSync(join(project, file), `baseline:${file}\n`);
  git(project, ['add', '.']);
  git(project, ['-c', 'user.name=yam-smoke', '-c', 'user.email=yam-smoke@example.com', 'commit', '-qm', 'baseline']);

  for (const file of files.slice(0, changed)) writeFileSync(join(project, file), `changed:${file}\n`);
  const expectedChanged = files.slice(0, changed);
  assertGitScope(project, expectedChanged);

  const lite = invokeHook(project, name, 'lite-prompt', 'lite', {
    cwd: project,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'explain this local change',
  });
  assert(lite.output.continue === true, `${name} lite hook should continue`);
  assert(lite.output.hookSpecificOutput?.hookEventName === 'UserPromptSubmit', `${name} lite hook event missing`);
  assert(
    String(lite.output.hookSpecificOutput?.additionalContext || '').includes('yam-lite guide active'),
    `${name} lite advisory context missing`,
  );

  const studyNotePrompt = invokeHook(project, name, 'study-note-prompt', 'study-note', {
    cwd: project,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'verify Study Note hook context',
  });
  assert(studyNotePrompt.output.continue === true, `${name} Study Note prompt hook should continue`);
  assert(
    studyNotePrompt.output.hookSpecificOutput?.hookEventName === 'UserPromptSubmit',
    `${name} Study Note prompt event missing`,
  );
  assertStudyNoteScope(
    String(studyNotePrompt.output.hookSpecificOutput?.additionalContext || ''),
    name,
    expectedChanged,
  );

  const studyNoteStop = invokeHook(project, name, 'study-note-stop', 'study-note', {
    cwd: project,
    hook_event_name: 'Stop',
    stop_hook_active: true,
    last_assistant_message: 'Done.',
  });
  assert(studyNoteStop.output.continue === true, `${name} re-entered Stop hook should continue`);
  assert(!studyNoteStop.output.decision, `${name} re-entered Stop hook should not request another correction`);
  if (changed === 0) {
    assert(!studyNoteStop.output.systemMessage, 'scope-empty Stop hook should pass without a warning');
  } else {
    assert(
      String(studyNoteStop.output.systemMessage || '').includes('remains blocked after one correction pass'),
      `${name} re-entered Stop hook should retain a bounded warning`,
    );
  }

  assertGitScope(project, expectedChanged);
  return {
    name,
    changed,
    liteMs: lite.durationMs,
    studyNotePromptMs: studyNotePrompt.durationMs,
    studyNoteStopMs: studyNoteStop.durationMs,
  };
}

function invokeHook(project, fixtureName, pathName, profile, input) {
  const before = snapshotState(project);
  const startedAt = performance.now();
  const raw = execFileSync(process.execPath, [bin, 'hook', 'run', profile], {
    cwd: project,
    encoding: 'utf8',
    env,
    input: JSON.stringify(input),
    maxBuffer: 1024 * 1024,
    timeout: configuredHookTimeoutMs,
  });
  const durationMs = performance.now() - startedAt;
  const after = snapshotState(project);

  assert(after === before, `${fixtureName} ${pathName} mutated the workspace, Git metadata, or isolated config`);
  assert(
    durationMs < smokeBudgetMs,
    `${fixtureName} ${pathName} took ${durationMs.toFixed(1)}ms; budget is ${smokeBudgetMs}ms`,
  );

  let output;
  try {
    output = JSON.parse(raw);
  } catch {
    throw new Error(`${fixtureName} ${pathName} did not return valid JSON`);
  }
  return { output, durationMs };
}

function assertStudyNoteScope(context, fixtureName, expectedChanged) {
  assert(context.includes('yam Study Note guard active'), `${fixtureName} Study Note guard context missing`);
  if (expectedChanged.length === 0) {
    assert(context.includes('No changed files were detected at prompt time'), 'scope-empty context should report no changed files');
    assert(!context.includes('Changed files detected ('), 'scope-empty context should not claim changed files');
    return;
  }

  const shown = Math.min(expectedChanged.length, 8);
  assert(
    context.includes(`Changed files detected (${shown} shown): ${expectedChanged.slice(0, shown).join(', ')}`),
    `${fixtureName} context should report the expected changed-file scope`,
  );
  for (const file of expectedChanged.slice(0, shown)) {
    assert(context.includes(file), `${fixtureName} context missing ${file}`);
  }
  for (const file of expectedChanged.slice(shown)) {
    assert(!context.includes(file), `${fixtureName} context should cap the changed-file list at eight entries`);
  }
}

function assertGitScope(project, expected) {
  const actual = git(project, ['status', '--short'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.replace(/^..\s+/, '').trim());
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `fixture scope mismatch: expected ${expected.join(', ') || '(clean)'}, got ${actual.join(', ') || '(clean)'}`,
  );
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env });
}

function snapshotState(project) {
  return [
    snapshotTree(project),
    '--- isolated home ---',
    snapshotTree(isolatedHome),
    '--- generated hook config ---',
    snapshotTree(hookConfigProject),
  ].join('\n');
}

function readConfiguredHookTimeoutMs() {
  execFileSync(process.execPath, [bin, 'hook', 'enable', 'study-note', '--project', hookConfigProject], {
    cwd: hookConfigProject,
    env,
    stdio: 'ignore',
  });
  const config = JSON.parse(readFileSync(join(hookConfigProject, '.codex', 'hooks.json'), 'utf8'));
  const handlers = ['UserPromptSubmit', 'Stop'].flatMap((event) => (
    (config[event] || []).flatMap((entry) => (
      (entry.hooks || []).filter((handler) => String(handler.command || '').includes('hook run study-note'))
    ))
  ));
  assert(handlers.length === 2, 'study-note profile should configure prompt and Stop handlers');
  assert(
    handlers.every((handler) => handler.timeout === handlers[0].timeout),
    'study-note handlers should use one consistent timeout',
  );
  return Number(handlers[0].timeout) * 1_000;
}

function snapshotTree(base) {
  const rows = [];
  const visit = (current) => {
    const stat = lstatSync(current, { bigint: true });
    const name = relative(base, current) || '.';
    const kind = stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file';
    rows.push([
      name,
      kind,
      stat.mode.toString(),
      stat.size.toString(),
      stat.mtimeNs.toString(),
    ].join('\t'));
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current).sort()) visit(join(current, entry));
    } else if (stat.isSymbolicLink()) {
      rows.push(`target\t${readlinkSync(current)}`);
    } else {
      rows.push(`sha256\t${createHash('sha256').update(readFileSync(current)).digest('hex')}`);
    }
  };
  visit(base);
  return rows.join('\n');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
