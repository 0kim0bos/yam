#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStrictGateResult, verifyStrictGateResult } from '../dist/lib/gate-result.js';
import { buildBoundedPromotionReport } from '../dist/lib/benchmark-promotion.js';

const root = process.cwd();
const bin = join(root, 'dist', 'bin', 'yam.js');
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);

const first = runJson(['benchmark', 'report',
  '--candidate-digest', digestA,
  '--baseline-digest', digestB,
  '--sample', 'seed-1:0.9:0.7',
  '--sample', 'seed-2:0.8:0.6',
  '--min-samples', '2',
  '--min-mean-delta', '0.1',
  '--min-win-rate', '1',
  '--unit', 'score',
  '--evidence-source', 'focused-smoke',
  '--json'
]);
assert(first.schema === 'yam.bounded-promotion-receipt.v1', 'promotion receipt schema missing');
assert(first.decision === 'keep', 'passing paired samples should keep the candidate');
assert(first.measurement_truth === 'operator_asserted', 'promotion report must not promote operator scores to authenticated truth');
assert(first.truth_status === 'partial', 'passing arithmetic must not authenticate operator-supplied measurements');
assert(first.gate_result?.status === 'passed', 'passing promotion should have a strict passing gate');

const lowerIsBetter = runJson(['benchmark', 'report',
  '--candidate-digest', digestA,
  '--baseline-digest', digestB,
  '--sample', 'seed-1:70:90',
  '--sample', 'seed-2:75:85',
  '--target', 'lower',
  '--min-samples', '2',
  '--min-mean-delta', '10',
  '--min-win-rate', '1',
  '--unit', 'ms',
  '--evidence-source', 'focused-smoke',
  '--json'
]);
assert(lowerIsBetter.decision === 'keep' && lowerIsBetter.directional_mean_delta === 15, 'lower-is-better paired arithmetic should use the requested direction');

const thresholdFailure = runFailureJson(['benchmark', 'report',
  '--candidate-digest', digestA,
  '--baseline-digest', digestB,
  '--sample', 'seed-1:0.9:0.7',
  '--sample', 'seed-2:0.6:0.8',
  '--min-samples', '2',
  '--min-mean-delta', '0.1',
  '--min-win-rate', '0.75',
  '--unit', 'score',
  '--evidence-source', 'focused-smoke',
  '--json'
]);
assert(thresholdFailure.decision === 'revert', 'failed mean/win thresholds should revert the candidate');
assert(thresholdFailure.truth_status === 'partial', 'threshold failure arithmetic must preserve partial measurement truth');

const reordered = runJson(['benchmark', 'report',
  '--candidate-digest', digestA,
  '--baseline-digest', digestB,
  '--sample', 'seed-2:0.8:0.6',
  '--sample', 'seed-1:0.9:0.7',
  '--min-samples', '2',
  '--min-mean-delta', '0.1',
  '--min-win-rate', '1',
  '--unit', 'score',
  '--evidence-source', 'focused-smoke',
  '--json'
]);
assert(reordered.evidence_digest === first.evidence_digest, 'promotion evidence digest should be independent of sample input order');
assert(reordered.decision === first.decision && reordered.directional_mean_delta === first.directional_mean_delta, 'promotion arithmetic and decision must be independent of sample input order');

const cancellationA = buildBoundedPromotionReport({
  candidate_digest: digestA,
  baseline_digest: digestB,
  samples: [
    { seed: 'a', candidate: 1e16, baseline: 0 },
    { seed: 'b', candidate: 1, baseline: 0 },
    { seed: 'c', candidate: -1e16, baseline: 0 }
  ],
  min_samples: 3,
  min_mean_delta: 0.3,
  min_win_rate: 0.3,
  unit: 'score',
  evidence_source: 'cancellation-fixture'
});
const cancellationB = buildBoundedPromotionReport({
  candidate_digest: digestA,
  baseline_digest: digestB,
  samples: [
    { seed: 'c', candidate: -1e16, baseline: 0 },
    { seed: 'a', candidate: 1e16, baseline: 0 },
    { seed: 'b', candidate: 1, baseline: 0 }
  ],
  min_samples: 3,
  min_mean_delta: 0.3,
  min_win_rate: 0.3,
  unit: 'score',
  evidence_source: 'cancellation-fixture'
});
assert(cancellationA.evidence_digest === cancellationB.evidence_digest, 'cancellation fixture digest must be stable');
assert(cancellationA.directional_mean_delta === cancellationB.directional_mean_delta && cancellationA.decision === cancellationB.decision, 'cancellation-sensitive promotion arithmetic must be deterministic');

const changedSource = runJson(['benchmark', 'report',
  '--candidate-digest', digestA,
  '--baseline-digest', digestB,
  '--sample', 'seed-1:0.9:0.7',
  '--sample', 'seed-2:0.8:0.6',
  '--min-samples', '2',
  '--min-mean-delta', '0.1',
  '--min-win-rate', '1',
  '--unit', 'score',
  '--evidence-source', 'different-focused-source',
  '--json'
]);
assert(changedSource.evidence_digest !== first.evidence_digest, 'promotion evidence digest must bind the declared measurement source');

