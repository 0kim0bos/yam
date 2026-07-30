#!/usr/bin/env node
import fsp from 'node:fs/promises';
import path from 'node:path';
import { experiment, writeJsonAtomic } from './experiment-utils.mjs';

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export function summarizeReceipts(receipts, runContract) {
  const arms = Object.fromEntries(['A', 'B'].map((armId) => {
    const armReceipts = receipts.filter((receipt) => receipt.arm_id === armId);
    const usage = armReceipts.map((receipt) => receipt.metrics?.usage || {});
    const costs = armReceipts
      .map((receipt) => receipt.metrics?.estimated_cost_usd)
      .filter((value) => Number.isFinite(value));
    return [armId, {
      runs: armReceipts.length,
      passed: armReceipts.filter((receipt) => receipt.score?.pass).length,
      pass_rate: ratio(
        armReceipts.filter((receipt) => receipt.score?.pass).length,
        armReceipts.length,
      ),
      mean_duration_ms: mean(armReceipts.map((receipt) => receipt.metrics?.duration_ms)),
      tokens: {
        input: sum(usage.map((row) => row.input_tokens)),
        cached_input: sum(usage.map((row) => row.cached_input_tokens)),
        output: sum(usage.map((row) => row.output_tokens)),
        reasoning_output: sum(usage.map((row) => row.reasoning_output_tokens)),
      },
      estimated_cost_usd: costs.length === armReceipts.length ? round(sum(costs), 6) : null,
      tool_calls: mergeCounts(armReceipts.map((receipt) => receipt.metrics?.tool_calls || {})),
    }];
  }));

  const paired = [];
  for (const fixture of experiment.fixtures) {
    for (let repetition = 1; repetition <= runContract.repetitions; repetition += 1) {
      const left = receipts.find((row) => (
        row.fixture_id === fixture.id && row.repetition === repetition && row.arm_id === 'A'
      ));
      const right = receipts.find((row) => (
        row.fixture_id === fixture.id && row.repetition === repetition && row.arm_id === 'B'
      ));
      if (!left || !right) continue;
      paired.push({
        fixture_id: fixture.id,
        category: fixture.category,
        repetition,
        baseline_pass: Boolean(left.score?.pass),
        candidate_pass: Boolean(right.score?.pass),
      });
    }
  }

  const hardGateCategories = new Set(['security', 'accessibility']);
  const hardGateRegressions = paired.filter((pair) => (
    hardGateCategories.has(pair.category) && pair.baseline_pass && !pair.candidate_pass
  ));
  const minimum = experiment.decision_policy.minimum_repetitions_per_arm_and_fixture;
  const completePairs = paired.length === runContract.fixture_ids.length * runContract.repetitions;
  const enoughRuns = completePairs && runContract.repetitions >= minimum;
  let decision = 'awaiting_blind_review';
  if (hardGateRegressions.length > 0) decision = 'reject_candidate';
  else if (!enoughRuns) decision = 'insufficient_agentic_runs';

  return {
    schema: 'yam.ab-summary.v1',
    experiment_id: experiment.experiment_id,
    generated_at: new Date().toISOString(),
    run_id: runContract.run_id,
    arms,
    pairs: {
      total: paired.length,
      baseline_only_wins: paired.filter((row) => row.baseline_pass && !row.candidate_pass).length,
      candidate_only_wins: paired.filter((row) => !row.baseline_pass && row.candidate_pass).length,
      both_pass: paired.filter((row) => row.baseline_pass && row.candidate_pass).length,
      both_fail: paired.filter((row) => !row.baseline_pass && !row.candidate_pass).length,
    },
    hard_gate_regressions: hardGateRegressions,
    evidence: {
      complete_pairs: completePairs,
      minimum_repetitions_required: minimum,
      observed_repetitions: runContract.repetitions,
      blind_review_complete: false,
    },
    decision,
  };
}

async function main() {
  const runDirectory = path.resolve(parseRunDirectory(process.argv.slice(2)));
  const contract = JSON.parse(await fsp.readFile(path.join(runDirectory, 'run-contract.json'), 'utf8'));
  const receipts = [];
  for (const relative of contract.receipts) {
    receipts.push(JSON.parse(await fsp.readFile(path.join(runDirectory, relative), 'utf8')));
  }
  const summary = summarizeReceipts(receipts, contract);
  await writeJsonAtomic(path.join(runDirectory, 'summary.json'), summary);
  console.log(JSON.stringify(summary));
}

function parseRunDirectory(args) {
  const index = args.indexOf('--run-dir');
  const value = index === -1 ? '' : args[index + 1];
  if (!value) throw new Error('usage: aggregate-results.mjs --run-dir <completed-run-directory>');
  return value;
}

function sum(values) {
  return values.filter(Number.isFinite).reduce((total, value) => total + value, 0);
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? round(sum(finite) / finite.length, 2) : null;
}

function ratio(numerator, denominator) {
  return denominator ? round(numerator / denominator, 4) : null;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mergeCounts(rows) {
  const result = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      result[key] = (result[key] || 0) + value;
    }
  }
  return result;
}
