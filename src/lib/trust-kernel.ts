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
export type LoopStageStatus = 'passed' | 'failed' | 'blocked' | 'skipped' | 'partial' | 'pending' | 'recorded';
export type LoopEvidenceLevel = 'none' | 'fixture' | 'smoke' | 'local' | 'real';
export type ToolIntent = 'read_only' | 'write' | 'destructive' | 'runtime' | 'visual' | 'publish';
export type ReadinessState = 'usable' | 'degraded' | 'blocked' | 'unknown';
export type MissionLaneRole = 'implementer' | 'reviewer' | 'ux_verifier' | 'doctor' | 'other';
export type MissionAccessMode = 'read_only' | 'write';
export type MissionLifecycleStatus = 'pending' | 'running' | 'stopped' | 'failed' | 'cancelled';
export type MissionOutcome = 'passed' | 'failed' | 'blocked' | 'ambiguous';

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

export interface MissionContractCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'warning';
  next_action: string;
}

export interface MissionSubagentReceipt {
  schema: 'yam.mission-subagent-receipt.v1';
  receipt_id: string;
  generated_at: string;
  thread_id: string;
  lane_id: string;
  agent_id: string;
  role: MissionLaneRole;
  access_mode: MissionAccessMode;
  lifecycle_status: MissionLifecycleStatus;
  outcome: MissionOutcome;
  assigned_scope: string;
  changed_files: string[];
  verification_evidence: string[];
  remaining_risks: string[];
  checks: MissionContractCheck[];
  blockers: string[];
  warnings: string[];
  completion_eligible: boolean;
  truth_status: TruthStatus;
}

