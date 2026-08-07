import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { compareStableText } from './stable-order.js';
import { inspectImageFile } from './ueye-artifacts.js';

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_ANCHOR_BYTES = 1024 * 1024;
const MAX_REVISION_ROUNDS = 2;
const MAX_PHASE_ITEMS = 256;

type JsonObject = Record<string, unknown>;

export type PlanReviewVerdict = 'approve' | 'request_changes';
export type DesignRevisionStatus = 'active' | 'accepted' | 'two_round_limit' | 'integrity_blocked';
export type GalleryCompletionState = 'draft' | 'ready_for_inspection' | 'packaged';

export interface PlanReviewArtifact {
  id: string;
  role: 'plan' | 'reference' | 'deliverable';
  file_path: string;
  sha256: string;
}

export interface PlanReviewComment {
  id: string;
  anchor: {
    artifact_id: string;
    kind: 'line' | 'region' | 'text';
    locator: string;
  };
  finding: string;
  requested_change: string;
  anchor_context: string;
}

export interface PlanReviewSession {
  schema: 'yam.plan-review-canvas.v1';
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  status: 'open' | 'closed';
  verdict: PlanReviewVerdict | null;
  closed_at: string | null;
  demand_trigger: DesignProductionDemandTrigger & {
    evidence_truth: 'operator_asserted';
    recorded_at: string;
  };
  execution_boundary: {
    storage: 'local_only';
    rendering: 'static_html';
    sandbox: 'csp_no_script_no_network';
    remote_sharing: false;
    server: false;
    background_service: false;
  };
  artifacts: PlanReviewArtifact[];
  comments: PlanReviewComment[];
}

export interface UeyeRevisionReference {
  artifact_id: string;
  manifest_path: string;
  round: number;
  sha256: string;
  archived_at: string;
  intent: 'preserve' | 'edit_copy';
  asset_manifest_path: string | null;
  asset_id: string | null;
}

export interface DesignRevisionRound {
  round: number;
  reviewer_finding: {
    id: string;
    source_comment_id: string;
    summary: string;
    evidence: string;
  };
  planned_change: string;
  outcome: 'accepted' | 'changes_requested';
  revision_refs: UeyeRevisionReference[];
  recorded_at: string;
}

export interface DesignRevisionState {
  schema: 'yam.design-revision-state.v1';
  session_id: string;
  canvas_session_path: string;
  canvas_session_sha256: string;
  updated_at: string;
  max_rounds: 2;
  status: DesignRevisionStatus;
  stop_reason: string;
  rounds: DesignRevisionRound[];
}

export interface GalleryArtifact {
  id: string;
  role: 'primary' | 'supporting' | 'reference';
  provenance: {
    kind: 'operator' | 'generated' | 'downloaded';
    source_ref: string;
    license_note: string;
  };
  revision_ref: UeyeRevisionReference;
  dimensions: string;
  sha256: string;
  completion_state: GalleryCompletionState;
  final_path: string;
}

export interface FinalGalleryManifest {
  schema: 'yam.final-gallery-manifest.v1';
  session_id: string;
  created_at: string;
  completion_state: GalleryCompletionState;
  purpose: 'inspection_and_packaging_evidence_only';
  claims: {
    visual_correctness: 'not_verified';
    license_correctness: 'not_verified';
    implementation_correctness: 'not_verified';
  };
  artifacts: GalleryArtifact[];
}

export interface DesignProductionDemandTrigger {
  kind: 'repeated_plan_review' | 'multi_asset_production';
  evidence: string;
}

export async function createPlanReviewCanvas(input: {
  root: string;
  session_id: string;
  title: string;
  demand_trigger: DesignProductionDemandTrigger;
  artifacts: Array<Omit<PlanReviewArtifact, 'sha256'> & { sha256?: string }>;
  session_path?: string;
  render_path?: string;
}) {
  assertExactKeys(input, ['root', 'session_id', 'title', 'demand_trigger', 'artifacts', 'session_path', 'render_path'], 'plan review input');
  const root = await canonicalRoot(input.root);
  const sessionId = safeId(input.session_id, 'session_id');
  const title = boundedText(input.title, 'title', 200);
  assertExactKeys(input.demand_trigger, ['kind', 'evidence'], 'demand_trigger');
  const demandTrigger = validateDemandTrigger(input.demand_trigger);
  if (!Array.isArray(input.artifacts) || !input.artifacts.length) throw new Error('plan review requires at least one artifact');
  if (input.artifacts.length > MAX_PHASE_ITEMS) throw new Error(`plan review accepts at most ${MAX_PHASE_ITEMS} artifacts`);
  const artifacts = await Promise.all(input.artifacts.map(async (artifact, index) => {
    assertExactKeys(artifact, ['id', 'role', 'file_path', 'sha256'], `artifacts[${index}]`);
    const id = safeId(artifact.id, `artifacts[${index}].id`);
    const role = enumValue(artifact.role, ['plan', 'reference', 'deliverable'], `artifacts[${index}].role`);
    const file = await resolveExistingWithin(root, artifact.file_path, `artifacts[${index}].file_path`);
    const sha256 = await hashFile(file);
    if (artifact.sha256 !== undefined) assertSha256(artifact.sha256, `artifacts[${index}].sha256`);
    if (artifact.sha256 && artifact.sha256 !== sha256) throw new Error(`${id}: artifact sha256 mismatch`);
    return { id, role, file_path: portableRelative(root, file), sha256 } as PlanReviewArtifact;
  }));
  assertUnique(artifacts.map((item) => item.id), 'artifact id');
  artifacts.sort((left, right) => compareStableText(left.id, right.id));

  const defaultDir = `.yam/ueye/design-production/${sessionId}`;
  const defaultSessionPath = `${defaultDir}/plan-review.json`;
  const defaultRenderPath = `${defaultDir}/canvas.html`;
  if (input.session_path && safeRelativePath(input.session_path, 'session_path') !== defaultSessionPath) {
    throw new Error(`session_path is fixed to ${defaultSessionPath} so phase evidence cannot target unrelated project files`);
  }
  if (input.render_path && safeRelativePath(input.render_path, 'render_path') !== defaultRenderPath) {
    throw new Error(`render_path is fixed to ${defaultRenderPath} so Canvas updates cannot overwrite unrelated project files`);
  }
  const sessionPath = await resolveWritableWithin(root, defaultSessionPath, 'session_path');
  const renderPath = await resolveWritableWithin(root, defaultRenderPath, 'render_path');
  if (sessionPath === renderPath) throw new Error('session_path and render_path must be different files');
  const now = new Date().toISOString();
  const session: PlanReviewSession = {
    schema: 'yam.plan-review-canvas.v1',
    session_id: sessionId,
    title,
    created_at: now,
    updated_at: now,
    status: 'open',
    verdict: null,
    closed_at: null,
    demand_trigger: { ...demandTrigger, evidence_truth: 'operator_asserted', recorded_at: now },
    execution_boundary: localCanvasBoundary(),
    artifacts,
    comments: []
  };
  await assertAbsent(sessionPath, 'session_path');
  await assertAbsent(renderPath, 'render_path');
  await writeJsonAtomic(sessionPath, session, false);
  await writeTextAtomic(renderPath, renderPlanReviewCanvas(session), false);
  return canvasReceipt(sessionPath, renderPath, session);
}

export async function addPlanReviewComment(input: {
  root: string;
  session_path: string;
  render_path: string;
  comment: Omit<PlanReviewComment, 'anchor_context'>;
}) {
  assertExactKeys(input, ['root', 'session_path', 'render_path', 'comment'], 'plan review comment input');
  const root = await canonicalRoot(input.root);
  const sessionPath = await resolveExistingWithin(root, input.session_path, 'session_path');
  const renderPath = await resolveWritableWithin(root, input.render_path, 'render_path');
  if (sessionPath === renderPath) throw new Error('session_path and render_path must be different files');
  const session = await readPlanReviewSession(sessionPath);
  await verifyPlanReviewEvidencePaths(root, session, sessionPath, renderPath);
  if (session.status !== 'open') throw new Error('plan review session is closed; comments cannot be added');
  await verifyPlanReviewArtifacts(root, session.artifacts);
  await verifyPlanReviewComments(root, session);
  if (session.comments.length >= MAX_PHASE_ITEMS) throw new Error(`plan review accepts at most ${MAX_PHASE_ITEMS} comments`);
  const comment = await validateAndCapturePlanReviewComment(root, input.comment, session.artifacts);
  if (session.comments.some((item) => item.id === comment.id)) throw new Error(`duplicate comment id: ${comment.id}`);
  session.comments.push(comment);
  session.comments.sort((left, right) => compareStableText(left.id, right.id));
  session.updated_at = new Date().toISOString();
  await writeJsonAtomic(sessionPath, session);
  await writeTextAtomic(renderPath, renderPlanReviewCanvas(session));
  return canvasReceipt(sessionPath, renderPath, session);
}

