#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  const toolsDoctor = JSON.parse(execFileSync(bin, ['tools', 'doctor', root, '--json'], { encoding: 'utf8' }));
  assert(toolsDoctor.contextPressure?.schema === 'yam.context-pressure.v1', 'tools doctor missing contextPressure');
  assert(toolsDoctor.realProbe?.schema === 'yam.real-probe.v1', 'tools doctor missing realProbe');
  execFileSync(bin, ['loop', '--help'], { stdio: 'ignore' });
  const loopReport = spawnFailureJson(bin, ['loop', 'report', '--route', 'quick', '--intent', 'fix release readiness', '--stage', 'inspect:passed:read release report', '--evidence', 'typecheck passed', '--evidence-level', 'local', '--evidence-stamp', 'sha256:smoke-release-report', '--covered-requirement', 'release report is read-only', '--blocked-kind', 'auth_blocked', '--failure-cause', 'auth_token_invalid', '--safe-retry', 'retry after npm whoami succeeds', '--recovery-hint', 'refresh npm auth, then rerun readiness checks', '--fix-first-item', 'npm auth must be verified before publish', '--remaining-task', 'rerun release report after auth refresh', '--recommended-direction', 'fix npm auth first, then publish manually', '--implementation-note', 'keep loop report read-only', '--why-this-next', 'auth blocks public release claims', '--blocked-by', 'npm whoami E401', '--owner-route', 'deep', '--owner-scope', 'release readiness only', '--scope-owner', '$deep', '--side-effect', 'no publish attempted', '--avoidance-note', 'do not retry publish before npm auth is proven', '--issue-code', 'src/bin/yam.ts release report', '--issue-role', 'summarizes release readiness without publishing', '--issue-symptom', 'npm auth failure needs clearer next action', '--changed-code', 'yam loop report', '--changed-role', 'records loop evidence and learning note', '--change-summary', 'added a read-only loop artifact', '--why-important', 'it helps users learn what changed without overclaiming verification', '--learning-note', 'fix blockers before claiming done', '--json']);
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
  assert(loopReport.next_action === 'resolve the blocker before claiming this loop complete', 'loop report should not claim a normal next action when blocked');
  assert(loopReport.stage_conventions?.includes('handoff'), 'loop report missing stage conventions');
  assert(loopReport.evidence_level === 'local', 'loop report missing evidence level');
  assert(loopReport.evidence_stamp === 'sha256:smoke-release-report', 'loop report missing evidence stamp');
  assert(loopReport.source_digest === 'sha256:smoke-release-report', 'loop report should mirror source digest');
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
  const ueyeReport = JSON.parse(execFileSync(bin, ['ueye', 'report', '--review-session-id', 'smoke', '--preflight-id', ueyePreflight.preflight_id, '--quality-gate-note', 'capture before verified claim', '--similar', 'reference inventory recorded', '--resolved', 'primary visual note', '--new-finding', 'mobile state missing', '--still-open', 'actual screenshot needed', '--viewport', '1440x900', '--state', 'default', '--json'], { encoding: 'utf8' }));
  assert(ueyeReport.preflight?.preflight_id === ueyePreflight.preflight_id, 'ueye report missing preflight id');
  const ueyeBriefReport = JSON.parse(execFileSync(bin, ['ueye', 'report', '--brief-dimension', 'primary CTA clarity', '--constraint', 'mobile first', '--json'], { encoding: 'utf8' }));
  assert(ueyeBriefReport.design_brief?.schema === 'yam.ueye-design-brief.v1', 'ueye design brief schema missing');
  assert(ueyeBriefReport.anti_slop_review?.schema === 'yam.ueye-anti-slop-review.v1', 'ueye anti-slop schema missing');
  const p0RiskReport = spawnFailureJson(bin, ['ueye', 'report', '--preflight-id', ueyePreflight.preflight_id, '--p0-risk', 'mobile CTA may clip', '--json']);
  assert(p0RiskReport.truth_status === 'blocked', 'ueye p0-risk should block completion truth');
  execFileSync(bin, ['ueye', 'report', '--completion-claim', 'done', '--design-quality', 'not-checked', '--json'], { stdio: 'ignore' });
  expectFailure(() => execFileSync(bin, ['ueye', 'report', '--completion-claim', 'done', '--design-quality', 'pass', '--p0', 'primary CTA is clipped', '--json'], { stdio: 'ignore' }), 'Ueye P0 completion gate should fail');
  const antiSlopBlocked = spawnFailureJson(bin, ['ueye', 'report', '--completion-claim', 'done', '--design-quality', 'pass', '--invented-metric', '--json']);
  assert(antiSlopBlocked.anti_slop_review?.truth_status === 'blocked', 'ueye anti-slop should block truth');
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
