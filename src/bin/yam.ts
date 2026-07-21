#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  TRUTH_STATUSES,
  buildLoopReport,
  buildMediaGenerationProof,
  buildMissionCompletionGate,
  buildMissionPatchEnvelope,
  buildMissionSubagentReceipt,
  buildRollbackHint,
  buildRuntimeBackendEvidence,
  buildStudyNote,
  buildUeyeDesignCompletionGate,
  buildUeyeVisualProvenance,
  buildUeyeRunReport,
  buildUeyeSurfaceContext,
  buildYamCompletionProof,
  detectDbSafetyText as detectTrustDbSafetyText,
  isTruthStatus
} from '../lib/trust-kernel.js';
import type { LoopEvidenceLevel, ReadinessState, ToolIntent } from '../lib/trust-kernel.js';
import {
  archiveUeyeRevision,
  inspectImageFile,
  upsertUeyeAsset,
  verifyUeyeAssetManifest,
  verifyUeyeRevisionHistory
} from '../lib/ueye-artifacts.js';
import {
  INSTALL_LOCK_NAME,
  INSTALL_RECEIPT_NAME,
  inspectSkillInstallation,
  installSkillSetTransactional
} from '../lib/skill-installation.js';

type AnyRecord = Record<string, any>;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILLS = [
  'quick',
  'ueye',
  'question',
  'scout',
  'deep',
  'mission'
];
const LEGACY_SKILLS = SKILLS.flatMap((skill) => [`timeto-${skill}`, `yam-${skill}`]);
const RETIRED_SKILLS = [
  'runtime',
  'fast',
  'build',
  'ui',
  'review',
  'eye',
  'timeto-runtime',
  'yam-runtime',
  'timeto-fast',
  'yam-fast',
  'timeto-build',
  'yam-build',
  'timeto-ui',
  'yam-ui',
  'timeto-review',
  'yam-review',
  'timeto-eye',
  'yam-eye'
];

const DEST = process.env.YAM_SKILLS_HOME || process.env.TIMETO_SKILLS_HOME || path.join(os.homedir(), '.agents', 'skills');
const CODEX_MIRROR = process.env.YAM_CODEX_MIRROR || process.env.TIMETO_CODEX_MIRROR || path.join(os.homedir(), '.codex', 'skills');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = String(PACKAGE_JSON.version || '0.0.0');
const PROJECT_PACK = 'yam.project.md';
const LEGACY_PROJECT_PACK = 'timeto.project.md';
const PACK_STALE_DAYS = 30;
const YAM_HOOK_ENTRYPOINT = path.join(ROOT, 'dist', 'bin', 'yam.js');
const YAM_LITE_HOOK_COMMAND = `${JSON.stringify(process.execPath)} ${JSON.stringify(YAM_HOOK_ENTRYPOINT)} hook run lite`;
const YAM_STUDY_NOTE_HOOK_COMMAND = `${JSON.stringify(process.execPath)} ${JSON.stringify(YAM_HOOK_ENTRYPOINT)} hook run study-note`;
const REQUIRED_PACK_SECTIONS = [
  'Product Direction',
  'UI Direction',
  'Tech Stack',
  'Commands',
  'Key Paths',
  'Verification Policy',
  'Known Risks',
  'Recent Decisions',
  'No-Go Rules',
  'MD Management'
];
const ROUTE_BUDGETS = {
  quick: {
    files: '1-8 files depending on lane; start with 1-3 for patch work',
    commands: '0-2 focused checks; prefer the smallest honest type/lint/test/build signal',
    report: 'short change or scan summary plus a compact verification matrix when useful',
    expand: 'only when the first edit surface is wrong, error grouping points wider, or verification contradicts the hypothesis',
    limits: { files: 8, commands: 2, reportLines: 16, seconds: 300 }
  },
  ueye: {
    files: 'project direction, target UI surface, reference/before/after evidence, nearby component/styles',
    commands: 'browser/screenshot when feasible; inspect 1-3 primary images by default; typecheck/build only if UI implementation changed code',
    report: 'visual evidence inventory, reference read proof, reference-vs-implementation matrix, design quality review, P0-P3 ledger, truth cap',
    expand: 'when reference fidelity, responsive/state risk, or visual evidence requires it; do not do broad design archaeology for simple tweaks',
    limits: { files: 10, commands: 3, reportLines: 28, seconds: 600 }
  },
  question: {
    files: '0-2 files or current conversation context',
    commands: 'none by default',
    report: 'direct answer, usually 1-6 short paragraphs or bullets',
    expand: 'switch to scout when sources, comparisons, or freshness matter',
    limits: { files: 2, commands: 0, reportLines: 10, seconds: 120 }
  },
  scout: {
    files: 'project pack plus 3-7 high-signal sources',
    commands: 'none by default',
    report: 'decision, objective/subjective judgment, risks, sources',
    expand: 'only when the decision remains uncertain',
    limits: { files: 8, commands: 0, reportLines: 24, seconds: 600 }
  },
  deep: {
    files: 'risk surface plus dependencies; runtime context only when needed',
    commands: 'test/build/browser/security/runtime checks as needed',
    report: 'evidence, truth status, cleanup if applicable, residual risk',
    expand: 'allowed when tied to risk or runtime proof',
    limits: { files: 25, commands: 8, reportLines: 40, seconds: 1800 }
  },
  mission: {
    files: 'approved plan, project pack, role-specific surfaces, runtime context if needed',
    commands: 'focused checks plus deep runtime/browser/tmux checks when needed',
    report: 'real subagent/team lanes, cross-verification, doctor scan, evidence, cleanup, truth status',
    expand: 'allowed for approved broad implementation plans that use real subagent/team execution',
    limits: { files: 30, commands: 10, reportLines: 48, seconds: 2400 }
  }
};

