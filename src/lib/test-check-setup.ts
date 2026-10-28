import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const OID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const LIMIT = 1024 * 1024;
const FILES = ['testing/policy.json', 'testing/yam-adapter.mjs', 'testing/yam-observations.mjs', 'testing/setup.json'];
const excluded = (file: string) => /^(?:\.git|\.yam|\.codex|\.agents|node_modules|dist|coverage|build|out|output|\.cache|\.next)(?:\/|$)/.test(file)
  || /(?:^|\/)\.(?:env|npmrc|pypirc|netrc)(?:\.|$)/.test(file) || /\.(?:tgz|log)$/.test(file);
const safePath = (file: string) => !!file && !path.isAbsolute(file) && !/[\\\x00-\x1f\x7f<>*]/.test(file)
  && !file.split('/').some(part => !part || part === '.' || part === '..');
const fail = (code: string): never => { throw new Error(code); };
function git(cwd: string, args: string[]) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * LIMIT, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  if (r.status !== 0 || r.error) fail('git_unavailable');
  return r.stdout;
}
function rootOf(cwd: string) { return fs.realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).trim()); }
function regular(file: string) {
  let current = path.parse(path.resolve(file)).root;
  for (const part of path.resolve(file).slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) fail('unsafe_setup_path');
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > LIMIT) fail('unsafe_setup_file');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}
const present = (file: string) => { try { fs.lstatSync(file); return true; } catch (error: any) { if (error.code === 'ENOENT') return false; throw error; } };

export function inspectTestCheckSetup(cwd: string) {
  try {
    const root = rootOf(cwd);
    const policies = ['testing/policy.json', '.yam/testing/policy.json'].filter(file => present(path.join(root, file)));
    const tracked = git(root, ['ls-files', '-z', '--', 'testing/policy.json', '.yam/testing/policy.json']).split('\0').filter(Boolean);
    if (tracked.some(file => !policies.includes(file))) fail('tracked_policy_missing');
    if (!policies.length) return { configuration_status: 'not_configured', policies, next_action: 'yam test-check init --json' };
    const policy = JSON.parse(regular(path.join(root, policies[0])));
    if (policy.schema !== 'yam.test-policy.v1' || ![undefined, 'draft', 'ready'].includes(policy.setup_status)) fail('invalid_policy');
    return { configuration_status: policy.setup_status === 'draft' ? 'draft' : 'configured', policies,
      next_action: policy.setup_status === 'draft' ? 'connect_project_observations_and_review_scenarios' : 'run_and_revalidate_test_check' };
  } catch { return { configuration_status: 'unavailable', policies: [], next_action: 'inspect_project_configuration' }; }
}

const adapter = `// Project-owned process bridge. Edit yam-observations.mjs to connect real tests.
import { spawnSync } from 'node:child_process';
import { observe } from './yam-observations.mjs';

function run(command, args = []) {
  if (typeof command !== 'string' || !command || !Array.isArray(args) || args.some(x => typeof x !== 'string')) throw Error('invalid_command');
  const result = spawnSync(command === '$NODE' ? process.execPath : command, args, {
    cwd: process.cwd(), encoding: 'utf8', shell: false, timeout: 120000, maxBuffer: 4 * 1024 * 1024
  });
  return { exit_code: result.error ? -1 : result.status ?? -1, stdout: result.stdout || '', stderr: result.stderr || '' };
}
try {
  const tests = await observe({ run });
  if (!Array.isArray(tests) || !tests.length) throw Error('missing_observations');
  process.stdout.write(JSON.stringify({ schema: 'yam.test-observation.v1', tests }));
  if (tests.some(test => test.status !== 'passed' || test.failed !== 0 || test.skipped !== 0)) process.exitCode = 1;
} catch {
  // Keep raw test output, environment values and exception messages out of notes.
  process.stdout.write(JSON.stringify({ schema: 'yam.test-observation.v1', tests: [] }));
  process.stderr.write('Project test observations are not connected or failed. Review testing/setup.json.\\n');
  process.exitCode = 1;
}
`;
const observer = `// Connect existing tests here; the initializer intentionally grants no approval.
// Use run(executable, args) to execute reviewed project commands without a shell.
// Parse their actual structured reports and map named cases to policy check IDs.
// Each observation needs id, target, scenario, evidence, status, measured tests,
// measured assertions, failed, skipped and mocked. Integration/E2E needs mocked:false.
// A suite total or exit code alone cannot prove every required workflow scenario.
// DB checks additionally need independently observed current environment identity.
// Never echo the policy/environment expectation as though it were an observation.
export async function observe({ run }) {
  void run;
  throw Error('project_observer_not_connected');
}
`;