export interface MissionCompletionGate {
  schema: 'yam.mission-completion-gate.v1';
  generated_at: string;
  expected_thread_ids: string[];
  receipt_count: number;
  receipts: MissionSubagentReceipt[];
  missing_thread_ids: string[];
  duplicate_thread_ids: string[];
  unexpected_thread_ids: string[];
  invalid_thread_ids: string[];
  read_only_violations: string[];
  blockers: string[];
  warnings: string[];
  ready_to_claim_complete: boolean;
  next_action: string;
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

export interface StudyNoteSection {
  code: string;
  role: string;
  symptom?: string;
  summary?: string;
  truth_status: TruthStatus;
}

export interface StudyNote {
  schema: 'yam.study-note.v1';
  problem: StudyNoteSection;
  change: StudyNoteSection;
  why_it_matters: string;
  learning_note: string;
  limits: string[];
  truth_status: TruthStatus;
}

export interface LoopStage {
  id: string;
  status: LoopStageStatus;
  note: string;
  truth_status: TruthStatus;
}

export interface LoopReport {
  schema: 'yam.loop-report.v1';
  generated_at: string;
  route: string;
  intent: string;
  loop_kind: string;
  stage_conventions: string[];
  stages: LoopStage[];
  evidence: string[];
  evidence_level: LoopEvidenceLevel;
  evidence_stamp: string;
  source_digest: string;
  touched_files: string[];
  read_files: string[];
  verified_files: string[];
  skipped_checks: string[];
  stop_condition: string;
  resume_hint: string;
  readiness_state: ReadinessState;
  covered_requirements: string[];
  uncovered_requirements: string[];
  blockers: string[];
  blocked_kind: string;
  failure_cause: string;
  truth_status: TruthStatus;
  intent_label: ToolIntent;
  tool_intent: ToolIntent;
  next_action: string;
  safe_retry: string;
  recovery_hint: string;
  fix_first_items: string[];
  remaining_tasks: string[];
  recommended_direction: string;
  implementation_notes: string[];
  why_this_next: string;
  blocked_by: string[];
  owner_route: string;
  owner_scope: string[];
  scope_owner: string;
  side_effects: string[];
  avoidance_note: string;
  study_note: StudyNote;
}

export interface UeyeRunReport {
  schema: 'yam.ueye-run-report.v1';
  reference_sources: UeyeVisualProvenance[];
  implementation_sources: UeyeVisualProvenance[];
  surface_context: UeyeSurfaceContext;
  design_completion_gate: UeyeDesignCompletionGate;
  deep_visual_review: UeyeDeepVisualReview;
  comparison_result: string;
  design_quality: string;
  blocked_reason: string;
  next_action: string;
  truth_status: TruthStatus;
}

export interface UeyeRunReportInput extends Partial<Omit<UeyeRunReport, 'design_completion_gate' | 'deep_visual_review'>> {
  design_completion_gate?: Partial<UeyeDesignCompletionGate> & Record<string, unknown>;
  deep_visual_review?: Partial<UeyeDeepVisualReview> & Record<string, unknown>;
}

export interface UeyeDeepVisualReview {
  schema: 'yam.ueye-deep-visual-review.v1';
  acceptance_criteria: string[];
  touched_files: string[];
  read_files: string[];
  verified_files: string[];
  skipped_checks: string[];
  residual_risks: string[];
  stop_condition: string;
  resume_hint: string;
  deep_visual_checks: string[];
  design_system_evidence: string[];
  state_matrix: Record<string, string>;
  implementation_evidence: string[];
  blockers: string[];
  warnings: string[];
  next_action: string;
  truth_status: TruthStatus;
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
  missionReceipt?: unknown;
  missionCompletion?: unknown;
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
  missionReceipt: string[];
  missionCompletion: string[];
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

export function buildMissionSubagentReceipt(input: Partial<MissionSubagentReceipt> & Record<string, unknown> = {}): MissionSubagentReceipt {
  const role = normalizeMissionLaneRole(input.role);
  const accessMode = normalizeMissionAccessMode(input.access_mode, role);
  const lifecycleStatus = normalizeMissionLifecycleStatus(input.lifecycle_status);
  const outcome = normalizeMissionOutcome(input.outcome);
  const threadId = String(input.thread_id || '');
  const assignedScope = String(input.assigned_scope || '');
  const changedFiles = asList(input.changed_files);
  const verificationEvidence = asList(input.verification_evidence);
  const remainingRisks = asList(input.remaining_risks);
  const readOnlyRole = role === 'reviewer' || role === 'doctor';
  const checks = [
    missionContractCheck('thread_id', 'Thread id is recorded', Boolean(threadId), 'record --thread-id for every spawned thread'),
    missionContractCheck('assigned_scope', 'Assigned scope is recorded', Boolean(assignedScope), 'record the bounded lane scope'),
    missionContractCheck('read_only_role', 'Reviewer and doctor lanes stay read-only', !readOnlyRole || (accessMode === 'read_only' && changedFiles.length === 0), 'rerun reviewer/doctor without write access or changed files'),
    missionContractCheck('terminal_lifecycle', 'Lifecycle reached a terminal state', ['stopped', 'failed', 'cancelled'].includes(lifecycleStatus), 'wait for a terminal lifecycle event before finalization'),
    missionContractCheck('explicit_outcome', 'Outcome is explicit and unambiguous', outcome !== 'ambiguous', 'record passed, failed, or blocked; a stop event alone is not success evidence'),
    missionContractCheck('passed_evidence', 'Passed outcome has verification evidence', outcome !== 'passed' || verificationEvidence.length > 0, 'attach at least one concrete verification item for a passed outcome')
  ];
  const blockers = checks.filter((check) => check.status === 'fail').map((check) => `${check.id}: ${check.next_action}`);
  if (outcome === 'failed' || outcome === 'blocked') blockers.push(`outcome_${outcome}: resolve or hand off this thread before mission completion`);
  if ((lifecycleStatus === 'failed' || lifecycleStatus === 'cancelled') && outcome === 'passed') {
    blockers.push('lifecycle_outcome_conflict: a failed or cancelled lifecycle cannot claim a passed outcome');
  }
  const warnings = remainingRisks.length ? ['remaining risks are recorded and must be included in the mission handoff'] : [];
  const completionEligible = blockers.length === 0 && lifecycleStatus === 'stopped' && outcome === 'passed';
  const truth: TruthStatus = completionEligible ? 'verified' : blockers.length ? 'blocked' : 'partial';
  return {
    schema: 'yam.mission-subagent-receipt.v1',
    receipt_id: String(input.receipt_id || `receipt-${threadId || 'unassigned'}`),
    generated_at: String(input.generated_at || new Date().toISOString()),
    thread_id: threadId,
    lane_id: String(input.lane_id || threadId),
    agent_id: String(input.agent_id || ''),
    role,
    access_mode: accessMode,
    lifecycle_status: lifecycleStatus,
    outcome,
    assigned_scope: assignedScope,
    changed_files: changedFiles,
    verification_evidence: verificationEvidence,
    remaining_risks: remainingRisks,
    checks,
    blockers: uniqueStrings(blockers),
    warnings,
    completion_eligible: completionEligible,
    truth_status: truth
  };
}

export function buildMissionCompletionGate(input: Partial<MissionCompletionGate> & Record<string, unknown> = {}): MissionCompletionGate {
  const expectedThreadIds = uniqueStrings(asList(input.expected_thread_ids));
  const receipts = asObjectList(input.receipts).map((receipt) => buildMissionSubagentReceipt(receipt));
  const receiptCounts = new Map<string, number>();
  for (const receipt of receipts) {
    receiptCounts.set(receipt.thread_id, (receiptCounts.get(receipt.thread_id) || 0) + 1);
  }
  const missingThreadIds = expectedThreadIds.filter((threadId) => !receiptCounts.has(threadId));
  const duplicateThreadIds = [...receiptCounts.entries()].filter(([, count]) => count > 1).map(([threadId]) => threadId).filter(Boolean);
  const unexpectedThreadIds = uniqueStrings(receipts.map((receipt) => receipt.thread_id).filter((threadId) => threadId && !expectedThreadIds.includes(threadId)));
  const expectedReceipts = receipts.filter((receipt) => expectedThreadIds.includes(receipt.thread_id));
  const invalidThreadIds = uniqueStrings([
    ...expectedReceipts.filter((receipt) => !receipt.completion_eligible).map((receipt) => receipt.thread_id),
    ...receipts.filter((receipt) => !receipt.thread_id).map((receipt) => `missing:${receipt.receipt_id}`)
  ]);
  const readOnlyViolations = uniqueStrings(receipts
    .filter((receipt) => receipt.checks.some((check) => check.id === 'read_only_role' && check.status === 'fail'))
    .map((receipt) => receipt.thread_id || receipt.lane_id));
  const blockers: string[] = [];
  if (!expectedThreadIds.length) blockers.push('expected_thread_inventory_missing: record every spawned thread before finalization');
  if (missingThreadIds.length) blockers.push(`missing_receipts: ${missingThreadIds.join(', ')}`);
  if (duplicateThreadIds.length) blockers.push(`duplicate_receipts: ${duplicateThreadIds.join(', ')}`);
  if (unexpectedThreadIds.length) blockers.push(`unexpected_receipts: ${unexpectedThreadIds.join(', ')}`);
  if (invalidThreadIds.length) blockers.push(`invalid_or_incomplete_receipts: ${invalidThreadIds.join(', ')}`);
  if (readOnlyViolations.length) blockers.push(`read_only_contract_violations: ${readOnlyViolations.join(', ')}`);
  blockers.push(...asList(input.blockers));
  const warnings = uniqueStrings(asList(input.warnings));
  const ready = blockers.length === 0 && expectedReceipts.length === expectedThreadIds.length;
  return {
    schema: 'yam.mission-completion-gate.v1',
    generated_at: String(input.generated_at || new Date().toISOString()),
    expected_thread_ids: expectedThreadIds,
    receipt_count: receipts.length,
    receipts,
    missing_thread_ids: missingThreadIds,
    duplicate_thread_ids: duplicateThreadIds,
    unexpected_thread_ids: unexpectedThreadIds,
    invalid_thread_ids: invalidThreadIds,
    read_only_violations: readOnlyViolations,
    blockers: uniqueStrings(blockers),
    warnings,
    ready_to_claim_complete: ready,
    next_action: ready ? 'attach this gate to the mission proof summary' : blockers[0] || 'resolve mission receipt warnings',
    truth_status: ready ? 'verified' : 'blocked'
  };
}

function missionContractCheck(id: string, label: string, passed: boolean, nextAction: string): MissionContractCheck {
  return {
    id,
    label,
    status: passed ? 'pass' : 'fail',
    next_action: nextAction
  };
}

function normalizeMissionLaneRole(value: unknown = ''): MissionLaneRole {
  const text = String(value || '').toLowerCase().replace(/[- ]/g, '_');
  if (['implementer', 'reviewer', 'ux_verifier', 'doctor'].includes(text)) return text as MissionLaneRole;
  return 'other';
}

function normalizeMissionAccessMode(value: unknown = '', role: MissionLaneRole = 'other'): MissionAccessMode {
  const text = String(value || '').toLowerCase().replace(/[- ]/g, '_');
  if (text === 'read_only' || text === 'readonly') return 'read_only';
  if (text === 'write') return 'write';
  return role === 'reviewer' || role === 'doctor' ? 'read_only' : 'write';
}

function normalizeMissionLifecycleStatus(value: unknown = ''): MissionLifecycleStatus {
  const text = String(value || '').toLowerCase();
  if (['pending', 'running', 'stopped', 'failed', 'cancelled'].includes(text)) return text as MissionLifecycleStatus;
  return 'pending';
}

function normalizeMissionOutcome(value: unknown = ''): MissionOutcome {
  const text = String(value || '').toLowerCase();
  if (['passed', 'failed', 'blocked'].includes(text)) return text as MissionOutcome;
  return 'ambiguous';
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

export function buildStudyNote(input: Partial<StudyNote> & Record<string, unknown> = {}): StudyNote {
  const problem = buildStudyNoteSection(input.problem, {
    code: input.issue_code,
    role: input.issue_role,
    symptom: input.issue_symptom
  }, 'problem');
  const change = buildStudyNoteSection(input.change, {
    code: input.changed_code,
    role: input.changed_role,
    summary: input.change_summary
  }, 'change');
  const whyItMatters = shortText(input.why_it_matters || input.why_important);
  const learningNote = shortText(input.learning_note);
  const limits = [
    ...asList(input.limits),
    ...missingStudyNoteLimits(problem, change, whyItMatters, learningNote)
  ];
  const hasProblem = Boolean(problem.code || problem.role || problem.symptom);
  const hasChange = Boolean(change.code || change.role || change.summary);
  const truth: TruthStatus = isTruthStatus(input.truth_status) ? input.truth_status
    : hasProblem || hasChange || whyItMatters || learningNote ? 'partial'
      : 'assumed';
  return {
    schema: 'yam.study-note.v1',
    problem,
    change,
    why_it_matters: whyItMatters,
    learning_note: learningNote,
    limits: [...new Set(limits)],
    truth_status: truth
  };
}

export function buildLoopReport(input: Partial<LoopReport> & Record<string, unknown> = {}): LoopReport {
  const stages = Array.isArray(input.stages)
    ? input.stages.map((stage) => buildLoopStage(stage))
    : [];
  const evidence = asList(input.evidence);
  const touchedFiles = asList(input.touched_files || input.touched_file);
  const readFiles = asList(input.read_files || input.read_file);
  const verifiedFiles = asList(input.verified_files || input.verified_file);
  const skippedChecks = asList(input.skipped_checks || input.skipped_check);
  const stopCondition = shortText(input.stop_condition);
  const resumeHint = shortText(input.resume_hint);
  const readinessState = normalizeReadinessState(input.readiness_state);
  const coveredRequirements = asList(input.covered_requirements || input.covered_requirement);
  const uncoveredRequirements = asList(input.uncovered_requirements || input.uncovered_requirement);
  const blockers = asList(input.blockers || input.blocked);
  const blockedBy = asList(input.blocked_by);
  const blockedKind = shortText(input.blocked_kind || (readinessState === 'blocked' ? 'readiness_blocked' : uncoveredRequirements.length ? 'requirement_uncovered' : blockers.length || blockedBy.length ? 'evidence_missing' : ''));
  const failureCause = shortText(input.failure_cause);
  const recoveryHint = shortText(input.recovery_hint);
  const avoidanceNote = shortText(input.avoidance_note);
  const evidenceStamp = shortText(input.evidence_stamp || input.source_digest, 320);
  const sourceDigest = shortText(input.source_digest || input.evidence_stamp, 320);
  const hasBlockedStage = stages.some((stage) => stage.status === 'blocked' || stage.status === 'failed');
  const hasBlockerSignal = Boolean(blockers.length || blockedBy.length || blockedKind || uncoveredRequirements.length || readinessState === 'blocked');
  const requestedTruth = isTruthStatus(input.truth_status) ? input.truth_status : '';
  const derivedTruth: TruthStatus = hasBlockerSignal || hasBlockedStage ? 'blocked'
    : evidence.length && stages.some((stage) => stage.status === 'passed') ? 'verified'
      : evidence.length || stages.length ? 'partial'
        : 'assumed';
  const readinessCap = readinessState === 'blocked' ? 'blocked' : readinessState === 'degraded' ? 'partial' : '';
  const truth = requestedTruth ? weakestTruth(requestedTruth, derivedTruth, readinessCap) : weakestTruth(derivedTruth, readinessCap);
  const studyNote = buildStudyNote(input.study_note && typeof input.study_note === 'object' ? input.study_note as unknown as Record<string, unknown> : input);
  const intentLabel = normalizeToolIntentLabel(input.intent_label || input.tool_intent);
  return {
    schema: 'yam.loop-report.v1',
    generated_at: String(input.generated_at || new Date().toISOString()),
    route: String(input.route || ''),
    intent: shortText(input.intent),
    loop_kind: String(input.loop_kind || 'harness'),
    stage_conventions: asList(input.stage_conventions || input.stage_convention).length
      ? asList(input.stage_conventions || input.stage_convention)
      : ['brief', 'plan', 'implement', 'critique', 'verify', 'handoff'],
    stages,
    evidence,
    evidence_level: normalizeLoopEvidenceLevel(input.evidence_level),
    evidence_stamp: evidenceStamp,
    source_digest: sourceDigest,
    touched_files: touchedFiles,
    read_files: readFiles,
    verified_files: verifiedFiles,
    skipped_checks: skippedChecks,
    stop_condition: stopCondition,
    resume_hint: resumeHint,
    readiness_state: readinessState,
    covered_requirements: coveredRequirements,
    uncovered_requirements: uncoveredRequirements,
    blockers,
    blocked_kind: blockedKind,
    failure_cause: failureCause,
    truth_status: truth,
    intent_label: intentLabel,
    tool_intent: intentLabel,
    next_action: shortText(input.next_action || (readinessState === 'blocked' ? 'restore readiness before claiming this loop complete' : uncoveredRequirements.length ? `cover requirement before claiming complete: ${uncoveredRequirements[0]}` : hasBlockerSignal ? 'resolve the blocker before claiming this loop complete' : 'record the next smallest useful action')),
    safe_retry: shortText(input.safe_retry || (hasBlockerSignal ? 'retry only after the blocker is resolved and new evidence is recorded' : 'not required')),
    recovery_hint: recoveryHint,
    fix_first_items: asList(input.fix_first_items || input.fix_first_item),
    remaining_tasks: asList(input.remaining_tasks || input.remaining_task),
    recommended_direction: shortText(input.recommended_direction || input.direction),
    implementation_notes: asList(input.implementation_notes || input.implementation_note),
    why_this_next: shortText(input.why_this_next),
    blocked_by: blockedBy,
    owner_route: normalizeOwnerRoute(input.owner_route || input.route),
    owner_scope: asList(input.owner_scope || input.scope),
    scope_owner: normalizeOwnerRoute(input.scope_owner || input.owner),
    side_effects: asList(input.side_effects || input.side_effect),
    avoidance_note: avoidanceNote,
    study_note: studyNote
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
  const deepVisualReview = buildUeyeDeepVisualReview(input.deep_visual_review);
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
  const deepTruthCap = deepVisualReview.truth_status === 'assumed' ? '' : deepVisualReview.truth_status;
  const finalTruth = shouldApplyDesignGate ? weakestTruth(derivedTruth, gate.truth_status, deepTruthCap) : weakestTruth(derivedTruth, deepTruthCap);
  return {
    schema: 'yam.ueye-run-report.v1',
    reference_sources: references,
    implementation_sources: implementations,
    surface_context: buildUeyeSurfaceContext({
      ...input.surface_context,
      truth_status: isTruthStatus(input.surface_context?.truth_status) ? input.surface_context?.truth_status : finalTruth
    }),
    design_completion_gate: gate,
    deep_visual_review: deepVisualReview,
    comparison_result: comparisonResult,
    design_quality: String(input.design_quality || 'not-checked'),
    blocked_reason: blockedReason,
    next_action: String(input.next_action || gate.blockers[0] || deepVisualReview.blockers[0] || (finalTruth === 'verified' ? 'no action required' : 'capture or provide implementation screenshot before claiming verified visual status')),
    truth_status: isTruthStatus(input.truth_status) ? input.truth_status : finalTruth
  };
}

export function buildUeyeDeepVisualReview(input: Partial<UeyeDeepVisualReview> & Record<string, unknown> = {}): UeyeDeepVisualReview {
  const acceptanceCriteria = asList(input.acceptance_criteria || input.acceptance_criterion);
  const touchedFiles = asList(input.touched_files || input.touched_file);
  const readFiles = asList(input.read_files || input.read_file);
  const verifiedFiles = asList(input.verified_files || input.verified_file);
  const skippedChecks = asList(input.skipped_checks || input.skipped_check);
  const residualRisks = asList(input.residual_risks || input.residual_risk);
  const deepVisualChecks = asList(input.deep_visual_checks || input.deep_visual_check);
  const designSystemEvidence = asList(input.design_system_evidence || input.design_system);
  const implementationEvidence = asList(input.implementation_evidence || input.implementation_evidence_item);
  const stateMatrix = buildStateMatrix(input.state_matrix, input);
  const stopCondition = shortText(input.stop_condition);
  const resumeHint = shortText(input.resume_hint);
  const blockers = [
    ...asList(input.blockers || input.blocked),
    ...(Object.values(stateMatrix).some((status) => status === 'fail' || status === 'blocked') ? ['state_matrix: fix failed or blocked UI states before claiming done'] : [])
  ];
  const warnings = [
    ...asList(input.warnings || input.warning),
    ...skippedChecks.map((check) => `skipped: ${check}`),
    ...residualRisks.map((risk) => `risk: ${risk}`),
    ...(acceptanceCriteria.length && !implementationEvidence.length ? ['implementation_evidence: record how the UI was checked against acceptance criteria'] : [])
  ];
  const hasAnySignal = Boolean(
    acceptanceCriteria.length ||
    touchedFiles.length ||
    readFiles.length ||
    verifiedFiles.length ||
    skippedChecks.length ||
    residualRisks.length ||
    stopCondition ||
    resumeHint ||
    deepVisualChecks.length ||
    designSystemEvidence.length ||
    implementationEvidence.length ||
    Object.keys(stateMatrix).length
  );
  const truth: TruthStatus = blockers.length ? 'blocked'
    : hasAnySignal && skippedChecks.length ? 'partial'
      : hasAnySignal && implementationEvidence.length ? 'verified'
        : hasAnySignal ? 'partial'
          : 'assumed';
  return {
    schema: 'yam.ueye-deep-visual-review.v1',
    acceptance_criteria: acceptanceCriteria,
    touched_files: touchedFiles,
    read_files: readFiles,
    verified_files: verifiedFiles,
    skipped_checks: skippedChecks,
    residual_risks: residualRisks,
    stop_condition: stopCondition,
    resume_hint: resumeHint,
    deep_visual_checks: deepVisualChecks,
    design_system_evidence: designSystemEvidence,
    state_matrix: stateMatrix,
    implementation_evidence: implementationEvidence,
    blockers,
    warnings,
    next_action: shortText(input.next_action || blockers[0] || warnings[0] || (hasAnySignal ? 'continue with the recorded Ueye verification boundary' : 'record acceptance criteria and visual evidence when Ueye needs deep verification')),
    truth_status: isTruthStatus(input.truth_status) ? input.truth_status : truth
  };
}

function buildStudyNoteSection(section: unknown, fallback: Record<string, unknown>, kind: 'problem' | 'change'): StudyNoteSection {
  const source = section && typeof section === 'object' ? section as Record<string, unknown> : fallback;
  const code = shortText(source.code);
  const role = shortText(source.role);
  const symptom = kind === 'problem' ? shortText(source.symptom) : undefined;
  const summary = kind === 'change' ? shortText(source.summary) : undefined;
  return {
    code,
    role,
    ...(symptom !== undefined ? { symptom } : {}),
    ...(summary !== undefined ? { summary } : {}),
    truth_status: code || role || symptom || summary ? 'partial' : 'assumed'
  };
}

function missingStudyNoteLimits(problem: StudyNoteSection, change: StudyNoteSection, whyItMatters = '', learningNote = ''): string[] {
  const limits: string[] = [];
  if (!problem.code) limits.push('issue_code not provided');
  if (!problem.role) limits.push('issue_role not provided');
  if (!problem.symptom) limits.push('issue_symptom not provided');
  if (!change.code) limits.push('changed_code not provided');
  if (!change.role) limits.push('changed_role not provided');
  if (!change.summary) limits.push('change_summary not provided');
  if (!whyItMatters) limits.push('why_it_matters not provided');
  if (!learningNote) limits.push('learning_note not provided');
  return limits;
}

function buildLoopStage(value: unknown = ''): LoopStage {
  if (value && typeof value === 'object') {
    const item = value as Partial<LoopStage>;
    return loopStage(String(item.id || ''), item.status, String(item.note || ''));
  }
  const [id = '', rawStatus = '', ...noteParts] = String(value || '').split(':');
  return loopStage(id, rawStatus, noteParts.join(':'));
}

function loopStage(id = '', rawStatus: unknown = '', note = ''): LoopStage {
  const status = normalizeLoopStageStatus(rawStatus);
  return {
    id: shortText(id || 'stage'),
    status,
    note: shortText(note),
    truth_status: stageTruth(status)
  };
}

function normalizeLoopStageStatus(value: unknown = ''): LoopStageStatus {
  const text = String(value || '').toLowerCase().replace(/[-\s]/g, '_');
  if (text === 'pass' || text === 'passed' || text === 'ok') return 'passed';
  if (text === 'fail' || text === 'failed' || text === 'error') return 'failed';
  if (text === 'block' || text === 'blocked') return 'blocked';
  if (text === 'skip' || text === 'skipped') return 'skipped';
  if (text === 'partial') return 'partial';
  if (text === 'pending') return 'pending';
  return 'recorded';
}

function stageTruth(status: LoopStageStatus): TruthStatus {
  if (status === 'passed') return 'verified';
  if (status === 'failed' || status === 'blocked') return 'blocked';
  if (status === 'skipped') return 'skipped';
  if (status === 'pending') return 'assumed';
  return 'partial';
}

function normalizeToolIntentLabel(value: unknown = ''): ToolIntent {
  const text = String(value || '').toLowerCase().replace(/[-\s]/g, '_');
  if (['read_only', 'write', 'destructive', 'runtime', 'visual', 'publish'].includes(text)) return text as ToolIntent;
  return 'read_only';
}

function normalizeOwnerRoute(value: unknown = ''): string {
  const text = String(value || '').trim().replace(/^\$/, '').replace(/^yam-/, '');
  if (['quick', 'ueye', 'question', 'scout', 'deep', 'mission'].includes(text)) return `$${text}`;
  return text ? shortText(text, 80) : '';
}

function normalizeLoopEvidenceLevel(value: unknown = ''): LoopEvidenceLevel {
  const text = String(value || '').toLowerCase().replace(/[-\s]/g, '_');
  if (['fixture', 'smoke', 'local', 'real'].includes(text)) return text as LoopEvidenceLevel;
  return 'none';
}

function normalizeReadinessState(value: unknown = ''): ReadinessState {
  const text = String(value || '').toLowerCase().replace(/[-\s]/g, '_');
  if (['usable', 'degraded', 'blocked', 'unknown'].includes(text)) return text as ReadinessState;
  return 'unknown';
}

function buildStateMatrix(rawStateMatrix: unknown = null, input: Record<string, unknown> = {}): Record<string, string> {
  const result: Record<string, string> = {};
  if (rawStateMatrix && typeof rawStateMatrix === 'object' && !Array.isArray(rawStateMatrix)) {
    for (const [key, value] of Object.entries(rawStateMatrix as Record<string, unknown>)) {
      const name = shortText(key, 80);
      if (name) result[name] = normalizeStateCheckStatus(value);
    }
  }
  for (const item of asList(input.state_check)) {
    const [name = '', rawStatus = 'checked'] = item.split(':');
    const key = shortText(name, 80);
    if (key) result[key] = normalizeStateCheckStatus(rawStatus);
  }
  for (const key of ['default', 'loading', 'error', 'empty', 'disabled', 'hover', 'focus', 'mobile']) {
    const value = input[`${key}_state`];
    if (value !== undefined) result[key] = normalizeStateCheckStatus(value);
  }
  return result;
}

function normalizeStateCheckStatus(value: unknown = ''): string {
  const text = String(value || '').toLowerCase().replace(/[-\s]/g, '_');
  if (['pass', 'checked', 'verified', 'ok'].includes(text)) return 'pass';
  if (['fail', 'failed', 'broken'].includes(text)) return 'fail';
  if (['blocked', 'missing'].includes(text)) return 'blocked';
  if (['skipped', 'skip'].includes(text)) return 'skipped';
  if (['partial', 'needs_polish', 'warning'].includes(text)) return 'partial';
  if (['not_checked', 'unknown'].includes(text)) return 'not_checked';
  return shortText(value, 80) || 'checked';
}

function shortText(value: unknown = '', limit = 240): string {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3)}...`;
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
  for (const receipt of asList(summary.missionReceipt)) {
    rows.push(evidenceRow('evidence', receipt, metadataTruth(receipt, 'partial')));
  }
  for (const completion of asList(summary.missionCompletion)) {
    rows.push(evidenceRow('evidence', completion, metadataTruth(completion, 'partial')));
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
  const missionRoute = String(summary.route || '').replace(/^\$/, '').toLowerCase() === 'mission';
  const missionCompletionValues = asValueList(summary.missionCompletion);
  if (missionRoute && ['verified', 'proven'].includes(requested)) {
    if (!missionCompletionValues.length) {
      cappedTruth = weakestTruth(cappedTruth, 'partial');
      unverified.push('mission_completion_gate_missing');
    } else {
      const missionTruth = missionCompletionCap(missionCompletionValues);
      cappedTruth = weakestTruth(cappedTruth, missionTruth);
      if (missionTruth === 'blocked') blockers.push('mission_completion_gate_blocked');
      if (!['verified', 'proven'].includes(missionTruth)) unverified.push('mission_completion_not_verified');
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
    missionReceipt: asList(summary.missionReceipt),
    missionCompletion: asList(summary.missionCompletion),
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

function missionCompletionCap(value: unknown = ''): TruthStatus {
  const items = asValueList(value);
  if (!items.length) return 'partial';
  return items.reduce<TruthStatus>((weakest, item) => {
    const parsed = parseStructuredValue(item);
    if (!parsed || typeof parsed !== 'object') return weakestTruth(weakest, 'blocked');
    const gate = buildMissionCompletionGate(parsed as Record<string, unknown>);
    return weakestTruth(weakest, gate.truth_status);
  }, 'proven');
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

function asValueList(value?: unknown): unknown[] {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function parseStructuredValue(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function asObjectList(value?: unknown): Array<Record<string, unknown>> {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.filter((item) => Boolean(item) && typeof item === 'object') as Array<Record<string, unknown>>;
}

function uniqueStrings(values: unknown[] = []): string[] {
  return [...new Set(values.filter(Boolean).map(String))];
}