function usage() {
  console.log(`yam ${VERSION}

Usage:
  yam list
  yam status
  yam verify
  yam detect [dir]
  yam pack [dir]
  yam context pressure [dir] [--json]
  yam cleanup scan [dir] [--json]
  yam budget [route]
  yam measure <route> [--files n] [--commands n] [--report-lines n] [--seconds n]
  yam tools doctor [dir]
  yam proof [dir|--from file] [--route route] [--truth status] [--command text] [--evidence text]
  yam proof write [dir] [--format json|md] [--out file] [--route route] [--truth status] [--command text]
  yam study-note check [dir] [--report file|--text text] [--json]
  yam loop report [--route route] [--intent text] [--stage id:status:note] [--evidence text] [--json]
  yam ueye capture --url URL --out screenshot.png [--viewport 1440x900] [--full-page] [--json]
  yam ueye compare --reference ref.png --actual screenshot.png [--json]
  yam ueye preflight [dir] [--json]
  yam ueye report [--reference ref.png] [--actual screenshot.png] [--provider-context local] [--execution-surface in-app-browser] [--json]
  yam ueye asset <add|verify> [options]
  yam ueye revision <archive|verify> [options]
  yam media proof [--requested] [--attempted] [--output file] [--json]
  yam runtime evidence [--backend terminal|in-app-browser|playwright|tmux|zellij] [--claim observed|started|stopped|cleanup-verified] [--json]
  yam mission queue [--agent-id id] [--scope text] [--changed file] [--verification-hint text] [--json]
  yam mission receipt [--thread-id id] [--role reviewer] [--lifecycle stopped] [--outcome passed] [--evidence text] [--json]
  yam mission gate [--expected-thread id] [--receipt file] [--json]
  yam benchmark report [--baseline n] [--current n] [--unit ms] [--target lower|higher] [--json]
  yam release report [--json]
  yam safety [text...]
  yam memory <init|add|list|summary|resolve> [dir] [options]
  yam hook <status|enable|disable|run> [lite|study-note] [--global|--project dir]
  yam template <project|ueye|mission|proof|tuning>
  yam tune-log [dir]
  yam install
  yam uninstall
  yam doctor [--json]
  yam examples
  yam path
  yam version
  yam init-project [dir]

Environment:
  YAM_SKILLS_HOME   Override install target. Default: ~/.agents/skills
`);
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function rmrf(target) {
  await fsp.rm(target, { recursive: true, force: true });
}

async function install() {
  const result = await installSkillSetTransactional({
    sourceRoot: ROOT,
    destination: DEST,
    codexMirror: CODEX_MIRROR,
    packageName: String(PACKAGE_JSON.name || 'yam-flow'),
    version: VERSION,
    skills: SKILLS,
    legacySkills: LEGACY_SKILLS,
    retiredSkills: RETIRED_SKILLS
  });
  console.log(`yam installed to ${DEST}`);
  console.log(`install receipt: ${result.receiptPath}`);
  console.log(`integrity: ${result.installedFiles} files, sha256:${result.sourceDigest}`);
  for (const warning of result.cleanupWarnings) console.warn(`warning: ${warning}`);
  console.log('Restart Codex to reload skills.');
}

async function uninstall() {
  const lockPath = path.join(DEST, INSTALL_LOCK_NAME);
  if (await exists(lockPath)) {
    throw new Error(`cannot uninstall while an install lock exists: ${lockPath}`);
  }
  for (const skill of [...SKILLS, ...LEGACY_SKILLS, ...RETIRED_SKILLS]) {
    await rmrf(path.join(DEST, skill));
    if (CODEX_MIRROR !== DEST) {
      await rmrf(path.join(CODEX_MIRROR, skill));
    }
  }
  await rmrf(path.join(DEST, INSTALL_RECEIPT_NAME));
  console.log(`yam removed from ${DEST}`);
  if (CODEX_MIRROR !== DEST) console.log(`yam mirror entries removed from ${CODEX_MIRROR}`);
  console.log('Restart Codex to unload skills.');
}

async function status({ quiet = false } = {}) {
  const report = await inspectSkillInstallation({
    sourceRoot: ROOT,
    destination: DEST,
    packageName: String(PACKAGE_JSON.name || 'yam-flow'),
    version: VERSION,
    skills: SKILLS
  });
  if (!quiet) {
    for (const skill of report.skills) {
      const label = skill.status === 'ok' ? 'ok     ' : skill.status === 'missing' ? 'missing' : 'drift  ';
      console.log(`${label} ${skill.skill}`);
    }
    if (report.receiptStatus === 'ok' && report.receipt) {
      console.log(`ok      install receipt ${report.receipt.package.name}@${report.receipt.package.version}`);
      console.log(`        sha256:${report.receipt.integrity.source_digest}`);
    } else {
      console.log(`${report.receiptStatus === 'missing' ? 'missing' : 'drift  '} install receipt`);
    }
    if (report.issues.length) {
      console.log('');
      console.log('Install integrity issues:');
      for (const issue of report.issues.slice(0, 12)) console.log(`- ${issue}`);
      if (report.issues.length > 12) console.log(`- ... ${report.issues.length - 12} more issue(s)`);
      if (report.recoveryArtifacts.length) {
        console.log('Confirm no install is running, then inspect and preserve the transaction backup before retrying.');
      } else {
        console.log('Run `yam install` to restore the package-bundled skill set.');
      }
    }
  }
  return report.ok ? 0 : Math.max(1, report.issues.length);
}

async function list() {
  const manifest = await loadManifest();
  console.log(`${manifest.name} ${manifest.version}`);
  for (const principle of manifest.principles) console.log(`- ${principle}`);
  console.log('\nRoutes:');
  for (const route of manifest.routes) {
    console.log(`- $${route.id} [${route.stage}] ${route.purpose}`);
  }
}

async function loadManifest() {
  return JSON.parse(await fsp.readFile(path.join(ROOT, 'yam.manifest.json'), 'utf8'));
}

async function readJson(file): Promise<AnyRecord> {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

async function readJsonOrDefault(file, fallback: AnyRecord = {}): Promise<AnyRecord> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readText(file) {
  return fsp.readFile(file, 'utf8');
}

function frontmatterName(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const name = match[1].match(/^name:\s*([^\n]+)\s*$/m);
  return name ? name[1].trim().replace(/^["']|["']$/g, '') : null;
}

async function verify({ quiet = false } = {}) {
  const issues = [];
  const manifest = await loadManifest().catch((error) => {
    issues.push(`manifest unreadable: ${error.message}`);
    return null;
  });

  if (!manifest) return failOrReport('yam verify', issues, quiet);
  if (manifest.name !== 'yam') issues.push('manifest name must be yam');
  if (manifest.version !== VERSION) issues.push(`manifest version must match package version: ${manifest.version || 'missing'} != ${VERSION}`);
  if (manifest.defaultHooks !== false) issues.push('manifest defaultHooks must be false');
  if (!Array.isArray(manifest.routes) || manifest.routes.length !== SKILLS.length) {
    issues.push(`manifest routes must contain ${SKILLS.length} routes`);
  }

  const routeIds = new Set((manifest.routes || []).map((route) => route.id));
  for (const skill of SKILLS) {
    if (!routeIds.has(skill)) issues.push(`manifest missing route: ${skill}`);
    const skillPath = path.join(ROOT, 'skills', skill, 'SKILL.md');
    if (!await exists(skillPath)) {
      issues.push(`missing source skill: ${skill}`);
      continue;
    }
    const text = await readText(skillPath);
    const name = frontmatterName(text);
    if (name !== skill) issues.push(`${skill} frontmatter name mismatch: ${name || 'missing'}`);
    if (!/Direction before execution\./.test(text) && !['scout'].includes(skill)) {
      issues.push(`${skill} missing Direction before execution principle`);
    }
  }

  const requiredReferences = [
    'verification-levels.md',
    'truth-matrix.md',
    'honest-completion.md',
    'risk-escalation.md',
    'quick.md',
    'ueye.md',
    'ueye-proof.md',
    'ui-quality.md',
    'question.md',
    'mission.md',
    'cleanup-scan.md',
    'doctor-scan.md',
    'scout.md',
    'runtime-orchestration.md',
    'hook-lite.md',
    'tool-trust-layer.md',
    'trust-kernel.md',
    'db-supabase-safety-lite.md',
    'current-docs.md',
    'token-economy.md',
    'context-reuse.md',
    'markdown-management.md',
    'study-note.md',
    'final-report.md',
    'token-budget-reporter.md',
    'memory.md'
  ];
  for (const ref of requiredReferences) {
    if (!await exists(path.join(ROOT, 'references', ref))) issues.push(`missing reference: ${ref}`);
  }
  if (!await exists(path.join(ROOT, 'templates', PROJECT_PACK))) {
    issues.push(`missing template: ${PROJECT_PACK}`);
  } else {
    const projectTemplate = await readText(path.join(ROOT, 'templates', PROJECT_PACK));
    for (const section of REQUIRED_PACK_SECTIONS) {
      if (!hasHeading(projectTemplate, section)) issues.push(`project template missing section: ${section}`);
    }
  }
  for (const template of ['ueye-review.md', 'ueye-comparison.md', 'mission-plan.md', 'runtime-proof.md', 'tuning-log.md']) {
    if (!await exists(path.join(ROOT, 'templates', template))) issues.push(`missing template: ${template}`);
  }
  for (const module of ['trust-kernel.js', 'ueye-artifacts.js']) {
    if (!await exists(path.join(ROOT, 'dist', 'lib', module))) issues.push(`missing dist lib module: ${module}`);
  }

  const forbiddenPaths = [
    path.join(ROOT, '.codex', 'hooks.json'),
    path.join(ROOT, '.agents', 'hooks.json'),
    path.join(ROOT, 'hooks.json')
  ];
  for (const forbidden of forbiddenPaths) {
    if (await exists(forbidden)) issues.push(`unexpected hook file: ${forbidden}`);
  }

  return failOrReport('yam verify', issues, quiet);
}

function failOrReport(label, issues, quiet = false) {
  if (!issues.length) {
    if (!quiet) console.log(`${label}: ok`);
    return 0;
  }
  if (!quiet) {
    console.log(`${label}: issues`);
    for (const issue of issues) console.log(`- ${issue}`);
  }
  process.exitCode = 1;
  return issues.length;
}

async function doctor(args = []) {
  const flags = parseSimpleFlags(args, new Set(['json']));
  const report = await buildDoctorReport();
  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (report.ok) {
    console.log('yam doctor: ok');
    console.log('No hooks, automations, or global config are required.');
    console.log('Skill install state is reported by `yam status`.');
    console.log(`yam-lite hook: ${report.yamLiteHook} (optional)`);
    return;
  }

  console.log('yam doctor: issues');
  for (const issue of report.issues) console.log(`- ${issue}`);
  if (report.nextActions.length) {
    console.log('');
    console.log('Next actions:');
    for (const action of report.nextActions) console.log(`- ${action}`);
  }
  process.exitCode = 1;
}

async function buildDoctorReport() {
  const issues = [];
  for (const skill of SKILLS) {
    if (!await exists(path.join(ROOT, 'skills', skill, 'SKILL.md'))) issues.push(`missing source skill: ${skill}`);
  }
  if (!await exists(path.join(ROOT, 'references', 'truth-matrix.md'))) issues.push('missing truth matrix reference');
  if (await exists(path.join(ROOT, '.codex', 'hooks.json'))) issues.push('unexpected local hooks.json');
  if (await exists(path.join(os.homedir(), '.codex', 'automations', 'yam'))) issues.push('unexpected yam automation');
  if (await exists(path.join(os.homedir(), '.codex', 'automations', 'timeto'))) issues.push('unexpected legacy timeto automation');
  for (const legacySkill of LEGACY_SKILLS) {
    if (await exists(path.join(DEST, legacySkill, 'SKILL.md'))) issues.push(`unexpected legacy installed skill: ${legacySkill}`);
    if (CODEX_MIRROR !== DEST && await exists(path.join(CODEX_MIRROR, legacySkill, 'SKILL.md'))) {
      issues.push(`unexpected legacy mirror skill: ${legacySkill}`);
    }
  }
  for (const retiredSkill of RETIRED_SKILLS) {
    if (await exists(path.join(DEST, retiredSkill, 'SKILL.md'))) issues.push(`unexpected retired installed skill: ${retiredSkill}`);
    if (CODEX_MIRROR !== DEST && await exists(path.join(CODEX_MIRROR, retiredSkill, 'SKILL.md'))) {
      issues.push(`unexpected retired mirror skill: ${retiredSkill}`);
    }
  }
  const verifyIssues = await verify({ quiet: true });
  if (verifyIssues > 0) issues.push(`verify reported ${verifyIssues} issue(s)`);
  const globalHook = await readJsonOrDefault(path.join(os.homedir(), '.codex', 'hooks.json'), {});
  const nextActionDetails = doctorNextActionDetails(issues);
  return {
    schema: 'yam.doctor.v1',
    generatedAt: new Date().toISOString(),
    ok: issues.length === 0,
    issues,
    nextActions: nextActionDetails.map((action) => action.next_action),
    nextActionDetails,
    yamLiteHook: hookConfigHasYamLite(globalHook) ? 'enabled' : 'disabled'
  };
}

function doctorNextActions(issues = []) {
  return doctorNextActionDetails(issues).map((action) => action.next_action);
}

function doctorNextActionDetails(issues = []) {
  const actions = [];
  for (const issue of issues) {
    if (/missing source skill/i.test(issue)) actions.push(nextActionDetail('restore-skill-source', 'warning', issue, 'run from a complete yam-flow checkout or reinstall the published package', 'npm install -g yam-flow@latest && yam install'));
    else if (/missing truth matrix/i.test(issue)) actions.push(nextActionDetail('restore-truth-matrix', 'warning', issue, 'restore references/truth-matrix.md before publishing', 'git checkout -- references/truth-matrix.md'));
    else if (/unexpected local hooks/i.test(issue)) actions.push(nextActionDetail('remove-project-hook', 'warning', issue, 'remove project hooks unless this repo is intentionally dogfooding them', 'inspect .codex/hooks.json and remove only intentional stale hooks'));
    else if (/unexpected .*automation/i.test(issue)) actions.push(nextActionDetail('remove-stale-automation', 'warning', issue, 'remove stale yam/timeto automations before claiming clean install state', 'inspect ~/.codex/automations and remove stale entries manually'));
    else if (/legacy|retired/i.test(issue)) actions.push(nextActionDetail('replace-old-skills', 'warning', issue, 'run `yam install` to replace old skill entries', 'yam install'));
    else if (/verify reported/i.test(issue)) actions.push(nextActionDetail('run-verify', 'error', issue, 'run `npm run verify` and fix the reported package boundary or metadata issue', 'npm run verify'));
  }
  return uniqueNextActionDetails(actions);
}

function nextActionDetail(id, severity, reason, nextAction, command = '') {
  const priority = priorityForSeverity(severity);
  const ownerRoute = ownerRouteForAction(id, reason, command);
  return {
    id,
    severity,
    priority,
    owner_route: ownerRoute,
    reason,
    next_action: nextAction,
    command,
    tool_intent: toolIntentForCommand(command),
    fix_first: priority === 'P0' || priority === 'P1',
    blocks_release: priority === 'P0',
    truth_status: 'partial'
  };
}

function priorityForSeverity(severity = '') {
  if (/error|danger|block/i.test(String(severity))) return 'P0';
  if (/warn/i.test(String(severity))) return 'P1';
  if (/info/i.test(String(severity))) return 'P2';
  return 'P3';
}

function ownerRouteForAction(id = '', reason = '', command = '') {
  const text = `${id} ${reason} ${command}`;
  if (/visual|ueye|screenshot|browser/i.test(text)) return '$ueye';
  if (/release|publish|package|registry|dist|version/i.test(text)) return '$deep';
  if (/database|supabase|destructive|production|migration/i.test(text)) return '$deep';
  if (/mission|subagent|team|lane/i.test(text)) return '$mission';
  if (/research|docs|current/i.test(text)) return '$scout';
  return '$quick';
}

function toolIntentForCommand(command = '') {
  const text = String(command || '').toLowerCase();
  if (!text) return 'read_only';
  if (/(npm\s+(view|whoami|config\s+get|owner\s+ls)|registry:check)/i.test(text)) return 'read_only';
  if (/(publish|registry|release|npm pack|npm publish)/i.test(text)) return 'publish';
  if (/(rm |delete|drop|truncate|reset|migrate|push|deploy|write|commit|add |install)/i.test(text)) return 'destructive';
  if (/(dev|server|tmux|playwright|browser|screenshot|runtime|port|pid)/i.test(text)) return 'runtime';
  if (/(ueye|visual|image|screen)/i.test(text)) return 'visual';
  if (/(build|typecheck|lint|test|verify|doctor|status|pack)/i.test(text)) return 'read_only';
  return 'write';
}

function normalizeToolIntent(value = ''): ToolIntent {
  const text = String(value || '').toLowerCase().replace(/[-\s]/g, '_');
  if (['read_only', 'write', 'destructive', 'runtime', 'visual', 'publish'].includes(text)) return text as ToolIntent;
  return 'read_only';
}

function normalizeLoopEvidenceLevelFlag(value = ''): LoopEvidenceLevel {
  const text = String(value || '').toLowerCase().replace(/[-\s]/g, '_');
  if (['fixture', 'smoke', 'local', 'real'].includes(text)) return text as LoopEvidenceLevel;
  return 'none';
}

function normalizeReadinessStateFlag(value = ''): ReadinessState {
  const text = String(value || '').toLowerCase().replace(/[-\s]/g, '_');
  if (['usable', 'degraded', 'blocked', 'unknown'].includes(text)) return text as ReadinessState;
  return 'unknown';
}

function uniqueNextActionDetails(actions = []) {
  const seen = new Set<string>();
  const unique = [];
  for (const action of actions) {
    const key = `${action.id}:${action.next_action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(action);
  }
  return unique;
}

async function context(args = []) {
  const subcommand = args[0] || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return contextUsage();
  if (subcommand === 'pressure') return contextPressure(args.slice(1));
  console.error(`unknown context command: ${subcommand}`);
  return contextUsage();
}

function contextUsage() {
  console.log(`yam context

Usage:
  yam context pressure [dir] [--json]

Notes:
  Read-only context pressure scan. It explains when to summarize, refresh the project pack, narrow scope, or deepen the route.
`);
}

async function contextPressure(args = []) {
  const parsed = parseDirJsonArgs(args);
  const report = await buildContextPressureReport(parsed.dir);
  if (parsed.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printContextPressureReport(report);
}

async function buildContextPressureReport(targetDir = process.cwd()) {
  const dir = path.resolve(expandHome(targetDir || process.cwd()));
  const pack = await findProjectPack(dir);
  const memorySummary = path.join(dir, '.yam', 'memory', 'summary.md');
  const instructionSurfaces = await findInstructionSurfaces(dir);
  const detection = await detectProject(dir, { quiet: true });
  const gitStatus = runReadOnlyCommandIn(dir, 'git', ['status', '--short']);
  const dirtyFiles = gitStatus.trim().split(/\r?\n/).filter(Boolean);
  const signals: AnyRecord = {
    project_pack: await projectPackPressureSignal(pack),
    memory_summary: {
      present: await exists(memorySummary),
      path: memorySummary
    },
    git: {
      dirty_file_count: dirtyFiles.length,
      dirty_files_sample: dirtyFiles.slice(0, 12)
    },
    package_scripts: detection.packageJson ? detection.commands : {},
    instruction_surfaces: instructionSurfaces
  };
  const reasons = [];
  let score = 0;

  if (!signals.project_pack.present) {
    score += 3;
    reasons.push('project pack is missing, so direction may need rediscovery');
  } else {
    if (signals.project_pack.age_days > PACK_STALE_DAYS) {
      score += 2;
      reasons.push(`project pack is ${signals.project_pack.age_days} days old`);
    }
    if (signals.project_pack.words < 80) {
      score += 1;
      reasons.push('project pack is very short, so local direction may be thin');
    }
    if (signals.project_pack.words > 1200) {
      score += 2;
      reasons.push('project pack is long, so reuse may become expensive');
    }
    if (signals.project_pack.missing_sections?.length) {
      score += 2;
      reasons.push(`project pack is missing sections: ${signals.project_pack.missing_sections.join(', ')}`);
    }
  }
  if (!signals.memory_summary.present) {
    score += 1;
    reasons.push('project memory summary is missing');
  }
  if (dirtyFiles.length >= 12) {
    score += 3;
    reasons.push(`${dirtyFiles.length} dirty files increase review and reporting pressure`);
  } else if (dirtyFiles.length >= 4) {
    score += 2;
    reasons.push(`${dirtyFiles.length} dirty files suggest the scope is widening`);
  } else if (dirtyFiles.length > 0) {
    score += 1;
    reasons.push(`${dirtyFiles.length} dirty file(s) should be kept in the final handoff`);
  }
  if (instructionSurfaces.issues.length) {
    score += 3;
    reasons.push('active hook or instruction issue can change route behavior');
  }
  if (instructionSurfaces.warnings.length >= 2) {
    score += 1;
    reasons.push('multiple instruction surfaces can make guidance harder to predict');
  }
  if (detection.packageJson && !detection.commands.build && !detection.commands.typecheck) {
    score += 1;
    reasons.push('no build/typecheck script was detected for quick implementation verification');
  }

  const pressure = score >= 7 ? 'high' : score >= 3 ? 'medium' : 'low';
  return {
    schema: 'yam.context-pressure.v1',
    generated_at: new Date().toISOString(),
    project: dir,
    pressure,
    score,
    why_pressure_is_rising: reasons,
    signals,
    beginner_insight: contextPressureInsight(pressure),
    recommended_next_action: pressure === 'high'
      ? 'pause and narrow scope, refresh yam.project.md or memory summary, then choose the route deliberately'
      : pressure === 'medium'
        ? 'keep the task scoped and summarize important changes before expanding'
        : 'continue with the current route and the smallest honest verification',
    route_hint: pressure === 'high' ? '$deep or $mission when risk is real; otherwise split the task' : pressure === 'medium' ? '$quick with explicit boundaries, or $deep if verification claims grow' : '$quick or current route',
    truth_status: 'partial'
  };
}

async function projectPackPressureSignal(pack) {
  if (!pack) return { present: false, path: '', age_days: null, words: 0, size_bytes: 0, missing_sections: REQUIRED_PACK_SECTIONS };
  const text = await readText(pack).catch(() => '');
  const stat = await fsp.stat(pack).catch(() => null);
  return {
    present: true,
    path: pack,
    age_days: stat ? Math.floor((Date.now() - stat.mtimeMs) / 86400000) : null,
    words: countWords(text),
    size_bytes: stat?.size || 0,
    missing_sections: REQUIRED_PACK_SECTIONS.filter((section) => !hasHeading(text, section))
  };
}

function contextPressureInsight(pressure) {
  if (pressure === 'high') return 'The project has enough moving pieces that a non-specialist may lose track of what changed, what was checked, or which instruction surface is steering the agent.';
  if (pressure === 'medium') return 'The task is still manageable, but scope or stale context may start causing repeated reading and weaker final explanations.';
  return 'The current context looks small enough to keep momentum without heavy proof, as long as claims stay modest.';
}

function printContextPressureReport(report) {
  console.log('yam context pressure');
  console.log(`Project: ${report.project}`);
  console.log(`Pressure: ${report.pressure} (score ${report.score})`);
  console.log(`Insight: ${report.beginner_insight}`);
  if (report.why_pressure_is_rising.length) {
    console.log('');
    console.log('Why pressure is rising:');
    for (const reason of report.why_pressure_is_rising) console.log(`- ${reason}`);
  }
  console.log('');
  console.log(`Next: ${report.recommended_next_action}`);
  console.log(`Route hint: ${report.route_hint}`);
}

async function cleanup(args = []) {
  const subcommand = args[0] || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return cleanupUsage();
  if (subcommand === 'scan') return cleanupScan(args.slice(1));
  console.error(`unknown cleanup command: ${subcommand}`);
  return cleanupUsage();
}

async function studyNote(args = []) {
  const subcommand = args[0] || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return studyNoteUsage();
  if (subcommand === 'check') return studyNoteCheck(args.slice(1));
  console.error(`unknown study-note command: ${subcommand}`);
  return studyNoteUsage();
}

function studyNoteUsage() {
  console.log(`yam study-note

Usage:
  yam study-note check [dir] [--report file|--text text] [--json]

Notes:
  Read-only guard. It checks whether changed work has a Study Note and whether relevant UI/CSS/DB hygiene was reported.
  It does not generate, edit, or infer the Study Note for you.
`);
}

async function studyNoteCheck(args = []) {
  const flags = parseSimpleFlags(args, new Set(['report', 'text', 'json']));
  const dir = path.resolve(firstPositional(args) || process.cwd());
  const reportText = await readStudyNoteReportText(flags, dir);
  const reportSource = flags.report ? path.resolve(dir, String(flags.report)) : flags.text ? 'inline_text' : 'not_provided';
  const result = await buildStudyNoteGuardResult(dir, reportText, reportSource);
  printJsonOrHuman(result, Boolean(flags.json), 'Study Note guard');
  if (result.blockers.length) process.exitCode = 1;
}

async function buildStudyNoteGuardResult(dir, reportText = '', reportSource = 'not_provided') {
  const changedFiles = await gitChangedFiles(dir);
  const needsStudyNote = changedFiles.length > 0;
  const hygieneRequirements = studyNoteHygieneRequirements(changedFiles);
  const checks = [
    studyNoteGuardCheck('changed_files', needsStudyNote ? 'pass' : 'skipped', needsStudyNote ? 'changed files detected; Study Note is required before final completion' : 'no changed files detected'),
    studyNoteGuardCheck('study_note_present', !needsStudyNote || hasStudyNoteMarker(reportText) ? 'pass' : 'fail', 'final report should include a Study Note when project artifacts changed'),
    studyNoteGuardCheck('role_or_responsibility', !needsStudyNote || /(\brole\b|\bresponsib|\bdoes\b|역할|기능)/i.test(reportText) ? 'pass' : 'fail', 'Study Note should explain what the touched code/artifact does'),
    studyNoteGuardCheck('execution_point', !needsStudyNote || /(execution|\bruns?\b|\bloads?\b|\brenders?\b|validates?|builds?|publishes?|read by|실행|로드|렌더|검사|검증|빌드|게시|배포|읽)/i.test(reportText) ? 'pass' : 'fail', 'Study Note should explain where or when the touched code/artifact runs or is read'),
    studyNoteGuardCheck('before_after_or_change', !needsStudyNote || /(\bbefore\b|\bafter\b|before\/after|changed|change meaning|바뀌|변경|수정)/i.test(reportText) ? 'pass' : 'fail', 'Study Note should explain what changed from before to after'),
    studyNoteGuardCheck('expected_behavior', !needsStudyNote || /(expected|should|will|result|behavior|예상|기대|결과|동작|되어야|하게 됨)/i.test(reportText) ? 'pass' : 'fail', 'Study Note should describe the expected behavior or result'),
    studyNoteGuardCheck('syntax_or_structure', !needsStudyNote || /(syntax|structure|schema|\bapi\b|function|array|field|type|condition|문법|구조|스키마|함수|배열|필드|타입|조건)/i.test(reportText) ? 'pass' : 'fail', 'Study Note should include one useful syntax or structure insight'),
    studyNoteGuardCheck('verification', !needsStudyNote || /(verification|verified|checked|tested|검증|확인|테스트)/i.test(reportText) ? 'pass' : 'fail', 'Study Note should say what was checked'),
    studyNoteGuardCheck('limits_or_uncertainty', !needsStudyNote || /(limits?|uncertain|unknown|not checked|remaining|한계|불확실|모르는|미확인|남은)/i.test(reportText) ? 'pass' : 'fail', 'Study Note should say what remains uncertain or explicitly state that no meaningful uncertainty remains')
  ];
  for (const requirement of hygieneRequirements) {
    checks.push(studyNoteGuardCheck(requirement.id, requirementSatisfied(reportText, requirement), requirement.note));
  }
  const blockers = checks.filter((check) => check.status === 'fail').map((check) => `${check.id}: ${check.next_action}`);
  const result = {
    schema: 'yam.study-note-guard.v1',
    generated_at: new Date().toISOString(),
    project: dir,
    changed_files: changedFiles,
    changed_file_count: changedFiles.length,
    report_source: reportSource,
    checks,
    blockers,
    next_action: blockers[0] || (needsStudyNote ? 'Study Note guard passed for the supplied report text' : 'no Study Note required because no changed files were detected'),
    truth_status: blockers.length ? 'blocked' : needsStudyNote ? 'verified' : 'skipped'
  };
  return result;
}

function firstPositional(args = []) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || '');
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && !['--json'].includes(arg)) index += 1;
      continue;
    }
    if (arg === 'check') continue;
    return arg;
  }
  return '';
}

async function gitChangedFiles(dir) {
  const output = runReadOnlyCommandIn(dir, 'git', ['status', '--short']);
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.replace(/^..\s+/, '').replace(/^.* -> /, ''))
    .map((line) => line.trim())
    .filter((file) => file && !file.startsWith('dist/') && !file.endsWith('.tgz'));
}

async function readStudyNoteReportText(flags, dir) {
  if (flags.text) return String(flags.text || '');
  if (!flags.report) return '';
  const file = path.resolve(dir, String(flags.report));
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

function hasStudyNoteMarker(text = '') {
  return /(study note|study-note|학습\s*노트|스터디\s*노트)/i.test(text);
}

function studyNoteGuardCheck(id, status, nextAction) {
  return {
    id,
    status,
    next_action: nextAction,
    truth_status: status === 'pass' ? 'verified' : status === 'fail' ? 'blocked' : status === 'skipped' ? 'skipped' : 'partial'
  };
}

function studyNoteHygieneRequirements(files = []) {
  const requirements = [];
  if (files.some((file) => /(^|\/)page\.tsx$/i.test(file))) {
    requirements.push({ id: 'page_tsx_hygiene', terms: ['page.tsx', 'component', 'hook', 'helper', 'server action', 'route'], note: 'Study Note should say whether page.tsx stayed focused or needs component/hook/helper/server-action separation' });
  }
  if (files.some((file) => /(^|\/)global\.css$/i.test(file))) {
    requirements.push({ id: 'global_css_hygiene', terms: ['global.css', 'token', 'component', 'scoped', 'module', 'utility'], note: 'Study Note should say whether CSS belongs globally or should move to tokens/scoped/component styles' });
  }
  if (files.some((file) => /(migration|schema|db|database|sql|prisma|drizzle|supabase)/i.test(file))) {
    requirements.push({ id: 'jsonb_hygiene', terms: ['jsonb', 'column', 'table', 'constraint', 'index', 'schema', 'relation'], note: 'Study Note should say whether structured product data belongs in typed columns/tables/constraints/indexes instead of broad DB jsonb' });
  }
  return requirements;
}

function requirementSatisfied(text = '', requirement) {
  const normalized = String(text || '').toLowerCase();
  return requirement.terms.some((term) => normalized.includes(term.toLowerCase())) ? 'pass' : 'fail';
}

function cleanupUsage() {
  console.log(`yam cleanup

Usage:
  yam cleanup scan [dir] [--json]

Notes:
  Read-only cleanup scan. It never deletes files; it only reports confusing surfaces and safe next actions.
`);
}

async function cleanupScan(args = []) {
  const parsed = parseDirJsonArgs(args);
  const report = await buildCleanupScanReport(parsed.dir);
  if (parsed.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printCleanupScanReport(report);
}

async function buildCleanupScanReport(targetDir = process.cwd()) {
  const dir = path.resolve(expandHome(targetDir || process.cwd()));
  const findings = [];
  const instructionSurfaces = await findInstructionSurfaces(dir);
  for (const found of instructionSurfaces.found) {
    const issue = instructionSurfaces.issues.find((item) => item.startsWith(`${found}:`));
    const warning = instructionSurfaces.warnings.find((item) => item.startsWith(`${found}:`));
    findings.push(cleanupFinding(issue ? 'high' : 'medium', found, issue || warning || 'instruction surface detected', 'inspect the file and keep only the instruction surface you intend to use'));
  }
  const projectAgents = path.join(dir, '.agents');
  if (await exists(projectAgents)) {
    findings.push(cleanupFinding('medium', '.agents', 'project-local skills can override or duplicate user-level skills', 'review project-local skills before assuming global yam-flow behavior'));
  }
  for (const hook of [path.join(dir, '.codex', 'hooks.json'), path.join(os.homedir(), '.codex', 'hooks.json')]) {
    if (await exists(hook)) findings.push(cleanupFinding('high', hook, 'active hooks can add hidden latency or route pressure', 'disable or edit only after user approval and backup'));
  }
  for (const skill of [...LEGACY_SKILLS, ...RETIRED_SKILLS]) {
    if (await exists(path.join(DEST, skill, 'SKILL.md'))) findings.push(cleanupFinding('medium', `installed skill: ${skill}`, 'old skill names can confuse route selection', 'run the explicit current installer or remove only with user approval'));
  }
  const legacyPackageHits = await scanLimitedTextFiles(dir, ['package.json', 'README.md', 'COMMANDS.md', 'CHANGELOG.md'], /\b(yam-harness|yam-codex)\b/i);
  for (const hit of legacyPackageHits) {
    findings.push(cleanupFinding('low', hit.file, `legacy package name mention: ${hit.match}`, 'update public text only if it confuses install guidance'));
  }
  for (const artifact of await staleYamArtifacts(dir)) {
    findings.push(cleanupFinding('low', artifact.file, artifact.reason, 'archive or refresh only if it misleads the current work'));
  }
  return {
    schema: 'yam.cleanup-scan.v1',
    generated_at: new Date().toISOString(),
    project: dir,
    destructive: false,
    findings,
    risk_level: overallCleanupRisk(findings),
    safe_next_action: findings.length ? 'review findings and make explicit user-approved cleanup decisions' : 'no cleanup action needed',
    truth_status: 'partial'
  };
}

function cleanupFinding(riskLevel, surface, whyItMatters, safeNextAction) {
  return {
    risk_level: riskLevel,
    surface,
    why_it_matters: whyItMatters,
    safe_next_action: safeNextAction,
    destructive: false,
    truth_status: 'partial'
  };
}

function overallCleanupRisk(findings = []) {
  if (findings.some((item) => item.risk_level === 'high')) return 'high';
  if (findings.some((item) => item.risk_level === 'medium')) return 'medium';
  return 'low';
}

async function scanLimitedTextFiles(dir, relativeFiles = [], pattern = /$^/) {
  const hits = [];
  for (const relative of relativeFiles) {
    const file = path.join(dir, relative);
    if (!await exists(file)) continue;
    const text = await readText(file).catch(() => '');
    const match = text.match(pattern);
    if (match) hits.push({ file: relative, match: match[0] });
  }
  return hits;
}

async function staleYamArtifacts(dir) {
  const candidates = [
    path.join(dir, '.yam', 'proof.json'),
    path.join(dir, '.yam', 'proof.md'),
    path.join(dir, '.yam', 'runtime-proof.md'),
    path.join(dir, '.yam', 'ueye-report.json')
  ];
  const artifacts = [];
  for (const file of candidates) {
    if (!await exists(file)) continue;
    const stat = await fsp.stat(file).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > 14 * 86400000) {
      artifacts.push({ file: path.relative(dir, file), reason: 'old proof/runtime artifact may be mistaken for current evidence' });
    }
  }
  return artifacts;
}

function printCleanupScanReport(report) {
  console.log('yam cleanup scan');
  console.log(`Project: ${report.project}`);
  console.log(`Risk level: ${report.risk_level}`);
  console.log('Destructive: false');
  if (!report.findings.length) {
    console.log('No confusing cleanup surfaces found.');
    return;
  }
  for (const finding of report.findings) {
    console.log(`- ${finding.risk_level}: ${finding.surface}`);
    console.log(`  why: ${finding.why_it_matters}`);
    console.log(`  next: ${finding.safe_next_action}`);
  }
}

function parseDirJsonArgs(args = []) {
  const flags = parseSimpleFlags(args, new Set(['json']));
  const dir = flags._?.find(looksLikeDirectoryArg) || process.cwd();
  return { dir, json: Boolean(flags.json) };
}

async function tools(args = []) {
  const subcommand = args[0] || 'doctor';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return toolsUsage();
  if (subcommand === 'doctor') return toolsDoctor(args.slice(1));
  console.error(`unknown tools command: ${subcommand}`);
  return toolsUsage();
}

function toolsUsage() {
  console.log(`yam tools

Usage:
  yam tools doctor [dir] [--json]

Notes:
  Read-only readiness scan for Codex/App, tmux, browser, Context7, Supabase, and Vercel surfaces.
  It does not install, authenticate, deploy, query databases, or start processes.
`);
}

function parseToolsDoctorArgs(args = []) {
  const result = { dir: process.cwd(), json: false };
  for (const arg of args) {
    if (arg === '--json') {
      result.json = true;
    } else if (looksLikeDirectoryArg(arg)) {
      result.dir = arg;
    }
  }
  return result;
}

async function toolsDoctor(args = []) {
  const parsed = Array.isArray(args) ? parseToolsDoctorArgs(args) : { dir: args || process.cwd(), json: false };
  const data = await buildToolsDoctorReport(parsed.dir);
  if (parsed.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  printToolsDoctorReport(data);
}

async function buildToolsDoctorReport(targetDir = process.cwd()) {
  const dir = path.resolve(targetDir || process.cwd());
  const codexHome = path.join(os.homedir(), '.codex');
  const pluginCache = path.join(codexHome, 'plugins', 'cache');
  const globalHook = await readJsonOrDefault(path.join(codexHome, 'hooks.json'), {});
  const globalLiteHookHealth = await inspectHookProfile(globalHook, 'lite');
  const globalStudyNoteHookHealth = await inspectHookProfile(globalHook, 'study-note');
  const tmux = await findExecutable('tmux');
  const packageInfo = await projectPackageInfo(dir);
  const pack = await findProjectPack(dir);
  const detection = await detectProject(dir, { quiet: true });
  const instructionSurfaces = await findInstructionSurfaces(dir);
  const safety = detectDbSafetyText([
    packageInfo.packageJson ? JSON.stringify(packageInfo.pkg?.scripts || {}) : '',
    packageInfo.packageJson ? JSON.stringify(packageInfo.pkg?.dependencies || {}) : '',
    packageInfo.packageJson ? JSON.stringify(packageInfo.pkg?.devDependencies || {}) : ''
  ].join('\n'));
  const projectSurfaces = await detectProjectToolSurfaces(dir, packageInfo.pkg);
  const frameworkChecklist = await detectFrameworkChecklist(dir, packageInfo.pkg);
  const sqlScan = await scanSqlFiles(dir);
  const contextPressure = await buildContextPressureReport(dir);
  const realProbe = await buildRealProbeReport(dir, packageInfo.pkg, detection);
  const rows = [
    readinessRow('Codex home', await exists(codexHome) ? 'ready' : 'missing', codexHome),
    readinessRow('Yam skills', await status({ quiet: true }) === 0 ? 'ready' : 'missing', DEST),
    readinessRow('yam-lite hook', globalLiteHookHealth.state, globalLiteHookHealth.issues[0] || 'optional UserPromptSubmit guide'),
    readinessRow('yam-study-note hook', globalStudyNoteHookHealth.state, globalStudyNoteHookHealth.issues[0] || 'optional prompt reminder plus one-pass Stop completion gate'),
    readinessRow('tmux', tmux ? 'ready' : 'missing', tmux || 'not found on PATH or common Homebrew paths'),
    readinessRow('Browser plugin', await pluginCacheHas('openai-bundled/browser') ? 'ready' : 'unknown', 'Codex in-app browser cache'),
    readinessRow('Chrome plugin', await pluginCacheHas('openai-bundled/chrome') ? 'ready' : 'unknown', 'Chrome/profile-dependent browser cache'),
    readinessRow('Computer Use', await pluginCacheHas('openai-bundled/computer-use') ? 'ready' : 'unknown', 'desktop UI automation cache'),
    readinessRow('Context7', await context7CacheDetected(pluginCache) ? 'ready' : 'unknown', 'CLI cannot prove deferred Context7 tools; confirm with tool discovery when needed'),
    readinessRow('Supabase plugin', await pluginCacheHas('openai-curated/supabase') ? 'ready' : 'unknown', 'plugin cache only; no DB query performed'),
    readinessRow('Vercel plugin', await pluginCacheHas('openai-curated/vercel') ? 'ready' : 'unknown', 'plugin cache only; no deployment/API call performed')
  ];
  const riskNotes = [
    ...instructionSurfaces.issues.map((message) => ({ level: 'issue', reason: message })),
    ...instructionSurfaces.warnings.map((message) => ({ level: 'warning', reason: message })),
    ...safety.hits,
    ...sqlScan.findings.map((finding) => ({ level: finding.level, reason: `${finding.file}: ${finding.reason}` }))
  ];
  const nextActionDetails = toolsDoctorNextActionDetails({
    pack,
    rows,
    riskNotes,
    frameworkChecklist,
    commands: detection.packageJson ? detection.commands : {}
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: dir,
    projectPack: pack || null,
    readiness: rows,
    commands: detection.packageJson ? detection.commands : {},
    packageManager: detection.packageJson ? detection.packageManager : null,
    instructionSurfaces,
    projectSurfaces,
    frameworkChecklist,
    contextPressure,
    realProbe,
    sqlScan,
    riskNotes,
    nextActions: nextActionDetails.map((action) => action.next_action),
    nextActionDetails,
    routeRecommendations: {
      dbSupabase: safety.hits.length || sqlScan.findings.length ? '$deep required before claiming safe' : '$deep when destructive or production mutation appears',
      currentDocs: 'use current-docs proof only when version/freshness matters',
      ueye: 'use $ueye with real screenshot/browser evidence when feasible',
      mission: 'use $mission only with real subagents/team lanes'
    }
  };
}

function printToolsDoctorReport(data) {
  console.log('yam tools doctor');
  console.log(`Project: ${data.project}`);
  console.log(`Project pack: ${data.projectPack || 'missing'}`);
  console.log('');
  console.log('Readiness:');
  for (const row of data.readiness) console.log(`- ${row.name}: ${row.status} (${row.note})`);

  if (Object.keys(data.commands).length) {
    console.log('');
    console.log('Detected project commands:');
    for (const [key, value] of Object.entries(data.commands)) {
      console.log(`- ${key}: ${value || '(not found)'}`);
    }
  }

  if (data.instructionSurfaces.found.length || data.projectSurfaces.length) {
    console.log('');
    console.log('Project surfaces:');
    for (const found of data.instructionSurfaces.found) console.log(`- instruction: ${found}`);
    for (const surface of data.projectSurfaces) console.log(`- ${surface}`);
  }

  if (data.frameworkChecklist?.detected) {
    console.log('');
    console.log(`Framework checklist: ${data.frameworkChecklist.framework}`);
    for (const check of data.frameworkChecklist.checks) {
      console.log(`- ${check.id}: ${check.label} (${check.route})`);
    }
  }

  if (data.contextPressure) {
    console.log('');
    console.log(`Context pressure: ${data.contextPressure.pressure} (${data.contextPressure.recommended_next_action})`);
  }

  if (data.realProbe?.probes?.length) {
    console.log('');
    console.log(`Real probe: ${data.realProbe.readiness_truth_status}`);
    for (const probe of data.realProbe.probes) console.log(`- ${probe.id}: ${probe.status} (${probe.truth_status})`);
  }

  if (data.sqlScan.filesScanned > 0) {
    console.log('');
    console.log(`SQL scan: ${data.sqlScan.filesScanned} file(s), ${data.sqlScan.findings.length} risk finding(s)`);
    for (const finding of data.sqlScan.findings) {
      console.log(`- ${finding.level}: ${finding.file}: ${finding.reason}`);
    }
  }

  if (data.riskNotes.length) {
    console.log('');
    console.log('Risk notes:');
    for (const note of data.riskNotes) console.log(`- ${note.level}: ${note.reason}`);
  }

  if (data.nextActions?.length) {
    console.log('');
    console.log('Next actions:');
    for (const action of data.nextActions) console.log(`- ${action}`);
  }

  console.log('');
  console.log('Route recommendations:');
  console.log(`- DB/Supabase destructive or production write work: ${data.routeRecommendations.dbSupabase}`);
  console.log(`- Current SDK/API/cloud-service behavior: ${data.routeRecommendations.currentDocs}.`);
  console.log(`- UI visual claims: ${data.routeRecommendations.ueye}.`);
  console.log(`- Team execution: ${data.routeRecommendations.mission}.`);
}

function readinessRow(name, status, note) {
  return { name, status, note };
}

async function pluginCacheHas(relative) {
  return exists(path.join(os.homedir(), '.codex', 'plugins', 'cache', relative));
}

async function context7CacheDetected(pluginCache) {
  const candidates = [
    path.join(pluginCache, 'context7'),
    path.join(pluginCache, 'openai-curated', 'context7'),
    path.join(pluginCache, 'modelcontextprotocol', 'context7')
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return true;
  }
  return false;
}

async function findExecutable(name) {
  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const common = name === 'tmux' ? [
    path.join(os.homedir(), '.homebrew', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin'
  ] : [];
  for (const dir of [...pathEntries, ...common]) {
    const candidate = path.join(dir, name);
    try {
      await fsp.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep scanning
    }
  }
  return '';
}

async function projectPackageInfo(dir) {
  const packageJsonPath = path.join(dir, 'package.json');
  if (!await exists(packageJsonPath)) return { packageJson: false, pkg: null };
  return { packageJson: true, pkg: await readJson(packageJsonPath) };
}

async function detectProjectToolSurfaces(dir, pkg = null) {
  const surfaces = [];
  const deps = {
    ...pkg?.dependencies,
    ...pkg?.devDependencies
  };
  const depNames = Object.keys(deps || {});
  if (depNames.some((name) => name.includes('supabase'))) surfaces.push('Supabase dependency detected');
  if (depNames.some((name) => name.includes('vercel') || name === 'next')) surfaces.push('Vercel/Next-related dependency detected');
  if (depNames.some((name) => /openai|ai$|ai-sdk|@ai-sdk/.test(name))) surfaces.push('AI SDK/API dependency detected');
  if (await exists(path.join(dir, 'supabase'))) surfaces.push('supabase/ directory detected');
  if (await exists(path.join(dir, 'prisma'))) surfaces.push('prisma/ directory detected');
  if (await exists(path.join(dir, 'migrations'))) surfaces.push('migrations/ directory detected');
  if (await exists(path.join(dir, 'vercel.json'))) surfaces.push('vercel.json detected');
  if (await exists(path.join(dir, '.env')) || await exists(path.join(dir, '.env.local'))) surfaces.push('.env file detected; values were not read');
  return surfaces;
}

async function detectFrameworkChecklist(dir, pkg = null) {
  const deps = {
    ...pkg?.dependencies,
    ...pkg?.devDependencies
  };
  const depNames = Object.keys(deps || {});
  const hasReact = depNames.includes('react');
  const hasNext = depNames.includes('next') || await exists(path.join(dir, 'next.config.js')) || await exists(path.join(dir, 'next.config.mjs')) || await exists(path.join(dir, 'next.config.ts'));
  const hasVite = depNames.includes('vite') || await exists(path.join(dir, 'vite.config.js')) || await exists(path.join(dir, 'vite.config.ts'));
  const framework = hasNext ? 'next-app' : hasReact && hasVite ? 'react-vite' : hasReact ? 'react' : pkg ? 'node-package' : 'unknown';
  const uiLike = hasReact || hasNext || hasVite || await exists(path.join(dir, 'app')) || await exists(path.join(dir, 'src', 'app')) || await exists(path.join(dir, 'pages'));
  const checks = [];
  if (uiLike) {
    checks.push(
      checklistRow('states', 'default/loading/error/empty states are reachable before claiming complete', '$ueye'),
      checklistRow('responsive', 'mobile and desktop layouts avoid overlap and clipped text', '$ueye'),
      checklistRow('accessibility', 'interactive controls have accessible labels and keyboard path', '$ueye'),
      checklistRow('runtime', 'browser or in-app runtime evidence is recorded when claiming visual verified', '$ueye')
    );
  }
  if (hasNext) {
    checks.push(checklistRow('boundaries', 'server/client boundaries and async data states match the framework pattern', '$deep when risky'));
  }
  if (pkg) {
    checks.push(checklistRow('package', 'run the smallest honest type/build/package check before publishing', '$quick or $deep'));
  }
  return {
    schema: 'yam.framework-checklist.v1',
    detected: checks.length > 0,
    uiLike,
    framework,
    routeHint: uiLike ? '$ueye for visual claims; $deep when runtime/data risk appears' : '$quick by default; deepen on risk',
    checks
  };
}

function checklistRow(id, label, route) {
  return { id, label, route };
}

async function buildRealProbeReport(dir = process.cwd(), pkg: AnyRecord | null = null, detection: AnyRecord = {}) {
  const probes = [];
  probes.push(realProbeRow('node_version', 'observed', process.version, 'verified'));
  const npmVersion = runReadOnlyCommandIn(dir, 'npm', ['--version']).trim();
  probes.push(realProbeRow('npm_version', npmVersion ? 'observed' : 'not_found', npmVersion || 'npm not found or not runnable', npmVersion ? 'verified' : 'partial'));
  probes.push(realProbeRow('yam_binary', 'observed', `${process.argv[1] || 'unknown'} @ ${VERSION}`, 'verified'));
  const scripts = detection.packageJson ? detection.commands : {};
  probes.push(realProbeRow('package_scripts', Object.values(scripts).some(Boolean) ? 'observed' : 'not_found', scripts, Object.values(scripts).some(Boolean) ? 'verified' : 'partial'));
  const playwrightPath = await localPackagePath(dir, 'playwright');
  probes.push(realProbeRow('playwright_package', playwrightPath ? 'observed' : 'not_found', playwrightPath || 'playwright package not found in project or yam package context', playwrightPath ? 'verified' : 'partial'));
  const browserCache = await pluginCacheHas('openai-bundled/browser');
  probes.push(realProbeRow('in_app_browser_plugin_cache', browserCache ? 'observed' : 'not_found', browserCache ? 'plugin cache present' : 'plugin cache not found locally', browserCache ? 'partial' : 'partial'));
  const tmux = await findExecutable('tmux');
  const zellij = await findExecutable('zellij');
  probes.push(realProbeRow('tmux', tmux ? 'observed' : 'not_found', tmux || 'not found on PATH', tmux ? 'verified' : 'partial'));
  probes.push(realProbeRow('zellij', zellij ? 'observed' : 'not_found', zellij || 'not found on PATH', zellij ? 'verified' : 'partial'));
  const gitInside = runReadOnlyCommandIn(dir, 'git', ['rev-parse', '--is-inside-work-tree']).trim();
  const gitDirty = runReadOnlyCommandIn(dir, 'git', ['status', '--short']).trim();
  probes.push(realProbeRow('git_state', gitInside === 'true' ? 'observed' : 'not_found', {
    inside_work_tree: gitInside === 'true',
    dirty_file_count: gitDirty ? gitDirty.split(/\r?\n/).length : 0
  }, gitInside === 'true' ? 'verified' : 'partial'));
  return {
    schema: 'yam.real-probe.v1',
    generated_at: new Date().toISOString(),
    project: path.resolve(dir),
    probes,
    readiness_truth_status: probes.some((probe) => probe.status === 'blocked') ? 'blocked' : 'partial',
    note: 'read-only local availability probe; no browser, server, database, or process was started'
  };
}

function realProbeRow(id, status, evidence, truthStatus = 'partial') {
  return {
    id,
    status,
    evidence,
    truth_status: truthStatus
  };
}

async function localPackagePath(dir, packageName) {
  const candidates = [
    path.join(dir, 'node_modules', packageName, 'package.json'),
    path.join(ROOT, 'node_modules', packageName, 'package.json')
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  try {
    const projectRequire = createRequire(path.join(dir, 'package.json'));
    return projectRequire.resolve(`${packageName}/package.json`);
  } catch {
    return '';
  }
}

function toolsDoctorNextActions(input) {
  return toolsDoctorNextActionDetails(input).map((action) => action.next_action);
}

function toolsDoctorNextActionDetails({ pack, rows, riskNotes, frameworkChecklist, commands }) {
  const actions = [];
  if (!pack) actions.push(nextActionDetail('project-pack', 'info', 'project pack missing', 'create or refresh yam.project.md so route choices reuse local project context', 'yam init-project .'));
  if (rows.some((row) => row.name === 'Yam skills' && row.status !== 'ready')) actions.push(nextActionDetail('install-skills', 'warning', 'skill install state is incomplete', 'run `yam install` and restart Codex before relying on installed skills', 'yam install'));
  if (riskNotes.some((note) => note.level === 'danger')) actions.push(nextActionDetail('deep-safety', 'error', 'destructive database or production write signal detected', 'use $deep before claiming destructive database or production write safety', 'yam safety "<command or SQL>"'));
  if (frameworkChecklist?.detected && !commands?.build && !commands?.typecheck) actions.push(nextActionDetail('verification-command', 'warning', 'build/typecheck command not detected', 'add or document a small build/typecheck command for implementation verification', 'yam pack .'));
  if (frameworkChecklist?.uiLike) actions.push(nextActionDetail('ueye-evidence', 'info', 'UI-like project detected', 'for Ueye verified claims, record reference, actual screenshot, comparison result, and surface context', 'yam ueye report --reference ref.png --actual shot.png --provider-context local --execution-surface in-app-browser --json'));
  return uniqueNextActionDetails(actions);
}

async function scanSqlFiles(rootDir, { maxFiles = 30, maxBytes = 200000, maxDepth = 5 } = {}) {
  const root = path.resolve(rootDir || process.cwd());
  const files = [];
  await collectSqlFiles(root, root, files, { maxFiles, maxDepth, depth: 0 });
  const findings = [];
  for (const file of files) {
    let text = '';
    try {
      const handle = await fsp.open(file, 'r');
      try {
        const buffer = Buffer.alloc(maxBytes);
        const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
        text = buffer.subarray(0, bytesRead).toString('utf8');
      } finally {
        await handle.close();
      }
    } catch (error) {
      findings.push({ file: path.relative(root, file), level: 'warning', reason: `could not read SQL file: ${errorMessage(error)}` });
      continue;
    }
    const safety = detectDbSafetyText(text);
    for (const hit of safety.hits) {
      findings.push({ file: path.relative(root, file), level: hit.level, reason: hit.reason });
    }
  }
  return {
    filesScanned: files.length,
    maxFiles,
    maxBytes,
    findings
  };
}

async function collectSqlFiles(root, dir, files, options) {
  if (files.length >= options.maxFiles || options.depth > options.maxDepth) return;
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= options.maxFiles) return;
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute);
    if (shouldSkipScanPath(relative, entry.name)) continue;
    if (entry.isDirectory()) {
      await collectSqlFiles(root, absolute, files, { ...options, depth: options.depth + 1 });
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) {
      files.push(absolute);
    }
  }
}

function shouldSkipScanPath(relative, name) {
  const skipNames = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.turbo', '.vercel', 'coverage']);
  if (skipNames.has(name)) return true;
  return relative.split(path.sep).some((part) => skipNames.has(part));
}

async function hook(args = []) {
  const subcommand = args[0] || 'status';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return hookUsage();
  if (subcommand === 'status') return hookStatus(args.slice(1));
  if (subcommand === 'enable') return hookEnable(args.slice(1));
  if (subcommand === 'disable') return hookDisable(args.slice(1));
  if (subcommand === 'run') return hookRun(args.slice(1));
  console.error(`unknown hook command: ${subcommand}`);
  return hookUsage();
}

function hookUsage() {
  console.log(`yam hook

Usage:
  yam hook status [--global|--project dir]
  yam hook enable <lite|study-note> [--global|--project dir]
  yam hook disable [lite|study-note] [--global|--project dir]
  yam hook run <lite|study-note>

Notes:
  hooks are opt-in. lite is advisory-only; study-note adds a prompt reminder and a one-pass Stop completion gate.
  Hooks do not generate reports, run tmux, start subagents, or execute verification automatically.
`);
}

function parseHookArgs(args = []) {
  const result = { mode: 'project', projectDir: process.cwd(), profile: 'lite' };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === 'lite' || arg === 'study-note') {
      result.profile = arg;
    } else if (arg === '--global') {
      result.mode = 'global';
    } else if (arg === '--project') {
      result.mode = 'project';
      result.projectDir = args[index + 1] || process.cwd();
      index += 1;
    } else if (arg.startsWith('--project=')) {
      result.mode = 'project';
      result.projectDir = arg.slice('--project='.length) || process.cwd();
    }
  }
  return result;
}

function hookPathFor(parsed) {
  if (parsed.mode === 'global') return path.join(os.homedir(), '.codex', 'hooks.json');
  return path.join(path.resolve(parsed.projectDir || process.cwd()), '.codex', 'hooks.json');
}

function isYamLiteHook(handler: AnyRecord = {}) {
  return handler?.type === 'command' && /yam(?:\.js)?["']?\s+hook\s+run\s+lite(?:\s|$)/i.test(String(handler.command || ''));
}

function isYamStudyNoteHook(handler: AnyRecord = {}) {
  return handler?.type === 'command' && /yam(?:\.js)?["']?\s+hook\s+run\s+study-note(?:\s|$)/i.test(String(handler.command || ''));
}

function isYamHookProfile(handler: AnyRecord = {}, profile = 'lite') {
  return profile === 'study-note' ? isYamStudyNoteHook(handler) : isYamLiteHook(handler);
}

function stripYamHooks(config: AnyRecord = {}, profile = 'lite') {
  const next = { ...config };
  for (const event of Object.keys(next)) {
    if (!Array.isArray(next[event])) continue;
    const entries = next[event];
    const keptEntries = [];
    for (const entry of entries) {
      const hooks = Array.isArray(entry?.hooks) ? entry.hooks.filter((handler) => !isYamHookProfile(handler, profile)) : [];
      const rest = { ...entry, hooks };
      if (hooks.length > 0) keptEntries.push(rest);
    }
    if (keptEntries.length > 0) next[event] = keptEntries;
    else delete next[event];
  }
  return next;
}

function withYamHook(config: AnyRecord = {}, profile = 'lite') {
  const next = stripYamHooks(config, profile);
  const command = hookCommandForProfile(profile);
  for (const event of hookEventsForProfile(profile)) {
    const entry = {
      hooks: [
        {
          type: 'command',
          command,
          timeout: 5
        }
      ]
    };
    next[event] = [...(Array.isArray(next[event]) ? next[event] : []), entry];
  }
  return next;
}

async function hookStatus(args = []) {
  const parsed = parseHookArgs(args);
  const target = hookPathFor(parsed);
  const loaded = await readHookConfig(target);
  if (loaded.error) {
    console.log('yam-lite hook: broken');
    console.log('yam-study-note hook: broken');
    console.log(`  - hook config unreadable: ${loaded.error}`);
    console.log(`scope: ${parsed.mode}`);
    console.log(`file: ${target}`);
    process.exitCode = 1;
    return;
  }
  const lite = await inspectHookProfile(loaded.config, 'lite');
  const studyNote = await inspectHookProfile(loaded.config, 'study-note');
  printHookProfileStatus('lite', lite);
  printHookProfileStatus('study-note', studyNote);
  console.log(`scope: ${parsed.mode}`);
  console.log(`file: ${target}`);
  if (lite.state === 'broken' || studyNote.state === 'broken') process.exitCode = 1;
}

function hookConfigHasYamLite(config = {}) {
  return hookConfigHasProfile(config, 'lite');
}

function hookConfigHasProfile(config = {}, profile = 'lite') {
  return Object.values(config).some((entries) => Array.isArray(entries) && entries.some((entry) => {
    return Array.isArray(entry?.hooks) && entry.hooks.some((handler) => isYamHookProfile(handler, profile));
  }));
}

function hookCommandForProfile(profile = 'lite') {
  return profile === 'study-note' ? YAM_STUDY_NOTE_HOOK_COMMAND : YAM_LITE_HOOK_COMMAND;
}

function hookEventsForProfile(profile = 'lite') {
  return profile === 'study-note' ? ['UserPromptSubmit', 'Stop'] : ['UserPromptSubmit'];
}

function hookProfileEntries(config: AnyRecord = {}, profile = 'lite') {
  const matches = [];
  for (const [event, entries] of Object.entries(config)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!Array.isArray(entry?.hooks)) continue;
      for (const handler of entry.hooks) {
        if (isYamHookProfile(handler, profile)) matches.push({ event, handler });
      }
    }
  }
  return matches;
}

function splitHookCommand(command = '') {
  const words = [];
  let current = '';
  let quote = '';
  let escaped = false;
  let started = false;
  for (const char of String(command)) {
    if (escaped) {
      current += char;
      escaped = false;
      started = true;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
      started = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        words.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (escaped || quote) return [];
  if (started) words.push(current);
  return words;
}

function parseYamHookCommand(command = '', profile = 'lite') {
  const words = splitHookCommand(command);
  if (words.length === 5 && words[2] === 'hook' && words[3] === 'run' && words[4] === profile) {
    const nodeName = path.basename(words[0]).toLowerCase();
    if (/^node(?:\.exe)?$/.test(nodeName) && path.basename(words[1]).toLowerCase() === 'yam.js') {
      return { executable: words[0], script: words[1] };
    }
  }
  if (words.length === 4 && words[1] === 'hook' && words[2] === 'run' && words[3] === profile) {
    const yamName = path.basename(words[0]).toLowerCase();
    if (/^yam(?:\.cmd|\.exe)?$/.test(yamName)) return { executable: words[0], script: '' };
  }
  return null;
}

async function hookTargetExists(target = '', executable = false) {
  if (!target) return false;
  if (!path.isAbsolute(target)) return executable ? Boolean(await findExecutable(target)) : false;
  try {
    await fsp.access(target, executable ? fs.constants.X_OK : fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function inspectHookHandler(handler: AnyRecord = {}, profile = 'lite') {
  const parsed = parseYamHookCommand(String(handler.command || ''), profile);
  if (!parsed) return { ok: false, issue: 'unsupported yam hook command shape; rerun hook enable to migrate it' };
  if (!await hookTargetExists(parsed.executable, true)) {
    return { ok: false, issue: `hook executable is missing or not executable: ${parsed.executable}` };
  }
  if (parsed.script && !await hookTargetExists(parsed.script)) {
    return { ok: false, issue: `hook target is missing: ${parsed.script}` };
  }
  return { ok: true, issue: '' };
}

async function inspectHookProfile(config: AnyRecord = {}, profile = 'lite') {
  const entries = hookProfileEntries(config, profile);
  if (!entries.length) return { state: 'disabled', issues: [], entries };
  const issues = [];
  for (const event of hookEventsForProfile(profile)) {
    const count = entries.filter((entry) => entry.event === event).length;
    if (count === 0) issues.push(`${event} handler is missing; rerun yam hook enable ${profile}`);
    if (count > 1) issues.push(`${event} has ${count} yam-${profile} handlers; rerun hook enable to remove duplicates`);
  }
  for (const entry of entries) {
    if (!hookEventsForProfile(profile).includes(entry.event)) {
      issues.push(`unexpected ${entry.event} handler; rerun hook enable to migrate event coverage`);
    }
    const health = await inspectHookHandler(entry.handler, profile);
    if (!health.ok) issues.push(`${entry.event}: ${health.issue}`);
  }
  return { state: issues.length ? 'broken' : 'enabled', issues: [...new Set(issues)], entries };
}

function printHookProfileStatus(profile, health) {
  console.log(`yam-${profile} hook: ${health.state}`);
  for (const issue of health.issues) console.log(`  - ${issue}`);
}

async function readHookConfig(target) {
  try {
    const value = JSON.parse(await fsp.readFile(target, 'utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return { config: {}, exists: true, error: 'top-level value must be a JSON object' };
    }
    return { config: value, exists: true, error: '' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { config: {}, exists: false, error: '' };
    return { config: {}, exists: true, error: errorMessage(error) };
  }
}

async function writeHookConfig(target, config) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.yam-write-${process.pid}-${timestampId()}`;
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await fsp.rename(temporary, target);
  } catch (error) {
    await rmrf(temporary).catch(() => {});
    throw error;
  }
}

async function hookEnable(args = []) {
  const parsed = parseHookArgs(args);
  if (!['lite', 'study-note'].includes(parsed.profile)) {
    console.error('Only lite and study-note hooks are supported: yam hook enable <lite|study-note>');
    process.exitCode = 1;
    return;
  }
  const target = hookPathFor(parsed);
  const loaded = await readHookConfig(target);
  if (loaded.error) {
    console.error(`Cannot update unreadable hook config: ${target}`);
    console.error(loaded.error);
    process.exitCode = 1;
    return;
  }
  const current = loaded.config;
  const existing = hookProfileEntries(current, parsed.profile);
  const expectedEvents = hookEventsForProfile(parsed.profile);
  const expectedCommand = hookCommandForProfile(parsed.profile);
  const needsMigration = existing.length > 0 && (
    existing.length !== expectedEvents.length
    || existing.some((entry) => !expectedEvents.includes(entry.event) || String(entry.handler?.command || '') !== expectedCommand)
  );
  const next = withYamHook(current, parsed.profile);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  if (loaded.exists) {
    const backup = `${target}.yam-backup-${timestampId()}`;
    await fsp.copyFile(target, backup);
    console.log(`backup: ${backup}`);
  }
  await writeHookConfig(target, next);
  console.log(`yam-${parsed.profile} hook enabled (${parsed.mode}): ${target}`);
  if (needsMigration) console.log(`migrated: ${existing.length} existing yam-${parsed.profile} handler(s) to the current command and event coverage`);
  console.log('Restart Codex or start a new thread if the app does not pick up hook changes immediately.');
}

async function hookDisable(args = []) {
  const parsed = parseHookArgs(args);
  const target = hookPathFor(parsed);
  const loaded = await readHookConfig(target);
  if (loaded.error) {
    console.error(`Cannot update unreadable hook config: ${target}`);
    console.error(loaded.error);
    process.exitCode = 1;
    return;
  }
  const current = loaded.config;
  if (!hookConfigHasProfile(current, parsed.profile)) {
    console.log(`yam-${parsed.profile} hook already disabled (${parsed.mode}): ${target}`);
    return;
  }
  const next = stripYamHooks(current, parsed.profile);
  if (Object.keys(next).length === 0) {
    await rmrf(target);
  } else {
    await writeHookConfig(target, next);
  }
  console.log(`yam-${parsed.profile} hook disabled (${parsed.mode}): ${target}`);
}

async function hookRun(args = []) {
  const profile = args[0] || 'lite';
  if (!['lite', 'study-note'].includes(profile)) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }
  const input = await readStdinJson();
  const event = input?.hook_event_name || input?.hookEventName || input?.event || 'UserPromptSubmit';
  const cwd = String(input?.cwd || process.cwd());
  if (profile === 'study-note' && event === 'Stop') {
    console.log(JSON.stringify(await buildStudyNoteStopOutput(input, cwd)));
    return;
  }
  const prompt = extractPrompt(input);
  const additionalContext = profile === 'study-note'
    ? await buildStudyNoteHookContext({ cwd })
    : await buildYamLiteContext({ cwd, prompt });
  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext
    }
  };
  console.log(JSON.stringify(output));
}

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function extractPrompt(input: AnyRecord = {}) {
  const candidates = [
    input.prompt,
    input.user_prompt,
    input.userPrompt,
    input.message,
    input.text,
    input.input
  ];
  const found = candidates.find((value) => typeof value === 'string' && value.trim());
  return found ? found.trim() : '';
}

async function buildYamLiteContext({ cwd, prompt }) {
  const lines = [
    'yam-lite guide active: keep project direction visible, preserve momentum, and deepen when scope, risk, or user intent calls for it.',
    'Default: do a basic direction-fit and honest-verification check; avoid broad reading for small work and never claim proof without evidence.'
  ];
  const pack = await findProjectPack(cwd).catch(() => null);
  if (pack) lines.push(`Project direction: prefer ${path.basename(pack)} before broad exploration.`);
  const memorySummary = path.join(path.resolve(cwd), '.yam', 'memory', 'summary.md');
  if (await exists(memorySummary)) lines.push('Project memory: prefer .yam/memory/summary.md over reading every record.');
  const safetyHint = yamLiteSafetyHint(prompt);
  if (safetyHint) lines.push(safetyHint);
  const docsHint = yamLiteCurrentDocsHint(prompt);
  if (docsHint) lines.push(docsHint);
  const routeHint = yamLiteRouteHint(prompt);
  if (routeHint) lines.push(routeHint);
  return lines.join('\n');
}

async function buildStudyNoteHookContext({ cwd }) {
  const dir = path.resolve(cwd || process.cwd());
  const changedFiles = await gitChangedFiles(dir);
  const lines = [
    'yam Study Note guard active: if this turn changes code, config, release metadata, docs, or project artifacts, include a Study Note in the final response.'
  ];
  if (!changedFiles.length) {
    lines.push('No changed files were detected at prompt time; if you change artifacts during this turn, add the Study Note before final.');
    lines.push('The Study Note Stop hook will check the final response if artifacts are changed later in the turn.');
    return lines.join('\n');
  }
  lines.push(`Changed files detected (${Math.min(changedFiles.length, 8)} shown): ${changedFiles.slice(0, 8).join(', ')}`);
  lines.push('Study Note minimum: touched code/artifact, role, execution point, before/after change, expected behavior, one syntax/structure insight, verification, and limits.');
  const hygiene = studyNoteHygieneRequirements(changedFiles);
  if (hygiene.length) {
    lines.push(`Architecture hygiene required: ${hygiene.map((item) => item.id).join(', ')}.`);
    lines.push('Report whether the change avoided dumping unrelated logic into page.tsx, one-off CSS into global.css, or structured product data into broad DB jsonb.');
  }
  lines.push('This prompt reminder does not generate or edit the Study Note; the paired Stop hook requests one correction pass if the final response is incomplete.');
  return lines.join('\n');
}

async function buildStudyNoteStopOutput(input: AnyRecord = {}, cwd = process.cwd()) {
  const lastAssistantMessage = String(input?.last_assistant_message || input?.lastAssistantMessage || '');
  const result = await buildStudyNoteGuardResult(path.resolve(cwd), lastAssistantMessage, 'stop_hook_last_assistant_message');
  if (!result.blockers.length) return { continue: true };
  const summary = result.blockers.slice(0, 4).join('; ');
  if (Boolean(input?.stop_hook_active || input?.stopHookActive)) {
    return {
      continue: true,
      systemMessage: `yam Study Note completion gate remains blocked after one correction pass: ${summary}`
    };
  }
  return {
    decision: 'block',
    reason: [
      'yam Study Note completion gate blocked this response because changed project artifacts require a complete Study Note.',
      summary,
      'Revise the final response to include: touched artifact, role, execution point, before/after change, expected behavior, one syntax/structure insight, verification, limits, and any relevant architecture hygiene.'
    ].join(' ')
  };
}

function yamLiteRouteHint(prompt = '') {
  const text = String(prompt || '').toLowerCase();
  if (!text) return '';
  if (/\$(quick|ueye|question|scout|deep|mission)\b/.test(text)) return '';
  if (/(subagent|team|mission|팀\s*단위|에이전트.*팀)/i.test(prompt)) return 'Route hint: use $mission only for real subagent/team execution; otherwise use $deep for heavy single-agent verification.';
  if (/(auth|payment|billing|permission|security|deploy|release|migration|database|supabase|vercel|db|보안|결제|배포|마이그레이션|데이터베이스|권한)/i.test(prompt)) return 'Route hint: risky surface detected; prefer $deep unless the user asks for real team/subagent execution.';
  if (/(screenshot|reference image|ui|ux|design|visual|화면|스크린샷|레퍼런스|디자인)/i.test(prompt)) return 'Route hint: visual/design work should use $ueye when screenshot, URL, reference image, or visual evidence matters.';
  if (/(\?|무엇|뭐지|설명|가능|how|what|why|can i)/i.test(prompt)) return 'Route hint: direct conceptual questions can use $question; comparisons or current sources can use $scout.';
  return 'Route hint: small scoped code changes can use $quick; broaden only if verification or risk requires it.';
}

function yamLiteSafetyHint(prompt = '') {
  const safety = detectDbSafetyText(prompt);
  if (!safety.hits.length) return '';
  return 'Safety hint: destructive DB/Supabase or production-write signal detected; prefer $deep, require explicit approval, and do not claim safe without evidence.';
}

function yamLiteCurrentDocsHint(prompt = '') {
  if (!needsCurrentDocsProof(prompt)) return '';
  return 'Current-docs hint: modern SDK/API/cloud-service behavior appears version-sensitive; use official/Context7 docs proof before relying on memory.';
}

function needsCurrentDocsProof(text = '') {
  const value = String(text || '');
  const docsSensitive = /(sdk|api|library|framework|package|dependency|next\.?js|react|supabase|vercel|openai|ai sdk|stripe|prisma|drizzle|tailwind|shadcn|auth|deploy|migration|upgrade|라이브러리|프레임워크|패키지|의존성|버전|마이그레이션|배포)/i;
  const freshness = /(latest|current|recent|new|upgrade|migrate|deprecated|breaking|docs?|official|v\d+|202[5-9]|최신|최근|업데이트|공식|문서|버전|변경|마이그레이션)/i;
  return docsSensitive.test(value) && freshness.test(value);
}

async function safety(args = []) {
  const positionals = args[0] === 'scan' ? args.slice(1) : args;
  const inlineText = positionals.join(' ').trim();
  const stdin = await readStdinTextIfAvailable();
  const text = [inlineText, stdin].filter(Boolean).join('\n').trim();
  if (!text) {
    console.log('DB/Supabase safety lite');
    console.log('Status: no input');
    console.log('Usage: yam safety "supabase db reset"');
    return;
  }
  const result = detectDbSafetyText(text);
  printSafetyResult(result);
}

async function release(args = []) {
  const subcommand = args[0] || 'help';
  if (subcommand !== 'report') {
    console.error('usage: yam release report [--json]');
    process.exitCode = 1;
    return;
  }
  const asJson = args.includes('--json');
  const report = runReleaseReport();
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  console.log('yam release report');
  console.log(`- Package: ${report.packageName}@${report.version}`);
  console.log(`- Truth status: ${report.truth_status}`);
  for (const check of report.checks) {
    console.log(`- ${check.id}: ${check.status} (${check.duration_ms}ms)`);
    if (check.note) console.log(`  ${check.note}`);
  }
  if (report.provenance) {
    console.log(`- Git commit: ${report.provenance.git_commit || 'unknown'}`);
    console.log(`- Git dirty: ${report.provenance.git_dirty ? 'yes' : 'no'}`);
    console.log(`- Dist freshness: ${report.freshness.dist}`);
  }
  if (report.tarball) {
    console.log(`- Tarball: ${report.tarball.tarball_name || report.tarball.status}`);
    if (report.tarball.file_count !== undefined) console.log(`- Tarball files: ${report.tarball.file_count}`);
  }
  if (report.publish_readiness) {
    console.log(`- Publish readiness: ${report.publish_readiness.status}`);
    console.log(`- Registry: ${report.publish_readiness.registry.url || 'not-verified'}`);
    console.log(`- npm auth: ${report.publish_readiness.auth.status}`);
  }
  if (report.failed.length) {
    console.log('- Failed:');
    for (const id of report.failed) console.log(`  - ${id}`);
  }
  if (report.publishBlockerEvidence?.length) {
    console.log('- Publish blockers:');
    for (const blocker of report.publishBlockerEvidence) {
      console.log(`  - ${blocker.blocker_kind}: ${blocker.likely_cause}`);
      console.log(`    next: ${blocker.safe_next_action}`);
    }
  }
  if (report.next_actions?.length) {
    console.log('- Next actions:');
    for (const action of report.next_actions) console.log(`  - ${action.next_action}`);
  }
  if (report.study_note?.problem?.summary || report.study_note?.problem?.symptom) {
    console.log(`- Study note: ${report.study_note.problem.summary || report.study_note.problem.symptom}`);
  }
  if (!report.ok) process.exitCode = 1;
}

function runReleaseReport() {
  const startedAt = new Date().toISOString();
  const checks = [
    ['typecheck', ['npm', ['run', 'typecheck']]],
    ['forbidden_names', ['npm', ['run', 'forbidden-names:check']]],
    ['package_boundary', ['npm', ['run', 'package-boundary:check']]],
    ['registry_status', ['npm', ['run', 'registry:check']]],
    ['cli_smoke', ['npm', ['run', 'cli-smoke']]],
    ['dist_freshness', ['npm', ['run', 'dist:freshness']]]
  ].map(([id, command]) => runReleaseCheck(id, command));
  const failed = checks.filter((check) => check.status !== 'passed').map((check) => check.id);
  const provenance = releaseProvenance(checks);
  const tarball = releaseTarballProvenance();
  const freshness = releaseFreshness(checks, provenance, tarball);
  const publishBlockerEvidence = publishBlockerEvidenceFromRelease(checks, tarball);
  const publishReadiness = releasePublishReadiness(checks, provenance, tarball, publishBlockerEvidence);
  const nextActions = releaseNextActions(checks, provenance, tarball, publishBlockerEvidence, publishReadiness);
  const ok = failed.length === 0 && publishReadiness.status === 'ready';
  const readinessReceipt = releaseReadinessReceipt(provenance, freshness, tarball, publishReadiness, ok);
  return {
    schema: 'yam.release-report.v1',
    generated_at: startedAt,
    packageName: PACKAGE_JSON.name,
    version: VERSION,
    ok,
    truth_status: ok ? 'verified' : 'blocked',
    checks,
    failed,
    provenance,
    tarball,
    freshness,
    publish_readiness: publishReadiness,
    readiness_receipt: readinessReceipt,
    study_note: releaseStudyNote(publishReadiness, publishBlockerEvidence),
    publishBlockerEvidence,
    next_actions: nextActions
  };
}

function releaseReadinessReceipt(provenance: AnyRecord = {}, freshness: AnyRecord = {}, tarball: AnyRecord = {}, publishReadiness: AnyRecord = {}, ok = false) {
  return {
    schema: 'yam.release-readiness-receipt.v1',
    generated_at: new Date().toISOString(),
    package_name: PACKAGE_JSON.name,
    local_version: VERSION,
    registry: {
      url: String(publishReadiness.registry?.url || ''),
      latest_version: String(publishReadiness.registry?.latest_version || ''),
      version_status: String(publishReadiness.registry?.version_status || 'not_verified'),
      truth_status: publishReadiness.registry?.truth_status || 'partial'
    },
    auth: {
      command: 'npm whoami',
      status: String(publishReadiness.auth?.status || 'not_verified'),
      account: publishReadiness.auth?.status === 'authenticated' ? 'observed_redacted' : '',
      truth_status: publishReadiness.auth?.truth_status || 'partial'
    },
    git: {
      commit: String(provenance.git_commit || ''),
      dirty: Boolean(provenance.git_dirty),
      dirty_lines_observed: Array.isArray(provenance.git_status_lines) ? provenance.git_status_lines.length : 0,
      truth_status: provenance.truth_status || 'partial'
    },
    checks: {
      dist: freshness.dist || 'not-verified',
      package_boundary: freshness.package_boundary || 'not-verified',
      cli_smoke: freshness.cli_smoke || 'not-verified',
      tarball: tarball.status === 'checked' ? 'checked' : 'not-verified'
    },
    tarball: {
      status: String(tarball.status || 'not-verified'),
      name: String(tarball.tarball_name || ''),
      integrity_present: Boolean(tarball.integrity),
      shasum_present: Boolean(tarball.shasum),
      truth_status: tarball.truth_status || 'partial'
    },
    publish_attempted: false,
    truth_status: ok ? 'verified' : 'blocked'
  };
}

function releaseProvenance(checks = []) {
  const gitCommit = runReadOnlyCommand('git', ['rev-parse', '--short', 'HEAD']);
  const gitStatus = runReadOnlyCommand('git', ['status', '--short']);
  const distChanged = runReadOnlyCommand('git', ['diff', '--name-only', '--', 'dist']);
  const packageFiles = checks.find((check) => check.id === 'package_boundary')?.status === 'passed' ? 'checked' : 'not-verified';
  return {
    schema: 'yam.release-provenance.v1',
    package_name: PACKAGE_JSON.name,
    version: VERSION,
    git_commit: gitCommit.trim(),
    git_dirty: Boolean(gitStatus.trim()),
    git_status_lines: gitStatus.trim().split(/\r?\n/).filter(Boolean).slice(0, 20),
    dist_changed_files: distChanged.trim().split(/\r?\n/).filter(Boolean).slice(0, 20),
    package_files: packageFiles,
    generated_at: new Date().toISOString(),
    truth_status: gitCommit.trim() && packageFiles === 'checked' ? 'partial' : 'assumed'
  };
}

function releaseTarballProvenance() {
  const result = spawnSync('npm', ['pack', '--json', '--dry-run', '--ignore-scripts'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: path.join(os.tmpdir(), 'yam-npm-cache') },
    timeout: 120000
  });
  if (result.status !== 0) {
    return {
      schema: 'yam.release-tarball-provenance.v1',
      status: 'blocked',
      reason: summarizeCheckOutput([result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n')),
      truth_status: 'blocked'
    };
  }
  try {
    const data = JSON.parse(String(result.stdout || '[]'))[0] || {};
    return {
      schema: 'yam.release-tarball-provenance.v1',
      status: 'checked',
      tarball_name: String(data.filename || ''),
      package_size: Number(data.size || data.packageSize || 0),
      unpacked_size: Number(data.unpackedSize || 0),
      file_count: Array.isArray(data.files) ? data.files.length : Number(data.entryCount || 0),
      integrity: String(data.integrity || ''),
      shasum: String(data.shasum || ''),
      truth_status: data.filename ? 'verified' : 'partial'
    };
  } catch (error) {
    return {
      schema: 'yam.release-tarball-provenance.v1',
      status: 'blocked',
      reason: `could not parse npm pack output: ${errorMessage(error)}`,
      truth_status: 'blocked'
    };
  }
}

function releaseFreshness(checks = [], provenance: AnyRecord = {}, tarball: AnyRecord = {}) {
  const checkStatus = (id) => checks.find((check) => check.id === id)?.status || 'not-run';
  const dist = checkStatus('dist_freshness') === 'passed' && !provenance.dist_changed_files?.length ? 'fresh' : 'needs-check';
  const registry = checkStatus('registry_status') === 'passed' ? 'publishable-version' : 'not-verified';
  const boundary = checkStatus('package_boundary') === 'passed' ? 'checked' : 'not-verified';
  const smoke = checkStatus('cli_smoke') === 'passed' ? 'checked' : 'not-verified';
  const tarballStatus = tarball.status === 'checked' ? 'checked' : 'not-verified';
  return {
    schema: 'yam.release-freshness.v1',
    dist,
    registry,
    package_boundary: boundary,
    cli_smoke: smoke,
    tarball: tarballStatus,
    truth_status: [dist, registry, boundary, smoke, tarballStatus].every((value) => !/not-verified|needs-check/.test(value)) ? 'verified' : 'partial'
  };
}

function releasePublishReadiness(checks = [], provenance: AnyRecord = {}, tarball: AnyRecord = {}, publishBlockers = []) {
  const failedChecks = checks.filter((check) => check.status !== 'passed');
  const registryProbe = runReadOnlyCommandResult('npm', ['config', 'get', 'registry']);
  const registryUrl = registryProbe.stdout.trim() || String(PACKAGE_JSON.publishConfig?.registry || 'https://registry.npmjs.org/');
  const whoamiProbe = runReadOnlyCommandResult('npm', ['whoami', '--registry', registryUrl]);
  const registryStatus = releaseRegistryStatusFromChecks(checks);
  const latestProbe = registryStatus.checked
    ? { ok: true, stdout: registryStatus.latest_version, note: registryStatus.note }
    : runReadOnlyCommandResult('npm', ['view', PACKAGE_JSON.name, 'version', '--registry', registryUrl]);
  const latestVersion = latestProbe.ok ? String(latestProbe.stdout || '').trim() : '';
  const blockers = [];
  const versionStatus = latestProbe.ok
    ? registryStatus.not_published ? 'package_not_published' : latestVersion === VERSION ? 'already_published' : 'new_version'
    : 'not_verified';

  if (!registryProbe.ok) {
    blockers.push(readinessBlocker('registry_not_verified', 'npm registry could not be read from this shell', 'run `npm config get registry` and confirm it points to the intended public registry', 'npm config get registry', 'error'));
  }
  if (!whoamiProbe.ok) {
    blockers.push(readinessBlocker('auth_not_verified', whoamiProbe.note || 'npm whoami did not confirm an authenticated publisher in this shell', 'refresh npm login/token, then rerun `npm whoami` before publishing', 'npm whoami', 'error'));
  }
  if (!latestProbe.ok) {
    const blocker = classifyPublishBlockerText(latestProbe.note);
    blockers.push(readinessBlocker(blocker?.blocker_kind || 'latest_version_not_verified', blocker?.likely_cause || 'npm latest version could not be read', blocker?.safe_next_action || 'rerun the read-only registry check before publishing', 'npm view', 'error'));
  }
  if (versionStatus === 'already_published') {
    blockers.push(readinessBlocker('version_already_published', `${PACKAGE_JSON.name}@${VERSION} is already present on the registry`, 'bump package.json to the next patch version before publishing', 'npm view', 'error'));
  }
  if (failedChecks.length) {
    blockers.push(readinessBlocker('release_checks_failed', `${failedChecks.length} release check(s) did not pass`, 'fix failing release checks before publishing', 'npm run release:check', 'error'));
  }
  if (provenance.git_dirty) {
    blockers.push(readinessBlocker('git_dirty', 'working tree has uncommitted changes', 'commit intended changes or keep them explicitly local before tagging/publishing', 'git status --short'));
  }
  if (provenance.dist_changed_files?.length) {
    blockers.push(readinessBlocker('dist_not_fresh', 'dist has changed files after freshness check', 'run build and commit dist only if this package publishes dist', 'npm run build'));
  }
  if (tarball.status !== 'checked') {
    blockers.push(readinessBlocker('tarball_not_verified', tarball.reason || 'npm pack dry-run did not produce tarball provenance', 'fix tarball/package-boundary issues before publishing', 'npm pack --dry-run', 'error'));
  }
  for (const blocker of publishBlockers) {
    blockers.push(readinessBlocker(blocker.blocker_kind, blocker.likely_cause, blocker.safe_next_action, 'npm publish', 'error'));
  }

  const uniqueBlockers = uniqueReadinessBlockers(blockers);
  const status = uniqueBlockers.length ? 'blocked' : 'ready';
  return {
    schema: 'yam.release-publish-readiness.v1',
    generated_at: new Date().toISOString(),
    package_name: PACKAGE_JSON.name,
    local_version: VERSION,
    status,
    registry: {
      url: registryUrl,
      latest_version: latestVersion,
      version_status: versionStatus,
      truth_status: latestProbe.ok ? 'verified' : 'blocked'
    },
    auth: {
      command: 'npm whoami',
      status: whoamiProbe.ok ? 'authenticated' : 'not_authenticated',
      account: whoamiProbe.ok ? 'observed_redacted' : '',
      note: whoamiProbe.ok ? 'npm account observed; username intentionally redacted' : whoamiProbe.note,
      truth_status: whoamiProbe.ok ? 'verified' : 'blocked'
    },
    blockers: uniqueBlockers,
    next_action: uniqueBlockers[0]?.safe_next_action || 'publish readiness is complete; run publish only when the user explicitly intends it',
    truth_status: status === 'ready' ? 'verified' : 'blocked'
  };
}

function releaseRegistryStatusFromChecks(checks = []) {
  const registryCheck = checks.find((check) => check.id === 'registry_status');
  const note = String(registryCheck?.note || '');
  if (registryCheck?.status !== 'passed') return { checked: false, latest_version: '', not_published: false, note };
  const latest = note.match(/\blatest\s+([^,\s)]+)/i)?.[1] || '';
  return {
    checked: true,
    latest_version: latest,
    not_published: /not published yet/i.test(note),
    note
  };
}

function readinessBlocker(kind, reason, safeNextAction, command = '', severity = 'warning') {
  return {
    kind,
    severity,
    reason: summarizeCheckOutput(redactSensitiveText(reason)),
    safe_next_action: safeNextAction,
    command,
    truth_status: 'partial'
  };
}

function uniqueReadinessBlockers(blockers = []) {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key = `${blocker.kind}:${blocker.safe_next_action}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function releaseStudyNote(publishReadiness: AnyRecord = {}, publishBlockers = []) {
  const authBlocked = publishReadiness.blockers?.find((blocker) => /auth|otp|permission|forbidden|not_found/i.test(`${blocker.kind} ${blocker.reason}`));
  const firstBlocker = authBlocked || publishReadiness.blockers?.[0] || publishBlockers[0];
  if (!firstBlocker) {
    return buildStudyNote({
      changed_code: 'yam release report',
      changed_role: 'It checks whether the package looks ready to publish without running npm publish.',
      change_summary: 'Release readiness passed the read-only checks that were available.',
      why_important: 'A publish command changes public package state, so yam keeps the readiness proof separate from the publish action.',
      learning_note: 'Readiness means the checks looked good; publishing still requires an explicit user action.'
    });
  }
  return buildStudyNote({
    issue_code: 'npm publish readiness',
    issue_role: 'This part checks registry, version, auth, tarball, and local release checks before any public publish.',
    issue_symptom: firstBlocker.reason || firstBlocker.likely_cause || 'Publish readiness is blocked.',
    changed_code: 'yam release report',
    changed_role: 'It now explains the likely publish blocker instead of only showing a raw npm failure.',
    change_summary: 'The report adds auth-safe readiness, safe next action, and beginner-readable blocker evidence.',
    why_important: 'A bad token or wrong npm account can make publish fail or target the wrong package context.',
    learning_note: 'When release readiness is blocked, fix the first blocker before trying a publish command.'
  });
}

function releaseNextActions(checks = [], provenance: AnyRecord = {}, tarball: AnyRecord = {}, publishBlockers = [], publishReadiness: AnyRecord = {}) {
  const actions = [];
  for (const check of checks) {
    if (check.status === 'passed') continue;
    actions.push(nextActionDetail(`release-${check.id}`, check.status === 'blocked' ? 'error' : 'warning', check.note || `${check.id} did not pass`, `fix ${check.id} before publishing`, check.command));
  }
  if (provenance.git_dirty) {
    actions.push(nextActionDetail('release-git-dirty', 'warning', 'working tree has uncommitted changes', 'commit or intentionally keep local-only changes before tagging a release', 'git status --short'));
  }
  if (provenance.dist_changed_files?.length) {
    actions.push(nextActionDetail('release-dist-drift', 'warning', 'dist has unstaged or uncommitted differences', 'run build and commit generated dist only if this package publishes dist', 'npm run build'));
  }
  if (tarball.status !== 'checked') {
    actions.push(nextActionDetail('release-tarball-provenance', 'error', tarball.reason || 'tarball provenance was not produced', 'run npm pack dry-run before publishing', 'npm pack --dry-run'));
  }
  for (const blocker of publishBlockers) {
    actions.push(nextActionDetail(`publish-${blocker.blocker_kind}`, blocker.truth_status === 'blocked' ? 'error' : 'warning', blocker.likely_cause, blocker.safe_next_action, 'npm publish'));
  }
  for (const blocker of publishReadiness.blockers || []) {
    actions.push(nextActionDetail(`publish-readiness-${blocker.kind}`, blocker.severity || 'warning', blocker.reason, blocker.safe_next_action, blocker.command || 'npm publish'));
  }
  return uniqueNextActionDetails(actions);
}

function publishBlockerEvidenceFromRelease(checks = [], tarball: AnyRecord = {}) {
  const texts = [
    ...checks.map((check) => `${check.id}\n${check.note || ''}`),
    tarball.reason || ''
  ].filter(Boolean);
  const blockers = [];
  for (const text of texts) {
    const blocker = classifyPublishBlockerText(text);
    if (blocker) blockers.push(blocker);
  }
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    if (seen.has(blocker.blocker_kind)) return false;
    seen.add(blocker.blocker_kind);
    return true;
  });
}

function classifyPublishBlockerText(text = '') {
  const value = String(text || '');
  if (!value.trim()) return null;
  const excerpt = summarizeCheckOutput(value);
  if (/\b(ENEEDAUTH|E401|Unauthorized|whoami)\b/i.test(value)) {
    return publishBlocker('auth_required', excerpt, 'npm is not logged in for this shell or token', 'run `npm login` or refresh the npm token, then rerun `npm whoami`');
  }
  if (/\b(OTP|one-time password|two-factor|2FA)\b/i.test(value)) {
    return publishBlocker('otp_required', excerpt, 'npm publish requires a current two-factor authentication code', 'rerun publish with `npm publish --otp=123456` using the current authenticator code');
  }
  if (/\bE403\b|403\s+Forbidden|Forbidden\s+-\s+PUT|npm ERR!.*Forbidden/i.test(value)) {
    return publishBlocker('permission_forbidden', excerpt, 'the npm account lacks publish permission or the package policy rejected the request', 'confirm package ownership with `npm owner ls <package>` and publish with the owning account');
  }
  if (/\bE404\b|Not Found - PUT/i.test(value)) {
    return publishBlocker('package_or_permission_not_found', excerpt, 'npm could not publish this package name from the current account or registry context', 'check `npm config get registry`, `npm owner ls <package>`, and package name access');
  }
  if (/previously published|cannot publish over|already exists|You cannot publish over/i.test(value)) {
    return publishBlocker('version_already_published', excerpt, 'npm versions are immutable once published', 'bump package.json to the next patch version before publishing');
  }
  if (/(EACCES|EPERM|permission denied|cache|_cacache)/i.test(value)) {
    return publishBlocker('npm_cache_permission', excerpt, 'npm cache or filesystem permissions are blocking the command', 'retry with a user-owned cache such as `npm_config_cache=/private/tmp/yam-npm-cache npm publish`');
  }
  if (/(ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|registry unreachable|network timeout)/i.test(value)) {
    return publishBlocker('registry_unreachable', excerpt, 'the npm registry or network path was unreachable', 'wait, check network/VPN, then retry the read-only registry check first');
  }
  if (/(tarball|package boundary|files list|npm pack)/i.test(value)) {
    return publishBlocker('tarball_or_boundary_failure', excerpt, 'the package contents or dry-run tarball check failed', 'run `npm run package-boundary:check` and `npm pack --dry-run` before publishing');
  }
  return null;
}

function publishBlocker(kind, excerpt, likelyCause, safeNextAction) {
  return {
    blocker_kind: kind,
    native_error_excerpt: excerpt,
    likely_cause: likelyCause,
    safe_next_action: safeNextAction,
    truth_status: 'partial'
  };
}

function runReadOnlyCommand(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000
  });
  if (result.status !== 0) return '';
  return String(result.stdout || '');
}

function runReadOnlyCommandResult(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: path.join(os.tmpdir(), 'yam-npm-cache') },
    timeout: 30000
  });
  const stdout = redactSensitiveText(String(result.stdout || ''));
  const stderr = redactSensitiveText(String(result.stderr || result.error?.message || ''));
  return {
    ok: result.status === 0,
    status: typeof result.status === 'number' ? result.status : null,
    stdout,
    stderr,
    note: summarizeCheckOutput([stdout, stderr].filter(Boolean).join('\n'))
  };
}

function runReadOnlyCommandIn(cwd, command, args = []) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 30000
  });
  if (result.status !== 0) return '';
  return String(result.stdout || '');
}

function runReleaseCheck(id, commandSpec) {
  const [command, args] = commandSpec;
  const start = Date.now();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: path.join(os.tmpdir(), 'yam-npm-cache') },
    timeout: 120000
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const timedOut = result.error?.message?.includes('ETIMEDOUT') || result.signal === 'SIGTERM';
  return {
    id,
    command: [command, ...args].join(' '),
    status: result.status === 0 ? 'passed' : timedOut ? 'blocked' : 'failed',
    exit_code: typeof result.status === 'number' ? result.status : null,
    duration_ms: Date.now() - start,
    note: summarizeCheckOutput(output || result.error?.message || '')
  };
}

function summarizeCheckOutput(output = '') {
  const lines = redactSensitiveText(String(output || '')).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return '';
  const highSignal = lines.filter((line) => !line.startsWith('>')).slice(-4);
  return highSignal.join(' | ').slice(0, 600);
}

function redactSensitiveText(text = '') {
  return String(text || '')
    .replace(/(_authToken\s*=\s*)[^\s]+/gi, '$1[redacted]')
    .replace(/\b(password|passwd|api[_-]?key|secret|token)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\/\/([^:\s]+):([^@\s]+)@/g, '//[redacted]@')
    .replace(/\b(npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[redacted-token]');
}

async function readStdinTextIfAvailable() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function loop(args = []) {
  const subcommand = args[0] || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return loopUsage();
  if (subcommand === 'report') return loopReport(args.slice(1));
  console.error(`unknown loop command: ${subcommand}`);
  process.exitCode = 1;
  return loopUsage();
}

function loopUsage() {
  console.log(`yam loop

Read-only loop artifact helpers. A loop report records intent, stages, evidence, blockers, next action, handoff fields, and a short study note. It does not run agents, start processes, publish packages, or write files.

Usage:
  yam loop report [--route route] [--intent text] [--loop-kind harness|release|ueye|scout|deep|mission] [--stage id:status:note] [--evidence text] [--evidence-level none|fixture|smoke|local|real] [--evidence-stamp text] [--source-digest text] [--touched-file file] [--read-file file] [--verified-file file] [--skipped-check text] [--stop-condition text] [--resume-hint text] [--readiness-state usable|degraded|blocked|unknown] [--covered-requirement text] [--uncovered-requirement text] [--blocked text] [--blocked-kind text] [--failure-cause text] [--safe-retry text] [--recovery-hint text] [--fix-first-item text] [--remaining-task text] [--recommended-direction text] [--implementation-note text] [--why-this-next text] [--blocked-by text] [--owner-route route] [--owner-scope text] [--scope-owner text] [--side-effect text] [--avoidance-note text] [--truth status] [--intent-label read_only|write|destructive|runtime|visual|publish] [--issue-code text] [--issue-role text] [--issue-symptom text] [--changed-code text] [--changed-role text] [--change-summary text] [--why-important text] [--learning-note text] [--json]
`);
}

async function loopReport(args = []) {
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return loopUsage();
  const flags = parseSimpleFlags(args, new Set(['route', 'intent', 'loop-kind', 'stage', 'stage-convention', 'evidence', 'evidence-level', 'evidence-stamp', 'source-digest', 'touched-file', 'read-file', 'verified-file', 'skipped-check', 'stop-condition', 'resume-hint', 'readiness-state', 'covered-requirement', 'uncovered-requirement', 'blocked', 'blocker', 'blocked-kind', 'failure-cause', 'next-action', 'safe-retry', 'recovery-hint', 'fix-first-item', 'remaining-task', 'recommended-direction', 'direction', 'implementation-note', 'why-this-next', 'blocked-by', 'owner-route', 'owner-scope', 'scope-owner', 'owner', 'scope', 'side-effect', 'avoidance-note', 'truth', 'intent-label', 'tool-intent', 'issue-code', 'issue-role', 'issue-symptom', 'changed-code', 'changed-role', 'change-summary', 'why-important', 'learning-note', 'json']));
  const blockers = [...arrayFlag(flags.blocked), ...arrayFlag(flags.blocker)];
  const report = buildLoopReport({
    route: normalizeRoute(flags.route) || String(flags.route || ''),
    intent: String(flags.intent || ''),
    loop_kind: String(flags.loop_kind || flags.route || 'harness'),
    stage_conventions: arrayFlag(flags.stage_convention),
    stages: arrayFlag(flags.stage),
    evidence: arrayFlag(flags.evidence),
    evidence_level: normalizeLoopEvidenceLevelFlag(flags.evidence_level),
    evidence_stamp: String(flags.evidence_stamp || ''),
    source_digest: String(flags.source_digest || ''),
    touched_files: arrayFlag(flags.touched_file),
    read_files: arrayFlag(flags.read_file),
    verified_files: arrayFlag(flags.verified_file),
    skipped_checks: arrayFlag(flags.skipped_check),
    stop_condition: String(flags.stop_condition || ''),
    resume_hint: String(flags.resume_hint || ''),
    readiness_state: normalizeReadinessStateFlag(flags.readiness_state),
    covered_requirements: arrayFlag(flags.covered_requirement),
    uncovered_requirements: arrayFlag(flags.uncovered_requirement),
    blockers,
    blocked_kind: String(flags.blocked_kind || ''),
    failure_cause: String(flags.failure_cause || ''),
    truth_status: isTruthStatus(flags.truth) ? flags.truth : undefined,
    intent_label: normalizeToolIntent(flags.intent_label || flags.tool_intent || 'read_only'),
    next_action: String(flags.next_action || ''),
    safe_retry: String(flags.safe_retry || ''),
    recovery_hint: String(flags.recovery_hint || ''),
    fix_first_items: arrayFlag(flags.fix_first_item),
    remaining_tasks: arrayFlag(flags.remaining_task),
    recommended_direction: String(flags.recommended_direction || flags.direction || ''),
    implementation_notes: arrayFlag(flags.implementation_note),
    why_this_next: String(flags.why_this_next || ''),
    blocked_by: arrayFlag(flags.blocked_by),
    owner_route: String(flags.owner_route || flags.route || ''),
    owner_scope: [...arrayFlag(flags.owner_scope), ...arrayFlag(flags.scope)],
    scope_owner: String(flags.scope_owner || flags.owner || ''),
    side_effects: arrayFlag(flags.side_effect),
    avoidance_note: String(flags.avoidance_note || ''),
    issue_code: String(flags.issue_code || ''),
    issue_role: String(flags.issue_role || ''),
    issue_symptom: String(flags.issue_symptom || ''),
    changed_code: String(flags.changed_code || ''),
    changed_role: String(flags.changed_role || ''),
    change_summary: String(flags.change_summary || ''),
    why_important: String(flags.why_important || ''),
    learning_note: String(flags.learning_note || '')
  });
  printJsonOrHuman(report, Boolean(flags.json), 'Loop report');
  if (report.truth_status === 'blocked') process.exitCode = 1;
}

async function ueye(args = []) {
  const subcommand = args[0] || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return ueyeUsage();
  if (subcommand === 'capture') return ueyeCapture(args.slice(1));
  if (subcommand === 'compare') return ueyeCompare(args.slice(1));
  if (subcommand === 'preflight') return ueyePreflight(args.slice(1));
  if (subcommand === 'report') return ueyeReport(args.slice(1));
  if (subcommand === 'asset') return ueyeAsset(args.slice(1));
  if (subcommand === 'revision') return ueyeRevision(args.slice(1));
  console.error(`unknown ueye command: ${subcommand}`);
  return ueyeUsage();
}

function ueyeUsage() {
  console.log(`yam ueye

Opt-in visual evidence helpers. Ueye stays one skill: fast by default, capture/compare only when verified visual claims need real evidence.

Usage:
  yam ueye capture --url URL --out screenshot.png [--viewport 1440x900] [--full-page] [--json]
  yam ueye compare --reference ref.png --actual screenshot.png [--json]
  yam ueye preflight [dir] [--json]
  yam ueye report [--reference ref.png] [--actual screenshot.png] [--asset-manifest file] [--revision-manifest file] [--preflight-id id] [--p0-risk text] [--quality-gate-note text] [--brief-dimension text] [--constraint text] [--anti-slop text] [--invented-metric] [--placeholder-copy] [--generic-visual] [--acceptance-criterion text] [--touched-file file] [--read-file file] [--verified-file file] [--skipped-check text] [--residual-risk text] [--stop-condition text] [--resume-hint text] [--deep-visual-check text] [--design-system-evidence text] [--implementation-evidence text] [--state-check default:pass] [--review-session-id id] [--provider-context local] [--execution-surface in-app-browser] [--app-surface codex-app] [--browser-surface in-app-browser] [--control-mode manual|automated] [--preserved-state] [--preserved-url URL] [--completion-claim draft|needs-polish|done] [--strict] [--design-score n] [--p0 text] [--p1 text] [--states-checked] [--mobile-checked] [--contrast-checked] [--similar text] [--different text] [--missing text] [--resolved text] [--new-finding text] [--still-open text] [--regression text] [--viewport 1440x900] [--state default] [--design-quality pass|needs-polish|fails|not-checked] [--json]
  yam ueye asset add [--manifest file] --id id --file image [--source-url URL] [--source-page-url URL] [--license-note text] [--operator-provided] [--do-not-replace] [--allowed-for-edit] [--json]
  yam ueye asset verify [--manifest file] [--json]
  yam ueye revision archive --file image --round n [--artifact-id id] [--root dir] [--manifest file] [--json]
  yam ueye revision verify [--root dir] [--manifest file] [--json]

Notes:
  capture uses a locally available Playwright install when present. It does not download browsers or install dependencies.
  compare uses local files only and reports sha256, dimensions, comparison_result, and proof-ready visual provenance.
  report produces a proof-ready Ueye visual run report, design completion gate, and continuity/comparison record without requiring a new capture.
  asset records local reference provenance and protection flags; it never downloads remote content.
  revision copies the current local artifact into a non-overwriting round archive before the live file is edited.
`);
}

async function ueyeAsset(args = []) {
  const subcommand = args[0] || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return ueyeUsage();
  const flags = parseSimpleFlags(args.slice(1), new Set(['manifest', 'id', 'file', 'source-url', 'source-page-url', 'retrieved-at', 'license-note', 'operator-provided', 'do-not-replace', 'allowed-for-edit', 'replace', 'json']));
  const manifest = path.resolve(expandHome(flags.manifest || path.join(process.cwd(), '.yam', 'ueye', 'assets.json')));
  try {
    if (subcommand === 'add') {
      if (!flags.id || !flags.file) throw new Error('asset add requires --id and --file');
      const result = await upsertUeyeAsset({
        manifest_path: manifest,
        id: String(flags.id),
        file: path.resolve(expandHome(flags.file)),
        source_url: flags.source_url,
        source_page_url: flags.source_page_url,
        retrieved_at: flags.retrieved_at,
        license_note: flags.license_note,
        operator_provided: flags.operator_provided ? true : undefined,
        do_not_replace: flags.do_not_replace ? true : undefined,
        allowed_for_edit: flags.allowed_for_edit ? true : undefined,
        replace: Boolean(flags.replace)
      });
      printJsonOrHuman(result, Boolean(flags.json), 'Ueye asset');
      return;
    }
    if (subcommand === 'verify') {
      const result = await verifyUeyeAssetManifest(manifest);
      printJsonOrHuman(result, Boolean(flags.json), 'Ueye asset verification');
      if (result.truth_status === 'blocked') process.exitCode = 1;
      return;
    }
    throw new Error(`unknown ueye asset command: ${subcommand}`);
  } catch (error) {
    const result = { schema: 'yam.ueye-asset-error.v1', status: 'blocked', reason: errorMessage(error), truth_status: 'blocked' };
    printJsonOrHuman(result, Boolean(flags.json), 'Ueye asset');
    process.exitCode = 1;
  }
}

async function ueyeRevision(args = []) {
  const subcommand = args[0] || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return ueyeUsage();
  const flags = parseSimpleFlags(args.slice(1), new Set(['file', 'round', 'artifact-id', 'root', 'manifest', 'json']));
  const root = path.resolve(expandHome(flags.root || path.join(process.cwd(), '.yam', 'ueye', 'revisions')));
  const manifest = path.resolve(expandHome(flags.manifest || path.join(root, 'manifest.json')));
  try {
    if (subcommand === 'archive') {
      if (!flags.file || !flags.round) throw new Error('revision archive requires --file and --round');
      const result = await archiveUeyeRevision({
        file: path.resolve(expandHome(flags.file)),
        root,
        manifest_path: manifest,
        round: Number(flags.round),
        artifact_id: flags.artifact_id
      });
      printJsonOrHuman(result, Boolean(flags.json), 'Ueye revision');
      return;
    }
    if (subcommand === 'verify') {
      const result = await verifyUeyeRevisionHistory(manifest);
      printJsonOrHuman(result, Boolean(flags.json), 'Ueye revision verification');
      if (result.truth_status === 'blocked') process.exitCode = 1;
      return;
    }
    throw new Error(`unknown ueye revision command: ${subcommand}`);
  } catch (error) {
    const result = { schema: 'yam.ueye-revision-error.v1', status: 'blocked', reason: errorMessage(error), truth_status: 'blocked' };
    printJsonOrHuman(result, Boolean(flags.json), 'Ueye revision');
    process.exitCode = 1;
  }
}

async function ueyePreflight(args = []) {
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return ueyeUsage();
  const parsed = parseDirJsonArgs(args);
  const report = await buildUeyePreflightReport(parsed.dir);
  if (parsed.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('Ueye preflight');
  console.log(`Project: ${report.project}`);
  console.log(`Preflight id: ${report.preflight_id}`);
  console.log(`Truth status: ${report.truth_status}`);
  for (const item of report.checklist) console.log(`- ${item.status}: ${item.item} (${item.next_action})`);
}

async function buildUeyePreflightReport(targetDir = process.cwd()) {
  const dir = path.resolve(expandHome(targetDir || process.cwd()));
  const packageInfo = await projectPackageInfo(dir);
  const frameworkChecklist = await detectFrameworkChecklist(dir, packageInfo.pkg);
  const pack = await findProjectPack(dir);
  const playwrightPath = await localPackagePath(dir, 'playwright');
  const browserCache = await pluginCacheHas('openai-bundled/browser');
  const uiPaths = await existingRelativePaths(dir, ['app', 'src/app', 'pages', 'src/pages', 'components', 'src/components', 'styles', 'src/styles']);
  const screenshotAvailability = playwrightPath ? 'automated_capture_possible' : browserCache ? 'in_app_or_user_screenshot_needed' : 'user_screenshot_needed';
  const p0p1Risks = [];
  if (!frameworkChecklist.uiLike) p0p1Risks.push('target UI surface is not detected yet');
  if (!browserCache && !playwrightPath) p0p1Risks.push('no local capture surface was observed');
  if (!pack) p0p1Risks.push('project direction pack is missing');
  return {
    schema: 'yam.ueye-preflight.v1',
    preflight_id: `ueye-preflight-${timestampId()}`,
    generated_at: new Date().toISOString(),
    project: dir,
    detected_framework: frameworkChecklist.framework,
    ui_paths: uiPaths,
    reference_source_needed: true,
    target_states_needed: ['default', 'loading', 'error', 'empty', 'mobile'],
    mobile_responsive_check_needed: true,
    contrast_cta_accessibility_risk: frameworkChecklist.uiLike ? 'check before done claim' : 'unknown until UI target is identified',
    p0_p1_risk_candidates: p0p1Risks,
    screenshot_capture_availability: screenshotAvailability,
    preferred_surface: 'in-app-browser',
    checklist: [
      preflightItem('reference', 'reference source selected or user confirms no reference', 'needed', 'record reference path, screenshot, or text target before claiming design fidelity'),
      preflightItem('states', 'primary states are listed', 'needed', 'prepare default/loading/error/empty/mobile states when the UI supports them'),
      preflightItem('mobile', 'mobile/responsive pass planned', 'needed', 'capture or inspect a narrow viewport before verified visual claims'),
      preflightItem('contrast_cta_accessibility', 'CTA, contrast, and accessible labels reviewed', 'needed', 'mark P0/P1 risks before saying done'),
      preflightItem('capture', 'screenshot/capture surface available', screenshotAvailability === 'automated_capture_possible' ? 'observed' : 'partial', 'use in-app browser or user-provided screenshot if automation is unavailable')
    ],
    completion_cap: 'preflight cannot prove visual quality without implementation screenshot and comparison evidence',
    truth_status: 'partial'
  };
}

function preflightItem(id, item, status, nextAction) {
  return { id, item, status, next_action: nextAction, truth_status: status === 'observed' ? 'verified' : 'partial' };
}

async function existingRelativePaths(dir, relativePaths = []) {
  const found = [];
  for (const relative of relativePaths) {
    if (await exists(path.join(dir, relative))) found.push(relative);
  }
  return found;
}

async function ueyeCapture(args = []) {
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return ueyeUsage();
  const flags = parseSimpleFlags(args, new Set(['url', 'out', 'viewport', 'wait-until', 'timeout', 'full-page', 'provider-context', 'provider-badge', 'execution-surface', 'app-surface', 'browser-surface', 'control-mode', 'preserved-state', 'preserved-url', 'evidence-id', 'screenshot-id', 'json']));
  const url = String(flags.url || '');
  const out = String(flags.out || '');
  if (!url || !out) {
    console.error('usage: yam ueye capture --url URL --out screenshot.png [--viewport 1440x900] [--full-page] [--json]');
    process.exitCode = 1;
    return;
  }

  const target = path.resolve(expandHome(out));
  const viewport = parseViewport(String(flags.viewport || '1440x900'));
  const timeout = Number(flags.timeout || 30000);
  const waitUntil = String(flags.wait_until || 'networkidle');
  let browser;

  try {
    const playwright = await loadOptionalPlaywright();
    const chromium = playwright?.chromium;
    if (!chromium) throw new Error('Playwright chromium launcher was not found');
    await fsp.mkdir(path.dirname(target), { recursive: true });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport });
    await page.goto(url, { waitUntil, timeout });
    await page.screenshot({ path: target, fullPage: Boolean(flags.full_page) });
    const info = await imageFileInfo(target);
    const surfaceContext = buildUeyeSurfaceContext({
      provider_context: String(flags.provider_context || 'local-playwright'),
      provider_badge: String(flags.provider_badge || flags.provider_context || 'local-playwright'),
      execution_surface: String(flags.execution_surface || 'browser-capture'),
      app_surface: String(flags.app_surface || 'local-project'),
      browser_surface: String(flags.browser_surface || 'playwright'),
      control_mode: String(flags.control_mode || 'automated-capture'),
      route: 'ueye',
      mode: 'capture',
      url,
      viewport: `${viewport.width}x${viewport.height}`,
      screenshot_id: String(flags.screenshot_id || path.basename(target)),
      evidence_id: String(flags.evidence_id || `ueye-capture-${timestampId()}`),
      preserved_state: Boolean(flags.preserved_state),
      preserved_url: String(flags.preserved_url || url),
      local_only: true,
      truth_status: 'verified'
    });
    const result = {
      schema: 'yam.ueye-capture.v1',
      status: 'verified',
      url,
      out: target,
      viewport: `${viewport.width}x${viewport.height}`,
      full_page: Boolean(flags.full_page),
      sha256: info.sha256,
      dimensions: info.dimensions,
      surface_context: surfaceContext,
      visual_evidence: `browser screenshot captured: ${target} (${info.dimensions}, sha256:${info.sha256})`
    };
    printJsonOrHuman(result, Boolean(flags.json), 'Ueye capture');
  } catch (error) {
    const result = {
      schema: 'yam.ueye-capture.v1',
      status: 'blocked',
      url,
      out: target,
      reason: errorMessage(error),
      next_action: 'Install Playwright in the current project or provide a user/browser screenshot, then use `yam ueye compare`.',
      visual_cap: 'blocked'
    };
    printJsonOrHuman(result, Boolean(flags.json), 'Ueye capture');
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function ueyeCompare(args = []) {
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return ueyeUsage();
  const flags = parseSimpleFlags(args, new Set(['reference', 'ref', 'actual', 'screenshot', 'json', 'reference-id', 'screenshot-id', 'provider-context', 'provider-badge', 'execution-surface', 'app-surface', 'browser-surface', 'control-mode', 'preserved-state', 'preserved-url', 'url', 'viewport', 'evidence-id']));
  const reference = String(flags.reference || flags.ref || '');
  const actual = String(flags.actual || flags.screenshot || '');
  if (!reference || !actual) {
    console.error('usage: yam ueye compare --reference ref.png --actual screenshot.png [--json]');
    process.exitCode = 1;
    return;
  }

  const referencePath = path.resolve(expandHome(reference));
  const actualPath = path.resolve(expandHome(actual));
  try {
    const referenceInfo = await imageFileInfo(referencePath);
    const actualInfo = await imageFileInfo(actualPath);
    if (referenceInfo.dimensions === 'unknown' || actualInfo.dimensions === 'unknown') {
      throw new Error('compare requires image files with readable PNG, JPEG, or GIF dimensions');
    }
    const exactMatch = referenceInfo.sha256 === actualInfo.sha256;
    const sameDimensions = referenceInfo.dimensions === actualInfo.dimensions;
    const comparisonResult = exactMatch ? 'matched' : 'different';
    const truthStatus = exactMatch ? 'verified' : 'partial';
    const surfaceContext = buildUeyeSurfaceContext({
      provider_context: String(flags.provider_context || 'local-file'),
      provider_badge: String(flags.provider_badge || flags.provider_context || 'local-file'),
      execution_surface: String(flags.execution_surface || 'local-file-compare'),
      app_surface: String(flags.app_surface || 'local-project'),
      browser_surface: String(flags.browser_surface || 'not-used'),
      control_mode: String(flags.control_mode || 'local-compare'),
      route: 'ueye',
      mode: 'compare',
      url: String(flags.url || ''),
      viewport: String(flags.viewport || ''),
      screenshot_id: String(flags.screenshot_id || path.basename(actualPath)),
      evidence_id: String(flags.evidence_id || `ueye-compare-${timestampId()}`),
      preserved_state: Boolean(flags.preserved_state),
      preserved_url: String(flags.preserved_url || flags.url || ''),
      local_only: true,
      truth_status: truthStatus
    });
    const provenance = buildUeyeVisualProvenance({
      source_kind: 'implementation_screenshot',
      source_path: actualPath,
      source_hash: actualInfo.sha256,
      reference_id: String(flags.reference_id || path.basename(referencePath)),
      screenshot_id: String(flags.screenshot_id || path.basename(actualPath)),
      provider_context: surfaceContext.provider_context,
      provider_badge: surfaceContext.provider_badge,
      execution_surface: surfaceContext.execution_surface,
      app_surface: surfaceContext.app_surface,
      browser_surface: surfaceContext.browser_surface,
      local_only: true,
      redacted: false,
      operator_provided: false,
      comparison_result: comparisonResult,
      truth_status: truthStatus
    });
    const result = {
      schema: 'yam.ueye-compare.v1',
      status: truthStatus,
      comparison_result: comparisonResult,
      exact_match: exactMatch,
      same_dimensions: sameDimensions,
      reference: referenceInfo,
      actual: actualInfo,
      surface_context: surfaceContext,
      visual_evidence: `browser/local screenshot comparison executed: reference=${referencePath}, actual=${actualPath}, result=${comparisonResult}`,
      visual_provenance: provenance,
      proof_hint: `yam proof --route ueye --truth ${truthStatus} --visual "browser/local screenshot comparison executed: ${comparisonResult}" --visual-provenance '${JSON.stringify(provenance)}' --require-visual`
    };
    printJsonOrHuman(result, Boolean(flags.json), 'Ueye compare');
  } catch (error) {
    const result = {
      schema: 'yam.ueye-compare.v1',
      status: 'blocked',
      comparison_result: 'not-verified',
      reason: errorMessage(error),
      visual_cap: 'blocked'
    };
    printJsonOrHuman(result, Boolean(flags.json), 'Ueye compare');
    process.exitCode = 1;
  }
}

async function ueyeReport(args = []) {
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return ueyeUsage();
  const flags = parseSimpleFlags(args, new Set(['reference', 'ref', 'actual', 'screenshot', 'capture-backend', 'compare-backend', 'design-quality', 'blocked-reason', 'next-action', 'next-visual-action', 'review-session-id', 'preflight-id', 'p0-risk', 'quality-gate-note', 'brief-dimension', 'constraint', 'anti-slop', 'invented-metric', 'placeholder-copy', 'generic-visual', 'acceptance-criterion', 'touched-file', 'read-file', 'verified-file', 'skipped-check', 'residual-risk', 'stop-condition', 'resume-hint', 'deep-visual-check', 'design-system-evidence', 'implementation-evidence', 'state-check', 'asset-manifest', 'revision-manifest', 'reference-id', 'screenshot-id', 'previous-screenshot-id', 'current-screenshot-id', 'previous-report', 'comparison-notes', 'similar', 'different', 'missing', 'resolved', 'new-finding', 'still-open', 'regression', 'viewport', 'state', 'provider-context', 'provider-badge', 'execution-surface', 'app-surface', 'browser-surface', 'control-mode', 'preserved-state', 'preserved-url', 'url', 'evidence-id', 'completion-claim', 'completion-status', 'gate-mode', 'strict', 'design-score', 'min-design-score', 'p0', 'p1', 'open-p0', 'open-p1', 'states-checked', 'mobile-checked', 'responsive-checked', 'contrast-checked', 'accessibility-checked', 'cta-checked', 'direction-locked', 'reference-read', 'comparison-result', 'json']));
  const reference = String(flags.reference || flags.ref || '');
  const actual = String(flags.actual || flags.screenshot || '');
  const referenceSources = [];
  const implementationSources = [];
  let comparisonResult = 'not-verified';
  let blockedReason = String(flags.blocked_reason || '');
  const reviewSessionId = String(flags.review_session_id || `ueye-${timestampId()}`);
  const previousReport = await readPreviousUeyeReport(flags.previous_report);
  const designBrief = buildUeyeDesignBrief(flags);
  const antiSlopReview = buildUeyeAntiSlopReview(flags);
  const surfaceContext = buildUeyeSurfaceContext({
    provider_context: String(flags.provider_context || 'not-recorded'),
    provider_badge: String(flags.provider_badge || flags.provider_context || 'not-recorded'),
    execution_surface: String(flags.execution_surface || flags.capture_backend || 'not-recorded'),
    app_surface: String(flags.app_surface || 'not-recorded'),
    browser_surface: String(flags.browser_surface || flags.capture_backend || 'not-recorded'),
    control_mode: String(flags.control_mode || 'not-recorded'),
    route: 'ueye',
    mode: 'report',
    url: String(flags.url || flags.preserved_url || ''),
    viewport: String(flags.viewport || ''),
    screenshot_id: String(flags.current_screenshot_id || flags.screenshot_id || ''),
    evidence_id: String(flags.evidence_id || reviewSessionId),
    preserved_state: Boolean(flags.preserved_state),
    preserved_url: String(flags.preserved_url || flags.url || ''),
    local_only: true,
    truth_status: actual ? 'partial' : 'assumed'
  });

  try {
    if (reference) {
      const info = await imageFileInfo(reference);
      referenceSources.push(buildUeyeVisualProvenance({
        source_kind: 'reference_image',
        source_path: info.path,
        source_hash: info.sha256,
        reference_id: String(flags.reference_id || path.basename(info.path)),
        provider_context: surfaceContext.provider_context,
        provider_badge: surfaceContext.provider_badge,
        execution_surface: surfaceContext.execution_surface,
        app_surface: surfaceContext.app_surface,
        browser_surface: surfaceContext.browser_surface,
        local_only: true,
        operator_provided: true,
        comparison_result: 'reference-recorded',
        truth_status: 'partial'
      }));
    }
    if (actual) {
      const info = await imageFileInfo(actual);
      implementationSources.push(buildUeyeVisualProvenance({
        source_kind: 'implementation_screenshot',
        source_path: info.path,
        source_hash: info.sha256,
        reference_id: String(flags.reference_id || referenceSources[0]?.reference_id || ''),
        screenshot_id: String(flags.current_screenshot_id || flags.screenshot_id || path.basename(info.path)),
        provider_context: surfaceContext.provider_context,
        provider_badge: surfaceContext.provider_badge,
        execution_surface: surfaceContext.execution_surface,
        app_surface: surfaceContext.app_surface,
        browser_surface: surfaceContext.browser_surface,
        local_only: true,
        operator_provided: false,
        comparison_result: 'implementation-recorded',
        truth_status: 'partial'
      }));
    }
    if (flags.comparison_result) {
      comparisonResult = normalizeUeyeComparisonResult(flags.comparison_result);
    } else if (reference && actual && referenceSources[0]?.source_hash === implementationSources[0]?.source_hash) {
      comparisonResult = 'matched';
    } else if (reference && actual) {
      comparisonResult = 'different';
    }
  } catch (error) {
    blockedReason = errorMessage(error);
  }

  const assetManifest = await optionalUeyeAssetVerification(flags.asset_manifest);
  const revisionHistory = await optionalUeyeRevisionVerification(flags.revision_manifest);
  const doneClaim = ['done', 'complete', 'completed'].includes(String(flags.completion_claim || flags.completion_status || '').toLowerCase());
  if (doneClaim && assetManifest?.truth_status === 'blocked') blockedReason = blockedReason || `asset manifest blocked: ${assetManifest.next_action || 'verification failed'}`;
  if (doneClaim && revisionHistory?.truth_status === 'blocked') blockedReason = blockedReason || `revision history blocked: ${revisionHistory.next_action || 'verification failed'}`;

  const report = buildUeyeRunReport({
    reference_sources: referenceSources,
    implementation_sources: implementationSources,
    surface_context: {
      ...surfaceContext,
      screenshot_id: surfaceContext.screenshot_id || String(flags.current_screenshot_id || flags.screenshot_id || implementationSources[0]?.screenshot_id || ''),
      truth_status: blockedReason ? 'blocked' : implementationSources.length ? 'partial' : 'assumed'
    },
    comparison_result: comparisonResult,
    design_quality: String(flags.design_quality || 'not-checked'),
    design_completion_gate: {
      mode: flags.strict || flags.gate_mode === 'strict' ? 'strict' : 'fast',
      completion_claim: flags.completion_claim || flags.completion_status || 'draft',
      design_score: numberOrNull(flags.design_score),
      min_design_score: numberOrNull(flags.min_design_score) ?? 8,
      p0: [...arrayFlag(flags.p0), ...arrayFlag(flags.open_p0), ...arrayFlag(flags.p0_risk), ...antiSlopReview.blockers],
      p1: [...arrayFlag(flags.p1), ...arrayFlag(flags.open_p1)],
      states_checked: Boolean(flags.states_checked),
      mobile_checked: Boolean(flags.mobile_checked),
      responsive_checked: Boolean(flags.responsive_checked),
      contrast_checked: Boolean(flags.contrast_checked),
      accessibility_checked: Boolean(flags.accessibility_checked),
      cta_checked: Boolean(flags.cta_checked),
      direction_locked: Boolean(flags.direction_locked),
      reference_read: Boolean(flags.reference_read)
    },
    deep_visual_review: {
      acceptance_criteria: arrayFlag(flags.acceptance_criterion),
      touched_files: arrayFlag(flags.touched_file),
      read_files: arrayFlag(flags.read_file),
      verified_files: arrayFlag(flags.verified_file),
      skipped_checks: arrayFlag(flags.skipped_check),
      residual_risks: arrayFlag(flags.residual_risk),
      stop_condition: String(flags.stop_condition || ''),
      resume_hint: String(flags.resume_hint || ''),
      deep_visual_checks: arrayFlag(flags.deep_visual_check),
      design_system_evidence: arrayFlag(flags.design_system_evidence),
      implementation_evidence: arrayFlag(flags.implementation_evidence),
      state_check: arrayFlag(flags.state_check)
    },
    blocked_reason: blockedReason,
    next_action: String(flags.next_visual_action || flags.next_action || '')
  });
  const comparisonReport = buildUeyeComparisonReport({
    reviewSessionId,
    previousReport,
    referenceSources,
    implementationSources,
    surfaceContext: report.surface_context,
    designCompletionGate: report.design_completion_gate,
    comparisonResult,
    designQuality: String(flags.design_quality || 'not-checked'),
    similar: arrayFlag(flags.similar),
    different: arrayFlag(flags.different),
    missing: arrayFlag(flags.missing),
    notes: arrayFlag(flags.comparison_notes),
    resolved: arrayFlag(flags.resolved),
    newFindings: arrayFlag(flags.new_finding),
    stillOpen: arrayFlag(flags.still_open),
    regressions: arrayFlag(flags.regression),
    previousScreenshotId: String(flags.previous_screenshot_id || previousReport?.screenshot_id || ''),
    currentScreenshotId: String(flags.current_screenshot_id || flags.screenshot_id || implementationSources[0]?.screenshot_id || ''),
    viewport: String(flags.viewport || ''),
    state: String(flags.state || 'unknown'),
    nextAction: report.next_action,
    truthStatus: report.truth_status
  });
  const result = {
    ...report,
    review_session_id: reviewSessionId,
    design_brief: designBrief,
    anti_slop_review: antiSlopReview,
    preflight: {
      preflight_id: String(flags.preflight_id || ''),
      p0_risks: arrayFlag(flags.p0_risk),
      quality_gate_notes: arrayFlag(flags.quality_gate_note),
      truth_status: flags.preflight_id || flags.p0_risk || flags.quality_gate_note ? 'partial' : 'assumed'
    },
    tool_intent: 'visual',
    capture_backend: String(flags.capture_backend || 'not-recorded'),
    compare_backend: String(flags.compare_backend || 'local-file-hash'),
    continuity: comparisonReport.continuity,
    comparison_report: comparisonReport,
    asset_manifest: assetManifest,
    revision_history: revisionHistory
  };
  printJsonOrHuman(result, Boolean(flags.json), 'Ueye report');
  if (report.truth_status === 'blocked') process.exitCode = 1;
}

async function optionalUeyeAssetVerification(file = '') {
  if (!file) return null;
  try {
    return await verifyUeyeAssetManifest(path.resolve(expandHome(file)));
  } catch (error) {
    return { schema: 'yam.ueye-asset-verification.v1', truth_status: 'blocked', reason: errorMessage(error), next_action: 'repair or recreate the asset manifest before a done claim' };
  }
}

async function optionalUeyeRevisionVerification(file = '') {
  if (!file) return null;
  try {
    return await verifyUeyeRevisionHistory(path.resolve(expandHome(file)));
  } catch (error) {
    return { schema: 'yam.ueye-revision-verification.v1', truth_status: 'blocked', reason: errorMessage(error), next_action: 'repair or recreate the revision manifest before a done claim' };
  }
}

function buildUeyeDesignBrief(flags: AnyRecord = {}) {
  const dimensions = arrayFlag(flags.brief_dimension);
  const constraints = arrayFlag(flags.constraint);
  const hasBrief = dimensions.length || constraints.length;
  return {
    schema: 'yam.ueye-design-brief.v1',
    dimensions,
    constraints,
    source_boundary: hasBrief ? 'operator_provided_cli_flags' : 'not_provided',
    next_action: hasBrief ? 'use this brief as context, not as visual proof' : 'add --brief-dimension and --constraint when design direction matters',
    truth_status: hasBrief ? 'partial' : 'assumed'
  };
}

function buildUeyeAntiSlopReview(flags: AnyRecord = {}) {
  const explicit = arrayFlag(flags.anti_slop);
  const checks = [
    antiSlopCheck('invented_metric', 'Invented metrics or unsupported numeric claims', Boolean(flags.invented_metric), 'replace invented metrics with measured values or remove the claim'),
    antiSlopCheck('placeholder_copy', 'Placeholder copy remains in the UI', Boolean(flags.placeholder_copy), 'replace placeholder copy with product-specific text before claiming done'),
    antiSlopCheck('generic_visual', 'Generic visual treatment does not fit the product context', Boolean(flags.generic_visual), 'tie visuals to the product, state, or reference before claiming design quality')
  ];
  const blockers = [
    ...explicit,
    ...checks.filter((check) => check.status === 'fail').map((check) => `${check.id}: ${check.next_action}`)
  ];
  return {
    schema: 'yam.ueye-anti-slop-review.v1',
    checks,
    blockers,
    next_action: blockers[0] || (checks.some((check) => check.status === 'pass') || explicit.length ? 'anti-slop risks are recorded; keep visual proof separate' : 'record anti-slop risks when they matter before claiming done'),
    truth_status: blockers.length ? 'blocked' : checks.some((check) => check.status === 'pass') || explicit.length ? 'partial' : 'assumed'
  };
}

function antiSlopCheck(id, label, failed = false, nextAction = '') {
  return {
    id,
    label,
    status: failed ? 'fail' : 'not_checked',
    severity: failed ? 'P0' : 'P2',
    next_action: nextAction,
    truth_status: failed ? 'blocked' : 'assumed'
  };
}

async function readPreviousUeyeReport(file = '') {
  const target = String(file || '');
  if (!target) return null;
  try {
    const data = await readJson(path.resolve(expandHome(target)));
    return {
      path: path.resolve(expandHome(target)),
      review_session_id: data.review_session_id || data.comparison_report?.review_session_id || '',
      screenshot_id: data.comparison_report?.current_screenshot_id || data.current_screenshot_id || data.screenshot_id || '',
      truth_status: data.truth_status || data.comparison_report?.truth_status || 'partial',
      comparison_result: data.comparison_result || data.comparison_report?.comparison_result || 'not-verified'
    };
  } catch (error) {
    return {
      path: path.resolve(expandHome(target)),
      blocked_reason: errorMessage(error),
      truth_status: 'blocked',
      comparison_result: 'not-verified'
    };
  }
}

function buildUeyeComparisonReport({
  reviewSessionId,
  previousReport,
  referenceSources,
  implementationSources,
  surfaceContext,
  designCompletionGate,
  comparisonResult,
  designQuality,
  similar,
  different,
  missing,
  notes,
  resolved,
  newFindings,
  stillOpen,
  regressions,
  previousScreenshotId,
  currentScreenshotId,
  viewport,
  state,
  nextAction,
  truthStatus
}) {
  const hasReference = referenceSources.length > 0;
  const hasImplementation = implementationSources.length > 0;
  const continuityTruth = previousReport?.blocked_reason ? 'blocked' : previousReport ? 'partial' : 'assumed';
  return {
    schema: 'yam.ueye-comparison-report.v1',
    review_session_id: reviewSessionId,
    previous_report: previousReport,
    continuity: {
      schema: 'yam.ueye-review-continuity.v1',
      current_review_session_id: reviewSessionId,
      previous_review_session_id: previousReport?.review_session_id || '',
      previous_report_path: previousReport?.path || '',
      previous_screenshot_id: previousScreenshotId || previousReport?.screenshot_id || '',
      current_screenshot_id: currentScreenshotId || '',
      carries_forward: Boolean(previousReport && !previousReport.blocked_reason),
      truth_status: continuityTruth
    },
    evidence_summary: {
      has_reference: hasReference,
      has_implementation_screenshot: hasImplementation,
      reference_count: referenceSources.length,
      implementation_count: implementationSources.length
    },
    surface_context: surfaceContext || buildUeyeSurfaceContext(),
    design_completion_gate: designCompletionGate || null,
    comparison_result: comparisonResult,
    design_quality: designQuality,
    similar,
    different,
    missing,
    resolved,
    new_findings: newFindings,
    still_open: stillOpen,
    regressions,
    previous_screenshot_id: previousScreenshotId || previousReport?.screenshot_id || '',
    current_screenshot_id: currentScreenshotId || '',
    viewport,
    state,
    notes,
    next_action: nextAction || (truthStatus === 'verified' ? 'no action required' : 'capture or provide implementation screenshot, then compare again'),
    truth_status: truthStatus
  };
}

function normalizeUeyeComparisonResult(value = '') {
  const text = String(value || '').toLowerCase();
  if (['matched', 'similar', 'different', 'not-verified', 'not-applicable'].includes(text)) return text;
  return 'not-verified';
}

async function media(args = []) {
  const subcommand = args[0] || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return mediaUsage();
  if (subcommand === 'proof') return mediaProof(args.slice(1));
  console.error(`unknown media command: ${subcommand}`);
  return mediaUsage();
}

function mediaUsage() {
  console.log(`yam media

Opt-in media generation proof helpers. Generated media can support visual direction, but it cannot verify implemented UI without implementation screenshot evidence.

Usage:
  yam media proof [--tool name] [--requested] [--attempted] [--output file] [--wait-loop] [--blocked-reason text] [--json]
`);
}

async function mediaProof(args = []) {
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return mediaUsage();
  const flags = parseSimpleFlags(args, new Set(['tool', 'requested', 'attempted', 'output', 'wait-loop', 'blocked-reason', 'next-action', 'json']));
  const output = String(flags.output || '');
  let outputHash = 'unknown';
  let outputPath = '';
  let blockedReason = String(flags.blocked_reason || '');
  if (output) {
    try {
      const info = await imageFileInfo(output);
      outputHash = info.sha256;
      outputPath = info.path;
    } catch (error) {
      blockedReason = blockedReason || errorMessage(error);
      outputPath = path.resolve(expandHome(output));
    }
  }
  const proof = buildMediaGenerationProof({
    tool_name: String(flags.tool || ''),
    generation_requested: Boolean(flags.requested),
    generation_attempted: Boolean(flags.attempted || output),
    output_path: outputPath,
    output_hash: outputHash,
    wait_loop_checked: Boolean(flags.wait_loop),
    blocked_reason: blockedReason,
    next_action: String(flags.next_action || '')
  });
  printJsonOrHuman(proof, Boolean(flags.json), 'Media proof');
  if (proof.truth_status === 'blocked') process.exitCode = 1;
}

async function runtime(args = []) {
  const subcommand = args[0] || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return runtimeUsage();
  if (subcommand === 'evidence') return runtimeEvidence(args.slice(1));
  console.error(`unknown runtime command: ${subcommand}`);
  return runtimeUsage();
}

function runtimeUsage() {
  console.log(`yam runtime

Usage:
  yam runtime evidence [--backend terminal|in-app-browser|playwright|tmux|zellij] [--claim observed|started|stopped|cleanup-verified] [--evidence-id id] [--command text] [--pid n] [--port n] [--url URL] [--exit-code n] [--screenshot-id id] [--started-at time] [--stopped-at time] [--cleanup-method text] [--cleanup-observed] [--left-running-intentionally] [--cleanup-checked] [--note text] [--json]

Notes:
  Records a small runtime evidence shape. It does not start, stop, or inspect processes by itself.
`);
}

async function runtimeEvidence(args = []) {
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return runtimeUsage();
  const flags = parseSimpleFlags(args, new Set(['backend', 'claim', 'evidence-id', 'command', 'pid', 'port', 'url', 'exit-code', 'screenshot-id', 'started-at', 'stopped-at', 'cleanup-method', 'cleanup-observed', 'left-running-intentionally', 'cleanup-checked', 'note', 'truth', 'intent', 'json']));
  const evidence = buildRuntimeBackendEvidence({
    backend: flags.backend,
    claim: flags.claim,
    evidence_id: String(flags.evidence_id || `runtime-${timestampId()}`),
    command: String(flags.command || ''),
    cleanup_checked: Boolean(flags.cleanup_checked),
    started_at: String(flags.started_at || ''),
    stopped_at: String(flags.stopped_at || ''),
    exit_code: numberOrNull(flags.exit_code),
    pid: numberOrNull(flags.pid),
    port: numberOrNull(flags.port),
    cleanup_method: String(flags.cleanup_method || ''),
    cleanup_observed: Boolean(flags.cleanup_observed),
    left_running_intentionally: Boolean(flags.left_running_intentionally),
    note: String(flags.note || ''),
    truth_status: isTruthStatus(flags.truth) ? flags.truth : undefined
  });
  const runtimeDetails = runtimeEvidenceDetails(flags);
  if (!isTruthStatus(flags.truth) && evidence.truth_status === 'verified' && !runtimeDetailsHasVerification(runtimeDetails)) {
    evidence.truth_status = 'partial';
  }
  const result = {
    ...evidence,
    runtime_details: runtimeDetails,
    tool_intent: normalizeToolIntent(flags.intent || 'runtime'),
    next_action: runtimeEvidenceNextAction(evidence)
  };
  printJsonOrHuman(result, Boolean(flags.json), 'Runtime evidence');
  if (result.truth_status === 'blocked' || result.truth_status === 'real_required_missing') process.exitCode = 1;
}

function runtimeEvidenceDetails(flags: AnyRecord = {}) {
  return {
    schema: 'yam.runtime-details.v1',
    pid: numberOrNull(flags.pid),
    port: numberOrNull(flags.port),
    url: String(flags.url || ''),
    exit_code: numberOrNull(flags.exit_code),
    screenshot_id: String(flags.screenshot_id || ''),
    started_at: String(flags.started_at || ''),
    stopped_at: String(flags.stopped_at || ''),
    cleanup_method: String(flags.cleanup_method || ''),
    cleanup_observed: Boolean(flags.cleanup_observed),
    left_running_intentionally: Boolean(flags.left_running_intentionally)
  };
}

function runtimeDetailsHasVerification(details: AnyRecord = {}) {
  return Boolean(details.url || details.screenshot_id || details.pid !== null || details.port !== null || details.exit_code !== null || details.started_at || details.stopped_at || details.cleanup_method || details.cleanup_observed || details.left_running_intentionally);
}

function runtimeEvidenceNextAction(evidence) {
  if (evidence.truth_status === 'proven' || evidence.truth_status === 'verified') return 'attach this evidence to `yam proof` when making a runtime claim';
  if (evidence.claim === 'cleanup_verified' && !evidence.cleanup_observed && !evidence.left_running_intentionally) return 'rerun with --cleanup-observed plus exit/closure evidence, or record --left-running-intentionally';
  if (evidence.backend === 'none' || evidence.backend === 'unknown') return 'record the actual runtime backend before claiming runtime verification';
  return 'add command output, screenshot id, pid/session id, or cleanup proof before upgrading the claim';
}

async function mission(args = []) {
  const subcommand = args[0] || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return missionUsage();
  if (subcommand === 'queue' || subcommand === 'patch') return missionQueue(args.slice(1));
  if (subcommand === 'receipt') return missionReceipt(args.slice(1));
  if (subcommand === 'gate' || subcommand === 'close') return missionGate(args.slice(1));
  console.error(`unknown mission command: ${subcommand}`);
  return missionUsage();
}

function missionUsage() {
  console.log(`yam mission

Usage:
  yam mission queue [--lane-id id] [--agent-id id] [--status pending|applied|verified|blocked|reverted] [--scope text] [--changed file] [--depends-on lane] [--generated file] [--verification-hint text] [--rollback-hint text] [--before-check text] [--out file] [--truth status] [--json]
  yam mission receipt --thread-id id --role implementer|reviewer|ux-verifier|doctor --lifecycle pending|running|stopped|failed|cancelled --outcome passed|failed|blocked|ambiguous [--access-mode read-only|write] [--scope text] [--changed file] [--evidence text] [--remaining-risk text] [--out file] [--json]
  yam mission gate --expected-thread id --receipt file [--expected-thread id --receipt file] [--out file] [--json]

Notes:
  Produces a patch queue item for mission handoff/review. It does not run workers; persistence is opt-in with --out.
  Reviewer and doctor receipts default to read-only and are blocked if they claim changed files or write access.
  A stopped lifecycle is not success by itself; a passed outcome needs explicit verification evidence.
`);
}

async function missionReceipt(args = []) {
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return missionUsage();
  const flags = parseSimpleFlags(args, new Set(['receipt-id', 'thread-id', 'lane-id', 'agent-id', 'role', 'access-mode', 'lifecycle', 'outcome', 'scope', 'changed', 'evidence', 'remaining-risk', 'out', 'json']));
  const receipt = buildMissionSubagentReceipt({
    receipt_id: String(flags.receipt_id || `receipt-${timestampId()}`),
    thread_id: String(flags.thread_id || ''),
    lane_id: String(flags.lane_id || flags.thread_id || ''),
    agent_id: String(flags.agent_id || ''),
    role: flags.role,
    access_mode: flags.access_mode,
    lifecycle_status: flags.lifecycle,
    outcome: flags.outcome,
    assigned_scope: String(flags.scope || ''),
    changed_files: arrayFlag(flags.changed),
    verification_evidence: arrayFlag(flags.evidence),
    remaining_risks: arrayFlag(flags.remaining_risk)
  });
  const result = {
    ...receipt,
    persistence: flags.out ? 'written' : 'not-persisted',
    out: flags.out ? path.resolve(expandHome(flags.out)) : '',
    next_action: receipt.completion_eligible ? 'include this receipt in `yam mission gate`' : receipt.blockers[0] || 'complete the receipt evidence'
  };
  if (flags.out) await writeJsonArtifact(flags.out, result);
  printJsonOrHuman(result, Boolean(flags.json), 'Mission receipt');
  if (receipt.truth_status === 'blocked') process.exitCode = 1;
}

async function missionGate(args = []) {
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return missionUsage();
  const flags = parseSimpleFlags(args, new Set(['expected-thread', 'receipt', 'out', 'json']));
  const receipts = [];
  const loadErrors: string[] = [];
  for (const file of arrayFlag(flags.receipt)) {
    const target = path.resolve(expandHome(file));
    try {
      receipts.push(await readJson(target));
    } catch (error) {
      loadErrors.push(`${target}: ${errorMessage(error)}`);
    }
  }
  const gate = buildMissionCompletionGate({
    expected_thread_ids: arrayFlag(flags.expected_thread),
    receipts
  });
  const blockers = [...gate.blockers, ...loadErrors.map((error) => `receipt_load_failed: ${error}`)];
  const result = {
    ...gate,
    blockers,
    ready_to_claim_complete: gate.ready_to_claim_complete && loadErrors.length === 0,
    next_action: blockers[0] || gate.next_action,
    truth_status: blockers.length ? 'blocked' : gate.truth_status,
    persistence: flags.out ? 'written' : 'not-persisted',
    out: flags.out ? path.resolve(expandHome(flags.out)) : ''
  };
  if (flags.out) await writeJsonArtifact(flags.out, result);
  printJsonOrHuman(result, Boolean(flags.json), 'Mission completion gate');
  if (result.truth_status === 'blocked') process.exitCode = 1;
}

async function missionQueue(args = []) {
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return missionUsage();
  const flags = parseSimpleFlags(args, new Set(['lane-id', 'agent-id', 'status', 'scope', 'changed', 'generated', 'depends-on', 'verification-hint', 'rollback-hint', 'before-check', 'safe-revert-note', 'truth', 'intent', 'out', 'json']));
  const changedFiles = arrayFlag(flags.changed);
  const generatedFiles = arrayFlag(flags.generated);
  const laneId = String(flags.lane_id || flags.agent_id || `lane-${timestampId()}`);
  const status = normalizeMissionQueueStatus(flags.status || 'pending');
  const rollback = buildRollbackHint({
    touched_files: changedFiles,
    generated_files: generatedFiles,
    before_check: String(flags.before_check || ''),
    safe_revert_note: String(flags.safe_revert_note || flags.rollback_hint || '')
  });
  const envelope = buildMissionPatchEnvelope({
    agent_id: String(flags.agent_id || `agent-${timestampId()}`),
    assigned_scope: String(flags.scope || ''),
    changed_files: changedFiles,
    verification_hint: String(flags.verification_hint || ''),
    rollback_hint: rollback,
    truth_status: isTruthStatus(flags.truth) ? flags.truth : changedFiles.length ? 'partial' : 'assumed'
  });
  const item = {
    schema: 'yam.mission-patch-queue-item.v1',
    lane_id: laneId,
    status,
    depends_on: arrayFlag(flags.depends_on),
    tool_intent: normalizeToolIntent(flags.intent || (changedFiles.length || generatedFiles.length ? 'write' : 'read_only')),
    patch_envelope: envelope,
    next_action: missionQueueNextAction(envelope, status)
  };
  const result = {
    schema: 'yam.mission-patch-queue-lite.v1',
    generated_at: new Date().toISOString(),
    persistence: flags.out ? 'written' : 'not-persisted',
    out: flags.out ? path.resolve(expandHome(flags.out)) : '',
    items: [item],
    queue_depth: 1,
    next_action: item.next_action,
    truth_status: envelope.truth_status
  };
  if (flags.out) {
    const target = path.resolve(expandHome(flags.out));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, `${JSON.stringify(result, null, 2)}\n`);
  }
  printJsonOrHuman(result, Boolean(flags.json), 'Mission patch queue');
}

function normalizeMissionQueueStatus(value = '') {
  const text = String(value || '').toLowerCase();
  if (['pending', 'applied', 'verified', 'blocked', 'reverted'].includes(text)) return text;
  return 'pending';
}

function missionQueueNextAction(envelope, status = 'pending') {
  if (status === 'blocked') return 'resolve or document the blocker before applying dependent mission lanes';
  if (status === 'reverted') return 'rerun the before-check or verification hint before continuing dependent work';
  if (!envelope.assigned_scope) return 'add --scope so the patch can be reviewed against an assigned boundary';
  if (!envelope.changed_files.length) return 'add at least one --changed file when this represents code-changing work';
  if (!envelope.verification_hint) return 'add --verification-hint so reviewers know the smallest honest check';
  if (!envelope.rollback_hint.safe_revert_note && !envelope.rollback_hint.before_check) return 'add rollback or before-check detail before using this for risky work';
  return 'attach this envelope to the mission proof summary and cross-check changed files';
}

async function benchmark(args = []) {
  const subcommand = args[0] || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return benchmarkUsage();
  if (subcommand === 'report') return benchmarkReport(args.slice(1));
  console.error(`unknown benchmark command: ${subcommand}`);
  return benchmarkUsage();
}

function benchmarkUsage() {
  console.log(`yam benchmark

Usage:
  yam benchmark report [--label text] [--baseline n] [--current n] [--unit ms] [--target lower|higher] [--next-action text] [--json]

Notes:
  Records a small optimization loop result. It does not run benchmarks by itself.
`);
}

async function benchmarkReport(args = []) {
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return benchmarkUsage();
  const flags = parseSimpleFlags(args, new Set(['label', 'baseline', 'current', 'unit', 'target', 'next-action', 'rollback-hint', 'intent', 'json']));
  const baseline = numberOrNull(flags.baseline);
  const current = numberOrNull(flags.current);
  const target = String(flags.target || 'lower').toLowerCase() === 'higher' ? 'higher' : 'lower';
  const hasNumbers = baseline !== null && current !== null;
  const delta = hasNumbers ? current - baseline : null;
  const percent = hasNumbers && baseline !== 0 ? (delta / baseline) * 100 : null;
  const status = benchmarkStatus({ baseline, current, target });
  const result = {
    schema: 'yam.benchmark-report.v1',
    generated_at: new Date().toISOString(),
    label: String(flags.label || 'unnamed'),
    baseline,
    current,
    unit: String(flags.unit || ''),
    target,
    delta,
    percent,
    status,
    tool_intent: normalizeToolIntent(flags.intent || 'read_only'),
    rollback_hint: String(flags.rollback_hint || (status === 'regressed' ? 'inspect the optimization patch and revert the touched surface if the regression is confirmed' : 'no rollback action recorded')),
    next_action: String(flags.next_action || benchmarkNextAction(status)),
    truth_status: hasNumbers ? 'verified' : 'partial'
  };
  printJsonOrHuman(result, Boolean(flags.json), 'Benchmark report');
  if (status === 'regressed') process.exitCode = 1;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function benchmarkStatus({ baseline, current, target }) {
  if (baseline === null || current === null) return 'needs-baseline';
  if (current === baseline) return 'unchanged';
  if (target === 'higher') return current > baseline ? 'improved' : 'regressed';
  return current < baseline ? 'improved' : 'regressed';
}

function benchmarkNextAction(status) {
  if (status === 'improved') return 'record the measurement source and keep the smallest relevant regression check';
  if (status === 'regressed') return 'treat this as a fix-first item before continuing planned optimization';
  if (status === 'unchanged') return 'keep the change only if it improves clarity or enables the next measured step';
  return 'capture baseline and current values before claiming optimization impact';
}

function parseSimpleFlags(args = [], allowed = new Set<string>()) {
  const flags: AnyRecord = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || '');
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const [rawKey, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const key = rawKey.slice(2);
    if (allowed.size && !allowed.has(key)) continue;
    const normalizedKey = key.replace(/-/g, '_');
    if (['json', 'full-page', 'requested', 'attempted', 'available', 'wait-loop', 'cleanup-checked', 'cleanup-observed', 'left-running-intentionally', 'strict', 'preserved-state', 'states-checked', 'mobile-checked', 'responsive-checked', 'contrast-checked', 'accessibility-checked', 'cta-checked', 'direction-locked', 'reference-read', 'invented-metric', 'placeholder-copy', 'generic-visual', 'operator-provided', 'do-not-replace', 'allowed-for-edit', 'replace'].includes(key)) {
      flags[normalizedKey] = true;
      continue;
    }
    const value = inlineValue ?? args[index + 1] ?? '';
    if (inlineValue === undefined) index += 1;
    if (flags[normalizedKey] !== undefined) {
      flags[normalizedKey] = [...arrayFlag(flags[normalizedKey]), value];
    } else {
      flags[normalizedKey] = value;
    }
  }
  flags._ = positionals;
  return flags;
}

function parseViewport(value = '1440x900') {
  const match = String(value || '').match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!match) return { width: 1440, height: 900 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function loadOptionalPlaywright() {
  let projectError = '';
  try {
    const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
    return projectRequire('playwright');
  } catch (error) {
    projectError = errorMessage(error);
    // Fall through to the yam package context for local development or bundled installs.
  }
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
  try {
    return await dynamicImport('playwright');
  } catch (error) {
    throw new Error(`Playwright not found from current project or yam package context. Current project: ${projectError}; package context: ${errorMessage(error)}`);
  }
}

async function imageFileInfo(file) {
  return inspectImageFile(path.resolve(expandHome(file)));
}

function printJsonOrHuman(result, json = false, label = 'yam') {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(label);
  for (const [key, value] of Object.entries(result)) {
    if (key === 'schema') continue;
    if (typeof value === 'object' && value !== null) {
      console.log(`- ${key}: ${JSON.stringify(value)}`);
    } else {
      console.log(`- ${key}: ${value}`);
    }
  }
}

async function writeJsonArtifact(file, value) {
  const target = path.resolve(expandHome(file));
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function detectDbSafetyText(text = '') {
  return detectTrustDbSafetyText(text);
}

function printSafetyResult(result) {
  console.log('DB/Supabase safety lite');
  console.log(`Status: ${result.hits.length ? 'risk detected' : 'no destructive DB pattern detected'}`);
  console.log(`Recommended route: ${result.recommendation}`);
  console.log(`Truth status: ${result.truth} (text-pattern scan only)`);
  if (result.hits.length) {
    console.log('');
    console.log('Hits:');
    for (const hit of result.hits) console.log(`- ${hit.level}: ${hit.reason}`);
    console.log('');
    console.log('Guardrail: require explicit user approval, confirm target environment, prefer read-only inspection first, and avoid claiming safe without evidence.');
  }
}

async function proof(args = []) {
  if (args[0] === 'write') return proofWrite(args.slice(1));
  const parsed = parseProofArgs(args);
  const artifact = await readProofArtifact(parsed.flags.from, parsed.dir);
  const summary = buildProofSummary(parsed, artifact);
  if (!summary) return;

  if (parsed.flags.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('yam proof summary');
  console.log(`- Route: ${summary.route}`);
  console.log(`- Goal: ${summary.goal || '(not supplied)'}`);
  console.log(`- Source: ${summary.source || '(no artifact found; flags/template only)'}`);
  console.log(`- Truth status: ${summary.truth}`);
  if (summary.requestedTruth && summary.requestedTruth !== summary.truth) console.log(`- Requested truth: ${summary.requestedTruth}`);
  printProofList('Commands', summary.commands);
  printProofList('Evidence', summary.evidence);
  printProofList('Visual evidence', summary.visual);
  printProofList('Runtime evidence', summary.runtime);
  printProofList('Runtime backend evidence', summary.runtimeBackendEvidence || []);
  printProofList('Visual provenance', summary.visualProvenance || []);
  printProofList('Mission patch envelope', summary.missionEnvelope || []);
  printProofList('Mission subagent receipt', summary.missionReceipt || []);
  printProofList('Mission completion gate', summary.missionCompletion || []);
  printProofList('Rollback hint', summary.rollbackHint || []);
  printProofList('Media proof', summary.mediaProof || []);
  printProofList('Design completion', summary.designCompletion || []);
  printProofList('Changed surfaces', summary.changed);
  printProofList('Skipped', summary.skipped);
  printProofList('Blocked', summary.blocked);
  printProofList('Assumptions', summary.assumptions);
  printProofList('Unverified', summary.unverified || []);
  printProofList('Truth caps', summary.truthCaps || []);
  console.log(`- Cleanup: ${summary.cleanup || '(not supplied)'}`);
  console.log(`- Fake/real policy: ${summary.fakeReal?.proof_level || 'assumed'} (${summary.fakeReal?.ok ? 'ok' : 'needs attention'})`);
  if (summary.runtimeTruth?.rows?.length) {
    console.log('- Runtime truth matrix:');
    for (const row of summary.runtimeTruth.rows) {
      console.log(`  - ${row.subsystem}: ${row.proof_level}${row.required ? ' (required)' : ''}`);
    }
  }
  if (!hasProofEvidence(parsed) && !artifact.path) {
    console.log('');
    console.log('Note: no proof artifact or evidence flags were supplied, so this is a proof template, not verification.');
  }
}

async function proofWrite(args = []) {
  const parsed = parseProofArgs(args);
  const artifact = parsed.flags.from ? await readProofArtifact(parsed.flags.from, parsed.dir) : emptyProofArtifact();
  const summary = buildProofSummary(parsed, artifact);
  if (!summary) return;
  const format = String(parsed.flags.format || '').toLowerCase();
  const target = proofWriteTarget(parsed, format);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  if (target.endsWith('.md') || format === 'md' || format === 'markdown') {
    await fsp.writeFile(target, renderProofMarkdown(summary));
  } else {
    await fsp.writeFile(target, `${JSON.stringify({
      schemaVersion: 1,
      writtenAt: new Date().toISOString(),
      ...summary
    }, null, 2)}\n`);
  }
  console.log(`proof written: ${target}`);
  console.log(`truth status: ${summary.truth}`);
}

function proofWriteTarget(parsed, format = '') {
  const explicit = parsed.flags.out || parsed.flags.file;
  if (explicit) return path.resolve(expandHome(explicit));
  const dir = path.resolve(parsed.dir || process.cwd());
  const extension = format === 'md' || format === 'markdown' ? 'md' : 'json';
  return path.join(dir, '.yam', `proof.${extension}`);
}

function buildProofSummary(parsed, artifact) {
  const requestedTruth = parsed.flags.truth || '';
  let truth = requestedTruth || artifact.truth || (hasProofEvidence(parsed) || artifact.path ? 'partial' : 'assumed');
  if (!isTruthStatus(truth) && !requestedTruth) truth = 'partial';
  if (!isTruthStatus(truth)) {
    console.error(`invalid truth status: ${truth}`);
    console.error(`allowed: ${TRUTH_STATUSES.join(', ')}`);
    process.exitCode = 1;
    return null;
  }
  const secretHit = findSensitivePattern(Object.values(parsed.flags).flat().join('\n'));
  if (secretHit) {
    console.error(`proof blocked: possible secret pattern detected (${secretHit})`);
    process.exitCode = 1;
    return null;
  }
  const rawSummary = {
    route: parsed.flags.route || artifact.route || 'unspecified',
    goal: parsed.flags.goal || artifact.goal || '',
    truth,
    source: artifact.path || '',
    commands: [...artifact.commands, ...arrayFlag(parsed.flags.command)],
    evidence: [...artifact.evidence, ...arrayFlag(parsed.flags.evidence)],
    visual: [...artifact.visual, ...arrayFlag(parsed.flags.visual)],
    runtime: [...artifact.runtime, ...arrayFlag(parsed.flags.runtime)],
    runtimeBackendEvidence: [
      ...structuredEvidenceList(artifact.runtimeBackendEvidence),
      ...structuredEvidenceList(parsed.flags.runtime_backend_evidence),
      ...directRuntimeBackendEvidence(parsed.flags)
    ],
    visualProvenance: [
      ...structuredEvidenceList(artifact.visualProvenance),
      ...structuredEvidenceList(parsed.flags.visual_provenance)
    ],
    missionEnvelope: [
      ...structuredEvidenceList(artifact.missionEnvelope),
      ...structuredEvidenceList(parsed.flags.mission_envelope)
    ],
    missionReceipt: [
      ...structuredEvidenceList(artifact.missionReceipt),
      ...structuredEvidenceList(parsed.flags.mission_receipt)
    ],
    missionCompletion: [
      ...structuredEvidenceList(artifact.missionCompletion),
      ...structuredEvidenceList(parsed.flags.mission_completion)
    ],
    rollbackHint: [
      ...structuredEvidenceList(artifact.rollbackHint),
      ...structuredEvidenceList(parsed.flags.rollback_hint)
    ],
    mediaProof: [
      ...structuredEvidenceList(artifact.mediaProof),
      ...structuredEvidenceList(parsed.flags.media_proof)
    ],
    designCompletion: [
      ...structuredEvidenceList(artifact.designCompletion),
      ...structuredEvidenceList(parsed.flags.design_completion)
    ],
    cleanup: parsed.flags.cleanup || artifact.cleanup || '',
    changed: [...artifact.changed, ...arrayFlag(parsed.flags.changed)],
    skipped: [...artifact.skipped, ...arrayFlag(parsed.flags.skipped)],
    blocked: [...artifact.blocked, ...arrayFlag(parsed.flags.blocked)],
    assumptions: [...artifact.assumptions, ...arrayFlag(parsed.flags.assumed || parsed.flags.assumption)],
    unverified: [...arrayFlag(artifact.unverified), ...arrayFlag(parsed.flags.unverified)]
  };
  const completionProof = buildYamCompletionProof(rawSummary, {
    requireRealRuntime: Boolean(parsed.flags.require_runtime || parsed.flags.require_real_runtime),
    requireTmux: Boolean(parsed.flags.require_tmux),
    requireVisual: Boolean(parsed.flags.require_visual)
  });
  return {
    ...rawSummary,
    truth: completionProof.truth,
    requestedTruth: completionProof.requestedTruth,
    blocked: completionProof.blocked,
    unverified: completionProof.unverified,
    truthCaps: completionProof.truthCaps,
    evidenceRows: completionProof.evidenceRows,
    fakeReal: completionProof.fakeReal,
    runtimeTruth: completionProof.runtimeTruth,
    completionProof
  };
}

function renderProofMarkdown(summary) {
  const lines = [
    '# yam Proof',
    '',
    `- Route: ${summary.route}`,
    `- Goal: ${summary.goal || ''}`,
    `- Truth status: ${summary.truth}`,
    `- Requested truth: ${summary.requestedTruth || summary.truth}`,
    `- Source: ${summary.source || ''}`,
    `- Cleanup: ${summary.cleanup || ''}`,
    `- Fake/real policy: ${summary.fakeReal?.proof_level || 'assumed'}`,
    '',
    '## Commands',
    ...renderProofMarkdownList(summary.commands),
    '',
    '## Evidence',
    ...renderProofMarkdownList(summary.evidence),
    '',
    '## Visual evidence',
    ...renderProofMarkdownList(summary.visual),
    '',
    '## Runtime evidence',
    ...renderProofMarkdownList(summary.runtime),
    '',
    '## Runtime backend evidence',
    ...renderProofMarkdownList(summary.runtimeBackendEvidence || []),
    '',
    '## Visual provenance',
    ...renderProofMarkdownList(summary.visualProvenance || []),
    '',
    '## Mission patch envelope',
    ...renderProofMarkdownList(summary.missionEnvelope || []),
    '',
    '## Mission subagent receipt',
    ...renderProofMarkdownList(summary.missionReceipt || []),
    '',
    '## Mission completion gate',
    ...renderProofMarkdownList(summary.missionCompletion || []),
    '',
    '## Rollback hint',
    ...renderProofMarkdownList(summary.rollbackHint || []),
    '',
    '## Media proof',
    ...renderProofMarkdownList(summary.mediaProof || []),
    '',
    '## Design completion',
    ...renderProofMarkdownList(summary.designCompletion || []),
    '',
    '## Changed surfaces',
    ...renderProofMarkdownList(summary.changed),
    '',
    '## Skipped',
    ...renderProofMarkdownList(summary.skipped),
    '',
    '## Blocked',
    ...renderProofMarkdownList(summary.blocked),
    '',
    '## Assumptions',
    ...renderProofMarkdownList(summary.assumptions),
    '',
    '## Unverified',
    ...renderProofMarkdownList(summary.unverified || []),
    '',
    '## Truth caps',
    ...renderProofMarkdownList(summary.truthCaps || []),
    '',
    '## Runtime truth matrix',
    ...renderProofMarkdownList((summary.runtimeTruth?.rows || []).map((row) => `${row.subsystem}: ${row.proof_level}${row.required ? ' (required)' : ''}`)),
    ''
  ];
  return lines.join('\n');
}

function renderProofMarkdownList(values) {
  return values.length ? values.map((value) => `- ${value}`) : ['-'];
}

function parseProofArgs(args = []) {
  const flags: AnyRecord = {};
  const positionals: string[] = [];
  const aliases = new Set(['goal', 'route', 'truth', 'command', 'evidence', 'visual', 'runtime', 'runtime-backend', 'runtime-claim', 'runtime-evidence-id', 'runtime-command', 'runtime-pid', 'runtime-port', 'runtime-exit-code', 'runtime-started-at', 'runtime-stopped-at', 'runtime-cleanup-method', 'cleanup-observed', 'left-running-intentionally', 'cleanup-checked', 'runtime-note', 'runtime-backend-evidence', 'visual-provenance', 'mission-envelope', 'mission-receipt', 'mission-completion', 'rollback-hint', 'media-proof', 'design-completion', 'cleanup', 'changed', 'skipped', 'blocked', 'assumed', 'assumption', 'unverified', 'from', 'format', 'out', 'file', 'json', 'require-runtime', 'require-real-runtime', 'require-tmux', 'require-visual']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      const [rawKey, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
      const key = rawKey.slice(2);
      if (!aliases.has(key)) continue;
      const normalizedKey = key.replace(/-/g, '_');
      if (key === 'json' || key.startsWith('require-') || key === 'cleanup-checked' || key === 'cleanup-observed' || key === 'left-running-intentionally') {
        flags[normalizedKey] = true;
        continue;
      }
      const value = inlineValue ?? args[index + 1] ?? '';
      if (inlineValue === undefined) index += 1;
      if (['command', 'evidence', 'visual', 'runtime', 'runtime-backend-evidence', 'visual-provenance', 'mission-envelope', 'mission-receipt', 'mission-completion', 'rollback-hint', 'media-proof', 'design-completion', 'changed', 'skipped', 'blocked', 'assumed', 'assumption', 'unverified'].includes(key)) {
        flags[normalizedKey] = [...arrayFlag(flags[normalizedKey]), value];
      } else {
        flags[normalizedKey] = value;
      }
      continue;
    }
    positionals.push(arg);
  }
  const dir = positionals.find(looksLikeDirectoryArg) || process.cwd();
  return { flags, dir };
}

async function readProofArtifact(explicitFile = '', targetDir = process.cwd()) {
  const empty = emptyProofArtifact();
  const candidates = explicitFile ? [expandHome(explicitFile)] : [
    path.join(path.resolve(targetDir), '.yam', 'proof.json'),
    path.join(path.resolve(targetDir), '.yam', 'proof.md'),
    path.join(path.resolve(targetDir), '.yam', 'runtime-proof.md')
  ];
  for (const candidate of candidates) {
    if (!await exists(candidate)) continue;
    if (candidate.endsWith('.json')) return parseProofJson(candidate, empty);
    return parseProofMarkdown(candidate, empty);
  }
  return empty;
}

function emptyProofArtifact() {
  return {
    path: '',
    route: '',
    goal: '',
    truth: '',
    commands: [],
    evidence: [],
    visual: [],
    runtime: [],
    runtimeBackendEvidence: [],
    visualProvenance: [],
    missionEnvelope: [],
    missionReceipt: [],
    missionCompletion: [],
    rollbackHint: [],
    mediaProof: [],
    designCompletion: [],
    cleanup: '',
    changed: [],
    skipped: [],
    blocked: [],
    assumptions: [],
    unverified: []
  };
}

async function parseProofJson(file, empty) {
  try {
    const data = await readJson(file);
    return {
      ...empty,
      path: file,
      route: String(data.route || ''),
      goal: String(data.goal || data.mission || ''),
      truth: String(data.truth || data.truthStatus || data.status || ''),
      commands: arrayFlag(data.commands || data.command),
      evidence: arrayFlag(data.evidence),
      visual: arrayFlag(data.visual || data.visualEvidence),
      runtime: arrayFlag(data.runtime || data.runtimeEvidence),
      runtimeBackendEvidence: structuredEvidenceList(data.runtimeBackendEvidence || data.runtime_backend_evidence),
      visualProvenance: structuredEvidenceList(data.visualProvenance || data.visual_provenance),
      missionEnvelope: structuredEvidenceList(data.missionEnvelope || data.mission_envelope),
      missionReceipt: structuredEvidenceList(data.missionReceipt || data.mission_receipt),
      missionCompletion: structuredEvidenceList(data.missionCompletion || data.mission_completion),
      rollbackHint: structuredEvidenceList(data.rollbackHint || data.rollback_hint),
      mediaProof: structuredEvidenceList(data.mediaProof || data.media_proof),
      designCompletion: structuredEvidenceList(data.designCompletion || data.design_completion),
      cleanup: String(data.cleanup || data.cleanupStatus || ''),
      changed: arrayFlag(data.changed || data.files),
      skipped: arrayFlag(data.skipped),
      blocked: arrayFlag(data.blocked),
      assumptions: arrayFlag(data.assumptions || data.assumed),
      unverified: arrayFlag(data.unverified)
    };
  } catch (error) {
    return { ...empty, path: file, blocked: [`Could not parse JSON proof: ${errorMessage(error)}`], truth: 'blocked' };
  }
}

async function parseProofMarkdown(file, empty) {
  const text = await readText(file);
  const finalTruth = firstProofList(text, ['Final Truth Status'])[0] || '';
  return {
    ...empty,
    path: file,
    route: readProofField(text, 'Route'),
    goal: readProofField(text, 'Goal') || readProofField(text, 'Mission goal'),
    truth: readProofField(text, 'Truth status') || readProofField(text, 'Final Truth Status') || finalTruth.split(':')[0].trim(),
    commands: firstProofList(text, ['Commands', 'Verification']),
    evidence: readProofList(text, 'Evidence'),
    visual: readProofList(text, 'Visual evidence'),
    runtime: firstProofList(text, ['Runtime evidence', 'Processes', 'tmux']),
    runtimeBackendEvidence: readProofList(text, 'Runtime backend evidence'),
    visualProvenance: readProofList(text, 'Visual provenance'),
    missionEnvelope: readProofList(text, 'Mission patch envelope'),
    missionReceipt: readProofList(text, 'Mission subagent receipt'),
    missionCompletion: readProofList(text, 'Mission completion gate'),
    rollbackHint: readProofList(text, 'Rollback hint'),
    mediaProof: readProofList(text, 'Media proof'),
    designCompletion: readProofList(text, 'Design completion'),
    cleanup: readProofField(text, 'Cleanup') || readProofField(text, 'Cleanup status'),
    changed: firstProofList(text, ['Changed surfaces', 'Files']),
    skipped: readProofList(text, 'Skipped'),
    blocked: readProofList(text, 'Blocked'),
    assumptions: readProofList(text, 'Assumptions'),
    unverified: readProofList(text, 'Unverified')
  };
}

function readProofField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`^-\\s*${escaped}:\\s*(.+)$`, 'im'),
    new RegExp(`^##\\s*${escaped}\\s*\\n\\s*([^\\n]+)`, 'im')
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return '';
}

function readProofList(text, label) {
  const section = getMarkdownSection(text, label);
  if (!section) {
    const field = readProofField(text, label);
    return field ? [field] : [];
  }
  return section.split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean);
}

