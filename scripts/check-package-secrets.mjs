#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findSecretPatternIds,
  inspectSecretPatterns,
} from './secret-patterns.mjs';

export const MAX_PACKAGE_TEXT_BYTES = 2 * 1024 * 1024;

const PACKLIST_REDACTION_MARKERS = Object.freeze([
  { id: 'npm_token', regex: /\bnpm_\*{3,}/g },
  { id: 'github_token', regex: /\bgh[pousr]_\*{3,}/g },
  { id: 'github_fine_grained_token', regex: /\bgithub_pat_\*{3,}/g },
  { id: 'openai_api_key', regex: /\bsk-(?!ant-)(?:(?:proj|svcacct)-)?\*{3,}/g },
  { id: 'anthropic_api_key', regex: /\bsk-ant-(?:api\d{2}-)?\*{3,}/g },
  { id: 'aws_access_key_id', regex: /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)\*{3,}/g },
]);

function toPackagePath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join('/');
}

function isPathInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function inspectReportedPath(path) {
  const inspected = inspectSecretPatterns(String(path));
  const patternIds = [...inspected.patternIds];
  let redacted = inspected.redacted;
  for (const marker of PACKLIST_REDACTION_MARKERS) {
    marker.regex.lastIndex = 0;
    redacted = redacted.replace(marker.regex, () => {
      patternIds.push(marker.id);
      return `[redacted:${marker.id}]`;
    });
  }
  return {
    patternIds: [...new Set(patternIds)],
    redacted: redacted.replace(/[\u0000-\u001f\u007f]/g, '?'),
  };
}

function redactReportedPath(path) {
  return inspectReportedPath(path).redacted;
}

function decodeText(buffer) {
  if (buffer.includes(0)) return undefined;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    const controls = [...text].filter((character) => {
      const code = character.codePointAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    }).length;
    if (controls > Math.max(4, text.length * 0.01)) return undefined;
    return text;
  } catch {
    return undefined;
  }
}

export function getNpmPackFilePaths(root = process.cwd()) {
  const cache = mkdtempSync(join(tmpdir(), 'yam-package-secrets-npm-'));
  try {
    const output = execFileSync(
      'npm',
      ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: cache },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const packs = JSON.parse(output);
    const files = packs[0]?.files;
    if (!Array.isArray(files)) throw new Error('npm pack did not return a file list');
    return files
      .map((file) => file?.path)
      .filter((path) => typeof path === 'string' && path.length > 0);
  } catch (error) {
    const status = typeof error?.status === 'number' ? ` (exit ${error.status})` : '';
    throw new Error(`unable to inspect npm packlist${status}`);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

export function scanPackageFiles({
  root = process.cwd(),
  filePaths,
  maxBytes = MAX_PACKAGE_TEXT_BYTES,
  readFile = readFileSync,
} = {}) {
  const packageRoot = resolve(root);
  const findings = [];
  const skipped = [];
  let scanned = 0;

  for (const filePath of filePaths ?? getNpmPackFilePaths(packageRoot)) {
    const absolutePath = resolve(packageRoot, filePath);
    const displayPath = toPackagePath(packageRoot, absolutePath);
    const pathInspection = inspectReportedPath(displayPath);
    const reportedPath = pathInspection.redacted;
    for (const patternId of pathInspection.patternIds) {
      findings.push({ patternId, path: reportedPath, line: 0 });
    }
    if (!isPathInside(packageRoot, absolutePath)) {
      skipped.push({ path: redactReportedPath(filePath), reason: 'outside_package_root' });
      continue;
    }

    let stat;
    try {
      stat = lstatSync(absolutePath);
    } catch {
      skipped.push({ path: reportedPath, reason: 'unreadable' });
      continue;
    }
    if (stat.isSymbolicLink()) {
      skipped.push({ path: reportedPath, reason: 'symlink' });
      continue;
    }
    if (!stat.isFile()) {
      skipped.push({ path: reportedPath, reason: 'not_regular_file' });
      continue;
    }
    if (stat.size > maxBytes) {
      skipped.push({ path: reportedPath, reason: 'oversized' });
      continue;
    }

    let buffer;
    try {
      buffer = readFile(absolutePath);
    } catch {
      skipped.push({ path: reportedPath, reason: 'unreadable' });
      continue;
    }
    const text = decodeText(buffer);
    if (text === undefined) {
      skipped.push({ path: reportedPath, reason: 'binary' });
      continue;
    }

    scanned += 1;
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      for (const patternId of findSecretPatternIds(line)) {
        findings.push({ patternId, path: reportedPath, line: index + 1 });
      }
    }
  }

  return { findings, skipped, scanned };
}

export function formatScanResult(result) {
  const lines = [];
  for (const finding of result.findings) {
    const path = redactReportedPath(finding.path);
    lines.push(`package-secrets: finding pattern=${finding.patternId} path=${path} line=${finding.line}`);
  }
  for (const skip of result.skipped) {
    const path = redactReportedPath(skip.path);
    lines.push(`package-secrets: skipped reason=${skip.reason} path=${path}`);
  }
  return lines;
}

function main() {
  try {
    const result = scanPackageFiles();
    for (const line of formatScanResult(result)) {
      if (line.includes(': finding ')) console.error(line);
      else console.warn(line);
    }
    if (result.findings.length > 0) {
      console.error(`package-secrets: failed (${result.findings.length} finding(s))`);
      process.exitCode = 1;
      return;
    }
    console.log(`package-secrets: ok (${result.scanned} text files scanned, ${result.skipped.length} skipped)`);
  } catch (error) {
    console.error(`package-secrets: failed (${error instanceof Error ? error.message : 'unknown error'})`);
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryPath === resolve(fileURLToPath(import.meta.url))) main();
