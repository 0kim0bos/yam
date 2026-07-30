#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const benchmarkRoot = path.resolve(scriptDir, '..');
const repositoryRoot = path.resolve(benchmarkRoot, '../..');
const experiment = JSON.parse(
  await fsp.readFile(path.join(benchmarkRoot, 'experiment.json'), 'utf8'),
);

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  validateExperiment();
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'yam-ab-selftest-'));
  const results = [];
  try {
    results.push(await verifyBaselineSnapshot(temporaryRoot));
    results.push(await verifyBaselineRefusals(temporaryRoot));
    for (const fixture of experiment.fixtures) {
      results.push(await verifyFixture(fixture, temporaryRoot));
    }
  } finally {
    await fsp.rm(temporaryRoot, { recursive: true, force: true });
  }

  if (await exists(temporaryRoot)) {
    throw new Error(`self-test cleanup did not remove temporary root: ${temporaryRoot}`);
  }
  console.log('yam-ab offline scaffold selftest: ok');
  for (const result of results) console.log(`- ${result}`);
  console.log('- cleanup: temporary baseline and fixture workspaces removed');
}

function validateExperiment() {
  assert(experiment.schema === 'yam.ab-experiment.v1', 'unexpected experiment schema');
  assert(experiment.phase === 'phase1_controlled_runner', 'unexpected experiment phase');
  assert(
    experiment.runtime?.agentic_execution_default === false,
    'agentic execution must remain opt-in',
  );
  assert(/^[0-9a-f]{40,64}$/.test(experiment.baseline?.git_commit || ''), 'baseline commit must be full');
  assert(Array.isArray(experiment.fixtures) && experiment.fixtures.length === 8, 'experiment expects eight fixtures');
  for (const fixture of experiment.fixtures) {
    assert(/^[a-z0-9-]+$/.test(fixture.id), `unsafe fixture id: ${fixture.id}`);
    assert(/^[a-z0-9_]+$/.test(fixture.category), `unsafe fixture category: ${fixture.id}`);
    assert(Array.isArray(fixture.protected_files) && fixture.protected_files.length > 0, `${fixture.id} protected files missing`);
    assert(Array.isArray(fixture.mutable_files) && fixture.mutable_files.length === 1, `${fixture.id} mutable file contract changed`);
    assert(
      !fixture.protected_files.some((file) => fixture.mutable_files.includes(file)),
      `${fixture.id} mutable and protected paths overlap`,
    );
    if (fixture.id === 'safe-upload-path') {
      assert(
        fixture.contract_version === 'lexical-filename-v2',
        'safe-upload-path contract version changed',
      );
      assert(
        typeof fixture.scope_boundary === 'string' && fixture.scope_boundary.length > 0,
        'safe-upload-path scope boundary is missing',
      );
    }
  }
}

