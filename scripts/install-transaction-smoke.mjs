#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  INSTALL_LOCK_NAME,
  INSTALL_RECEIPT_NAME,
  inspectSkillInstallation,
  installSkillSetTransactional,
  planSkillSetInstallation,
  uninstallSkillSetSafely
} from '../dist/lib/skill-installation.js';

const sourceRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8'));
const skills = ['quick', 'ueye', 'question', 'scout', 'deep', 'mission'];
const root = mkdtempSync(join(tmpdir(), 'yam-install-transaction-'));
const destination = join(root, 'agents-skills');
const mirror = join(root, 'codex-skills');
const baseOptions = {
  sourceRoot,
  destination,
  codexMirror: mirror,
  packageName: packageJson.name,
  version: packageJson.version,
  skills,
  legacySkills: ['yam-quick'],
  retiredSkills: ['fast']
};

try {
  assertStableManifestAcrossLocales();
  await assertSourceBoundaryHardening();
  await assertCleanupIdentityHardening();
  const userQuick = '# user-owned quick\n';
  mkdirSync(join(destination, 'quick'), { recursive: true });
  writeFileSync(join(destination, 'quick', 'SKILL.md'), userQuick);
  seedPreservedEntries(destination, mirror);

  const blockedPlan = await planSkillSetInstallation(baseOptions);
  assert(blockedPlan.schema === 'yam.install-plan.v1', 'install dry-run plan schema missing');
  assert(blockedPlan.mutation_authorized === false, 'install dry-run must never authorize mutation');
  assert(blockedPlan.truth_status === 'blocked' && !blockedPlan.ready, 'user-owned skill should block the dry-run plan');
  assert(blockedPlan.blockers.some((item) => item.includes('ownership conflict')), 'blocked plan should preserve the ownership cause');
  assert(blockedPlan.preserved_paths.includes(join(destination, 'yam-quick')), 'dry-run must list an unowned legacy path that actual install preserves');
  assert(blockedPlan.preserved_paths.includes(join(destination, 'fast')), 'dry-run must list an unowned retired path that actual install preserves');
  assert(blockedPlan.preserved_paths.includes(mirror), 'dry-run must list the unowned Codex mirror');
  assert(!existsSync(join(destination, INSTALL_LOCK_NAME)), 'dry-run plan must not create an install lock');
  assertTransactionClean(destination, 'blocked dry-run plan');

  const readyPlan = await planSkillSetInstallation({ ...baseOptions, replaceSkills: ['quick'] });
  const repeatedPlan = await planSkillSetInstallation({
    ...baseOptions,
    replaceSkills: ['quick'],
    now: () => new Date('2099-01-01T00:00:00.000Z')
  });
  assert(readyPlan.ready && readyPlan.truth_status === 'verified', 'reviewed replacement should produce a ready plan');
  assert(
    readyPlan.operations.some((item) => item.skill === 'quick' && item.action === 'replace_explicitly_authorized'),
    'ready plan should distinguish an explicit user-skill replacement'
  );
  assert(readyPlan.plan_digest === repeatedPlan.plan_digest, 'plan digest should ignore generation time');
  assert(readFileSync(join(destination, 'quick', 'SKILL.md'), 'utf8') === userQuick, 'dry-run plan must not replace active bytes');
  assert(!existsSync(join(destination, INSTALL_RECEIPT_NAME)), 'dry-run plan must not create a receipt');

  const lockedPlanDestination = join(root, 'dry-run-locked');
  mkdirSync(lockedPlanDestination, { recursive: true });
  writeFileSync(join(lockedPlanDestination, INSTALL_LOCK_NAME), '{"pid":999999}\n');
  const lockedPlan = await planSkillSetInstallation({ ...baseOptions, destination: lockedPlanDestination });
  assert(!lockedPlan.ready && lockedPlan.blockers.some((item) => item.includes('lock exists')), 'dry-run must expose an existing install lock');
  assert(lockedPlan.operations.length === 0, 'a lock-blocked dry-run must not propose mutation operations');
  assert(readFileSync(join(lockedPlanDestination, INSTALL_LOCK_NAME), 'utf8') === '{"pid":999999}\n', 'dry-run must preserve an existing lock');

  const recoveryPlanDestination = join(root, 'dry-run-recovery');
  mkdirSync(join(recoveryPlanDestination, '.yam-flow-install-stale', 'backup'), { recursive: true });
  const recoveryPlan = await planSkillSetInstallation({ ...baseOptions, destination: recoveryPlanDestination });
  assert(!recoveryPlan.ready && recoveryPlan.blockers.some((item) => item.includes('unfinished yam install transaction')), 'dry-run must expose recovery artifacts');
  assert(recoveryPlan.operations.length === 0, 'a recovery-blocked dry-run must not propose mutation operations');
  assert(existsSync(join(recoveryPlanDestination, '.yam-flow-install-stale', 'backup')), 'dry-run must preserve recovery artifacts');

  const externalPlanDestination = join(root, 'dry-run-symlink-target');
  const symlinkPlanDestination = join(root, 'dry-run-symlink');
  mkdirSync(externalPlanDestination, { recursive: true });
  symlinkSync(externalPlanDestination, symlinkPlanDestination);
  const symlinkPlan = await planSkillSetInstallation({ ...baseOptions, destination: symlinkPlanDestination });
  assert(!symlinkPlan.ready && symlinkPlan.blockers.some((item) => item.includes('regular physical directory')), 'dry-run must reject a symlinked destination');

  let reachedStage = false;
  const userConflict = await failureOf(() => installSkillSetTransactional({
    ...baseOptions,
    failpoint(event) {
      if (event.phase === 'after-stage') reachedStage = true;
    }
  }));
  assert(userConflict.includes('active skill ownership conflict'), 'fresh install should reject a user-owned active skill');
  assert(!reachedStage, 'ownership conflict must be detected before staging');
  assert(readFileSync(join(destination, 'quick', 'SKILL.md'), 'utf8') === userQuick, 'user-owned active skill must be preserved');
  assert(!existsSync(join(destination, 'ueye')), 'ownership conflict must fail before installing another skill');
  assert(!existsSync(join(destination, INSTALL_RECEIPT_NAME)), 'ownership conflict must not create a receipt');
  assertPreservedEntries(destination, mirror);
  assertTransactionClean(destination, 'fresh conflict');

  const firstInstall = await installSkillSetTransactional({
    ...baseOptions,
    replaceSkills: ['quick']
  });
  assert(firstInstall.receipt.schema === 'yam.install-receipt.v1', 'install receipt schema missing');
  assert(firstInstall.receipt.package.version === packageJson.version, 'install receipt version mismatch');
  assert(firstInstall.receipt.integrity.file_count > skills.length, 'install receipt file manifest is incomplete');
  assert(readFileSync(join(destination, 'quick', 'SKILL.md'), 'utf8') !== userQuick, 'explicit active replacement should install yam skill');
  assert((statSync(firstInstall.receiptPath).mode & 0o077) === 0, 'install receipt should not grant group or other permissions');
  assertPreservedEntries(destination, mirror);

  const firstInspection = await inspectSkillInstallation(baseOptions);
  assert(firstInspection.ok, `first installation should verify: ${firstInspection.issues.join('; ')}`);

  const previousVersionReceipt = JSON.parse(readFileSync(firstInstall.receiptPath, 'utf8'));
  previousVersionReceipt.package.version = '2.3.1-previous';
  previousVersionReceipt.source.identity = `${packageJson.name}@2.3.1-previous`;
  previousVersionReceipt.integrity.files.sort((left, right) => left.path.localeCompare(right.path));
  previousVersionReceipt.integrity.source_digest = digestManifestInStoredOrder(previousVersionReceipt.integrity.files);
  writeFileSync(firstInstall.receiptPath, `${JSON.stringify(previousVersionReceipt, null, 2)}\n`, { mode: 0o600 });
  const upgradedInstall = await installSkillSetTransactional(baseOptions);
  assert(
    upgradedInstall.receipt.package.version === packageJson.version,
    'a hash-matching receipt-owned install from an older version should upgrade'
  );
  assertPreservedEntries(destination, mirror);

  const receiptBeforeRollback = readFileSync(firstInstall.receiptPath, 'utf8');
  const rollbackFailure = await failureOf(() => installSkillSetTransactional({
    ...baseOptions,
    failpoint(event) {
      if (event.phase === 'skill-installed' && event.skill === 'ueye') {
        throw new Error('forced commit failure');
      }
    }
  }));
  assert(rollbackFailure.includes('previous installation state restored'), 'forced failure should report successful rollback');
  assert(readFileSync(firstInstall.receiptPath, 'utf8') === receiptBeforeRollback, 'rollback should restore the previous receipt byte-for-byte');
  const rollbackInspection = await inspectSkillInstallation(baseOptions);
  assert(rollbackInspection.ok, `rollback should restore a verified installation: ${rollbackInspection.issues.join('; ')}`);
  assertTransactionClean(destination, 'rollback');

  await assertRollbackRemovalIdentity(baseOptions);

  const receiptBeforeInstallRace = readFileSync(firstInstall.receiptPath, 'utf8');
  const installRaceFailure = await failureOf(() => installSkillSetTransactional({
    ...baseOptions,
    failpoint(event) {
      if (event.phase === 'before-mutation') {
        appendFileSync(join(destination, 'quick', 'SKILL.md'), '\n# raced before install mutation\n');
        appendFileSync(firstInstall.receiptPath, '\n');
      }
    }
  }));
  const racedInstallQuick = readFileSync(join(destination, 'quick', 'SKILL.md'), 'utf8');
  assert(installRaceFailure.includes('ownership snapshot mismatch'), 'install should detect a tree race after capture');
  assert(racedInstallQuick.includes('raced before install mutation'), 'install rollback must preserve raced active bytes');
  assert(
    readFileSync(firstInstall.receiptPath, 'utf8') === `${receiptBeforeInstallRace}\n`,
    'install race rollback must preserve raced receipt bytes'
  );
  assertTransactionClean(destination, 'install race');
  writeFileSync(firstInstall.receiptPath, receiptBeforeInstallRace, { mode: 0o600 });
  await installSkillSetTransactional({ ...baseOptions, replaceSkills: ['quick'] });

  appendFileSync(join(destination, 'quick', 'SKILL.md'), '\n# local drift\n');
  const driftedQuick = readFileSync(join(destination, 'quick', 'SKILL.md'), 'utf8');
  const receiptBeforeDriftConflict = readFileSync(firstInstall.receiptPath, 'utf8');
  reachedStage = false;
  const driftFailure = await failureOf(() => installSkillSetTransactional({
    ...baseOptions,
    failpoint(event) {
      if (event.phase === 'after-stage') reachedStage = true;
    }
  }));
  assert(driftFailure.includes('locally modified'), 'modified managed skill should block upgrade');
  assert(!reachedStage, 'drift conflict must be detected before staging');
  assert(readFileSync(join(destination, 'quick', 'SKILL.md'), 'utf8') === driftedQuick, 'drifted managed skill must be preserved');
  assert(readFileSync(firstInstall.receiptPath, 'utf8') === receiptBeforeDriftConflict, 'drift conflict must preserve receipt byte-for-byte');
  assertTransactionClean(destination, 'drift conflict');

  const driftInspection = await inspectSkillInstallation(baseOptions);
  assert(!driftInspection.ok, 'modified installed skill should fail integrity inspection');
  assert(driftInspection.skills.find((skill) => skill.skill === 'quick')?.status === 'drift', 'quick should report hash drift');
  await installSkillSetTransactional({ ...baseOptions, replaceSkills: ['quick'] });
  const repairedInspection = await inspectSkillInstallation(baseOptions);
  assert(repairedInspection.ok, `explicit per-skill replacement should repair drift: ${repairedInspection.issues.join('; ')}`);

  const validReceipt = readFileSync(firstInstall.receiptPath, 'utf8');
  const malformedReceipt = JSON.parse(validReceipt);
  malformedReceipt.package.name = 'unrelated-package';
  writeFileSync(firstInstall.receiptPath, `${JSON.stringify(malformedReceipt, null, 2)}\n`, { mode: 0o600 });
  const malformedBytes = readFileSync(firstInstall.receiptPath, 'utf8');
  const malformedFailure = await failureOf(() => installSkillSetTransactional(baseOptions));
  assert(malformedFailure.includes('package mismatch'), 'unrelated receipt should block active replacement');
  assert(readFileSync(firstInstall.receiptPath, 'utf8') === malformedBytes, 'unrelated receipt must be preserved byte-for-byte');
  const malformedOverrideFailure = await failureOf(() => installSkillSetTransactional({
    ...baseOptions,
    replaceSkills: skills
  }));
  assert(
    malformedOverrideFailure.includes('existing install receipt is unproven'),
    'explicit active replacements must not overwrite an unproven receipt'
  );
  writeFileSync(firstInstall.receiptPath, validReceipt, { mode: 0o600 });

  const unsafeReceipt = JSON.parse(validReceipt);
  unsafeReceipt.integrity.files[0].path = '../escape';
  writeFileSync(firstInstall.receiptPath, `${JSON.stringify(unsafeReceipt, null, 2)}\n`, { mode: 0o600 });
  const unsafeReceiptFailure = await failureOf(() => installSkillSetTransactional({
    ...baseOptions,
    replaceSkills: skills
  }));
  assert(unsafeReceiptFailure.includes('unsafe path'), 'unsafe receipt manifest path should fail closed');
  writeFileSync(firstInstall.receiptPath, validReceipt, { mode: 0o600 });

  const externalReceipt = join(root, 'external-receipt.json');
  writeFileSync(externalReceipt, validReceipt, { mode: 0o600 });
  rmSync(firstInstall.receiptPath, { force: true });
  symlinkSync(externalReceipt, firstInstall.receiptPath);
  const receiptSymlinkFailure = await failureOf(() => installSkillSetTransactional({
    ...baseOptions,
    replaceSkills: skills
  }));
  assert(receiptSymlinkFailure.includes('must be a regular file'), 'receipt symlink should fail closed');
  assert(readFileSync(firstInstall.receiptPath, 'utf8') === validReceipt, 'receipt symlink target must be preserved');
  rmSync(firstInstall.receiptPath, { force: true });
  writeFileSync(firstInstall.receiptPath, validReceipt, { mode: 0o600 });

  rmSync(firstInstall.receiptPath, { force: true });
  symlinkSync(join(root, 'missing-receipt-target.json'), firstInstall.receiptPath);
  const brokenReceiptSymlinkFailure = await failureOf(() => installSkillSetTransactional({
    ...baseOptions,
    replaceSkills: skills
  }));
  assert(
    brokenReceiptSymlinkFailure.includes('must be a regular file'),
    'broken receipt symlink should be detected as an existing unproven receipt'
  );
  assert(lstatSync(firstInstall.receiptPath).isSymbolicLink(), 'broken receipt symlink must be preserved');
  rmSync(firstInstall.receiptPath, { force: true });
  writeFileSync(firstInstall.receiptPath, validReceipt, { mode: 0o600 });

  const unexpectedFile = join(destination, 'mission', 'references', 'unexpected-local-file.md');
  writeFileSync(unexpectedFile, 'unexpected');
  const unexpectedFailure = await failureOf(() => installSkillSetTransactional(baseOptions));
  assert(unexpectedFailure.includes('unexpected file'), 'unexpected active file should fail closed');
  assert(readFileSync(unexpectedFile, 'utf8') === 'unexpected', 'unexpected active file should be preserved');
  await installSkillSetTransactional({ ...baseOptions, replaceSkills: ['mission'] });

  const staleTransaction = join(destination, '.yam-flow-install-stale', 'backup');
  mkdirSync(staleTransaction, { recursive: true });
  const staleFailure = await failureOf(() => installSkillSetTransactional(baseOptions));
  assert(staleFailure.includes('unfinished yam install transaction found'), 'stale transaction artifact should block a new install');
  rmSync(join(destination, '.yam-flow-install-stale'), { recursive: true, force: true });

  writeFileSync(join(destination, INSTALL_LOCK_NAME), '{"pid":999999}');
  const lockFailure = await failureOf(() => installSkillSetTransactional(baseOptions));
  assert(lockFailure.includes('another yam install may be active'), 'concurrent install lock should block mutation');
  rmSync(join(destination, INSTALL_LOCK_NAME), { force: true });

  const activeSymlinkDestination = join(root, 'active-symlink');
  const activeSymlinkTarget = join(root, 'active-symlink-target');
  mkdirSync(activeSymlinkDestination, { recursive: true });
  mkdirSync(activeSymlinkTarget, { recursive: true });
  writeFileSync(join(activeSymlinkTarget, 'SKILL.md'), 'external active skill');
  symlinkSync(activeSymlinkTarget, join(activeSymlinkDestination, 'quick'));
  const activeSymlinkFailure = await failureOf(() => installSkillSetTransactional({
    ...baseOptions,
    destination: activeSymlinkDestination,
    replaceSkills: ['quick']
  }));
  assert(activeSymlinkFailure.includes('regular directory'), 'active skill symlink should fail closed');
  assert(
    readFileSync(join(activeSymlinkDestination, 'quick', 'SKILL.md'), 'utf8') === 'external active skill',
    'active skill symlink target must be preserved'
  );
  assertTransactionClean(activeSymlinkDestination, 'active symlink');

  const brokenActiveSymlinkDestination = join(root, 'broken-active-symlink');
  mkdirSync(brokenActiveSymlinkDestination, { recursive: true });
  symlinkSync(join(root, 'missing-active-skill'), join(brokenActiveSymlinkDestination, 'quick'));
  const brokenActiveSymlinkFailure = await failureOf(() => installSkillSetTransactional({
    ...baseOptions,
    destination: brokenActiveSymlinkDestination,
    replaceSkills: ['quick']
  }));
  assert(
    brokenActiveSymlinkFailure.includes('regular directory'),
    'broken active skill symlink should be detected as an existing entry'
  );
  assert(
    lstatSync(join(brokenActiveSymlinkDestination, 'quick')).isSymbolicLink(),
    'broken active skill symlink must be preserved'
  );
  assertTransactionClean(brokenActiveSymlinkDestination, 'broken active symlink');

  const nestedSymlinkDestination = join(root, 'nested-symlink');
  const nestedSymlinkOptions = { ...baseOptions, destination: nestedSymlinkDestination };
  await installSkillSetTransactional(nestedSymlinkOptions);
  const nestedReference = join(nestedSymlinkDestination, 'quick', 'references', 'quick.md');
  const externalReference = join(root, 'external-reference.md');
  writeFileSync(externalReference, 'external nested reference');
  rmSync(nestedReference, { force: true });
  symlinkSync(externalReference, nestedReference);
  const nestedSymlinkFailure = await failureOf(() => installSkillSetTransactional(nestedSymlinkOptions));
  assert(nestedSymlinkFailure.includes('unsupported install tree entry'), 'nested skill symlink should fail closed');
  assert(readFileSync(nestedReference, 'utf8') === 'external nested reference', 'nested symlink target must be preserved');
  assertTransactionClean(nestedSymlinkDestination, 'nested symlink');

  const mutationSymlinkDestination = join(root, 'mutation-symlink-swap');
  const mutationSymlinkOptions = { ...baseOptions, destination: mutationSymlinkDestination };
  await installSkillSetTransactional(mutationSymlinkOptions);
  const mutationExternalTarget = join(root, 'mutation-symlink-external');
  mkdirSync(mutationExternalTarget, { recursive: true });
  writeFileSync(join(mutationExternalTarget, 'SKILL.md'), 'external mutation target\n');
  const mutationSymlinkFailure = await failureOf(() => installSkillSetTransactional({
    ...mutationSymlinkOptions,
    failpoint(event) {
      if (event.phase === 'before-mutation') {
        rmSync(join(mutationSymlinkDestination, 'quick'), { recursive: true, force: true });
        symlinkSync(mutationExternalTarget, join(mutationSymlinkDestination, 'quick'));
      }
    }
  }));
  assert(
    mutationSymlinkFailure.includes('source must be a regular directory'),
    'a final path symlink swapped in at the mutation boundary must fail closed'
  );
  assert(
    readFileSync(join(mutationExternalTarget, 'SKILL.md'), 'utf8') === 'external mutation target\n',
    'a mutation-boundary symlink failure must not change the external target'
  );
  assert(
    lstatSync(join(mutationSymlinkDestination, 'quick')).isSymbolicLink(),
    'the raced symlink itself must be preserved for operator inspection'
  );
  assertTransactionClean(mutationSymlinkDestination, 'mutation symlink swap');

  const uninstallDestination = join(root, 'uninstall-clean');
  const uninstallMirror = join(root, 'uninstall-clean-mirror');
  const uninstallOptions = {
    ...baseOptions,
    destination: uninstallDestination,
    codexMirror: uninstallMirror
  };
  seedPreservedEntries(uninstallDestination, uninstallMirror);
  await installSkillSetTransactional(uninstallOptions);
  const uninstallResult = await uninstallSkillSetSafely({
    destination: uninstallDestination,
    codexMirror: uninstallMirror,
    packageName: packageJson.name,
    skills
  });
  assert(uninstallResult.removedSkills.length === skills.length, 'safe uninstall should report every removed active skill');
  for (const skill of skills) {
    assert(!existsSync(join(uninstallDestination, skill)), `safe uninstall should remove receipt-owned ${skill}`);
  }
  assert(!existsSync(join(uninstallDestination, INSTALL_RECEIPT_NAME)), 'safe uninstall should remove the verified receipt');
  assertPreservedEntries(uninstallDestination, uninstallMirror);
  assertTransactionClean(uninstallDestination, 'clean uninstall');

  const missingReceiptUninstallDestination = join(root, 'uninstall-missing-receipt');
  const missingReceiptUninstallOptions = {
    ...baseOptions,
    destination: missingReceiptUninstallDestination
  };
  await installSkillSetTransactional(missingReceiptUninstallOptions);
  rmSync(join(missingReceiptUninstallDestination, INSTALL_RECEIPT_NAME), { force: true });
  const missingReceiptUninstallFailure = await failureOf(() => uninstallSkillSetSafely({
    destination: missingReceiptUninstallDestination,
    packageName: packageJson.name,
    skills
  }));
  assert(
    missingReceiptUninstallFailure.includes('cannot prove yam ownership'),
    'safe uninstall without a receipt should fail closed'
  );
  for (const skill of skills) {
    assert(
      existsSync(join(missingReceiptUninstallDestination, skill)),
      `missing-receipt uninstall must preserve active ${skill}`
    );
  }
  assertTransactionClean(missingReceiptUninstallDestination, 'missing receipt uninstall');

  const rollbackUninstallDestination = join(root, 'uninstall-rollback');
  const rollbackUninstallOptions = {
    ...baseOptions,
    destination: rollbackUninstallDestination
  };
  await installSkillSetTransactional(rollbackUninstallOptions);
  const rollbackUninstallReceipt = readFileSync(join(rollbackUninstallDestination, INSTALL_RECEIPT_NAME), 'utf8');
  const rollbackUninstallFailure = await failureOf(() => uninstallSkillSetSafely({
    destination: rollbackUninstallDestination,
    packageName: packageJson.name,
    skills,
    failpoint(event) {
      if (event.phase === 'after-backup') throw new Error('forced uninstall failure');
    }
  }));
  assert(
    rollbackUninstallFailure.includes('previous installation state restored'),
    'forced uninstall failure should report successful rollback'
  );
  assert(
    readFileSync(join(rollbackUninstallDestination, INSTALL_RECEIPT_NAME), 'utf8') === rollbackUninstallReceipt,
    'uninstall rollback should restore receipt byte-for-byte'
  );
  const rollbackUninstallInspection = await inspectSkillInstallation(rollbackUninstallOptions);
  assert(
    rollbackUninstallInspection.ok,
    `uninstall rollback should restore a verified installation: ${rollbackUninstallInspection.issues.join('; ')}`
  );
  assertTransactionClean(rollbackUninstallDestination, 'uninstall rollback');

  const receiptBeforeUninstallRace = readFileSync(
    join(rollbackUninstallDestination, INSTALL_RECEIPT_NAME),
    'utf8'
  );
  const uninstallRaceFailure = await failureOf(() => uninstallSkillSetSafely({
    destination: rollbackUninstallDestination,
    packageName: packageJson.name,
    skills,
    failpoint(event) {
      if (event.phase === 'before-mutation') {
        appendFileSync(
          join(rollbackUninstallDestination, 'quick', 'SKILL.md'),
          '\n# raced before uninstall mutation\n'
        );
      }
    }
  }));
  assert(uninstallRaceFailure.includes('ownership snapshot mismatch'), 'uninstall should detect a tree race after capture');
  assert(
    readFileSync(join(rollbackUninstallDestination, 'quick', 'SKILL.md'), 'utf8')
      .includes('raced before uninstall mutation'),
    'uninstall rollback must preserve raced active bytes'
  );
  assert(
    readFileSync(join(rollbackUninstallDestination, INSTALL_RECEIPT_NAME), 'utf8') === receiptBeforeUninstallRace,
    'uninstall race rollback must preserve receipt byte-for-byte'
  );
  assertTransactionClean(rollbackUninstallDestination, 'uninstall race');

  const driftUninstallDestination = join(root, 'uninstall-drift');
  const driftUninstallMirror = join(root, 'uninstall-drift-mirror');
  const driftUninstallOptions = {
    ...baseOptions,
    destination: driftUninstallDestination,
    codexMirror: driftUninstallMirror
  };
  seedPreservedEntries(driftUninstallDestination, driftUninstallMirror);
  await installSkillSetTransactional(driftUninstallOptions);
  appendFileSync(join(driftUninstallDestination, 'quick', 'SKILL.md'), '\n# uninstall drift\n');
  const uninstallDriftBytes = readFileSync(join(driftUninstallDestination, 'quick', 'SKILL.md'), 'utf8');
  const uninstallReceiptBytes = readFileSync(join(driftUninstallDestination, INSTALL_RECEIPT_NAME), 'utf8');
  const uninstallFailure = await failureOf(() => uninstallSkillSetSafely({
    destination: driftUninstallDestination,
    codexMirror: driftUninstallMirror,
    packageName: packageJson.name,
    skills
  }));
  assert(uninstallFailure.includes('locally modified active skill'), 'safe uninstall should fail closed on active drift');
  assert(
    readFileSync(join(driftUninstallDestination, 'quick', 'SKILL.md'), 'utf8') === uninstallDriftBytes,
    'failed uninstall must preserve drifted skill byte-for-byte'
  );
  assert(
    readFileSync(join(driftUninstallDestination, INSTALL_RECEIPT_NAME), 'utf8') === uninstallReceiptBytes,
    'failed uninstall must preserve receipt byte-for-byte'
  );
  for (const skill of skills) {
    assert(existsSync(join(driftUninstallDestination, skill)), `failed uninstall must preserve active ${skill}`);
  }
  assertPreservedEntries(driftUninstallDestination, driftUninstallMirror);
  assertTransactionClean(driftUninstallDestination, 'drift uninstall');

  console.log(`install-transaction-smoke: ok (${packageJson.version}, ${firstInstall.installedFiles} files)`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

function assertStableManifestAcrossLocales() {
  const source = join(root, 'stable-manifest-source');
  mkdirSync(join(source, 'skills', 'quick'), { recursive: true });
  mkdirSync(join(source, 'references'), { recursive: true });
  writeFileSync(join(source, 'skills', 'quick', 'SKILL.md'), '---\nname: quick\n---\n# stable manifest probe\n');
  for (const name of ['Z-reference.md', 'a-reference.md', 'é-reference.md', '한국-reference.md']) {
    writeFileSync(join(source, 'references', name), `${name}\n`);
  }

  const installationModule = pathToFileURL(join(sourceRoot, 'dist', 'lib', 'skill-installation.js')).href;
  const probes = ['C', 'en_US.UTF-8', 'ko_KR.UTF-8'].map((locale, index) => {
    const destination = join(root, `stable-manifest-${index}`);
    const script = `
      import { installSkillSetTransactional } from ${JSON.stringify(installationModule)};
      const result = await installSkillSetTransactional({
        sourceRoot: ${JSON.stringify(source)},
        destination: ${JSON.stringify(destination)},
        packageName: 'yam-stable-order-probe',
        version: '1.0.0',
        skills: ['quick'],
        transactionId: ${JSON.stringify(`stable-order-${index}`)}
      });
      console.log(JSON.stringify({
        source_digest: result.receipt.integrity.source_digest,
        paths: result.receipt.integrity.files.map((file) => file.path)
      }));
    `;
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: { ...process.env, LANG: locale, LC_ALL: locale }
    }));
  });

  const expected = JSON.stringify(probes[0]);
  assert(probes.every((probe) => JSON.stringify(probe) === expected), 'install manifest and digest should be locale-independent');
  assert(
    JSON.stringify(probes[0].paths) === JSON.stringify([
      'quick/SKILL.md',
      'quick/references/Z-reference.md',
      'quick/references/a-reference.md',
      'quick/references/é-reference.md',
      'quick/references/한국-reference.md'
    ]),
    'install manifest should use stable ordinal path ordering'
  );
}

