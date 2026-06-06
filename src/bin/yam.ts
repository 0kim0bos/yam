#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  TRUTH_STATUSES,
  buildMediaGenerationProof,
  buildMissionPatchEnvelope,
  buildRollbackHint,
  buildRuntimeBackendEvidence,
  buildUeyeDesignCompletionGate,
  buildUeyeVisualProvenance,
  buildUeyeRunReport,
  buildUeyeSurfaceContext,
  buildYamCompletionProof,
  detectDbSafetyText as detectTrustDbSafetyText,
  isTruthStatus
} from '../lib/trust-kernel.js';

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
const YAM_LITE_HOOK_COMMAND = `node ${path.join(ROOT, 'dist', 'bin', 'yam.js')} hook run lite`;
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
  yam budget [route]
  yam measure <route> [--files n] [--commands n] [--report-lines n] [--seconds n]
  yam tools doctor [dir]
  yam proof [dir|--from file] [--route route] [--truth status] [--command text] [--evidence text]
  yam proof write [dir] [--format json|md] [--out file] [--route route] [--truth status] [--command text]
  yam ueye capture --url URL --out screenshot.png [--viewport 1440x900] [--full-page] [--json]
  yam ueye compare --reference ref.png --actual screenshot.png [--json]
  yam ueye report [--reference ref.png] [--actual screenshot.png] [--provider-context local] [--execution-surface in-app-browser] [--json]
  yam media proof [--requested] [--attempted] [--output file] [--json]
  yam runtime evidence [--backend terminal|in-app-browser|playwright|tmux|zellij] [--claim observed|started|stopped|cleanup-verified] [--json]
  yam mission queue [--agent-id id] [--scope text] [--changed file] [--verification-hint text] [--json]
  yam benchmark report [--baseline n] [--current n] [--unit ms] [--target lower|higher] [--json]
  yam release report [--json]
  yam safety [text...]
  yam memory <init|add|list|summary|resolve> [dir] [options]
  yam hook <status|enable|disable|run> [lite] [--global|--project dir]
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

async function copyDir(source, target) {
  await fsp.mkdir(target, { recursive: true });
  const entries = await fsp.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else if (entry.isFile()) {
      await fsp.copyFile(from, to);
    }
  }
}

async function installSkill(skill) {
  const source = path.join(ROOT, 'skills', skill);
  const target = path.join(DEST, skill);
  const references = path.join(ROOT, 'references');

  if (!await exists(path.join(source, 'SKILL.md'))) {
    throw new Error(`missing skill source: ${source}`);
  }

  await rmrf(target);
  await fsp.mkdir(target, { recursive: true });
  await fsp.copyFile(path.join(source, 'SKILL.md'), path.join(target, 'SKILL.md'));
  await copyDir(references, path.join(target, 'references'));
}

async function install() {
  await fsp.mkdir(DEST, { recursive: true });
  for (const skill of SKILLS) {
    await installSkill(skill);
  }
  for (const legacySkill of LEGACY_SKILLS) {
    await rmrf(path.join(DEST, legacySkill));
  }
  for (const retiredSkill of RETIRED_SKILLS) {
    await rmrf(path.join(DEST, retiredSkill));
  }
  if (CODEX_MIRROR !== DEST && fs.existsSync(CODEX_MIRROR)) {
    for (const skill of [...SKILLS, ...LEGACY_SKILLS, ...RETIRED_SKILLS]) {
      await rmrf(path.join(CODEX_MIRROR, skill));
    }
  }
  console.log(`yam installed to ${DEST}`);
  console.log('Restart Codex to reload skills.');
}

async function uninstall() {
  for (const skill of [...SKILLS, ...LEGACY_SKILLS, ...RETIRED_SKILLS]) {
    await rmrf(path.join(DEST, skill));
    if (CODEX_MIRROR !== DEST) {
      await rmrf(path.join(CODEX_MIRROR, skill));
    }
  }
  console.log(`yam removed from ${DEST}`);
  if (CODEX_MIRROR !== DEST) console.log(`yam mirror entries removed from ${CODEX_MIRROR}`);
  console.log('Restart Codex to unload skills.');
}