function firstProofList(text, labels = []) {
  for (const label of labels) {
    const values = readProofList(text, label);
    if (values.length) return values;
  }
  return [];
}

function arrayFlag(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function structuredEvidenceList(value) {
  return arrayFlag(value).map((item) => formatStructuredEvidence(item)).filter(Boolean);
}

function directRuntimeBackendEvidence(flags) {
  if (!flags.runtime_backend && !flags.runtime_claim && !flags.runtime_evidence_id && !flags.runtime_command && !flags.runtime_note && !flags.cleanup_checked && !flags.cleanup_observed && !flags.left_running_intentionally) return [];
  return [JSON.stringify(buildRuntimeBackendEvidence({
    backend: flags.runtime_backend,
    claim: flags.runtime_claim,
    evidence_id: flags.runtime_evidence_id,
    command: flags.runtime_command,
    pid: numberOrNull(flags.runtime_pid),
    port: numberOrNull(flags.runtime_port),
    exit_code: numberOrNull(flags.runtime_exit_code),
    started_at: String(flags.runtime_started_at || ''),
    stopped_at: String(flags.runtime_stopped_at || ''),
    cleanup_method: String(flags.runtime_cleanup_method || ''),
    cleanup_observed: Boolean(flags.cleanup_observed),
    left_running_intentionally: Boolean(flags.left_running_intentionally),
    cleanup_checked: Boolean(flags.cleanup_checked),
    note: flags.runtime_note
  }))];
}

function formatStructuredEvidence(value) {
  if (!value) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value).trim();
  if (!text) return '';
  if (!text.startsWith('{')) return text;
  try {
    const data = JSON.parse(text);
    if (data.schema === 'yam.ueye-visual-provenance.v1' || data.source_kind || data.reference_id || data.screenshot_id) {
      return JSON.stringify(buildUeyeVisualProvenance(data));
    }
    if (data.schema === 'yam.mission-subagent-receipt.v1' || data.thread_id || data.lifecycle_status || data.outcome) {
      return JSON.stringify(buildMissionSubagentReceipt(data));
    }
    if (data.schema === 'yam.mission-completion-gate.v1' || data.expected_thread_ids || data.ready_to_claim_complete !== undefined) {
      return JSON.stringify(buildMissionCompletionGate(data));
    }
    if (data.schema === 'yam.mission-patch-envelope.v1' || data.agent_id || data.assigned_scope) {
      return JSON.stringify(buildMissionPatchEnvelope(data));
    }
    if (data.schema === 'yam.rollback-hint.v1' || data.touched_files || data.safe_revert_note) {
      return JSON.stringify(buildRollbackHint(data));
    }
    if (data.schema === 'yam.runtime-backend-evidence.v1' || data.backend || data.evidence_id) {
      return JSON.stringify(buildRuntimeBackendEvidence(data));
    }
    if (data.schema === 'yam.media-generation-proof.v1' || data.generation_requested || data.output_hash) {
      return JSON.stringify(buildMediaGenerationProof(data));
    }
    if (data.schema === 'yam.ueye-design-completion-gate.v1' || data.completion_claim || data.ready_to_claim_done !== undefined) {
      return JSON.stringify(buildUeyeDesignCompletionGate(data));
    }
    return JSON.stringify(data);
  } catch {
    return text;
  }
}