async function assertSourceBoundaryHardening() {
  const crlfSource = join(root, 'source-crlf');
  mkdirSync(join(crlfSource, 'skills', 'quick'), { recursive: true });
  mkdirSync(join(crlfSource, 'references'), { recursive: true });
  writeFileSync(join(crlfSource, 'skills', 'quick', 'SKILL.md'), '---\r\nname: quick\r\n---\r\n# CRLF source\r\n');
  writeFileSync(join(crlfSource, 'references', 'quick.md'), '# CRLF reference\r\n');
  const crlfDestination = join(root, 'source-crlf-destination');
  const crlfInstall = await installSkillSetTransactional({
    sourceRoot: crlfSource,
    destination: crlfDestination,
    packageName: 'yam-crlf-source-probe',
    version: '1.0.0',
    skills: ['quick']
  });
  assert(crlfInstall.receipt.skills[0] === 'quick', 'CRLF skill frontmatter should preserve the declared skill name');
  assertTransactionClean(crlfDestination, 'CRLF source');

  const parentSymlinkSource = join(root, 'source-parent-symlink');
  const externalSkills = join(root, 'source-parent-symlink-external-skills');
  mkdirSync(join(externalSkills, 'quick'), { recursive: true });
  writeFileSync(join(externalSkills, 'quick', 'SKILL.md'), '---\nname: quick\n---\n# external source\n');
  mkdirSync(join(parentSymlinkSource, 'references'), { recursive: true });
  writeFileSync(join(parentSymlinkSource, 'references', 'quick.md'), '# reference\n');
  symlinkSync(externalSkills, join(parentSymlinkSource, 'skills'));
  const parentSymlinkDestination = join(root, 'source-parent-symlink-destination');
  const parentSymlinkFailure = await failureOf(() => installSkillSetTransactional({
    sourceRoot: parentSymlinkSource,
    destination: parentSymlinkDestination,
    packageName: 'yam-source-boundary-probe',
    version: '1.0.0',
    skills: ['quick']
  }));
  assert(
    parentSymlinkFailure.includes('symlinked parent path segment'),
    'a symlinked source parent path must fail closed'
  );
  assert(
    readFileSync(join(externalSkills, 'quick', 'SKILL.md'), 'utf8').includes('# external source'),
    'a rejected source parent symlink must not mutate its external target'
  );
  assert(!existsSync(join(parentSymlinkDestination, 'quick')), 'a rejected source parent symlink must not install a skill');
  assertTransactionClean(parentSymlinkDestination, 'source parent symlink');

  const changedSource = join(root, 'source-identity-change');
  mkdirSync(join(changedSource, 'skills', 'quick'), { recursive: true });
  mkdirSync(join(changedSource, 'references'), { recursive: true });
  const changedSkill = join(changedSource, 'skills', 'quick', 'SKILL.md');
  writeFileSync(changedSkill, '---\nname: quick\n---\n# original source identity\n');
  writeFileSync(join(changedSource, 'references', 'quick.md'), '# reference\n');
  const changedDestination = join(root, 'source-identity-change-destination');
  const changedFailure = await failureOf(() => installSkillSetTransactional({
    sourceRoot: changedSource,
    destination: changedDestination,
    packageName: 'yam-source-identity-probe',
    version: '1.0.0',
    skills: ['quick'],
    failpoint(event) {
      if (event.phase === 'after-stage') {
        rmSync(changedSkill, { force: true });
        writeFileSync(changedSkill, '---\nname: quick\n---\n# replaced source identity\n');
      }
    }
  }));
  assert(
    changedFailure.includes('post-install verification failed'),
    'a source identity replacement after staging must invalidate the transaction'
  );
  assert(!existsSync(join(changedDestination, 'quick')), 'source identity drift must roll back the staged skill');
  assert(
    !existsSync(join(changedDestination, INSTALL_RECEIPT_NAME)),
    'source identity drift must roll back the staged receipt'
  );
  assertTransactionClean(changedDestination, 'source identity change');
}

