#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createVerificationClosureReceipt,
  verifyVerificationClosureReceipt,
  verifyVerificationClosureReceiptFile
} from '../dist/lib/verification-closure.js';
import {
  createMediaProviderReceipt,
  verifyMediaProviderReceipt
} from '../dist/lib/media-provider-receipt.js';

const roots = [];
const root = fixtureRoot();
writeFileSync(join(root, 'src-lib-a.ts'), 'export const a = 1;\n');
writeFileSync(join(root, 'src-lib-z.ts'), 'export const z = 1;\n');
const selected = [
  { id: 'typecheck', command: 'npm run typecheck', scope: 'affected', required: true },
  { id: 'browser', command: 'npm run browser-smoke', scope: 'affected', required: false }
];
const executed = [
  { id: 'typecheck', command: 'npm run typecheck', exit_code: 0, evidence: 'exit code 0 observed in the current worktree' }
];
const skipped = [{ check_id: 'browser', reason: 'no browser or UI surface changed' }];

try {
  const affected = await createVerificationClosureReceipt({
    root,
    receipt_path: '.yam/verification/affected.json',
    planned_scope: 'affected',
    changed_files: ['src-lib-z.ts', 'src-lib-a.ts'],
    selected_commands: [selected[1], selected[0]],
    executed_commands: executed,
    skipped,
    truncated: [{ check_id: 'typecheck', reason: 'stored output was intentionally bounded after the exit status' }]
  });
  assert.equal(affected.receipt.final_scope, 'affected');
  assert.equal(affected.receipt.truth_status, 'partial');
  assert.deepEqual(affected.receipt.changed_files, ['src-lib-a.ts', 'src-lib-z.ts']);
  assert.equal((await verifyVerificationClosureReceiptFile({ root, receipt_path: '.yam/verification/affected.json' })).valid, true);

  const releaseRoot = fixtureRoot();
  writeFileSync(join(releaseRoot, 'README.md'), 'release docs\n');
  writeFileSync(join(releaseRoot, 'package.json'), '{}\n');
  const release = await createVerificationClosureReceipt({
    root: releaseRoot,
    receipt_path: '.yam/verification/release.json',
    planned_scope: 'affected',
    changed_files: ['README.md', 'package.json'],
    selected_commands: [{ id: 'release-check', command: 'npm run release:check', scope: 'release', required: true }],
    executed_commands: [{ id: 'release-check', command: 'npm run release:check', exit_code: 0, evidence: 'release check exited 0' }],
    skipped: [],
    truncated: []
  });
  assert.equal(release.receipt.final_scope, 'release');
  assert.equal(release.receipt.scope_derivation.promoted, true);
  assert.deepEqual(release.receipt.scope_derivation.release_sensitive_files, ['package.json']);

  await assert.rejects(() => createVerificationClosureReceipt({
    root: releaseRoot,
    receipt_path: '.yam/verification/missing-required.json',
    planned_scope: 'affected',
    changed_files: ['src/a.ts'],
    selected_commands: [selected[0]],
    executed_commands: [],
    skipped: [],
    truncated: []
  }), /required command was not executed/);
  await assert.rejects(() => createVerificationClosureReceipt({
    root,
    receipt_path: '.yam/verification/unknown-executed.json',
    planned_scope: 'affected',
    changed_files: ['src/a.ts'],
    selected_commands: [selected[0]],
    executed_commands: [{ id: 'lint', command: 'npm run lint', exit_code: 0, evidence: 'exit 0' }],
    skipped: [],
    truncated: []
  }), /unknown executed command/);
  await assert.rejects(() => createVerificationClosureReceipt({
    root,
    receipt_path: '.yam/verification/required-skip.json',
    planned_scope: 'affected',
    changed_files: ['src/a.ts'],
    selected_commands: [selected[0]],
    executed_commands: [],
    skipped: [{ check_id: 'typecheck', reason: 'incorrectly skipped' }],
    truncated: []
  }), /required selected command cannot be skipped/);
  await assert.rejects(() => createVerificationClosureReceipt({
    root: releaseRoot,
    receipt_path: '.yam/verification/release-command-missing.json',
    planned_scope: 'affected',
    changed_files: ['package.json'],
    selected_commands: [selected[0]],
    executed_commands: executed,
    skipped: [],
    truncated: []
  }), /release final scope requires/);
  await assert.rejects(() => createVerificationClosureReceipt({
    root,
    receipt_path: '.yam/verification/unsafe.json',
    planned_scope: 'affected',
    changed_files: ['../outside'],
    selected_commands: [selected[0]],
    executed_commands: executed,
    skipped: [],
    truncated: []
  }), /escapes the project root/);
  await assert.rejects(() => createVerificationClosureReceipt({
    root,
    receipt_path: '.yam/verification/empty-scope.json',
    planned_scope: 'affected',
    changed_files: [],
    selected_commands: [selected[0]],
    executed_commands: executed,
    skipped: [],
    truncated: []
  }), /at least one declared path/);
  await assert.rejects(() => createVerificationClosureReceipt({
    root,
    receipt_path: '.yam/verification/duplicate.json',
    planned_scope: 'affected',
    changed_files: ['src/a.ts', 'src/a.ts'],
    selected_commands: [selected[0]],
    executed_commands: executed,
    skipped: [],
    truncated: []
  }), /duplicates/);
  await assert.rejects(() => createVerificationClosureReceipt({
    root,
    receipt_path: '.yam/verification/bounded.json',
    planned_scope: 'affected',
    changed_files: Array.from({ length: 257 }, (_, index) => `src/${index}.ts`),
    selected_commands: [selected[0]],
    executed_commands: executed,
    skipped: [],
    truncated: []
  }), /at most 256/);

  const failed = await createVerificationClosureReceipt({
    root,
    receipt_path: '.yam/verification/failed.json',
    planned_scope: 'affected',
    changed_files: ['src/fail.ts'],
    selected_commands: [selected[0]],
    executed_commands: [{ ...executed[0], exit_code: 2, evidence: 'typecheck exited 2' }],
    skipped: [],
    truncated: []
  });
  assert.equal(failed.receipt.status, 'failed');
  assert.equal(failed.receipt.truth_status, 'blocked');
  assert.equal((await verifyVerificationClosureReceiptFile({ root, receipt_path: '.yam/verification/failed.json' })).valid, true);

  const tamperedClosure = JSON.parse(readFileSync(affected.receipt_path, 'utf8'));
  tamperedClosure.changed_files[0] = 'src/lib/tampered.ts';
  assert.equal(verifyVerificationClosureReceipt(tamperedClosure).valid, false);
  const reorderedClosure = JSON.parse(readFileSync(affected.receipt_path, 'utf8'));
  reorderedClosure.scope_observation.changed_files.reverse();
  assert.match(verifyVerificationClosureReceipt(reorderedClosure).errors.join(' '), /ordinal order|inconsistent/);
  writeFileSync(join(root, 'late-scope.ts'), 'late scope drift\n');
  const driftedClosure = await verifyVerificationClosureReceiptFile({ root, receipt_path: '.yam/verification/affected.json' });
  assert.equal(driftedClosure.valid, false);
  assert(driftedClosure.errors.includes('current_git_scope_drift'));

  const unavailableRoot = plainFixtureRoot();
  const unavailable = await createVerificationClosureReceipt({
    root: unavailableRoot,
    receipt_path: '.yam/verification/unavailable.json',
    planned_scope: 'affected',
    changed_files: ['src/a.ts'],
    selected_commands: [selected[0]],
    executed_commands: executed,
    skipped: [],
    truncated: []
  });
  assert.equal(unavailable.receipt.scope_observation.availability, 'unavailable');
  assert.equal(unavailable.receipt.truth_status, 'blocked');

  const unplannedRoot = fixtureRoot();
  writeFileSync(join(unplannedRoot, 'planned.ts'), 'planned\n');
  writeFileSync(join(unplannedRoot, 'unplanned.ts'), 'unplanned\n');
  const unplanned = await createVerificationClosureReceipt({
    root: unplannedRoot,
    receipt_path: '.yam/verification/unplanned.json',
    planned_scope: 'affected',
    changed_files: ['planned.ts'],
    selected_commands: [selected[0]],
    executed_commands: executed,
    skipped: [],
    truncated: []
  });
  assert.equal(unplanned.receipt.truth_status, 'blocked');
  assert.deepEqual(unplanned.receipt.scope_observation.unplanned_files, ['unplanned.ts']);

  const receiptEscapeRoot = fixtureRoot();
  const receiptEscapeOutside = plainFixtureRoot();
  writeFileSync(join(receiptEscapeRoot, 'planned.ts'), 'planned\n');
  symlinkSync(receiptEscapeOutside, join(receiptEscapeRoot, '.yam'));
  await assert.rejects(() => createVerificationClosureReceipt({
    root: receiptEscapeRoot,
    receipt_path: '.yam/verification/escape.json',
    planned_scope: 'affected',
    changed_files: ['planned.ts'],
    selected_commands: [selected[0]],
    executed_commands: executed,
    skipped: [],
    truncated: []
  }), /receipt parent must not be a symlink/);

  writeFileSync(join(root, 'input.txt'), 'local input\n');
  writeFileSync(join(root, 'output.txt'), 'provider output\n');
  const now = new Date().toISOString();
  const dryRun = await createMediaProviderReceipt({
    root,
    receipt_path: '.yam/media/dry-run.json',
    demand_trigger: { kind: 'media_generation', evidence: 'A real multi-asset request needs a bounded planning receipt.' },
    provider: { name: 'example-provider', model: 'example-model' },
    provider_calls: 0,
    provider_execution: false,
    dry_run: true,
    submit: false,
    assets: [{
      id: 'prompt-input',
      role: 'input',
      file_path: 'input.txt',
      provenance: { kind: 'operator', source_ref: 'local prompt source', recorded_at: now }
    }]
  });
  assert.equal(dryRun.receipt.provider_calls, 0);
  assert.equal(dryRun.receipt.execution_boundary.provider_calls_by_yam, false);
  assert.equal((await verifyMediaProviderReceipt({ root, receipt_path: '.yam/media/dry-run.json' })).valid, true);

  const execution = await createMediaProviderReceipt({
    root,
    receipt_path: '.yam/media/execution.json',
    demand_trigger: { kind: 'media_transformation', evidence: 'The requested media transformation was explicitly submitted outside yam.' },
    provider: { name: 'example-provider', model: 'example-model' },
    provider_calls: 1,
    provider_execution: true,
    dry_run: false,
    submit: true,
    assets: [{
      id: 'provider-output',
      role: 'output',
      file_path: 'output.txt',
      provenance: { kind: 'provider', source_ref: 'operator-recorded provider response', recorded_at: now }
    }]
  });
  assert.equal(execution.receipt.truth_status, 'partial');
  assert.equal(execution.receipt.claims.visual_correctness, 'not_verified');

  await assert.rejects(() => createMediaProviderReceipt({
    root,
    receipt_path: '.yam/media/boolean-calls.json',
    demand_trigger: { kind: 'media_generation', evidence: 'Reject boolean counts.' },
    provider: { name: 'example-provider', model: 'example-model' },
    provider_calls: true,
    provider_execution: false,
    dry_run: true,
    submit: false,
    assets: dryRun.receipt.assets.map(stripAssetFacts)
  }), /integer >= 0/);
  await assert.rejects(() => createMediaProviderReceipt({
    root,
    receipt_path: '.yam/media/too-many-assets.json',
    demand_trigger: { kind: 'media_generation', evidence: 'Asset hashing must stay bounded and sequential.' },
    provider: { name: 'example-provider', model: 'example-model' },
    provider_calls: 0,
    provider_execution: false,
    dry_run: true,
    submit: false,
    assets: Array.from({ length: 129 }, (_, index) => ({
      id: `input-${index}`,
      role: 'input',
      file_path: 'input.txt',
      provenance: { kind: 'operator', source_ref: 'bounded fixture', recorded_at: now }
    }))
  }), /at most 128/);
  await assert.rejects(() => createMediaProviderReceipt({
    root,
    receipt_path: '.yam/media/incoherent-dry-run.json',
    demand_trigger: { kind: 'media_generation', evidence: 'Reject submit on dry run.' },
    provider: { name: 'example-provider', model: 'example-model' },
    provider_calls: 0,
    provider_execution: false,
    dry_run: true,
    submit: true,
    assets: dryRun.receipt.assets.map(stripAssetFacts)
  }), /dry_run requires/);
  await assert.rejects(() => createMediaProviderReceipt({
    root,
    receipt_path: '.yam/media/missing-demand.json',
    demand_trigger: { kind: 'media_generation', evidence: '' },
    provider: { name: 'example-provider', model: 'example-model' },
    provider_calls: 0,
    provider_execution: false,
    dry_run: true,
    submit: false,
    assets: dryRun.receipt.assets.map(stripAssetFacts)
  }), /demand_trigger.evidence/);
  await assert.rejects(() => createMediaProviderReceipt({
    root,
    receipt_path: '.yam/media/future-provenance.json',
    demand_trigger: { kind: 'media_generation', evidence: 'Future provenance must fail closed.' },
    provider: { name: 'example-provider', model: 'example-model' },
    provider_calls: 0,
    provider_execution: false,
    dry_run: true,
    submit: false,
    assets: [{
      id: 'future-input',
      role: 'input',
      file_path: 'input.txt',
      provenance: { kind: 'operator', source_ref: 'future source', recorded_at: '2999-01-01T00:00:00.000Z' }
    }]
  }), /cannot be later than/);
  await assert.rejects(() => createMediaProviderReceipt({
    root,
    receipt_path: '.yam/media/missing-asset.json',
    demand_trigger: { kind: 'media_generation', evidence: 'A missing local asset must block.' },
    provider: { name: 'example-provider', model: 'example-model' },
    provider_calls: 0,
    provider_execution: false,
    dry_run: true,
    submit: false,
    assets: [{ id: 'missing', role: 'input', file_path: 'missing.txt', provenance: { kind: 'operator', source_ref: 'missing', recorded_at: now } }]
  }), /ENOENT/);

  const outside = plainFixtureRoot();
  writeFileSync(join(outside, 'outside.txt'), 'outside\n');
  symlinkSync(outside, join(root, 'asset-escape'));
  await assert.rejects(() => createMediaProviderReceipt({
    root,
    receipt_path: '.yam/media/symlink-asset.json',
    demand_trigger: { kind: 'media_generation', evidence: 'Symlink assets must fail closed.' },
    provider: { name: 'example-provider', model: 'example-model' },
    provider_calls: 0,
    provider_execution: false,
    dry_run: true,
    submit: false,
    assets: [{
      id: 'escaped-input',
      role: 'input',
      file_path: 'asset-escape/outside.txt',
      provenance: { kind: 'operator', source_ref: 'symlink source', recorded_at: now }
    }]
  }), /non-symlink directory/);

  writeFileSync(join(receiptEscapeRoot, 'media.txt'), 'media\n');
  await assert.rejects(() => createMediaProviderReceipt({
    root: receiptEscapeRoot,
    receipt_path: '.yam/media/escape.json',
    demand_trigger: { kind: 'media_generation', evidence: 'Receipt parent symlinks must fail closed.' },
    provider: { name: 'example-provider', model: 'example-model' },
    provider_calls: 0,
    provider_execution: false,
    dry_run: true,
    submit: false,
    assets: [{
      id: 'media-input',
      role: 'input',
      file_path: 'media.txt',
      provenance: { kind: 'operator', source_ref: 'local', recorded_at: now }
    }]
  }), /receipt parent must not be a symlink/);

  writeFileSync(join(root, 'output.txt'), 'tampered provider output\n');
  const tamperedMedia = await verifyMediaProviderReceipt({ root, receipt_path: '.yam/media/execution.json' });
  assert.equal(tamperedMedia.valid, false);
  assert.match(tamperedMedia.errors.join(' '), /sha256 mismatch/);

  const bin = join(process.cwd(), 'dist', 'bin', 'yam.js');
  const legacy = JSON.parse(execFileSync(bin, ['media', 'proof', '--json'], { encoding: 'utf8' }));
  assert.equal(legacy.schema, 'yam.media-generation-proof.v1');
  assert.equal(legacy.truth_status, 'skipped');
  const verificationHelp = execFileSync(bin, ['verification', '--help'], { encoding: 'utf8' });
  assert.match(verificationHelp, /verification closure create/);

  const cliRoot = fixtureRoot();
  writeFileSync(join(cliRoot, 'selected.json'), JSON.stringify(selected[0]));
  writeFileSync(join(cliRoot, 'executed.json'), JSON.stringify(executed[0]));
  execFileSync('git', ['add', 'selected.json', 'executed.json'], { cwd: cliRoot });
  execFileSync('git', ['-c', 'user.name=yam-smoke', '-c', 'user.email=yam-smoke@example.invalid', 'commit', '-qm', 'spec baseline'], { cwd: cliRoot });
  writeFileSync(join(cliRoot, 'cli.ts'), 'export const cli = true;\n');
  const cliClosure = JSON.parse(execFileSync(bin, [
    'verification', 'closure', 'create', '--root', cliRoot,
    '--receipt-path', '.yam/verification/cli.json', '--planned-scope', 'affected',
    '--changed-file', 'cli.ts', '--selected-spec', join(cliRoot, 'selected.json'),
    '--executed-spec', join(cliRoot, 'executed.json'), '--json'
  ], { encoding: 'utf8' }));
  assert.equal(cliClosure.receipt.status, 'passed');
  const cliClosureVerify = JSON.parse(execFileSync(bin, [
    'verification', 'closure', 'verify', '--root', cliRoot,
    '--receipt-path', '.yam/verification/cli.json', '--json'
  ], { encoding: 'utf8' }));
  assert.equal(cliClosureVerify.valid, true);

  symlinkSync(join(cliRoot, 'selected.json'), join(cliRoot, 'selected-link.json'));
  assert.throws(() => execFileSync(bin, [
    'verification', 'closure', 'create', '--root', cliRoot,
    '--receipt-path', '.yam/verification/symlink-spec.json', '--planned-scope', 'affected',
    '--changed-file', 'cli.ts', '--selected-spec', join(cliRoot, 'selected-link.json'),
    '--executed-spec', join(cliRoot, 'executed.json'), '--json'
  ], { encoding: 'utf8', stdio: 'pipe' }), /Command failed/);

  writeFileSync(join(cliRoot, 'media-input.txt'), 'cli media input\n');
  writeFileSync(join(cliRoot, 'asset.json'), JSON.stringify({
    id: 'cli-input', role: 'input', file_path: 'media-input.txt',
    provenance: { kind: 'operator', source_ref: 'CLI fixture', recorded_at: new Date().toISOString() }
  }));
  const cliMedia = JSON.parse(execFileSync(bin, [
    'media', 'provider', 'create', '--root', cliRoot, '--receipt-path', '.yam/media/cli.json',
    '--demand-kind', 'media_generation', '--demand-evidence', 'CLI smoke has explicit receipt demand.',
    '--provider', 'example-provider', '--model', 'example-model', '--provider-calls', '0', '--dry-run',
    '--asset-spec', join(cliRoot, 'asset.json'), '--json'
  ], { encoding: 'utf8' }));
  assert.equal(cliMedia.receipt.dry_run, true);
  const cliMediaVerify = JSON.parse(execFileSync(bin, [
    'media', 'provider', 'verify', '--root', cliRoot, '--receipt-path', '.yam/media/cli.json', '--json'
  ], { encoding: 'utf8' }));
  assert.equal(cliMediaVerify.valid, true);

  console.log('phase adoption smoke passed');
} finally {
  for (const item of roots) rmSync(item, { recursive: true, force: true });
}

function fixtureRoot() {
  const value = mkdtempSync(join(tmpdir(), 'yam-phase-adoptions-'));
  roots.push(value);
  writeFileSync(join(value, '.gitignore'), '.yam/\n');
  execFileSync('git', ['init', '-q'], { cwd: value });
  execFileSync('git', ['add', '.gitignore'], { cwd: value });
  execFileSync('git', ['-c', 'user.name=yam-smoke', '-c', 'user.email=yam-smoke@example.invalid', 'commit', '-qm', 'fixture baseline'], { cwd: value });
  return value;
}

function plainFixtureRoot() {
  const value = mkdtempSync(join(tmpdir(), 'yam-phase-adoptions-no-git-'));
  roots.push(value);
  return value;
}

function stripAssetFacts(asset) {
  return { id: asset.id, role: asset.role, file_path: asset.file_path, provenance: asset.provenance };
}