export async function closePlanReviewCanvas(input: {
  root: string;
  session_path: string;
  render_path: string;
  verdict: PlanReviewVerdict;
}) {
  assertExactKeys(input, ['root', 'session_path', 'render_path', 'verdict'], 'plan review close input');
  const root = await canonicalRoot(input.root);
  const sessionPath = await resolveExistingWithin(root, input.session_path, 'session_path');
  const renderPath = await resolveWritableWithin(root, input.render_path, 'render_path');
  if (sessionPath === renderPath) throw new Error('session_path and render_path must be different files');
  const session = await readPlanReviewSession(sessionPath);
  await verifyPlanReviewEvidencePaths(root, session, sessionPath, renderPath);
  if (session.status !== 'open') throw new Error('plan review session is already closed');
  await verifyPlanReviewArtifacts(root, session.artifacts);
  await verifyPlanReviewComments(root, session);
  const verdict = enumValue(input.verdict, ['approve', 'request_changes'], 'verdict');
  if (verdict === 'request_changes' && !session.comments.length) {
    throw new Error('request_changes verdict requires at least one anchored reviewer finding');
  }
  const now = new Date().toISOString();
  session.status = 'closed';
  session.verdict = verdict;
  session.closed_at = now;
  session.updated_at = now;
  await writeJsonAtomic(sessionPath, session);
  await writeTextAtomic(renderPath, renderPlanReviewCanvas(session));
  return canvasReceipt(sessionPath, renderPath, session);
}

export async function readPlanReviewSession(file: string): Promise<PlanReviewSession> {
  const data = await readJson(file, 'plan review session');
  assertExactKeys(data, ['schema', 'session_id', 'title', 'created_at', 'updated_at', 'status', 'verdict', 'closed_at', 'demand_trigger', 'execution_boundary', 'artifacts', 'comments'], 'plan review session');
  if (data.schema !== 'yam.plan-review-canvas.v1') throw new Error('invalid plan review session schema');
  const sessionId = safeId(data.session_id, 'session_id');
  const status = enumValue(data.status, ['open', 'closed'], 'status');
  const verdict = data.verdict === null ? null : enumValue(data.verdict, ['approve', 'request_changes'], 'verdict');
  if ((status === 'open' && (verdict !== null || data.closed_at !== null)) || (status === 'closed' && (!verdict || !isIsoDate(data.closed_at)))) {
    throw new Error('plan review close state is inconsistent');
  }
  validateBoundary(data.execution_boundary);
  assertExactKeys(data.demand_trigger, ['kind', 'evidence', 'evidence_truth', 'recorded_at'], 'demand_trigger');
  const storedDemand = data.demand_trigger as JsonObject;
  const demandTrigger = validateDemandTrigger(storedDemand);
  if (storedDemand.evidence_truth !== 'operator_asserted') throw new Error('demand_trigger.evidence_truth must remain operator_asserted');
  const demandRecordedAt = requiredIsoDate(storedDemand.recorded_at, 'demand_trigger.recorded_at');
  const createdAt = requiredIsoDate(data.created_at, 'created_at');
  if (demandRecordedAt !== createdAt) throw new Error('demand_trigger must be recorded at Canvas creation time');
  if (!Array.isArray(data.artifacts) || !data.artifacts.length) throw new Error('plan review artifacts must be a non-empty array');
  if (data.artifacts.length > MAX_PHASE_ITEMS) throw new Error(`plan review artifacts exceed the ${MAX_PHASE_ITEMS}-item limit`);
  const artifacts = data.artifacts.map((item, index) => validateStoredPlanArtifact(item, index));
  assertUnique(artifacts.map((item) => item.id), 'artifact id');
  if (!Array.isArray(data.comments)) throw new Error('plan review comments must be an array');
  if (data.comments.length > MAX_PHASE_ITEMS) throw new Error(`plan review comments exceed the ${MAX_PHASE_ITEMS}-item limit`);
  const comments = data.comments.map((item) => validatePlanReviewComment(item, artifacts));
  assertUnique(comments.map((item) => item.id), 'comment id');
  return {
    schema: 'yam.plan-review-canvas.v1',
    session_id: sessionId,
    title: boundedText(data.title, 'title', 200),
    created_at: createdAt,
    updated_at: requiredIsoDate(data.updated_at, 'updated_at'),
    status,
    verdict,
    closed_at: data.closed_at as string | null,
    demand_trigger: { ...demandTrigger, evidence_truth: 'operator_asserted', recorded_at: demandRecordedAt },
    execution_boundary: localCanvasBoundary(),
    artifacts,
    comments
  };
}

export async function createDesignRevisionState(input: {
  root: string;
  session_id: string;
  state_path?: string;
}) {
  assertExactKeys(input, ['root', 'session_id', 'state_path'], 'design revision state input');
  const root = await canonicalRoot(input.root);
  const sessionId = safeId(input.session_id, 'session_id');
  const canonicalStatePath = revisionStateRelativePath(sessionId);
  if (input.state_path && safeRelativePath(input.state_path, 'state_path') !== canonicalStatePath) {
    throw new Error(`state_path is fixed to ${canonicalStatePath} so a session cannot reset its two-round limit with another state file`);
  }
  const canvasRelativePath = planReviewRelativePath(sessionId);
  const canvasPath = await resolveExistingWithin(root, canvasRelativePath, 'canvas_session_path');
  const canvas = await readPlanReviewSession(canvasPath);
  await verifyPlanReviewEvidencePaths(root, canvas, canvasPath);
  await verifyPlanReviewArtifacts(root, canvas.artifacts);
  await verifyPlanReviewComments(root, canvas);
  if (canvas.session_id !== sessionId) throw new Error('revision state session_id must match its canonical Plan Review Canvas');
  if (canvas.status !== 'closed' || canvas.verdict !== 'request_changes') {
    throw new Error('revision state requires a closed request_changes Plan Review Canvas');
  }
  const statePath = await resolveWritableWithin(root, canonicalStatePath, 'state_path');
  if (statePath !== path.join(root, canonicalStatePath)) throw new Error('canonical state_path must not be redirected through a symlink');
  const state: DesignRevisionState = {
    schema: 'yam.design-revision-state.v1',
    session_id: sessionId,
    canvas_session_path: canvasRelativePath,
    canvas_session_sha256: await hashFile(canvasPath),
    updated_at: new Date().toISOString(),
    max_rounds: MAX_REVISION_ROUNDS,
    status: 'active',
    stop_reason: '',
    rounds: []
  };
  await assertAbsent(statePath, 'state_path');
  await writeJsonAtomic(statePath, state, false);
  return { schema: 'yam.design-revision-state-receipt.v1', state_path: statePath, state, truth_status: 'verified' as const };
}

export async function recordDesignRevisionRound(input: {
  root: string;
  state_path: string;
  reviewer_finding: DesignRevisionRound['reviewer_finding'];
  planned_change: string;
  outcome: DesignRevisionRound['outcome'];
  revision_refs: UeyeRevisionReference[];
}) {
  assertExactKeys(input, ['root', 'state_path', 'reviewer_finding', 'planned_change', 'outcome', 'revision_refs'], 'design revision round input');
  const root = await canonicalRoot(input.root);
  const { statePath, state, canvas } = await loadBoundDesignRevisionState(root, input.state_path);
  if (state.status !== 'active') throw new Error(`revision state stopped with status ${state.status}: ${state.stop_reason}`);
  const round = state.rounds.length + 1;
  if (round > MAX_REVISION_ROUNDS) throw new Error(`revision round ${round} is not allowed; maximum is ${MAX_REVISION_ROUNDS}`);
  const finding = validateReviewerFinding(input.reviewer_finding);
  if (!canvas.comments.some((comment) => comment.id === finding.source_comment_id)) {
    throw new Error(`reviewer finding source_comment_id is not present in the bound Plan Review Canvas: ${finding.source_comment_id}`);
  }
  if (state.rounds.some((item) => item.reviewer_finding.id === finding.id)) throw new Error(`duplicate reviewer finding id: ${finding.id}`);
  const plannedChange = boundedText(input.planned_change, 'planned_change', 4000, 8);
  const outcome = enumValue(input.outcome, ['accepted', 'changes_requested'], 'outcome');
  if (!Array.isArray(input.revision_refs) || !input.revision_refs.length) throw new Error('each revision round requires at least one Ueye revision reference');
  if (input.revision_refs.length > MAX_PHASE_ITEMS) throw new Error(`each revision round accepts at most ${MAX_PHASE_ITEMS} Ueye revision references`);
  let refs: UeyeRevisionReference[];
  try {
    for (const previousRound of state.rounds) {
      for (let index = 0; index < previousRound.revision_refs.length; index += 1) {
        await validateUeyeRevisionReference(root, previousRound.revision_refs[index], `rounds[${previousRound.round}].revision_refs[${index}]`);
      }
    }
    refs = [];
    for (let index = 0; index < input.revision_refs.length; index += 1) {
      refs.push(await validateUeyeRevisionReference(root, input.revision_refs[index], `revision_refs[${index}]`));
    }
    assertUnique(refs.map((item) => `${item.artifact_id}:${item.manifest_path}:${item.round}`), 'revision reference');
    const previousRefs = new Set(state.rounds.flatMap((item) => item.revision_refs.map(revisionReferenceKey)));
    if (refs.every((item) => previousRefs.has(revisionReferenceKey(item)))) {
      throw new Error('each revision round requires at least one newly archived Ueye revision reference');
    }
  } catch (error) {
    state.status = 'integrity_blocked';
    state.stop_reason = boundedText(error instanceof Error ? error.message : String(error), 'integrity blocker', 1000);
    state.updated_at = new Date().toISOString();
    await writeJsonAtomic(statePath, state);
    throw error;
  }
  const recordedAt = new Date().toISOString();
  assertRevisionRoundChronology(canvas, state, refs, recordedAt, round);
  const entry: DesignRevisionRound = {
    round,
    reviewer_finding: finding,
    planned_change: plannedChange,
    outcome,
    revision_refs: refs,
    recorded_at: recordedAt
  };
  state.rounds.push(entry);
  if (outcome === 'accepted') {
    state.status = 'accepted';
    state.stop_reason = `accepted after revision round ${round}`;
  } else if (round === MAX_REVISION_ROUNDS) {
    state.status = 'two_round_limit';
    state.stop_reason = `stopped after the maximum ${MAX_REVISION_ROUNDS} focused revision rounds`;
  }
  state.updated_at = new Date().toISOString();
  await writeJsonAtomic(statePath, state);
  return {
    schema: 'yam.design-revision-round-receipt.v1',
    state_path: statePath,
    round: entry,
    state,
    next_action: state.status === 'active' ? 'record one more focused round only if the reviewer has a concrete finding' : state.stop_reason,
    truth_status: 'verified' as const
  };
}

