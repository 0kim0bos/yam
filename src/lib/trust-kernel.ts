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
export type RuntimeBackend = 'none' | 'in_app_browser' | 'playwright' | 'terminal' | 'tmux' | 'zellij' | 'unknown';
export type RuntimeClaim = 'not_started' | 'started' | 'observed' | 'stopped' | 'cleanup_verified' | 'blocked' | 'unknown';

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

export interface UeyeVisualProvenance {
  schema: 'yam.ueye-visual-provenance.v1';
  source_kind: string;
  source_path: string;
  source_hash: string;
  reference_id: string;
  screenshot_id: string;
  provider_context: string;
  provider_badge: string;
  execution_surface: string;
  app_surface: string;
  browser_surface: string;
  local_only: boolean;
  redacted: boolean;
  operator_provided: boolean;
  comparison_result: string;
  truth_status: TruthStatus;
}

export interface UeyeSurfaceContext {
  schema: 'yam.ueye-surface-context.v1';
  provider_context: string;
  provider_badge: string;
  execution_surface: string;
  app_surface: string;
  browser_surface: string;
  control_mode: string;
  route: string;
  mode: string;
  url: string;
  viewport: string;
  screenshot_id: string;
  evidence_id: string;
  preserved_state: boolean;
  preserved_url: string;
  local_only: boolean;
  truth_status: TruthStatus;
}

export interface UeyeDesignGateCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'warning' | 'not_checked';
  required: boolean;
  next_action: string;
}

export interface UeyeDesignCompletionGate {
  schema: 'yam.ueye-design-completion-gate.v1';
  mode: 'fast' | 'strict';
  completion_claim: 'draft' | 'needs-polish' | 'done';
  ready_to_claim_done: boolean;
  design_score: number | null;
  min_design_score: number;
  checks: UeyeDesignGateCheck[];
  p0: string[];
  p1: string[];
  warnings: string[];
  blockers: string[];
  next_action: string;
  truth_status: TruthStatus;
}

export interface RollbackHint {
  schema: 'yam.rollback-hint.v1';
  touched_files: string[];
  generated_files: string[];
  before_check: string;
  safe_revert_note: string;
}

export interface MissionPatchEnvelope {
  schema: 'yam.mission-patch-envelope.v1';
  agent_id: string;
  assigned_scope: string;
  changed_files: string[];
  verification_hint: string;
  rollback_hint: RollbackHint;
  truth_status: TruthStatus;
}

export interface RuntimeBackendEvidence {
  schema: 'yam.runtime-backend-evidence.v1';
  backend: RuntimeBackend;
  claim: RuntimeClaim;
  evidence_id: string;
  command: string;
  cleanup_checked: boolean;
  started_at: string;
  stopped_at: string;
  exit_code: number | null;
  pid: number | null;
  port: number | null;
  cleanup_method: string;
  cleanup_observed: boolean;
  left_running_intentionally: boolean;
  note: string;
  truth_status: TruthStatus;
}

export interface UeyeRunReport {
  schema: 'yam.ueye-run-report.v1';
  reference_sources: UeyeVisualProvenance[];
  implementation_sources: UeyeVisualProvenance[];
  surface_context: UeyeSurfaceContext;
  design_completion_gate: UeyeDesignCompletionGate;
  comparison_result: string;
  design_quality: string;
  blocked_reason: string;
  next_action: string;
  truth_status: TruthStatus;
}

export interface UeyeRunReportInput extends Partial<Omit<UeyeRunReport, 'design_completion_gate'>> {
  design_completion_gate?: Partial<UeyeDesignCompletionGate> & Record<string, unknown>;
}

