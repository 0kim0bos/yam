#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  applyExternalUpdates,
  checkExternalUpdates
} from '../dist/lib/external-updates.js';

const roots = [];

try {
  const fixture = createFixture();
  const check = await checkExternalUpdates('2.4.0', fixture.dependencies());
  assert.equal(check.schema, 'yam.external-update-check.v1');
  assert.equal(check.success, true);
  assert.deepEqual(
    check.components.map((item) => [item.component, item.installed_version, item.latest_version, item.status]),
    [
      ['yam', '2.4.0', '2.5.0', 'update_available'],
      ['scrapling', '0.4.11', '0.4.12', 'update_available'],
      ['insane-search', '0.8.2', '0.9.0', 'update_available']
    ]
  );
  assert.equal(check.components[2].source_revision.drift, true);
  assert.match(check.components[2].source_revision.note, /plugin manifest version/);
  assert.equal(fixture.fetches.some((url) => url.includes('/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/')), true);
  assert.equal(fixture.fetches.some((url) => url.includes('/HEAD/')), false);

  const scraplingApply = await applyExternalUpdates('2.4.0', {
    component: 'scrapling'
  }, fixture.dependencies());
  assert.equal(scraplingApply.success, true, JSON.stringify(scraplingApply, null, 2));
  assert.equal(scraplingApply.receipts[0].outcome, 'updated');
  assert.equal(scraplingApply.receipts[0].installed_version, '0.4.12');
  assert.equal(scraplingApply.receipts[0].persistence, 'written');
  assert.equal(scraplingApply.receipts[0].source_revision.kind, 'pypi_release');
  assert.equal(existsSync(scraplingApply.receipts[0].receipt_path), true);
  assert.equal(existsSync(fixture.oldEnvironment), true, 'previous Scrapling environment must be retained');
  const newTarget = resolve(dirname(fixture.scraplingBin), readlinkSync(fixture.scraplingBin));
  assert.match(newTarget, /0\.4\.12-yam-/);
  assert.equal(existsSync(join(dirname(dirname(newTarget)), '.yam-scrapling-install.json')), true);

  const rollbackFixture = createFixture();
  const invalidReceiptDir = join(rollbackFixture.root, 'receipt-path-is-a-file');
  writeFileSync(invalidReceiptDir, 'not a directory\n');
  const originalTarget = resolve(dirname(rollbackFixture.scraplingBin), readlinkSync(rollbackFixture.scraplingBin));
  const rollbackApply = await applyExternalUpdates('2.4.0', {
    component: 'scrapling'
  }, rollbackFixture.dependencies({
    receiptDir: invalidReceiptDir
  }));
  assert.equal(rollbackApply.success, false);
  assert.equal(rollbackApply.receipts[0].outcome, 'failed');
  assert.equal(rollbackApply.receipts[0].persistence, 'failed');
  assert.equal(rollbackApply.receipts[0].rollback_hint.automatic, true);
  assert.equal(
    resolve(dirname(rollbackFixture.scraplingBin), readlinkSync(rollbackFixture.scraplingBin)),
    originalTarget,
    'receipt failure must restore the previous symlink'
  );

  const manualFixture = createFixture();
  manualFixture.addFails = true;
  const manualApply = await applyExternalUpdates('2.4.0', {
    component: 'insane-search'
  }, manualFixture.dependencies());
  assert.equal(manualApply.success, false);
  assert.equal(manualApply.receipts[0].outcome, 'manual_plugin_update_required');
  assert.equal(manualApply.receipts[0].persistence, 'written');
  assert.equal(JSON.stringify(manualApply).includes('fixture-secret'), false, 'captured command output must be redacted');
  assert.match(manualApply.next_action, /official_plugin_add_in_place failed/);
  assert.match(manualApply.next_action, /reviewed official Codex plugin workflow/);
  assert.equal(manualApply.next_action.includes('fixture-secret'), false);
  assert.equal(manualFixture.commands.some((item) => item.args.includes('remove')), false);
  assert.equal(manualFixture.commands.some((item) => (
    [item.command, ...item.args].join(' ').includes('.codex/plugins/cache')
  )), false);

  const stateFailureFixture = createFixture();
  stateFailureFixture.pluginListFailsAfterUpgrade = true;
  const stateFailureApply = await applyExternalUpdates('2.4.0', {
    component: 'insane-search'
  }, stateFailureFixture.dependencies());
  assert.equal(stateFailureApply.success, false);
  assert.equal(stateFailureApply.receipts[0].outcome, 'failed');
  assert.match(stateFailureApply.receipts[0].error, /refusing a plugin mutation without observed state/);
  assert.equal(stateFailureFixture.commands.some((item) => item.args.includes('add')), false);

  const wrongSourceFixture = createFixture();
  wrongSourceFixture.marketplaceSource = 'https://example.invalid/untrusted.git';
  const wrongSourceApply = await applyExternalUpdates('2.4.0', {
    component: 'insane-search'
  }, wrongSourceFixture.dependencies());
  assert.equal(wrongSourceApply.success, false);
  assert.match(wrongSourceApply.receipts[0].error, /unexpected gptaku-codex marketplace source/);
  assert.equal(wrongSourceFixture.commands.some((item) => item.args.includes('upgrade')), false);

  const failedVenvFixture = createFixture();
  failedVenvFixture.venvFails = true;
  const failedVenvApply = await applyExternalUpdates('2.4.0', {
    component: 'scrapling'
  }, failedVenvFixture.dependencies());
  assert.equal(failedVenvApply.success, false);
  const failedCandidate = failedVenvFixture.commands.find((item) => (
    item.command === 'python3' && item.args[0] === '-m' && item.args[1] === 'venv'
  ))?.args[2];
  assert.ok(failedCandidate);
  assert.equal(existsSync(failedCandidate), false, 'a failed transaction-created venv must be removed');
  assert.equal(existsSync(failedVenvFixture.oldEnvironment), true);

  const cleanupFailureFixture = createFixture();
  cleanupFailureFixture.venvFails = true;
  const cleanupFailureDependencies = cleanupFailureFixture.dependencies();
  cleanupFailureDependencies.removeCandidate = async () => {
    throw new Error('fixture cleanup denied');
  };
  const cleanupFailureApply = await applyExternalUpdates('2.4.0', {
    component: 'scrapling'
  }, cleanupFailureDependencies);
  assert.equal(cleanupFailureApply.success, false);
  assert.equal(cleanupFailureApply.receipts[0].persistence, 'written');
  assert.equal(cleanupFailureApply.receipts[0].rollback_hint.automatic, false);
  assert.match(cleanupFailureApply.receipts[0].error, /candidate cleanup also failed: fixture cleanup denied/);
  assert.match(cleanupFailureApply.receipts[0].rollback_hint.guidance, /failed yam candidate/);

  const nonLinkFixture = createFixture();
  rmSync(nonLinkFixture.scraplingBin);
  writeFileSync(nonLinkFixture.scraplingBin, 'user-owned executable\n');
  const nonLinkApply = await applyExternalUpdates('2.4.0', {
    component: 'scrapling'
  }, nonLinkFixture.dependencies());
  assert.equal(nonLinkApply.success, false);
  assert.match(nonLinkApply.receipts[0].error, /refusing to replace non-symlink/);
  assert.equal(readFile(nonLinkFixture.scraplingBin), 'user-owned executable\n');

  const markerlessFixture = createFixture();
  rmSync(join(markerlessFixture.oldEnvironment, '.yam-scrapling-install.json'));
  const markerlessTarget = resolve(dirname(markerlessFixture.scraplingBin), readlinkSync(markerlessFixture.scraplingBin));
  const markerlessApply = await applyExternalUpdates('2.4.0', {
    component: 'scrapling'
  }, markerlessFixture.dependencies());
  assert.equal(markerlessApply.success, false);
  assert.match(markerlessApply.receipts[0].error, /ownership marker/);
  assert.equal(
    resolve(dirname(markerlessFixture.scraplingBin), readlinkSync(markerlessFixture.scraplingBin)),
    markerlessTarget
  );

  const lockedFixture = createFixture();
  mkdirSync(lockedFixture.stateDir, { recursive: true });
  writeFileSync(join(lockedFixture.stateDir, 'external-update.lock'), 'existing lock\n');
  const lockedApply = await applyExternalUpdates('2.4.0', { component: 'yam' }, lockedFixture.dependencies());
  assert.equal(lockedApply.success, false);
  assert.equal(lockedApply.lock.acquired, false);
  assert.equal(lockedApply.gate_result.status, 'failed');
  assert.equal(lockedApply.gate_contract.valid, true);
  assert.match(lockedApply.gate_result.blockers.join(' '), /update_lock_not_acquired/);
  assert.equal(readFile(join(lockedFixture.stateDir, 'external-update.lock')), 'existing lock\n');

  const allReceiptFailureFixture = createFixture({
    scraplingVersion: '0.4.12',
    scraplingLatest: '0.4.12',
    insaneLatest: '0.8.2',
    yamLatest: '2.4.0'
  });
  const blockedReceiptDir = join(allReceiptFailureFixture.root, 'blocked-receipts');
  writeFileSync(blockedReceiptDir, 'not a directory\n');
  const allReceiptFailure = await applyExternalUpdates('2.4.0', { all: true }, allReceiptFailureFixture.dependencies({
    receiptDir: blockedReceiptDir
  }));
  assert.equal(allReceiptFailure.success, false);
  assert.deepEqual(allReceiptFailure.applied_components, ['scrapling']);
  assert.equal(allReceiptFailure.receipts[0].persistence, 'failed');
  assert.match(allReceiptFailure.next_action, /receipt persistence failed/);
  assert.equal(allReceiptFailureFixture.commands.some((item) => item.command === 'npm'), false);
  assert.equal(allReceiptFailureFixture.commands.some((item) => item.command === 'codex'), false);

  const allFixture = createFixture({
    scraplingVersion: '0.4.12',
    scraplingLatest: '0.4.12',
    insaneLatest: '0.8.2',
    yamLatest: '2.5.0'
  });
  const allApply = await applyExternalUpdates('2.4.0', { all: true }, allFixture.dependencies());
  assert.equal(allApply.success, true);
  assert.equal(allApply.gate_result.schema, 'yam.gate-result.v1');
  assert.equal(allApply.gate_result.status, 'passed');
  assert.equal(allApply.gate_contract.valid, true);
  assert.deepEqual(allApply.applied_components, ['scrapling', 'insane-search', 'yam']);
  assert.deepEqual(allApply.receipts.map((item) => item.outcome), ['up_to_date', 'up_to_date', 'updated']);
  assert.equal(allApply.receipts[2].source_revision.kind, 'npm_registry_release');
  assert.equal(allFixture.commands.some((item) => item.command === 'npm' && item.args.join(' ') === 'install -g yam-flow@2.5.0'), true);
  assert.match(allApply.receipts[2].rollback_hint.guidance, /`yam doctor --json`/);
  assert.deepEqual(
    allApply.receipts[2].checks.map((item) => item.id),
    ['npm_global_install', 'yam_effective_identity', 'yam_install_skills', 'yam_version', 'yam_status', 'yam_finalize_doctor']
  );
  assert.equal(allApply.receipts[2].checks.at(-1).status, 'passed');
  assert.equal(allApply.receipts[2].install_identity.expected_version, '2.5.0');
  assert.equal(
    allApply.receipts[2].install_identity.canonical_executable,
    allApply.receipts[2].install_identity.canonical_entrypoint
  );
  assert.equal(
    JSON.parse(readFile(allApply.receipts[2].receipt_path)).install_identity.canonical_entrypoint,
    allApply.receipts[2].install_identity.canonical_entrypoint,
    'the persisted receipt must carry the effective executable identity'
  );
  assert.deepEqual(
    allFixture.commands
      .filter((item) => item.command === allFixture.yamBin)
      .map((item) => item.args.join(' ')),
    ['version', 'install', 'version', 'status', 'doctor --json']
  );

  const chainedSymlinkFixture = createFixture({ yamSymlinkChain: true });
  const chainedSymlinkApply = await applyExternalUpdates('2.4.0', {
    component: 'yam'
  }, chainedSymlinkFixture.dependencies());
  assert.equal(chainedSymlinkApply.success, true, JSON.stringify(chainedSymlinkApply, null, 2));
  assert.equal(chainedSymlinkApply.receipts[0].install_identity.first_on_path, chainedSymlinkFixture.yamBin);
  assert.equal(
    chainedSymlinkApply.receipts[0].install_identity.canonical_executable,
    chainedSymlinkApply.receipts[0].install_identity.canonical_entrypoint,
    'a legitimate multi-hop npm symlink must resolve to the package-local entrypoint'
  );

  const packageRootEscapeFixture = createFixture({ yamPackageRootEscape: true });
  const packageRootEscapeApply = await applyExternalUpdates('2.4.0', {
    component: 'yam'
  }, packageRootEscapeFixture.dependencies());
  assert.equal(packageRootEscapeApply.success, false);
  assert.equal(packageRootEscapeApply.gate_result.status, 'failed');
  assert.match(
    packageRootEscapeApply.receipts[0].checks.find((item) => item.id === 'yam_effective_identity')?.note || '',
    /canonical yam-flow package root must stay under/
  );
  assert.equal(
    packageRootEscapeFixture.commands.some((item) => item.command === packageRootEscapeFixture.yamBin && item.args[0] === 'install'),
    false,
    'an npm package-root symlink escape must fail before any yam-side install mutation'
  );

  const shadowedFixture = createFixture({ shadowYam: true });
  const shadowedApply = await applyExternalUpdates('2.4.0', {
    component: 'yam'
  }, shadowedFixture.dependencies());
  assert.equal(shadowedApply.success, false);
  assert.equal(shadowedApply.gate_result.status, 'failed');
  assert.equal(shadowedApply.gate_contract.valid, true);
  assert.equal(shadowedApply.receipts[0].outcome, 'failed');
  assert.equal(shadowedApply.receipts[0].rollback_hint.automatic, false);
  assert.match(
    shadowedApply.receipts[0].checks.find((item) => item.id === 'yam_effective_identity')?.note || '',
    /first yam on PATH is shadowed/
  );
  assert.match(shadowedApply.next_action, /automatic_yam_rollback_identity failed: first yam on PATH is shadowed/);
  assert.match(shadowedApply.next_action, /Reinstall the exact prior package/);
  assert.equal((await shadowedFixture.run(shadowedFixture.shadowYam, ['version'])).stdout.trim(), '2.5.0');
  assert.equal(
    shadowedFixture.commands.some((item) => item.command === shadowedFixture.shadowYam && item.args[0] === 'install'),
    false,
    'a shadowed executable must never receive yam install'
  );

  const malformedIdentityFixture = createFixture({ malformedYamManifest: true });
  const malformedIdentityApply = await applyExternalUpdates('2.4.0', {
    component: 'yam'
  }, malformedIdentityFixture.dependencies());
  assert.equal(malformedIdentityApply.success, false);
  assert.equal(malformedIdentityApply.receipts[0].rollback_hint.automatic, false);
  assert.match(
    malformedIdentityApply.receipts[0].checks.find((item) => item.id === 'yam_effective_identity')?.note || '',
    /package manifest is missing or malformed/
  );
  assert.match(malformedIdentityApply.next_action, /automatic_yam_rollback_identity failed: yam-flow package manifest is missing or malformed/);
  assert.match(malformedIdentityApply.next_action, /Reinstall the exact prior package/);

  for (const scenario of [
    ['command_failure', /command failed/],
    ['malformed', /invalid JSON/],
    ['wrong_schema', /unexpected schema/],
    ['not_ok', /reported ok=false/]
  ]) {
    const [doctorMode, expectedError] = scenario;
    const doctorFailureFixture = createFixture();
    doctorFailureFixture.doctorMode = doctorMode;
    const doctorFailureApply = await applyExternalUpdates('2.4.0', {
      component: 'yam'
    }, doctorFailureFixture.dependencies());
    const receipt = doctorFailureApply.receipts[0];
    assert.equal(doctorFailureApply.success, false, doctorMode);
    assert.equal(receipt.outcome, 'failed', doctorMode);
    assert.equal(receipt.rollback_hint.automatic, true, doctorMode);
    assert.match(receipt.error, expectedError, doctorMode);
    assert.equal(receipt.checks.find((item) => item.id === 'yam_finalize_doctor')?.status, 'failed', doctorMode);
    assert.equal(receipt.checks.find((item) => item.id === 'automatic_yam_rollback_doctor')?.status, 'passed', doctorMode);
    assert.equal(receipt.rollback_identity.expected_version, '2.4.0', doctorMode);
    assert.ok(
      receipt.checks.findIndex((item) => item.id === 'automatic_yam_rollback_identity')
        < receipt.checks.findIndex((item) => item.id === 'automatic_yam_rollback_skills'),
      `${doctorMode} rollback identity must pass before rollback-side yam commands`
    );
    assert.equal(doctorFailureFixture.installedYam, '2.4.0', doctorMode);
    assert.equal(JSON.stringify(receipt).includes('fixture-secret'), false, `${doctorMode} output must be redacted`);
    assert.equal(
      receipt.checks.every((item) => item.note.length <= 800),
      true,
      `${doctorMode} receipt notes must stay bounded`
    );
    assert.match(doctorFailureApply.next_action, /yam_finalize_doctor failed/, doctorMode);
    assert.match(doctorFailureApply.next_action, expectedError, doctorMode);
  }

  const actionableDoctorFixture = createFixture();
  actionableDoctorFixture.doctorMode = 'actionable_not_ok';
  const actionableDoctorApply = await applyExternalUpdates('2.4.0', {
    component: 'yam'
  }, actionableDoctorFixture.dependencies());
  const actionableDoctorReceipt = actionableDoctorApply.receipts[0];
  assert.equal(actionableDoctorApply.success, false);
  assert.match(actionableDoctorReceipt.error, /issue: global install identity could not be confirmed/);
  assert.match(actionableDoctorReceipt.error, /next: repair PATH, then rerun the read-only Doctor/);
  assert.match(actionableDoctorReceipt.error, /command: YAM_TOKEN=\[redacted\] yam doctor --json/);
  assert.match(actionableDoctorApply.next_action, /repair PATH, then rerun the read-only Doctor/);
  assert.equal(JSON.stringify(actionableDoctorApply).includes('fixture-secret'), false);
  assert.equal(
    actionableDoctorReceipt.checks.find((item) => item.id === 'yam_finalize_doctor')?.note.length <= 800,
    true,
    'actionable Doctor diagnostics must stay bounded'
  );

  const rollbackDoctorFailureFixture = createFixture();
  rollbackDoctorFailureFixture.doctorMode = 'malformed';
  rollbackDoctorFailureFixture.rollbackDoctorMode = 'not_ok';
  const rollbackDoctorFailureApply = await applyExternalUpdates('2.4.0', {
    component: 'yam'
  }, rollbackDoctorFailureFixture.dependencies());
  assert.equal(rollbackDoctorFailureApply.success, false);
  assert.equal(rollbackDoctorFailureApply.receipts[0].outcome, 'failed');
  assert.equal(
    rollbackDoctorFailureApply.receipts[0].checks.find((item) => item.id === 'automatic_yam_rollback_doctor')?.status,
    'failed'
  );
  assert.equal(
    rollbackDoctorFailureApply.receipts[0].rollback_hint.automatic,
    false,
    'rollback must not be claimed when the restored yam doctor contract fails'
  );
  assert.match(rollbackDoctorFailureApply.receipts[0].rollback_hint.guidance, /`yam doctor --json`/);

  const receiptAndRollbackFailureFixture = createFixture();
  receiptAndRollbackFailureFixture.rollbackDoctorMode = 'not_ok';
  const invalidYamReceiptDir = join(receiptAndRollbackFailureFixture.root, 'yam-receipt-path-is-a-file');
  writeFileSync(invalidYamReceiptDir, 'not a directory\n');
  const receiptAndRollbackFailure = await applyExternalUpdates('2.4.0', {
    component: 'yam'
  }, receiptAndRollbackFailureFixture.dependencies({ receiptDir: invalidYamReceiptDir }));
  assert.equal(receiptAndRollbackFailure.success, false);
  assert.equal(receiptAndRollbackFailure.receipts[0].persistence, 'failed');
  assert.equal(receiptAndRollbackFailure.receipts[0].rollback_hint.automatic, false);
  assert.match(receiptAndRollbackFailure.next_action, /automatic_yam_rollback_doctor failed/);
  assert.match(receiptAndRollbackFailure.next_action, /secondary receipt persistence failure/);
  assert.ok(
    receiptAndRollbackFailure.next_action.indexOf('automatic_yam_rollback_doctor failed')
      < receiptAndRollbackFailure.next_action.indexOf('secondary receipt persistence failure'),
    'rollback failure must remain the primary next action when receipt persistence also fails'
  );

  const cli = join(process.cwd(), 'dist', 'bin', 'yam.js');
  const help = execFileSync(process.execPath, [cli, 'update', '--help'], { encoding: 'utf8' });
  assert.match(help, /yam update check \[--json\]/);
  assert.match(help, /manual component|explicit component|requires an explicit component/i);
  assert.throws(
    () => execFileSync(process.execPath, [cli, 'update', 'apply', '--all', '--component', 'yam', '--json'], {
      encoding: 'utf8',
      stdio: 'pipe'
    }),
    (error) => error.status === 1 && /choose exactly one/.test(String(error.stderr))
  );

  console.log('external update smoke: ok');
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

function createFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'yam-external-updates-'));
  roots.push(root);
  const home = join(root, 'home');
  const scraplingRoot = join(home, '.local', 'share', 'scrapling');
  const scraplingBin = join(home, '.homebrew', 'bin', 'scrapling');
  const stateDir = join(root, 'state');
  const receiptDir = join(stateDir, 'receipts');
  const marketplaceRoot = join(home, '.codex', '.tmp', 'marketplaces', 'gptaku-codex');
  const npmPrefix = join(home, '.nvm', 'versions', 'node', 'v24.15.0');
  const npmGlobalRoot = join(npmPrefix, 'lib', 'node_modules');
  const yamPackageRoot = join(npmGlobalRoot, 'yam-flow');
  const escapedYamPackageRoot = join(root, 'outside-yam-flow-package');
  const yamEntrypoint = join(yamPackageRoot, 'dist', 'bin', 'yam.js');
  const yamBin = join(npmPrefix, 'bin', 'yam');
  const yamIntermediateLink = join(npmPrefix, 'libexec', 'yam-current');
  const shadowYam = options.shadowYam ? join(root, 'shadow-bin', 'yam') : '';
  const scraplingVersion = options.scraplingVersion || '0.4.11';
  const oldEnvironment = join(scraplingRoot, scraplingVersion);
  const oldExecutable = join(oldEnvironment, 'bin', 'scrapling');
  mkdirSync(dirname(oldExecutable), { recursive: true });
  mkdirSync(dirname(scraplingBin), { recursive: true });
  mkdirSync(marketplaceRoot, { recursive: true });
  writeFileSync(oldExecutable, '#!/bin/sh\n');
  writeFileSync(join(oldEnvironment, '.yam-scrapling-install.json'), `${JSON.stringify({
    schema: 'yam.scrapling-install.v1',
    version: scraplingVersion,
    created_at: '2026-07-27T01:00:00.000Z',
    executable: oldExecutable
  }, null, 2)}\n`);
  symlinkSync(oldExecutable, scraplingBin);

  if (options.yamPackageRootEscape) {
    mkdirSync(npmGlobalRoot, { recursive: true });
    mkdirSync(escapedYamPackageRoot, { recursive: true });
    symlinkSync(escapedYamPackageRoot, yamPackageRoot);
  }

  const writeYamInstall = (version) => {
    mkdirSync(dirname(yamEntrypoint), { recursive: true });
    writeFileSync(yamEntrypoint, '#!/usr/bin/env node\n');
    writeFileSync(
      join(yamPackageRoot, 'package.json'),
      options.malformedYamManifest
        ? '{not-json\n'
        : `${JSON.stringify({
            name: 'yam-flow',
            version,
            bin: { yam: 'dist/bin/yam.js' }
          }, null, 2)}\n`
    );
  };
  writeYamInstall(options.installedYam || '2.4.0');
  mkdirSync(dirname(yamBin), { recursive: true });
  if (options.yamSymlinkChain) {
    mkdirSync(dirname(yamIntermediateLink), { recursive: true });
    symlinkSync(yamEntrypoint, yamIntermediateLink);
    symlinkSync(yamIntermediateLink, yamBin);
  } else {
    symlinkSync(yamEntrypoint, yamBin);
  }
  if (shadowYam) {
    mkdirSync(dirname(shadowYam), { recursive: true });
    writeFileSync(shadowYam, '#!/usr/bin/env node\n');
  }

  const fixture = {
    root,
    home,
    scraplingRoot,
    scraplingBin,
    stateDir,
    receiptDir,
    marketplaceRoot,
    npmGlobalRoot,
    yamPackageRoot,
    yamEntrypoint,
    yamBin,
    shadowYam,
    firstYamOnPath: shadowYam || yamBin,
    oldEnvironment,
    commands: [],
    fetches: [],
    installedInsane: '0.8.2',
    addFails: false,
    venvFails: false,
    marketplaceUpgraded: false,
    pluginListFailsAfterUpgrade: false,
    marketplaceSource: 'https://github.com/fivetaku/gptaku-plugins-codex.git',
    scraplingLatest: options.scraplingLatest || '0.4.12',
    insaneLatest: options.insaneLatest || '0.9.0',
    yamLatest: options.yamLatest || '2.5.0',
    installedYam: options.installedYam || '2.4.0',
    doctorMode: 'ok',
    rollbackDoctorMode: 'ok',
    dependencies(pathOverrides = {}) {
      return {
        homeDir: home,
        now: () => new Date('2026-07-27T02:00:00.000Z'),
        env: {
          PATH: `${shadowYam ? dirname(shadowYam) : dirname(yamBin)}:${process.env.PATH || ''}`,
          YAM_SCRAPLING_PYTHON: 'python3'
        },
        paths: {
          stateDir,
          receiptDir,
          lockFile: join(stateDir, 'external-update.lock'),
          scraplingRoot,
          scraplingBin,
          ...pathOverrides
        },
        fetchJson: async (url) => {
          fixture.fetches.push(url);
          if (url.includes('registry.npmjs.org')) return { version: fixture.yamLatest };
          if (url.includes('pypi.org')) return { info: { version: fixture.scraplingLatest } };
          if (url.includes('raw.githubusercontent.com')) return { version: fixture.insaneLatest };
          throw new Error(`unexpected fixture URL: ${url}`);
        },
        run: async (command, args) => fixture.run(command, args)
      };
    },
    async run(command, args) {
      fixture.commands.push({ command, args: [...args] });
      if (command === 'git' && args[0] === 'ls-remote') {
        return ok('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\tHEAD\n');
      }
      if (command === 'git' && args[0] === '-C') {
        return ok('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n');
      }
      if (command === 'codex' && args.join(' ') === 'plugin marketplace list --json') {
        return ok(JSON.stringify({
          marketplaces: [{
            name: 'gptaku-codex',
            root: marketplaceRoot,
            marketplaceSource: {
              sourceType: 'git',
              source: fixture.marketplaceSource
            }
          }]
        }));
      }
      if (command === 'codex' && args.join(' ') === 'plugin list --json') {
        if (fixture.pluginListFailsAfterUpgrade && fixture.marketplaceUpgraded) {
          return fail('plugin state unavailable\n');
        }
        return ok(JSON.stringify({
          installed: [{
            pluginId: 'insane-search-codex@gptaku-codex',
            version: fixture.installedInsane
          }]
        }));
      }
      if (command === 'codex' && args.join(' ') === 'plugin marketplace upgrade gptaku-codex --json') {
        fixture.marketplaceUpgraded = true;
        return ok('{"upgraded":true}\n');
      }
      if (command === 'codex' && args.join(' ') === 'plugin add insane-search-codex@gptaku-codex --json') {
        if (fixture.addFails) return fail('already installed; token=fixture-secret; no safe in-place update\n');
        fixture.installedInsane = fixture.insaneLatest;
        return ok('{"installed":true}\n');
      }
      if (command === 'npm' && args[0] === 'install' && args[1] === '-g') {
        fixture.installedYam = String(args[2] || '').split('@').at(-1) || fixture.installedYam;
        writeYamInstall(fixture.installedYam);
        return ok('installed\n');
      }
      if (command === 'npm' && args.join(' ') === 'root -g') {
        return ok(`${npmGlobalRoot}\n`);
      }
      if (command === 'which' && args[0] === 'yam') {
        return ok(`${fixture.firstYamOnPath}\n`);
      }
      if (command === shadowYam && args[0] === 'version') return ok(`${fixture.yamLatest}\n`);
      if (command === fixture.firstYamOnPath && args.join(' ') === 'doctor --json') {
        const mode = fixture.installedYam === fixture.yamLatest
          ? fixture.doctorMode
          : fixture.rollbackDoctorMode;
        return doctorResult(mode);
      }
      if (command === fixture.firstYamOnPath && args[0] === 'version') return ok(`${fixture.installedYam}\n`);
      if (command === fixture.firstYamOnPath) return ok('ok\n');
      if (command === 'python3' && args[0] === '-m' && args[1] === 'venv') {
        const candidate = args[2];
        mkdirSync(join(candidate, 'bin'), { recursive: true });
        writeFileSync(join(candidate, 'bin', 'python'), '#!/bin/sh\n');
        writeFileSync(join(candidate, 'bin', 'scrapling'), '#!/bin/sh\n');
        if (fixture.venvFails) return fail('venv creation failed after partial output\n');
        return ok('venv created\n');
      }
      if (command.endsWith('/bin/python') && args[0] === '-m' && args[1] === 'pip') {
        return ok('pip ok\n');
      }
      if (command === fixture.scraplingBin || command.endsWith('/bin/scrapling')) {
        if (args[0] === '--version') {
          let target = command;
          if (command === fixture.scraplingBin) {
            try {
              target = resolve(dirname(command), readlinkSync(command));
            } catch {
              target = command;
            }
          }
          const version = target.match(/(\d+\.\d+\.\d+)/)?.[1] || scraplingVersion;
          return ok(`Scrapling, version ${version}\n`);
        }
        if (args[0] === 'install') return ok('browsers installed\n');
        if (args[0] === 'extract') {
          const output = args[3];
          mkdirSync(dirname(output), { recursive: true });
          writeFileSync(output, 'Example Domain\n');
          return ok('fetched\n');
        }
      }
      return fail(`unexpected fixture command: ${command} ${args.join(' ')}\n`);
    }
  };
  return fixture;
}

