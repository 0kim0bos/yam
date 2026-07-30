import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const EXTERNAL_UPDATE_COMPONENTS = ['yam', 'scrapling', 'insane-search'] as const;
export type ExternalUpdateComponent = typeof EXTERNAL_UPDATE_COMPONENTS[number];

type JsonRecord = Record<string, any>;

export interface ExternalCommandResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface ExternalCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

export interface ExternalUpdatePaths {
  stateDir: string;
  receiptDir: string;
  lockFile: string;
  scraplingRoot: string;
  scraplingBin: string;
}

export interface ExternalUpdateDependencies {
  run?: (command: string, args: string[], options?: ExternalCommandOptions) => Promise<ExternalCommandResult> | ExternalCommandResult;
  fetchJson?: (url: string) => Promise<any>;
  now?: () => Date;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  paths?: Partial<ExternalUpdatePaths>;
  removeCandidate?: (candidate: string, root: string) => Promise<void>;
}

export interface ExternalComponentCheck {
  component: ExternalUpdateComponent;
  installed_version: string;
  latest_version: string;
  update_available: boolean;
  status: 'up_to_date' | 'update_available' | 'not_installed' | 'check_failed';
  source: string;
  source_revision?: {
    local: string;
    remote: string;
    drift: boolean;
    note: string;
  };
  executable?: string;
  error?: string;
}

export interface ExternalComponentReceipt {
  schema: 'yam.external-update-receipt.v1';
  generated_at: string;
  component: ExternalUpdateComponent;
  outcome: 'up_to_date' | 'updated' | 'failed' | 'manual_plugin_update_required';
  previous_version: string;
  requested_version: string;
  installed_version: string;
  source: string;
  source_revision: JsonRecord | null;
  checks: Array<{
    id: string;
    status: 'passed' | 'failed' | 'skipped';
    note: string;
  }>;
  rollback_hint: {
    automatic: boolean;
    previous_target: string;
    guidance: string;
  };
  side_effects: string[];
  error: string;
  truth_status: 'verified' | 'partial' | 'blocked';
  persistence?: 'written' | 'failed';
  receipt_path?: string;
  receipt_error?: string;
}

interface ResolvedDependencies {
  run: NonNullable<ExternalUpdateDependencies['run']>;
  fetchJson: NonNullable<ExternalUpdateDependencies['fetchJson']>;
  now: NonNullable<ExternalUpdateDependencies['now']>;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  paths: ExternalUpdatePaths;
  removeCandidate: NonNullable<ExternalUpdateDependencies['removeCandidate']>;
}

interface ReceiptWriteResult {
  path: string;
  error: string;
}

const YAM_REGISTRY_URL = 'https://registry.npmjs.org/yam-flow/latest';
const SCRAPLING_PYPI_URL = 'https://pypi.org/pypi/scrapling/json';
const INSANE_MARKETPLACE = 'gptaku-codex';
const INSANE_PLUGIN_ID = 'insane-search-codex@gptaku-codex';
const INSANE_MARKETPLACE_SOURCE = 'https://github.com/fivetaku/gptaku-plugins-codex.git';
const INSANE_MANIFEST_ROOT = 'https://raw.githubusercontent.com/fivetaku/gptaku-plugins-codex';
const INSANE_MANIFEST_PATH = 'plugins/insane-search-codex/.codex-plugin/plugin.json';
const UPDATE_ORDER: ExternalUpdateComponent[] = ['scrapling', 'insane-search', 'yam'];

export async function checkExternalUpdates(
  currentYamVersion: string,
  dependencies: ExternalUpdateDependencies = {}
) {
  const deps = await resolveDependencies(dependencies);
  const checks = await Promise.all([
    checkYam(currentYamVersion, deps),
    checkScrapling(deps),
    checkInsaneSearch(deps)
  ]);
  const failed = checks.filter((item) => item.status === 'check_failed');
  return {
    schema: 'yam.external-update-check.v1',
    generated_at: deps.now().toISOString(),
    mutation_authorized: false,
    components: checks,
    update_available: checks.some((item) => item.update_available),
    success: failed.length === 0,
    truth_status: failed.length ? 'partial' : 'verified',
    next_action: failed.length
      ? 'resolve the failed read-only checks before applying updates'
      : checks.some((item) => item.update_available)
        ? 'review the component versions, then explicitly run `yam update apply --component <name>` or `yam update apply --all`'
        : 'no update action is needed'
  };
}