async function assertRollbackRemovalIdentity(options) {
  const skillSwapDestination = join(root, 'rollback-skill-identity-swap');
  const skillSwapOptions = { ...options, destination: skillSwapDestination };
  await installSkillSetTransactional(skillSwapOptions);
  const replacementSkill = '# user replacement after installed skill swap\n';
  const skillSwapFailure = await failureOf(() => installSkillSetTransactional({
    ...skillSwapOptions,
    failpoint(event) {
      if (event.phase === 'skill-installed' && event.skill === 'quick') {
        rmSync(join(skillSwapDestination, 'quick'), { recursive: true, force: true });
        mkdirSync(join(skillSwapDestination, 'quick'), { recursive: true });
        writeFileSync(join(skillSwapDestination, 'quick', 'SKILL.md'), replacementSkill);
        throw new Error('forced installed skill identity swap');
      }
    }
  }));
  assert(
    skillSwapFailure.includes('rollback removal identity mismatch'),
    'rollback must reject a different directory installed at a recorded skill path'
  );
  assert(
    readFileSync(join(skillSwapDestination, 'quick', 'SKILL.md'), 'utf8') === replacementSkill,
    'rollback must preserve a replacement directory whose identity is not yam-recorded'
  );
  assertRecoveryArtifactPreserved(skillSwapDestination, 'installed skill identity swap');

  const receiptSwapDestination = join(root, 'rollback-receipt-identity-swap');
  const receiptSwapOptions = { ...options, destination: receiptSwapDestination };
  await installSkillSetTransactional(receiptSwapOptions);
  const replacementReceipt = '{"owner":"user replacement"}\n';
  const receiptSwapFailure = await failureOf(() => installSkillSetTransactional({
    ...receiptSwapOptions,
    failpoint(event) {
      if (event.phase === 'receipt-installed') {
        rmSync(join(receiptSwapDestination, INSTALL_RECEIPT_NAME), { force: true });
        writeFileSync(join(receiptSwapDestination, INSTALL_RECEIPT_NAME), replacementReceipt, { mode: 0o600 });
        throw new Error('forced installed receipt identity swap');
      }
    }
  }));
  assert(
    receiptSwapFailure.includes('rollback removal identity mismatch'),
    'rollback must reject a different file installed at the recorded receipt path'
  );
  assert(
    readFileSync(join(receiptSwapDestination, INSTALL_RECEIPT_NAME), 'utf8') === replacementReceipt,
    'rollback must preserve a replacement receipt whose identity is not yam-recorded'
  );
  assertRecoveryArtifactPreserved(receiptSwapDestination, 'installed receipt identity swap');
}

