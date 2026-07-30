#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    throw new Error('usage: prepare-baseline.mjs --out <new-temp-path> [--commit <sha>] [--json]');
  }

  let output = await validateOutputPath(args.out);
  if (await exists(output)) {
    throw new Error(`refusing to replace existing baseline output: ${output}`);
  }

  const requestedCommit = args.commit || experiment.baseline.git_commit;
  const commit = gitText(['rev-parse', '--verify', `${requestedCommit}^{commit}`]).trim();
  if (!/^[0-9a-f]{40,64}$/.test(commit)) {
    throw new Error(`Git did not resolve a full commit id: ${requestedCommit}`);
  }

  await fsp.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  output = await canonicalizeOutputPath(output);
  if (await exists(output)) {
    throw new Error(`refusing to replace existing baseline output: ${output}`);
  }
  let staging = await fsp.mkdtemp(path.join(path.dirname(output), '.yam-ab-baseline-stage-'));
  try {
    const entries = gitTreeEntries(commit, experiment.baseline.include);
    if (entries.length === 0) {
      throw new Error(`baseline include set resolved no files at ${commit}`);
    }

    const files = [];
    for (const entry of entries) {
      const target = safeChild(staging, entry.file);
      const bytes = gitBuffer(['cat-file', 'blob', entry.object]);
      await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fsp.writeFile(target, bytes, { mode: entry.mode === '100755' ? 0o755 : 0o644 });
      files.push({
        path: entry.file,
        mode: entry.mode,
        bytes: bytes.length,
        sha256: sha256(bytes),
        git_object: entry.object,
      });
    }

    const manifest = {
      schema: 'yam.ab-arm-manifest.v1',
      arm_id: experiment.baseline.arm_id,
      experiment_id: experiment.experiment_id,
      generated_at: new Date().toISOString(),
      source: {
        kind: 'git_commit',
        repository: 'local_checkout',
        commit,
        requested_commit: requestedCommit,
        dirty_worktree_files_are_excluded: true,
      },
      package: experiment.baseline.package,
      installed_skill_receipt_sha256: experiment.baseline.installed_skill_receipt_sha256,
      include: experiment.baseline.include,
      file_count: files.length,
      files,
      source_snapshot_sha256: aggregateFileDigest(files),
    };

    await fsp.writeFile(
      path.join(staging, 'arm-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
    await fsp.rename(staging, output);
    staging = '';

    const result = {
      ok: true,
      output,
      commit,
      file_count: manifest.file_count,
      source_snapshot_sha256: manifest.source_snapshot_sha256,
      manifest: path.join(output, 'arm-manifest.json'),
    };
    if (args.json) console.log(JSON.stringify(result));
    else {
      console.log(`baseline prepared: ${output}`);
      console.log(`commit: ${commit}`);
      console.log(`files: ${manifest.file_count}`);
      console.log(`sha256: ${manifest.source_snapshot_sha256}`);
    }
  } finally {
    if (staging) await fsp.rm(staging, { recursive: true, force: true });
  }
}

function parseArgs(args) {
  const parsed = { out: '', commit: '', json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--out') parsed.out = args[++index] || '';
    else if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length);
    else if (arg === '--commit') parsed.commit = args[++index] || '';
    else if (arg.startsWith('--commit=')) parsed.commit = arg.slice('--commit='.length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

async function validateOutputPath(value) {
  const output = path.resolve(value);
  const temporaryRoot = path.resolve(os.tmpdir());
  const relativeToTemp = path.relative(temporaryRoot, output);
  const relativeToRepository = path.relative(repositoryRoot, output);
  if (output === path.parse(output).root || output === temporaryRoot) {
    throw new Error(`baseline output must be a new child directory, not a broad root: ${output}`);
  }
  if (
    relativeToTemp.startsWith('..')
    || path.isAbsolute(relativeToTemp)
    || relativeToTemp === ''
  ) {
    throw new Error(`baseline output must stay under the operating-system temp directory: ${temporaryRoot}`);
  }
  if (
    relativeToRepository === ''
    || (!relativeToRepository.startsWith('..') && !path.isAbsolute(relativeToRepository))
  ) {
    throw new Error(`baseline output must not be inside the yam repository: ${output}`);
  }
  await rejectSymlinkedParent(temporaryRoot, path.dirname(output));
  return output;
}

async function rejectSymlinkedParent(root, parent) {
  const relative = path.relative(root, parent);
  let current = root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const metadata = await fsp.lstat(current);
      if (metadata.isSymbolicLink()) {
        throw new Error(`baseline output parent must not contain a symbolic link: ${current}`);
      }
      if (!metadata.isDirectory()) {
        throw new Error(`baseline output parent component is not a directory: ${current}`);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function canonicalizeOutputPath(output) {
  const [temporaryRoot, repository, parent] = await Promise.all([
    fsp.realpath(os.tmpdir()),
    fsp.realpath(repositoryRoot),
    fsp.realpath(path.dirname(output)),
  ]);
  const canonical = path.join(parent, path.basename(output));
  if (!isStrictChild(temporaryRoot, canonical)) {
    throw new Error(`baseline output resolved outside the operating-system temp directory: ${canonical}`);
  }
  if (canonical === repository || isStrictChild(repository, canonical)) {
    throw new Error(`baseline output resolved inside the yam repository: ${canonical}`);
  }
  return canonical;
}

function isStrictChild(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function gitTreeEntries(commit, includes) {
  const output = gitBuffer(['ls-tree', '-r', '-z', commit, '--', ...includes]).toString('utf8');
  const entries = output.split('\0').filter(Boolean).map((row) => {
    const match = row.match(/^([0-9]{6}) (blob|tree) ([0-9a-f]{40,64})\t(.+)$/);
    if (!match) throw new Error(`unexpected git ls-tree row: ${row}`);
    const [, mode, kind, object, file] = match;
    if (kind !== 'blob' || !['100644', '100755'].includes(mode)) {
      throw new Error(`unsupported baseline entry ${mode} ${kind}: ${file}`);
    }
    if (path.isAbsolute(file) || file.split('/').includes('..')) {
      throw new Error(`unsafe baseline path from Git: ${file}`);
    }
    return { mode, object, file };
  });
  return entries.sort((left, right) => left.file.localeCompare(right.file));
}

function gitText(args) {
  return gitBuffer(args).toString('utf8');
}

function gitBuffer(args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8').trim()
      : String(result.stderr || '').trim();
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '');
}

function safeChild(root, relative) {
  const target = path.resolve(root, relative);
  const fromRoot = path.relative(root, target);
  if (!fromRoot || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
    throw new Error(`unsafe baseline target: ${relative}`);
  }
  return target;
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