type Contract = { infer: (file: string) => readonly string[]; requirements: Record<string, readonly string[]> };
export function initializeTestCheck(cwd: string, options: { base?: string; dryRun?: boolean }, contract: Contract) {
  const made: { file: string; dev: number; ino: number }[] = [];
  let createdDirectory = false, directory = '', lock = '', lockIdentity: fs.Stats | undefined;
  try {
    const root = rootOf(cwd);
    const state = inspectTestCheckSetup(root);
    if (state.configuration_status === 'unavailable') fail('unsafe_existing_configuration');
    if (state.configuration_status !== 'not_configured') return { ok: true, operation: 'PRESERVED', ...state, created: [], approval_granted: false,
      message: 'Existing policy preserved. Configuration is not test approval.' };
    const base = options.base ?? git(root, ['rev-parse', 'HEAD']).trim();
    if (!OID.test(base) || git(root, ['cat-file', '-t', base]).trim() !== 'commit') fail('exact_base_required');
    const inventory = [...new Set(git(root, ['ls-files', '-co', '--exclude-standard', '-z']).split('\0').filter(Boolean))];
    const files = inventory.filter(file => !excluded(file));
    if (files.length > 10000 || files.some(file => !safePath(file))) fail('source_inventory_limit_or_path');
    const byRisk = new Map<string, Set<string>>([['logic', new Set(['testing/**'])]]);
    for (const file of files) for (const risk of contract.infer(file)) {
      if (!Object.hasOwn(contract.requirements, risk)) fail('invalid_risk');
      const paths = byRisk.get(risk) ?? new Set<string>();
      paths.add(file.includes('/') ? file.split('/')[0] + '/**' : file);
      byRisk.set(risk, paths);
    }
    const surfaces = [...byRisk].sort(([a], [b]) => a.localeCompare(b)).map(([risk, paths]) => {
      if (paths.size > 128) fail('setup_path_limit');
      return { id: 'project-' + risk, paths: [...paths].sort(), risks: [risk], targets: ['project'],
        checks: contract.requirements[risk].map(scenario => ({ id: risk + '-' + scenario, target: 'project', scenario,
          explanation: '프로젝트 ' + risk + ' 변경의 ' + scenario + ' 실제 검증 연결 필요',
          evidence: risk === 'ui' ? 'e2e' : ['db', 'auth', 'api', 'release'].includes(risk) ? 'integration' : risk === 'docs' ? 'static' : 'unit',
          command: ['$NODE', 'testing/yam-adapter.mjs'], ...(risk === 'db' ? { environment: '.yam/testing/environment.json' } : {}) })) };
    });
    let scripts: { name: string; command: string[]; framework: string }[] = [];
    const packageFile = path.join(root, 'package.json');
    if (present(packageFile)) {
      const pkg = JSON.parse(regular(packageFile));
      if (pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)) {
        if (Object.keys(pkg.scripts).length > 256) fail('script_inventory_limit');
        scripts = Object.entries(pkg.scripts).filter(([name, value]) => /(?:^|[:_-])(?:test|tests|e2e|spec|verify)(?:$|[:_-])/.test(name)
          && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/.test(name) && !/(?:token|password|api[_-]?key|secret)\s*[:=]\s*\S{8,}|gh[pousr]_[A-Za-z0-9]{20}/i.test(name)
          && typeof value === 'string').map(([name, value]) => ({ name,
          command: ['npm', 'run', name], framework: /vitest/.test(String(value)) ? 'vitest' : /playwright/.test(String(value)) ? 'playwright'
            : /jest/.test(String(value)) ? 'jest' : /node\s+.*--test/.test(String(value)) ? 'node-test' : 'project-command' }));
      }
    }
    const configurationFiles = files.filter(file => /(?:^|\/)(?:vitest|playwright|jest)(?:[.][^/]+)*[.]config[.][^/]+$/.test(file)
      || /(?:^|\/)(?:pytest.ini|pyproject.toml)$/.test(file)).slice(0, 128);
    const setup = { schema: 'yam.test-setup.v1', configuration_status: 'draft', baseline: base,
      baseline_source: options.base ? 'provided' : 'current_head', discovered_scripts: scripts, configuration_files: configurationFiles,
      detected_risks: [...byRisk.keys()].sort(), discovery_limitations: ['Only repository paths and bounded package metadata were inspected; no project command was executed.',
        'Discovered commands are candidates, not authorization to run production or credential-bearing tasks.',
        'Broad draft paths must be narrowed and DB functions/roles/scenarios mapped by project review.'],
      required_actions: ['Review discovered commands and existing tests before executing them.', 'Map changed targets and named success/failure cases to policy checks.',
        'Implement testing/yam-observations.mjs using actual process reports and measured assertions; retain missing/skipped failures.',
        'For DB/runtime changes observe the real environment; do not replace it with mock/API totals.',
        'Set policy setup_status to ready only after review, then run and revalidate Test check using this baseline.'],
      next_commands: [['yam', 'test-check', 'plan', '--base', base, '--json'], ['yam', 'test-check', 'run', '--base', base, '--json'], ['yam', 'test-check', 'check', '--json']] };
    const contents = [JSON.stringify({ schema: 'yam.test-policy.v1', setup_status: 'draft', surfaces }, null, 2) + '\n', adapter, observer, JSON.stringify(setup, null, 2) + '\n'];
    directory = path.join(root, 'testing');
    if (present(directory)) { const s = fs.lstatSync(directory); if (!s.isDirectory() || s.isSymbolicLink()) fail('unsafe_setup_directory'); }
    for (const file of FILES) if (present(path.join(root, file))) fail('setup_file_exists');
    const result = { ok: true, operation: options.dryRun ? 'PREVIEW' : 'INITIALIZED', configuration_status: 'draft', approval_granted: false,
      gate_result: 'BLOCKED', baseline: base, discovered_scripts: scripts, detected_risks: setup.detected_risks, configuration_files: configurationFiles,
      created: options.dryRun ? [] : [...FILES], would_create: [...FILES], required_actions: setup.required_actions, next_commands: setup.next_commands };
    if (options.dryRun) return result;
    if (!present(directory)) { try { fs.mkdirSync(directory, { mode: 0o755 }); createdDirectory = true; } catch (error: any) { if (error.code !== 'EEXIST') throw error; } }
    const parent = fs.lstatSync(directory); if (!parent.isDirectory() || parent.isSymbolicLink()) fail('unsafe_setup_directory');
    lock = path.join(directory, '.yam-init.lock');
    const fd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    try { lockIdentity = fs.fstatSync(fd); } finally { fs.closeSync(fd); }
    for (let i = 0; i < FILES.length; i++) {
      const file = path.join(root, FILES[i]);
      const handle = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
      try { const s = fs.fstatSync(handle); made.push({ file, dev: s.dev, ino: s.ino }); fs.writeFileSync(handle, contents[i]); fs.fsyncSync(handle); }
      finally { fs.closeSync(handle); }
    }
    return result;
  } catch (error: any) {
    for (const own of made.reverse()) { try { const s = fs.lstatSync(own.file); if (s.isFile() && s.nlink === 1 && s.dev === own.dev && s.ino === own.ino) fs.unlinkSync(own.file); } catch { /* Preserve anything no longer provably owned. */ } }
    return { ok: false, operation: 'BLOCKED', approval_granted: false, errors: [/^[a-z_]{1,80}$/.test(error?.message || '') ? error.message : 'test_setup_failed'], created: [] };
  } finally {
    if (lockIdentity) { try { const s = fs.lstatSync(lock); if (s.isFile() && s.nlink === 1 && s.dev === lockIdentity.dev && s.ino === lockIdentity.ino) fs.unlinkSync(lock); } catch { /* Never remove someone else's lock. */ } }
    if (createdDirectory) { try { fs.rmdirSync(directory); } catch { /* Retain nonempty directories. */ } }
  }
}