async function assertCleanupIdentityHardening() {
  const transactionDestination = join(root, 'transaction-cleanup-identity-swap');
  const replacementTransactionBytes = 'user transaction replacement\n';
  let replacementTransactionPath = '';
  const transactionFailure = await failureOf(() => installSkillSetTransactional({
    ...baseOptions,
    destination: transactionDestination,
    failpoint(event) {
      if (event.phase === 'after-stage') {
        const transactionName = readdirSync(transactionDestination)
          .find((name) => name.startsWith('.yam-flow-install-'));
        assert(transactionName, 'transaction cleanup identity test must find the active transaction directory');
        replacementTransactionPath = join(transactionDestination, transactionName);
        replaceOwnedPathForIdentityTest(replacementTransactionPath);
        mkdirSync(replacementTransactionPath, { recursive: true });
        writeFileSync(join(replacementTransactionPath, 'user.txt'), replacementTransactionBytes);
        throw new Error('forced transaction cleanup identity swap');
      }
    }
  }));
  assert(
    transactionFailure.includes('install transaction cleanup identity mismatch'),
    `transaction cleanup must reject a different directory at its recorded path; received: ${transactionFailure}`
  );
  assert(
    readFileSync(join(replacementTransactionPath, 'user.txt'), 'utf8') === replacementTransactionBytes,
    'transaction cleanup must preserve a replacement directory whose identity is not yam-recorded'
  );
  assert(!existsSync(join(transactionDestination, INSTALL_LOCK_NAME)), 'transaction cleanup failure must still release the owned lock');

  const lockDestination = join(root, 'lock-cleanup-identity-swap');
  const replacementLockBytes = 'user lock replacement\n';
  const lockFailure = await failureOf(() => installSkillSetTransactional({
    ...baseOptions,
    destination: lockDestination,
    failpoint(event) {
      if (event.phase === 'after-stage') {
        const lockPath = join(lockDestination, INSTALL_LOCK_NAME);
        replaceOwnedPathForIdentityTest(lockPath);
        writeFileSync(lockPath, replacementLockBytes, { mode: 0o600 });
        throw new Error('forced lock cleanup identity swap');
      }
    }
  }));
  assert(
    lockFailure.includes('install lock cleanup identity mismatch'),
    'lock cleanup must reject a different file at its recorded path'
  );
  assert(
    readFileSync(join(lockDestination, INSTALL_LOCK_NAME), 'utf8') === replacementLockBytes,
    'lock cleanup must preserve a replacement file whose identity is not yam-recorded'
  );
  assert(
    !readdirSync(lockDestination).some((name) => name.startsWith('.yam-flow-install-')),
    'lock cleanup identity failure must still remove the owned transaction directory'
  );

  const uninstallTransactionDestination = join(root, 'uninstall-transaction-cleanup-identity-swap');
  const uninstallTransactionOptions = {
    ...baseOptions,
    destination: uninstallTransactionDestination,
    codexMirror: undefined
  };
  await installSkillSetTransactional(uninstallTransactionOptions);
  const replacementUninstallBytes = 'user uninstall transaction replacement\n';
  let replacementUninstallPath = '';
  const uninstallResult = await uninstallSkillSetSafely({
    ...uninstallTransactionOptions,
    failpoint(event) {
      if (event.phase === 'before-verify') {
        const transactionName = readdirSync(uninstallTransactionDestination)
          .find((name) => name.startsWith('.yam-flow-install-uninstall-'));
        assert(transactionName, 'uninstall cleanup identity test must find the active transaction directory');
        replacementUninstallPath = join(uninstallTransactionDestination, transactionName);
        replaceOwnedPathForIdentityTest(replacementUninstallPath);
        mkdirSync(replacementUninstallPath, { recursive: true });
        writeFileSync(join(replacementUninstallPath, 'user.txt'), replacementUninstallBytes);
      }
    }
  });
  assert(
    uninstallResult.cleanupWarnings.some((warning) => warning.includes('uninstall transaction cleanup identity mismatch')),
    'uninstall cleanup must reject a different directory at its recorded path'
  );
  assert(
    readFileSync(join(replacementUninstallPath, 'user.txt'), 'utf8') === replacementUninstallBytes,
    'uninstall cleanup must preserve a replacement directory whose identity is not yam-recorded'
  );
  assert(
    !existsSync(join(uninstallTransactionDestination, INSTALL_LOCK_NAME)),
    'uninstall cleanup identity failure must still release the owned lock'
  );
}

