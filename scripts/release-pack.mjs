#!/usr/bin/env node
// Release tarballs carry their source revision even when published by filename.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function packedManifest(tarball) {
  return JSON.parse(execFileSync('tar', ['-xOf', resolve(tarball), 'package/package.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
}

export function verifyPackedSource(tarball, expectedCommit) {
  const manifest = packedManifest(tarball);
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || '') || manifest.gitHead !== expectedCommit) {
    throw new Error('release tarball gitHead is missing or differs from the exact source commit');
  }
  return manifest;
}

export function packRelease(root, destination, npmCli = process.env.npm_execpath) {
  root = resolve(root); destination = resolve(destination);
  if (!npmCli || !existsSync(npmCli)) throw new Error('run through npm run release:pack');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('release packing requires a clean source checkout');
  const commit = git('rev-parse', 'HEAD');
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('exact source commit required');
  const npm = (args, cwd) => JSON.parse(execFileSync(process.execPath, [npmCli, ...args], {
    cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  }));
  const listing = npm(['pack', '--dry-run', '--ignore-scripts', '--json'], root)[0];
  const scratch = mkdtempSync(join(tmpdir(), 'yam-release-pack-'));
  try {
    for (const { path: file } of listing.files) {
      if (isAbsolute(file) || file.split(/[\\/]/).some(p => p === '..' || !p)) throw new Error('unsafe package entry');
      let current = root;
      for (const part of file.split('/')) {
        current = join(current, part);
        if (lstatSync(current).isSymbolicLink()) throw new Error('linked package entry');
      }
      if (!lstatSync(current).isFile()) throw new Error('non-file package entry');
      const target = join(scratch, file);
      mkdirSync(dirname(target), { recursive: true }); copyFileSync(current, target);
    }
    const manifestPath = join(scratch, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.gitHead = commit;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    // Copying/packing must not silently include source edits made after the check.
    if (git('status', '--porcelain', '--untracked-files=all') || git('rev-parse', 'HEAD') !== commit) throw new Error('source changed during release packing');
    mkdirSync(destination, { recursive: true });
    if (existsSync(join(destination, `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`))) throw new Error('release artifact already exists');
    const packed = npm(['pack', '--ignore-scripts', '--json', '--pack-destination', destination], scratch)[0];
    verifyPackedSource(join(destination, packed.filename), commit);
    return { ...packed, source_commit: commit };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('usage: npm run release:pack -- <artifact-directory>');
    console.log(JSON.stringify(packRelease(process.cwd(), process.argv[2]), null, 2));
  } catch (error) { console.error(`release-pack: ${error.message}`); process.exitCode = 1; }
}