export async function readDesignRevisionState(file: string): Promise<DesignRevisionState> {
  const data = await readJson(file, 'design revision state');
  assertExactKeys(data, ['schema', 'session_id', 'canvas_session_path', 'canvas_session_sha256', 'updated_at', 'max_rounds', 'status', 'stop_reason', 'rounds'], 'design revision state');
  if (data.schema !== 'yam.design-revision-state.v1' || data.max_rounds !== MAX_REVISION_ROUNDS) throw new Error('invalid design revision state schema');
  const status = enumValue(data.status, ['active', 'accepted', 'two_round_limit', 'integrity_blocked'], 'status');
  if (!Array.isArray(data.rounds) || data.rounds.length > MAX_REVISION_ROUNDS) throw new Error('design revision rounds exceed the maximum of two');
  const rounds = data.rounds.map((item, index) => validateStoredRevisionRound(item, index));
  rounds.forEach((item, index) => {
    if (item.round !== index + 1) throw new Error('design revision rounds must be contiguous and start at one');
  });
  if (status === 'active' && rounds.length >= MAX_REVISION_ROUNDS) throw new Error('active revision state cannot contain two completed rounds');
  if (rounds.slice(0, -1).some((item) => item.outcome === 'accepted')) throw new Error('an accepted revision round must be the final round');
  if (status === 'active' && rounds.at(-1)?.outcome === 'accepted') throw new Error('active revision state cannot contain an accepted round');
  if (status === 'accepted' && rounds.at(-1)?.outcome !== 'accepted') throw new Error('accepted revision state requires an accepted final round');
  if (status === 'two_round_limit' && (rounds.length !== MAX_REVISION_ROUNDS || rounds.at(-1)?.outcome !== 'changes_requested')) throw new Error('two_round_limit requires exactly two changes_requested rounds');
  assertUnique(rounds.map((item) => item.reviewer_finding.id), 'reviewer finding id');
  return {
    schema: 'yam.design-revision-state.v1',
    session_id: safeId(data.session_id, 'session_id'),
    canvas_session_path: safeRelativePath(data.canvas_session_path, 'canvas_session_path'),
    canvas_session_sha256: assertSha256(data.canvas_session_sha256, 'canvas_session_sha256'),
    updated_at: requiredIsoDate(data.updated_at, 'updated_at'),
    max_rounds: MAX_REVISION_ROUNDS,
    status,
    stop_reason: boundedText(data.stop_reason, 'stop_reason', 1000, 0),
    rounds
  };
}

export async function readCanonicalDesignRevisionState(input: { root: string; state_path: string }) {
  assertExactKeys(input, ['root', 'state_path'], 'canonical design revision state input');
  const root = await canonicalRoot(input.root);
  const { state } = await loadBoundDesignRevisionState(root, input.state_path);
  return state;
}

export async function writeFinalGalleryManifest(input: {
  root: string;
  manifest_path: string;
  session_id: string;
  completion_state: GalleryCompletionState;
  artifacts: GalleryArtifact[];
}) {
  assertExactKeys(input, ['root', 'manifest_path', 'session_id', 'completion_state', 'artifacts'], 'final gallery input');
  const root = await canonicalRoot(input.root);
  const manifestPath = await resolveWritableWithin(root, input.manifest_path, 'manifest_path');
  const completionState = enumValue(input.completion_state, ['draft', 'ready_for_inspection', 'packaged'], 'completion_state');
  if (!Array.isArray(input.artifacts) || !input.artifacts.length) throw new Error('final gallery requires at least one artifact');
  if (input.artifacts.length > MAX_PHASE_ITEMS) throw new Error(`final gallery accepts at most ${MAX_PHASE_ITEMS} artifacts`);
  const artifacts: GalleryArtifact[] = [];
  for (let index = 0; index < input.artifacts.length; index += 1) {
    const item = input.artifacts[index];
    assertExactKeys(item, ['id', 'role', 'provenance', 'revision_ref', 'dimensions', 'sha256', 'completion_state', 'final_path'], `artifacts[${index}]`);
    const id = safeId(item.id, `artifacts[${index}].id`);
    const role = enumValue(item.role, ['primary', 'supporting', 'reference'], `artifacts[${index}].role`);
    const provenance = validateProvenance(item.provenance, `artifacts[${index}].provenance`);
    const revisionRef = await validateUeyeRevisionReference(root, item.revision_ref, `artifacts[${index}].revision_ref`);
    const finalFile = await resolveExistingWithin(root, item.final_path, `artifacts[${index}].final_path`);
    const info = await inspectImageFile(finalFile);
    const sha256 = assertSha256(item.sha256, `artifacts[${index}].sha256`);
    if (sha256 !== info.sha256) throw new Error(`${id}: final artifact sha256 mismatch`);
    const dimensions = boundedText(item.dimensions, `artifacts[${index}].dimensions`, 32);
    if (!/^\d+x\d+$/.test(dimensions) || dimensions !== info.dimensions) throw new Error(`${id}: final artifact dimensions mismatch`);
    const itemCompletion = enumValue(item.completion_state, ['draft', 'ready_for_inspection', 'packaged'], `artifacts[${index}].completion_state`);
    artifacts.push({
      id,
      role,
      provenance,
      revision_ref: revisionRef,
      dimensions,
      sha256,
      completion_state: itemCompletion,
      final_path: portableRelative(root, finalFile)
    });
  }
  assertUnique(artifacts.map((item) => item.id), 'gallery artifact id');
  const aggregateCompletion = aggregateGalleryCompletion(artifacts.map((item) => item.completion_state));
  if (completionState !== aggregateCompletion) throw new Error(`gallery completion_state must equal aggregate artifact state ${aggregateCompletion}`);
  artifacts.sort((left, right) => compareStableText(left.id, right.id));
  const manifest: FinalGalleryManifest = {
    schema: 'yam.final-gallery-manifest.v1',
    session_id: safeId(input.session_id, 'session_id'),
    created_at: new Date().toISOString(),
    completion_state: completionState,
    purpose: 'inspection_and_packaging_evidence_only',
    claims: {
      visual_correctness: 'not_verified',
      license_correctness: 'not_verified',
      implementation_correctness: 'not_verified'
    },
    artifacts
  };
  await assertAbsent(manifestPath, 'manifest_path');
  await writeJsonAtomic(manifestPath, manifest, false);
  return {
    schema: 'yam.final-gallery-receipt.v1',
    manifest_path: manifestPath,
    manifest,
    ready: true,
    warnings: ['gallery evidence does not verify visual correctness, license correctness, or implementation correctness'],
    next_action: 'inspect the packaged artifacts, validate usage rights, and run implementation checks before making correctness claims',
    truth_status: 'partial' as const
  };
}