const insufficient = runFailureJson(['benchmark', 'report',
  '--candidate-digest', digestA,
  '--baseline-digest', digestB,
  '--sample', 'seed-1:0.9:0.7',
  '--min-samples', '2',
  '--unit', 'score',
  '--evidence-source', 'focused-smoke',
  '--json'
]);
assert(insufficient.decision === 'insufficient-evidence', 'too few samples must not produce keep/revert certainty');
assert(insufficient.gate_result?.status === 'failed', 'insufficient evidence must fail the strict gate');

const duplicate = runFailureJson(['benchmark', 'report',
  '--candidate-digest', digestA,
  '--baseline-digest', digestB,
  '--sample', 'same:0.9:0.7',
  '--sample', 'same:0.8:0.6',
  '--unit', 'score',
  '--evidence-source', 'focused-smoke',
  '--json'
]);
assert(duplicate.decision === 'blocked', 'duplicate seeds must block promotion');

const nonFinite = runFailureJson(['benchmark', 'report',
  '--candidate-digest', digestA,
  '--baseline-digest', digestB,
  '--sample', 'seed-1:NaN:0.7',
  '--unit', 'score',
  '--evidence-source', 'focused-smoke',
  '--json'
]);
assert(nonFinite.decision === 'blocked', 'non-finite paired samples must block promotion');

const sameDigest = runFailureJson(['benchmark', 'report',
  '--candidate-digest', digestA,
  '--baseline-digest', digestA,
  '--sample', 'seed-1:0.9:0.7',
  '--sample', 'seed-2:0.8:0.6',
  '--unit', 'score',
  '--evidence-source', 'focused-smoke',
  '--json'
]);
assert(sameDigest.decision === 'blocked', 'candidate and baseline must have distinct digests');

const invalidTarget = runFailureJson(['benchmark', 'report',
  '--candidate-digest', digestA,
  '--baseline-digest', digestB,
  '--sample', 'seed-1:0.9:0.7',
  '--sample', 'seed-2:0.8:0.6',
  '--target', 'sideways',
  '--unit', 'score',
  '--evidence-source', 'focused-smoke',
  '--json'
]);
assert(invalidTarget.blockers.some((item) => item.startsWith('target_invalid')), 'an invalid benchmark direction must fail closed');

const overflowDelta = buildBoundedPromotionReport({
  candidate_digest: digestA,
  baseline_digest: digestB,
  samples: [{ seed: 'overflow', candidate: Number.MAX_VALUE, baseline: -Number.MAX_VALUE }],
  unit: 'score',
  evidence_source: 'focused-smoke'
});
assert(overflowDelta.decision === 'blocked' && overflowDelta.failures.some((item) => item.startsWith('sample_delta_not_finite')), 'non-finite derived arithmetic must fail closed');

const missingUnit = runFailureJson(['benchmark', 'report',
  '--candidate-digest', digestA,
  '--baseline-digest', digestB,
  '--sample', 'seed-1:0.9:0.7',
  '--sample', 'seed-2:0.8:0.6',
  '--evidence-source', 'focused-smoke',
  '--json'
]);
assert(missingUnit.blockers.some((item) => item.startsWith('unit_missing')), 'missing measurement unit must block promotion');

const missingSource = runFailureJson(['benchmark', 'report',
  '--candidate-digest', digestA,
  '--baseline-digest', digestB,
  '--sample', 'seed-1:0.9:0.7',
  '--sample', 'seed-2:0.8:0.6',
  '--unit', 'score',
  '--json'
]);
assert(missingSource.blockers.some((item) => item.startsWith('evidence_source_missing')), 'missing evidence source must block promotion');

const overLimit = buildBoundedPromotionReport({
  candidate_digest: digestA,
  baseline_digest: digestB,
  samples: Array.from({ length: 257 }, (_, index) => ({ seed: `seed-${index}`, candidate: 1, baseline: 0 })),
  unit: 'score',
  evidence_source: 'focused-smoke'
});
assert(overLimit.decision === 'blocked' && overLimit.failures.some((item) => item.startsWith('sample_limit_exceeded')), 'more than 256 paired samples must fail closed');

