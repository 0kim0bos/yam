import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  benchmarkRoot,
  experiment,
  requireExistingTempDirectory,
  safeChild,
  sha256,
  shuffled,
  writeJsonAtomic,
} from './experiment-utils.mjs';

export async function prepareBlindReview(runDirectoryValue) {
  const runDirectory = await requireExistingTempDirectory(runDirectoryValue);
  const contract = JSON.parse(
    await fsp.readFile(path.join(runDirectory, 'run-contract.json'), 'utf8'),
  );
  validateContract(contract);
  const receipts = [];
  for (const relative of contract.receipts) {
    const file = safeChild(runDirectory, relative);
    receipts.push(JSON.parse(await fsp.readFile(file, 'utf8')));
  }

  const comparisons = [];
  const keyRows = [];
  for (const fixtureId of contract.fixture_ids) {
    const fixture = experiment.fixtures.find((row) => row.id === fixtureId);
    if (!fixture) throw new Error(`unknown fixture in run contract: ${fixtureId}`);
    const task = await fsp.readFile(path.join(benchmarkRoot, fixture.task), 'utf8');
    for (let repetition = 1; repetition <= contract.repetitions; repetition += 1) {
      const pair = receipts.filter((receipt) => (
        receipt.fixture_id === fixtureId && receipt.repetition === repetition
      ));
      if (pair.length !== 2 || new Set(pair.map((row) => row.arm_id)).size !== 2) {
        throw new Error(`missing balanced pair for ${fixtureId} repetition ${repetition}`);
      }
      const comparisonHash = sha256(
        `${contract.seed}\0blind\0${fixtureId}\0${repetition}`,
      ).slice(0, 12);
      const comparisonId = `comparison-${comparisonHash}`;
      const ordered = shuffled(pair, `${contract.seed}:${comparisonId}`);
      const submissions = [];
      for (let index = 0; index < ordered.length; index += 1) {
        const receipt = ordered[index];
        const submissionId = `${comparisonId}-submission-${index + 1}`;
        submissions.push({
          submission_id: submissionId,
          files: await readSubmission(runDirectory, receipt),
        });
        keyRows.push({
          comparison_id: comparisonId,
          submission_id: submissionId,
          run_id: receipt.run_id,
          fixture_id: receipt.fixture_id,
          repetition: receipt.repetition,
          arm_id: receipt.arm_id,
        });
      }
      comparisons.push({
        comparison_id: comparisonId,
        fixture_id: fixtureId,
        category: fixture.category,
        task,
        target_behavior: fixture.target_behavior,
        scope_boundary: fixture.scope_boundary || null,
        hard_gates: fixture.hard_gates,
        submissions,
      });
    }
  }

  const packet = {
    schema: 'yam.ab-blind-review-packet.v1',
    experiment_id: contract.experiment_id,
    run_id: contract.run_id,
    generated_at: new Date().toISOString(),
    reviewer_instructions: [
      'Review only this packet; do not open unblinding-key.json.',
      'For each comparison, select one submission id or tie.',
      'Judge correctness, scope discipline, maintainability, security, accessibility, and evidence honesty as applicable.',
      'Record concrete safety concerns even when a submission is otherwise preferred.',
    ],
    comparisons,
  };
  const key = {
    schema: 'yam.ab-unblinding-key.v1',
    experiment_id: contract.experiment_id,
    run_id: contract.run_id,
    packet_sha256: sha256(`${JSON.stringify(packet)}\n`),
    rows: keyRows,
  };
  const template = {
    schema: 'yam.ab-blind-reviews.v1',
    experiment_id: contract.experiment_id,
    run_id: contract.run_id,
    packet_sha256: key.packet_sha256,
    reviewer: '',
    reviews: comparisons.map((comparison) => ({
      comparison_id: comparison.comparison_id,
      preferred_submission_id: '',
      confidence: null,
      safety_concerns: [],
      notes: '',
    })),
  };

  await writeJsonAtomic(path.join(runDirectory, 'review-packet.json'), packet, 0o644);
  await writeJsonAtomic(path.join(runDirectory, 'unblinding-key.json'), key, 0o600);
  await writeJsonAtomic(path.join(runDirectory, 'blind-reviews.template.json'), template, 0o600);
  return {
    runDirectory,
    packet,
    key,
    template,
  };
}

