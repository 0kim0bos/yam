#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const cache = join(tmpdir(), 'yam-npm-cache');
const env = { ...process.env, npm_config_cache: cache };
const packJson = execFileSync('npm', ['pack', '--json', '--ignore-scripts'], { encoding: 'utf8', env });
const tarball = JSON.parse(packJson)[0]?.filename;
if (!tarball) throw new Error('npm pack did not return a tarball filename');

const prefix = mkdtempSync(join(tmpdir(), 'yam-cli-smoke-'));
try {
  execFileSync('npm', ['install', '--prefix', prefix, join(root, tarball)], { stdio: 'ignore', env });
  const binCandidates = [
    join(prefix, 'node_modules', '.bin', 'yam'),
    join(prefix, 'bin', 'yam'),
    join(prefix, 'node_modules', String(packageJson.name), 'dist', 'bin', 'yam.js')
  ];
  const bin = binCandidates.find((candidate) => existsSync(candidate));
  if (!bin) throw new Error(`yam binary not found after install. Tried: ${binCandidates.join(', ')}`);
  const version = execFileSync(bin, ['version'], { encoding: 'utf8' }).trim();
  execFileSync(bin, ['verify'], { stdio: 'ignore' });
  execFileSync(bin, ['doctor'], { stdio: 'ignore' });
  execFileSync(bin, ['doctor', '--json'], { stdio: 'ignore' });
  execFileSync(bin, ['list'], { stdio: 'ignore' });
  const contextPressure = JSON.parse(execFileSync(bin, ['context', 'pressure', root, '--json'], { encoding: 'utf8' }));
  assert(contextPressure.schema === 'yam.context-pressure.v1', 'context pressure schema missing');
  const cleanupScan = JSON.parse(execFileSync(bin, ['cleanup', 'scan', root, '--json'], { encoding: 'utf8' }));
  assert(cleanupScan.schema === 'yam.cleanup-scan.v1', 'cleanup scan schema missing');
  const missingStudyNoteGuard = spawnFailureJson(bin, ['study-note', 'check', root, '--json']);
  assert(missingStudyNoteGuard.schema === 'yam.study-note-guard.v1', 'study note guard schema missing');
  assert(missingStudyNoteGuard.truth_status === 'blocked', 'study note guard should block changed files without report text');
  const passingStudyNoteGuard = JSON.parse(execFileSync(bin, ['study-note', 'check', root, '--text', 'Study Note: Touched code role before/after changed verification limits.', '--json'], { encoding: 'utf8' }));
  assert(passingStudyNoteGuard.truth_status === 'verified', 'study note guard should pass supplied Study Note text');
  const toolsDoctor = JSON.parse(execFileSync(bin, ['tools', 'doctor', root, '--json'], { encoding: 'utf8' }));
  assert(toolsDoctor.contextPressure?.schema === 'yam.context-pressure.v1', 'tools doctor missing contextPressure');
  assert(toolsDoctor.realProbe?.schema === 'yam.real-probe.v1', 'tools doctor missing realProbe');
  const hookRunStudyNote = JSON.parse(execFileSync(bin, ['hook', 'run', 'study-note'], { input: JSON.stringify({ cwd: root, hook_event_name: 'UserPromptSubmit' }), encoding: 'utf8' }));
  assert(hookRunStudyNote.hookSpecificOutput?.additionalContext?.includes('Study Note guard active'), 'study note hook should inject advisory context');
  const hookProject = join(prefix, 'hook-project');
  execFileSync('mkdir', ['-p', hookProject]);
  execFileSync(bin, ['hook', 'enable', 'study-note', '--project', hookProject], { stdio: 'ignore' });
  const hookStatus = execFileSync(bin, ['hook', 'status', '--project', hookProject], { encoding: 'utf8' });
  assert(hookStatus.includes('yam-study-note hook: enabled'), 'study note hook status should show enabled');
  execFileSync(bin, ['loop', '--help'], { stdio: 'ignore' });
  const loopReport = spawnFailureJson(bin, ['loop', 'report', '--route', 'quick', '--intent', 'fix release readiness', '--stage', 'inspect:passed:read release report', '--evidence', 'typecheck passed', '--evidence-level', 'local', '--evidence-stamp', 'sha256:smoke-release-report', '--touched-file', 'src/bin/yam.ts', '--read-file', 'README.md', '--verified-file', 'scripts/cli-smoke.mjs', '--skipped-check', 'npm publish skipped by design', '--stop-condition', 'stop after release readiness evidence is recorded', '--resume-hint', 'rerun release report after npm auth refresh', '--readiness-state', 'blocked', '--covered-requirement', 'release report is read-only', '--blocked-kind', 'auth_blocked', '--failure-cause', 'auth_token_invalid', '--safe-retry', 'retry after npm whoami succeeds', '--recovery-hint', 'refresh npm auth, then rerun readiness checks', '--fix-first-item', 'npm auth must be verified before publish', '--remaining-task', 'rerun release report after auth refresh', '--recommended-direction', 'fix npm auth first, then publish manually', '--implementation-note', 'keep loop report read-only', '--why-this-next', 'auth blocks public release claims', '--blocked-by', 'npm whoami E401', '--owner-route', 'deep', '--owner-scope', 'release readiness only', '--scope-owner', '$deep', '--side-effect', 'no publish attempted', '--avoidance-note', 'do not retry publish before npm auth is proven', '--issue-code', 'src/bin/yam.ts release report', '--issue-role', 'summarizes release readiness without publishing', '--issue-symptom', 'npm auth failure needs clearer next action', '--changed-code', 'yam loop report', '--changed-role', 'records loop evidence and learning note', '--change-summary', 'added a read-only loop artifact', '--why-important', 'it helps users learn what changed without overclaiming verification', '--learning-note', 'fix blockers before claiming done', '--json']);
  assert(loopReport.schema === 'yam.loop-report.v1', 'loop report schema missing');
  assert(loopReport.study_note?.schema === 'yam.study-note.v1', 'loop report missing study note');
  assert(loopReport.study_note?.problem?.role, 'loop study note problem role missing');
  assert(loopReport.fix_first_items?.[0] === 'npm auth must be verified before publish', 'loop report missing fix-first handoff');
  assert(loopReport.recommended_direction === 'fix npm auth first, then publish manually', 'loop report missing recommended direction');
  assert(loopReport.implementation_notes?.[0] === 'keep loop report read-only', 'loop report missing implementation notes');
  assert(loopReport.why_this_next === 'auth blocks public release claims', 'loop report missing why_this_next');
  assert(loopReport.blocked_by?.[0] === 'npm whoami E401', 'loop report missing blocked_by');
  assert(loopReport.owner_route === '$deep', 'loop report owner route should normalize');
  assert(loopReport.truth_status === 'blocked', 'loop report with blocked_by should be blocked');
  assert(loopReport.next_action === 'restore readiness before claiming this loop complete', 'loop report should not claim a normal next action when readiness is blocked');
  assert(loopReport.stage_conventions?.includes('handoff'), 'loop report missing stage conventions');
  assert(loopReport.evidence_level === 'local', 'loop report missing evidence level');
  assert(loopReport.evidence_stamp === 'sha256:smoke-release-report', 'loop report missing evidence stamp');
  assert(loopReport.source_digest === 'sha256:smoke-release-report', 'loop report should mirror source digest');
  assert(loopReport.touched_files?.[0] === 'src/bin/yam.ts', 'loop report missing touched file');
  assert(loopReport.read_files?.[0] === 'README.md', 'loop report missing read file');
  assert(loopReport.verified_files?.[0] === 'scripts/cli-smoke.mjs', 'loop report missing verified file');
  assert(loopReport.skipped_checks?.[0] === 'npm publish skipped by design', 'loop report missing skipped check');
  assert(loopReport.stop_condition === 'stop after release readiness evidence is recorded', 'loop report missing stop condition');
  assert(loopReport.resume_hint === 'rerun release report after npm auth refresh', 'loop report missing resume hint');
  assert(loopReport.readiness_state === 'blocked', 'loop report missing readiness state');
  assert(loopReport.covered_requirements?.[0] === 'release report is read-only', 'loop report missing covered requirement');
  assert(loopReport.blocked_kind === 'auth_blocked', 'loop report missing blocked kind');
  assert(loopReport.failure_cause === 'auth_token_invalid', 'loop report missing failure cause');
  assert(loopReport.safe_retry === 'retry after npm whoami succeeds', 'loop report missing safe retry');
  assert(loopReport.recovery_hint === 'refresh npm auth, then rerun readiness checks', 'loop report missing recovery hint');
  assert(loopReport.owner_scope?.[0] === 'release readiness only', 'loop report missing owner scope');
  assert(loopReport.scope_owner === '$deep', 'loop report missing scope owner');
  assert(loopReport.side_effects?.[0] === 'no publish attempted', 'loop report missing side effects');
  assert(loopReport.avoidance_note === 'do not retry publish before npm auth is proven', 'loop report missing avoidance note');
  const missingStudyNote = JSON.parse(execFileSync(bin, ['loop', 'report', '--route', 'quick', '--intent', 'minimal note', '--json'], { encoding: 'utf8' }));
  assert(missingStudyNote.study_note?.limits?.includes('issue_code not provided'), 'loop study note should record missing issue_code');
  assert(!missingStudyNote.failure_cause, 'minimal loop report should not invent failure cause');
  assert(!missingStudyNote.recovery_hint, 'minimal loop report should not invent recovery hint');
  const uncoveredLoop = spawnFailureJson(bin, ['loop', 'report', '--route', 'deep', '--intent', 'ship release', '--stage', 'verify:passed:build passed', '--evidence', 'build passed', '--uncovered-requirement', 'npm auth verified', '--truth', 'verified', '--json']);
  assert(uncoveredLoop.truth_status === 'blocked', 'uncovered requirement should block verified truth');
  assert(uncoveredLoop.blocked_kind === 'requirement_uncovered', 'uncovered requirement should default blocked kind');
  assert(uncoveredLoop.next_action === 'cover requirement before claiming complete: npm auth verified', 'uncovered requirement should drive next action');
  const blockedLoop = spawnFailureJson(bin, ['loop', 'report', '--route', 'deep', '--blocked', 'auth not verified', '--json']);
  assert(blockedLoop.truth_status === 'blocked', 'blocked loop report should be blocked');
  execFileSync(bin, ['ueye', '--help'], { stdio: 'ignore' });
  execFileSync(bin, ['ueye', 'capture', '--help'], { stdio: 'ignore' });
  execFileSync(bin, ['ueye', 'compare', '--help'], { stdio: 'ignore' });
  const ueyePreflight = JSON.parse(execFileSync(bin, ['ueye', 'preflight', root, '--json'], { encoding: 'utf8' }));
  assert(ueyePreflight.schema === 'yam.ueye-preflight.v1', 'ueye preflight schema missing');
  execFileSync(bin, ['ueye', 'report', '--help'], { stdio: 'ignore' });
  const ueyeReport = JSON.parse(execFileSync(bin, ['ueye', 'report', '--review-session-id', 'smoke', '--preflight-id', ueyePreflight.preflight_id, '--quality-gate-note', 'capture before verified claim', '--acceptance-criterion', 'primary CTA remains visible on mobile', '--touched-file', 'app/page.tsx', '--read-file', 'components/Button.tsx', '--verified-file', 'screenshots/home.png', '--skipped-check', 'hover state not available in static smoke', '--residual-risk', 'real browser screenshot still needed', '--stop-condition', 'stop after primary visual evidence and residual risk are recorded', '--resume-hint', 'capture mobile screenshot next', '--deep-visual-check', 'state matrix reviewed', '--design-system-evidence', 'button token inspected', '--implementation-evidence', 'static report evidence', '--state-check', 'default:pass', '--state-check', 'mobile:partial', '--similar', 'reference inventory recorded', '--resolved', 'primary visual note', '--new-finding', 'mobile state missing', '--still-open', 'actual screenshot needed', '--viewport', '1440x900', '--state', 'default', '--json'], { encoding: 'utf8' }));
  assert(ueyeReport.preflight?.preflight_id === ueyePreflight.preflight_id, 'ueye report missing preflight id');
  assert(ueyeReport.deep_visual_review?.schema === 'yam.ueye-deep-visual-review.v1', 'ueye deep visual review schema missing');
  assert(ueyeReport.deep_visual_review?.acceptance_criteria?.[0] === 'primary CTA remains visible on mobile', 'ueye deep visual review missing acceptance criteria');
  assert(ueyeReport.deep_visual_review?.state_matrix?.default === 'pass', 'ueye deep visual review missing state matrix');
  assert(ueyeReport.deep_visual_review?.skipped_checks?.[0] === 'hover state not available in static smoke', 'ueye deep visual review missing skipped check');
  const ueyeBriefReport = JSON.parse(execFileSync(bin, ['ueye', 'report', '--brief-dimension', 'primary CTA clarity', '--constraint', 'mobile first', '--json'], { encoding: 'utf8' }));
  assert(ueyeBriefReport.design_brief?.schema === 'yam.ueye-design-brief.v1', 'ueye design brief schema missing');
  assert(ueyeBriefReport.anti_slop_review?.schema === 'yam.ueye-anti-slop-review.v1', 'ueye anti-slop schema missing');
  const p0RiskReport = spawnFailureJson(bin, ['ueye', 'report', '--preflight-id', ueyePreflight.preflight_id, '--p0-risk', 'mobile CTA may clip', '--json']);
  assert(p0RiskReport.truth_status === 'blocked', 'ueye p0-risk should block completion truth');
  execFileSync(bin, ['ueye', 'report', '--completion-claim', 'done', '--design-quality', 'not-checked', '--json'], { stdio: 'ignore' });
  expectFailure(() => execFileSync(bin, ['ueye', 'report', '--completion-claim', 'done', '--design-quality', 'pass', '--p0', 'primary CTA is clipped', '--json'], { stdio: 'ignore' }), 'Ueye P0 completion gate should fail');
  const antiSlopBlocked = spawnFailureJson(bin, ['ueye', 'report', '--completion-claim', 'done', '--design-quality', 'pass', '--invented-metric', '--json']);
  assert(antiSlopBlocked.anti_slop_review?.truth_status === 'blocked', 'ueye anti-slop should block truth');
  const ueyeArtifactDir = join(prefix, 'ueye-artifacts');
  mkdirSync(ueyeArtifactDir, { recursive: true });
  const ueyeImage = join(ueyeArtifactDir, 'reference.png');
  const ueyeAssetManifest = join(ueyeArtifactDir, 'assets.json');
  const ueyeRevisionRoot = join(ueyeArtifactDir, 'revisions');
  const ueyeRevisionManifest = join(ueyeRevisionRoot, 'manifest.json');
  writeFileSync(ueyeImage, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  const assetUpdate = JSON.parse(execFileSync(bin, ['ueye', 'asset', 'add', '--manifest', ueyeAssetManifest, '--id', 'official-logo', '--file', ueyeImage, '--license-note', 'operator supplied for local review', '--operator-provided', '--do-not-replace', '--json'], { encoding: 'utf8' }));
  assert(assetUpdate.schema === 'yam.ueye-asset-update.v1', 'ueye asset update schema missing');
  assert(assetUpdate.asset?.do_not_replace === true, 'ueye asset protection flag missing');
  const assetVerification = JSON.parse(execFileSync(bin, ['ueye', 'asset', 'verify', '--manifest', ueyeAssetManifest, '--json'], { encoding: 'utf8' }));
  assert(assetVerification.truth_status === 'verified', 'ueye asset verification should pass');
  const revisionArchive = JSON.parse(execFileSync(bin, ['ueye', 'revision', 'archive', '--file', ueyeImage, '--round', '1', '--artifact-id', 'hero', '--root', ueyeRevisionRoot, '--json'], { encoding: 'utf8' }));
  assert(revisionArchive.schema === 'yam.ueye-revision-archive.v1', 'ueye revision archive schema missing');
  const revisionVerification = JSON.parse(execFileSync(bin, ['ueye', 'revision', 'verify', '--manifest', ueyeRevisionManifest, '--json'], { encoding: 'utf8' }));
  assert(revisionVerification.truth_status === 'verified', 'ueye revision verification should pass');
  const assetAwareReport = JSON.parse(execFileSync(bin, ['ueye', 'report', '--actual', ueyeImage, '--asset-manifest', ueyeAssetManifest, '--revision-manifest', ueyeRevisionManifest, '--completion-claim', 'done', '--design-quality', 'pass', '--direction-locked', '--states-checked', '--mobile-checked', '--contrast-checked', '--cta-checked', '--json'], { encoding: 'utf8' }));
  assert(assetAwareReport.asset_manifest?.truth_status === 'verified', 'ueye report missing verified asset manifest');
  assert(assetAwareReport.revision_history?.truth_status === 'verified', 'ueye report missing verified revision history');
  execFileSync(bin, ['media', 'proof', '--help'], { stdio: 'ignore' });
  execFileSync(bin, ['media', 'proof', '--json'], { stdio: 'ignore' });
  execFileSync(bin, ['proof', '--route', 'ueye', '--truth', 'verified', '--visual', 'implementation screenshot evidence recorded', '--design-completion', '{"completion_claim":"done","has_implementation_screenshot":true,"design_quality":"pass","states_checked":true,"mobile_checked":true,"contrast_checked":true,"cta_checked":true,"direction_locked":true,"truth_status":"verified"}', '--json'], { stdio: 'ignore' });
  execFileSync(bin, ['runtime', 'evidence', '--help'], { stdio: 'ignore' });
  execFileSync(bin, ['runtime', 'evidence', '--backend', 'terminal', '--claim', 'observed', '--evidence-id', 'smoke-runtime', '--pid', '123', '--port', '3000', '--url', 'http://localhost:3000', '--json'], { stdio: 'ignore' });
  const cleanupMissing = spawnFailureJson(bin, ['runtime', 'evidence', '--backend', 'terminal', '--claim', 'cleanup-verified', '--cleanup-checked', '--json']);
  assert(cleanupMissing.truth_status === 'real_required_missing', 'cleanup without observed evidence should be capped');
  const cleanupProven = JSON.parse(execFileSync(bin, ['runtime', 'evidence', '--backend', 'terminal', '--claim', 'cleanup-verified', '--cleanup-observed', '--exit-code', '0', '--cleanup-method', 'process exit checked', '--json'], { encoding: 'utf8' }));
  assert(cleanupProven.truth_status === 'proven', 'cleanup observed with exit evidence should be proven');
  execFileSync(bin, ['mission', 'queue', '--help'], { stdio: 'ignore' });
  execFileSync(bin, ['mission', 'queue', '--lane-id', 'smoke-lane', '--status', 'applied', '--agent-id', 'smoke-agent', '--scope', 'cli smoke', '--changed', 'src/bin/yam.ts', '--depends-on', 'setup', '--verification-hint', 'cli smoke', '--json'], { stdio: 'ignore' });
  const implementerReceiptFile = join(prefix, 'implementer-receipt.json');
  const reviewerReceiptFile = join(prefix, 'reviewer-receipt.json');
  const unassignedReceiptFile = join(prefix, 'unassigned-receipt.json');
  const missionGateFile = join(prefix, 'mission-gate.json');
  const implementerReceipt = JSON.parse(execFileSync(bin, ['mission', 'receipt', '--thread-id', 'thread-implementer', '--role', 'implementer', '--access-mode', 'write', '--lifecycle', 'stopped', '--outcome', 'passed', '--scope', 'bounded implementation', '--changed', 'src/bin/yam.ts', '--evidence', 'typecheck passed', '--out', implementerReceiptFile, '--json'], { encoding: 'utf8' }));
  assert(implementerReceipt.completion_eligible === true, 'implementer receipt should be completion eligible');
  const reviewerReceipt = JSON.parse(execFileSync(bin, ['mission', 'receipt', '--thread-id', 'thread-reviewer', '--role', 'reviewer', '--lifecycle', 'stopped', '--outcome', 'passed', '--scope', 'read-only review', '--evidence', 'review completed without edits', '--out', reviewerReceiptFile, '--json'], { encoding: 'utf8' }));
  assert(reviewerReceipt.access_mode === 'read_only', 'reviewer should default to read-only');
  assert(reviewerReceipt.completion_eligible === true, 'read-only reviewer receipt should be completion eligible');
  const reviewerWriteViolation = spawnFailureJson(bin, ['mission', 'receipt', '--thread-id', 'thread-reviewer-write', '--role', 'reviewer', '--access-mode', 'write', '--lifecycle', 'stopped', '--outcome', 'passed', '--scope', 'review', '--changed', 'src/bin/yam.ts', '--evidence', 'reviewed', '--json']);
  assert(reviewerWriteViolation.truth_status === 'blocked', 'reviewer write access should block receipt');
  const stoppedWithoutOutcome = spawnFailureJson(bin, ['mission', 'receipt', '--thread-id', 'thread-ambiguous', '--role', 'implementer', '--lifecycle', 'stopped', '--scope', 'implementation', '--evidence', 'thread stopped', '--json']);
  assert(stoppedWithoutOutcome.outcome === 'ambiguous', 'stopped lifecycle should not imply success');
  assert(stoppedWithoutOutcome.truth_status === 'blocked', 'ambiguous stopped receipt should be blocked');
  const missionGate = JSON.parse(execFileSync(bin, ['mission', 'gate', '--expected-thread', 'thread-implementer', '--expected-thread', 'thread-reviewer', '--receipt', implementerReceiptFile, '--receipt', reviewerReceiptFile, '--out', missionGateFile, '--json'], { encoding: 'utf8' }));
  assert(missionGate.ready_to_claim_complete === true, 'mission gate should pass complete receipt inventory');
  const missingReceiptGate = spawnFailureJson(bin, ['mission', 'gate', '--expected-thread', 'thread-implementer', '--expected-thread', 'thread-missing', '--receipt', implementerReceiptFile, '--json']);
  assert(missingReceiptGate.missing_thread_ids?.includes('thread-missing'), 'mission gate should report missing receipt');
  const unexpectedReceiptGate = spawnFailureJson(bin, ['mission', 'gate', '--expected-thread', 'thread-implementer', '--receipt', implementerReceiptFile, '--receipt', reviewerReceiptFile, '--json']);
  assert(unexpectedReceiptGate.unexpected_thread_ids?.includes('thread-reviewer'), 'mission gate should report unexpected receipt');
  assert(unexpectedReceiptGate.truth_status === 'blocked', 'unexpected receipt should block mission gate');
  writeFileSync(unassignedReceiptFile, JSON.stringify({ role: 'reviewer', lifecycle_status: 'stopped', outcome: 'passed', assigned_scope: 'review', verification_evidence: ['reviewed'] }));
  const unassignedReceiptGate = spawnFailureJson(bin, ['mission', 'gate', '--expected-thread', 'thread-implementer', '--receipt', implementerReceiptFile, '--receipt', unassignedReceiptFile, '--json']);
  assert(unassignedReceiptGate.invalid_thread_ids?.includes('missing:receipt-unassigned'), 'mission gate should report a receipt without a thread id');
  const missionProofWithoutGate = JSON.parse(execFileSync(bin, ['proof', '--route', 'mission', '--truth', 'verified', '--evidence', 'tests passed', '--json'], { encoding: 'utf8' }));
  assert(missionProofWithoutGate.truth === 'partial', 'verified mission proof should be capped without completion gate');
  const missionProofWithGate = JSON.parse(execFileSync(bin, ['proof', '--route', 'mission', '--truth', 'verified', '--evidence', 'tests passed', '--mission-completion', JSON.stringify(missionGate), '--json'], { encoding: 'utf8' }));
  assert(missionProofWithGate.truth === 'verified', 'verified mission proof should accept a passing completion gate');
  const missionProofWithForgedGate = JSON.parse(execFileSync(bin, ['proof', '--route', 'mission', '--truth', 'verified', '--evidence', 'tests passed', '--mission-completion', '{"schema":"yam.mission-completion-gate.v1","ready_to_claim_complete":true,"truth_status":"verified"}', '--json'], { encoding: 'utf8' }));
  assert(missionProofWithForgedGate.truth === 'blocked', 'mission proof should recompute and reject a forged completion gate');
  execFileSync(bin, ['benchmark', 'report', '--help'], { stdio: 'ignore' });
  execFileSync(bin, ['benchmark', 'report', '--baseline', '100', '--current', '90', '--unit', 'ms', '--target', 'lower', '--json'], { stdio: 'ignore' });
  console.log(`cli-smoke: ok (${version})`);
} finally {
  rmSync(prefix, { recursive: true, force: true });
  rmSync(join(root, tarball), { force: true });
}

function expectFailure(fn, label) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(label);
}

function spawnFailureJson(bin, args) {
  try {
    execFileSync(bin, args, { encoding: 'utf8' });
  } catch (error) {
    return JSON.parse(String(error.stdout || '{}'));
  }
  throw new Error(`Expected failure for ${args.join(' ')}`);
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}
