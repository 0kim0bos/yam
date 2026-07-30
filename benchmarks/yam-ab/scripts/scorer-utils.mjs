import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function requireWorkspace(value) {
  if (!value) throw new Error('scorer requires a workspace path');
  const workspace = path.resolve(value);
  if (workspace === path.parse(workspace).root) {
    throw new Error(`refusing a filesystem root as scorer workspace: ${workspace}`);
  }
  return workspace;
}

export function runNodeTests(workspace) {
  const result = spawnSync(process.execPath, ['--test'], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '',
      LANG: 'C',
      LC_ALL: 'C',
      TZ: 'UTC',
    },
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return {
    pass: result.status === 0,
    exit_code: result.status,
    timed_out: Boolean(result.error?.code === 'ETIMEDOUT'),
    stdout: String(result.stdout || '').slice(-4000),
    stderr: String(result.stderr || '').slice(-4000),
  };
}

export async function compareProtectedFiles(fixtureRoot, workspace, relativeFiles) {
  const rows = [];
  for (const relative of relativeFiles) {
    const canonical = safeChild(path.join(fixtureRoot, 'seed'), relative);
    const candidate = safeChild(workspace, relative);
    const [expected, actual] = await Promise.all([
      readFileOrNull(canonical),
      readFileOrNull(candidate),
    ]);
    rows.push({
      path: relative,
      present: actual !== null,
      expected_sha256: expected === null ? '' : sha256(expected),
      actual_sha256: actual === null ? '' : sha256(actual),
      match: expected !== null && actual !== null && expected.equals(actual),
    });
  }
  return {
    pass: rows.every((row) => row.match),
    files: rows,
  };
}

export async function importWorkspaceModule(workspace, relative) {
  const file = safeChild(workspace, relative);
  const url = `${pathToFileURL(file).href}?score=${randomUUID()}`;
  return import(url);
}

export async function readWorkspaceText(workspace, relative) {
  return fsp.readFile(safeChild(workspace, relative), 'utf8');
}

export async function listWorkspaceFiles(workspace, relativeRoot = '.') {
  const root = safeChild(workspace, relativeRoot);
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

export function emitScore(score) {
  console.log(JSON.stringify(score));
  if (!score.pass) process.exitCode = 1;
}

function safeChild(root, relative) {
  const target = path.resolve(root, relative);
  const fromRoot = path.relative(root, target);
  if (!fromRoot || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
    throw new Error(`unsafe scorer path: ${relative}`);
  }
  return target;
}

async function readFileOrNull(file) {
  try {
    return await fsp.readFile(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
