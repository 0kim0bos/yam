import { createHash } from 'node:crypto';

export type BenchmarkDirection = 'higher' | 'lower';
export type PromotionDecision = 'keep' | 'revert' | 'insufficient-evidence' | 'blocked';

export interface PromotionSample {
  seed: string;
  candidate: number;
  baseline: number;
}

export interface BoundedPromotionInput {
  label?: string;
  candidate_digest?: string;
  baseline_digest?: string;
  samples?: PromotionSample[];
  min_samples?: number;
  min_mean_delta?: number;
  min_win_rate?: number;
  target?: BenchmarkDirection;
  unit?: string;
  evidence_source?: string;
}

export interface BoundedPromotionReport {
  schema: 'yam.bounded-promotion-receipt.v1';
  generated_at: string;
  label: string;
  candidate_digest: string;
  baseline_digest: string;
  target: BenchmarkDirection;
  unit: string;
  policy: {
    min_samples: number;
    min_mean_delta: number;
    min_win_rate: number;
  };
  samples: Array<PromotionSample & { directional_delta: number; winner: 'candidate' | 'baseline' | 'tie' }>;
  sample_count: number;
  candidate_mean: number | null;
  baseline_mean: number | null;
  directional_mean_delta: number | null;
  win_rate: number | null;
  decision: PromotionDecision;
  failures: string[];
  blockers: string[];
  evidence_source: string;
  evidence_digest: string;
  measurement_truth: 'operator_asserted';
  arithmetic_truth_status: 'verified' | 'blocked';
  truth_status: 'partial' | 'blocked';
  next_action: string;
}

const DIGEST_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/i;
const SEED_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_SAMPLES = 256;

export function parsePromotionSample(value: string): PromotionSample {
  const parts = String(value || '').split(':');
  if (parts.length !== 3) throw new Error('sample must use seed:candidate:baseline');
  const [seed, candidateText, baselineText] = parts;
  const candidate = Number(candidateText);
  const baseline = Number(baselineText);
  if (!SEED_PATTERN.test(seed)) throw new Error('sample seed must use 1-64 letters, numbers, dot, underscore, or dash');
  if (!Number.isFinite(candidate) || !Number.isFinite(baseline)) throw new Error(`sample ${seed} must contain finite candidate and baseline numbers`);
  return { seed, candidate, baseline };
}