export async function verifyFinalGalleryManifest(input: { root: string; manifest_path: string }) {
  assertExactKeys(input, ['root', 'manifest_path'], 'final gallery verification input');
  const root = await canonicalRoot(input.root);
  const manifestPath = await resolveExistingWithin(root, input.manifest_path, 'manifest_path');
  const data = await readJson(manifestPath, 'final gallery manifest');
  assertExactKeys(data, ['schema', 'session_id', 'created_at', 'completion_state', 'purpose', 'claims', 'artifacts'], 'final gallery manifest');
  if (data.schema !== 'yam.final-gallery-manifest.v1' || data.purpose !== 'inspection_and_packaging_evidence_only') throw new Error('invalid final gallery manifest schema');
  safeId(data.session_id, 'session_id');
  requiredIsoDate(data.created_at, 'created_at');
  const completionState = enumValue(data.completion_state, ['draft', 'ready_for_inspection', 'packaged'], 'completion_state');
  assertExactKeys(data.claims, ['visual_correctness', 'license_correctness', 'implementation_correctness'], 'final gallery claims');
  if ((data.claims as JsonObject).visual_correctness !== 'not_verified'
    || (data.claims as JsonObject).license_correctness !== 'not_verified'
    || (data.claims as JsonObject).implementation_correctness !== 'not_verified') {
    throw new Error('final gallery must not claim visual, license, or implementation correctness');
  }
  if (!Array.isArray(data.artifacts) || !data.artifacts.length) throw new Error('final gallery artifacts must be a non-empty array');
  if (data.artifacts.length > MAX_PHASE_ITEMS) throw new Error(`final gallery artifacts exceed the ${MAX_PHASE_ITEMS}-item limit`);
  const errors: string[] = [];
  const ids: string[] = [];
  for (let index = 0; index < data.artifacts.length; index += 1) {
    try {
      const item = data.artifacts[index] as GalleryArtifact;
      assertExactKeys(item, ['id', 'role', 'provenance', 'revision_ref', 'dimensions', 'sha256', 'completion_state', 'final_path'], `artifacts[${index}]`);
      ids.push(safeId(item.id, `artifacts[${index}].id`));
      enumValue(item.role, ['primary', 'supporting', 'reference'], `artifacts[${index}].role`);
      validateProvenance(item.provenance, `artifacts[${index}].provenance`);
      await validateUeyeRevisionReference(root, item.revision_ref, `artifacts[${index}].revision_ref`);
      const file = await resolveExistingWithin(root, item.final_path, `artifacts[${index}].final_path`);
      const info = await inspectImageFile(file);
      if (assertSha256(item.sha256, `artifacts[${index}].sha256`) !== info.sha256) throw new Error('sha256 mismatch');
      if (!/^\d+x\d+$/.test(item.dimensions) || item.dimensions !== info.dimensions) throw new Error('dimensions mismatch');
      enumValue(item.completion_state, ['draft', 'ready_for_inspection', 'packaged'], `artifacts[${index}].completion_state`);
    } catch (error) {
      errors.push(`artifacts[${index}]: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    assertUnique(ids, 'gallery artifact id');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  try {
    const itemStates: GalleryCompletionState[] = data.artifacts.map((item, index) => enumValue((item as JsonObject).completion_state, ['draft', 'ready_for_inspection', 'packaged'] as const, `artifacts[${index}].completion_state`));
    const aggregate = aggregateGalleryCompletion(itemStates);
    if (completionState !== aggregate) throw new Error(`gallery completion_state must equal aggregate artifact state ${aggregate}`);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return {
    schema: 'yam.final-gallery-verification.v1',
    manifest_path: manifestPath,
    artifact_count: data.artifacts.length,
    errors: uniqueStrings(errors),
    ready: errors.length === 0,
    claims: { visual_correctness: 'not_verified', license_correctness: 'not_verified', implementation_correctness: 'not_verified' },
    next_action: errors[0] || 'inspect the gallery; this verification covers paths, hashes, dimensions, and references only',
    truth_status: errors.length ? 'blocked' as const : 'partial' as const
  };
}

export async function finalizeDesignProductionPhase(input: {
  root: string;
  demand_trigger: DesignProductionDemandTrigger;
  canvas_session_path: string;
  revision_state_path: string | null;
  gallery_manifest_path: string;
  receipt_path: string;
}) {
  assertExactKeys(input, ['root', 'demand_trigger', 'canvas_session_path', 'revision_state_path', 'gallery_manifest_path', 'receipt_path'], 'design production phase input');
  const root = await canonicalRoot(input.root);
  assertExactKeys(input.demand_trigger, ['kind', 'evidence'], 'demand_trigger');
  const demandTrigger = validateDemandTrigger(input.demand_trigger);
  const canvasPath = await resolveExistingWithin(root, input.canvas_session_path, 'canvas_session_path');
  const canvas = await readPlanReviewSession(canvasPath);
  await verifyPlanReviewEvidencePaths(root, canvas, canvasPath);
  if (canvas.demand_trigger.kind !== demandTrigger.kind || canvas.demand_trigger.evidence !== demandTrigger.evidence) {
    throw new Error('finalize demand_trigger must exactly match the operator-asserted trigger recorded before Canvas creation');
  }
  await verifyPlanReviewArtifacts(root, canvas.artifacts);
  await verifyPlanReviewComments(root, canvas);
  if (canvas.status !== 'closed' || !canvas.verdict) throw new Error('design production phase requires an explicitly closed Plan Review Canvas');

  const galleryPath = await resolveExistingWithin(root, input.gallery_manifest_path, 'gallery_manifest_path');
  const galleryVerification = await verifyFinalGalleryManifest({ root, manifest_path: portableRelative(root, galleryPath) });
  if (!galleryVerification.ready) throw new Error(`final gallery integrity is blocked: ${galleryVerification.next_action}`);
  const galleryData = await readJson(galleryPath, 'final gallery manifest');
  const gallerySessionId = safeId(galleryData.session_id, 'final gallery session_id');
  if (gallerySessionId !== canvas.session_id) throw new Error('Canvas and final gallery session_id values do not match');

  let revisionState: DesignRevisionState | null = null;
  let revisionPath: string | null = null;
  if (input.revision_state_path !== null) {
    const boundRevision = await loadBoundDesignRevisionState(root, input.revision_state_path, 'revision_state_path');
    revisionPath = boundRevision.statePath;
    revisionState = boundRevision.state;
    if (revisionState.session_id !== canvas.session_id) throw new Error('Canvas and revision state session_id values do not match');
    for (const round of revisionState.rounds) {
      for (let index = 0; index < round.revision_refs.length; index += 1) {
        await validateUeyeRevisionReference(root, round.revision_refs[index], `rounds[${round.round}].revision_refs[${index}]`);
      }
    }
  }
  if (canvas.verdict === 'request_changes' && !revisionState) throw new Error('request_changes verdict requires a phase revision state');
  if (revisionState && canvas.verdict !== 'request_changes') throw new Error('a phase revision state requires a request_changes Canvas verdict');
  if (revisionState && !['accepted', 'two_round_limit'].includes(revisionState.status)) {
    throw new Error(`revision state is not terminal: ${revisionState.status}`);
  }
  if (revisionState) assertRevisionChronology(canvas, revisionState);
  assertGalleryChronology(canvas, revisionState, galleryData);
  if (canvas.verdict === 'request_changes' && revisionState) {
    const canvasCommentIds = new Set(canvas.comments.map((comment) => comment.id));
    for (const round of revisionState.rounds) {
      if (!canvasCommentIds.has(round.reviewer_finding.source_comment_id)) {
        throw new Error(`revision round ${round.round} is not linked to a Canvas comment id`);
      }
    }
    const finalRoundRefs = new Set((revisionState.rounds.at(-1)?.revision_refs || []).map(revisionReferenceKey));
    for (const [index, artifact] of (galleryData.artifacts as GalleryArtifact[]).entries()) {
      if (!finalRoundRefs.has(revisionReferenceKey(artifact.revision_ref))) {
        throw new Error(`gallery artifact ${index} revision_ref is not recorded in the final phase revision round`);
      }
    }
  }
  const completionState = enumValue(galleryData.completion_state, ['draft', 'ready_for_inspection', 'packaged'], 'gallery completion_state');
  if (revisionState?.status === 'two_round_limit' && completionState !== 'draft') {
    throw new Error('a two_round_limit stop may only finalize a draft gallery; unresolved work cannot be packaged');
  }
  const receiptPath = await resolveWritableWithin(root, input.receipt_path, 'receipt_path');
  await assertAbsent(receiptPath, 'receipt_path');
  const fullyAccepted = canvas.verdict === 'approve' || revisionState?.status === 'accepted';
  const phaseEvidenceComplete = fullyAccepted && completionState === 'packaged';
  const upstreamDigests = {
    canvas_session: `sha256:${await hashFile(canvasPath)}`,
    revision_state: revisionPath ? `sha256:${await hashFile(revisionPath)}` : null,
    gallery_manifest: `sha256:${await hashFile(galleryPath)}`
  };
  const receiptBase = {
    schema: 'yam.design-production-phase-receipt.v1',
    session_id: canvas.session_id,
    recorded_at: new Date().toISOString(),
    demand_trigger: {
      ...demandTrigger,
      evidence_truth: 'operator_asserted' as const
    },
    canvas: {
      path: portableRelative(root, canvasPath),
      status: canvas.status,
      verdict: canvas.verdict,
      artifact_integrity: 'verified'
    },
    revision: revisionState ? {
      path: portableRelative(root, revisionPath as string),
      status: revisionState.status,
      rounds: revisionState.rounds.length,
      reference_integrity: 'verified'
    } : null,
    gallery: {
      path: portableRelative(root, galleryPath),
      completion_state: completionState,
      integrity: 'verified',
      claims: galleryVerification.claims
    },
    upstream_digests: upstreamDigests,
    execution_boundary: localCanvasBoundary(),
    phase_evidence_status: phaseEvidenceComplete ? 'complete' as const : revisionState?.status === 'two_round_limit' ? 'bounded_stop' as const : 'incomplete' as const,
    ready: phaseEvidenceComplete,
    ready_to_claim_correctness: false,
    next_action: designPhaseNextAction(phaseEvidenceComplete, revisionState?.status),
    truth_status: 'partial' as const
  };
  const receipt = {
    ...receiptBase,
    receipt_digest: `sha256:${createHash('sha256').update(stableJson(receiptBase)).digest('hex')}`
  };
  await writeJsonAtomic(receiptPath, receipt, false);
  return { ...receipt, receipt_path: receiptPath };
}

export async function verifyDesignProductionPhaseReceipt(input: { root: string; receipt_path: string }) {
  assertExactKeys(input, ['root', 'receipt_path'], 'design production phase receipt verification input');
  const root = await canonicalRoot(input.root);
  const receiptPath = await resolveExistingWithin(root, input.receipt_path, 'receipt_path');
  const data = await readJson(receiptPath, 'design production phase receipt');
  assertExactKeys(data, [
    'schema', 'session_id', 'recorded_at', 'demand_trigger', 'canvas', 'revision', 'gallery', 'upstream_digests',
    'execution_boundary', 'phase_evidence_status', 'ready', 'ready_to_claim_correctness', 'next_action', 'truth_status', 'receipt_digest'
  ], 'design production phase receipt');
  if (data.schema !== 'yam.design-production-phase-receipt.v1') throw new Error('invalid design production phase receipt schema');
  const sessionId = safeId(data.session_id, 'session_id');
  requiredIsoDate(data.recorded_at, 'recorded_at');
  const errors: string[] = [];
  if (!isObject(data.canvas) || !isObject(data.gallery) || !isObject(data.upstream_digests)) {
    throw new Error('design production phase receipt evidence objects are invalid');
  }
  assertExactObjectKeys(data.demand_trigger, ['kind', 'evidence', 'evidence_truth'], 'phase receipt demand_trigger');
  assertExactObjectKeys(data.canvas, ['path', 'status', 'verdict', 'artifact_integrity'], 'phase receipt canvas');
  assertExactObjectKeys(data.gallery, ['path', 'completion_state', 'integrity', 'claims'], 'phase receipt gallery');
  assertExactObjectKeys(data.gallery.claims, ['visual_correctness', 'license_correctness', 'implementation_correctness'], 'phase receipt gallery claims');
  assertExactObjectKeys(data.upstream_digests, ['canvas_session', 'revision_state', 'gallery_manifest'], 'phase receipt upstream_digests');
  if (data.revision !== null) {
    assertExactObjectKeys(data.revision, ['path', 'status', 'rounds', 'reference_integrity'], 'phase receipt revision');
  }
  validateBoundary(data.execution_boundary);
  const demandTrigger = validateDemandTrigger(data.demand_trigger);
  if ((data.demand_trigger as JsonObject).evidence_truth !== 'operator_asserted') errors.push('demand_trigger evidence_truth must remain operator_asserted');
  const canvasPath = await resolveExistingWithin(root, data.canvas.path, 'canvas.path');
  const galleryPath = await resolveExistingWithin(root, data.gallery.path, 'gallery.path');
  await compareReceiptFileDigest(canvasPath, data.upstream_digests.canvas_session, 'canvas_session', errors);
  await compareReceiptFileDigest(galleryPath, data.upstream_digests.gallery_manifest, 'gallery_manifest', errors);
  const canvas = await readPlanReviewSession(canvasPath);
  await verifyPlanReviewEvidencePaths(root, canvas, canvasPath);
  await verifyPlanReviewArtifacts(root, canvas.artifacts);
  await verifyPlanReviewComments(root, canvas);
  if (canvas.session_id !== sessionId) errors.push('receipt session_id does not match the upstream Canvas');
  if (canvas.status !== 'closed' || !canvas.verdict) errors.push('upstream Canvas is not explicitly closed');
  if (canvas.demand_trigger.kind !== demandTrigger.kind || canvas.demand_trigger.evidence !== demandTrigger.evidence) {
    errors.push('receipt demand_trigger does not exactly match the upstream Canvas');
  }
  if (data.canvas.path !== portableRelative(root, canvasPath)
    || data.canvas.status !== canvas.status
    || data.canvas.verdict !== canvas.verdict
    || data.canvas.artifact_integrity !== 'verified') {
    errors.push('receipt Canvas semantics do not match the upstream Canvas');
  }

  const galleryVerification = await verifyFinalGalleryManifest({ root, manifest_path: portableRelative(root, galleryPath) });
  const galleryData = await readJson(galleryPath, 'final gallery manifest');
  const gallerySessionId = safeId(galleryData.session_id, 'final gallery session_id');
  const completionState = enumValue(galleryData.completion_state, ['draft', 'ready_for_inspection', 'packaged'], 'gallery completion_state');
  if (!galleryVerification.ready) errors.push(`final gallery integrity is blocked: ${galleryVerification.next_action}`);
  if (gallerySessionId !== sessionId) errors.push('receipt session_id does not match the upstream final gallery');
  if (data.gallery.path !== portableRelative(root, galleryPath)
    || data.gallery.completion_state !== completionState
    || data.gallery.integrity !== 'verified'
    || stableJson(data.gallery.claims) !== stableJson(galleryVerification.claims)) {
    errors.push('receipt gallery semantics do not match the upstream final gallery');
  }

  let revisionState: DesignRevisionState | null = null;
  if (data.revision === null) {
    if (data.upstream_digests.revision_state !== null) errors.push('revision_state digest must be null when no revision state is recorded');
  } else {
    const revisionEvidence = data.revision as JsonObject;
    try {
      const boundRevision = await loadBoundDesignRevisionState(root, revisionEvidence.path, 'revision.path');
      const revisionPath = boundRevision.statePath;
      revisionState = boundRevision.state;
      await compareReceiptFileDigest(revisionPath, data.upstream_digests.revision_state, 'revision_state', errors);
      if (revisionState.session_id !== sessionId
        || revisionEvidence.path !== portableRelative(root, revisionPath)
        || revisionEvidence.status !== revisionState.status
        || revisionEvidence.rounds !== revisionState.rounds.length
        || revisionEvidence.reference_integrity !== 'verified') {
        errors.push('receipt revision semantics do not match the upstream revision state');
      }
      if (!['accepted', 'two_round_limit'].includes(revisionState.status)) errors.push(`revision state is not terminal: ${revisionState.status}`);
      assertRevisionChronology(canvas, revisionState);
      const canvasCommentIds = new Set(canvas.comments.map((comment) => comment.id));
      for (const round of revisionState.rounds) {
        if (!canvasCommentIds.has(round.reviewer_finding.source_comment_id)) errors.push(`revision round ${round.round} is not linked to a Canvas comment id`);
        for (let index = 0; index < round.revision_refs.length; index += 1) {
          await validateUeyeRevisionReference(root, round.revision_refs[index], `rounds[${round.round}].revision_refs[${index}]`);
        }
      }
      const finalRoundRefs = new Set((revisionState.rounds.at(-1)?.revision_refs || []).map(revisionReferenceKey));
      for (const [index, artifact] of (galleryData.artifacts as GalleryArtifact[]).entries()) {
        if (!finalRoundRefs.has(revisionReferenceKey(artifact.revision_ref))) errors.push(`gallery artifact ${index} is not linked to the final revision round`);
      }
    } catch (error) {
      errors.push(`revision_state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (canvas.verdict === 'request_changes' && !revisionState) errors.push('request_changes Canvas requires a bound phase revision state');
  if (canvas.verdict !== 'request_changes' && revisionState) errors.push('phase revision state requires a request_changes Canvas verdict');
  if (revisionState?.status === 'two_round_limit' && completionState !== 'draft') errors.push('two_round_limit requires a draft gallery');
  try {
    assertGalleryChronology(canvas, revisionState, galleryData);
  } catch (error) {
    errors.push(`gallery chronology: ${error instanceof Error ? error.message : String(error)}`);
  }

  const fullyAccepted = canvas.verdict === 'approve' || revisionState?.status === 'accepted';
  const phaseEvidenceComplete = fullyAccepted && completionState === 'packaged';
  const expectedPhaseStatus = phaseEvidenceComplete ? 'complete' : revisionState?.status === 'two_round_limit' ? 'bounded_stop' : 'incomplete';
  if (data.phase_evidence_status !== expectedPhaseStatus || data.ready !== phaseEvidenceComplete) {
    errors.push('receipt ready/phase_evidence_status is inconsistent with upstream evidence');
  }
  const receiptDigest = prefixedSha256(data.receipt_digest, 'receipt_digest');
  const receiptBase = { ...data };
  delete receiptBase.receipt_digest;
  const expectedReceiptDigest = `sha256:${createHash('sha256').update(stableJson(receiptBase)).digest('hex')}`;
  if (receiptDigest !== expectedReceiptDigest) errors.push('receipt_digest mismatch');
  if (data.ready_to_claim_correctness !== false || data.truth_status !== 'partial'
    || data.next_action !== designPhaseNextAction(phaseEvidenceComplete, revisionState?.status)) {
    errors.push('phase receipt must not claim correctness or verified overall truth');
  }
  return {
    schema: 'yam.design-production-phase-verification.v1',
    receipt_path: receiptPath,
    ready: errors.length === 0,
    errors: uniqueStrings(errors),
    upstream_digests: data.upstream_digests,
    receipt_digest: receiptDigest,
    ready_to_claim_correctness: false,
    next_action: errors[0] || 'phase receipt and upstream evidence digests match; run separate visual, license, and implementation checks',
    truth_status: errors.length ? 'blocked' as const : 'partial' as const
  };
}

function canvasReceipt(sessionPath: string, renderPath: string, session: PlanReviewSession) {
  return {
    schema: 'yam.plan-review-canvas-receipt.v1',
    session_path: sessionPath,
    render_path: renderPath,
    session,
    next_action: session.status === 'open' ? 'record anchored findings, then explicitly close with approve or request_changes' : `session closed with ${session.verdict}`,
    claims: {
      session_artifact_integrity: session.status === 'closed' ? 'verified' : 'pending',
      visual_correctness: 'not_verified',
      implementation_correctness: 'not_verified'
    },
    truth_status: session.status === 'closed' ? 'verified' as const : 'partial' as const
  };
}

function localCanvasBoundary(): PlanReviewSession['execution_boundary'] {
  return {
    storage: 'local_only',
    rendering: 'static_html',
    sandbox: 'csp_no_script_no_network',
    remote_sharing: false,
    server: false,
    background_service: false
  };
}

function validateBoundary(value: unknown) {
  assertExactKeys(value, ['storage', 'rendering', 'sandbox', 'remote_sharing', 'server', 'background_service'], 'execution_boundary');
  const boundary = value as JsonObject;
  if (boundary.storage !== 'local_only' || boundary.rendering !== 'static_html' || boundary.sandbox !== 'csp_no_script_no_network'
    || boundary.remote_sharing !== false || boundary.server !== false || boundary.background_service !== false) {
    throw new Error('plan review execution boundary must remain local, static, sandboxed, and inert');
  }
}

function validateStoredPlanArtifact(value: unknown, index: number): PlanReviewArtifact {
  assertExactKeys(value, ['id', 'role', 'file_path', 'sha256'], `artifacts[${index}]`);
  const item = value as JsonObject;
  return {
    id: safeId(item.id, `artifacts[${index}].id`),
    role: enumValue(item.role, ['plan', 'reference', 'deliverable'], `artifacts[${index}].role`),
    file_path: safeRelativePath(item.file_path, `artifacts[${index}].file_path`),
    sha256: assertSha256(item.sha256, `artifacts[${index}].sha256`)
  };
}

function validatePlanReviewComment(value: unknown, artifacts: PlanReviewArtifact[]): PlanReviewComment {
  assertExactKeys(value, ['id', 'anchor', 'finding', 'requested_change', 'anchor_context'], 'comment');
  const item = value as JsonObject;
  assertExactKeys(item.anchor, ['artifact_id', 'kind', 'locator'], 'comment.anchor');
  const anchor = item.anchor as JsonObject;
  const artifactId = safeId(anchor.artifact_id, 'comment.anchor.artifact_id');
  if (!artifacts.some((artifact) => artifact.id === artifactId)) throw new Error(`comment anchor references unknown artifact: ${artifactId}`);
  return {
    id: safeId(item.id, 'comment.id'),
    anchor: {
      artifact_id: artifactId,
      kind: enumValue(anchor.kind, ['line', 'region', 'text'], 'comment.anchor.kind'),
      locator: boundedText(anchor.locator, 'comment.anchor.locator', 500, 1)
    },
    finding: boundedText(item.finding, 'comment.finding', 4000, 8),
    requested_change: boundedText(item.requested_change, 'comment.requested_change', 4000, 8),
    anchor_context: boundedText(item.anchor_context, 'comment.anchor_context', 4000, 1)
  };
}

async function validateAndCapturePlanReviewComment(root: string, value: unknown, artifacts: PlanReviewArtifact[]): Promise<PlanReviewComment> {
  assertExactKeys(value, ['id', 'anchor', 'finding', 'requested_change'], 'comment');
  const item = value as JsonObject;
  assertExactKeys(item.anchor, ['artifact_id', 'kind', 'locator'], 'comment.anchor');
  const anchor = item.anchor as JsonObject;
  const artifactId = safeId(anchor.artifact_id, 'comment.anchor.artifact_id');
  const artifact = artifacts.find((candidate) => candidate.id === artifactId);
  if (!artifact) throw new Error(`comment anchor references unknown artifact: ${artifactId}`);
  const kind = enumValue(anchor.kind, ['line', 'region', 'text'], 'comment.anchor.kind');
  const locator = boundedText(anchor.locator, 'comment.anchor.locator', 500, 1);
  const file = await resolveExistingWithin(root, artifact.file_path, 'comment anchor artifact path');
  const anchorContext = await captureAnchorContext(file, kind, locator);
  return {
    id: safeId(item.id, 'comment.id'),
    anchor: { artifact_id: artifactId, kind, locator },
    finding: boundedText(item.finding, 'comment.finding', 4000, 8),
    requested_change: boundedText(item.requested_change, 'comment.requested_change', 4000, 8),
    anchor_context: anchorContext
  };
}

function validateReviewerFinding(value: unknown): DesignRevisionRound['reviewer_finding'] {
  assertExactKeys(value, ['id', 'source_comment_id', 'summary', 'evidence'], 'reviewer_finding');
  const finding = value as JsonObject;
  return {
    id: safeId(finding.id, 'reviewer_finding.id'),
    source_comment_id: safeId(finding.source_comment_id, 'reviewer_finding.source_comment_id'),
    summary: boundedText(finding.summary, 'reviewer_finding.summary', 4000, 8),
    evidence: boundedText(finding.evidence, 'reviewer_finding.evidence', 4000, 8)
  };
}

function validateDemandTrigger(value: unknown): DesignProductionDemandTrigger {
  if (!isObject(value)) throw new Error('demand_trigger must be an object');
  return {
    kind: enumValue(value.kind, ['repeated_plan_review', 'multi_asset_production'], 'demand_trigger.kind'),
    evidence: boundedText(value.evidence, 'demand_trigger.evidence', 4000, 12)
  };
}

function validateStoredRevisionRound(value: unknown, index: number): DesignRevisionRound {
  assertExactKeys(value, ['round', 'reviewer_finding', 'planned_change', 'outcome', 'revision_refs', 'recorded_at'], `rounds[${index}]`);
  const item = value as JsonObject;
  if (!Number.isInteger(item.round) || Number(item.round) < 1 || Number(item.round) > MAX_REVISION_ROUNDS) throw new Error(`rounds[${index}].round must be one or two`);
  if (!Array.isArray(item.revision_refs) || !item.revision_refs.length) throw new Error(`rounds[${index}].revision_refs must be a non-empty array`);
  const references = item.revision_refs.map((ref, refIndex) => validateStoredRevisionReference(ref, `rounds[${index}].revision_refs[${refIndex}]`));
  assertUnique(references.map((ref) => `${ref.artifact_id}:${ref.manifest_path}:${ref.round}`), `rounds[${index}] revision reference`);
  return {
    round: Number(item.round),
    reviewer_finding: validateReviewerFinding(item.reviewer_finding),
    planned_change: boundedText(item.planned_change, `rounds[${index}].planned_change`, 4000, 8),
    outcome: enumValue(item.outcome, ['accepted', 'changes_requested'], `rounds[${index}].outcome`),
    revision_refs: references,
    recorded_at: requiredIsoDate(item.recorded_at, `rounds[${index}].recorded_at`)
  };
}

function validateStoredRevisionReference(value: unknown, label: string): UeyeRevisionReference {
  assertExactKeys(value, ['artifact_id', 'manifest_path', 'round', 'sha256', 'archived_at', 'intent', 'asset_manifest_path', 'asset_id'], label);
  const item = value as JsonObject;
  if (!Number.isInteger(item.round) || Number(item.round) < 1) throw new Error(`${label}.round must be a positive integer`);
  const assetManifestPath = item.asset_manifest_path === null ? null : safeRelativePath(item.asset_manifest_path, `${label}.asset_manifest_path`);
  const assetId = item.asset_id === null ? null : safeId(item.asset_id, `${label}.asset_id`);
  if ((assetManifestPath === null) !== (assetId === null)) throw new Error(`${label} asset_manifest_path and asset_id must both be set or both be null`);
  return {
    artifact_id: safeId(item.artifact_id, `${label}.artifact_id`),
    manifest_path: safeRelativePath(item.manifest_path, `${label}.manifest_path`),
    round: Number(item.round),
    sha256: assertSha256(item.sha256, `${label}.sha256`),
    archived_at: requiredIsoDate(item.archived_at, `${label}.archived_at`),
    intent: enumValue(item.intent, ['preserve', 'edit_copy'], `${label}.intent`),
    asset_manifest_path: assetManifestPath,
    asset_id: assetId
  };
}

async function validateUeyeRevisionReference(root: string, value: unknown, label: string): Promise<UeyeRevisionReference> {
  const reference = validateStoredRevisionReference(value, label);
  if (!reference.asset_manifest_path && reference.intent !== 'preserve') {
    throw new Error(`${label}: an unlinked Ueye revision may only use preserve intent; edit_copy requires an asset manifest entry proving the source is editable`);
  }
  const manifestPath = await resolveExistingWithin(root, reference.manifest_path, `${label}.manifest_path`);
  const history = await readJson(manifestPath, 'Ueye revision history');
  assertExactKeys(history, ['schema', 'updated_at', 'revisions'], 'Ueye revision history');
  if (history.schema !== 'yam.ueye-revision-history.v1' || !Array.isArray(history.revisions)) throw new Error(`${label}: invalid Ueye revision history schema`);
  const matches = history.revisions.filter((entry) => {
    const item = entry as JsonObject;
    return item.artifact_id === reference.artifact_id && item.round === reference.round;
  });
  if (matches.length !== 1) throw new Error(`${label}: Ueye revision reference is ${matches.length ? 'ambiguous' : 'missing'}`);
  const entry = matches[0] as JsonObject;
  assertExactKeys(entry, ['artifact_id', 'round', 'source_path', 'archived_path', 'archived_at', 'sha256', 'bytes', 'dimensions'], 'Ueye revision entry');
  const manifestHash = assertSha256(entry.sha256, 'Ueye revision entry sha256');
  if (manifestHash !== reference.sha256) throw new Error(`${label}: Ueye revision reference sha256 mismatch`);
  const archivedAt = requiredIsoDate(entry.archived_at, 'Ueye revision entry archived_at');
  if (archivedAt !== reference.archived_at) throw new Error(`${label}: Ueye revision archived_at mismatch`);
  const archivedFile = await resolveExistingWithin(path.dirname(manifestPath), entry.archived_path, 'Ueye revision archived_path', root);
  if (await hashFile(archivedFile) !== reference.sha256) throw new Error(`${label}: archived Ueye revision content changed`);

  if (reference.asset_manifest_path && reference.asset_id) {
    const assetManifestPath = await resolveExistingWithin(root, reference.asset_manifest_path, `${label}.asset_manifest_path`);
    const manifest = await readJson(assetManifestPath, 'Ueye asset manifest');
    assertExactKeys(manifest, ['schema', 'updated_at', 'assets'], 'Ueye asset manifest');
    if (manifest.schema !== 'yam.ueye-asset-manifest.v1' || !Array.isArray(manifest.assets)) throw new Error(`${label}: invalid Ueye asset manifest schema`);
    const assets = manifest.assets.filter((asset) => (asset as JsonObject).id === reference.asset_id);
    if (assets.length !== 1) throw new Error(`${label}: Ueye asset protection reference is ${assets.length ? 'ambiguous' : 'missing'}`);
    const asset = assets[0] as JsonObject;
    if (typeof asset.do_not_replace !== 'boolean') throw new Error(`${label}: Ueye asset protection flag is invalid`);
    if (typeof asset.allowed_for_edit !== 'boolean') throw new Error(`${label}: Ueye asset editability flag is invalid`);
    const assetHash = assertSha256(asset.sha256, `${label}: Ueye asset sha256`);
    if (typeof asset.file_path !== 'string') throw new Error(`${label}: Ueye asset file_path is invalid`);
    const assetFile = await resolveExistingWithin(path.dirname(assetManifestPath), asset.file_path, `${label}: Ueye asset file_path`, root);
    if (assetHash !== reference.sha256) throw new Error(`${label}: Ueye asset and preserved revision sha256 do not match`);
    const currentAssetHash = await hashFile(assetFile);
    if (asset.do_not_replace) {
      if (currentAssetHash !== assetHash) throw new Error(`${label}: protected Ueye asset content changed after its manifest was recorded`);
      if (reference.intent !== 'preserve') {
        throw new Error(`${label}: protected Ueye asset ${reference.asset_id} must use preserve intent; archived revisions must not be overwritten`);
      }
    } else {
      if (reference.intent === 'edit_copy' && asset.allowed_for_edit !== true) {
        throw new Error(`${label}: Ueye asset ${reference.asset_id} is not explicitly allowed_for_edit`);
      }
      if (reference.intent === 'preserve' && currentAssetHash !== assetHash) {
        throw new Error(`${label}: preserved Ueye asset content changed after its manifest was recorded`);
      }
    }
  }
  return {
    ...reference,
    manifest_path: portableRelative(root, manifestPath),
    asset_manifest_path: reference.asset_manifest_path
      ? portableRelative(root, await resolveExistingWithin(root, reference.asset_manifest_path, `${label}.asset_manifest_path`))
      : null
  };
}

function validateProvenance(value: unknown, label: string): GalleryArtifact['provenance'] {
  assertExactKeys(value, ['kind', 'source_ref', 'license_note'], label);
  const item = value as JsonObject;
  return {
    kind: enumValue(item.kind, ['operator', 'generated', 'downloaded'], `${label}.kind`),
    source_ref: boundedText(item.source_ref, `${label}.source_ref`, 2000, 1),
    license_note: boundedText(item.license_note, `${label}.license_note`, 2000, 0)
  };
}

function renderPlanReviewCanvas(session: PlanReviewSession): string {
  const artifactRows = session.artifacts.map((artifact) => (
    `<li><strong>${escapeHtml(artifact.id)}</strong> <span>${escapeHtml(artifact.role)}</span><br><code>${escapeHtml(artifact.file_path)}</code><br><small>sha256:${escapeHtml(artifact.sha256)}</small></li>`
  )).join('\n');
  const commentRows = session.comments.map((comment) => (
    `<li><strong>${escapeHtml(comment.id)}</strong> — ${escapeHtml(comment.anchor.artifact_id)} / ${escapeHtml(comment.anchor.kind)} / ${escapeHtml(comment.anchor.locator)}<pre>${escapeHtml(comment.anchor_context)}</pre><p>${escapeHtml(comment.finding)}</p><p>Requested: ${escapeHtml(comment.requested_change)}</p></li>`
  )).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(session.title)}</title>
<style>*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#171717;background:#fff}header{border-bottom:1px solid #bbb}section{margin:2rem 0}li{margin:1rem 0;padding:1rem;border:1px solid #ccc;border-radius:.5rem}h1,p,pre,code,small{overflow-wrap:anywhere}pre{white-space:pre-wrap;max-width:100%}.boundary{padding:.75rem;background:#f3f3f3}</style>
</head>
<body>
<header><h1>${escapeHtml(session.title)}</h1><p>Session ${escapeHtml(session.session_id)} · ${escapeHtml(session.status)} · verdict ${escapeHtml(session.verdict || 'pending')}</p></header>
<p class="boundary">Local-only static review evidence. Scripts, network requests, forms, remote sharing, servers, and background services are disabled by contract.</p>
<section><h2>Demand trigger</h2><p><strong>${escapeHtml(session.demand_trigger.kind)}</strong> · operator asserted at ${escapeHtml(session.demand_trigger.recorded_at)}</p><p>${escapeHtml(session.demand_trigger.evidence)}</p></section>
<section><h2>Artifacts</h2><ul>${artifactRows}</ul></section>
<section><h2>Anchored findings</h2>${commentRows ? `<ol>${commentRows}</ol>` : '<p>No findings recorded.</p>'}</section>
</body>
</html>
`;
}

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character] || character);
}

async function verifyPlanReviewArtifacts(root: string, artifacts: PlanReviewArtifact[]) {
  for (const artifact of artifacts) {
    const file = await resolveExistingWithin(root, artifact.file_path, `${artifact.id}.file_path`);
    const digest = await hashFile(file);
    if (digest !== artifact.sha256) throw new Error(`${artifact.id}: plan review artifact sha256 changed after the session was created`);
  }
}

async function verifyPlanReviewEvidencePaths(root: string, session: PlanReviewSession, sessionPath: string, renderPath?: string) {
  const base = `.yam/ueye/design-production/${session.session_id}`;
  const expectedSession = path.join(root, base, 'plan-review.json');
  const expectedRender = path.join(root, base, 'canvas.html');
  if (sessionPath !== expectedSession) {
    throw new Error(`plan review session path must remain fixed to ${portableRelative(root, expectedSession)}`);
  }
  if (renderPath && renderPath !== expectedRender) {
    throw new Error(`plan review render path must remain fixed to ${portableRelative(root, expectedRender)} and cannot target unrelated project files`);
  }
}

async function verifyPlanReviewComments(root: string, session: PlanReviewSession) {
  for (const comment of session.comments) {
    const artifact = session.artifacts.find((candidate) => candidate.id === comment.anchor.artifact_id);
    if (!artifact) throw new Error(`comment ${comment.id} references an unknown artifact`);
    const file = await resolveExistingWithin(root, artifact.file_path, `${comment.id}.anchor artifact`);
    const context = await captureAnchorContext(file, comment.anchor.kind, comment.anchor.locator);
    if (context !== comment.anchor_context) {
      throw new Error(`comment ${comment.id} anchor context changed after it was captured`);
    }
  }
}

async function captureAnchorContext(file: string, kind: PlanReviewComment['anchor']['kind'], locator: string): Promise<string> {
  if (kind === 'region') {
    const match = /^(\d+),(\d+),(\d+),(\d+)$/.exec(locator);
    if (!match) throw new Error('region locator must use x,y,width,height non-negative integer syntax');
    const [x, y, width, height] = match.slice(1).map(Number);
    if (width < 1 || height < 1) throw new Error('region locator width and height must be positive');
    const info = await inspectImageFile(file);
    const dimensions = /^(\d+)x(\d+)$/.exec(info.dimensions);
    if (dimensions) {
      const imageWidth = Number(dimensions[1]);
      const imageHeight = Number(dimensions[2]);
      if (x + width > imageWidth || y + height > imageHeight) throw new Error(`region locator exceeds artifact dimensions ${info.dimensions}`);
    }
    return `operator-asserted region ${locator}; artifact dimensions ${info.dimensions}; target semantics and pixel correctness are not independently verified`;
  }
  const stat = await fsp.stat(file);
  if (stat.size > MAX_ANCHOR_BYTES) throw new Error(`text anchor artifact exceeds the ${MAX_ANCHOR_BYTES}-byte limit`);
  const buffer = await fsp.readFile(file);
  if (buffer.includes(0)) throw new Error('line/text anchors require a text artifact');
  const text = buffer.toString('utf8');
  if (kind === 'text') {
    const index = text.indexOf(locator);
    if (index < 0) throw new Error('text anchor locator was not found in the artifact');
    if (index !== text.lastIndexOf(locator)) throw new Error('text anchor locator is ambiguous; use a unique text locator or an exact line anchor');
    const start = Math.max(0, index - 120);
    const end = Math.min(text.length, index + locator.length + 120);
    return text.slice(start, end).trim().slice(0, 1000);
  }
  const lineMatch = /^L(\d+)(?:-L?(\d+))?$/.exec(locator);
  if (!lineMatch) throw new Error('line locator must use L<number> or L<number>-L<number> syntax');
  const startLine = Number(lineMatch[1]);
  const endLine = Number(lineMatch[2] || lineMatch[1]);
  const lines = text.split(/\r?\n/);
  if (startLine < 1 || endLine < startLine || endLine > lines.length) throw new Error(`line anchor ${locator} is outside the artifact line range 1-${lines.length}`);
  return lines.slice(startLine - 1, endLine).map((line, index) => `L${startLine + index}: ${line}`).join('\n').slice(0, 4000);
}

async function canonicalRoot(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !value.trim()) throw new Error('root must be a non-empty path');
  const absolute = path.resolve(value);
  await fsp.mkdir(absolute, { recursive: true });
  return fsp.realpath(absolute);
}

async function resolveExistingWithin(rootOrBase: string, value: unknown, label: string, outerRoot = rootOrBase): Promise<string> {
  const relative = outerRoot === rootOrBase ? safeRelativePath(value, label) : safeManifestRelativePath(value, label);
  const candidate = path.resolve(rootOrBase, relative);
  assertContained(outerRoot, candidate, label);
  const real = await fsp.realpath(candidate);
  assertContained(outerRoot, real, label);
  return real;
}

function safeManifestRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error(`${label} must be a non-empty relative path`);
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) throw new Error(`${label} must be relative to its manifest`);
  return path.normalize(value);
}

async function resolveWritableWithin(root: string, value: unknown, label: string): Promise<string> {
  const relative = safeRelativePath(value, label);
  const candidate = path.resolve(root, relative);
  assertContained(root, candidate, label);
  let ancestor = path.dirname(candidate);
  while (true) {
    try {
      const realAncestor = await fsp.realpath(ancestor);
      assertContained(root, realAncestor, label);
      break;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  try {
    const realCandidate = await fsp.realpath(candidate);
    assertContained(root, realCandidate, label);
    return realCandidate;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return candidate;
}

function safeRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error(`${label} must be a non-empty relative path`);
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) throw new Error(`${label} must be relative to the project root`);
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error(`${label} escapes the project root`);
  return normalized;
}

function assertContained(root: string, candidate: string, label: string) {
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`${label} escapes the project root`);
}

function portableRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

async function readJson(file: string, label: string): Promise<JsonObject> {
  const stat = await fsp.stat(file);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file`);
  if (stat.size > MAX_JSON_BYTES) throw new Error(`${label} exceeds the ${MAX_JSON_BYTES}-byte limit`);
  let value: unknown;
  try {
    value = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

async function hashFile(file: string): Promise<string> {
  const stat = await fsp.stat(file);
  if (!stat.isFile()) throw new Error(`${file} must be a regular file`);
  return createHash('sha256').update(await fsp.readFile(file)).digest('hex');
}

async function compareReceiptFileDigest(file: string, expected: unknown, label: string, errors: string[]) {
  try {
    const digest = prefixedSha256(expected, `${label} digest`);
    const actual = `sha256:${await hashFile(file)}`;
    if (digest !== actual) errors.push(`${label} digest mismatch`);
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeJsonAtomic(file: string, value: unknown, replace = true) {
  await writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`, replace);
}

async function writeTextAtomic(file: string, value: string, replace = true) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${createHash('sha256').update(file).digest('hex').slice(0, 8)}`;
  try {
    await fsp.writeFile(temporary, value, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    if (replace) await fsp.rename(temporary, file);
    else await fsp.link(temporary, file);
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => {});
  }
}

async function assertAbsent(file: string, label: string) {
  try {
    await fsp.lstat(file);
    throw new Error(`${label} already exists; refusing to overwrite immutable design evidence`);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function assertExactKeys(value: unknown, allowed: string[], label: string) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} contains unknown field: ${unknown.sort(compareStableText)[0]}`);
  const required = allowed.filter((key) => !['session_path', 'render_path', 'state_path', 'sha256'].includes(key));
  const missing = required.filter((key) => !(key in value));
  if (missing.length) throw new Error(`${label} is missing field: ${missing[0]}`);
}

function assertExactObjectKeys(value: unknown, keys: string[], label: string): asserts value is JsonObject {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort(compareStableText);
  const expected = [...keys].sort(compareStableText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeId(value: unknown, label: string): string {
  const text = String(value || '');
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(text)) throw new Error(`${label} must match [A-Za-z0-9._-] and be at most 64 characters`);
  if (text === '.' || text === '..') throw new Error(`${label} must not be a dot path segment`);
  return text;
}

function boundedText(value: unknown, label: string, maximum: number, minimum = 1): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const text = value.trim();
  if (text.length < minimum || text.length > maximum) throw new Error(`${label} must contain ${minimum}-${maximum} characters`);
  return text;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  return value as T;
}

function assertSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a lowercase sha256 digest`);
  return value;
}

function prefixedSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a prefixed lowercase sha256 digest`);
  return value;
}

function assertUnique(values: string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function requiredIsoDate(value: unknown, label: string): string {
  if (!isIsoDate(value)) throw new Error(`${label} must be an ISO timestamp`);
  return value;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function aggregateGalleryCompletion(states: GalleryCompletionState[]): GalleryCompletionState {
  const rank: Record<GalleryCompletionState, number> = { draft: 0, ready_for_inspection: 1, packaged: 2 };
  return states.reduce((lowest, state) => rank[state] < rank[lowest] ? state : lowest, 'packaged');
}

function revisionReferenceKey(reference: UeyeRevisionReference): string {
  return `${reference.artifact_id}\0${reference.manifest_path}\0${reference.round}\0${reference.sha256}`;
}

function designPhaseNextAction(phaseEvidenceComplete: boolean, revisionStatus?: DesignRevisionStatus): string {
  if (phaseEvidenceComplete) return 'phase evidence is complete; visual, license, and implementation correctness still require their own verification';
  if (revisionStatus === 'two_round_limit') return 'stop after two rounds and leave the gallery draft until a new explicitly authorized phase';
  return 'finish accepted revisions and package the gallery before a complete phase claim';
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(compareStableText).map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertRevisionChronology(canvas: PlanReviewSession, state: DesignRevisionState) {
  let lowerBound = Date.parse(canvas.closed_at as string);
  for (const round of state.rounds) {
    const recordedAt = Date.parse(round.recorded_at);
    if (recordedAt < lowerBound) throw new Error(`revision round ${round.round} was recorded before its phase review boundary`);
    const archiveTimes = round.revision_refs.map((reference) => Date.parse(reference.archived_at));
    if (archiveTimes.some((timestamp) => timestamp > recordedAt)) {
      throw new Error(`revision round ${round.round} references an archive created after the round was recorded`);
    }
    if (!archiveTimes.some((timestamp) => timestamp >= lowerBound && timestamp <= recordedAt)) {
      throw new Error(`revision round ${round.round} requires a fresh Ueye archive created after its triggering review boundary`);
    }
    lowerBound = recordedAt;
  }
}

function assertGalleryChronology(canvas: PlanReviewSession, state: DesignRevisionState | null, gallery: JsonObject) {
  const galleryCreatedAt = Date.parse(requiredIsoDate(gallery.created_at, 'final gallery created_at'));
  const canvasClosedAt = Date.parse(canvas.closed_at as string);
  if (galleryCreatedAt < canvasClosedAt) {
    throw new Error('final gallery was created before the Plan Review Canvas closed');
  }
  const finalRoundRecordedAt = state?.rounds.at(-1)?.recorded_at;
  if (finalRoundRecordedAt && galleryCreatedAt < Date.parse(finalRoundRecordedAt)) {
    throw new Error('final gallery was created before the final revision round was recorded');
  }
}

function planReviewRelativePath(sessionId: string): string {
  return `.yam/ueye/design-production/${safeId(sessionId, 'session_id')}/plan-review.json`;
}

function revisionStateRelativePath(sessionId: string): string {
  return `.yam/ueye/design-production/${safeId(sessionId, 'session_id')}/revision-state.json`;
}

async function loadBoundDesignRevisionState(root: string, suppliedPath: unknown, label = 'state_path') {
  const relative = safeRelativePath(suppliedPath, label);
  const statePath = await resolveExistingWithin(root, relative, label);
  const state = await readDesignRevisionState(statePath);
  const expectedStateRelative = revisionStateRelativePath(state.session_id);
  const expectedStatePath = await resolveExistingWithin(root, expectedStateRelative, label);
  if (relative !== expectedStateRelative || statePath !== expectedStatePath || statePath !== path.join(root, expectedStateRelative)) {
    throw new Error(`${label} must be the session-derived canonical path ${expectedStateRelative}`);
  }
  const expectedCanvasRelative = planReviewRelativePath(state.session_id);
  if (state.canvas_session_path !== expectedCanvasRelative) {
    throw new Error(`revision state canvas_session_path must remain fixed to ${expectedCanvasRelative}`);
  }
  const canvasPath = await resolveExistingWithin(root, state.canvas_session_path, 'canvas_session_path');
  if (await hashFile(canvasPath) !== state.canvas_session_sha256) {
    throw new Error('bound Plan Review Canvas changed after the revision state was created');
  }
  const canvas = await readPlanReviewSession(canvasPath);
  await verifyPlanReviewEvidencePaths(root, canvas, canvasPath);
  await verifyPlanReviewArtifacts(root, canvas.artifacts);
  await verifyPlanReviewComments(root, canvas);
  if (canvas.session_id !== state.session_id || canvas.status !== 'closed' || canvas.verdict !== 'request_changes') {
    throw new Error('revision state must remain bound to its closed request_changes Plan Review Canvas');
  }
  return { statePath, state, canvasPath, canvas };
}

function assertRevisionRoundChronology(
  canvas: PlanReviewSession,
  state: DesignRevisionState,
  refs: UeyeRevisionReference[],
  recordedAt: string,
  round: number
) {
  const lowerBound = Date.parse(state.rounds.at(-1)?.recorded_at || (canvas.closed_at as string));
  const recordedTime = Date.parse(recordedAt);
  if (recordedTime < lowerBound) throw new Error(`revision round ${round} was recorded before its current review boundary`);
  const archiveTimes = refs.map((reference) => Date.parse(reference.archived_at));
  if (archiveTimes.some((timestamp) => timestamp > recordedTime)) {
    throw new Error(`revision round ${round} references an archive created after the round was recorded`);
  }
  if (!archiveTimes.some((timestamp) => timestamp >= lowerBound)) {
    throw new Error(`revision round ${round} requires a fresh Ueye archive created after its current review boundary`);
  }
}