const malformedGate = buildStrictGateResult({
  gate_id: 'missing-evidence',
  boundary: 'release',
  checks: [{ id: 'release-check', status: 'passed', required: true }],
  evidence: []
});
assert(malformedGate.status === 'failed', 'missing strict-gate evidence must fail closed');
assert(verifyStrictGateResult(malformedGate).valid === false, 'a gate missing required evidence must fail structural verification');
const forgedGate = { ...malformedGate, status: 'passed', blockers: [] };
assert(verifyStrictGateResult(forgedGate).valid === false, 'a forged passing malformed gate must be rejected');
assert(verifyStrictGateResult({ schema: 'yam.gate-result.v1', status: 'passed' }).valid === false, 'a missing strict-gate contract must fail closed');
assert(verifyStrictGateResult({ ...first.gate_result, next_action: 'tampered after digest' }).valid === false, 'gate digest must cover the actionable contract fields');
const duplicateCheckGate = buildStrictGateResult({
  gate_id: 'duplicate-checks',
  boundary: 'mission',
  checks: [
    { id: 'same', status: 'passed', required: true },
    { id: 'same', status: 'passed', required: true }
  ],
  evidence: ['duplicate fixture']
});
assert(duplicateCheckGate.status === 'failed' && duplicateCheckGate.contract_errors.includes('duplicate_check_id'), 'duplicate strict-gate check ids must fail closed');
const passedInvalidContract = redigestGate({
  ...duplicateCheckGate,
  status: 'passed',
  blockers: [],
  truth_status: 'verified'
});
const passedInvalidVerification = verifyStrictGateResult(passedInvalidContract);
assert(passedInvalidVerification.valid === false && passedInvalidVerification.errors.includes('passed_with_invalid_contract'), 'a digest-valid passing gate with an invalid contract must be rejected');

const inconsistentRequiredCheck = redigestGate({
  ...first.gate_result,
  checks: first.gate_result.checks.map((check, index) => index === 0 ? { ...check, status: 'failed' } : check)
});
assert(verifyStrictGateResult(inconsistentRequiredCheck).errors.includes('passed_with_failed_required_check'), 'a passing gate with a failed required check must be rejected');

const toolsDoctor = runJson(['tools', 'doctor', root, '--json']);
assert(toolsDoctor.capabilityMatrix?.schema === 'yam.capability-matrix.v1', 'tools doctor capability matrix missing');
assert(toolsDoctor.capabilityMatrix.capabilities?.some((row) => row.id === 'mission_real_subagents' && row.maturity === 'instruction-only'), 'capability matrix must distinguish instruction-only subagent support');
assert(toolsDoctor.capabilityMatrix.capabilities?.some((row) => row.id === 'external_update_apply' && row.runtime_state === 'unknown'), 'unprobed runtime capability must not be reported ready');
assert(toolsDoctor.capabilityMatrix.truth_status === 'partial', 'read-only capability inventory must not claim executed verification');

const temp = mkdtempSync(join(tmpdir(), 'yam-trust-adoptions-'));
try {
  const receiptFile = join(temp, 'reviewer.json');
  const receipt = runJson(['mission', 'receipt',
    '--thread-id', 'reviewer-1',
    '--role', 'reviewer',
    '--lifecycle', 'stopped',
    '--outcome', 'passed',
    '--scope', 'read-only review',
    '--evidence', 'focused review passed',
    '--out', receiptFile,
    '--json'
  ]);
  assert(receipt.completion_eligible === true, 'reviewer fixture receipt should be eligible');
  const completion = runJson(['mission', 'gate',
    '--expected-thread', 'reviewer-1',
    '--receipt', receiptFile,
    '--json'
  ]);
  assert(completion.ready_to_claim_complete === true, 'complete receipt inventory should pass Mission gate');
  assert(completion.gate_result?.schema === 'yam.gate-result.v1' && completion.gate_result.status === 'passed', 'Mission boundary must emit a strict passing gate');
  assert(completion.gate_contract?.valid === true, 'Mission strict gate contract should verify');

  const malformedReceipt = join(temp, 'malformed.json');
  writeFileSync(malformedReceipt, '{not-json}\n');
  const blocked = runFailureJson(['mission', 'gate',
    '--expected-thread', 'reviewer-1',
    '--receipt', malformedReceipt,
    '--json'
  ]);
  assert(blocked.ready_to_claim_complete === false, 'malformed receipt must block Mission completion');
  assert(blocked.gate_result?.status === 'failed', 'malformed receipt must fail the strict Mission gate');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log('trust adoptions smoke: ok');

function runJson(args) {
  return JSON.parse(execFileSync(bin, args, { encoding: 'utf8' }));
}

function runFailureJson(args) {
  try {
    execFileSync(bin, args, { encoding: 'utf8' });
  } catch (error) {
    return JSON.parse(String(error.stdout || '{}'));
  }
  throw new Error(`expected failure: ${args.join(' ')}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function redigestGate(gate) {
  const canonical = {
    schema: gate.schema,
    generated_at: gate.generated_at,
    gate_id: gate.gate_id,
    boundary: gate.boundary,
    status: gate.status,
    checks: gate.checks,
    blockers: gate.blockers,
    evidence: gate.evidence,
    next_action: gate.next_action,
    contract_valid: gate.contract_valid,
    contract_errors: gate.contract_errors,
    truth_status: gate.truth_status
  };
  return {
    ...gate,
    digest: `sha256:${createHash('sha256').update(stableJson(canonical)).digest('hex')}`
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