function hasProofEvidence(parsed) {
  const flags = parsed.flags || {};
  return ['command', 'evidence', 'visual', 'runtime', 'runtime_backend_evidence', 'visual_provenance', 'mission_envelope', 'mission_receipt', 'mission_completion', 'rollback_hint', 'media_proof', 'design_completion', 'changed', 'skipped', 'blocked'].some((key) => arrayFlag(flags[key]).length > 0) || Boolean(flags.cleanup || flags.runtime_backend || flags.runtime_claim);
}

function printProofList(label, values) {
  console.log(`- ${label}:`);
  if (!values.length) {
    console.log('  - (none supplied)');
    return;
  }
  for (const value of values) console.log(`  - ${value}`);
}

function expandHome(value = '') {
  return String(value || '').replace(/^~(?=$|\/)/, os.homedir());
}

async function examples() {
  console.log(await readText(path.join(ROOT, 'COMMANDS.md')));
}

async function initProject(targetDir = process.cwd()) {
  const resolved = path.resolve(targetDir);
  const target = path.join(resolved, PROJECT_PACK);
  const template = path.join(ROOT, 'templates', PROJECT_PACK);
  if (!await exists(template)) throw new Error(`missing template: ${template}`);
  await fsp.mkdir(resolved, { recursive: true });
  const existingPack = await findProjectPack(resolved);
  if (existingPack) {
    console.log(`${path.basename(existingPack)} already exists: ${existingPack}`);
    return;
  }
  await fsp.copyFile(template, target);
  await maybeAppendDetectedCommands(target, resolved);
  console.log(`created ${target}`);
}

