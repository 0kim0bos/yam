import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const MAX_FILES = 4000;
const MAX_BYTES = 2 * 1024 * 1024;
type Snapshot = { root: string; files: Record<string, string> };
type Policy = { include: string[]; exclude: string[]; strict: boolean };

function git(dir: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 750, maxBuffer: MAX_BYTES,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  if (result.status !== 0) throw new Error('git_scope_unavailable');
  return result.stdout;
}

function snapshot(dir: string): Snapshot {
  const root = fs.realpathSync(git(dir, ['rev-parse', '--show-toplevel']).trim());
  const config = policy(root);
  const files: Record<string, string> = Object.create(null);
  let bytesRead = 0;
  const tracked = git(root, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean);
  for (const row of tracked) {
    const tab = row.indexOf('\t');
    if (selected(row.slice(tab + 1), config)) files[row.slice(tab + 1)] = hash(row.slice(0, tab));
  }
  const rows = git(root, ['status', '--short', '-z', '--untracked-files=all']).split('\0');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const name = row.slice(3);
    if (/[RC]/.test(row.slice(0, 2))) i++;
    if (!selected(name, config)) continue;
    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep)) throw new Error('unsafe_path');
    // Do not follow symlinks, including symlinked parent directories.
    let parent = path.dirname(target);
    while (parent !== root) {
      try { if (fs.lstatSync(parent).isSymbolicLink()) throw new Error('unsafe_path'); }
      catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      parent = path.dirname(parent);
    }
    let content = 'missing';
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) content = 'link:' + hash(fs.readlinkSync(target));
      else if (stat.isFile() && (bytesRead += stat.size) <= MAX_BYTES) content = hash(fs.readFileSync(target));
      else throw new Error('scope_limit');
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    files[name] = hash(JSON.stringify([row.slice(0, 2), files[name] || '', content]));
  }
  if (Object.keys(files).length > MAX_FILES) throw new Error('scope_limit');
  return { root, files };
}

function policy(root: string): Policy {
  const target = path.join(root, '.yam', 'study-note.json');
  let value: any = {};
  if (fs.existsSync(target)) {
    if (fs.lstatSync(path.dirname(target)).isSymbolicLink() || fs.lstatSync(target).isSymbolicLink()
      || fs.statSync(target).size > 16384) throw new Error('invalid_policy');
    value = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!value || !['advisory', 'strict', undefined].includes(value.mode)) throw new Error('invalid_policy');
  }
  const list = (key: string) => {
    const result = value[key] || [];
    if (!Array.isArray(result) || result.length > 100 || result.some((x: any) => typeof x !== 'string'
      || !x || x.startsWith('/') || x.includes('..') || /[\\\0]/.test(x) || x.replace(/\/\*\*$/, '').includes('*'))) throw new Error('invalid_policy');
    return result;
  };
  return { include: list('include'), exclude: list('exclude'), strict: value.mode === 'strict' };
}

const matches = (name: string, pattern: string) => pattern.endsWith('/**')
  ? name.startsWith(pattern.slice(0, -2)) : name === pattern;
function selected(name: string, config: Policy) {
  if (config.include.some(p => matches(name, p))) return true;
  if (config.exclude.some(p => matches(name, p))) return false;
  return !/^(dist\/|\.yam\/(mission|security|logs|screenshots)\/)/.test(name)
    && !/\.tgz$/.test(name);
}

function statePath(root: string, session: string) {
  const dir = path.join(os.tmpdir(), `yam-study-note-${process.getuid?.() ?? 'user'}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())
    || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('unsafe_state');
  return path.join(dir, hash(root + '\0' + session) + '.json');
}

/** Hash-only, bounded scope evidence; not a security attestation. */
export function studyNoteTurnScope(input: any, cwd: string, begin = false) {
  try {
    const session = String(input.session_id || input.sessionId || input.thread_id || '');
    const turn = String(input.turn_id || input.turnId || '');
    if (!session || session.length > 512 || turn.length > 512) throw new Error('session_unavailable');
    const current = snapshot(cwd);
    const config = policy(current.root);
    const target = statePath(current.root, session);
    if (begin) {
      const prompt = String(input.prompt || input.user_prompt || '');
      // Deep/Mission alone do not make a read-only task strict. Risk intent or explicit strict does.
      const strict = config.strict || /(?:study-note\s+strict|strict\s+study.note|commit|push|deploy|publish|security|migration|database|\bDB\b|커밋|푸시|배포|보안|마이그레이션|데이터베이스)/i.test(prompt);
      const state = { schema: 'yam.study-note-baseline.v1', created: Date.now(), turn, strict, ...current };
      try {
        const previous = fs.lstatSync(target);
        if (!previous.isFile() || previous.isSymbolicLink() || previous.nlink !== 1
          || (process.getuid && previous.uid !== process.getuid())) throw new Error('unsafe_state');
      } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0), 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(state)); } finally { fs.closeSync(fd); }
      return { available: true, files: [], source: 'turn_baseline', mode: strict ? 'strict' : 'advisory', reason: '' };
    }
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error('invalid_baseline');
    const before = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (before.schema !== 'yam.study-note-baseline.v1' || before.root !== current.root
      || !before.files || typeof before.files !== 'object' || Array.isArray(before.files)
      || !Number.isFinite(before.created) || typeof before.strict !== 'boolean'
      || Object.keys(before.files).length > MAX_FILES
      || Object.values(before.files).some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
      || Date.now() - before.created > 24 * 60 * 60 * 1000 || before.created > Date.now()
      || (turn && before.turn !== turn)) throw new Error('stale_baseline');
    const files = [...new Set([...Object.keys(before.files), ...Object.keys(current.files)])]
      .filter(name => before.files[name] !== current.files[name] && selected(name, config));
    return { available: true, files, source: 'turn_baseline', mode: config.strict || before.strict ? 'strict' : 'advisory', reason: '' };
  } catch {
    return { available: false, files: [], source: 'turn_baseline', mode: 'advisory', reason: 'baseline_unavailable; inspect changed artifacts manually' };
  }
}
