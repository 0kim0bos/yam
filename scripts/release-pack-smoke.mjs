#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packRelease, packedManifest, verifyPackedSource } from './release-pack.mjs';

const root = mkdtempSync(join(tmpdir(), 'yam-release-pack-smoke-'));
const source = join(root, 'source'); const output = join(root, 'output');
const server = createServer();
try {
  mkdirSync(source); mkdirSync(output);
  const manifestPath = join(source, 'package.json');
  writeFileSync(manifestPath, JSON.stringify({ name: 'yam-release-fixture', version: '1.0.0', files: ['index.js'], scripts: { prepack: 'exit 92', prepublishOnly: 'exit 93' } }));
  writeFileSync(join(source, 'index.js'), 'export const ok = true;\n');
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', '.');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  const commit = git('rev-parse', 'HEAD'); const before = readFileSync(manifestPath, 'utf8');
  const legacyOutput = join(root, 'legacy'); mkdirSync(legacyOutput);
  const legacy = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--ignore-scripts', '--json', '--pack-destination', legacyOutput], { cwd: source, encoding: 'utf8' }))[0];
  assert.throws(() => verifyPackedSource(join(legacyOutput, legacy.filename), commit), /gitHead/, 'the previous plain-pack publication is rejected');
  const packed = packRelease(source, output);
  const tarball = join(output, packed.filename);
  assert.equal(packedManifest(tarball).gitHead, commit);
  assert.equal(verifyPackedSource(tarball, commit).version, '1.0.0');
  assert.throws(() => verifyPackedSource(tarball, 'a'.repeat(40)), /gitHead/);
  assert.equal(readFileSync(manifestPath, 'utf8'), before, 'source manifest is not modified');
  assert.equal(git('status', '--porcelain'), '');
  assert.throws(() => packRelease(source, output), /already exists/);
  writeFileSync(join(source, 'index.js'), 'changed\n');
  assert.throws(() => packRelease(source, output), /clean source/);
  git('checkout', '--', 'index.js');
  // A real npm publish to a loopback-only fake registry proves outgoing metadata.
  let published;
  server.on('request', (req, res) => {
    let body = ''; req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      if (req.method === 'PUT') { published = JSON.parse(body); res.writeHead(201, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }
      else { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const registry = `http://127.0.0.1:${server.address().port}/`;
  const config = join(root, 'npmrc');
  writeFileSync(config, `registry=${registry}\n//127.0.0.1:${server.address().port}/:_authToken=fixture-only\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.env.npm_execpath, 'publish', tarball, '--ignore-scripts', '--registry', registry, '--userconfig', config, '--access', 'public'], {
      cwd: root, env: { ...process.env, HOME: root, USERPROFILE: root, npm_config_cache: join(root, 'cache'), NPM_CONFIG_USERCONFIG: config, npm_config_provenance: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let message = ''; child.stdout.on('data', b => { message += b; }); child.stderr.on('data', b => { message += b; });
    const timer = setTimeout(() => child.kill(), 30000);
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`fixture npm publish failed: ${message}`)); });
  });
  assert.equal(published.versions['1.0.0'].gitHead, commit, 'npm tarball publication preserves source revision');
  for (const workflow of ['release.yml', 'supply-chain.yml']) {
    const text = readFileSync(fileURLToPath(new URL(`../.github/workflows/${workflow}`, import.meta.url)), 'utf8');
    assert.match(text, /npm run release:pack -- package-artifact/);
    assert.match(text, /scripts\/packed-lifecycle-smoke\.mjs/);
    assert.doesNotMatch(text, /npm pack --json --pack-destination/);
  }
  console.log('release-pack-smoke: ok (exact gitHead, real npm publication metadata, clean source, no lifecycle scripts, no source mutation, artifact collision)');
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