async function inspectProjectPack(targetDir = process.cwd()) {
  const resolved = path.resolve(targetDir || process.cwd());
  const target = await findProjectPack(resolved);
  const issues = [];
  const warnings = [];

  console.log(`Project: ${resolved}`);
  if (!target) {
    console.log(`Pack: missing ${path.join(resolved, PROJECT_PACK)}`);
    console.log(`Create it with: yam init-project ${resolved}`);
    process.exitCode = 1;
    return;
  }

  const text = await readText(target);
  const stat = await fsp.stat(target);
  const words = countWords(text);
  const lines = text.split(/\r?\n/).length;
  const missingSections = REQUIRED_PACK_SECTIONS.filter((section) => !hasHeading(text, section));
  const placeholderLines = text.split(/\r?\n/).filter((line) => /^\s*-\s+[^:]+:\s*$/.test(line)).length;
  const detection = await detectProject(resolved, { quiet: true });
  const packAgeDays = Math.floor((Date.now() - stat.mtimeMs) / 86400000);
  const instructionSurfaces = await findInstructionSurfaces(resolved);

  if (missingSections.length) issues.push(`missing section(s): ${missingSections.join(', ')}`);
  if (words > 1200) warnings.push(`pack is long (${words} words); keep the core compact`);
  if (words < 80) warnings.push(`pack is very short (${words} words); direction may be too thin to reuse`);
  if (packAgeDays > PACK_STALE_DAYS) warnings.push(`pack is ${packAgeDays} days old; review whether direction or commands changed`);
  if (placeholderLines > 12) warnings.push(`${placeholderLines} placeholder lines are still blank`);
  warnings.push(...commandDriftWarnings(text, detection));
  issues.push(...instructionSurfaces.issues);
  warnings.push(...instructionSurfaces.warnings);
  if (path.basename(target) === LEGACY_PROJECT_PACK) {
    warnings.push(`using legacy project pack ${LEGACY_PROJECT_PACK}; rename to ${PROJECT_PACK} when convenient`);
  }

  console.log(`Pack: ${target}`);
  console.log(`Size: ${words} words, ${lines} lines`);
  console.log(`Age: ${packAgeDays} day(s), modified ${formatDate(stat.mtime)}`);
  console.log(`Required sections: ${missingSections.length ? 'missing some' : 'ok'}`);
  console.log(`Blank placeholders: ${placeholderLines}`);
  console.log(`Instruction surfaces: ${instructionSurfaces.found.length ? instructionSurfaces.found.join(', ') : 'none detected'}`);

  if (detection.packageJson) {
    console.log('');
    console.log('Detected commands to keep in the pack:');
    for (const [key, value] of Object.entries(detection.commands)) {
      console.log(`- ${key}: ${value || '(not found)'}`);
    }
  }

  if (issues.length || warnings.length) {
    console.log('');
    console.log('Pack notes:');
    for (const issue of issues) console.log(`- issue: ${issue}`);
    for (const warning of warnings) console.log(`- warning: ${warning}`);
  } else {
    console.log('');
    console.log('yam pack: ok');
  }

  if (issues.length) process.exitCode = 1;
}