export function buildBoundedPromotionReport(input: BoundedPromotionInput = {}): BoundedPromotionReport {
  const requestedTarget = String(input.target || 'higher');
  const target: BenchmarkDirection = requestedTarget === 'lower' ? 'lower' : 'higher';
  const minSamples = integerInRange(input.min_samples, 2, MAX_SAMPLES, 2, 'min_samples');
  const minMeanDelta = finiteAtLeast(input.min_mean_delta, 0, 0, 'min_mean_delta');
  const minWinRate = finiteRange(input.min_win_rate, 0, 1, 0.5, 'min_win_rate');
  const candidateDigest = normalizeDigest(input.candidate_digest);
  const baselineDigest = normalizeDigest(input.baseline_digest);
  const unit = boundedText(input.unit || '', 64);
  const evidenceSource = boundedText(input.evidence_source || '', 512);
  const rawSamples = Array.isArray(input.samples) ? input.samples : [];
  const validationFailures: string[] = [];

  if (!['higher', 'lower'].includes(requestedTarget)) validationFailures.push('target_invalid: target must be higher or lower');
  if (!candidateDigest) validationFailures.push('candidate_digest_invalid: record a SHA-256 candidate digest');
  if (!baselineDigest) validationFailures.push('baseline_digest_invalid: record a SHA-256 baseline digest');
  if (candidateDigest && baselineDigest && candidateDigest === baselineDigest) {
    validationFailures.push('candidate_matches_baseline: compare two distinct configuration digests');
  }
  if (!unit) validationFailures.push('unit_missing: record what each paired score measures');
  if (!evidenceSource) validationFailures.push('evidence_source_missing: record where the paired measurements came from');
  if (rawSamples.length > MAX_SAMPLES) validationFailures.push(`sample_limit_exceeded: at most ${MAX_SAMPLES} paired samples are accepted`);

  const seenSeeds = new Set<string>();
  const samples: BoundedPromotionReport['samples'] = [];
  for (const row of rawSamples.slice(0, MAX_SAMPLES)) {
    const seed = String(row?.seed || '');
    const candidate = Number(row?.candidate);
    const baseline = Number(row?.baseline);
    if (!SEED_PATTERN.test(seed)) {
      validationFailures.push('sample_seed_invalid: every seed must use 1-64 letters, numbers, dot, underscore, or dash');
      continue;
    }
    if (seenSeeds.has(seed)) {
      validationFailures.push(`duplicate_seed: ${seed}`);
      continue;
    }
    seenSeeds.add(seed);
    if (!Number.isFinite(candidate) || !Number.isFinite(baseline)) {
      validationFailures.push(`sample_not_finite: ${seed}`);
      continue;
    }
    const directionalDelta = target === 'higher' ? candidate - baseline : baseline - candidate;
    if (!Number.isFinite(directionalDelta)) {
      validationFailures.push(`sample_delta_not_finite: ${seed}`);
      continue;
    }
    samples.push({
      seed,
      candidate,
      baseline,
      directional_delta: directionalDelta,
      winner: directionalDelta > 0 ? 'candidate' : directionalDelta < 0 ? 'baseline' : 'tie'
    });
  }
  samples.sort((left, right) => left.seed < right.seed ? -1 : left.seed > right.seed ? 1 : 0);

  const candidateMean = samples.length ? mean(samples.map((sample) => sample.candidate)) : null;
  const baselineMean = samples.length ? mean(samples.map((sample) => sample.baseline)) : null;
  const directionalMeanDelta = samples.length ? mean(samples.map((sample) => sample.directional_delta)) : null;
  const winRate = samples.length ? samples.filter((sample) => sample.winner === 'candidate').length / samples.length : null;
  const failures = [...validationFailures];
  if (!validationFailures.length) {
    if (samples.length < minSamples) failures.push(`minimum_samples_not_met: observed ${samples.length}, required ${minSamples}`);
    if (directionalMeanDelta !== null && directionalMeanDelta < minMeanDelta) {
      failures.push(`minimum_mean_delta_not_met: observed ${directionalMeanDelta}, required ${minMeanDelta}`);
    }
    if (winRate !== null && winRate < minWinRate) failures.push(`minimum_win_rate_not_met: observed ${winRate}, required ${minWinRate}`);
  }

  const decision: PromotionDecision = validationFailures.length
    ? 'blocked'
    : samples.length < minSamples
      ? 'insufficient-evidence'
      : failures.length
        ? 'revert'
        : 'keep';
  const canonicalEvidence = {
    candidate_digest: candidateDigest,
    baseline_digest: baselineDigest,
    target,
    unit,
    evidence_source: evidenceSource,
    policy: { min_samples: minSamples, min_mean_delta: minMeanDelta, min_win_rate: minWinRate },
    samples: samples.map(({ seed, candidate, baseline }) => ({ seed, candidate, baseline }))
  };

  return {
    schema: 'yam.bounded-promotion-receipt.v1',
    generated_at: new Date().toISOString(),
    label: boundedText(input.label || 'unnamed', 160),
    candidate_digest: candidateDigest,
    baseline_digest: baselineDigest,
    target,
    unit,
    policy: {
      min_samples: minSamples,
      min_mean_delta: minMeanDelta,
      min_win_rate: minWinRate
    },
    samples,
    sample_count: samples.length,
    candidate_mean: candidateMean,
    baseline_mean: baselineMean,
    directional_mean_delta: directionalMeanDelta,
    win_rate: winRate,
    decision,
    failures,
    blockers: decision === 'keep' ? [] : failures,
    evidence_source: evidenceSource,
    evidence_digest: `sha256:${createHash('sha256').update(stableJson(canonicalEvidence)).digest('hex')}`,
    measurement_truth: 'operator_asserted',
    arithmetic_truth_status: validationFailures.length ? 'blocked' : 'verified',
    truth_status: validationFailures.length ? 'blocked' : 'partial',
    next_action: promotionNextAction(decision)
  };
}

function normalizeDigest(value: unknown) {
  const text = String(value || '').trim().toLowerCase();
  if (!DIGEST_PATTERN.test(text)) return '';
  return text.startsWith('sha256:') ? text : `sha256:${text}`;
}

function integerInRange(value: unknown, min: number, max: number, fallback: number, label: string) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer from ${min} to ${max}`);
  return number;
}

function finiteAtLeast(value: unknown, min: number, fallback: number, label: string) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) throw new Error(`${label} must be a finite number at least ${min}`);
  return number;
}

function finiteRange(value: unknown, min: number, max: number, fallback: number, label: string) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return number;
}

function mean(values: number[]) {
  const scale = Math.max(...values.map((value) => Math.abs(value)));
  if (scale === 0) return 0;
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const normalized = value / scale;
    const next = sum + normalized;
    compensation += Math.abs(sum) >= Math.abs(normalized)
      ? (sum - next) + normalized
      : (normalized - next) + sum;
    sum = next;
  }
  return ((sum + compensation) / values.length) * scale;
}

function boundedText(value: unknown, max: number) {
  return String(value || '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function promotionNextAction(decision: PromotionDecision) {
  if (decision === 'keep') return 'keep the candidate only with the recorded evidence source and smallest relevant regression check';
  if (decision === 'revert') return 'revert or revise the candidate because one or more promotion thresholds failed';
  if (decision === 'insufficient-evidence') return 'record more paired samples with the same explicit policy before deciding';
  return 'repair the malformed or ambiguous promotion evidence before making a keep/revert decision';
}
