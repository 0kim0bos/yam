#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function parseArgs(argv) {
  const options = { artifactDir: '', receipt: '', writeReceipt: '', expectedSha256: '', verifyOnly: false, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--verify-only') options.verifyOnly = true;
    else if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--artifact-dir') options.artifactDir = requiredValue(argv, ++index, arg);
    else if (arg === '--receipt') options.receipt = requiredValue(argv, ++index, arg);
    else if (arg === '--write-receipt') options.writeReceipt = requiredValue(argv, ++index, arg);
    else if (arg === '--expected-sha256') options.expectedSha256 = requiredValue(argv, ++index, arg);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function packageIdentity(cwd = process.cwd()) {
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  return { name: String(pkg.name), version: String(pkg.version) };
}

function currentCommit(cwd = process.cwd()) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return result.status === 0 ? result.stdout.trim() : '';
}

function findSingleTarball(artifactDir) {
  const tarballs = readdirSync(artifactDir).filter((name) => name.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error(`expected exactly one .tgz in ${artifactDir}, found ${tarballs.length}`);
  return join(artifactDir, tarballs[0]);
}

function writeReceipt(artifactDir, receiptPath) {
  const tarball = findSingleTarball(artifactDir);
  const identity = packageIdentity();
  const receipt = {
    schema: 'yam.packed-release-artifact.v1',
    package: identity.name,
    version: identity.version,
    artifact: basename(tarball),
    sha256: sha256(tarball),
    bytes: statSync(tarball).size,
    source_commit: currentCommit(),
  };
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

function verifyReceipt(artifactDir, receiptPath, expectedSha256 = '') {
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  if (receipt.schema !== 'yam.packed-release-artifact.v1') throw new Error(`unsupported receipt schema: ${receipt.schema || 'missing'}`);
  if (!receipt.artifact || basename(receipt.artifact) !== receipt.artifact || !receipt.artifact.endsWith('.tgz')) throw new Error('receipt artifact must be one safe .tgz basename');
  const tarball = resolve(artifactDir, receipt.artifact);
  if (dirname(tarball) !== resolve(artifactDir) || !existsSync(tarball)) throw new Error('receipt tarball is missing or outside the artifact directory');
  const identity = packageIdentity();
  if (receipt.package !== identity.name || receipt.version !== identity.version) {
    throw new Error(`receipt identity ${receipt.package}@${receipt.version} does not match source ${identity.name}@${identity.version}`);
  }
  const actualBytes = statSync(tarball).size;
  const actualSha256 = sha256(tarball);
  if (expectedSha256 && !/^[a-f0-9]{64}$/i.test(expectedSha256)) throw new Error('expected sha256 must contain exactly 64 hexadecimal characters');
  if (expectedSha256 && expectedSha256.toLowerCase() !== actualSha256) throw new Error(`workflow sha256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  if (receipt.bytes !== actualBytes) throw new Error(`tarball byte size mismatch: expected ${receipt.bytes}, got ${actualBytes}`);
  if (receipt.sha256 !== actualSha256) throw new Error(`tarball sha256 mismatch: expected ${receipt.sha256}, got ${actualSha256}`);
  const commit = currentCommit();
  if (receipt.source_commit && commit && receipt.source_commit !== commit) throw new Error(`receipt source commit ${receipt.source_commit} does not match checkout ${commit}`);
  if (findSingleTarball(artifactDir) !== tarball) throw new Error('artifact directory contains an unexpected tarball');
  return { receipt, tarball };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function packageDirectory(consumer, packageName) {
  return join(consumer, 'node_modules', ...packageName.split('/'));
}

function runLifecycle(receipt, tarball) {
  const root = mkdtempSync(join(tmpdir(), 'yam-packed-lifecycle-'));
  const consumer = join(root, 'consumer');
  const isolatedHome = join(root, 'home');
  const skillsHome = join(root, 'skills');
  const cache = join(root, 'npm-cache');
  mkdirSync(consumer, { recursive: true });
  mkdirSync(isolatedHome, { recursive: true });
  mkdirSync(skillsHome, { recursive: true });
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(consumer, 'package.json'), '{"name":"yam-packed-consumer","private":true}\n');
  const env = {
    ...process.env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    XDG_CONFIG_HOME: join(isolatedHome, '.config'),
    YAM_SKILLS_HOME: skillsHome,
    npm_config_cache: cache,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  };

  try {
    run(npmCommand, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', tarball], { cwd: consumer, env });
    const installedDir = packageDirectory(consumer, receipt.package);
    const installedPackage = JSON.parse(readFileSync(join(installedDir, 'package.json'), 'utf8'));
    if (installedPackage.name !== receipt.package || installedPackage.version !== receipt.version) throw new Error('installed package identity does not match the packed artifact receipt');
    run(process.execPath, ['--input-type=module', '--eval', [
      `const nextStep = await import(${JSON.stringify(`${receipt.package}/next-step`)});`,
      `const scoutReceipt = await import(${JSON.stringify(`${receipt.package}/scout-receipt`)});`,
      'if (typeof nextStep.buildNextStep !== "function" || typeof nextStep.verifyNextStep !== "function") throw new Error("Next step export missing");',
      'if (typeof scoutReceipt.createScoutReceipt !== "function" || typeof scoutReceipt.verifyScoutReceipt !== "function") throw new Error("Scout receipt export missing");'
    ].join('\n')], { cwd: consumer, env });
    const binRelative = typeof installedPackage.bin === 'string' ? installedPackage.bin : installedPackage.bin?.yam;
    if (!binRelative) throw new Error('packed package does not expose the yam binary');
    const cli = join(installedDir, binRelative);

    const observedVersion = run(process.execPath, [cli, 'version'], { cwd: consumer, env }).trim();
    if (!observedVersion.includes(receipt.version)) throw new Error(`yam version did not report ${receipt.version}: ${observedVersion}`);
    run(process.execPath, [cli, 'install'], { cwd: consumer, env });
    run(process.execPath, [cli, 'status'], { cwd: consumer, env });
    const doctor = JSON.parse(run(process.execPath, [cli, 'doctor', '--json'], { cwd: consumer, env }));
    if (!doctor || typeof doctor !== 'object') throw new Error('yam doctor did not return a JSON object');
    run(process.execPath, [cli, 'install'], { cwd: consumer, env });
    run(process.execPath, [cli, 'status'], { cwd: consumer, env });
    run(process.execPath, [cli, 'uninstall'], { cwd: consumer, env });
    run(npmCommand, ['uninstall', '--ignore-scripts', '--no-audit', '--no-fund', receipt.package], { cwd: consumer, env });
    if (existsSync(installedDir)) throw new Error('npm uninstall left the packed package installed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runSelfTest() {
  const root = mkdtempSync(join(tmpdir(), 'yam-packed-self-test-'));
  const artifactDir = join(root, 'artifact');
  const receiptPath = join(artifactDir, 'receipt.json');
  mkdirSync(artifactDir, { recursive: true });
  try {
    execFileSync(npmCommand, ['pack', '--json', '--pack-destination', artifactDir], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    findSingleTarball(artifactDir);
    writeReceipt(artifactDir, receiptPath);
    const verified = verifyReceipt(artifactDir, receiptPath);
    let mismatchBlocked = false;
    try {
      verifyReceipt(artifactDir, receiptPath, '0'.repeat(64));
    } catch {
      mismatchBlocked = true;
    }
    if (!mismatchBlocked) throw new Error('mismatched workflow digest was not blocked');
    runLifecycle(verified.receipt, verified.tarball);
    console.log(`packed-lifecycle-smoke: ok (${verified.receipt.artifact}, sha256 ${verified.receipt.sha256})`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
  } else {
    if (!options.artifactDir) throw new Error('--artifact-dir is required');
    const artifactDir = resolve(options.artifactDir);
    const receiptPath = resolve(options.writeReceipt || options.receipt || join(artifactDir, 'receipt.json'));
    if (options.writeReceipt) writeReceipt(artifactDir, receiptPath);
    const verified = verifyReceipt(artifactDir, receiptPath, options.expectedSha256);
    if (!options.verifyOnly) runLifecycle(verified.receipt, verified.tarball);
    console.log(`packed-lifecycle: ok (${verified.receipt.artifact}, sha256 ${verified.receipt.sha256}${options.verifyOnly ? ', receipt only' : ', lifecycle exercised'})`);
  }
} catch (error) {
  console.error(`packed-lifecycle: failed (${error instanceof Error ? error.message : String(error)})`);
  process.exitCode = 1;
}