export function finalizeBlindReview({ contract, summary, key, reviews }) {
  if (reviews.schema !== 'yam.ab-blind-reviews.v1') {
    throw new Error('unexpected blind review schema');
  }
  if (
    reviews.experiment_id !== contract.experiment_id
    || reviews.run_id !== contract.run_id
    || reviews.packet_sha256 !== key.packet_sha256
  ) {
    throw new Error('blind reviews do not match this run packet');
  }
  if (!String(reviews.reviewer || '').trim()) throw new Error('blind review requires a reviewer id');

  const comparisonIds = [...new Set(key.rows.map((row) => row.comparison_id))];
  if (reviews.reviews.length !== comparisonIds.length) {
    throw new Error('blind review must cover every comparison exactly once');
  }
  const outcomes = [];
  for (const comparisonId of comparisonIds) {
    const matching = reviews.reviews.filter((row) => row.comparison_id === comparisonId);
    if (matching.length !== 1) throw new Error(`invalid review coverage: ${comparisonId}`);
    const review = matching[0];
    if (!Number.isInteger(review.confidence) || review.confidence < 1 || review.confidence > 5) {
      throw new Error(`review confidence must be 1-5: ${comparisonId}`);
    }
    if (!Array.isArray(review.safety_concerns)) {
      throw new Error(`review safety_concerns must be an array: ${comparisonId}`);
    }
    const candidates = key.rows.filter((row) => row.comparison_id === comparisonId);
    let preferredArm = 'tie';
    if (review.preferred_submission_id !== 'tie') {
      const selected = candidates.find((row) => (
        row.submission_id === review.preferred_submission_id
      ));
      if (!selected) throw new Error(`unknown preferred submission: ${comparisonId}`);
      preferredArm = selected.arm_id;
    }
    outcomes.push({
      comparison_id: comparisonId,
      fixture_id: candidates[0].fixture_id,
      preferred_arm: preferredArm,
      confidence: review.confidence,
      safety_concern_count: review.safety_concerns.length,
    });
  }

  const preferences = {
    A: outcomes.filter((row) => row.preferred_arm === 'A').length,
    B: outcomes.filter((row) => row.preferred_arm === 'B').length,
    tie: outcomes.filter((row) => row.preferred_arm === 'tie').length,
  };
  const safetyConcerns = outcomes.reduce((total, row) => total + row.safety_concern_count, 0);
  let decision = summary.decision;
  if (decision === 'awaiting_blind_review') {
    if (safetyConcerns > 0) decision = 'manual_safety_review_required';
    else if (summary.arms.B.pass_rate < summary.arms.A.pass_rate) decision = 'retain_baseline';
    else if (preferences.B > preferences.A) decision = 'candidate_supported';
    else decision = 'retain_baseline_or_inconclusive';
  }
  return {
    schema: 'yam.ab-final-decision.v1',
    experiment_id: contract.experiment_id,
    run_id: contract.run_id,
    generated_at: new Date().toISOString(),
    reviewer: reviews.reviewer,
    automated_summary_decision: summary.decision,
    blind_preferences: preferences,
    safety_concern_count: safetyConcerns,
    outcomes,
    decision,
    adoption_rule: {
      security_or_accessibility_regression_rejects_candidate: true,
      candidate_pass_rate_must_not_trail_baseline: true,
      candidate_must_win_blind_preferences: true,
    },
  };
}

async function readSubmission(runDirectory, receipt) {
  const files = [];
  for (const row of receipt.submission.files) {
    if (!row.present) {
      files.push({ path: row.path, present: false, sha256: null, content: null });
      continue;
    }
    const source = safeChild(runDirectory, path.join(receipt.submission.directory, row.path));
    const bytes = await fsp.readFile(source);
    if (bytes.length > 64 * 1024) throw new Error(`submission file is too large: ${row.path}`);
    if (sha256(bytes) !== row.sha256) throw new Error(`submission digest mismatch: ${row.path}`);
    files.push({
      path: row.path,
      present: true,
      sha256: row.sha256,
      content: bytes.toString('utf8'),
    });
  }
  return files;
}

function validateContract(contract) {
  if (contract.schema !== 'yam.ab-run-contract.v1') throw new Error('unexpected run contract schema');
  if (contract.experiment_id !== experiment.experiment_id) throw new Error('experiment id mismatch');
  if (!Array.isArray(contract.receipts) || contract.receipts.length === 0) {
    throw new Error('completed receipts are required for blind review');
  }
}