async function findInstructionSurfaces(dir) {
  const candidates = [
    { path: 'AGENTS.md', level: 'warning', note: 'active AGENTS.md may override route behavior; make sure it does not conflict with yam' },
    { path: 'CLAUDE.md', level: 'warning', note: 'active CLAUDE.md may carry non-yam instructions' },
    { path: 'RULES.md', level: 'warning', note: 'active RULES.md may carry non-yam instructions' },
    { path: '.codex/AGENTS.md', level: 'warning', note: 'active .codex/AGENTS.md may override project behavior' },
    { path: '.codex/hooks.json', level: 'issue', note: 'active Codex hook file detected' },
    { path: '.agents', level: 'warning', note: 'project-local .agents directory may add additional skills or instructions' }
  ];
  const found = [];
  const issues = [];
  const warnings = [];

  for (const candidate of candidates) {
    const absolute = path.join(dir, candidate.path);
    if (!await exists(absolute)) continue;
    found.push(candidate.path);
    const message = `${candidate.path}: ${candidate.note}`;
    if (candidate.level === 'issue') issues.push(message);
    else warnings.push(message);
  }

  return { found, issues, warnings };
}

function commandDriftWarnings(text, detection) {
  if (!detection.packageJson) return [];
  const warnings = [];
  const section = getMarkdownSection(text, 'Detected Commands');
  if (!section) {
    warnings.push('package.json scripts detected, but no Detected Commands section is recorded');
    return warnings;
  }

  const labels = {
    dev: 'Dev',
    typecheck: 'Typecheck',
    lint: 'Lint',
    test: 'Test',
    build: 'Build'
  };
  for (const [key, label] of Object.entries(labels)) {
    const detected = detection.commands[key] || '';
    const recorded = readBulletValue(section, label);
    if (detected && !recorded) warnings.push(`Detected Commands missing ${label}: expected ${detected}`);
    if (detected && recorded && recorded !== detected) {
      warnings.push(`Detected Commands stale for ${label}: recorded "${recorded}", detected "${detected}"`);
    }
    if (!detected && recorded) warnings.push(`Detected Commands has ${label}="${recorded}", but no matching package script was detected`);
  }
  return warnings;
}