async function status({ quiet = false } = {}) {
  let missing = 0;
  for (const skill of SKILLS) {
    const ok = await exists(path.join(DEST, skill, 'SKILL.md')) && await exists(path.join(DEST, skill, 'references'));
    if (!quiet) console.log(`${ok ? 'ok     ' : 'missing'} ${skill}`);
    if (!ok) missing += 1;
  }
  return missing;
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
  for (const module of ['trust-kernel.js']) {
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
  if (/(publish|registry|release|npm pack|npm publish)/i.test(text)) return 'publish';
  if (/(rm |delete|drop|truncate|reset|migrate|push|deploy|write|commit|add |install)/i.test(text)) return 'destructive';
  if (/(dev|server|tmux|playwright|browser|screenshot|runtime|port|pid)/i.test(text)) return 'runtime';
  if (/(ueye|visual|image|screen)/i.test(text)) return 'visual';
  if (/(build|typecheck|lint|test|verify|doctor|status|pack)/i.test(text)) return 'read_only';
  return 'write';
}

function normalizeToolIntent(value = '') {
  const text = String(value || '').toLowerCase().replace(/[-\s]/g, '_');
  if (['read_only', 'write', 'destructive', 'runtime', 'visual', 'publish'].includes(text)) return text;
  return 'read_only';
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
  const rows = [
    readinessRow('Codex home', await exists(codexHome) ? 'ready' : 'missing', codexHome),
    readinessRow('Yam skills', await status({ quiet: true }) === 0 ? 'ready' : 'missing', DEST),
    readinessRow('yam-lite hook', hookConfigHasYamLite(globalHook) ? 'enabled' : 'disabled', 'optional UserPromptSubmit guide'),
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
  yam hook enable lite [--global|--project dir]
  yam hook disable [lite] [--global|--project dir]
  yam hook run lite

Notes:
  yam-lite is opt-in and advisory-only. It does not run checks, tmux, subagents, or proof gates.
`);
}

function parseHookArgs(args = []) {
  const result = { mode: 'project', projectDir: process.cwd(), profile: 'lite' };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === 'lite') {
      result.profile = 'lite';
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
  return handler?.type === 'command' && String(handler.command || '').includes('yam.js hook run lite');
}

function stripYamLiteHooks(config: AnyRecord = {}) {
  const next = { ...config };
  for (const event of Object.keys(next)) {
    const entries = Array.isArray(next[event]) ? next[event] : [];
    const keptEntries = [];
    for (const entry of entries) {
      const hooks = Array.isArray(entry?.hooks) ? entry.hooks.filter((handler) => !isYamLiteHook(handler)) : [];
      const rest = { ...entry, hooks };
      if (hooks.length > 0) keptEntries.push(rest);
    }
    if (keptEntries.length > 0) next[event] = keptEntries;
    else delete next[event];
  }
  return next;
}

function withYamLiteHook(config: AnyRecord = {}) {
  const next = stripYamLiteHooks(config);
  const event = 'UserPromptSubmit';
  const entry = {
    hooks: [
      {
        type: 'command',
        command: YAM_LITE_HOOK_COMMAND,
        timeout: 5
      }
    ]
  };
  next[event] = [...(Array.isArray(next[event]) ? next[event] : []), entry];
  return next;
}

async function hookStatus(args = []) {
  const parsed = parseHookArgs(args);
  const target = hookPathFor(parsed);
  const config = await readJsonOrDefault(target, {});
  const enabled = hookConfigHasYamLite(config);
  console.log(`yam-lite hook: ${enabled ? 'enabled' : 'disabled'}`);
  console.log(`scope: ${parsed.mode}`);
  console.log(`file: ${target}`);
}

function hookConfigHasYamLite(config = {}) {
  return Object.values(config).some((entries) => Array.isArray(entries) && entries.some((entry) => {
    return Array.isArray(entry?.hooks) && entry.hooks.some(isYamLiteHook);
  }));
}

async function hookEnable(args = []) {
  const parsed = parseHookArgs(args);
  if (parsed.profile !== 'lite') {
    console.error('Only yam-lite hook is supported: yam hook enable lite');
    process.exitCode = 1;
    return;
  }
  const target = hookPathFor(parsed);
  const current = await readJsonOrDefault(target, {});
  const next = withYamLiteHook(current);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  if (await exists(target)) {
    const backup = `${target}.yam-backup-${timestampId()}`;
    await fsp.copyFile(target, backup);
    console.log(`backup: ${backup}`);
  }
  await fsp.writeFile(target, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`yam-lite hook enabled (${parsed.mode}): ${target}`);
  console.log('Restart Codex or start a new thread if the app does not pick up hook changes immediately.');
}

async function hookDisable(args = []) {
  const parsed = parseHookArgs(args);
  const target = hookPathFor(parsed);
  const current = await readJsonOrDefault(target, {});
  if (!hookConfigHasYamLite(current)) {
    console.log(`yam-lite hook already disabled (${parsed.mode}): ${target}`);
    return;
  }
  const next = stripYamLiteHooks(current);
  if (Object.keys(next).length === 0) {
    await rmrf(target);
  } else {
    await fsp.writeFile(target, `${JSON.stringify(next, null, 2)}\n`);
  }
  console.log(`yam-lite hook disabled (${parsed.mode}): ${target}`);
}

async function hookRun(args = []) {
  const profile = args[0] || 'lite';
  if (profile !== 'lite') {
    console.log(JSON.stringify({ continue: true }));
    return;
  }
  const input = await readStdinJson();
  const event = input?.hook_event_name || input?.hookEventName || input?.event || 'UserPromptSubmit';
  const cwd = String(input?.cwd || process.cwd());
  const prompt = extractPrompt(input);
  const additionalContext = await buildYamLiteContext({ cwd, prompt });
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
  if (report.failed.length) {
    console.log('- Failed:');
    for (const id of report.failed) console.log(`  - ${id}`);
  }
  if (report.next_actions?.length) {
    console.log('- Next actions:');
    for (const action of report.next_actions) console.log(`  - ${action.next_action}`);
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
  const nextActions = releaseNextActions(checks, provenance, tarball);
  return {
    schema: 'yam.release-report.v1',
    generated_at: startedAt,
    packageName: PACKAGE_JSON.name,
    version: VERSION,
    ok: failed.length === 0,
    truth_status: failed.length === 0 ? 'verified' : 'blocked',
    checks,
    failed,
    provenance,
    tarball,
    freshness,
    next_actions: nextActions
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

function releaseNextActions(checks = [], provenance: AnyRecord = {}, tarball: AnyRecord = {}) {
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
  return uniqueNextActionDetails(actions);
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
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return '';
  const highSignal = lines.filter((line) => !line.startsWith('>')).slice(-4);
  return highSignal.join(' | ').slice(0, 600);
}

async function readStdinTextIfAvailable() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function ueye(args = []) {
  const subcommand = args[0] || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return ueyeUsage();
  if (subcommand === 'capture') return ueyeCapture(args.slice(1));
  if (subcommand === 'compare') return ueyeCompare(args.slice(1));
  if (subcommand === 'report') return ueyeReport(args.slice(1));
  console.error(`unknown ueye command: ${subcommand}`);
  return ueyeUsage();
}

function ueyeUsage() {
  console.log(`yam ueye

Opt-in visual evidence helpers. Ueye stays one skill: fast by default, capture/compare only when verified visual claims need real evidence.

Usage:
  yam ueye capture --url URL --out screenshot.png [--viewport 1440x900] [--full-page] [--json]
  yam ueye compare --reference ref.png --actual screenshot.png [--json]
  yam ueye report [--reference ref.png] [--actual screenshot.png] [--review-session-id id] [--provider-context local] [--execution-surface in-app-browser] [--app-surface codex-app] [--browser-surface in-app-browser] [--control-mode manual|automated] [--preserved-state] [--preserved-url URL] [--completion-claim draft|needs-polish|done] [--strict] [--design-score n] [--p0 text] [--p1 text] [--states-checked] [--mobile-checked] [--contrast-checked] [--similar text] [--different text] [--missing text] [--resolved text] [--new-finding text] [--still-open text] [--regression text] [--viewport 1440x900] [--state default] [--design-quality pass|needs-polish|fails|not-checked] [--json]

Notes:
  capture uses a locally available Playwright install when present. It does not download browsers or install dependencies.
  compare uses local files only and reports sha256, dimensions, comparison_result, and proof-ready visual provenance.
  report produces a proof-ready Ueye visual run report, design completion gate, and continuity/comparison record without requiring a new capture.
`);
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
  const flags = parseSimpleFlags(args, new Set(['reference', 'ref', 'actual', 'screenshot', 'capture-backend', 'compare-backend', 'design-quality', 'blocked-reason', 'next-action', 'next-visual-action', 'review-session-id', 'reference-id', 'screenshot-id', 'previous-screenshot-id', 'current-screenshot-id', 'previous-report', 'comparison-notes', 'similar', 'different', 'missing', 'resolved', 'new-finding', 'still-open', 'regression', 'viewport', 'state', 'provider-context', 'provider-badge', 'execution-surface', 'app-surface', 'browser-surface', 'control-mode', 'preserved-state', 'preserved-url', 'url', 'evidence-id', 'completion-claim', 'completion-status', 'gate-mode', 'strict', 'design-score', 'min-design-score', 'p0', 'p1', 'open-p0', 'open-p1', 'states-checked', 'mobile-checked', 'responsive-checked', 'contrast-checked', 'accessibility-checked', 'cta-checked', 'direction-locked', 'reference-read', 'comparison-result', 'json']));
  const reference = String(flags.reference || flags.ref || '');
  const actual = String(flags.actual || flags.screenshot || '');
  const referenceSources = [];
  const implementationSources = [];
  let comparisonResult = 'not-verified';
  let blockedReason = String(flags.blocked_reason || '');
  const reviewSessionId = String(flags.review_session_id || `ueye-${timestampId()}`);
  const previousReport = await readPreviousUeyeReport(flags.previous_report);
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
      p0: [...arrayFlag(flags.p0), ...arrayFlag(flags.open_p0)],
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
    tool_intent: 'visual',
    capture_backend: String(flags.capture_backend || 'not-recorded'),
    compare_backend: String(flags.compare_backend || 'local-file-hash'),
    continuity: comparisonReport.continuity,
    comparison_report: comparisonReport
  };
  printJsonOrHuman(result, Boolean(flags.json), 'Ueye report');
  if (report.truth_status === 'blocked') process.exitCode = 1;
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
  yam runtime evidence [--backend terminal|in-app-browser|playwright|tmux|zellij] [--claim observed|started|stopped|cleanup-verified] [--evidence-id id] [--command text] [--pid n] [--port n] [--url URL] [--exit-code n] [--screenshot-id id] [--cleanup-checked] [--note text] [--json]

Notes:
  Records a small runtime evidence shape. It does not start, stop, or inspect processes by itself.
`);
}

async function runtimeEvidence(args = []) {
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return runtimeUsage();
  const flags = parseSimpleFlags(args, new Set(['backend', 'claim', 'evidence-id', 'command', 'pid', 'port', 'url', 'exit-code', 'screenshot-id', 'started-at', 'stopped-at', 'cleanup-checked', 'note', 'truth', 'intent', 'json']));
  const evidence = buildRuntimeBackendEvidence({
    backend: flags.backend,
    claim: flags.claim,
    evidence_id: String(flags.evidence_id || `runtime-${timestampId()}`),
    command: String(flags.command || ''),
    cleanup_checked: Boolean(flags.cleanup_checked),
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
    stopped_at: String(flags.stopped_at || '')
  };
}

function runtimeDetailsHasVerification(details: AnyRecord = {}) {
  return Boolean(details.url || details.screenshot_id || details.pid !== null || details.port !== null || details.exit_code !== null || details.started_at || details.stopped_at);
}

function runtimeEvidenceNextAction(evidence) {
  if (evidence.truth_status === 'proven' || evidence.truth_status === 'verified') return 'attach this evidence to `yam proof` when making a runtime claim';
  if (evidence.claim === 'cleanup_verified' && !evidence.cleanup_checked) return 'rerun with --cleanup-checked only after process exit or intentional persistence is confirmed';
  if (evidence.backend === 'none' || evidence.backend === 'unknown') return 'record the actual runtime backend before claiming runtime verification';
  return 'add command output, screenshot id, pid/session id, or cleanup proof before upgrading the claim';
}

async function mission(args = []) {
  const subcommand = args[0] || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return missionUsage();
  if (subcommand === 'queue' || subcommand === 'patch') return missionQueue(args.slice(1));
  console.error(`unknown mission command: ${subcommand}`);
  return missionUsage();
}

function missionUsage() {
  console.log(`yam mission

Usage:
  yam mission queue [--lane-id id] [--agent-id id] [--status pending|applied|verified|blocked|reverted] [--scope text] [--changed file] [--depends-on lane] [--generated file] [--verification-hint text] [--rollback-hint text] [--before-check text] [--out file] [--truth status] [--json]

Notes:
  Produces a patch queue item for mission handoff/review. It does not run workers; persistence is opt-in with --out.
`);
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
    if (['json', 'full-page', 'requested', 'attempted', 'available', 'wait-loop', 'cleanup-checked', 'strict', 'preserved-state', 'states-checked', 'mobile-checked', 'responsive-checked', 'contrast-checked', 'accessibility-checked', 'cta-checked', 'direction-locked', 'reference-read'].includes(key)) {
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
  const absolute = path.resolve(expandHome(file));
  const buffer = await fsp.readFile(absolute);
  const stat = await fsp.stat(absolute);
  return {
    path: absolute,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    bytes: stat.size,
    dimensions: imageDimensions(buffer)
  };
}

function imageDimensions(buffer) {
  const png = pngDimensions(buffer);
  if (png) return png;
  const jpeg = jpegDimensions(buffer);
  if (jpeg) return jpeg;
  const gif = gifDimensions(buffer);
  if (gif) return gif;
  return 'unknown';
}

function pngDimensions(buffer) {
  if (buffer.length < 24) return '';
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return '';
  return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
}

function gifDimensions(buffer) {
  if (buffer.length < 10) return '';
  const signature = buffer.toString('ascii', 0, 6);
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return '';
  return `${buffer.readUInt16LE(6)}x${buffer.readUInt16LE(8)}`;
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return '';
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return '';
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < buffer.length) {
      return `${buffer.readUInt16BE(offset + 7)}x${buffer.readUInt16BE(offset + 5)}`;
    }
    offset += 2 + length;
  }
  return '';
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
  const aliases = new Set(['goal', 'route', 'truth', 'command', 'evidence', 'visual', 'runtime', 'runtime-backend', 'runtime-claim', 'runtime-evidence-id', 'runtime-command', 'cleanup-checked', 'runtime-note', 'runtime-backend-evidence', 'visual-provenance', 'mission-envelope', 'rollback-hint', 'media-proof', 'design-completion', 'cleanup', 'changed', 'skipped', 'blocked', 'assumed', 'assumption', 'unverified', 'from', 'format', 'out', 'file', 'json', 'require-runtime', 'require-real-runtime', 'require-tmux', 'require-visual']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      const [rawKey, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
      const key = rawKey.slice(2);
      if (!aliases.has(key)) continue;
      const normalizedKey = key.replace(/-/g, '_');
      if (key === 'json' || key.startsWith('require-') || key === 'cleanup-checked') {
        flags[normalizedKey] = true;
        continue;
      }
      const value = inlineValue ?? args[index + 1] ?? '';
      if (inlineValue === undefined) index += 1;
      if (['command', 'evidence', 'visual', 'runtime', 'runtime-backend-evidence', 'visual-provenance', 'mission-envelope', 'rollback-hint', 'media-proof', 'design-completion', 'changed', 'skipped', 'blocked', 'assumed', 'assumption', 'unverified'].includes(key)) {
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
  if (!flags.runtime_backend && !flags.runtime_claim && !flags.runtime_evidence_id && !flags.runtime_command && !flags.runtime_note && !flags.cleanup_checked) return [];
  return [JSON.stringify(buildRuntimeBackendEvidence({
    backend: flags.runtime_backend,
    claim: flags.runtime_claim,
    evidence_id: flags.runtime_evidence_id,
    command: flags.runtime_command,
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
  return ['command', 'evidence', 'visual', 'runtime', 'runtime_backend_evidence', 'visual_provenance', 'mission_envelope', 'rollback_hint', 'media_proof', 'design_completion', 'changed', 'skipped', 'blocked'].some((key) => arrayFlag(flags[key]).length > 0) || Boolean(flags.cleanup || flags.runtime_backend || flags.runtime_claim);
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
  console.log(`- $quick: ${result.commands.typecheck || result.commands.lint || result.commands.test || result.commands.build || 'Level 0 read/inspect; no command detected'}`);
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
  if (command === 'budget') return budget(process.argv[3]);
  if (command === 'measure') return measure(process.argv[3], process.argv.slice(4));
  if (command === 'tools') return tools(process.argv.slice(3));
  if (command === 'proof') return proof(process.argv.slice(3));
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