function ok(stdout = '') {
  return { ok: true, status: 0, stdout, stderr: '' };
}

function fail(stderr = '') {
  return { ok: false, status: 1, stdout: '', stderr };
}

function doctorResult(mode) {
  if (mode === 'command_failure') {
    return fail(`doctor failed; token=fixture-secret; ${'x'.repeat(1200)}\n`);
  }
  if (mode === 'malformed') {
    return ok(`token=fixture-secret\n{not-json${'x'.repeat(1200)}\n`);
  }
  if (mode === 'wrong_schema') {
    return ok(JSON.stringify({ schema: 'yam.doctor.v0', ok: true, token: 'fixture-secret' }));
  }
  if (mode === 'not_ok') {
    return ok(JSON.stringify({ schema: 'yam.doctor.v1', ok: false, token: 'fixture-secret' }));
  }
  if (mode === 'actionable_not_ok') {
    return ok(JSON.stringify({
      schema: 'yam.doctor.v1',
      ok: false,
      issues: ['global install identity could not be confirmed; token=fixture-secret'],
      nextActions: ['repair PATH, then rerun the read-only Doctor'],
      nextActionDetails: [{
        reason: 'global install identity could not be confirmed; token=fixture-secret',
        next_action: 'repair PATH, then rerun the read-only Doctor',
        command: 'YAM_TOKEN=fixture-secret yam doctor --json'
      }]
    }));
  }
  return ok(JSON.stringify({ schema: 'yam.doctor.v1', ok: true }));
}

function readFile(file) {
  return readFileSync(file, 'utf8');
}
