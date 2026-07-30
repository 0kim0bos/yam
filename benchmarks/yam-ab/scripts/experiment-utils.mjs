import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const benchmarkRoot = path.resolve(scriptDir, '..');
export const repositoryRoot = path.resolve(benchmarkRoot, '../..');
export const experiment = JSON.parse(
  await fsp.readFile(path.join(benchmarkRoot, 'experiment.json'), 'utf8'),
);

export function safeChild(root, relative) {
  if (typeof relative !== 'string' || !relative) {
    throw new Error('safe child path must be a non-empty string');
  }
  const target = path.resolve(root, relative);
  const fromRoot = path.relative(root, target);
  if (!fromRoot || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
    throw new Error(`unsafe child path: ${relative}`);
  }
  return target;
}

export async function exists(target) {
  try {
    await fsp.lstat(target);
    return true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return false;
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function gitText(commit, relative) {
  if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new Error('Git commit must be a full id');
  if (path.isAbsolute(relative) || relative.split('/').includes('..')) {
    throw new Error(`unsafe Git path: ${relative}`);
  }
  const result = spawnSync('git', ['show', `${commit}:${relative}`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`could not read ${relative} from baseline commit: ${String(result.stderr).trim()}`);
  }
  return result.stdout;
}

export function shuffled(values, seed) {
  const copy = [...values];
  const random = seededRandom(seed);
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function sanitizeText(value) {
  let text = String(value || '');
  const replacements = [
    [repositoryRoot, '<YAM_REPOSITORY>'],
    [os.homedir(), '<HOME>'],
  ];
  for (const [source, target] of replacements) {
    if (source) text = text.split(source).join(target);
  }
  return text
    .replace(/\b(?:sk|sess|key)-[A-Za-z0-9_-]{12,}\b/g, '<REDACTED_TOKEN>')
    .replace(/("(?:api_?key|access_?token|authorization)"\s*:\s*")[^"]+(")/gi, '$1<REDACTED>$2');
}

export async function writeJsonAtomic(target, value, mode = 0o600) {
  await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const staging = `${target}.stage-${process.pid}-${Date.now()}`;
  try {
    await fsp.writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, { mode });
    await fsp.rename(staging, target);
  } finally {
    if (await exists(staging)) await fsp.rm(staging, { force: true });
  }
}

export async function createNewTempOutput(requested) {
  const output = path.resolve(requested);
  const temporaryRoot = path.resolve(os.tmpdir());
  if (!isStrictChild(temporaryRoot, output)) {
    throw new Error(`output must be a new child of the operating-system temp directory: ${temporaryRoot}`);
  }
  if (output === repositoryRoot || isStrictChild(repositoryRoot, output)) {
    throw new Error(`output must not be inside the yam repository: ${output}`);
  }
  await rejectSymlinkedParent(temporaryRoot, path.dirname(output));
  if (await exists(output)) throw new Error(`refusing to replace existing output: ${output}`);
  await fsp.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });

  const [realTemp, realRepository, realParent] = await Promise.all([
    fsp.realpath(os.tmpdir()),
    fsp.realpath(repositoryRoot),
    fsp.realpath(path.dirname(output)),
  ]);
  const canonical = path.join(realParent, path.basename(output));
  if (!isStrictChild(realTemp, canonical)) {
    throw new Error(`output resolved outside the operating-system temp directory: ${canonical}`);
  }
  if (canonical === realRepository || isStrictChild(realRepository, canonical)) {
    throw new Error(`output resolved inside the yam repository: ${canonical}`);
  }
  if (await exists(canonical)) throw new Error(`refusing to replace existing output: ${canonical}`);
  await fsp.mkdir(canonical, { mode: 0o700 });
  return canonical;
}

export async function requireExistingTempDirectory(requested) {
  const [temporaryRoot, repository, target] = await Promise.all([
    fsp.realpath(os.tmpdir()),
    fsp.realpath(repositoryRoot),
    fsp.realpath(path.resolve(requested)),
  ]);
  const metadata = await fsp.stat(target);
  if (!metadata.isDirectory()) throw new Error(`expected a directory: ${target}`);
  if (!isStrictChild(temporaryRoot, target)) {
    throw new Error(`directory must be under the operating-system temp directory: ${temporaryRoot}`);
  }
  if (target === repository || isStrictChild(repository, target)) {
    throw new Error(`directory must not be inside the yam repository: ${target}`);
  }
  return target;
}

export async function listFiles(root) {
  const files = [];
  await walk(root, '');
  return files.sort();

  async function walk(directory, prefix) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? path.join(prefix, entry.name) : entry.name;
      if (entry.isSymbolicLink()) {
        files.push(`${relative}@symlink`);
      } else if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name), relative);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }
}

function seededRandom(seed) {
  const initial = createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
  let state = initial || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

async function rejectSymlinkedParent(root, parent) {
  const relative = path.relative(root, parent);
  let current = root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const metadata = await fsp.lstat(current);
      if (metadata.isSymbolicLink()) {
        throw new Error(`output parent must not contain a symbolic link: ${current}`);
      }
      if (!metadata.isDirectory()) {
        throw new Error(`output parent component is not a directory: ${current}`);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

function isStrictChild(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
