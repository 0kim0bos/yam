#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HELP = `yam release ref check

Usage:
  node scripts/check-release-ref.mjs [--mode verify|release] [--remote-ref origin/main]
    [--tag vX.Y.Z] [--tag-policy annotated|signed]
    [--signature-source git|github] [--json]
  node scripts/check-release-ref.mjs --self-test

Modes:
  verify   Require a clean Git source. Suitable for pull requests and ordinary CI.
  release  Also require remote containment and an exact annotated or signed version tag.
`;

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    mode: 'verify',
    remoteRef: 'origin/main',
    tag: '',
    tagPolicy: 'signed',
    signatureSource: 'git',
    json: false,
    selfTest: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--mode') options.mode = requiredValue(argv, ++index, arg);
    else if (arg === '--remote-ref') options.remoteRef = requiredValue(argv, ++index, arg);
    else if (arg === '--tag') options.tag = requiredValue(argv, ++index, arg);
    else if (arg === '--tag-policy') options.tagPolicy = requiredValue(argv, ++index, arg);
    else if (arg === '--signature-source') options.signatureSource = requiredValue(argv, ++index, arg);
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (!['verify', 'release'].includes(options.mode)) throw new Error(`invalid --mode: ${options.mode}`);
  if (!['annotated', 'signed'].includes(options.tagPolicy)) throw new Error(`invalid --tag-policy: ${options.tagPolicy}`);
  if (!['git', 'github'].includes(options.signatureSource)) throw new Error(`invalid --signature-source: ${options.signatureSource}`);
  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function runGit(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 4 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function check(id, status, evidence, recoveryHint = '') {
  return { id, status, evidence, ...(recoveryHint ? { recovery_hint: recoveryHint } : {}) };
}

async function inspectReleaseRef(options) {
  const checks = [];
  const repository = runGit(options.cwd, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (repository.status !== 0 || repository.stdout.trim() !== 'true') {
    checks.push(check('git_repository', 'failed', 'not inside a Git working tree', 'run the check from the release repository'));
    return buildReport(options, checks);
  }
  checks.push(check('git_repository', 'passed', 'Git working tree detected'));

  const head = runGit(options.cwd, ['rev-parse', 'HEAD']).stdout.trim();
  checks.push(check('head_commit', 'passed', head));

  const status = runGit(options.cwd, ['status', '--porcelain=v1', '--untracked-files=all']).stdout;
  const dirtyLines = status.split(/\r?\n/).filter(Boolean);
  if (dirtyLines.length > 0) {
    checks.push(check('clean_source', 'failed', `${dirtyLines.length} changed or untracked path(s)`, 'commit or remove unintended source changes before continuing'));
  } else {
    checks.push(check('clean_source', 'passed', 'tracked and untracked source state is clean'));
  }

  if (options.mode === 'verify') {
    checks.push(check('remote_containment', 'skipped', 'ordinary verification does not require a release branch or remote ancestry'));
    checks.push(check('release_tag', 'skipped', 'ordinary verification does not require a version tag'));
    checks.push(check('tag_signature', 'skipped', 'ordinary verification does not require a signed tag'));
    return buildReport(options, checks, { head });
  }

  const packageJson = JSON.parse(readFileSync(join(options.cwd, 'package.json'), 'utf8'));
  const versionTag = `v${packageJson.version}`;
  const expectedTag = String(options.tag || versionTag).replace(/^refs\/tags\//, '');
  if (expectedTag !== versionTag) {
    checks.push(check('tag_version', 'failed', `requested tag ${expectedTag} does not match package version tag ${versionTag}`, `dispatch or push the exact ${versionTag} tag`));
  } else {
    checks.push(check('tag_version', 'passed', `${expectedTag} matches package version ${packageJson.version}`));
  }
  const validTag = runGit(options.cwd, ['check-ref-format', `refs/tags/${expectedTag}`], { allowFailure: true });
  if (validTag.status !== 0) {
    checks.push(check('release_tag', 'failed', `${expectedTag} is not a valid Git tag name`, `use the exact version tag ${versionTag}`));
    checks.push(check('tag_signature', 'failed', 'signature cannot be checked for an invalid tag name', `create and sign ${versionTag}`));
    return buildReport(options, checks, { head, expectedTag, packageVersion: packageJson.version });
  }
  const remote = runGit(options.cwd, ['rev-parse', '--verify', `${options.remoteRef}^{commit}`], { allowFailure: true });
  if (remote.status !== 0) {
    checks.push(check('remote_containment', 'failed', `${options.remoteRef} is unavailable`, `fetch ${options.remoteRef} before running the release gate`));
  } else {
    const ancestor = runGit(options.cwd, ['merge-base', '--is-ancestor', head, remote.stdout.trim()], { allowFailure: true });
    checks.push(ancestor.status === 0
      ? check('remote_containment', 'passed', `${head} is contained in ${options.remoteRef}`)
      : check('remote_containment', 'failed', `${head} is not contained in ${options.remoteRef}`, `merge the release commit into ${options.remoteRef} and fetch it before tagging`));
  }

  const tagRef = `refs/tags/${expectedTag}`;
  const tagObjectType = runGit(options.cwd, ['cat-file', '-t', tagRef], { allowFailure: true });
  if (tagObjectType.status !== 0) {
    checks.push(check('release_tag', 'failed', `${expectedTag} does not exist`, `create annotated tag ${expectedTag} at the package version commit`));
    checks.push(check('tag_signature', 'failed', 'signature cannot be checked without the exact release tag', `create and sign ${expectedTag}`));
    return buildReport(options, checks, { head, expectedTag, packageVersion: packageJson.version });
  }

  const peeled = runGit(options.cwd, ['rev-list', '-n', '1', tagRef]).stdout.trim();
  if (tagObjectType.stdout.trim() !== 'tag') {
    checks.push(check('release_tag', 'failed', `${expectedTag} is lightweight`, `replace it safely with an annotated${options.tagPolicy === 'signed' ? ' signed' : ''} tag`));
  } else if (peeled !== head) {
    checks.push(check('release_tag', 'failed', `${expectedTag} points to ${peeled}, not HEAD ${head}`, 'check out the tagged commit or recreate the tag before publishing'));
  } else {
    checks.push(check('release_tag', 'passed', `${expectedTag} is an annotated tag at HEAD`));
  }

  if (options.tagPolicy === 'annotated') {
    checks.push(check('tag_signature', 'skipped', 'annotated-tag policy selected; cryptographic signature is not required'));
  } else if (tagObjectType.stdout.trim() !== 'tag') {
    checks.push(check('tag_signature', 'failed', 'a lightweight tag cannot satisfy the signed-tag policy', `create a verified signed tag named ${expectedTag}`));
  } else {
    const signature = options.signatureSource === 'github'
      ? await verifyTagWithGitHub(options.cwd, tagRef)
      : verifyTagWithGit(options.cwd, expectedTag);
    checks.push(signature.ok
      ? check('tag_signature', 'passed', signature.evidence)
      : check('tag_signature', 'failed', signature.evidence, signature.recoveryHint));
  }

  return buildReport(options, checks, { head, expectedTag, packageVersion: packageJson.version });
}

function verifyTagWithGit(cwd, tag) {
  const result = runGit(cwd, ['verify-tag', '--raw', tag], { allowFailure: true });
  return result.status === 0
    ? { ok: true, evidence: `${tag} signature verified by local Git trust configuration` }
    : {
        ok: false,
        evidence: `${tag} signature was not cryptographically verified by local Git`,
        recoveryHint: 'import the trusted public signing key or use --signature-source github in GitHub Actions',
      };
}

async function verifyTagWithGitHub(cwd, tagRef) {
  const repository = String(process.env.GITHUB_REPOSITORY || '').trim();
  const token = String(process.env.GITHUB_TOKEN || '').trim();
  if (!/^[^/]+\/[^/]+$/.test(repository) || !token) {
    return {
      ok: false,
      evidence: 'GitHub signature verification requires GITHUB_REPOSITORY and GITHUB_TOKEN',
      recoveryHint: 'run on GitHub Actions with contents: read and pass github.token only to this verification step',
    };
  }

  const tagObjectSha = runGit(cwd, ['rev-parse', tagRef]).stdout.trim();
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/git/tags/${tagObjectSha}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'yam-release-ref-check',
      },
    });
    if (!response.ok) {
      return {
        ok: false,
        evidence: `GitHub tag verification request failed with HTTP ${response.status}`,
        recoveryHint: 'confirm contents: read permission, repository identity, and the annotated tag object',
      };
    }
    const data = await response.json();
    const reason = String(data?.verification?.reason || 'unknown');
    if (data?.verification?.verified === true) {
      return { ok: true, evidence: `${tagRef.replace('refs/tags/', '')} signature verified by GitHub (${reason})` };
    }
    return {
      ok: false,
      evidence: `GitHub did not verify the tag signature (${reason})`,
      recoveryHint: 'create the tag with a signing identity GitHub recognizes, then push and rerun the release workflow',
    };
  } catch (error) {
    return {
      ok: false,
      evidence: `GitHub tag verification could not be completed: ${error instanceof Error ? error.message : String(error)}`,
      recoveryHint: 'retry only after GitHub API connectivity is restored; do not bypass the signed-tag gate',
    };
  }
}

function buildReport(options, checks, details = {}) {
  const failed = checks.filter((item) => item.status === 'failed');
  return {
    schema: 'yam.release-ref-check.v1',
    mode: options.mode,
    remote_ref: options.mode === 'release' ? options.remoteRef : null,
    tag_policy: options.mode === 'release' ? options.tagPolicy : null,
    signature_source: options.mode === 'release' && options.tagPolicy === 'signed' ? options.signatureSource : null,
    ...details,
    checks,
    truth_status: failed.length === 0 ? 'verified' : 'blocked',
  };
}

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`release-ref: ${report.truth_status} (${report.mode})`);
  for (const item of report.checks) console.log(`- ${item.id}: ${item.status} (${item.evidence})`);
}

async function runSelfTest() {
  const root = mkdtempSync(join(tmpdir(), 'yam-release-ref-'));
  try {
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'yam release smoke'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'yam-release@example.invalid'], { cwd: root });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'release-fixture', version: '1.2.3' }));
    writeFileSync(join(root, 'fixture.txt'), 'first\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });

    assertReport(await inspectReleaseRef({ cwd: root, mode: 'verify', remoteRef: 'origin/main', tag: '', tagPolicy: 'signed', signatureSource: 'git' }), 'verified', 'clean verify mode');
    writeFileSync(join(root, 'dirty.txt'), 'dirty\n');
    assertReport(await inspectReleaseRef({ cwd: root, mode: 'verify', remoteRef: 'origin/main', tag: '', tagPolicy: 'signed', signatureSource: 'git' }), 'blocked', 'dirty verify mode');
    rmSync(join(root, 'dirty.txt'));

    const firstCommit = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', firstCommit], { cwd: root });
    execFileSync('git', ['tag', '-a', 'v1.2.3', '-m', 'release fixture'], { cwd: root });
    assertReport(await inspectReleaseRef({ cwd: root, mode: 'release', remoteRef: 'origin/main', tag: '', tagPolicy: 'annotated', signatureSource: 'git' }), 'verified', 'annotated release mode');
    assertReport(await inspectReleaseRef({ cwd: root, mode: 'release', remoteRef: 'origin/main', tag: 'v1.2.4', tagPolicy: 'annotated', signatureSource: 'git' }), 'blocked', 'package/tag version mismatch');
    assertReport(await inspectReleaseRef({ cwd: root, mode: 'release', remoteRef: 'origin/main', tag: '', tagPolicy: 'signed', signatureSource: 'git' }), 'blocked', 'unsigned tag under signed policy');
    const originalFetch = globalThis.fetch;
    const originalRepository = process.env.GITHUB_REPOSITORY;
    const originalToken = process.env.GITHUB_TOKEN;
    try {
      process.env.GITHUB_REPOSITORY = 'fixture/release';
      process.env.GITHUB_TOKEN = 'fixture-token';
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ verification: { verified: true, reason: 'valid' } }) });
      assertReport(await inspectReleaseRef({ cwd: root, mode: 'release', remoteRef: 'origin/main', tag: '', tagPolicy: 'signed', signatureSource: 'github' }), 'verified', 'GitHub signature verification path');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalRepository === undefined) delete process.env.GITHUB_REPOSITORY;
      else process.env.GITHUB_REPOSITORY = originalRepository;
      if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = originalToken;
    }

    execFileSync('git', ['tag', '-d', 'v1.2.3'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['tag', 'v1.2.3'], { cwd: root });
    assertReport(await inspectReleaseRef({ cwd: root, mode: 'release', remoteRef: 'origin/main', tag: '', tagPolicy: 'annotated', signatureSource: 'git' }), 'blocked', 'lightweight tag rejection');

    execFileSync('git', ['tag', '-d', 'v1.2.3'], { cwd: root, stdio: 'ignore' });
    writeFileSync(join(root, 'fixture.txt'), 'second\n');
    execFileSync('git', ['add', 'fixture.txt'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'uncontained fixture'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['tag', '-a', 'v1.2.3', '-m', 'uncontained release fixture'], { cwd: root });
    assertReport(await inspectReleaseRef({ cwd: root, mode: 'release', remoteRef: 'origin/main', tag: '', tagPolicy: 'annotated', signatureSource: 'git' }), 'blocked', 'remote containment rejection');

    console.log('release-ref-smoke: ok (clean, dirty, exact tag, annotated, signed-policy, GitHub verification, lightweight, containment)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertReport(report, expected, label) {
  if (report.truth_status !== expected) throw new Error(`${label}: expected ${expected}, got ${report.truth_status}`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
  } else if (options.selfTest) {
    await runSelfTest();
  } else {
    const report = await inspectReleaseRef(options);
    printReport(report, options.json);
    if (report.truth_status === 'blocked') process.exitCode = 1;
  }
} catch (error) {
  console.error(`release-ref: failed (${error instanceof Error ? error.message : String(error)})`);
  process.exitCode = 1;
}