async function verifyBaselineSnapshot(temporaryRoot) {
  const output = path.join(temporaryRoot, 'baseline-arm-a');
  const result = spawnSync(process.execPath, [
    path.join(scriptDir, 'prepare-baseline.mjs'),
    '--commit',
    experiment.baseline.git_commit,
    '--out',
    output,
    '--json',
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert(result.status === 0, `baseline preparation failed: ${result.stderr || result.stdout}`);
  const receipt = JSON.parse(result.stdout);
  const manifest = JSON.parse(await fsp.readFile(path.join(output, 'arm-manifest.json'), 'utf8'));
  assert(receipt.commit === experiment.baseline.git_commit, 'baseline command resolved a different commit');
  assert(manifest.source.commit === experiment.baseline.git_commit, 'manifest commit mismatch');
  assert(manifest.arm_id === 'A', 'baseline arm id mismatch');
  assert(manifest.files.some((file) => file.path === 'AGENTS.md'), 'AGENTS.md missing from baseline');
  assert(manifest.files.some((file) => file.path === 'skills/quick/SKILL.md'), 'quick skill missing from baseline');
  assert(
    manifest.files.some((file) => file.path === 'references/verification-levels.md'),
    'verification reference missing from baseline',
  );

  const verified = [];
  for (const file of manifest.files) {
    const bytes = await fsp.readFile(path.join(output, file.path));
    const hash = sha256(bytes);
    assert(bytes.length === file.bytes, `baseline byte count mismatch: ${file.path}`);
    assert(hash === file.sha256, `baseline hash mismatch: ${file.path}`);
    verified.push(file);
  }
  assert(
    aggregateFileDigest(verified) === manifest.source_snapshot_sha256,
    'baseline aggregate digest mismatch',
  );

  const snapshotAgents = await fsp.readFile(path.join(output, 'AGENTS.md'));
  const committedAgents = gitBuffer([
    'show',
    `${experiment.baseline.git_commit}:AGENTS.md`,
  ]);
  assert(snapshotAgents.equals(committedAgents), 'baseline used working-tree AGENTS.md instead of Git object');
  return `baseline: ${manifest.file_count} files, sha256 ${manifest.source_snapshot_sha256.slice(0, 16)}…`;
}

async function verifyBaselineRefusals(temporaryRoot) {
  const existing = path.join(temporaryRoot, 'existing-baseline');
  await fsp.mkdir(existing);
  const existingResult = runBaselinePreparation(existing);
  assert(existingResult.status !== 0, 'baseline preparation must refuse an existing target');

  const outside = path.join(repositoryRoot, `.yam-ab-outside-${randomUUID()}`);
  const outsideResult = runBaselinePreparation(outside);
  assert(outsideResult.status !== 0, 'baseline preparation must refuse a target outside temp');
  assert(!(await exists(outside)), 'outside-temp refusal unexpectedly created a target');

  const link = path.join(temporaryRoot, 'repository-link');
  await fsp.symlink(repositoryRoot, link, 'dir');
  const escaped = path.join(link, `.yam-ab-symlink-${randomUUID()}`);
  const symlinkResult = runBaselinePreparation(escaped);
  assert(symlinkResult.status !== 0, 'baseline preparation must refuse a symlinked parent');
  assert(!(await exists(escaped)), 'symlink-parent refusal unexpectedly created a target');

  return 'baseline guards: existing, outside-temp, and symlinked-parent targets rejected';
}

function runBaselinePreparation(output) {
  return spawnSync(process.execPath, [
    path.join(scriptDir, 'prepare-baseline.mjs'),
    '--commit',
    experiment.baseline.git_commit,
    '--out',
    output,
    '--json',
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function verifyFixture(fixture, temporaryRoot) {
  const fixtureRoot = path.join(benchmarkRoot, 'fixtures', fixture.id);
  const scorer = path.join(benchmarkRoot, fixture.scorer);
  assert(await exists(path.join(fixtureRoot, 'seed')), `${fixture.id} seed missing`);
  assert(await exists(scorer), `${fixture.id} scorer missing`);

  const seedWorkspace = path.join(temporaryRoot, `${fixture.id}-seed`);
  await fsp.cp(path.join(fixtureRoot, 'seed'), seedWorkspace, { recursive: true });
  const seedScore = scoreWorkspace(scorer, seedWorkspace);
  assert(seedScore.status !== 0 && seedScore.score.pass === false, `${fixture.id} seed should be incomplete`);

  const goodWorkspace = path.join(temporaryRoot, `${fixture.id}-good`);
  await fsp.cp(path.join(fixtureRoot, 'seed'), goodWorkspace, { recursive: true });
  await fsp.cp(path.join(fixtureRoot, 'references', 'good'), goodWorkspace, { recursive: true });
  const goodScore = scoreWorkspace(scorer, goodWorkspace);
  assert(goodScore.status === 0 && goodScore.score.pass === true, `${fixture.id} good reference should pass`);

  const badWorkspace = path.join(temporaryRoot, `${fixture.id}-bad`);
  await fsp.cp(path.join(fixtureRoot, 'seed'), badWorkspace, { recursive: true });
  await fsp.cp(path.join(fixtureRoot, 'references', 'bad'), badWorkspace, { recursive: true });
  const badScore = scoreWorkspace(scorer, badWorkspace);
  assert(badScore.status !== 0 && badScore.score.pass === false, `${fixture.id} bad reference should fail`);
  assert(
    badScore.score.checks?.node_tests?.pass === true,
    `${fixture.id} bad reference must pass visible tests so the hidden scorer adds value`,
  );
  assert(
    goodScore.score.checks?.protected_files?.pass === true,
    `${fixture.id} good reference must preserve protected inputs`,
  );
  if (fixture.id === 'safe-upload-path') {
    assert(
      goodScore.score.checks?.security?.cases?.drive_relative_rejected?.pass === true,
      'safe-upload-path good reference must reject drive-relative input',
    );
    assert(
      badScore.score.checks?.security?.cases?.drive_relative_rejected?.pass === false,
      'safe-upload-path bad reference must expose the drive-relative gap',
    );
  }
  return `${fixture.id}: seed rejected, good accepted, happy-path bad rejected`;
}

function scoreWorkspace(scorer, workspace) {
  const result = spawnSync(process.execPath, [scorer, workspace], {
    cwd: benchmarkRoot,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  let score;
  try {
    score = JSON.parse(result.stdout);
  } catch {
    throw new Error(`scorer returned invalid JSON (${scorer}): ${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, score };
}

function gitBuffer(args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 8 * 1024 * 1024,
  });
  assert(result.status === 0, `git ${args[0]} failed`);
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function aggregateFileDigest(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(`${file.path}\0${file.mode}\0${file.bytes}\0${file.sha256}\n`);
  }
  return hash.digest('hex');
}

async function exists(target) {
  try {
    await fsp.lstat(target);
    return true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