function getMarkdownSection(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, 'm'));
  return match ? match[1] : '';
}

function readBulletValue(section, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^-\\s*${escaped}:\\s*(.*)$`, 'i');
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (match) return match[1].trim().replace(/^`|`$/g, '');
  }
  return '';
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

async function findProjectPack(dir) {
  const primary = path.join(dir, PROJECT_PACK);
  if (await exists(primary)) return primary;
  const legacy = path.join(dir, LEGACY_PROJECT_PACK);
  if (await exists(legacy)) return legacy;
  return null;
}

function hasHeading(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^#{2,3}\\s+${escaped}\\s*$`, 'm').test(text);
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function maybeAppendDetectedCommands(target, dir) {
  const detection = await detectProject(dir, { quiet: true });
  if (!detection.packageJson) return;
  const lines = [
    '',
    '<!-- yam detected package scripts -->',
    '',
    '## Detected Commands',
    '',
    `- Package manager: ${detection.packageManager}`,
    `- Dev: ${detection.commands.dev || ''}`,
    `- Typecheck: ${detection.commands.typecheck || ''}`,
    `- Lint: ${detection.commands.lint || ''}`,
    `- Test: ${detection.commands.test || ''}`,
    `- Build: ${detection.commands.build || ''}`,
    ''
  ];
  await fsp.appendFile(target, lines.join('\n'));
}