function replaceOwnedPathForIdentityTest(target) {
  if (process.platform === 'win32') {
    renameSync(target, `${target}.yam-owned-original`);
    return;
  }
  rmSync(target, { recursive: true, force: true });
}

function assertRecoveryArtifactPreserved(destination, label) {
  assert(
    readdirSync(destination).some((name) => name.startsWith('.yam-flow-install-') && name !== INSTALL_RECEIPT_NAME),
    `${label} must retain a recovery artifact for operator inspection`
  );
  assert(!existsSync(join(destination, INSTALL_LOCK_NAME)), `${label} must still release the install lock`);
}

function digestManifestInStoredOrder(files) {
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(file.path);
    digest.update('\0');
    digest.update(String(file.bytes));
    digest.update('\0');
    digest.update(file.sha256);
    digest.update('\n');
  }
  return digest.digest('hex');
}

function seedPreservedEntries(destinationRoot, mirrorRoot) {
  mkdirSync(join(destinationRoot, 'yam-quick'), { recursive: true });
  writeFileSync(join(destinationRoot, 'yam-quick', 'SKILL.md'), 'user-owned legacy skill');
  mkdirSync(join(destinationRoot, 'fast'), { recursive: true });
  writeFileSync(join(destinationRoot, 'fast', 'SKILL.md'), 'user-owned retired skill');
  mkdirSync(join(mirrorRoot, 'quick', 'references'), { recursive: true });
  writeFileSync(join(mirrorRoot, 'quick', 'SKILL.md'), 'user-owned mirror skill');
  writeFileSync(join(mirrorRoot, 'quick', 'references', 'local.md'), 'user-owned mirror reference');
}