export async function applyExternalUpdates(
  currentYamVersion: string,
  selection: { component?: ExternalUpdateComponent; all?: boolean },
  dependencies: ExternalUpdateDependencies = {}
) {
  const deps = await resolveDependencies(dependencies);
  const components = selection.all
    ? UPDATE_ORDER
    : selection.component && EXTERNAL_UPDATE_COMPONENTS.includes(selection.component)
      ? [selection.component]
      : [];
  if (components.length === 0) {
    throw new Error('choose exactly one of --component yam|scrapling|insane-search or --all');
  }

  let lockHandle: fsp.FileHandle | null = null;
  let lockReleased = false;
  const receipts: ExternalComponentReceipt[] = [];
  try {
    lockHandle = await acquireApplyLock(deps);
    for (const component of components) {
      const receipt = component === 'yam'
        ? await applyYam(currentYamVersion, deps)
        : component === 'scrapling'
          ? await applyScrapling(deps)
          : await applyInsaneSearch(deps);
      receipts.push(receipt);
      if (
        receipt.outcome === 'failed'
        || receipt.outcome === 'manual_plugin_update_required'
        || receipt.persistence === 'failed'
      ) break;
    }
  } finally {
    if (lockHandle) {
      try {
        await lockHandle.close();
      } catch {
        // Lock-file removal below is the observable cleanup boundary.
      }
      try {
        await fsp.unlink(deps.paths.lockFile);
        lockReleased = true;
      } catch {
        lockReleased = false;
      }
    }
  }

  const failed = receipts.some((receipt) => (
    receipt.outcome === 'failed'
    || receipt.outcome === 'manual_plugin_update_required'
    || receipt.persistence === 'failed'
  ));
  const incomplete = receipts.length !== components.length;
  return {
    schema: 'yam.external-update-apply.v1',
    generated_at: deps.now().toISOString(),
    mutation_authorized: true,
    requested_components: components,
    applied_components: receipts.map((receipt) => receipt.component),
    receipts,
    stopped_early: incomplete,
    lock: {
      path: deps.paths.lockFile,
      released: lockReleased
    },
    success: !failed && !incomplete && lockReleased,
    truth_status: failed || incomplete || !lockReleased ? 'blocked' : 'verified',
    next_action: failed
      ? firstFailureNextAction(receipts)
      : !lockReleased
        ? `confirm no updater is running, inspect the stale lock, then remove it manually: ${deps.paths.lockFile}`
        : 'review the component receipts and restart Codex only if yam skills or a Codex plugin changed'
  };
}

async function resolveDependencies(input: ExternalUpdateDependencies): Promise<ResolvedDependencies> {
  const homeDir = path.resolve(input.homeDir || os.homedir());
  const env = { ...process.env, ...(input.env || {}) };
  const run = input.run || defaultRun;
  const stateDir = path.resolve(input.paths?.stateDir || env.YAM_UPDATE_STATE_DIR || path.join(homeDir, '.local', 'state', 'yam'));
  const scraplingRoot = path.resolve(input.paths?.scraplingRoot || env.YAM_SCRAPLING_ROOT || path.join(homeDir, '.local', 'share', 'scrapling'));
  const explicitBin = input.paths?.scraplingBin || env.YAM_SCRAPLING_BIN || '';
  const scraplingBin = explicitBin
    ? path.resolve(expandHome(explicitBin, homeDir))
    : await discoverScraplingBin(homeDir, run, env);
  const receiptDir = path.resolve(input.paths?.receiptDir || env.YAM_UPDATE_RECEIPT_DIR || path.join(stateDir, 'update-receipts'));
  const lockFile = path.resolve(input.paths?.lockFile || env.YAM_UPDATE_LOCK_FILE || path.join(stateDir, 'external-update.lock'));
  return {
    run,
    fetchJson: input.fetchJson || defaultFetchJson,
    now: input.now || (() => new Date()),
    homeDir,
    env,
    removeCandidate: input.removeCandidate || removeCreatedCandidate,
    paths: {
      stateDir,
      receiptDir,
      lockFile,
      scraplingRoot,
      scraplingBin
    }
  };
}

