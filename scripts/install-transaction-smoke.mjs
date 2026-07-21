#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  INSTALL_LOCK_NAME,
  INSTALL_RECEIPT_NAME,
  inspectSkillInstallation,
  installSkillSetTransactional
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
  mkdirSync(join(destination, 'yam-quick'), { recursive: true });
  writeFileSync(join(destination, 'yam-quick', 'SKILL.md'), 'legacy skill');
  mkdirSync(join(mirror, 'quick', 'references'), { recursive: true });
  writeFileSync(join(mirror, 'quick', 'SKILL.md'), 'stale mirror skill');

  const firstInstall = await installSkillSetTransactional(baseOptions);
  assert(firstInstall.receipt.schema === 'yam.install-receipt.v1', 'install receipt schema missing');
  assert(firstInstall.receipt.package.version === packageJson.version, 'install receipt version mismatch');
  assert(firstInstall.receipt.integrity.file_count > skills.length, 'install receipt file manifest is incomplete');
  assert(!existsSync(join(destination, 'yam-quick')), 'legacy skill should be removed after commit');
  assert(!existsSync(join(mirror, 'quick')), 'Codex mirror skill should be removed after commit');
  assert((statSync(firstInstall.receiptPath).mode & 0o077) === 0, 'install receipt should not grant group or other permissions');

  const firstInspection = await inspectSkillInstallation(baseOptions);
  assert(firstInspection.ok, `first installation should verify: ${firstInspection.issues.join('; ')}`);
  const receiptBeforeRollback = readFileSync(firstInstall.receiptPath, 'utf8');

  let rollbackFailure = '';
  try {
    await installSkillSetTransactional({
      ...baseOptions,
      failpoint(event) {
        if (event.phase === 'skill-installed' && event.skill === 'ueye') {
          throw new Error('forced commit failure');
        }
      }
    });
  } catch (error) {
    rollbackFailure = error instanceof Error ? error.message : String(error);
  }
  assert(rollbackFailure.includes('previous installation state restored'), 'forced failure should report successful rollback');
  assert(readFileSync(firstInstall.receiptPath, 'utf8') === receiptBeforeRollback, 'rollback should restore the previous receipt byte-for-byte');
  const rollbackInspection = await inspectSkillInstallation(baseOptions);
  assert(rollbackInspection.ok, `rollback should restore a verified installation: ${rollbackInspection.issues.join('; ')}`);
  const transactionArtifacts = readdirSync(destination).filter((name) => name.startsWith('.yam-flow-install-') && name !== INSTALL_RECEIPT_NAME);
  assert(transactionArtifacts.length === 0, `rollback should clean transaction artifacts: ${transactionArtifacts.join(', ')}`);
  assert(!existsSync(join(destination, INSTALL_LOCK_NAME)), 'rollback should release the install lock');

  appendFileSync(join(destination, 'quick', 'SKILL.md'), '\n# local drift\n');
  const driftInspection = await inspectSkillInstallation(baseOptions);
  assert(!driftInspection.ok, 'modified installed skill should fail integrity inspection');
  assert(driftInspection.skills.find((skill) => skill.skill === 'quick')?.status === 'drift', 'quick should report hash drift');

  const cliEnv = {
    ...process.env,
    YAM_SKILLS_HOME: destination,
    YAM_CODEX_MIRROR: mirror
  };
  const driftStatus = commandFailure(process.execPath, [join(sourceRoot, 'dist', 'bin', 'yam.js'), 'status'], cliEnv);
  assert(driftStatus.includes('drift   quick'), 'CLI status should expose skill drift');
  execFileSync(process.execPath, [join(sourceRoot, 'dist', 'bin', 'yam.js'), 'install'], { stdio: 'ignore', env: cliEnv });
  const repairedStatus = execFileSync(process.execPath, [join(sourceRoot, 'dist', 'bin', 'yam.js'), 'status'], { encoding: 'utf8', env: cliEnv });
  assert(repairedStatus.includes(`install receipt ${packageJson.name}@${packageJson.version}`), 'CLI status should report the verified receipt');

  const receiptPath = join(destination, INSTALL_RECEIPT_NAME);
  const tamperedReceipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  tamperedReceipt.package.version = '0.0.0-tampered';
  writeFileSync(receiptPath, `${JSON.stringify(tamperedReceipt, null, 2)}\n`);
  const receiptDrift = await inspectSkillInstallation(baseOptions);
  assert(receiptDrift.receiptStatus === 'drift', 'modified receipt should report drift');
  assert(receiptDrift.issues.some((issue) => issue.includes('version drift')), 'receipt version drift should identify the cause');
  await installSkillSetTransactional(baseOptions);

  const unexpectedFile = join(destination, 'mission', 'references', 'unexpected-local-file.md');
  writeFileSync(unexpectedFile, 'unexpected');
  const unexpectedDrift = await inspectSkillInstallation(baseOptions);
  assert(unexpectedDrift.skills.find((skill) => skill.skill === 'mission')?.status === 'drift', 'unexpected installed file should report drift');
  assert(unexpectedDrift.issues.some((issue) => issue.includes('unexpected file')), 'unexpected file drift should identify the cause');
  await installSkillSetTransactional(baseOptions);

  rmSync(receiptPath, { force: true });
  const missingReceipt = await inspectSkillInstallation(baseOptions);
  assert(missingReceipt.receiptStatus === 'missing', 'missing receipt should fail install integrity');
  await installSkillSetTransactional(baseOptions);

  const staleTransaction = join(destination, '.yam-flow-install-stale', 'backup');
  mkdirSync(staleTransaction, { recursive: true });
  const staleInspection = await inspectSkillInstallation(baseOptions);
  assert(staleInspection.recoveryArtifacts.length === 1, 'status inspection should expose a stale transaction artifact');
  const staleStatus = commandFailure(process.execPath, [join(sourceRoot, 'dist', 'bin', 'yam.js'), 'status'], cliEnv);
  assert(staleStatus.includes('unfinished install transaction requires inspection'), 'CLI status should identify unfinished recovery state');
  assert(staleStatus.includes('preserve the transaction backup before retrying'), 'CLI status should give a recovery-safe next action');
  let staleFailure = '';
  try {
    await installSkillSetTransactional(baseOptions);
  } catch (error) {
    staleFailure = error instanceof Error ? error.message : String(error);
  }
  assert(staleFailure.includes('unfinished yam install transaction found'), 'stale transaction artifact should block a new install');
  rmSync(join(destination, '.yam-flow-install-stale'), { recursive: true, force: true });

  writeFileSync(join(destination, INSTALL_LOCK_NAME), '{"pid":999999}');
  let lockFailure = '';
  try {
    await installSkillSetTransactional(baseOptions);
  } catch (error) {
    lockFailure = error instanceof Error ? error.message : String(error);
  }
  assert(lockFailure.includes('another yam install may be active'), 'concurrent install lock should block mutation');
  rmSync(join(destination, INSTALL_LOCK_NAME), { force: true });

  console.log(`install-transaction-smoke: ok (${packageJson.version}, ${firstInstall.installedFiles} files)`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

function commandFailure(file, args, env) {
  try {
    execFileSync(file, args, { encoding: 'utf8', env });
  } catch (error) {
    return `${String(error.stdout || '')}${String(error.stderr || '')}`;
  }
  throw new Error(`Expected command failure: ${file} ${args.join(' ')}`);
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}