function packageManagerFromPackage(pkg: AnyRecord = {}) {
  const value = String(pkg.packageManager || '');
  if (value.startsWith('pnpm')) return 'pnpm';
  if (value.startsWith('yarn')) return 'yarn';
  if (value.startsWith('bun')) return 'bun';
  return 'npm';
}

function runCommand(pm, script) {
  if (!script) return null;
  if (pm === 'npm') return `npm run ${script}`;
  if (pm === 'yarn') return `yarn ${script}`;
  if (pm === 'bun') return `bun run ${script}`;
  return `${pm} run ${script}`;
}

function pickScript(scripts = {}, groups = []) {
  const names = Object.keys(scripts);
  for (const group of groups) {
    const exact = names.find((name) => name === group);
    if (exact) return exact;
  }
  for (const group of groups) {
    const partial = names.find((name) => name.toLowerCase().includes(group));
    if (partial) return partial;
  }
  return null;
}

async function detectProject(targetDir = process.cwd(), { quiet = false } = {}) {
  const dir = path.resolve(targetDir || process.cwd());
  const packageJson = path.join(dir, 'package.json');
  const result = {
    dir,
    packageJson: await exists(packageJson),
    packageManager: 'npm',
    commands: {
      dev: null,
      typecheck: null,
      lint: null,
      test: null,
      build: null
    },
    frameworkChecklist: null
  };
  if (!result.packageJson) {
    if (!quiet) {
      console.log(`No package.json found in ${dir}`);
      console.log('Suggested verification: use project pack or local framework conventions.');
    }
    return result;
  }

  const pkg = await readJson(packageJson);
  const scripts = pkg.scripts || {};
  result.packageManager = packageManagerFromPackage(pkg);
  result.commands.dev = runCommand(result.packageManager, pickScript(scripts, ['dev', 'start']));
  result.commands.typecheck = runCommand(result.packageManager, pickScript(scripts, ['typecheck', 'type-check', 'tsc']));
  result.commands.lint = runCommand(result.packageManager, pickScript(scripts, ['lint']));
  result.commands.test = runCommand(result.packageManager, pickScript(scripts, ['test', 'spec']));
  result.commands.build = runCommand(result.packageManager, pickScript(scripts, ['build']));
  result.frameworkChecklist = await detectFrameworkChecklist(dir, pkg);

  if (!quiet) printDetection(result);
  return result;
}

function printDetection(result) {
  console.log(`Project: ${result.dir}`);
  console.log(`Package manager: ${result.packageManager}`);
  console.log('');
  console.log('Detected commands:');
  for (const [key, value] of Object.entries(result.commands)) {
    console.log(`- ${key}: ${value || '(not found)'}`);
  }
  console.log('');
  console.log('Smallest useful checks:');
  console.log(`- $quick: ${result.commands.typecheck || result.commands.lint || result.commands.test || result.commands.build || 'L1 inspected; no command detected'}`);
  console.log(`- $ueye: ${result.commands.typecheck || result.commands.build || 'Browser/screenshot check; no command detected'}`);
  console.log(`- $deep: ${[result.commands.typecheck, result.commands.lint, result.commands.test, result.commands.build].filter(Boolean).join(' && ') || `No command detected; define in ${PROJECT_PACK}`}`);
  if (result.frameworkChecklist?.detected) {
    console.log('');
    console.log(`Framework checklist: ${result.frameworkChecklist.framework}`);
    for (const check of result.frameworkChecklist.checks) {
      console.log(`- ${check.id}: ${check.label} (${check.route})`);
    }
  }
}

function budget(routeArg = '') {
  const normalized = normalizeRoute(routeArg);
  const entries = normalized ? [[normalized, ROUTE_BUDGETS[normalized]]] : Object.entries(ROUTE_BUDGETS);
  if (normalized && !ROUTE_BUDGETS[normalized]) {
    console.error(`unknown route: ${routeArg}`);
    process.exitCode = 1;
    return;
  }
  for (const [route, info] of entries) {
    console.log(`$${route}`);
    console.log(`- files: ${info.files}`);
    console.log(`- commands: ${info.commands}`);
    console.log(`- report: ${info.report}`);
    console.log(`- expand: ${info.expand}`);
    console.log(`- limits: files<=${info.limits.files}, commands<=${info.limits.commands}, report-lines<=${info.limits.reportLines}, seconds<=${info.limits.seconds}`);
    console.log('');
  }
}

function measure(routeArg = '', args = []) {
  const normalized = normalizeRoute(routeArg);
  const info = ROUTE_BUDGETS[normalized];
  if (!normalized || !info) {
    console.error('usage: yam measure <route> [--files n] [--commands n] [--report-lines n] [--seconds n]');
    process.exitCode = 1;
    return;
  }

  const actual = parseMeasureArgs(args);
  const checks = [
    ['files', actual.files, info.limits.files],
    ['commands', actual.commands, info.limits.commands],
    ['report-lines', actual.reportLines, info.limits.reportLines],
    ['seconds', actual.seconds, info.limits.seconds]
  ];
  const measured = checks.filter(([, value]) => Number.isFinite(value));
  const over = checks.filter(([, value, limit]) => Number.isFinite(value) && value > limit);
  const missing = checks.filter(([, value]) => !Number.isFinite(value));

  console.log(`Token budget report: $${normalized}`);
  console.log(`Status: ${over.length ? 'over budget' : measured.length ? 'ok' : 'no measurements'}`);
  console.log('');
  console.log('Budget:');
  console.log(`- files: ${info.files}`);
  console.log(`- commands: ${info.commands}`);
  console.log(`- report: ${info.report}`);
  console.log(`- expand: ${info.expand}`);
  console.log('');
  console.log('Actual:');
  for (const [label, value, limit] of checks) {
    const display = Number.isFinite(value) ? value : '(not measured)';
    const mark = Number.isFinite(value) && value > limit ? ' over' : '';
    console.log(`- ${label}: ${display} / limit ${limit}${mark}`);
  }

  if (missing.length) {
    console.log('');
    console.log(`Missing measurements: ${missing.map(([label]) => label).join(', ')}`);
  }
  if (over.length) {
    console.log('');
    console.log('Reduce next run:');
    for (const [label] of over) {
      if (label === 'files') console.log('- Read the project pack first, then only the edit surface.');
      if (label === 'commands') console.log('- Prefer the smallest honest check before build/deep verification.');
      if (label === 'report-lines') console.log('- Move detail into remaining tasks or fix-first items.');
      if (label === 'seconds') console.log('- Use a narrower route or switch heavy work to explicit deep/mission.');
    }
    process.exitCode = 1;
  }
}

function parseMeasureArgs(args = []) {
  const actual = {
    files: NaN,
    commands: NaN,
    reportLines: NaN,
    seconds: NaN
  };
  const aliases = new Map([
    ['--files', 'files'],
    ['--file-count', 'files'],
    ['--commands', 'commands'],
    ['--command-count', 'commands'],
    ['--report-lines', 'reportLines'],
    ['--lines', 'reportLines'],
    ['--seconds', 'seconds'],
    ['--secs', 'seconds']
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [rawKey, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const key = aliases.get(rawKey);
    if (!key) continue;
    const value = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) index += 1;
    actual[key] = Number(value);
  }

  return actual;
}

function normalizeRoute(value = '') {
  const route = String(value || '').trim().replace(/^\$/, '');
  if (!route) return '';
  return route.replace(/^yam-/, '').replace(/^timeto-/, '');
}

async function printTemplate(name = '') {
  const key = String(name || '').trim().toLowerCase();
  const map = {
    project: PROJECT_PACK,
    ueye: 'ueye-review.md',
    'ueye-comparison': 'ueye-comparison.md',
    ueyecompare: 'ueye-comparison.md',
    mission: 'mission-plan.md',
    proof: 'runtime-proof.md',
    runtime: 'runtime-proof.md',
    tuning: 'tuning-log.md'
  };
  const file = map[key];
  if (!file) {
    console.error('usage: yam template <project|ueye|ueye-comparison|mission|proof|tuning>');
    process.exitCode = 1;
    return;
  }
  console.log(await readText(path.join(ROOT, 'templates', file)));
}

async function tuneLog(targetDir = process.cwd()) {
  const resolved = path.resolve(targetDir || process.cwd());
  const dir = path.join(resolved, '.yam');
  const target = path.join(dir, 'tuning-log.md');
  await fsp.mkdir(dir, { recursive: true });
  if (await exists(target)) {
    console.log(`tuning log already exists: ${target}`);
    return;
  }
  await fsp.copyFile(path.join(ROOT, 'templates', 'tuning-log.md'), target);
  console.log(`created ${target}`);
}

async function memory(args = []) {
  const subcommand = args[0] || 'list';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return memoryUsage();
  if (subcommand === 'init') return memoryInit(args[1]);
  if (subcommand === 'add') return memoryAdd(args.slice(1));
  if (subcommand === 'list') {
    const parsed = parseMemoryArgs(args.slice(1));
    return memoryList(parsed.dir, { json: args.includes('--json') });
  }
  if (subcommand === 'summary' || subcommand === 'summarize') {
    const parsed = parseMemoryArgs(args.slice(1));
    return memorySummary(parsed.dir);
  }
  if (subcommand === 'resolve') return memoryResolve(args.slice(1));
  console.error(`unknown memory command: ${subcommand}`);
  return memoryUsage();
}

function memoryUsage() {
  console.log(`yam memory

Usage:
  yam memory init [dir]
  yam memory add [dir] --kind <kind> --summary <text> [--evidence <text>] [--action <text>] [--source <text>]
  yam memory list [dir] [--json]
  yam memory summary [dir]
  yam memory resolve [dir] <id> [--note <text>]

Kinds:
  wrong_decision, repeat_mistake, direction_change, lesson, risk, command

Notes:
  Memory is opt-in and project-local under .yam/memory/.
`);
}

async function memoryInit(targetDir = process.cwd()) {
  const dir = memoryDir(targetDir);
  await fsp.mkdir(path.join(dir, 'records'), { recursive: true });
  const readme = path.join(dir, 'README.md');
  if (!await exists(readme)) {
    await fsp.writeFile(readme, [
      '# yam Memory',
      '',
      'Opt-in project memory for short records about wrong decisions, repeated mistakes, direction changes, lessons, risks, and command notes.',
      '',
      'Records live in `records/*.json`. Regenerate `summary.md` with `yam memory summary .`.',
      ''
    ].join('\n'));
  }
  console.log(`memory ready: ${dir}`);
}

async function memoryAdd(args = []) {
  const parsed = parseMemoryArgs(args);
  const dir = memoryDir(parsed.dir);
  const recordsDir = path.join(dir, 'records');
  const kind = parsed.flags.kind || 'lesson';
  const allowedKinds = new Set(['wrong_decision', 'repeat_mistake', 'direction_change', 'lesson', 'risk', 'command']);
  const summary = parsed.flags.summary || parsed.flags.note || '';
  const evidence = parsed.flags.evidence || '';
  const action = parsed.flags.action || parsed.flags.recommendation || '';
  const source = parsed.flags.source || '';

  if (!allowedKinds.has(kind)) {
    console.error(`invalid memory kind: ${kind}`);
    console.error(`allowed: ${[...allowedKinds].join(', ')}`);
    process.exitCode = 1;
    return;
  }
  if (!summary.trim()) {
    console.error('missing required --summary');
    process.exitCode = 1;
    return;
  }
  const secretHit = findSensitivePattern([summary, evidence, action, source].join('\n'));
  if (secretHit) {
    console.error(`memory entry blocked: possible secret pattern detected (${secretHit})`);
    process.exitCode = 1;
    return;
  }

  await fsp.mkdir(recordsDir, { recursive: true });
  const id = `mem-${timestampId()}`;
  const record = {
    schemaVersion: 1,
    id,
    kind,
    status: 'active',
    summary: summary.trim(),
    evidence: evidence.trim(),
    action: action.trim(),
    source: source.trim(),
    createdAt: new Date().toISOString()
  };
  await fsp.writeFile(path.join(recordsDir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`memory added: ${id}`);
}

async function memoryList(targetDir = process.cwd(), { json = false } = {}) {
  const records = await readMemoryRecords(targetDir);
  if (json) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }
  if (!records.length) {
    console.log(`No memory records found in ${memoryDir(targetDir)}`);
    return;
  }
  for (const record of records) {
    console.log(`${record.id} [${record.status}] ${record.kind}: ${record.summary}`);
    if (record.action) console.log(`  action: ${record.action}`);
  }
}

async function memorySummary(targetDir = process.cwd()) {
  const dir = memoryDir(targetDir);
  const records = await readMemoryRecords(targetDir);
  await fsp.mkdir(dir, { recursive: true });
  const active = records.filter((record) => record.status !== 'resolved');
  const resolved = records.filter((record) => record.status === 'resolved');
  const lines = [
    '# yam Memory Summary',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'This summary is generated from opt-in `.yam/memory/records/*.json` files. Keep it sparse and do not treat it as automatic truth.',
    '',
    `Active records: ${active.length}`,
    `Resolved records: ${resolved.length}`,
    ''
  ];

  for (const kind of ['wrong_decision', 'repeat_mistake', 'direction_change', 'lesson', 'risk', 'command']) {
    const group = active.filter((record) => record.kind === kind);
    if (!group.length) continue;
    lines.push(`## ${kind}`);
    lines.push('');
    for (const record of group) {
      lines.push(`- ${record.summary} (${record.id})`);
      if (record.action) lines.push(`  - Next action: ${record.action}`);
      if (record.evidence) lines.push(`  - Evidence: ${record.evidence}`);
    }
    lines.push('');
  }

  const target = path.join(dir, 'summary.md');
  await fsp.writeFile(target, `${lines.join('\n').trim()}\n`);
  console.log(`memory summary written: ${target}`);
}

async function memoryResolve(args = []) {
  const parsed = parseMemoryArgs(args);
  const id = parsed.positionals[0];
  if (!id) {
    console.error('missing memory id');
    process.exitCode = 1;
    return;
  }
  const recordsDir = path.join(memoryDir(parsed.dir), 'records');
  const target = path.join(recordsDir, `${id}.json`);
  if (!await exists(target)) {
    console.error(`memory record not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  const record = await readJson(target);
  record.status = 'resolved';
  record.resolvedAt = new Date().toISOString();
  record.resolution = (parsed.flags.note || parsed.flags.reason || '').trim();
  await fsp.writeFile(target, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`memory resolved: ${id}`);
}

function parseMemoryArgs(args = []) {
  const flags: AnyRecord = {};
  const positionals: string[] = [];
  let dir = process.cwd();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      const [rawKey, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
      const key = rawKey.slice(2).replace(/-/g, '_');
      const value = inlineValue ?? args[index + 1] ?? '';
      flags[key] = value;
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (dir === process.cwd() && looksLikeDirectoryArg(arg)) dir = arg;
    else positionals.push(arg);
  }

  return { dir, flags, positionals };
}

function looksLikeDirectoryArg(value = '') {
  return value === '.' || value.startsWith('/') || value.startsWith('~') || value.startsWith('./') || value.startsWith('../');
}

function memoryDir(targetDir = process.cwd()) {
  const expanded = String(targetDir || process.cwd()).replace(/^~(?=$|\/)/, os.homedir());
  return path.join(path.resolve(expanded), '.yam', 'memory');
}

async function readMemoryRecords(targetDir = process.cwd()) {
  const recordsDir = path.join(memoryDir(targetDir), 'records');
  if (!await exists(recordsDir)) return [];
  const entries = await fsp.readdir(recordsDir, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(recordsDir, entry.name);
    try {
      const record = await readJson(file);
      records.push(record);
    } catch (error) {
      records.push({ id: entry.name.replace(/\.json$/, ''), kind: 'invalid', status: 'invalid', summary: `invalid JSON: ${errorMessage(error)}` });
    }
  }
  return records.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

function timestampId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1z');
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${suffix}`;
}

function findSensitivePattern(text = '') {
  const patterns: Array<[string, RegExp]> = [
    ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/i],
    ['openai_key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
    ['github_token', /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
    ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/],
    ['password_assignment', /\b(password|passwd|api[_-]?key|secret|token)\s*[:=]\s*\S+/i]
  ];
  const hit = patterns.find(([, pattern]) => pattern.test(text));
  return hit ? hit[0] : '';
}

function showPath() {
  console.log(`root: ${ROOT}`);
  console.log(`skills: ${DEST}`);
  console.log(`codex mirror cleanup: ${CODEX_MIRROR}`);
}

async function main() {
  const command = process.argv[2] || 'help';
  if (command === 'help' || command === '--help' || command === '-h') return usage();
  if (command === 'install') return install();
  if (command === 'uninstall') return uninstall();
  if (command === 'version') return console.log(VERSION);
  if (command === 'detect') return detectProject(process.argv[3]);
  if (command === 'pack') return inspectProjectPack(process.argv[3]);
  if (command === 'context') return context(process.argv.slice(3));
  if (command === 'cleanup') return cleanup(process.argv.slice(3));
  if (command === 'budget') return budget(process.argv[3]);
  if (command === 'measure') return measure(process.argv[3], process.argv.slice(4));
  if (command === 'tools') return tools(process.argv.slice(3));
  if (command === 'proof') return proof(process.argv.slice(3));
  if (command === 'study-note') return studyNote(process.argv.slice(3));
  if (command === 'loop') return loop(process.argv.slice(3));
  if (command === 'ueye') return ueye(process.argv.slice(3));
  if (command === 'media') return media(process.argv.slice(3));
  if (command === 'runtime') return runtime(process.argv.slice(3));
  if (command === 'mission') return mission(process.argv.slice(3));
  if (command === 'benchmark') return benchmark(process.argv.slice(3));
  if (command === 'release') return release(process.argv.slice(3));
  if (command === 'safety') return safety(process.argv.slice(3));
  if (command === 'memory') return memory(process.argv.slice(3));
  if (command === 'hook') return hook(process.argv.slice(3));
  if (command === 'template') return printTemplate(process.argv[3]);
  if (command === 'tune-log') return tuneLog(process.argv[3]);
  if (command === 'status') {
    const missing = await status();
    if (missing > 0) process.exitCode = 1;
    return;
  }
  if (command === 'list') return list();
  if (command === 'verify') return verify();
  if (command === 'doctor') return doctor(process.argv.slice(3));
  if (command === 'examples') return examples();
  if (command === 'path') return showPath();
  if (command === 'init-project') return initProject(process.argv[3]);
  console.error(`unknown command: ${command}`);
  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