async function discoverScraplingBin(
  homeDir: string,
  run: ResolvedDependencies['run'],
  env: NodeJS.ProcessEnv
) {
  const which = await run('which', ['scrapling'], { env, timeout: 10000 });
  const discovered = which.ok ? String(which.stdout || '').trim().split(/\r?\n/)[0] : '';
  if (discovered && path.isAbsolute(discovered)) return path.resolve(discovered);
  const candidates = [
    path.join(homeDir, '.homebrew', 'bin', 'scrapling'),
    path.join(homeDir, '.local', 'bin', 'scrapling')
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return candidates[1];
}

async function acquireApplyLock(deps: ResolvedDependencies) {
  await fsp.mkdir(path.dirname(deps.paths.lockFile), { recursive: true });
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(deps.paths.lockFile, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`another external update may be running; inspect the lock before retrying: ${deps.paths.lockFile}`);
    }
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({
      schema: 'yam.external-update-lock.v1',
      pid: process.pid,
      created_at: deps.now().toISOString()
    })}\n`, 'utf8');
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlinkIfExists(deps.paths.lockFile).catch(() => undefined);
    throw error;
  }
  return handle;
}

async function checkYam(currentYamVersion: string, deps: ResolvedDependencies): Promise<ExternalComponentCheck> {
  try {
    const data = await deps.fetchJson(YAM_REGISTRY_URL);
    const latest = requireStableVersion(data?.version, 'yam registry version');
    const installed = requireStableVersion(currentYamVersion, 'installed yam version');
    return componentCheck('yam', installed, latest, 'npm:yam-flow');
  } catch (error) {
    return failedCheck('yam', currentYamVersion, 'npm:yam-flow', error);
  }
}

async function checkScrapling(deps: ResolvedDependencies): Promise<ExternalComponentCheck> {
  try {
    const data = await deps.fetchJson(SCRAPLING_PYPI_URL);
    const latest = requireStableVersion(data?.info?.version, 'Scrapling PyPI version');
    const executable = deps.paths.scraplingBin;
    const versionResult = await deps.run(executable, ['--version'], { env: deps.env, timeout: 30000 });
    if (!versionResult.ok) {
      return {
        component: 'scrapling',
        installed_version: '',
        latest_version: latest,
        update_available: true,
        status: 'not_installed',
        source: 'pypi:scrapling',
        executable
      };
    }
    const installed = requireStableVersion(extractVersion(versionResult.stdout), 'installed Scrapling version');
    return {
      ...componentCheck('scrapling', installed, latest, 'pypi:scrapling'),
      executable
    };
  } catch (error) {
    return failedCheck('scrapling', '', 'pypi:scrapling', error);
  }
}

async function checkInsaneSearch(deps: ResolvedDependencies): Promise<ExternalComponentCheck> {
  try {
    const remoteRevisionResult = await deps.run('git', ['ls-remote', INSANE_MARKETPLACE_SOURCE, 'HEAD'], {
      env: deps.env,
      timeout: 30000
    });
    if (!remoteRevisionResult.ok) {
      throw new Error(`could not resolve official Insane Search source revision: ${commandNote(remoteRevisionResult)}`);
    }
    const remoteRevision = remoteRevisionResult.stdout.trim().split(/\s+/)[0] || '';
    if (!/^[0-9a-f]{40}$/i.test(remoteRevision)) {
      throw new Error('official Insane Search source did not return a pinned 40-character Git revision');
    }
    const manifestUrl = `${INSANE_MANIFEST_ROOT}/${remoteRevision}/${INSANE_MANIFEST_PATH}`;
    const [manifest, pluginList, marketplaceList] = await Promise.all([
      deps.fetchJson(manifestUrl),
      deps.run('codex', ['plugin', 'list', '--json'], { env: deps.env, timeout: 30000 }),
      deps.run('codex', ['plugin', 'marketplace', 'list', '--json'], { env: deps.env, timeout: 30000 })
    ]);
    if (!pluginList.ok) throw new Error(`codex plugin list failed: ${commandNote(pluginList)}`);
    if (!marketplaceList.ok) throw new Error(`codex plugin marketplace list failed: ${commandNote(marketplaceList)}`);
    const latest = requireStableVersion(manifest?.version, 'Insane Search manifest version');
    const parsedPlugins = parseJsonOutput(pluginList.stdout, 'codex plugin list');
    const installedEntry = arrayValue(parsedPlugins?.installed).find((item) => item?.pluginId === INSANE_PLUGIN_ID);
    const installed = installedEntry?.version
      ? requireStableVersion(installedEntry.version, 'installed Insane Search version')
      : '';

    let localRevision = '';
    const parsedMarketplaces = parseJsonOutput(marketplaceList.stdout, 'codex plugin marketplace list');
    const marketplaceEntry = arrayValue(parsedMarketplaces?.marketplaces).find((item) => item?.name === INSANE_MARKETPLACE);
    if (!marketplaceEntry) {
      throw new Error(`required Codex marketplace is not configured: ${INSANE_MARKETPLACE}`);
    }
    const configuredSource = String(marketplaceEntry?.marketplaceSource?.source || '');
    if (
      marketplaceEntry?.marketplaceSource?.sourceType !== 'git'
      || configuredSource !== INSANE_MARKETPLACE_SOURCE
    ) {
      throw new Error(`refusing unexpected ${INSANE_MARKETPLACE} marketplace source`);
    }
    const marketplaceRoot = String(marketplaceEntry.root || '');
    if (!marketplaceRoot || !isSafeMarketplaceRoot(marketplaceRoot, deps.homeDir)) {
      throw new Error(`refusing unsafe ${INSANE_MARKETPLACE} marketplace root`);
    }
    const localRevisionResult = await deps.run('git', ['-C', marketplaceRoot, 'rev-parse', 'HEAD'], {
      env: deps.env,
      timeout: 30000
    });
    if (!localRevisionResult.ok) {
      throw new Error(`could not read local ${INSANE_MARKETPLACE} revision: ${commandNote(localRevisionResult)}`);
    }
    localRevision = localRevisionResult.stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(localRevision)) {
      throw new Error(`local ${INSANE_MARKETPLACE} revision is not a 40-character Git revision`);
    }
    const base = installed
      ? componentCheck('insane-search', installed, latest, `git:${INSANE_MARKETPLACE_SOURCE}`)
      : {
          component: 'insane-search' as const,
          installed_version: '',
          latest_version: latest,
          update_available: true,
          status: 'not_installed' as const,
          source: `git:${INSANE_MARKETPLACE_SOURCE}`
        };
    return {
      ...base,
      source_revision: {
        local: localRevision,
        remote: remoteRevision,
        drift: Boolean(localRevision && remoteRevision && localRevision !== remoteRevision),
        note: installed && compareVersions(installed, latest) === 0
          ? 'marketplace revision drift alone is not treated as an Insane Search update'
          : 'plugin update availability is based on the official plugin manifest version'
      }
    };
  } catch (error) {
    return failedCheck('insane-search', '', `git:${INSANE_MARKETPLACE_SOURCE}`, error);
  }
}

function componentCheck(
  component: ExternalUpdateComponent,
  installed: string,
  latest: string,
  source: string
): ExternalComponentCheck {
  const updateAvailable = compareVersions(installed, latest) < 0;
  return {
    component,
    installed_version: installed,
    latest_version: latest,
    update_available: updateAvailable,
    status: updateAvailable ? 'update_available' : 'up_to_date',
    source
  };
}

function failedCheck(
  component: ExternalUpdateComponent,
  installed: string,
  source: string,
  error: unknown
): ExternalComponentCheck {
  return {
    component,
    installed_version: installed,
    latest_version: '',
    update_available: false,
    status: 'check_failed',
    source,
    error: errorMessage(error)
  };
}

async function applyYam(currentYamVersion: string, deps: ResolvedDependencies) {
  const check = await checkYam(currentYamVersion, deps);
  if (check.status === 'check_failed') return persistFailureFromCheck(check, deps);
  if (!check.update_available) {
    return persistReceipt(baseReceipt(check, 'up_to_date', [], {
      automatic: true,
      previous_target: check.installed_version,
      guidance: 'No rollback is needed because no mutation ran.'
    }), deps);
  }

  const checks: ExternalComponentReceipt['checks'] = [];
  const sideEffects: string[] = [];
  const exactPackage = `yam-flow@${check.latest_version}`;
  const install = await deps.run('npm', ['install', '-g', exactPackage], {
    env: deps.env,
    timeout: 600000
  });
  checks.push(commandCheck('npm_global_install', install));
  if (!install.ok) {
    return persistReceipt(baseReceipt(check, 'failed', checks, yamRollback(check.installed_version), {
      error: `global yam install failed: ${commandNote(install)}`
    }), deps);
  }
  sideEffects.push(`globally installed ${exactPackage}`);

  const postCommands: Array<[string, string[]]> = [
    ['yam_install_skills', ['install']],
    ['yam_version', ['version']],
    ['yam_status', ['status']]
  ];
  let postFailure = '';
  for (const [id, args] of postCommands) {
    const result = await deps.run('yam', args, { env: deps.env, timeout: 180000 });
    checks.push(commandCheck(id, result));
    if (!result.ok || (id === 'yam_version' && extractVersion(result.stdout) !== check.latest_version)) {
      postFailure = `${id} failed: ${commandNote(result)}`;
      break;
    }
  }
  if (postFailure) {
    const rollback = await rollbackYam(check.installed_version, deps, checks);
    return persistReceipt(baseReceipt(check, 'failed', checks, {
      ...yamRollback(check.installed_version),
      automatic: rollback
    }, {
      side_effects: sideEffects,
      error: postFailure
    }), deps);
  }

  const receipt = baseReceipt(check, 'updated', checks, yamRollback(check.installed_version), {
    installed_version: check.latest_version,
    side_effects: sideEffects,
    truth_status: 'verified'
  });
  const persisted = await persistReceipt(receipt, deps);
  if (persisted.persistence === 'failed') {
    const rollback = await rollbackYam(check.installed_version, deps, persisted.checks);
    persisted.rollback_hint.automatic = rollback;
    persisted.outcome = 'failed';
    persisted.truth_status = 'blocked';
    persisted.error = `update completed but receipt persistence failed; automatic rollback ${rollback ? 'passed' : 'failed'}`;
  }
  return persisted;
}

async function rollbackYam(
  previousVersion: string,
  deps: ResolvedDependencies,
  checks: ExternalComponentReceipt['checks']
) {
  if (!previousVersion) return false;
  const result = await deps.run('npm', ['install', '-g', `yam-flow@${previousVersion}`], {
    env: deps.env,
    timeout: 600000
  });
  checks.push(commandCheck('automatic_yam_rollback', result));
  if (!result.ok) return false;
  const install = await deps.run('yam', ['install'], { env: deps.env, timeout: 180000 });
  const version = await deps.run('yam', ['version'], { env: deps.env, timeout: 30000 });
  const status = await deps.run('yam', ['status'], { env: deps.env, timeout: 120000 });
  checks.push(commandCheck('automatic_yam_rollback_skills', install));
  checks.push(commandCheck('automatic_yam_rollback_version', version));
  checks.push(commandCheck('automatic_yam_rollback_status', status));
  return install.ok && version.ok && extractVersion(version.stdout) === previousVersion && status.ok;
}

async function applyScrapling(deps: ResolvedDependencies) {
  const check = await checkScrapling(deps);
  if (check.status === 'check_failed') return persistFailureFromCheck(check, deps);
  if (!check.update_available) {
    return persistReceipt(baseReceipt(check, 'up_to_date', [], {
      automatic: true,
      previous_target: await readSymlinkTarget(deps.paths.scraplingBin),
      guidance: 'No rollback is needed because no mutation ran.'
    }), deps);
  }

  const checks: ExternalComponentReceipt['checks'] = [];
  const sideEffects: string[] = [];
  let previousTarget = '';
  let candidate = '';
  let linkSwitched = false;
  let candidateCreated = false;
  try {
    previousTarget = await validateManagedScraplingLink(deps);
    await fsp.mkdir(deps.paths.scraplingRoot, { recursive: true });
    const suffix = `${safeTimestamp(deps.now())}-${randomUUID().slice(0, 8)}`;
    candidate = path.join(deps.paths.scraplingRoot, `${check.latest_version}-yam-${suffix}`);
    assertChildPath(deps.paths.scraplingRoot, candidate, 'Scrapling candidate');
    const python = String(deps.env.YAM_SCRAPLING_PYTHON || 'python3');
    const venv = await deps.run(python, ['-m', 'venv', candidate], { env: deps.env, timeout: 180000 });
    checks.push(commandCheck('create_versioned_venv', venv));
    candidateCreated = await pathExists(candidate);
    if (!venv.ok || !candidateCreated) throw new Error(`could not create Scrapling venv: ${commandNote(venv)}`);
    sideEffects.push(`created versioned environment ${candidate}`);

    const candidatePython = path.join(candidate, 'bin', 'python');
    const candidateScrapling = path.join(candidate, 'bin', 'scrapling');
    const packageSpec = `scrapling[fetchers]==${check.latest_version}`;
    const install = await deps.run(candidatePython, ['-m', 'pip', 'install', packageSpec], {
      env: deps.env,
      timeout: 600000
    });
    checks.push(commandCheck('install_exact_scrapling', install));
    if (!install.ok) throw new Error(`Scrapling install failed: ${commandNote(install)}`);

    const browsers = await deps.run(candidateScrapling, ['install', '--force'], {
      env: deps.env,
      timeout: 600000
    });
    checks.push(commandCheck('install_browser_dependencies', browsers));
    if (!browsers.ok) throw new Error(`Scrapling browser install failed: ${commandNote(browsers)}`);
    sideEffects.push('Scrapling browser dependencies may update the user Playwright cache.');

    const pipCheck = await deps.run(candidatePython, ['-m', 'pip', 'check'], {
      env: deps.env,
      timeout: 120000
    });
    checks.push(commandCheck('pip_check', pipCheck));
    if (!pipCheck.ok) throw new Error(`Scrapling pip check failed: ${commandNote(pipCheck)}`);

    const httpOutput = path.join(candidate, '.yam-http-smoke.txt');
    const browserOutput = path.join(candidate, '.yam-browser-smoke.txt');
    const httpSmoke = await deps.run(candidateScrapling, [
      'extract', 'get', 'https://example.com', httpOutput, '--css-selector', 'h1', '--timeout', '30'
    ], { env: deps.env, timeout: 120000 });
    checks.push(commandCheck('http_smoke', httpSmoke));
    if (!httpSmoke.ok || !await fileContains(httpOutput, 'Example Domain')) {
      throw new Error(`Scrapling HTTP smoke failed: ${commandNote(httpSmoke)}`);
    }
    const browserSmoke = await deps.run(candidateScrapling, [
      'extract', 'stealthy-fetch', 'https://example.com', browserOutput,
      '--css-selector', 'h1', '--headless', '--timeout', '30000'
    ], { env: deps.env, timeout: 180000 });
    checks.push(commandCheck('browser_smoke', browserSmoke));
    if (!browserSmoke.ok || !await fileContains(browserOutput, 'Example Domain')) {
      throw new Error(`Scrapling browser smoke failed: ${commandNote(browserSmoke)}`);
    }
    await unlinkIfExists(httpOutput);
    await unlinkIfExists(browserOutput);

    const directVersion = await deps.run(candidateScrapling, ['--version'], { env: deps.env, timeout: 30000 });
    checks.push(commandCheck('candidate_version', directVersion));
    if (!directVersion.ok || extractVersion(directVersion.stdout) !== check.latest_version) {
      throw new Error(`candidate Scrapling version mismatch: ${commandNote(directVersion)}`);
    }

    await fsp.writeFile(path.join(candidate, '.yam-scrapling-install.json'), `${JSON.stringify({
      schema: 'yam.scrapling-install.v1',
      version: check.latest_version,
      created_at: deps.now().toISOString(),
      executable: candidateScrapling
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const currentTarget = await validateManagedScraplingLink(deps);
    if (currentTarget !== previousTarget) {
      throw new Error('Scrapling executable changed during the update; refusing the symlink switch');
    }
    await atomicSwitchSymlink(deps.paths.scraplingBin, candidateScrapling);
    linkSwitched = true;
    sideEffects.push(`atomically switched ${deps.paths.scraplingBin}`);

    const linkedVersion = await deps.run(deps.paths.scraplingBin, ['--version'], {
      env: deps.env,
      timeout: 30000
    });
    checks.push(commandCheck('linked_version', linkedVersion));
    if (!linkedVersion.ok || extractVersion(linkedVersion.stdout) !== check.latest_version) {
      throw new Error(`linked Scrapling version mismatch: ${commandNote(linkedVersion)}`);
    }

    const receipt = baseReceipt(check, 'updated', checks, scraplingRollback(previousTarget, deps.paths.scraplingBin), {
      installed_version: check.latest_version,
      side_effects: sideEffects,
      truth_status: 'verified'
    });
    const persisted = await persistReceipt(receipt, deps);
    if (persisted.persistence === 'failed') {
      const rolledBack = await restoreScraplingLink(deps.paths.scraplingBin, previousTarget);
      persisted.rollback_hint.automatic = rolledBack;
      persisted.outcome = 'failed';
      persisted.truth_status = 'blocked';
      persisted.error = `receipt persistence failed; symlink rollback ${rolledBack ? 'passed' : 'failed'}`;
      persisted.side_effects.push(`receipt failure triggered symlink rollback: ${rolledBack ? 'passed' : 'failed'}`);
    }
    return persisted;
  } catch (error) {
    let rolledBack = false;
    let cleanupError = '';
    if (linkSwitched) rolledBack = await restoreScraplingLink(deps.paths.scraplingBin, previousTarget);
    if (candidateCreated && !linkSwitched) {
      try {
        await deps.removeCandidate(candidate, deps.paths.scraplingRoot);
        sideEffects.push(`removed failed transaction-created environment ${candidate}`);
      } catch (candidateError) {
        cleanupError = errorMessage(candidateError);
        sideEffects.push(`failed transaction-created environment retained for inspection: ${candidate}`);
      }
    }
    const rollbackHint = scraplingRollback(previousTarget, deps.paths.scraplingBin);
    if (cleanupError) {
      rollbackHint.guidance = `${rollbackHint.guidance} Inspect and remove only the failed yam candidate after confirming no process uses it: ${candidate}`;
    }
    const receipt = baseReceipt(check, 'failed', checks, {
      ...rollbackHint,
      automatic: linkSwitched ? rolledBack : !cleanupError
    }, {
      side_effects: sideEffects,
      error: cleanupError
        ? `${errorMessage(error)}; candidate cleanup also failed: ${cleanupError}`
        : errorMessage(error)
    });
    return persistReceipt(receipt, deps);
  }
}

async function applyInsaneSearch(deps: ResolvedDependencies) {
  const check = await checkInsaneSearch(deps);
  if (check.status === 'check_failed') return persistFailureFromCheck(check, deps);
  if (!check.update_available) {
    return persistReceipt(baseReceipt(check, 'up_to_date', [], {
      automatic: false,
      previous_target: check.installed_version,
      guidance: 'No rollback is needed because no plugin mutation ran.'
    }), deps);
  }

  const checks: ExternalComponentReceipt['checks'] = [];
  const upgrade = await deps.run('codex', ['plugin', 'marketplace', 'upgrade', INSANE_MARKETPLACE, '--json'], {
    env: deps.env,
    timeout: 180000
  });
  checks.push(commandCheck('marketplace_upgrade', upgrade));
  if (!upgrade.ok) {
    return persistReceipt(baseReceipt(check, 'failed', checks, insaneRollback(check.installed_version), {
      error: `marketplace upgrade failed: ${commandNote(upgrade)}`
    }), deps);
  }

  let observation = await installedInsaneVersion(deps, checks, 'plugin_list_after_marketplace_upgrade');
  if (!observation.ok) {
    return persistReceipt(baseReceipt(check, 'failed', checks, insaneRollback(check.installed_version), {
      installed_version: check.installed_version,
      side_effects: ['The official Codex marketplace snapshot was upgraded; plugin state could not be observed, so no add command ran.'],
      error: observation.error
    }), deps);
  }
  let installedAfter = observation.version;
  if (installedAfter !== check.latest_version) {
    const add = await deps.run('codex', ['plugin', 'add', INSANE_PLUGIN_ID, '--json'], {
      env: deps.env,
      timeout: 180000
    });
    checks.push(commandCheck('official_plugin_add_in_place', add));
    if (!add.ok) {
      return persistReceipt(baseReceipt(check, 'manual_plugin_update_required', checks, insaneRollback(check.installed_version), {
        installed_version: installedAfter || check.installed_version,
        side_effects: ['The official Codex marketplace snapshot was upgraded; no plugin cache was edited directly.'],
        error: `Codex did not support a safe in-place plugin update: ${commandNote(add)}`
      }), deps);
    }
    observation = await installedInsaneVersion(deps, checks, 'plugin_list_after_add');
    if (!observation.ok) {
      return persistReceipt(baseReceipt(check, 'manual_plugin_update_required', checks, insaneRollback(check.installed_version), {
        installed_version: check.installed_version,
        side_effects: ['The official Codex marketplace snapshot and plugin add command ran, but final plugin state could not be observed.'],
        error: observation.error
      }), deps);
    }
    installedAfter = observation.version;
  }

  if (installedAfter !== check.latest_version) {
    return persistReceipt(baseReceipt(check, 'manual_plugin_update_required', checks, insaneRollback(check.installed_version), {
      installed_version: installedAfter || check.installed_version,
      side_effects: ['The official Codex marketplace snapshot was upgraded; no plugin cache was edited directly.'],
      error: `official CLI finished without installing expected version ${check.latest_version}`
    }), deps);
  }

  return persistReceipt(baseReceipt(check, 'updated', checks, insaneRollback(check.installed_version), {
    installed_version: installedAfter,
    side_effects: [
      `upgraded official marketplace ${INSANE_MARKETPLACE}`,
      `updated ${INSANE_PLUGIN_ID} only through the official Codex CLI`
    ],
    truth_status: 'verified'
  }), deps);
}

async function installedInsaneVersion(
  deps: ResolvedDependencies,
  checks: ExternalComponentReceipt['checks'],
  id: string
) {
  const result = await deps.run('codex', ['plugin', 'list', '--json'], { env: deps.env, timeout: 30000 });
  checks.push(commandCheck(id, result));
  if (!result.ok) {
    return {
      ok: false,
      version: '',
      error: `${id} failed; refusing a plugin mutation without observed state: ${commandNote(result)}`
    };
  }
  try {
    const parsed = parseJsonOutput(result.stdout, 'codex plugin list');
    const entry = arrayValue(parsed?.installed).find((item) => item?.pluginId === INSANE_PLUGIN_ID);
    return {
      ok: true,
      version: entry?.version ? requireStableVersion(entry.version, 'installed Insane Search version') : '',
      error: ''
    };
  } catch (error) {
    return {
      ok: false,
      version: '',
      error: `${id} returned unreadable plugin state; refusing a plugin mutation: ${errorMessage(error)}`
    };
  }
}

function baseReceipt(
  check: ExternalComponentCheck,
  outcome: ExternalComponentReceipt['outcome'],
  checks: ExternalComponentReceipt['checks'],
  rollbackHint: ExternalComponentReceipt['rollback_hint'],
  overrides: Partial<ExternalComponentReceipt> = {}
): ExternalComponentReceipt {
  return {
    schema: 'yam.external-update-receipt.v1',
    generated_at: new Date().toISOString(),
    component: check.component,
    outcome,
    previous_version: check.installed_version,
    requested_version: check.latest_version,
    installed_version: check.installed_version,
    source: check.source,
    source_revision: receiptSourceRevision(check),
    checks,
    rollback_hint: rollbackHint,
    side_effects: [],
    error: '',
    truth_status: outcome === 'failed' || outcome === 'manual_plugin_update_required' ? 'blocked' : 'verified',
    ...overrides
  };
}

function receiptSourceRevision(check: ExternalComponentCheck) {
  if (check.source_revision) return check.source_revision;
  if (check.component === 'yam') {
    return {
      kind: 'npm_registry_release',
      package: 'yam-flow',
      version: check.latest_version
    };
  }
  if (check.component === 'scrapling') {
    return {
      kind: 'pypi_release',
      package: 'scrapling',
      version: check.latest_version
    };
  }
  return null;
}

async function persistFailureFromCheck(check: ExternalComponentCheck, deps: ResolvedDependencies) {
  return persistReceipt(baseReceipt(check, 'failed', [{
    id: 'update_check',
    status: 'failed',
    note: check.error || 'component update check failed'
  }], genericRollback(check), {
    error: check.error || 'component update check failed'
  }), deps);
}

async function persistReceipt(receipt: ExternalComponentReceipt, deps: ResolvedDependencies) {
  receipt.generated_at = deps.now().toISOString();
  const write = await safeWriteReceipt(receipt, deps);
  if (write.error) {
    receipt.persistence = 'failed';
    receipt.receipt_error = write.error;
    receipt.truth_status = 'blocked';
  } else {
    receipt.persistence = 'written';
    receipt.receipt_path = write.path;
  }
  return receipt;
}

async function safeWriteReceipt(
  receipt: ExternalComponentReceipt,
  deps: ResolvedDependencies
): Promise<ReceiptWriteResult> {
  let temporary = '';
  try {
    await fsp.mkdir(deps.paths.receiptDir, { recursive: true });
    const name = `${safeTimestamp(deps.now())}-${receipt.component}-${randomUUID().slice(0, 8)}.json`;
    const target = path.join(deps.paths.receiptDir, name);
    assertChildPath(deps.paths.receiptDir, target, 'update receipt');
    temporary = `${target}.tmp`;
    await fsp.writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });
    await fsp.rename(temporary, target);
    return { path: target, error: '' };
  } catch (error) {
    if (temporary) await unlinkIfExists(temporary).catch(() => undefined);
    return { path: '', error: errorMessage(error) };
  }
}

