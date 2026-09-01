#!/usr/bin/env node
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createScoutReceipt,
  verifyScoutReceipt,
  verifyScoutReceiptFile
} from '../dist/lib/scout-receipt.js';

const root = mkdtempSync(join(tmpdir(), 'yam-scout-receipt-'));

try {
  const spec = sampleSpec();
  const result = await createScoutReceipt({
    root,
    receipt_path: '.yam/scout/example-suite.json',
    spec,
    now: () => new Date('2026-09-01T00:00:00.000Z')
  });
  assert(result.receipt.truth_status === 'partial', 'operator-supplied research must remain partial');
  assert(result.receipt.sources.map((item) => item.id).join(',') === 'registry,release', 'sources should use canonical ordering');
  assert(result.receipt.claims.map((item) => item.id).join(',') === 'latest,release-gap', 'claims should use canonical ordering');
  assert(result.receipt.subject.aliases.join(',') === 'Example,example-suite', 'aliases should use canonical ordering');

  const verification = await verifyScoutReceiptFile({ root, receipt_path: '.yam/scout/example-suite.json' });
  assert(verification.valid && verification.truth_status === 'verified', `receipt should verify: ${verification.errors.join(',')}`);

  const duplicateFailure = await failureOf(() => createScoutReceipt({
    root,
    receipt_path: '.yam/scout/example-suite.json',
    spec
  }));
  assert(duplicateFailure.includes('will not be overwritten'), 'Scout receipts must be immutable');

  const tampered = JSON.parse(readFileSync(result.receipt_path, 'utf8'));
  tampered.recommendation = 'tampered';
  const tamperedVerification = verifyScoutReceipt(tampered);
  assert(!tamperedVerification.valid && tamperedVerification.errors.includes('digest_invalid'), 'tampering should invalidate the digest');

  const invalidSpec = sampleSpec();
  invalidSpec.claims[0].source_ids = ['missing'];
  const invalidFailure = await failureOf(() => createScoutReceipt({
    root,
    receipt_path: '.yam/scout/invalid.json',
    spec: invalidSpec
  }));
  assert(invalidFailure.includes('unknown source'), 'claims must fail closed on unknown source ids');

  const strictLeafMutations = [
    (value) => { value.subject.canonical_name = { forged: true }; },
    (value) => { value.clocks.registry_latest = 220; },
    (value) => { value.sources[0].id = 1; },
    (value) => { value.sources[0].authority = { forged: true }; },
    (value) => { value.sources[0].retrieved_at = 0; },
    (value) => { value.sources[0].content_digest = false; }
  ];
  for (const [index, mutate] of strictLeafMutations.entries()) {
    const strictSpec = sampleSpec();
    mutate(strictSpec);
    const strictFailure = await failureOf(() => createScoutReceipt({
      root,
      receipt_path: `.yam/scout/strict-${index}.json`,
      spec: strictSpec
    }));
    assert(strictFailure.includes('must be a string'), `Scout string leaf ${index} must not be coerced`);
  }

  const credentialUrlMutations = [
    (value) => { value.subject.canonical_url = 'https://user:token@example.com/project'; },
    (value) => { value.sources[0].canonical_url = 'https://user:token@example.com/source'; },
    (value) => { value.subject.canonical_url = 'https://example.com/project?token=fixture-secret'; },
    (value) => { value.sources[0].canonical_url = 'https://example.com/source?X-Amz-Credential=fixture&X-Amz-Signature=fixture'; },
    (value) => { value.sources[0].canonical_url = 'https://example.com/source#access_token=fixture-secret'; },
    (value) => { value.sources[0].canonical_url = `https://example.com/source?ref=ghp_${'a'.repeat(24)}`; },
    (value) => { value.sources[0].canonical_url = `https://example.com/source#ghp_${'b'.repeat(24)}`; },
    (value) => { value.subject.canonical_url = `https://example.com/project/npm_${'c'.repeat(24)}`; },
    (value) => { value.subject.canonical_url = `https://example.com/project/%73k-${'d'.repeat(24)}`; }
  ];
  for (const [index, mutate] of credentialUrlMutations.entries()) {
    const credentialSpec = sampleSpec();
    mutate(credentialSpec);
    const credentialFailure = await failureOf(() => createScoutReceipt({
      root,
      receipt_path: `.yam/scout/credential-url-${index}.json`,
      spec: credentialSpec
    }));
    assert(credentialFailure.includes('must not contain URL credentials'), `Scout credential URL ${index} must fail closed`);
  }

  const partialClockSpec = sampleSpec();
  partialClockSpec.clocks.registry_latest = '';
  const partialClockFailure = await failureOf(() => createScoutReceipt({
    root,
    receipt_path: '.yam/scout/partial-clock.json',
    spec: partialClockSpec
  }));
  assert(partialClockFailure.includes('all four version clocks are required'), 'known stability must carry all four clocks');

  const clocklessSpec = sampleSpec();
  clocklessSpec.clocks.registry_latest = '';
  clocklessSpec.clocks.release_tag = '';
  clocklessSpec.clocks.main_version = '';
  clocklessSpec.clocks.latest_commit = '';
  const clocklessFailure = await failureOf(() => createScoutReceipt({
    root,
    receipt_path: '.yam/scout/clockless.json',
    spec: clocklessSpec
  }));
  assert(clocklessFailure.includes('all four version clocks are required'), 'four empty clocks must not claim a known stability');

  const unknownClockSpec = sampleSpec();
  unknownClockSpec.clocks.registry_latest = '';
  unknownClockSpec.clocks.release_tag = '';
  unknownClockSpec.clocks.main_version = '';
  unknownClockSpec.clocks.latest_commit = '';
  unknownClockSpec.clocks.stability = 'unknown';
  await createScoutReceipt({
    root,
    receipt_path: '.yam/scout/unknown-clock.json',
    spec: unknownClockSpec
  });

  const linkedReceiptPath = join(root, '.yam', 'scout', 'linked-receipt.json');
  symlinkSync(result.receipt_path, linkedReceiptPath);
  const linkedReceiptFailure = await failureOf(() => verifyScoutReceiptFile({
    root,
    receipt_path: '.yam/scout/linked-receipt.json'
  }));
  assert(linkedReceiptFailure.includes('regular non-symlink file'), 'final-component receipt symlinks must fail closed');

  const originalOpen = fsp.open;
  fsp.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (!String(args[0]).endsWith('write-failure.json')) return handle;
    return new Proxy(handle, {
      get(target, property) {
        if (property === 'writeFile') return async () => { throw new Error('injected Scout write failure'); };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };
  try {
    const writeFailure = await failureOf(() => createScoutReceipt({
      root,
      receipt_path: '.yam/scout/write-failure.json',
      spec
    }));
    assert(writeFailure.includes('preserved for manual identity inspection'), 'write failures must explain preserved manual recovery');
    assert(existsSync(join(root, '.yam', 'scout', 'write-failure.json')), 'write failure must preserve the opened path instead of pathname-unlinking it');
  } finally {
    fsp.open = originalOpen;
  }

  const external = mkdtempSync(join(tmpdir(), 'yam-scout-external-'));
  const linkedRoot = join(root, 'linked');
  mkdirSync(linkedRoot, { recursive: true });
  symlinkSync(external, join(linkedRoot, 'escape'));
  const symlinkFailure = await failureOf(() => createScoutReceipt({
    root,
    receipt_path: 'linked/escape/receipt.json',
    spec
  }));
  assert(symlinkFailure.includes('regular directory'), 'symlinked receipt parents must fail closed');
  rmSync(external, { recursive: true, force: true });

  console.log('scout receipt smoke passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}

function sampleSpec() {
  return {
    subject: {
      canonical_name: 'example-org/example-suite',
      aliases: ['example-suite', 'Example'],
      canonical_url: 'https://github.com/example-org/example-suite'
    },
    clocks: {
      registry_latest: '2.2.0',
      release_tag: 'v2.2.0',
      main_version: '2.2.1',
      latest_commit: 'ca185ef5f7667078a1e70a763bd3a9c71c48acf0',
      stability: 'mixed'
    },
    sources: [
      {
        id: 'registry',
        canonical_url: 'https://registry.npmjs.org/example-suite/latest',
        access_path: 'registry API',
        source_class: 'official',
        retrieved_at: '2026-09-01T00:00:00.000Z',
        version: '2.2.0',
        revision: '',
        content_digest: `sha256:${'1'.repeat(64)}`,
        authority: 'high',
        freshness: 'high',
        directness: 'high'
      },
      {
        id: 'release',
        canonical_url: 'https://github.com/example-org/example-suite/releases/tag/v2.2.0',
        access_path: 'GitHub release API',
        source_class: 'official',
        retrieved_at: '2026-09-01T00:00:00.000Z',
        version: '2.2.0',
        revision: 'v2.2.0',
        content_digest: `sha256:${'2'.repeat(64)}`,
        authority: 'high',
        freshness: 'medium',
        directness: 'high'
      }
    ],
    claims: [
      {
        id: 'release-gap',
        text: 'main is ahead of the stable release',
        source_ids: ['registry', 'release'],
        confidence: 'high',
        uncertainty: '2.2.1 is not published yet',
        decision_impact: 'do not report main as the stable installed version'
      },
      {
        id: 'latest',
        text: '2.2.0 is the stable registry version',
        source_ids: ['registry'],
        confidence: 'high',
        uncertainty: '',
        decision_impact: 'no stable package update should be applied'
      }
    ],
    acquisition_failures: [
      { source_id: 'community', kind: 'not_measured', note: 'community evidence was outside the stop budget' }
    ],
    opposition: 'main may publish immediately after this receipt is written',
    recommendation: 'compare all four clocks again before applying an update',
    stop_reason: 'official sources resolved the release decision'
  };
}

async function failureOf(fn) {
  try {
    await fn();
    throw new Error('expected failure');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected failure') throw error;
    return error instanceof Error ? error.message : String(error);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
