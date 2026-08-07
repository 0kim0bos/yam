#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  verifyHelpContract(bin, prefix, env);
  verifyOwnershipCliContract(bin, prefix, env);
  verifyDetectionRecommendationContract(bin, prefix, env);
  verifyInstructionDuplicationContract(bin, prefix, env);
  execFileSync(bin, ['verify'], { stdio: 'ignore' });
  execFileSync(bin, ['doctor'], { stdio: 'ignore' });
  execFileSync(bin, ['doctor', '--json'], { stdio: 'ignore' });
  execFileSync(bin, ['list'], { stdio: 'ignore' });
  const oversizedSafetySentinel = 'general-stdin-secret-sentinel';
  const oversizedSafety = spawnFailureTextWithInput(
    bin,
    ['safety'],
    `${oversizedSafetySentinel}-${'x'.repeat(4 * 1024 * 1024)}`,
  );
  assert(oversizedSafety.includes('input_too_large'), 'general stdin should report its bounded-input error code');
  assert(!oversizedSafety.includes(oversizedSafetySentinel), 'general stdin error must not echo rejected input');
  const contextPressure = JSON.parse(execFileSync(bin, ['context', 'pressure', root, '--json'], { encoding: 'utf8' }));
  assert(contextPressure.schema === 'yam.context-pressure.v1', 'context pressure schema missing');
  const cleanupScan = JSON.parse(execFileSync(bin, ['cleanup', 'scan', root, '--json'], { encoding: 'utf8' }));
  assert(cleanupScan.schema === 'yam.cleanup-scan.v1', 'cleanup scan schema missing');
  const studyNoteProject = join(prefix, 'study-note-changed');
  mkdirSync(studyNoteProject, { recursive: true });
  writeFileSync(join(studyNoteProject, 'tracked.txt'), 'baseline\n');
  execFileSync('git', ['init', '-q'], { cwd: studyNoteProject });
  execFileSync('git', ['add', 'tracked.txt'], { cwd: studyNoteProject });
  execFileSync('git', ['-c', 'user.name=yam-smoke', '-c', 'user.email=yam-smoke@example.com', 'commit', '-qm', 'baseline'], { cwd: studyNoteProject });
  writeFileSync(join(studyNoteProject, 'tracked.txt'), 'changed\n');
  const missingStudyNoteGuard = spawnFailureJson(bin, ['study-note', 'check', studyNoteProject, '--json']);
  assert(missingStudyNoteGuard.schema === 'yam.study-note-guard.v1', 'study note guard schema missing');
  assert(missingStudyNoteGuard.truth_status === 'blocked', 'study note guard should block changed files without report text');
  const completeStudyNote = 'Study Note: Touched code role explains what the function does. It runs during CLI validation. Before/after behavior changed. Expected behavior should pass. Structure insight: a condition selects the result. Verification checked the CLI. Limits: no meaningful uncertainty remains.';
  const passingStudyNoteGuard = JSON.parse(execFileSync(bin, ['study-note', 'check', studyNoteProject, '--text', completeStudyNote, '--json'], { encoding: 'utf8' }));
  assert(passingStudyNoteGuard.truth_status === 'verified', 'study note guard should pass supplied Study Note text');
  const nonGitProject = join(prefix, 'study-note-no-git');
  mkdirSync(nonGitProject, { recursive: true });
  writeFileSync(join(nonGitProject, 'artifact.txt'), 'Git scope intentionally unavailable\n');
  const nonGitBefore = snapshotVisibleTree(nonGitProject);
  const unavailableStudyNoteGuard = JSON.parse(execFileSync(bin, ['study-note', 'check', nonGitProject, '--json'], { encoding: 'utf8' }));
  assert(unavailableStudyNoteGuard.changed_file_detection?.available === false, 'Study Note guard should expose unavailable Git scope');
  assert(unavailableStudyNoteGuard.checks?.find((item) => item.id === 'changed_files')?.status === 'partial', 'unavailable Git scope should not be reported as clean or skipped');
  assert(unavailableStudyNoteGuard.truth_status === 'partial', 'unavailable Git scope should cap Study Note truth to partial');
  assert(unavailableStudyNoteGuard.next_action?.includes('inspect changed artifacts manually'), 'unavailable Git scope should provide a manual inspection next action');
  const unavailableStudyNotePrompt = JSON.parse(execFileSync(bin, ['hook', 'run', 'study-note'], {
    input: JSON.stringify({ cwd: nonGitProject, hook_event_name: 'UserPromptSubmit' }),
    encoding: 'utf8'
  }));
  assert(unavailableStudyNotePrompt.hookSpecificOutput?.additionalContext?.includes('scope is unavailable'), 'Study Note prompt should warn when Git scope is unavailable');
  assert(unavailableStudyNotePrompt.hookSpecificOutput?.additionalContext?.includes('do not treat this as a clean project'), 'Study Note prompt should not silently fail open outside Git');
  const unavailableStudyNoteStop = JSON.parse(execFileSync(bin, ['hook', 'run', 'study-note'], {
    input: JSON.stringify({ cwd: nonGitProject, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.' }),
    encoding: 'utf8'
  }));
  assert(unavailableStudyNoteStop.continue === true && !unavailableStudyNoteStop.decision, 'unavailable Git scope should remain advisory instead of inventing changed files');
  assert(unavailableStudyNoteStop.systemMessage?.includes('could not read Git changed-file scope'), 'Study Note Stop should keep unavailable scope visible');
  assert(snapshotVisibleTree(nonGitProject) === nonGitBefore, 'non-Git Study Note check and hooks must remain read-only');
  const toolsDoctor = JSON.parse(execFileSync(bin, ['tools', 'doctor', root, '--json'], { encoding: 'utf8' }));
  assert(toolsDoctor.contextPressure?.schema === 'yam.context-pressure.v1', 'tools doctor missing contextPressure');
  assert(toolsDoctor.realProbe?.schema === 'yam.real-probe.v1', 'tools doctor missing realProbe');
  const hookRunStudyNote = JSON.parse(execFileSync(bin, ['hook', 'run', 'study-note'], { input: JSON.stringify({ cwd: root, hook_event_name: 'UserPromptSubmit' }), encoding: 'utf8' }));
  assert(hookRunStudyNote.hookSpecificOutput?.additionalContext?.includes('Study Note guard active'), 'study note hook should inject advisory context');
  const hookProject = join(prefix, 'hook-project');
  const hookConfigDir = join(hookProject, '.codex');
  const hookConfigFile = join(hookConfigDir, 'hooks.json');
  mkdirSync(hookConfigDir, { recursive: true });
  writeFileSync(hookConfigFile, `${JSON.stringify({
    description: 'preserve this hook metadata',
    SessionStart: [{ hooks: [{ type: 'command', command: 'printf unrelated-session-hook', timeout: 3 }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node /definitely/missing/yam.js hook run study-note', timeout: 5 }] }]
  }, null, 2)}\n`);
  const brokenHookStatus = spawnFailureText(bin, ['hook', 'status', '--project', hookProject]);
  assert(brokenHookStatus.includes('yam-study-note hook: broken'), 'missing hook target should report broken');
  assert(brokenHookStatus.includes('hook target is missing'), 'broken hook status should identify the missing target');
  execFileSync(bin, ['hook', 'enable', 'study-note', '--project', hookProject], { stdio: 'ignore' });
  const hookStatus = execFileSync(bin, ['hook', 'status', '--project', hookProject], { encoding: 'utf8' });
  assert(hookStatus.includes('yam-study-note hook: enabled'), 'study note hook status should show enabled');
  const hookConfig = JSON.parse(readFileSync(hookConfigFile, 'utf8'));
  assert(hookConfig.description === 'preserve this hook metadata', 'hook migration should preserve top-level metadata');
  assert(hookConfig.SessionStart?.[0]?.hooks?.[0]?.command === 'printf unrelated-session-hook', 'hook migration should preserve unrelated hooks');
  assert(hookConfig.UserPromptSubmit?.some((entry) => entry.hooks?.some((handler) => handler.command?.includes('hook run study-note'))), 'study note profile should install UserPromptSubmit');
  assert(hookConfig.Stop?.some((entry) => entry.hooks?.some((handler) => handler.command?.includes('hook run study-note'))), 'study note profile should install Stop completion gate');
  assert(readdirSync(hookConfigDir).some((name) => name.startsWith('hooks.json.yam-backup-')), 'hook migration should create a backup');
  execFileSync('git', ['init', '-q'], { cwd: hookProject });
  writeFileSync(join(hookProject, 'tracked.txt'), 'baseline\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: hookProject });
  execFileSync('git', ['-c', 'user.name=yam-smoke', '-c', 'user.email=yam-smoke@example.com', 'commit', '-qm', 'baseline'], { cwd: hookProject });
  writeFileSync(join(hookProject, 'tracked.txt'), 'changed\n');
  const blockedStop = JSON.parse(execFileSync(bin, ['hook', 'run', 'study-note'], { input: JSON.stringify({ cwd: hookProject, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.' }), encoding: 'utf8' }));
  assert(blockedStop.decision === 'block', 'Study Note Stop hook should request one correction pass');
  assert(blockedStop.reason?.includes('completion gate blocked'), 'Study Note Stop hook should explain the completion block');
  const passingStop = JSON.parse(execFileSync(bin, ['hook', 'run', 'study-note'], { input: JSON.stringify({ cwd: hookProject, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: completeStudyNote }), encoding: 'utf8' }));
  assert(passingStop.continue === true && !passingStop.decision, 'complete Study Note should pass the Stop hook');
  const boundedStop = JSON.parse(execFileSync(bin, ['hook', 'run', 'study-note'], { input: JSON.stringify({ cwd: hookProject, hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: 'Still missing.' }), encoding: 'utf8' }));
  assert(boundedStop.continue === true && boundedStop.systemMessage?.includes('remains blocked'), 'Stop hook should avoid an infinite correction loop and retain a warning');
  const invalidHookProject = join(prefix, 'invalid-hook-project');
  const invalidHookConfigDir = join(invalidHookProject, '.codex');
  const invalidHookConfigFile = join(invalidHookConfigDir, 'hooks.json');
  mkdirSync(invalidHookConfigDir, { recursive: true });
  writeFileSync(invalidHookConfigFile, '{ invalid json\n');
  const invalidHookStatus = spawnFailureText(bin, ['hook', 'status', '--project', invalidHookProject]);
  assert(invalidHookStatus.includes('hook config unreadable'), 'invalid hook config should report broken');
  spawnFailureText(bin, ['hook', 'enable', 'study-note', '--project', invalidHookProject]);
  assert(readFileSync(invalidHookConfigFile, 'utf8') === '{ invalid json\n', 'hook enable should not overwrite unreadable config');
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
  const ueyeImageUpper = join(ueyeArtifactDir, 'reference-upper.png');
  const ueyeImageLower = join(ueyeArtifactDir, 'reference-lower.png');
  const ueyeAssetManifest = join(ueyeArtifactDir, 'assets.json');
  const ueyeRevisionRoot = join(ueyeArtifactDir, 'revisions');
  const ueyeRevisionManifest = join(ueyeRevisionRoot, 'manifest.json');
  writeFileSync(ueyeImage, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  writeFileSync(ueyeImageUpper, Buffer.concat([readFileSync(ueyeImage), Buffer.from('upper')]));
  writeFileSync(ueyeImageLower, Buffer.concat([readFileSync(ueyeImage), Buffer.from('lower')]));
  const assetUpdate = JSON.parse(execFileSync(bin, ['ueye', 'asset', 'add', '--manifest', ueyeAssetManifest, '--id', 'official-logo', '--file', ueyeImage, '--license-note', 'operator supplied for local review', '--operator-provided', '--do-not-replace', '--json'], { encoding: 'utf8' }));
  assert(assetUpdate.schema === 'yam.ueye-asset-update.v1', 'ueye asset update schema missing');
  assert(assetUpdate.asset?.do_not_replace === true, 'ueye asset protection flag missing');
  execFileSync(bin, ['ueye', 'asset', 'add', '--manifest', ueyeAssetManifest, '--id', 'Z-logo', '--file', ueyeImageUpper, '--license-note', 'stable-order fixture', '--operator-provided', '--json'], { encoding: 'utf8' });
  execFileSync(bin, ['ueye', 'asset', 'add', '--manifest', ueyeAssetManifest, '--id', 'a-logo', '--file', ueyeImageLower, '--license-note', 'stable-order fixture', '--operator-provided', '--json'], { encoding: 'utf8' });
  const orderedAssetIds = JSON.parse(readFileSync(ueyeAssetManifest, 'utf8')).assets.map((asset) => asset.id);
  assert(JSON.stringify(orderedAssetIds) === JSON.stringify(['Z-logo', 'a-logo', 'official-logo']), 'Ueye assets should use stable ordinal id ordering');
  const assetVerification = JSON.parse(execFileSync(bin, ['ueye', 'asset', 'verify', '--manifest', ueyeAssetManifest, '--json'], { encoding: 'utf8' }));
  assert(assetVerification.truth_status === 'verified', 'ueye asset verification should pass');
  const revisionArchive = JSON.parse(execFileSync(bin, ['ueye', 'revision', 'archive', '--file', ueyeImage, '--round', '1', '--artifact-id', 'hero', '--root', ueyeRevisionRoot, '--json'], { encoding: 'utf8' }));
  assert(revisionArchive.schema === 'yam.ueye-revision-archive.v1', 'ueye revision archive schema missing');
  execFileSync(bin, ['ueye', 'revision', 'archive', '--file', ueyeImageUpper, '--round', '1', '--artifact-id', 'Z-hero', '--root', ueyeRevisionRoot, '--json'], { encoding: 'utf8' });
  execFileSync(bin, ['ueye', 'revision', 'archive', '--file', ueyeImageLower, '--round', '1', '--artifact-id', 'a-hero', '--root', ueyeRevisionRoot, '--json'], { encoding: 'utf8' });
  const orderedRevisionIds = JSON.parse(readFileSync(ueyeRevisionManifest, 'utf8')).revisions.map((revision) => revision.artifact_id);
  assert(JSON.stringify(orderedRevisionIds) === JSON.stringify(['Z-hero', 'a-hero', 'hero']), 'Ueye revisions should use stable ordinal artifact ordering');
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
  const nestedForgedMissionGate = {
    ...missionGate,
    gate_result: { ...missionGate.gate_result, digest: `sha256:${'0'.repeat(64)}` },
    gate_contract: { ...missionGate.gate_contract, valid: false, truth_status: 'blocked', errors: ['digest_invalid'] }
  };
  const missionProofWithNestedForgedGate = JSON.parse(execFileSync(bin, ['proof', '--route', 'mission', '--truth', 'verified', '--evidence', 'tests passed', '--mission-completion', JSON.stringify(nestedForgedMissionGate), '--json'], { encoding: 'utf8' }));
  assert(missionProofWithNestedForgedGate.truth === 'blocked', 'mission proof should reject an invalid nested strict gate and reported gate contract');
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

function spawnFailureText(bin, args) {
  try {
    execFileSync(bin, args, { encoding: 'utf8' });
  } catch (error) {
    return [error.stdout, error.stderr].filter(Boolean).map(String).join('\n');
  }
  throw new Error(`Expected failure for ${args.join(' ')}`);
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function verifyHelpContract(bin, prefix, baseEnv) {
  const helpRoot = join(prefix, 'help-contract');
  const helpProject = join(helpRoot, 'project');
  const skillsHome = join(helpRoot, 'skills-home');
  const codexMirror = join(helpRoot, 'codex-mirror');
  const proofOut = join(helpProject, 'proof.json');
  const missionOut = join(helpProject, 'mission.json');
  const assetManifest = join(helpProject, 'assets.json');
  const revisionRoot = join(helpProject, 'revisions');
  const image = join(helpProject, 'reference.png');
  mkdirSync(join(skillsHome, 'quick'), { recursive: true });
  mkdirSync(join(codexMirror, 'quick'), { recursive: true });
  mkdirSync(helpProject, { recursive: true });
  writeFileSync(join(skillsHome, 'quick', 'sentinel.txt'), 'skills-home sentinel\n');
  writeFileSync(join(codexMirror, 'quick', 'sentinel.txt'), 'codex-mirror sentinel\n');
  writeFileSync(join(helpProject, 'sentinel.txt'), 'project sentinel\n');
  writeFileSync(image, 'not an image because help must not inspect it\n');

  const helpEnv = {
    ...baseEnv,
    YAM_SKILLS_HOME: skillsHome,
    YAM_CODEX_MIRROR: codexMirror
  };
  const runHelp = (args) => {
    const output = execFileSync(bin, args, { cwd: helpProject, env: helpEnv, encoding: 'utf8' });
    assert(output.includes('Usage:'), `help should print usage for: yam ${args.join(' ')}`);
  };

  for (const args of [
    [],
    ['help'],
    ['--help'],
    ['-h'],
    ['install', '--help'],
    ['install', '-h'],
    ['uninstall', '--help'],
    ['uninstall', '-h']
  ]) {
    const before = snapshotTree(helpRoot);
    runHelp(args);
    assert(snapshotTree(helpRoot) === before, `help mutated isolated state: yam ${args.join(' ')}`);
  }

  const topLevelCommands = [
    'help',
    'install',
    'uninstall',
    'version',
    'detect',
    'pack',
    'context',
    'cleanup',
    'budget',
    'measure',
    'tools',
    'proof',
    'study-note',
    'loop',
    'ueye',
    'media',
    'runtime',
    'mission',
    'update',
    'benchmark',
    'release',
    'safety',
    'memory',
    'hook',
    'template',
    'tune-log',
    'status',
    'list',
    'verify',
    'doctor',
    'examples',
    'path',
    'init-project'
  ];
  const nestedCommands = [
    ['context', 'pressure'],
    ['cleanup', 'scan'],
    ['tools', 'doctor'],
    ['proof', 'write', '--out', proofOut],
    ['study-note', 'check'],
    ['loop', 'report'],
    ['ueye', 'capture'],
    ['ueye', 'compare'],
    ['ueye', 'preflight'],
    ['ueye', 'report'],
    ['ueye', 'asset', 'add', '--manifest', assetManifest],
    ['ueye', 'asset', 'verify', '--manifest', assetManifest],
    ['ueye', 'revision', 'archive', '--file', image, '--root', revisionRoot],
    ['ueye', 'revision', 'verify', '--root', revisionRoot],
    ['media', 'proof'],
    ['runtime', 'evidence'],
    ['mission', 'queue', '--out', missionOut],
    ['mission', 'receipt', '--out', missionOut],
    ['mission', 'gate', '--out', missionOut],
    ['update', 'check'],
    ['update', 'apply', '--all'],
    ['benchmark', 'report'],
    ['release', 'report'],
    ['memory', 'init'],
    ['memory', 'add'],
    ['memory', 'list'],
    ['memory', 'summary'],
    ['memory', 'resolve'],
    ['hook', 'status'],
    ['hook', 'enable', 'study-note'],
    ['hook', 'disable', 'study-note'],
    ['hook', 'run', 'study-note']
  ];
  const before = snapshotTree(helpRoot);
  for (const flag of ['--help', '-h']) {
    for (const command of topLevelCommands) runHelp([command, flag]);
    for (const command of nestedCommands) runHelp([...command, flag]);
  }
  assert(snapshotTree(helpRoot) === before, 'comprehensive help contract mutated isolated state');
}

function verifyOwnershipCliContract(bin, prefix, baseEnv) {
  const contractRoot = join(prefix, 'ownership-cli-contract');
  const skillsHome = join(contractRoot, 'skills-home');
  const codexMirror = join(contractRoot, 'codex-mirror');
  const userQuick = '# user-owned quick sentinel\n';
  const userLegacy = '# user-owned legacy sentinel\n';
  const userMirror = '# user-owned mirror sentinel\n';
  mkdirSync(join(skillsHome, 'quick'), { recursive: true });
  mkdirSync(join(skillsHome, 'fast'), { recursive: true });
  mkdirSync(join(codexMirror, 'quick'), { recursive: true });
  writeFileSync(join(skillsHome, 'quick', 'SKILL.md'), userQuick);
  writeFileSync(join(skillsHome, 'fast', 'SKILL.md'), userLegacy);
  writeFileSync(join(codexMirror, 'quick', 'SKILL.md'), userMirror);
  const ownershipEnv = {
    ...baseEnv,
    YAM_SKILLS_HOME: skillsHome,
    YAM_CODEX_MIRROR: codexMirror
  };

  const conflict = spawnFailureTextWithEnv(bin, ['install'], ownershipEnv);
  assert(conflict.includes('active skill ownership conflict'), 'CLI install should fail closed on a user-owned active skill');
  assert(readFileSync(join(skillsHome, 'quick', 'SKILL.md'), 'utf8') === userQuick, 'failed CLI install should preserve user-owned active skill');
  assert(!existsSync(join(skillsHome, '.yam-flow-install-receipt.json')), 'failed CLI install should not write a receipt');

  execFileSync(bin, ['install', '--replace-user-skill', 'quick'], { env: ownershipEnv, stdio: 'ignore' });
  execFileSync(bin, ['status'], { env: ownershipEnv, stdio: 'ignore' });
  const ownershipDoctor = JSON.parse(execFileSync(bin, ['doctor', '--json'], { env: ownershipEnv, encoding: 'utf8' }));
  assert(ownershipDoctor.ok === true, 'doctor should not fail on safely preserved unproven entries');
  assert(ownershipDoctor.preservedUnprovenSkillEntries?.length >= 2, 'doctor should report preserved unproven entries separately');
  assert(ownershipDoctor.preservedUnprovenSkillEntries?.includes('retired-name destination entry: fast'), 'doctor should report preserved destination entries');
  assert(ownershipDoctor.preservedUnprovenSkillEntries?.includes('active-name Codex mirror entry: quick'), 'doctor should report preserved active-name mirror entries');
  assert(readFileSync(join(skillsHome, 'fast', 'SKILL.md'), 'utf8') === userLegacy, 'CLI install should preserve unowned retired skill');
  assert(readFileSync(join(codexMirror, 'quick', 'SKILL.md'), 'utf8') === userMirror, 'CLI install should preserve unowned mirror skill');

  execFileSync(bin, ['uninstall'], { env: ownershipEnv, stdio: 'ignore' });
  assert(!existsSync(join(skillsHome, '.yam-flow-install-receipt.json')), 'safe CLI uninstall should remove its receipt');
  assert(readFileSync(join(skillsHome, 'fast', 'SKILL.md'), 'utf8') === userLegacy, 'safe CLI uninstall should preserve unowned retired skill');
  assert(readFileSync(join(codexMirror, 'quick', 'SKILL.md'), 'utf8') === userMirror, 'safe CLI uninstall should preserve unowned mirror skill');
}

function verifyDetectionRecommendationContract(bin, prefix, baseEnv) {
  const project = join(prefix, 'detect-recommendations');
  const scriptsDir = join(project, 'scripts');
  mkdirSync(join(project, 'src', 'lib'), { recursive: true });
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(join(project, 'notes'), { recursive: true });
  const packageData = {
    name: 'yam-detect-fixture',
    private: true,
    scripts: {
      typecheck: 'node -e "require(\'node:fs\').writeFileSync(\'typecheck-ran\', \'unexpected\')"',
      build: 'node -e "require(\'node:fs\').writeFileSync(\'build-ran\', \'unexpected\')"',
      'custom-smoke': 'node ./scripts/custom-smoke.mjs',
      'secondary-smoke': 'node ./scripts/secondary-smoke.mjs',
      'package-boundary:check': 'node -e "require(\'node:fs\').writeFileSync(\'boundary-ran\', \'unexpected\')"',
      'release:check': 'node -e "require(\'node:fs\').writeFileSync(\'release-ran\', \'unexpected\')"'
    }
  };
  writeFileSync(join(project, 'package.json'), `${JSON.stringify(packageData, null, 2)}\n`);
  writeFileSync(join(project, 'src', 'lib', 'feature.ts'), 'export const feature = 1;\n');
  writeFileSync(join(scriptsDir, 'custom-smoke.mjs'), 'require("node:fs").writeFileSync("script-ran", "unexpected");\n');
  writeFileSync(join(scriptsDir, 'secondary-smoke.mjs'), 'require("node:fs").writeFileSync("secondary-ran", "unexpected");\n');
  writeFileSync(join(project, 'notes', 'tracked.md'), 'baseline\n');
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['add', '.'], { cwd: project });
  execFileSync('git', ['-c', 'user.name=yam-smoke', '-c', 'user.email=yam-smoke@example.com', 'commit', '-qm', 'baseline'], { cwd: project });

  writeFileSync(join(project, 'src', 'lib', 'feature.ts'), 'export const feature = 2;\n');
  writeFileSync(join(scriptsDir, 'custom-smoke.mjs'), 'require("node:fs").writeFileSync("script-ran", "still unexpected");\n');
  writeFileSync(join(scriptsDir, 'secondary-smoke.mjs'), 'require("node:fs").writeFileSync("secondary-ran", "still unexpected");\n');
  execFileSync('git', ['add', 'scripts/custom-smoke.mjs'], { cwd: project });
  execFileSync('git', ['mv', 'notes/tracked.md', 'notes/renamed note.md'], { cwd: project });
  writeFileSync(join(project, 'package.json'), `${JSON.stringify({ ...packageData, description: 'release metadata changed' }, null, 2)}\n`);
  writeFileSync(join(project, 'notes', 'untracked plan.md'), 'unknown path fallback\n');

  const before = snapshotTree(project);
  const detection = JSON.parse(execFileSync(bin, ['detect', project, '--json'], {
    cwd: project,
    env: baseEnv,
    encoding: 'utf8'
  }));
  assert(detection.schema === 'yam.project-detection.v1', 'detect JSON schema missing');
  assert(detection.changedFileDetection?.available === true, 'detect should identify an available Git change source');
  for (const ruleName of ['src-lib', 'scripts', 'package-release-metadata', 'unknown-safe-fallback']) {
    const row = detection.verificationRecommendations?.find((item) => item.matched_rule === ruleName);
    assert(row, `detect recommendation missing ${ruleName}`);
    assert(row.confidence, `${ruleName} recommendation missing confidence`);
    assert(row.reason, `${ruleName} recommendation missing reason`);
    assert(row.fallback, `${ruleName} recommendation missing fallback`);
  }
  const libRow = detection.verificationRecommendations.find((item) => item.matched_rule === 'src-lib');
  assert(libRow.suggested_commands?.includes('npm run typecheck'), 'src/lib rule should recommend available typecheck');
  assert(libRow.suggested_commands?.includes('npm run custom-smoke'), 'src/lib rule should recommend an available focused smoke');
  const scriptsRow = detection.verificationRecommendations.find((item) => item.matched_rule === 'scripts');
  assert(scriptsRow.suggested_commands?.includes('npm run custom-smoke'), 'scripts rule should recommend its direct npm wrapper');
  const packageRow = detection.verificationRecommendations.find((item) => item.matched_rule === 'package-release-metadata');
  assert(packageRow.suggested_commands?.includes('npm run package-boundary:check'), 'package rule missing boundary check');
  assert(packageRow.suggested_commands?.includes('npm run release:check'), 'package rule missing release check');
  const fallbackRow = detection.verificationRecommendations.find((item) => item.matched_rule === 'unknown-safe-fallback');
  assert(fallbackRow.suggested_commands?.includes('npm run typecheck'), 'unknown rule should keep a full safe fallback');
  assert(fallbackRow.files?.includes('notes/untracked plan.md'), 'unknown rule should preserve the source file evidence');
  assert(fallbackRow.files?.includes('notes/renamed note.md'), 'rename rule should preserve the destination path with spaces');
  assert(!detection.changedFiles?.includes('notes/tracked.md'), 'rename parsing should not treat the old source path as another changed file');
  const plannedCommands = detection.verificationCommandPlan?.map((item) => item.command) || [];
  assert(plannedCommands.length === new Set(plannedCommands).size, 'verification command plan should deduplicate commands');
  const customSmokePlan = detection.verificationCommandPlan?.find((item) => item.command === 'npm run custom-smoke');
  assert(customSmokePlan?.matched_rules?.includes('src-lib'), 'deduplicated command plan should preserve src/lib rule provenance');
  assert(customSmokePlan?.matched_rules?.includes('scripts'), 'deduplicated command plan should preserve scripts rule provenance');
  assert(customSmokePlan?.files?.includes('src/lib/feature.ts'), 'deduplicated command plan should preserve src/lib file provenance');
  assert(customSmokePlan?.files?.includes('scripts/custom-smoke.mjs'), 'deduplicated command plan should preserve scripts file provenance');
  const customScriptSource = customSmokePlan?.provenance?.find((item) => item.matched_rule === 'scripts');
  assert(JSON.stringify(customScriptSource?.files) === JSON.stringify(['scripts/custom-smoke.mjs']), 'custom smoke direct-wrapper provenance should name only its changed script');
  assert(customScriptSource?.basis === 'direct-script-wrapper', 'custom smoke should record direct-wrapper provenance');
  const secondarySmokePlan = detection.verificationCommandPlan?.find((item) => item.command === 'npm run secondary-smoke');
  const secondaryScriptSource = secondarySmokePlan?.provenance?.find((item) => item.matched_rule === 'scripts');
  assert(JSON.stringify(secondaryScriptSource?.files) === JSON.stringify(['scripts/secondary-smoke.mjs']), 'secondary smoke direct-wrapper provenance should name only its changed script');
  const human = execFileSync(bin, ['detect', project], { cwd: project, env: baseEnv, encoding: 'utf8' });
  assert(human.includes('Changed-file verification recommendations'), 'detect human output missing recommendation section');
  assert(human.includes('Verification command plan (deduplicated'), 'detect human output missing deduplicated command plan');
  assert(human.includes('confidence: high'), 'detect human output missing confidence');
  assert(human.includes('fallback:'), 'detect human output missing fallback');
  assert(snapshotTree(project) === before, 'detect recommendations must not mutate project files or Git metadata');
  for (const sentinel of ['typecheck-ran', 'build-ran', 'script-ran', 'secondary-ran', 'boundary-ran', 'release-ran']) {
    assert(!existsSync(join(project, sentinel)), `detect must not execute recommended command: ${sentinel}`);
  }

  const cleanProject = join(prefix, 'detect-clean');
  mkdirSync(cleanProject, { recursive: true });
  writeFileSync(join(cleanProject, 'package.json'), `${JSON.stringify(packageData, null, 2)}\n`);
  execFileSync('git', ['init', '-q'], { cwd: cleanProject });
  execFileSync('git', ['add', 'package.json'], { cwd: cleanProject });
  execFileSync('git', ['-c', 'user.name=yam-smoke', '-c', 'user.email=yam-smoke@example.com', 'commit', '-qm', 'baseline'], { cwd: cleanProject });
  const cleanDetection = JSON.parse(execFileSync(bin, ['detect', cleanProject, '--json'], { env: baseEnv, encoding: 'utf8' }));
  assert(cleanDetection.verificationRecommendations?.length === 1, 'clean detect should emit one explicit no-changes row');
  assert(cleanDetection.verificationRecommendations[0].matched_rule === 'no-changes', 'clean detect should not invent changed-file checks');
  assert(cleanDetection.verificationCommandPlan?.length === 0, 'clean detect should not invent a command plan');

  const noPackageProject = join(prefix, 'detect-no-package');
  mkdirSync(noPackageProject, { recursive: true });
  const noPackage = JSON.parse(execFileSync(bin, ['detect', noPackageProject, '--json'], { env: baseEnv, encoding: 'utf8' }));
  assert(noPackage.packageJson === false, 'detect should report a missing package.json honestly');
  assert(noPackage.changedFileDetection?.available === false, 'non-Git detect should report unavailable change scope');
  assert(noPackage.verificationRecommendations?.[0]?.matched_rule === 'git-status-unavailable', 'non-Git detect should not claim a clean scope');
  assert(noPackage.verificationRecommendations?.[0]?.confidence === 'low', 'unavailable Git scope should use low confidence');
  assert(noPackage.verificationRecommendations?.[0]?.suggested_commands?.length === 0, 'detect should not invent unavailable package commands');
}

function verifyInstructionDuplicationContract(bin, prefix, baseEnv) {
  const project = join(prefix, 'instruction-duplication');
  const skillDir = join(project, 'skills', 'quick');
  mkdirSync(skillDir, { recursive: true });
  const fakeSecret = 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const repeated = `Keep every completion claim tied to concrete verification evidence from the current project state; token=${fakeSecret}`;
  writeFileSync(join(project, 'AGENTS.md'), [
    '# Project instructions',
    '',
    `- **${repeated}.**`,
    '',
    '```md',
    `- ${repeated}.`,
    '```',
    ''
  ].join('\n'));
  writeFileSync(join(skillDir, 'SKILL.md'), [
    '---',
    'name: quick',
    '---',
    '',
    '## Rules',
    '',
    `1. ${repeated}`,
    '- Keep reports short.',
    ''
  ].join('\n'));
  const before = snapshotVisibleTree(project);
  const report = JSON.parse(execFileSync(bin, ['cleanup', 'scan', project, '--json'], { env: baseEnv, encoding: 'utf8' }));
  const budget = report.instruction_duplication_budget;
  assert(budget?.schema === 'yam.instruction-duplication-budget.v1', 'cleanup scan missing duplication budget');
  assert(budget.advisory_only === true && budget.hard_gate === false, 'duplication budget must stay advisory');
  assert(budget.destructive === false && report.destructive === false, 'duplication scan must stay read-only');
  assert(budget.duplicate_group_count === 1, 'duplicate fixture should produce one cross-surface group');
  assert(budget.duplicate_groups?.[0]?.surface_count === 2, 'duplicate group should identify both instruction surfaces');
  assert(budget.duplicate_groups?.[0]?.occurrence_count === 2, 'code-fence copy must not count as a directive');
  assert(!JSON.stringify(budget).includes(fakeSecret), 'directive duplication output should redact token-like preview content');
  assert(budget.duplicate_groups?.[0]?.directive_preview?.includes('[redacted]'), 'directive preview should retain a visible redaction marker');
  assert(report.findings?.some((item) => item.risk_level === 'low' && item.surface.includes('directive duplication')), 'cleanup scan should add a low-risk advisory finding');
  assert(report.truth_status === 'partial', 'advisory duplication scan must not claim release-gate verification');
  assert(snapshotVisibleTree(project) === before, 'cleanup duplication scan must not mutate project files');

  const uniqueProject = join(prefix, 'instruction-unique');
  mkdirSync(join(uniqueProject, 'skills', 'quick'), { recursive: true });
  writeFileSync(join(uniqueProject, 'AGENTS.md'), '# Project\n\n- Keep project direction visible before changing implementation files.\n');
  writeFileSync(join(uniqueProject, 'skills', 'quick', 'SKILL.md'), '---\nname: quick\n---\n\n- Run the smallest focused check that supports the requested claim.\n');
  const uniqueReport = JSON.parse(execFileSync(bin, ['cleanup', 'scan', uniqueProject, '--json'], { env: baseEnv, encoding: 'utf8' }));
  assert(uniqueReport.instruction_duplication_budget?.duplicate_group_count === 0, 'unique directives should not be reported as duplicates');

  const cappedProject = join(prefix, 'instruction-cap');
  for (let index = 0; index < 28; index += 1) {
    const dir = join(cappedProject, 'skills', `skill-${String(index).padStart(2, '0')}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: skill-${index}\n---\n\n- This intentionally unique directive belongs only to bounded fixture number ${index} and should not repeat elsewhere.\n`);
  }
  const cappedReport = JSON.parse(execFileSync(bin, ['cleanup', 'scan', cappedProject, '--json'], { env: baseEnv, encoding: 'utf8' }));
  const cappedBudget = cappedReport.instruction_duplication_budget;
  assert(cappedBudget.files_scanned === cappedBudget.limits.max_files, 'instruction scan should honor its file budget');
  assert(cappedBudget.file_limit_reached === true, 'instruction scan should report file-budget truncation');
  assert(cappedBudget.duplicate_groups?.length <= cappedBudget.limits.max_groups, 'instruction scan should honor its group budget');
}

function snapshotTree(root) {
  const rows = [];
  const visit = (current, relative = '.') => {
    const stat = statSync(current);
    rows.push(`${relative}\t${stat.isDirectory() ? 'dir' : 'file'}\t${stat.mode}\t${stat.size}\t${stat.mtimeMs}`);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current).sort()) visit(join(current, entry), join(relative, entry));
    } else {
      rows.push(readFileSync(current).toString('base64'));
    }
  };
  visit(root);
  return rows.join('\n');
}

function snapshotVisibleTree(root) {
  const rows = [];
  const visit = (current, relative = '.') => {
    const stat = statSync(current);
    rows.push(`${relative}\t${stat.isDirectory() ? 'dir' : 'file'}\t${stat.mode}\t${stat.size}\t${stat.mtimeMs}`);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current).sort()) {
        if (entry === '.git') continue;
        visit(join(current, entry), join(relative, entry));
      }
    } else {
      rows.push(readFileSync(current).toString('base64'));
    }
  };
  visit(root);
  return rows.join('\n');
}

function spawnFailureTextWithEnv(bin, args, env) {
  try {
    execFileSync(bin, args, { env, encoding: 'utf8' });
  } catch (error) {
    return [error.stdout, error.stderr].filter(Boolean).map(String).join('\n');
  }
  throw new Error(`Expected failure for ${args.join(' ')}`);
}

function spawnFailureTextWithInput(bin, args, input) {
  try {
    execFileSync(bin, args, { input, encoding: 'utf8' });
  } catch (error) {
    return [error.stdout, error.stderr].filter(Boolean).map(String).join('\n');
  }
  throw new Error(`Expected failure for ${args.join(' ')}`);
}