async function validateManagedScraplingLink(deps: ResolvedDependencies) {
  const bin = deps.paths.scraplingBin;
  let stat;
  try {
    stat = await fsp.lstat(bin);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
  if (!stat.isSymbolicLink()) {
    throw new Error(`refusing to replace non-symlink Scrapling executable: ${bin}`);
  }
  const rawTarget = await fsp.readlink(bin);
  const resolvedTarget = path.resolve(path.dirname(bin), rawTarget);
  assertChildPath(deps.paths.scraplingRoot, resolvedTarget, 'existing Scrapling executable');
  if (path.basename(resolvedTarget) !== 'scrapling' || path.basename(path.dirname(resolvedTarget)) !== 'bin') {
    throw new Error(`existing Scrapling link is outside the managed versioned layout: ${bin} -> ${resolvedTarget}`);
  }
  const environmentName = path.basename(path.dirname(path.dirname(resolvedTarget)));
  if (!/^\d+(?:\.\d+){1,3}(?:-yam-[0-9a-z-]+)?$/.test(environmentName)) {
    throw new Error(`existing Scrapling environment is not versioned: ${environmentName}`);
  }
  const realRoot = await fsp.realpath(deps.paths.scraplingRoot);
  const realTarget = await fsp.realpath(resolvedTarget);
  assertChildPath(realRoot, realTarget, 'existing Scrapling real executable');
  const environmentDir = path.dirname(path.dirname(resolvedTarget));
  const markerFile = path.join(environmentDir, '.yam-scrapling-install.json');
  let marker: JsonRecord;
  try {
    marker = JSON.parse(await fsp.readFile(markerFile, 'utf8'));
  } catch {
    throw new Error(`existing Scrapling environment lacks a readable yam ownership marker: ${markerFile}`);
  }
  const markerVersion = requireStableVersion(marker?.version, 'Scrapling ownership marker version');
  if (
    marker?.schema !== 'yam.scrapling-install.v1'
    || path.resolve(String(marker?.executable || '')) !== resolvedTarget
    || extractVersion(environmentName) !== markerVersion
  ) {
    throw new Error(`existing Scrapling ownership marker does not match the executable: ${markerFile}`);
  }
  return resolvedTarget;
}

async function atomicSwitchSymlink(link: string, target: string) {
  await fsp.mkdir(path.dirname(link), { recursive: true });
  const temporary = `${link}.yam-update-${randomUUID().slice(0, 8)}`;
  await fsp.symlink(target, temporary);
  try {
    await fsp.rename(temporary, link);
  } catch (error) {
    await unlinkIfExists(temporary);
    throw error;
  }
}

async function restoreScraplingLink(link: string, previousTarget: string) {
  try {
    const current = await fsp.lstat(link);
    if (!current.isSymbolicLink()) return false;
    if (previousTarget) {
      await atomicSwitchSymlink(link, previousTarget);
    } else {
      await unlinkIfExists(link);
    }
    return true;
  } catch {
    return false;
  }
}

async function removeCreatedCandidate(candidate: string, root: string) {
  if (!candidate) return;
  assertChildPath(root, candidate, 'failed Scrapling candidate');
  await fsp.rm(candidate, { recursive: true, force: true });
}

async function readSymlinkTarget(file: string) {
  try {
    const stat = await fsp.lstat(file);
    if (!stat.isSymbolicLink()) return '';
    const target = await fsp.readlink(file);
    return path.resolve(path.dirname(file), target);
  } catch {
    return '';
  }
}

function yamRollback(previousVersion: string) {
  return {
    automatic: false,
    previous_target: previousVersion,
    guidance: previousVersion
      ? `Reinstall the exact prior package with \`npm install -g yam-flow@${previousVersion}\`, then run \`yam install\`, \`yam version\`, and \`yam status\`.`
      : 'Inspect the global npm installation before attempting a manual rollback.'
  };
}

function scraplingRollback(previousTarget: string, link: string) {
  return {
    automatic: false,
    previous_target: previousTarget,
    guidance: previousTarget
      ? `The previous environment is retained. Restore ${link} atomically to ${previousTarget}, then verify \`${link} --version\`.`
      : `No previous managed target was found. Remove only the yam-created ${link} symlink if a rollback is required.`
  };
}

function insaneRollback(previousVersion: string) {
  return {
    automatic: false,
    previous_target: previousVersion,
    guidance: 'Codex CLI has no version-pinned plugin rollback command. Do not edit `.codex/plugins/cache`; use an official Codex plugin workflow or restore a reviewed marketplace revision manually.'
  };
}

function genericRollback(check: ExternalComponentCheck) {
  if (check.component === 'yam') return yamRollback(check.installed_version);
  if (check.component === 'insane-search') return insaneRollback(check.installed_version);
  return {
    automatic: false,
    previous_target: '',
    guidance: 'No mutation was attempted because the read-only update check failed.'
  };
}

function commandCheck(id: string, result: ExternalCommandResult): ExternalComponentReceipt['checks'][number] {
  return {
    id,
    status: result.ok ? 'passed' : 'failed',
    note: commandNote(result)
  };
}

function commandNote(result: ExternalCommandResult) {
  const text = redactSensitiveText([result.stdout, result.stderr].filter(Boolean).join('\n'));
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (lines.slice(-4).join(' | ') || `exit ${result.status ?? 'unknown'}`).slice(0, 800);
}

async function defaultRun(command: string, args: string[], options: ExternalCommandOptions = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeout || 30000,
    shell: false,
    maxBuffer: 8 * 1024 * 1024
  });
  return {
    ok: result.status === 0,
    status: typeof result.status === 'number' ? result.status : null,
    stdout: redactSensitiveText(String(result.stdout || '')),
    stderr: redactSensitiveText(String(result.stderr || result.error?.message || ''))
  };
}

