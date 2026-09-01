import assert from 'node:assert/strict';
import { buildNextStep, verifyNextStep } from '../dist/lib/next-step.js';
import { buildLoopReport } from '../dist/lib/trust-kernel.js';

const base = {
  current_situation: 'The requested implementation is complete and focused checks passed.',
  forward_outlook: 'Release integration can proceed after the contract is connected to the CLI.',
  critical_opinion: 'A single leftover-task sentence would hide ordering, ownership, and evidence quality.',
  improvement_recommendations: [
    'Keep the sequence bounded and put verification blockers before planned expansion.',
    'Re-scan the whole process before carrying recommendations into a later run.'
  ],
  steps: [
    {
      kind: 'fix_first',
      action: 'Connect the reusable contract to the CLI without duplicating its truth rules.',
      why: 'One truth boundary prevents report prose and JSON artifacts from drifting.',
      owner_route: '$mission',
      owner_scope: ['CLI integration', 'focused smoke coverage'],
      blocked_by: [],
      safe_retry: 'not required; run the focused CLI smoke after integration',
      side_effects: ['CLI output and packaged declarations will change']
    },
    {
      kind: 'planned',
      action: 'Run the release workflow against the same packed artifact.',
      why: 'The later release claim needs evidence from the bytes users will install.',
      owner_route: '$deep',
      owner_scope: ['release verification'],
      blocked_by: [],
      safe_retry: 'retry from a clean tree if release verification changes tracked files',
      side_effects: ['may create a local tarball that must be cleaned up']
    }
  ],
  evidence_level: 'L3',
  evidence_stamp: 'commands:npm-run-build+next-step-smoke',
  truth_status: 'verified'
};

const first = buildNextStep(base);
const second = buildNextStep(base);
assert.equal(first.contract_valid, true, JSON.stringify(first.contract_errors));
assert.equal(first.truth_status, 'verified');
assert.equal(first.steps[0].kind, 'fix_first');
assert.equal(first.steps[1].kind, 'planned');
assert.equal(first.digest, second.digest, 'the same input must produce the same digest');
assert.deepEqual(first, second, 'the receipt must not contain time-dependent fields');
assert.equal(verifyNextStep(first).valid, true);

const emptyEvidence = buildNextStep({ ...base, evidence_level: 'L0', evidence_stamp: '' });
assert.equal(emptyEvidence.contract_valid, false);
assert.equal(emptyEvidence.truth_status, 'blocked');
assert(emptyEvidence.contract_errors.includes('evidence_stamp_missing'));
assert(emptyEvidence.contract_errors.includes('verified_truth_requires_l2_evidence'));
assert.equal(verifyNextStep(emptyEvidence).valid, false);

const contradictory = buildNextStep({
  ...base,
  steps: [{
    ...base.steps[0],
    blocked_by: ['release credentials are unavailable'],
    safe_retry: 'retry only after credentials are restored and a new evidence stamp is recorded'
  }]
});
assert.equal(contradictory.contract_valid, false);
assert.equal(contradictory.truth_status, 'blocked');
assert(contradictory.contract_errors.includes('truth_status_contradicts_blockers'));

const unsafeBlockedRetry = buildNextStep({
  ...base,
  steps: [{
    ...base.steps[0],
    blocked_by: ['release credentials are unavailable'],
    safe_retry: ''
  }],
  truth_status: 'blocked'
});
assert.equal(unsafeBlockedRetry.contract_valid, false);
assert(unsafeBlockedRetry.contract_errors.includes('steps[0].safe_retry_missing'));

const underProven = buildNextStep({ ...base, evidence_level: 'L3', truth_status: 'proven' });
assert.equal(underProven.contract_valid, false);
assert(underProven.contract_errors.includes('proven_truth_requires_l4_evidence'));

const wrongOrder = buildNextStep({
  ...base,
  steps: [base.steps[1], base.steps[0]],
  truth_status: 'partial'
});
assert.equal(wrongOrder.contract_valid, false);
assert(wrongOrder.contract_errors.includes('steps[1].fix_first_out_of_order'));

const blocked = buildNextStep({
  ...base,
  steps: [{
    ...base.steps[0],
    blocked_by: ['review evidence is missing'],
    safe_retry: 'retry after the reviewer receipt exists'
  }],
  truth_status: 'blocked'
});
assert.equal(blocked.contract_valid, true, JSON.stringify(blocked.contract_errors));
assert.equal(blocked.truth_status, 'blocked');
assert.equal(verifyNextStep(blocked).valid, true);

const tampered = structuredClone(first);
tampered.steps[0].why = 'A forged reason that is not bound by the original digest.';
const tamperedVerification = verifyNextStep(tampered);
assert.equal(tamperedVerification.valid, false);
assert(tamperedVerification.errors.includes('digest_invalid'));

const overLimit = buildNextStep({
  ...base,
  steps: Array.from({ length: 13 }, (_, index) => ({
    ...base.steps[1],
    action: `Planned action ${index + 1}`
  })),
  truth_status: 'partial'
});
assert.equal(overLimit.contract_valid, false);
assert(overLimit.contract_errors.includes('step_limit_exceeded'));
assert.equal(overLimit.steps.length, 12);

const unknownInput = buildNextStep({ ...base, hidden_override: true });
assert.equal(unknownInput.contract_valid, false);
assert(unknownInput.contract_errors.includes('input_unexpected_key:hidden_override'));

const unknownStepInput = buildNextStep({
  ...base,
  steps: [{ ...base.steps[0], hidden_override: true }, base.steps[1]]
});
assert.equal(unknownStepInput.contract_valid, false);
assert(unknownStepInput.contract_errors.includes('steps[0]_unexpected_key:hidden_override'));

const coercedLeaves = buildNextStep({
  ...base,
  current_situation: 42,
  evidence_stamp: { forged: true },
  steps: [{ ...base.steps[0], action: { forged: true }, safe_retry: true }, base.steps[1]]
});
assert.equal(coercedLeaves.contract_valid, false);
assert(coercedLeaves.contract_errors.includes('current_situation_invalid'));
assert(coercedLeaves.contract_errors.includes('evidence_stamp_invalid'));
assert(coercedLeaves.contract_errors.includes('steps[0].action_invalid'));
assert(coercedLeaves.contract_errors.includes('steps[0].safe_retry_invalid'));

const invalidOptionalLoopStep = buildLoopReport({
  route: 'quick',
  stages: [{ id: 'verify', status: 'passed', note: 'focused check passed' }],
  evidence: ['focused check passed'],
  next_step: { ...base, current_situation: { forged: true } },
  truth_status: 'verified'
});
assert.equal(invalidOptionalLoopStep.truth_status, 'blocked', 'an invalid supplied Next step must block even without touched files');
assert.equal(invalidOptionalLoopStep.blocked_kind, 'evidence_missing', 'Next step blockers must contribute to blocked_kind');
assert(invalidOptionalLoopStep.blockers.some((item) => item.includes('next_step_contract_blocked')));

console.log('next-step smoke: passed');
