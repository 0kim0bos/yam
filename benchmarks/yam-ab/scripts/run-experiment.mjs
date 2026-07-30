#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeReceipts } from './aggregate-results.mjs';
import {
  benchmarkRoot,
  createNewTempOutput,
  exists,
  experiment,
  gitText,
  listFiles,
  repositoryRoot,
  safeChild,
  sanitizeText,
  sha256,
  shuffled,
  writeJsonAtomic,
} from './experiment-utils.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const agentOutputSchema = path.join(benchmarkRoot, 'agent-output.schema.json');
const secretEnvironmentNames = [
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'CODEX_ACCESS_TOKEN',
  'ANTHROPIC_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
];

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = selectFixtures(args.fixtures);
  const schedule = buildSchedule(fixtures, args.repetitions, args.seed);
  const plan = {
    schema: 'yam.ab-plan.v1',
    experiment_id: experiment.experiment_id,
    phase: experiment.phase,
    model: args.model || null,
    reasoning_effort: args.reasoning || null,
    repetitions: args.repetitions,
    seed: args.seed,
    fixture_ids: fixtures.map((fixture) => fixture.id),
    call_count_after_canary: schedule.length,
    canary_required: true,
    actual_model_calls_enabled: args.execute,
    schedule,
  };
  if (!args.execute) {
    console.log(JSON.stringify(plan, null, args.json ? 0 : 2));
    return;
  }

  validateExecutionOptIn(args, schedule);
  const pricing = args.pricing ? await readPricing(args.pricing, args.model) : null;
  const command = resolveCodexCommand(args);
  verifyCodexVersion(command, experiment.runtime.codex_cli);
  verifyCodexLogin(command);

  const output = await createNewTempOutput(args.out);
  const runId = `yam-ab-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const workRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'yam-ab-work-'));
  const receipts = [];
  const startedAt = new Date().toISOString();
  let cleanupObserved = false;
  let canaryReceipt;
  try {
    canaryReceipt = await runCanary({
      args,
      command,
      output,
      workRoot,
      runId,
    });
    await writeJsonAtomic(path.join(output, 'canary-receipt.json'), canaryReceipt);
    if (!canaryReceipt.pass) {
      throw new Error(`isolation canary failed: ${canaryReceipt.failure_reason}`);
    }

    for (let index = 0; index < schedule.length; index += 1) {
      const job = schedule[index];
      const fixture = fixtures.find((row) => row.id === job.fixture_id);
      const receipt = await runJob({
        args,
        command,
        fixture,
        job,
        output,
        pricing,
        runId,
        sequence: index + 1,
        workRoot,
      });
      receipts.push(receipt);
      const receiptRelative = path.join('receipts', `${job.run_id}.json`);
      await writeJsonAtomic(path.join(output, receiptRelative), receipt);
      if (receipt.safety_violations.length > 0) {
        throw new Error(`safety policy violation in ${job.run_id}: ${receipt.safety_violations.join('; ')}`);
      }
    }

    const runContract = {
      schema: 'yam.ab-run-contract.v1',
      run_id: runId,
      experiment_id: experiment.experiment_id,
      baseline_commit: experiment.baseline.git_commit,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      model: args.model,
      reasoning_effort: args.reasoning,
      repetitions: args.repetitions,
      seed: args.seed,
      fixture_ids: fixtures.map((fixture) => fixture.id),
      pricing: pricing ? {
        model: pricing.model,
        input_per_million_usd: pricing.input_per_million_usd,
        cached_input_per_million_usd: pricing.cached_input_per_million_usd,
        output_per_million_usd: pricing.output_per_million_usd,
      } : null,
      canary_receipt: 'canary-receipt.json',
      receipts: schedule.map((job) => path.join('receipts', `${job.run_id}.json`)),
      raw_jsonl_retained: false,
      workspaces_retained: false,
      artifact_directory_intentionally_retained: true,
    };
    await writeJsonAtomic(path.join(output, 'run-contract.json'), runContract);
    const summary = summarizeReceipts(receipts, runContract);
    await writeJsonAtomic(path.join(output, 'summary.json'), summary);
    console.log(JSON.stringify({
      ok: true,
      output,
      run_id: runId,
      canary: 'passed',
      runs: receipts.length,
      summary,
    }));
  } finally {
    await fsp.rm(workRoot, { recursive: true, force: true });
    cleanupObserved = !(await exists(workRoot));
    if (await exists(output)) {
      await writeJsonAtomic(path.join(output, 'runtime-evidence.json'), {
        kind: 'runtime_evidence_mini',
        route: 'deep',
        required: true,
        command: command.display,
        target: 'isolated Codex fixture workspaces',
        started_at: startedAt,
        stopped_at: new Date().toISOString(),
        cleanup_method: 'recursive removal of the dedicated OS-temp work root',
        cleanup_observed: cleanupObserved,
        left_running_intentionally: false,
        process: 'each Codex child awaited to exit before scoring',
        observation: {
          canary: canaryReceipt?.pass ? 'passed' : 'not passed',
          completed_receipts: receipts.length,
        },
        cleanup: {
          status: cleanupObserved ? 'observed_removed' : 'not_confirmed',
          evidence: sanitizeText(workRoot),
        },
        truth_status: cleanupObserved && canaryReceipt?.pass ? 'proven' : 'partial',
        next_action: !cleanupObserved
          ? 'inspect and remove the work root'
          : canaryReceipt?.pass
            ? 'review summary and blind packet'
            : 'inspect the canary receipt diagnostics before a bounded retry',
      });
    }
  }
}

function parseArgs(args) {
  const parsed = {
    execute: false,
    fixtures: '',
    json: false,
    model: '',
    out: '',
    pricing: '',
    reasoning: '',
    repetitions: 3,
    seed: 'yam-ab-v1',
    testDouble: '',
    timeoutMs: 600_000,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const take = () => args[++index] || '';
    if (arg === '--execute') parsed.execute = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--fixtures') parsed.fixtures = take();
    else if (arg === '--model') parsed.model = take();
    else if (arg === '--out') parsed.out = take();
    else if (arg === '--pricing') parsed.pricing = take();
    else if (arg === '--reasoning') parsed.reasoning = take();
    else if (arg === '--repetitions') parsed.repetitions = Number(take());
    else if (arg === '--seed') parsed.seed = take();
    else if (arg === '--test-double') parsed.testDouble = take();
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number(take());
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(parsed.repetitions) || parsed.repetitions < 1 || parsed.repetitions > 10) {
    throw new Error('--repetitions must be an integer from 1 to 10');
  }
  if (!parsed.seed || parsed.seed.length > 120) throw new Error('--seed must contain 1-120 characters');
  if (!Number.isInteger(parsed.timeoutMs) || parsed.timeoutMs < 30_000 || parsed.timeoutMs > 900_000) {
    throw new Error('--timeout-ms must be between 30000 and 900000');
  }
  return parsed;
}

function selectFixtures(value) {
  if (!value) return experiment.fixtures;
  const requested = [...new Set(value.split(',').map((row) => row.trim()).filter(Boolean))];
  const selected = requested.map((id) => {
    const fixture = experiment.fixtures.find((row) => row.id === id);
    if (!fixture) throw new Error(`unknown fixture: ${id}`);
    return fixture;
  });
  if (selected.length === 0) throw new Error('at least one fixture is required');
  return selected;
}

function buildSchedule(fixtures, repetitions, seed) {
  const jobs = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const fixture of fixtures) {
      for (const armId of ['A', 'B']) {
        jobs.push({
          arm_id: armId,
          fixture_id: fixture.id,
          repetition,
          run_id: `run-${sha256(`${seed}\0${fixture.id}\0${armId}\0${repetition}`).slice(0, 12)}`,
        });
      }
    }
  }
  return shuffled(jobs, seed);
}

function validateExecutionOptIn(args, schedule) {
  if (process.env[experiment.runtime.execution_opt_in_environment] !== '1') {
    throw new Error(
      `actual model calls require ${experiment.runtime.execution_opt_in_environment}=1 and --execute`,
    );
  }
  if (!args.model) throw new Error('--model is required for reproducible agentic execution');
  if (!['minimal', 'low', 'medium', 'high', 'xhigh'].includes(args.reasoning)) {
    throw new Error('--reasoning must be one of minimal, low, medium, high, xhigh');
  }
  if (!args.out) throw new Error('--out is required for agentic execution');
  if (schedule.length > 160) throw new Error('refusing more than 160 model calls in one experiment');
}

function resolveCodexCommand(args) {
  if (!args.testDouble) return { executable: 'codex', prefixArgs: [], display: 'codex exec' };
  if (process.env.YAM_AB_ALLOW_TEST_DOUBLE !== '1') {
    throw new Error('--test-double is reserved for the offline runner self-test');
  }
  const testDouble = path.resolve(args.testDouble);
  const allowedRoot = path.join(scriptDir, 'test-double');
  const relative = path.relative(allowedRoot, testDouble);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !relative) {
    throw new Error('test double must be a file under scripts/test-double');
  }
  return {
    executable: process.execPath,
    prefixArgs: [testDouble],
    display: 'node <benchmark-test-double>',
  };
}

function verifyCodexVersion(command, expected) {
  const result = spawnSync(command.executable, [...command.prefixArgs, '--version'], {
    encoding: 'utf8',
    env: childEnvironment(),
    timeout: 15_000,
  });
  const observed = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0 || !observed.includes(expected)) {
    throw new Error(`Codex CLI version mismatch; expected ${expected}, observed ${sanitizeText(observed).trim()}`);
  }
}

function verifyCodexLogin(command) {
  const result = spawnSync(command.executable, [...command.prefixArgs, 'login', 'status'], {
    encoding: 'utf8',
    env: childEnvironment(),
    timeout: 15_000,
  });
  if (result.status !== 0) {
    throw new Error(`Codex authentication preflight failed: ${sanitizeText(result.stderr || result.stdout).trim()}`);
  }
}

async function readPricing(file, model) {
  const pricing = JSON.parse(await fsp.readFile(path.resolve(file), 'utf8'));
  if (pricing.model !== model) throw new Error('pricing model must exactly match --model');
  for (const key of [
    'input_per_million_usd',
    'cached_input_per_million_usd',
    'output_per_million_usd',
  ]) {
    if (!Number.isFinite(pricing[key]) || pricing[key] < 0) {
      throw new Error(`pricing ${key} must be a non-negative number`);
    }
  }
  return pricing;
}

async function runCanary({ args, command, output, workRoot, runId }) {
  const workspace = path.join(workRoot, 'canary');
  await fsp.mkdir(workspace, { mode: 0o700 });
  const marker = `yam-ab-canary-${runId}`;
  const result = await invokeCodex({
    args,
    command,
    prompt: [
      'This is an isolation canary.',
      'Work only in the current workspace.',
      'Create exactly one file named canary.txt containing the exact text below followed by one newline.',
      marker,
      'Do not read outside the workspace. Do not use network, apps, plugins, MCP tools, or credentials.',
      'Return the required structured final response.',
    ].join('\n'),
    workspace,
  });
  const violations = detectSafetyViolations(result.events);
  const files = await listFiles(workspace);
  const markerFile = path.join(workspace, 'canary.txt');
  const markerMatches = await exists(markerFile)
    && await fsp.readFile(markerFile, 'utf8') === `${marker}\n`;
  const pass = result.exitCode === 0
    && !result.timedOut
    && violations.length === 0
    && markerMatches
    && files.length === 1
    && files[0] === 'canary.txt';
  return {
    schema: 'yam.ab-canary.v1',
    pass,
    failure_reason: pass ? null : [
      result.exitCode !== 0 ? `exit_code=${result.exitCode}` : '',
      result.timedOut ? 'timed_out' : '',
      !markerMatches ? 'marker_mismatch' : '',
      files.join(',') !== 'canary.txt' ? `unexpected_files=${files.join(',')}` : '',
      violations.join('; '),
    ].filter(Boolean).join('; '),
    duration_ms: result.durationMs,
    exit_code: result.exitCode,
    event_types: countEventTypes(result.events),
    safety_violations: violations,
    diagnostics: {
      stderr_tail: sanitizeText(result.stderr).slice(-4000),
      error_events: result.events
        .filter((event) => ['error', 'turn.failed'].includes(event.type))
        .map((event) => sanitizeText(JSON.stringify(event)).slice(0, 4000)),
    },
    raw_jsonl_retained: false,
  };
}

async function runJob({
  args,
  command,
  fixture,
  job,
  output,
  pricing,
  runId,
  sequence,
  workRoot,
}) {
  const workspace = path.join(workRoot, job.run_id);
  const fixtureRoot = path.join(benchmarkRoot, 'fixtures', fixture.id);
  await fsp.cp(path.join(fixtureRoot, 'seed'), workspace, { recursive: true });
  const prompt = buildPrompt(fixture, job.arm_id);
  const result = await invokeCodex({
    args,
    command,
    prompt,
    workspace,
  });
  const violations = detectSafetyViolations(result.events);
  const score = scoreWorkspace(path.join(benchmarkRoot, fixture.scorer), workspace);
  const submission = await snapshotSubmission({
    fixture,
    job,
    output,
    workspace,
  });
  const usage = extractUsage(result.events);
  const finalMessage = extractFinalAgentMessage(result.events);
  return {
    schema: 'yam.ab-run-receipt.v1',
    experiment_id: experiment.experiment_id,
    experiment_run_id: runId,
    run_id: job.run_id,
    sequence,
    fixture_id: fixture.id,
    category: fixture.category,
    arm_id: job.arm_id,
    repetition: job.repetition,
    baseline_commit: experiment.baseline.git_commit,
    candidate_policy_id: job.arm_id === 'B' ? experiment.candidate.policy_id : null,
    model: args.model,
    reasoning_effort: args.reasoning,
    process: {
      exit_code: result.exitCode,
      timed_out: result.timedOut,
      stderr_tail: sanitizeText(result.stderr).slice(-4000),
    },
    score,
    submission,
    final_message: finalMessage,
    metrics: {
      duration_ms: result.durationMs,
      usage,
      tool_calls: extractToolCalls(result.events),
      event_types: countEventTypes(result.events),
      estimated_cost_usd: pricing ? estimateCost(usage, pricing) : null,
      cost_basis: pricing ? 'explicit_user_supplied_pricing' : 'not_computed_without_explicit_price_contract',
    },
    safety_violations: violations,
    raw_jsonl_sha256: sha256(result.stdout),
    raw_jsonl_retained: false,
    workspace_retained: false,
  };
}

function buildPrompt(fixture, armId) {
  const baselineAgents = gitText(experiment.baseline.git_commit, 'AGENTS.md');
  const baselineRoute = gitText(
    experiment.baseline.git_commit,
    `skills/${fixture.route}/SKILL.md`,
  );
  const task = fsp.readFile(path.join(benchmarkRoot, fixture.task), 'utf8');
  const treatment = armId === 'B'
    ? experiment.candidate.treatment.map((line) => `- ${line}`).join('\n')
    : '(no additional candidate policy)';
  return Promise.resolve(task).then((taskText) => [
    '<benchmark_contract>',
    `fixture_id: ${fixture.id}`,
    `mutable_files: ${fixture.mutable_files.join(', ')}`,
    `protected_files: ${fixture.protected_files.join(', ')}`,
    'Work only inside the current workspace.',
    'Do not read outside the workspace or access credentials.',
    'Do not use network, web search, apps, plugins, MCP tools, or install dependencies.',
    'Modify only mutable_files. You may run the visible local tests.',
    '</benchmark_contract>',
    '<pinned_yam_agents>',
    baselineAgents,
    '</pinned_yam_agents>',
    '<pinned_yam_route>',
    baselineRoute,
    '</pinned_yam_route>',
    '<candidate_policy_delta>',
    treatment,
    '</candidate_policy_delta>',
    '<task>',
    taskText,
    '</task>',
    'Implement the task, run the lightest honest verification, and return the required structured final response.',
  ].join('\n'));
}

async function invokeCodex({ args, command, prompt, workspace }) {
  const resolvedPrompt = await prompt;
  const cliArgs = [
    ...command.prefixArgs,
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--strict-config',
    '--json',
    '--sandbox',
    'workspace-write',
    '--disable',
    'hooks',
    '--disable',
    'plugins',
    '-c',
    'apps._default.enabled=false',
    '-c',
    'web_search="disabled"',
    '-c',
    'approval_policy="never"',
    '-c',
    `model_reasoning_effort="${args.reasoning}"`,
    '--model',
    args.model,
    '--cd',
    workspace,
    '--output-schema',
    agentOutputSchema,
    '-',
  ];
  const result = await runProcess(command.executable, cliArgs, {
    cwd: repositoryRoot,
    env: childEnvironment(),
    input: resolvedPrompt,
    timeoutMs: args.timeoutMs,
  });
  return {
    ...result,
    events: parseJsonl(result.stdout),
  };
}

function childEnvironment() {
  const allowed = [
    'HOME',
    'PATH',
    'LANG',
    'LC_ALL',
    'TZ',
    'TMPDIR',
    'USER',
    'LOGNAME',
    'SHELL',
    'CODEX_HOME',
    'CODEX_CA_CERTIFICATE',
    'SSL_CERT_FILE',
  ];
  const env = {};
  for (const key of allowed) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const key of secretEnvironmentNames) delete env[key];
  env.NO_COLOR = '1';
  env.TERM = 'dumb';
  return env;
}

function parseJsonl(stdout) {
  const events = [];
  for (const [index, line] of String(stdout).split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      throw new Error(`Codex emitted invalid JSONL at line ${index + 1}`);
    }
  }
  return events;
}

function detectSafetyViolations(events) {
  const violations = [];
  for (const event of events) {
    if (String(event.type || '').startsWith('hook.')) {
      violations.push(`hook event observed: ${event.type}`);
    }
    const item = event.item || {};
    if (['mcp_tool_call', 'web_search'].includes(item.type)) {
      violations.push(`forbidden tool observed: ${item.type}`);
    }
    if (item.type === 'command_execution') {
      const command = String(item.command || '');
      if (
        /(?:^|\s)(?:curl|wget|ssh|scp)\b/i.test(command)
        || /\.codex|auth\.json|printenv|keychain|security\s+find/i.test(command)
      ) {
        violations.push(`forbidden command observed: ${sanitizeText(command).slice(0, 240)}`);
      }
    }
  }
  return [...new Set(violations)];
}

function extractUsage(events) {
  const usage = {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
  for (const event of events) {
    if (event.type !== 'turn.completed' || !event.usage) continue;
    for (const key of Object.keys(usage)) {
      if (Number.isFinite(event.usage[key])) usage[key] += event.usage[key];
    }
  }
  return usage;
}

function extractToolCalls(events) {
  const counts = {};
  for (const event of events) {
    if (!String(event.type || '').startsWith('item.')) continue;
    const type = event.item?.type;
    if (!type || ['agent_message', 'reasoning'].includes(type)) continue;
    if (event.type !== 'item.completed') continue;
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function countEventTypes(events) {
  const counts = {};
  for (const event of events) {
    const type = String(event.type || 'unknown');
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function estimateCost(usage, pricing) {
  const nonCachedInput = Math.max(0, usage.input_tokens - usage.cached_input_tokens);
  const total = (
    nonCachedInput * pricing.input_per_million_usd
    + usage.cached_input_tokens * pricing.cached_input_per_million_usd
    + usage.output_tokens * pricing.output_per_million_usd
  ) / 1_000_000;
  return Math.round(total * 1_000_000) / 1_000_000;
}

function scoreWorkspace(scorer, workspace) {
  const result = spawnSync(process.execPath, [scorer, workspace], {
    cwd: benchmarkRoot,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '',
      LANG: 'C',
      LC_ALL: 'C',
      TZ: 'UTC',
    },
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  let score;
  try {
    score = JSON.parse(result.stdout);
  } catch {
    throw new Error(`scorer returned invalid JSON: ${sanitizeText(result.stdout)} ${sanitizeText(result.stderr)}`);
  }
  return score;
}

async function snapshotSubmission({ fixture, job, output, workspace }) {
  const directory = path.join(output, 'submissions', job.run_id);
  const files = [];
  for (const relative of fixture.mutable_files) {
    const source = safeChild(workspace, relative);
    if (!(await exists(source))) {
      files.push({ path: relative, present: false, sha256: null });
      continue;
    }
    const bytes = await fsp.readFile(source);
    const target = safeChild(directory, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fsp.writeFile(target, bytes, { mode: 0o600 });
    files.push({ path: relative, present: true, sha256: sha256(bytes), bytes: bytes.length });
  }
  return {
    directory: path.relative(output, directory),
    files,
  };
}

function extractFinalAgentMessage(events) {
  const messages = events
    .filter((event) => (
      event.type === 'item.completed' && event.item?.type === 'agent_message'
    ))
    .map((event) => sanitizeText(event.item.text || ''));
  const text = messages.at(-1) || '';
  return text.length > 12_000 ? `${text.slice(0, 12_000)}…` : text;
}

async function runProcess(command, args, options) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const detached = process.platform !== 'win32';
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let bufferExceeded = false;
    const maximum = 16 * 1024 * 1024;
    let killTimer;
    const terminate = (signal) => {
      try {
        if (detached && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (error?.code !== 'ESRCH') reject(error);
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate('SIGTERM');
      killTimer = setTimeout(() => terminate('SIGKILL'), 1500);
    }, options.timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > maximum && !bufferExceeded) {
        bufferExceeded = true;
        terminate('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > maximum && !bufferExceeded) {
        bufferExceeded = true;
        terminate('SIGTERM');
      }
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (bufferExceeded) {
        reject(new Error('Codex output exceeded the 16 MiB safety limit'));
        return;
      }
      resolve({
        durationMs: Date.now() - started,
        exitCode: Number.isInteger(code) ? code : null,
        signal,
        stderr,
        stdout,
        timedOut,
      });
    });
    child.stdin.end(options.input);
  });
}