function assertPreservedEntries(destinationRoot, mirrorRoot) {
  assert(readFileSync(join(destinationRoot, 'yam-quick', 'SKILL.md'), 'utf8') === 'user-owned legacy skill', 'unowned legacy skill must survive');
  assert(readFileSync(join(destinationRoot, 'fast', 'SKILL.md'), 'utf8') === 'user-owned retired skill', 'unowned retired skill must survive');
  assert(readFileSync(join(mirrorRoot, 'quick', 'SKILL.md'), 'utf8') === 'user-owned mirror skill', 'unowned mirror skill must survive');
  assert(
    readFileSync(join(mirrorRoot, 'quick', 'references', 'local.md'), 'utf8') === 'user-owned mirror reference',
    'unowned mirror tree must survive'
  );
}

function assertTransactionClean(destinationRoot, label) {
  const artifacts = readdirSync(destinationRoot)
    .filter((name) => name.startsWith('.yam-flow-install-') && name !== INSTALL_RECEIPT_NAME);
  assert(artifacts.length === 0, `${label} should clean transaction artifacts: ${artifacts.join(', ')}`);
  assert(!existsSync(join(destinationRoot, INSTALL_LOCK_NAME)), `${label} should release the install lock`);
}

async function failureOf(run) {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected operation to fail');
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}
