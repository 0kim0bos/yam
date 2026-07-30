#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists } from './experiment-utils.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'yam-ab-runner-selftest-'));

try {
  const output = path.join(temporaryRoot, 'run-output');
  const pricing = path.join(temporaryRoot, 'pricing.json');
  await fsp.writeFile(pricing, `${JSON.stringify({
    model: 'fake-model',
    input_per_million_usd: 2,
    cached_input_per_million_usd: 0.5,
    output_per_million_usd: 8,
  })}\n`);
  const result = spawnSync(process.execPath, [
    path.join(scriptDir, 'run-experiment.mjs'),
    '--execute',
    '--test-double',
    path.join(scriptDir, 'test-double', 'codex-double.mjs'),
    '--fixtures',
    'reuse-helper',
    '--repetitions',
    '1',
    '--seed',
    'runner-selftest',
    '--model',
    'fake-model',
    '--reasoning',
    'low',
    '--pricing',
    pricing,
    '--out',
    output,
  ], {
    cwd: path.resolve(scriptDir, '../../..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      YAM_AB_AGENTIC_ENABLED: '1',
      YAM_AB_ALLOW_TEST_DOUBLE: '1',
    },
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`runner self-test failed: ${result.stderr || result.stdout}`);
  }
  const contract = JSON.parse(await fsp.readFile(path.join(output, 'run-contract.json'), 'utf8'));
  const summary = JSON.parse(await fsp.readFile(path.join(output, 'summary.json'), 'utf8'));
  const canary = JSON.parse(await fsp.readFile(path.join(output, 'canary-receipt.json'), 'utf8'));
  assert(canary.pass === true, 'test-double canary did not pass');
  assert(contract.receipts.length === 2, 'runner did not produce two balanced arm receipts');
  assert(summary.arms.A.passed === 1 && summary.arms.B.passed === 1, 'runner scores did not pass');
  assert(summary.arms.A.estimated_cost_usd !== null, 'explicit pricing did not produce cost');
  assert(summary.decision === 'insufficient_agentic_runs', 'one repetition must remain insufficient');
  for (const receipt of contract.receipts) {
    const row = JSON.parse(await fsp.readFile(path.join(output, receipt), 'utf8'));
    assert(row.raw_jsonl_retained === false, 'runner retained raw JSONL');
    assert(row.workspace_retained === false, 'runner retained a fixture workspace');
    assert(row.safety_violations.length === 0, 'test-double run triggered a safety violation');
  }
  const packetResult = spawnSync(process.execPath, [
    path.join(scriptDir, 'prepare-blind-review.mjs'),
    '--run-dir',
    output,
  ], {
    cwd: path.resolve(scriptDir, '../../..'),
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (packetResult.status !== 0) {
    throw new Error(`blind packet preparation failed: ${packetResult.stderr || packetResult.stdout}`);
  }
  const key = JSON.parse(await fsp.readFile(path.join(output, 'unblinding-key.json'), 'utf8'));
  const template = JSON.parse(
    await fsp.readFile(path.join(output, 'blind-reviews.template.json'), 'utf8'),
  );
  template.reviewer = 'offline-selftest';
  for (const review of template.reviews) {
    review.preferred_submission_id = key.rows.find((row) => (
      row.comparison_id === review.comparison_id && row.arm_id === 'B'
    )).submission_id;
    review.confidence = 5;
    review.notes = 'Synthetic preference used only to verify unblinding.';
  }
  const completedReviews = path.join(temporaryRoot, 'completed-reviews.json');
  await fsp.writeFile(completedReviews, `${JSON.stringify(template, null, 2)}\n`);
  const finalizeResult = spawnSync(process.execPath, [
    path.join(scriptDir, 'finalize-blind-review.mjs'),
    '--run-dir',
    output,
    '--reviews',
    completedReviews,
  ], {
    cwd: path.resolve(scriptDir, '../../..'),
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (finalizeResult.status !== 0) {
    throw new Error(`blind review finalization failed: ${finalizeResult.stderr || finalizeResult.stdout}`);
  }
  const decision = JSON.parse(await fsp.readFile(path.join(output, 'final-decision.json'), 'utf8'));
  assert(decision.blind_preferences.B === 1, 'blind preference did not unblind to candidate');
  assert(decision.decision === 'insufficient_agentic_runs', 'blind review must not bypass run minimum');
  console.log('yam-ab controlled runner selftest: ok');
  console.log('- isolation canary passed through the Codex test double');
  console.log('- balanced A/B receipts, token/tool/duration/cost extraction, and scoring passed');
  console.log('- blinded packet, private key, review validation, and unblinding passed');
  console.log('- dedicated work root removed; only the temporary self-test artifact remains');
} finally {
  await fsp.rm(temporaryRoot, { recursive: true, force: true });
}

if (await exists(temporaryRoot)) {
  throw new Error(`runner self-test cleanup did not remove temporary root: ${temporaryRoot}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
