#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const cache = join(tmpdir(), 'yam-npm-cache');
const env = { ...process.env, npm_config_cache: cache };
const packJson = execFileSync('npm', ['pack', '--json', '--ignore-scripts'], { encoding: 'utf8', env });
const tarball = JSON.parse(packJson)[0]?.filename;
if (!tarball) throw new Error('npm pack did not return a tarball filename');

const prefix = mkdtempSync(join(tmpdir(), 'yam-cli-smoke-'));
try {
  execFileSync('npm', ['install', '--prefix', prefix, join(root, tarball)], { stdio: 'ignore', env });
  const binCandidates = [
    join(prefix, 'node_modules', '.bin', 'yam'),
    join(prefix, 'bin', 'yam'),
    join(prefix, 'node_modules', String(packageJson.name), 'dist', 'bin', 'yam.js')
  ];
  const bin = binCandidates.find((candidate) => existsSync(candidate));
  if (!bin) throw new Error(`yam binary not found after install. Tried: ${binCandidates.join(', ')}`);
  const version = execFileSync(bin, ['version'], { encoding: 'utf8' }).trim();
  execFileSync(bin, ['verify'], { stdio: 'ignore' });
  execFileSync(bin, ['doctor'], { stdio: 'ignore' });
  execFileSync(bin, ['doctor', '--json'], { stdio: 'ignore' });
  execFileSync(bin, ['list'], { stdio: 'ignore' });
  execFileSync(bin, ['ueye', '--help'], { stdio: 'ignore' });
  execFileSync(bin, ['ueye', 'capture', '--help'], { stdio: 'ignore' });
  execFileSync(bin, ['ueye', 'compare', '--help'], { stdio: 'ignore' });
  execFileSync(bin, ['ueye', 'report', '--help'], { stdio: 'ignore' });
  execFileSync(bin, ['ueye', 'report', '--review-session-id', 'smoke', '--similar', 'reference inventory recorded', '--resolved', 'primary visual note', '--new-finding', 'mobile state missing', '--still-open', 'actual screenshot needed', '--viewport', '1440x900', '--state', 'default', '--json'], { stdio: 'ignore' });
  execFileSync(bin, ['ueye', 'report', '--completion-claim', 'done', '--design-quality', 'not-checked', '--json'], { stdio: 'ignore' });
  expectFailure(() => execFileSync(bin, ['ueye', 'report', '--completion-claim', 'done', '--design-quality', 'pass', '--p0', 'primary CTA is clipped', '--json'], { stdio: 'ignore' }), 'Ueye P0 completion gate should fail');
  execFileSync(bin, ['media', 'proof', '--help'], { stdio: 'ignore' });
  execFileSync(bin, ['media', 'proof', '--json'], { stdio: 'ignore' });
  execFileSync(bin, ['proof', '--route', 'ueye', '--truth', 'verified', '--visual', 'implementation screenshot evidence recorded', '--design-completion', '{"completion_claim":"done","has_implementation_screenshot":true,"design_quality":"pass","states_checked":true,"mobile_checked":true,"contrast_checked":true,"cta_checked":true,"direction_locked":true,"truth_status":"verified"}', '--json'], { stdio: 'ignore' });
  execFileSync(bin, ['runtime', 'evidence', '--help'], { stdio: 'ignore' });
  execFileSync(bin, ['runtime', 'evidence', '--backend', 'terminal', '--claim', 'observed', '--evidence-id', 'smoke-runtime', '--pid', '123', '--port', '3000', '--url', 'http://localhost:3000', '--json'], { stdio: 'ignore' });
  execFileSync(bin, ['mission', 'queue', '--help'], { stdio: 'ignore' });
  execFileSync(bin, ['mission', 'queue', '--lane-id', 'smoke-lane', '--status', 'applied', '--agent-id', 'smoke-agent', '--scope', 'cli smoke', '--changed', 'src/bin/yam.ts', '--depends-on', 'setup', '--verification-hint', 'cli smoke', '--json'], { stdio: 'ignore' });
  execFileSync(bin, ['benchmark', 'report', '--help'], { stdio: 'ignore' });
  execFileSync(bin, ['benchmark', 'report', '--baseline', '100', '--current', '90', '--unit', 'ms', '--target', 'lower', '--json'], { stdio: 'ignore' });
  console.log(`cli-smoke: ok (${version})`);
} finally {
  rmSync(prefix, { recursive: true, force: true });
  rmSync(join(root, tarball), { force: true });
}

function expectFailure(fn, label) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(label);
}
