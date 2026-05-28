export const TRUTH_STATUSES = Object.freeze([
  'verified',
  'proven',
  'partial',
  'fixture_only',
  'fixture_instrumented_real',
  'integration_optional',
  'real_required_missing',
  'skipped',
  'blocked',
  'assumed'
] as const);

export type TruthStatus = (typeof TRUTH_STATUSES)[number];
export type SafetyLevel = 'danger' | 'warning';
export type EvidenceKind = 'command' | 'evidence' | 'visual' | 'runtime' | 'skipped' | 'blocked' | 'assumption' | 'cleanup' | 'none';
export type RuntimeSubsystem = 'real_runtime' | 'tmux_physical' | 'process_cleanup' | 'browser_visual' | 'db_safety';

export interface SafetyHit {
  level: SafetyLevel;
  reason: string;
}

export interface DbSafetyScanResult {
  hits: SafetyHit[];
  recommendation: '$deep' | '$quick or current route';
  truth: TruthStatus;
}

export interface EvidenceRow {
  kind: EvidenceKind;
  value: string;
  truth: TruthStatus;
}

export interface RuntimeTruthRow {
  subsystem: RuntimeSubsystem;
  proof_level: TruthStatus;
  required: boolean;
  next_action: string;
}

export interface RuntimeTruthMatrix {
  schema: 'yam.runtime-truth-matrix.v1';
  ok: boolean;
  rows: RuntimeTruthRow[];
  blockers: string[];
}

export interface FakeRealPolicyResult {
  schema: 'yam.fake-real-policy.v1';
  ok: boolean;
  proof_level: TruthStatus;
  fake_claims: string[];
  real_claims: string[];
  blockers: string[];
}

export interface ProofSummary {
  route?: unknown;
  goal?: unknown;
  truth?: unknown;
  source?: unknown;
  commands?: unknown;
  evidence?: unknown;
  visual?: unknown;
  runtime?: unknown;
  cleanup?: unknown;
  changed?: unknown;
  skipped?: unknown;
  blocked?: unknown;
  assumptions?: unknown;
  unverified?: unknown;
}

export interface ProofOptions {
  requireRealRuntime?: boolean;
  requireVisual?: boolean;
  requireTmux?: boolean;
}

export interface ProofTruthCaps {
  truth: TruthStatus;
  requestedTruth: TruthStatus;
  evidenceRows: EvidenceRow[];
  caps: string[];
  blockers: string[];
  unverified: string[];
  fakeReal: FakeRealPolicyResult;
}

export interface YamCompletionProof {
  schema: 'yam.completion-proof.v1';
  generatedAt: string;
  route: unknown;
  goal: unknown;
  truth: TruthStatus;
  requestedTruth: TruthStatus;
  source: unknown;
  commands: string[];
  evidence: string[];
  visual: string[];
  runtime: string[];
  cleanup: unknown;
  changed: string[];
  skipped: string[];
  blocked: string[];
  assumptions: string[];
  unverified: string[];
  truthCaps: string[];
  evidenceRows: EvidenceRow[];
  fakeReal: FakeRealPolicyResult;
  runtimeTruth: RuntimeTruthMatrix;
}

const TRUTH_RANK: Readonly<Record<TruthStatus, number>> = Object.freeze({
  blocked: 0,
  real_required_missing: 0,
  skipped: 1,
  assumed: 1,
  fixture_only: 2,
  integration_optional: 2,
  fixture_instrumented_real: 3,
  partial: 3,
  verified: 4,
  proven: 5
});

export function isTruthStatus(value: unknown = ''): value is TruthStatus {
  return (TRUTH_STATUSES as readonly string[]).includes(String(value || ''));
}

export function weakestTruth(...statuses: unknown[]): TruthStatus {
  const valid = statuses.filter(isTruthStatus);
  if (!valid.length) return 'assumed';
  return valid.reduce((weakest, status) => {
    return TRUTH_RANK[status] < TRUTH_RANK[weakest] ? status : weakest;
  }, valid[0]);
}