export interface MediaGenerationProof {
  schema: 'yam.media-generation-proof.v1';
  tool_name: string;
  generation_requested: boolean;
  generation_attempted: boolean;
  output_path: string;
  output_hash: string;
  wait_loop_checked: boolean;
  blocked_reason: string;
  next_action: string;
  truth_status: TruthStatus;
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
  visualProvenance?: unknown;
  missionEnvelope?: unknown;
  rollbackHint?: unknown;
  runtimeBackendEvidence?: unknown;
  mediaProof?: unknown;
  designCompletion?: unknown;
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
  visualProvenance: string[];
  missionEnvelope: string[];
  rollbackHint: string[];
  runtimeBackendEvidence: string[];
  mediaProof: string[];
  designCompletion: string[];
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

export function buildUeyeVisualProvenance(input: Partial<UeyeVisualProvenance> = {}): UeyeVisualProvenance {
  const truth = isTruthStatus(input.truth_status) ? input.truth_status : 'partial';
  return {
    schema: 'yam.ueye-visual-provenance.v1',
    source_kind: String(input.source_kind || ''),
    source_path: String(input.source_path || ''),
    source_hash: String(input.source_hash || 'unknown'),
    reference_id: String(input.reference_id || ''),
    screenshot_id: String(input.screenshot_id || ''),
    provider_context: String(input.provider_context || 'not-recorded'),
    provider_badge: String(input.provider_badge || 'not-recorded'),
    execution_surface: String(input.execution_surface || 'not-recorded'),
    app_surface: String(input.app_surface || 'not-recorded'),
    browser_surface: String(input.browser_surface || 'not-recorded'),
    local_only: Boolean(input.local_only),
    redacted: Boolean(input.redacted),
    operator_provided: Boolean(input.operator_provided),
    comparison_result: String(input.comparison_result || 'not-verified'),
    truth_status: truth
  };
}

export function buildUeyeSurfaceContext(input: Partial<UeyeSurfaceContext> = {}): UeyeSurfaceContext {
  return {
    schema: 'yam.ueye-surface-context.v1',
    provider_context: String(input.provider_context || 'not-recorded'),
    provider_badge: String(input.provider_badge || input.provider_context || 'not-recorded'),
    execution_surface: String(input.execution_surface || 'not-recorded'),
    app_surface: String(input.app_surface || 'not-recorded'),
    browser_surface: String(input.browser_surface || 'not-recorded'),
    control_mode: String(input.control_mode || 'not-recorded'),
    route: String(input.route || 'ueye'),
    mode: String(input.mode || 'report'),
    url: String(input.url || ''),
    viewport: String(input.viewport || ''),
    screenshot_id: String(input.screenshot_id || ''),
    evidence_id: String(input.evidence_id || ''),
    preserved_state: Boolean(input.preserved_state),
    preserved_url: String(input.preserved_url || ''),
    local_only: input.local_only !== undefined ? Boolean(input.local_only) : true,
    truth_status: isTruthStatus(input.truth_status) ? input.truth_status : 'partial'
  };
}

export function buildUeyeDesignCompletionGate(input: Partial<UeyeDesignCompletionGate> & Record<string, unknown> = {}): UeyeDesignCompletionGate {
  const completionClaim = normalizeUeyeCompletionClaim(input.completion_claim);
  const mode = String(input.mode || '').toLowerCase() === 'strict' || completionClaim === 'done' ? 'strict' : 'fast';
  const designScore = numberOrNull(input.design_score);
  const minDesignScore = numberOrNull(input.min_design_score) ?? 8;
  const p0 = asList(input.p0);
  const p1 = asList(input.p1);
  const hasReference = Boolean(input.has_reference);
  const hasImplementation = Boolean(input.has_implementation_screenshot);
  const comparisonResult = String(input.comparison_result || 'not-verified');
  const designQuality = String(input.design_quality || 'not-checked');
  const blockedReason = String(input.blocked_reason || '');
  const strictOrDone = mode === 'strict' || completionClaim === 'done';
  const checks: UeyeDesignGateCheck[] = [
    designGateCheck('direction_lock', 'Design direction and target screen were locked before judging completion', Boolean(input.direction_locked) ? 'pass' : 'not_checked', strictOrDone, 'record the target screen and design direction before claiming done'),
    designGateCheck('reference_read', 'Reference read proof exists when reference is used', !hasReference ? 'not_checked' : Boolean(input.reference_read) ? 'pass' : 'fail', hasReference && strictOrDone, 'record concrete reference observations before claiming reference-led work is done'),
    designGateCheck('implementation_screenshot', 'Real implementation screenshot or screen evidence exists', hasImplementation ? 'pass' : 'fail', strictOrDone, 'capture or provide implementation screenshot before claiming done'),
    designGateCheck('reference_comparison', 'Reference comparison is recorded when reference is used', !hasReference ? 'not_checked' : ['matched', 'similar', 'not-applicable'].includes(comparisonResult) ? 'pass' : 'fail', hasReference, 'compare against the reference or mark the difference as intentional before claiming done'),
    designGateCheck('design_quality', 'Design quality result is pass', designQuality === 'pass' ? 'pass' : designQuality === 'needs-polish' ? 'warning' : 'fail', strictOrDone, 'resolve design quality issues or keep the result as needs-polish/partial'),
    designGateCheck('p0_clear', 'No P0 visual blockers remain', p0.length ? 'fail' : 'pass', true, 'fix P0 blockers before any done claim'),
    designGateCheck('p1_clear', 'No P1 major visual issues remain', p1.length ? 'fail' : 'pass', strictOrDone, 'fix or explicitly defer P1 issues before claiming done'),
    designGateCheck('cta_affordance', 'Primary CTA and interaction affordances were checked', Boolean(input.cta_checked) ? 'pass' : 'not_checked', strictOrDone, 'check primary CTA clarity and interaction affordances before claiming done'),
    designGateCheck('state_coverage', 'Primary UI states were checked', Boolean(input.states_checked) ? 'pass' : 'not_checked', strictOrDone, 'check default/loading/error/empty/disabled states or keep completion partial'),
    designGateCheck('mobile_coverage', 'Mobile/responsive behavior was checked', Boolean(input.mobile_checked || input.responsive_checked) ? 'pass' : 'not_checked', strictOrDone, 'check mobile/responsive behavior before claiming done'),
    designGateCheck('accessibility_visuals', 'Contrast/accessibility-relevant visuals were checked', Boolean(input.contrast_checked || input.accessibility_checked) ? 'pass' : 'not_checked', strictOrDone, 'check contrast/accessibility-relevant visuals before claiming done')
  ];
  if (designScore !== null || strictOrDone) {
    checks.push(designGateCheck('design_score', `Design score is at least ${minDesignScore}`, designScore !== null && designScore >= minDesignScore ? 'pass' : designScore === null ? 'not_checked' : 'fail', false, `record --design-score ${minDesignScore} or higher when using score-based completion`));
  }
  const blockers = [
    ...p0.map((item) => `P0: ${item}`),
    ...(blockedReason ? [blockedReason] : []),
    ...checks
      .filter((check) => check.required && check.status !== 'pass')
      .map((check) => `${check.id}: ${check.next_action}`)
  ];
  const warnings = [
    ...p1.map((item) => `P1: ${item}`),
    ...checks
      .filter((check) => !check.required && ['fail', 'warning', 'not_checked'].includes(check.status))
      .map((check) => `${check.id}: ${check.next_action}`)
  ];
  const ready = completionClaim === 'done' && blockers.length === 0;
  const truth: TruthStatus = blockers.some((item) => item.startsWith('P0:')) || blockedReason ? 'blocked'
    : ready ? 'verified'
      : strictOrDone ? 'partial'
        : hasImplementation ? 'partial'
          : 'assumed';
  return {
    schema: 'yam.ueye-design-completion-gate.v1',
    mode,
    completion_claim: completionClaim,
    ready_to_claim_done: ready,
    design_score: designScore,
    min_design_score: minDesignScore,
    checks,
    p0,
    p1,
    warnings,
    blockers,
    next_action: blockers[0] || (ready ? 'done claim is supported by the recorded design gate' : warnings[0] || 'keep the Ueye result as draft or needs-polish until a done claim is needed'),
    truth_status: truth
  };
}

function normalizeUeyeCompletionClaim(value: unknown = ''): UeyeDesignCompletionGate['completion_claim'] {
  const text = String(value || '').toLowerCase();
  if (text === 'done' || text === 'complete' || text === 'completed') return 'done';
  if (text === 'needs-polish' || text === 'needs_polish' || text === 'polish') return 'needs-polish';
  return 'draft';
}

function designGateCheck(id: string, label: string, status: UeyeDesignGateCheck['status'], required: boolean, nextAction: string): UeyeDesignGateCheck {
  return {
    id,
    label,
    status,
    required,
    next_action: nextAction
  };
}

function numberOrNull(value: unknown = null): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function buildRollbackHint(input: Partial<RollbackHint> = {}): RollbackHint {
  return {
    schema: 'yam.rollback-hint.v1',
    touched_files: asList(input.touched_files),
    generated_files: asList(input.generated_files),
    before_check: String(input.before_check || ''),
    safe_revert_note: String(input.safe_revert_note || '')
  };
}

export function buildMissionPatchEnvelope(input: Partial<MissionPatchEnvelope> = {}): MissionPatchEnvelope {
  const rollback = input.rollback_hint && typeof input.rollback_hint === 'object'
    ? buildRollbackHint(input.rollback_hint)
    : buildRollbackHint();
  return {
    schema: 'yam.mission-patch-envelope.v1',
    agent_id: String(input.agent_id || ''),
    assigned_scope: String(input.assigned_scope || ''),
    changed_files: asList(input.changed_files),
    verification_hint: String(input.verification_hint || ''),
    rollback_hint: rollback,
    truth_status: isTruthStatus(input.truth_status) ? input.truth_status : 'partial'
  };
}

export function buildRuntimeBackendEvidence(input: Partial<RuntimeBackendEvidence> = {}): RuntimeBackendEvidence {
  const backend = normalizeRuntimeBackend(input.backend);
  const claim = normalizeRuntimeClaim(input.claim);
  const cleanupObserved = Boolean(input.cleanup_observed);
  const leftRunningIntentionally = Boolean(input.left_running_intentionally);
  const exitCode = numberOrNull(input.exit_code);
  const pid = numberOrNull(input.pid);
  const port = numberOrNull(input.port);
  const stoppedAt = String(input.stopped_at || '');
  const cleanupMethod = String(input.cleanup_method || '');
  return {
    schema: 'yam.runtime-backend-evidence.v1',
    backend,
    claim,
    evidence_id: String(input.evidence_id || ''),
    command: String(input.command || ''),
    cleanup_checked: Boolean(input.cleanup_checked),
    started_at: String(input.started_at || ''),
    stopped_at: stoppedAt,
    exit_code: exitCode,
    pid,
    port,
    cleanup_method: cleanupMethod,
    cleanup_observed: cleanupObserved,
    left_running_intentionally: leftRunningIntentionally,
    note: String(input.note || ''),
    truth_status: isTruthStatus(input.truth_status) ? input.truth_status : runtimeBackendTruth(backend, claim, {
      cleanupChecked: Boolean(input.cleanup_checked),
      cleanupObserved,
      leftRunningIntentionally,
      stoppedAt,
      exitCode,
      pid,
      cleanupMethod
    })
  };
}

export function buildUeyeRunReport(input: UeyeRunReportInput = {}): UeyeRunReport {
  const references = Array.isArray(input.reference_sources)
    ? input.reference_sources.map((item) => buildUeyeVisualProvenance(item))
    : [];
  const implementations = Array.isArray(input.implementation_sources)
    ? input.implementation_sources.map((item) => buildUeyeVisualProvenance(item))
    : [];
  const blockedReason = String(input.blocked_reason || '');
  const comparisonResult = String(input.comparison_result || 'not-verified');
  const hasImplementation = implementations.length > 0;
  const derivedTruth: TruthStatus = blockedReason ? 'blocked'
    : !references.length && !hasImplementation ? 'assumed'
      : comparisonResult === 'matched' && hasImplementation ? 'verified'
        : hasImplementation ? 'partial'
          : 'partial';
  const gate = buildUeyeDesignCompletionGate({
    ...input.design_completion_gate,
    has_reference: references.length > 0,
    has_implementation_screenshot: hasImplementation,
    comparison_result: comparisonResult,
    design_quality: String(input.design_quality || 'not-checked'),
    blocked_reason: blockedReason
  });
  const shouldApplyDesignGate = gate.mode === 'strict' || gate.completion_claim === 'done' || gate.blockers.length > 0;
  const finalTruth = shouldApplyDesignGate ? weakestTruth(derivedTruth, gate.truth_status) : derivedTruth;
  return {
    schema: 'yam.ueye-run-report.v1',
    reference_sources: references,
    implementation_sources: implementations,
    surface_context: buildUeyeSurfaceContext({
      ...input.surface_context,
      truth_status: isTruthStatus(input.surface_context?.truth_status) ? input.surface_context?.truth_status : finalTruth
    }),
    design_completion_gate: gate,
    comparison_result: comparisonResult,
    design_quality: String(input.design_quality || 'not-checked'),
    blocked_reason: blockedReason,
    next_action: String(input.next_action || gate.blockers[0] || (finalTruth === 'verified' ? 'no action required' : 'capture or provide implementation screenshot before claiming verified visual status')),
    truth_status: isTruthStatus(input.truth_status) ? input.truth_status : finalTruth
  };
}

export function buildMediaGenerationProof(input: Partial<MediaGenerationProof> = {}): MediaGenerationProof {
  const requested = Boolean(input.generation_requested);
  const attempted = Boolean(input.generation_attempted);
  const outputHash = String(input.output_hash || 'unknown');
  const blockedReason = String(input.blocked_reason || '');
  const derivedTruth: TruthStatus = blockedReason ? 'blocked'
    : requested && !attempted ? 'blocked'
      : attempted && outputHash !== 'unknown' ? 'verified'
        : attempted ? 'partial'
          : requested ? 'assumed'
            : 'skipped';
  return {
    schema: 'yam.media-generation-proof.v1',
    tool_name: String(input.tool_name || ''),
    generation_requested: requested,
    generation_attempted: attempted,
    output_path: String(input.output_path || ''),
    output_hash: outputHash,
    wait_loop_checked: Boolean(input.wait_loop_checked),
    blocked_reason: blockedReason,
    next_action: String(input.next_action || (derivedTruth === 'blocked' ? 'provide a usable media tool or mark generation as skipped' : 'record output evidence before using generated media as implementation proof')),
    truth_status: isTruthStatus(input.truth_status) ? input.truth_status : derivedTruth
  };
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
  for (const provenance of asList(summary.visualProvenance)) {
    rows.push(evidenceRow('visual', provenance, metadataTruth(provenance, 'partial')));
  }
  for (const envelope of asList(summary.missionEnvelope)) {
    rows.push(evidenceRow('evidence', envelope, metadataTruth(envelope, 'partial')));
  }
  for (const rollback of asList(summary.rollbackHint)) {
    rows.push(evidenceRow('evidence', rollback, metadataTruth(rollback, 'partial')));
  }
  for (const backend of asList(summary.runtimeBackendEvidence)) {
    rows.push(evidenceRow('runtime', backend, readStructuredTruth(backend, 'partial')));
  }
  for (const media of asList(summary.mediaProof)) {
    rows.push(evidenceRow('evidence', media, readStructuredTruth(media, 'partial')));
  }
  for (const designCompletion of asList(summary.designCompletion)) {
    rows.push(evidenceRow('visual', designCompletion, readStructuredTruth(designCompletion, 'partial')));
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
  const designCompletionTruth = designCompletionCap(summary.designCompletion);
  if (designCompletionTruth) {
    cappedTruth = weakestTruth(cappedTruth, designCompletionTruth);
    if (designCompletionTruth === 'blocked') blockers.push('ueye_design_completion_blocked');
    if (!['verified', 'proven'].includes(designCompletionTruth)) {
      unverified.push('ueye_design_completion_not_verified');
    }
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
    visualProvenance: asList(summary.visualProvenance),
    missionEnvelope: asList(summary.missionEnvelope),
    rollbackHint: asList(summary.rollbackHint),
    runtimeBackendEvidence: asList(summary.runtimeBackendEvidence),
    mediaProof: asList(summary.mediaProof),
    designCompletion: asList(summary.designCompletion),
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

function metadataTruth(value: unknown = '', fallback: TruthStatus = 'partial'): TruthStatus {
  return weakestTruth(readStructuredTruth(value, fallback), 'partial');
}

function readStructuredTruth(value: unknown = '', fallback: TruthStatus = 'partial'): TruthStatus {
  if (typeof value === 'object' && value) {
    const candidate = (value as { truth_status?: unknown; truth?: unknown }).truth_status || (value as { truth?: unknown }).truth;
    return isTruthStatus(candidate) ? candidate : fallback;
  }
  const text = String(value || '');
  try {
    const data = JSON.parse(text);
    const candidate = data.truth_status || data.truth;
    return isTruthStatus(candidate) ? candidate : fallback;
  } catch {
    return fallback;
  }
}

function designCompletionCap(value: unknown = ''): TruthStatus | null {
  const items = asList(value);
  if (!items.length) return null;
  return items.reduce<TruthStatus>((weakest, item) => weakestTruth(weakest, readStructuredTruth(item, 'partial')), 'proven');
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

function normalizeRuntimeBackend(value: unknown = ''): RuntimeBackend {
  const text = String(value || '').toLowerCase().replace(/[-\s]/g, '_');
  if (text === 'in_app_browser' || text === 'browser') return 'in_app_browser';
  if (text === 'playwright') return 'playwright';
  if (text === 'terminal' || text === 'shell') return 'terminal';
  if (text === 'tmux') return 'tmux';
  if (text === 'zellij') return 'zellij';
  if (text === 'none' || text === 'not_started') return 'none';
  return 'unknown';
}

function normalizeRuntimeClaim(value: unknown = ''): RuntimeClaim {
  const text = String(value || '').toLowerCase().replace(/[-\s]/g, '_');
  if (text === 'not_started' || text === 'none') return 'not_started';
  if (text === 'started') return 'started';
  if (text === 'observed' || text === 'checked') return 'observed';
  if (text === 'stopped') return 'stopped';
  if (text === 'cleanup_verified' || text === 'cleanup_checked') return 'cleanup_verified';
  if (text === 'blocked') return 'blocked';
  return 'unknown';
}

function runtimeBackendTruth(backend: RuntimeBackend, claim: RuntimeClaim, details: {
  cleanupChecked?: boolean;
  cleanupObserved?: boolean;
  leftRunningIntentionally?: boolean;
  stoppedAt?: string;
  exitCode?: number | null;
  pid?: number | null;
  cleanupMethod?: string;
} = {}): TruthStatus {
  if (claim === 'blocked') return 'blocked';
  if (backend === 'none' || claim === 'not_started') return 'skipped';
  if (backend === 'unknown' || claim === 'unknown') return 'partial';
  const hasClosureEvidence = Boolean(details.stoppedAt || details.exitCode !== null || details.cleanupMethod);
  if (claim === 'cleanup_verified' || details.cleanupChecked) {
    if (details.cleanupObserved && hasClosureEvidence) return 'proven';
    if (details.leftRunningIntentionally && (details.pid !== null || details.cleanupMethod)) return 'partial';
    return 'real_required_missing';
  }
  if (claim === 'observed' || claim === 'stopped' || claim === 'started') return 'verified';
  return 'partial';
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