async function defaultFetchJson(url: string) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'yam-flow external-update-check'
    },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

function requireStableVersion(value: unknown, label: string) {
  const version = String(value || '').trim();
  if (!/^\d+(?:\.\d+){1,3}$/.test(version)) {
    throw new Error(`${label} is not an allowed stable numeric version`);
  }
  return version;
}

function extractVersion(text: string) {
  return String(text || '').match(/\b\d+(?:\.\d+){1,3}\b/)?.[0] || '';
}

function compareVersions(left: string, right: string) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function parseJsonOutput(text: string, label: string) {
  try {
    return JSON.parse(String(text || ''));
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
}

function arrayValue(value: any) {
  return Array.isArray(value) ? value : [];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function expandHome(value: string, homeDir: string) {
  return String(value || '').replace(/^~(?=$|\/)/, homeDir);
}

function safeTimestamp(date: Date) {
  return date.toISOString().replace(/[^0-9A-Za-z]/g, '').toLowerCase();
}

function isSafeMarketplaceRoot(root: string, homeDir: string) {
  const resolved = path.resolve(root);
  const marketplaceRoot = path.join(homeDir, '.codex', '.tmp', 'marketplaces');
  return resolved.startsWith(`${marketplaceRoot}${path.sep}`);
}

function assertChildPath(root: string, candidate: string, label: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate === resolvedRoot || !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} must stay under ${resolvedRoot}`);
  }
}

async function pathExists(file: string) {
  try {
    await fsp.lstat(file);
    return true;
  } catch {
    return false;
  }
}

async function fileContains(file: string, expected: string) {
  try {
    return (await fsp.readFile(file, 'utf8')).includes(expected);
  } catch {
    return false;
  }
}

async function unlinkIfExists(file: string) {
  try {
    await fsp.unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function redactSensitiveText(text: string) {
  return String(text || '')
    .replace(/(_authToken\s*=\s*)[^\s]+/gi, '$1[redacted]')
    .replace(/\b(password|passwd|api[_-]?key|secret|token)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\/\/([^:\s]+):([^@\s]+)@/g, '//[redacted]@')
    .replace(/\b(npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[redacted-token]');
}

function firstFailureNextAction(receipts: ExternalComponentReceipt[]) {
  const receipt = receipts.find((item) => (
    item.outcome === 'failed'
    || item.outcome === 'manual_plugin_update_required'
    || item.persistence === 'failed'
  ));
  if (!receipt) return 'inspect the incomplete component inventory before retrying';
  if (receipt.outcome === 'manual_plugin_update_required') {
    return 'update Insane Search through a reviewed official Codex plugin workflow; do not remove-first or edit the plugin cache directly';
  }
  return receipt.rollback_hint.guidance || `resolve the ${receipt.component} failure before retrying`;
}