export function detectDbSafetyText(text: unknown = ''): DbSafetyScanResult {
  const value = String(text || '');
  const hits: SafetyHit[] = [];
  const checks: Array<[SafetyLevel, RegExp, string]> = [
    ['danger', /\bdrop\s+(table|schema|database|view|index)\b/i, 'DROP statement can destroy database objects'],
    ['danger', /\btruncate\s+(table\s+)?[a-z0-9_".]+/i, 'TRUNCATE statement can destroy table data'],
    ['danger', /\bdelete\s+from\s+[a-z0-9_".]+/i, 'DELETE FROM can destroy row data'],
    ['danger', /\bupdate\s+[a-z0-9_".]+\s+set\b/i, 'UPDATE can mutate row data'],
    ['warning', /\balter\s+table\s+[a-z0-9_".]+/i, 'ALTER TABLE can change schema or lock production data'],
    ['danger', /\bsupabase\s+db\s+(reset|push)\b/i, 'supabase db reset/push can mutate database state'],
    ['warning', /\bsupabase\s+(migration|migrations|db\s+diff|db\s+pull)\b/i, 'Supabase migration/db command needs explicit environment awareness'],
    ['danger', /\b(prisma\s+migrate\s+(deploy|reset|dev)|drizzle-kit\s+(push|drop|migrate)|knex\s+migrate|sequelize\s+db:migrate)\b/i, 'ORM migration command can mutate schema/data'],
    ['danger', /\bpsql\b[\s\S]{0,160}\b(drop|truncate|delete\s+from|update\s+[a-z0-9_".]+\s+set|alter\s+table)\b/i, 'psql command contains destructive SQL'],
    ['warning', /\b(create\s+policy|alter\s+policy|drop\s+policy|grant\s+|revoke\s+)/i, 'RLS/policy/permission change affects data access safety']
  ];
  for (const [level, pattern, reason] of checks) {
    if (pattern.test(value)) hits.push({ level, reason });
  }
  const productionSignal = /\b(prod|production|live|remote|linked|service[_-]?role|database_url|--db-url|--linked|--remote|--project-ref)\b/i.test(value);
  if (productionSignal) hits.push({ level: 'warning', reason: 'production/remote credential or environment signal detected' });
  const unique: SafetyHit[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const key = `${hit.level}:${hit.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hit);
  }
  return {
    hits: unique,
    recommendation: unique.length ? '$deep' : '$quick or current route',
    truth: 'assumed'
  };
}

export function classifyEvidenceTruth(summary: ProofSummary = {}, options: ProofOptions = {}): EvidenceRow[] {
  const rows: EvidenceRow[] = [];
  for (const command of asList(summary.commands)) {
    rows.push(evidenceRow('command', command, commandPassed(command) ? 'verified' : 'partial'));
  }
  for (const evidence of asList(summary.evidence)) {
    rows.push(evidenceRow('evidence', evidence, classifyTextEvidence(evidence)));
  }
  for (const visual of asList(summary.visual)) {
    rows.push(evidenceRow('visual', visual, classifyVisualEvidence(visual)));
  }
  for (const runtime of asList(summary.runtime)) {
    rows.push(evidenceRow('runtime', runtime, classifyRuntimeEvidence(runtime, options)));
  }
  for (const skipped of asList(summary.skipped)) rows.push(evidenceRow('skipped', skipped, 'skipped'));
  for (const blocked of asList(summary.blocked)) rows.push(evidenceRow('blocked', blocked, 'blocked'));
  for (const assumption of asList(summary.assumptions)) rows.push(evidenceRow('assumption', assumption, 'assumed'));
  if (summary.cleanup) rows.push(evidenceRow('cleanup', summary.cleanup, classifyCleanupEvidence(summary.cleanup)));
  if (!rows.length) rows.push(evidenceRow('none', 'no evidence supplied', 'assumed'));
  return rows;
}

export function applyProofTruthCaps(summary: ProofSummary = {}, options: ProofOptions = {}): ProofTruthCaps {
  const evidenceRows = classifyEvidenceTruth(summary, options);
  const blockers: string[] = [];
  const unverified: string[] = [];
  const caps: string[] = [];
  const requested = isTruthStatus(summary.truth) ? summary.truth : 'assumed';
  const evidenceCap = strongestSupportedTruth(evidenceRows);
  let cappedTruth = weakestTruth(requested, evidenceCap);

  if (asList(summary.blocked).length) cappedTruth = 'blocked';
  if (options.requireRealRuntime && !hasRuntimeProof(evidenceRows)) {
    cappedTruth = 'real_required_missing';
    blockers.push('real_runtime_required_missing');
  }
  if (options.requireVisual && !hasRealVisualProof(evidenceRows)) {
    cappedTruth = weakestTruth(cappedTruth, 'partial');
    unverified.push('real_visual_evidence_missing');
  }
  if (requested !== cappedTruth) {
    caps.push(`requested ${requested} capped to ${cappedTruth} by evidence`);
  }
  const fakeReal = evaluateFakeRealPolicy({ summary, evidenceRows, options });
  if (fakeReal.blockers.length) {
    cappedTruth = weakestTruth(cappedTruth, fakeReal.proof_level);
    blockers.push(...fakeReal.blockers);
  }
  return {
    truth: cappedTruth,
    requestedTruth: requested,
    evidenceRows,
    caps,
    blockers: uniqueStrings(blockers),
    unverified: uniqueStrings(unverified),
    fakeReal
  };
}

export function buildRuntimeTruthMatrix(summary: ProofSummary = {}, options: ProofOptions = {}): RuntimeTruthMatrix {
  const evidenceRows = classifyEvidenceTruth(summary, options);
  const rows = [
    runtimeRow('real_runtime', hasRuntimeProof(evidenceRows) ? 'proven' : options.requireRealRuntime ? 'real_required_missing' : 'integration_optional', options.requireRealRuntime),
    runtimeRow('tmux_physical', hasText(asList(summary.runtime), /tmux/i) ? runtimeLevelFor(evidenceRows, /tmux/i, options.requireTmux) : options.requireTmux ? 'real_required_missing' : 'integration_optional', options.requireTmux),
    runtimeRow('process_cleanup', summary.cleanup ? classifyCleanupEvidence(summary.cleanup) : 'integration_optional', false),
    runtimeRow('browser_visual', hasRealVisualProof(evidenceRows) ? 'verified' : options.requireVisual ? 'real_required_missing' : 'integration_optional', options.requireVisual),
    runtimeRow('db_safety', asList(summary.evidence).some((item) => /db[_ -]?safety|supabase|database/i.test(String(item))) ? 'partial' : 'integration_optional', false)
  ];
  const blockers = rows
    .filter((row) => row.required && ['blocked', 'real_required_missing', 'integration_optional'].includes(row.proof_level))
    .map((row) => `${row.subsystem}_required_missing`);
  return {
    schema: 'yam.runtime-truth-matrix.v1',
    ok: blockers.length === 0,
    rows,
    blockers
  };
}

export function buildYamCompletionProof(summary: ProofSummary = {}, options: ProofOptions = {}): YamCompletionProof {
  const capped = applyProofTruthCaps(summary, options);
  const runtimeTruth = buildRuntimeTruthMatrix(summary, options);
  return {
    schema: 'yam.completion-proof.v1',
    generatedAt: new Date().toISOString(),
    route: summary.route || 'unspecified',
    goal: summary.goal || '',
    truth: capped.truth,
    requestedTruth: capped.requestedTruth,
    source: summary.source || '',
    commands: asList(summary.commands),
    evidence: asList(summary.evidence),
    visual: asList(summary.visual),
    runtime: asList(summary.runtime),
    cleanup: summary.cleanup || '',
    changed: asList(summary.changed),
    skipped: asList(summary.skipped),
    blocked: uniqueStrings([...asList(summary.blocked), ...capped.blockers]),
    assumptions: asList(summary.assumptions),
    unverified: uniqueStrings([...asList(summary.unverified), ...capped.unverified]),
    truthCaps: capped.caps,
    evidenceRows: capped.evidenceRows,
    fakeReal: capped.fakeReal,
    runtimeTruth
  };
}

function classifyTextEvidence(value: unknown = ''): TruthStatus {
  const text = String(value || '');
  if (/mock|fixture|stub|fake/i.test(text)) return 'fixture_only';
  if (/browser|screenshot|playwright|test.*pass|passed|build.*pass|typecheck.*pass|lint.*pass|verified/i.test(text)) return 'verified';
  if (/blocked|failed|error/i.test(text)) return 'blocked';
  if (/read|inspect|review|inferred|assumed|source/i.test(text)) return 'assumed';
  return 'partial';
}

function classifyVisualEvidence(value: unknown = ''): TruthStatus {
  const text = String(value || '');
  if (/blocked|unavailable|could not|missing/i.test(text)) return 'blocked';
  if (/reference[-_ ]?only|reference image|generated|annotation|mock|fixture|text[-_ ]?only|code[-_ ]?only/i.test(text)) return 'partial';
  if (/browser|screenshot|screen capture|viewport|mobile|desktop|playwright|chrome/i.test(text)) return 'verified';
  return 'partial';
}

function classifyRuntimeEvidence(value: unknown = '', options: ProofOptions = {}): TruthStatus {
  const text = String(value || '');
  if (/blocked|missing|unavailable|failed/i.test(text)) return options.requireRealRuntime ? 'real_required_missing' : 'blocked';
  if (/fixture|mock|fake/i.test(text)) return 'fixture_only';
  if (/tmux|pid|process|port|server|watcher|browser qa|exit verified|closed|cleanup verified/i.test(text)) return 'proven';
  return 'partial';
}

function classifyCleanupEvidence(value: unknown = ''): TruthStatus {
  const text = String(value || '');
  if (/exit verified|closed|stopped|no runtime started|not started|intentionally left running/i.test(text)) return 'proven';
  if (/not checked|unknown|assumed/i.test(text)) return 'assumed';
  if (/blocked|failed|missing/i.test(text)) return 'blocked';
  return 'partial';
}

function commandPassed(value: unknown = ''): boolean {
  return /pass|passed|ok|success|exit\s*0|green/i.test(String(value || '')) && !/fail|failed|error|blocked/i.test(String(value || ''));
}

function strongestSupportedTruth(rows: EvidenceRow[] = []): TruthStatus {
  if (rows.some((row) => row.truth === 'blocked')) return 'blocked';
  if (rows.some((row) => row.truth === 'real_required_missing')) return 'real_required_missing';
  if (rows.some((row) => row.truth === 'fixture_only')) return 'fixture_only';
  if (rows.some((row) => row.truth === 'proven')) return 'proven';
  if (rows.some((row) => row.truth === 'verified')) return 'verified';
  if (rows.some((row) => row.truth === 'partial')) return 'partial';
  if (rows.some((row) => row.truth === 'skipped')) return 'skipped';
  return 'assumed';
}

interface FakeRealPolicyInput {
  summary?: ProofSummary;
  evidenceRows?: EvidenceRow[];
  options?: ProofOptions;
}

function evaluateFakeRealPolicy({ summary = {}, evidenceRows = [], options = {} }: FakeRealPolicyInput): FakeRealPolicyResult {
  const fakeClaims = evidenceRows.filter((row) => ['fixture_only'].includes(row.truth)).map((row) => `${row.kind}:${row.value}`);
  const realClaims = evidenceRows.filter((row) => ['verified', 'proven'].includes(row.truth)).map((row) => `${row.kind}:${row.value}`);
  const blockers: string[] = [];
  if (options.requireRealRuntime && !hasRuntimeProof(evidenceRows)) blockers.push('real_runtime_required_missing');
  if (summary.truth === 'verified' && fakeClaims.length && !realClaims.length) blockers.push('fixture_or_fake_evidence_cannot_verify_real_status');
  const proofLevel: TruthStatus = blockers.length ? 'real_required_missing'
    : fakeClaims.length && !realClaims.length ? 'fixture_only'
      : realClaims.some((claim) => claim.startsWith('runtime:') || claim.startsWith('cleanup:')) ? 'proven'
        : realClaims.length ? 'verified'
          : 'assumed';
  return {
    schema: 'yam.fake-real-policy.v1',
    ok: blockers.length === 0,
    proof_level: proofLevel,
    fake_claims: fakeClaims,
    real_claims: realClaims,
    blockers
  };
}

function hasRuntimeProof(rows: EvidenceRow[] = []): boolean {
  return rows.some((row) => (row.kind === 'runtime' || row.kind === 'cleanup') && ['proven', 'verified'].includes(row.truth));
}

function hasRealVisualProof(rows: EvidenceRow[] = []): boolean {
  return rows.some((row) => row.kind === 'visual' && row.truth === 'verified');
}

function runtimeLevelFor(rows: EvidenceRow[] = [], pattern: RegExp, required = false): TruthStatus {
  const matching = rows.filter((row) => row.kind === 'runtime' && pattern.test(row.value));
  if (!matching.length) return required ? 'real_required_missing' : 'integration_optional';
  return strongestSupportedTruth(matching);
}

function runtimeRow(subsystem: RuntimeSubsystem, proofLevel: TruthStatus, required?: boolean): RuntimeTruthRow {
  return {
    subsystem,
    proof_level: proofLevel,
    required: Boolean(required),
    next_action: proofLevel === 'integration_optional' || proofLevel === 'real_required_missing'
      ? `collect ${subsystem} evidence when the claim requires it`
      : 'no action required'
  };
}

function evidenceRow(kind: EvidenceKind, value: unknown, truth: TruthStatus): EvidenceRow {
  return { kind, value: String(value || ''), truth };
}

function hasText(values: unknown[] = [], pattern: RegExp): boolean {
  return values.some((value) => pattern.test(String(value || '')));
}

function asList(value?: unknown): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [String(value)].filter(Boolean);
}

function uniqueStrings(values: unknown[] = []): string[] {
  return [...new Set(values.filter(Boolean).map(String))];
}
