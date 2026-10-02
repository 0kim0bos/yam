#!/usr/bin/env node
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSecretPatternIds } from './secret-patterns.mjs';

const MAX_FILES = 512;
const MAX_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

// This is a bounded content check, not an instruction interpreter or an offline runtime claim.
export function inspectSkillContent(root = process.cwd()) {
  root = resolve(root);
  const findings = [];
  let files = 0;
  let bytes = 0;
  const names = new Set();
  const finding = (path, code, line) => findings.push({ path: relative(root, path), code, ...(line ? { line } : {}) });
  const readRegular = (path) => {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error('not_regular');
    if (before.size > MAX_BYTES) throw new Error('file_limit');
    if (bytes + before.size > MAX_TOTAL_BYTES) throw new Error('byte_limit');
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error('identity_changed');
      const text = readFileSync(fd, 'utf8');
      const after = lstatSync(path);
      const end = fstatSync(fd);
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.isSymbolicLink() || end.size !== opened.size || end.mtimeMs !== opened.mtimeMs || Buffer.byteLength(text) > MAX_BYTES) throw new Error('identity_changed');
      bytes += Buffer.byteLength(text);
      return text;
    } finally { closeSync(fd); }
  };
  const inspectText = (path, text) => {
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (/(?:\/Users\/|\/home\/)[A-Za-z0-9][^\s/]*\/|[A-Za-z]:\\Users\\[^\s\\]+\\/.test(line)) finding(path, 'personal_absolute_path', index + 1);
      if (/\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i.test(line)) finding(path, 'download_pipe_shell', index + 1);
      for (const code of findSecretPatternIds(line)) finding(path, code, index + 1);
    }
    if (basename(path) !== 'SKILL.md') return;
    const fm = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const scalar = (key) => fm?.[1].match(new RegExp(`^${key}:\\s*([^\\r\\n]+)$`, 'm'))?.[1].trim().replace(/^(["'])(.*)\1$/, '$2');
    const name = scalar('name');
    if (!fm || !name || !scalar('description')) finding(path, 'frontmatter_required');
    if (name !== basename(resolve(path, '..'))) finding(path, 'frontmatter_name_mismatch');
    if (name && names.has(name)) finding(path, 'duplicate_skill_name');
    if (name) names.add(name);
  };
  const walk = (dir, depth = 0) => {
    if (depth > 8) { finding(dir, 'depth_limit'); return; }
    try {
      const stat = lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) { finding(dir, 'unsafe_directory'); return; }
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const path = join(dir, entry.name);
        if (++files > MAX_FILES) { finding(dir, 'file_limit'); return; }
        if (entry.isSymbolicLink()) { finding(path, 'symlink'); continue; }
        if (entry.isDirectory()) { walk(path, depth + 1); continue; }
        if (!entry.isFile()) { finding(path, 'not_regular'); continue; }
        if (!entry.name.endsWith('.md')) continue;
        try { inspectText(path, readRegular(path)); }
        catch { finding(path, 'unreadable_or_unsafe_file'); }
      }
    } catch { finding(dir, 'unreadable_directory'); }
  };
  walk(join(root, 'skills'));
  walk(join(root, 'references'));
  return { ok: findings.length === 0, scanned_entries: files, scanned_bytes: bytes, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectSkillContent();
  console.log(`skill-content: ${result.ok ? 'ok' : 'failed'} (${result.scanned_entries} entries)`);
  for (const item of result.findings) console.error(`skill-content: ${item.code} ${item.path}${item.line ? ':' + item.line : ''}`);
  if (!result.ok) process.exitCode = 1;
}
