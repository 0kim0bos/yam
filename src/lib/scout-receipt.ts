import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { compareStableText } from './stable-order.js';

const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_SOURCES = 64;
const MAX_CLAIMS = 128;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const URL_CREDENTIAL_KEYS = new Set([
  'accesstoken', 'apikey', 'auth', 'authtoken', 'authorization', 'awsaccesskeyid',
  'clientsecret', 'code', 'credential', 'googleaccessid', 'jwt', 'keypairid',
  'password', 'passwd', 'secret', 'securitytoken', 'session', 'sessionid', 'sig',
  'signature', 'token', 'xamzcredential', 'xamzsecuritytoken', 'xamzsignature',
  'xgoogcredential', 'xgoogsignature'
]);
const URL_CREDENTIAL_VALUE_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bnpm_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/
];
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const FAILURE_KINDS = [
  'not_measured',
  'no_results',
  'blocked_waf',
  'rate_limited',
  'auth_required',
  'paywall',
  'network_failed',
  'empty_content'
] as const;

type FailureKind = typeof FAILURE_KINDS[number];
type JsonRecord = Record<string, any>;
type PathIdentity = { path: string; dev: number; ino: number };

export interface ScoutReceiptSpec {
  subject: {
    canonical_name: string;
    aliases: string[];
    canonical_url: string;
  };
  clocks: {
    registry_latest: string;
    release_tag: string;
    main_version: string;
    latest_commit: string;
    stability: 'stable' | 'release_candidate' | 'unreleased' | 'mixed' | 'unknown';
  };
  sources: Array<{
    id: string;
    canonical_url: string;
    access_path: string;
    source_class: 'official' | 'implementation' | 'third_party' | 'community' | 'contrarian' | 'local';
    retrieved_at: string;
    version: string;
    revision: string;
    content_digest: string;
    authority: 'high' | 'medium' | 'low';
    freshness: 'high' | 'medium' | 'low';
    directness: 'high' | 'medium' | 'low';
  }>;
  claims: Array<{
    id: string;
    text: string;
    source_ids: string[];
    confidence: 'high' | 'medium' | 'low';
    uncertainty: string;
    decision_impact: string;
  }>;
  acquisition_failures: Array<{
    source_id: string;
    kind: FailureKind;
    note: string;
  }>;
  opposition: string;
  recommendation: string;
  stop_reason: string;
}

export interface ScoutReceipt extends ScoutReceiptSpec {
  schema: 'yam.scout-receipt.v1';
  created_at: string;
  evidence_boundary: {
    acquisition_by_yam: false;
    source_interpretation: 'operator_supplied';
    external_content_trusted_as_instruction: false;
  };
  truth_status: 'partial';
  digest: string;
}

export async function createScoutReceipt(input: {
  root: string;
  receipt_path: string;
  spec: ScoutReceiptSpec;
  now?: () => Date;
}) {
  assertExactKeys(input, ['root', 'receipt_path', 'spec', 'now'], 'scout receipt input', ['now']);
  const root = await canonicalRoot(input.root);
  const receiptPath = await resolveReceiptPath(root, input.receipt_path);
  const spec = normalizeSpec(input.spec);
  const canonical = {
    schema: 'yam.scout-receipt.v1' as const,
    created_at: (input.now || (() => new Date()))().toISOString(),
    ...spec,
    evidence_boundary: {
      acquisition_by_yam: false as const,
      source_interpretation: 'operator_supplied' as const,
      external_content_trusted_as_instruction: false as const
    },
    truth_status: 'partial' as const
  };
  const receipt: ScoutReceipt = { ...canonical, digest: digest(canonical) };
  await writeImmutableJson(root, receiptPath, receipt);
  return {
    schema: 'yam.scout-receipt-write.v1' as const,
    receipt_path: receiptPath,
    receipt,
    truth_status: 'partial' as const,
    next_action: 'retain the immutable receipt and use its digest as the baseline for the next delta scan'
  };
}

export function verifyScoutReceipt(value: unknown) {
  const errors: string[] = [];
  const record = isObject(value) ? value : {};
  assertRecordKeys(record, [
    'schema', 'created_at', 'subject', 'clocks', 'sources', 'claims', 'acquisition_failures',
    'opposition', 'recommendation', 'stop_reason', 'evidence_boundary', 'truth_status', 'digest'
  ], errors, 'receipt');
  if (record.schema !== 'yam.scout-receipt.v1') errors.push('schema_invalid');
  if (!isIsoDate(record.created_at)) errors.push('created_at_invalid');
  let normalized: ScoutReceiptSpec | null = null;
  try {
    normalized = normalizeSpec({
      subject: record.subject,
      clocks: record.clocks,
      sources: record.sources,
      claims: record.claims,
      acquisition_failures: record.acquisition_failures,
      opposition: record.opposition,
      recommendation: record.recommendation,
      stop_reason: record.stop_reason
    } as ScoutReceiptSpec);
  } catch (error) {
    errors.push(`contract_invalid:${message(error)}`);
  }
  if (normalized) {
    for (const key of ['subject', 'clocks', 'sources', 'claims', 'acquisition_failures', 'opposition', 'recommendation', 'stop_reason']) {
      if (JSON.stringify(record[key]) !== JSON.stringify((normalized as unknown as JsonRecord)[key])) {
        errors.push(`${key}_not_canonical`);
      }
    }
  }
  const boundary = isObject(record.evidence_boundary) ? record.evidence_boundary : {};
  assertRecordKeys(boundary, ['acquisition_by_yam', 'source_interpretation', 'external_content_trusted_as_instruction'], errors, 'evidence_boundary');
  if (boundary.acquisition_by_yam !== false) errors.push('acquisition_boundary_invalid');
  if (boundary.source_interpretation !== 'operator_supplied') errors.push('interpretation_boundary_invalid');
  if (boundary.external_content_trusted_as_instruction !== false) errors.push('external_instruction_boundary_invalid');
  if (record.truth_status !== 'partial') errors.push('truth_status_invalid');
  const canonical = { ...record };
  delete canonical.digest;
  if (typeof record.digest !== 'string' || record.digest !== digest(canonical)) errors.push('digest_invalid');
  const uniqueErrors = [...new Set(errors)];
  return {
    schema: 'yam.scout-receipt-verification.v1' as const,
    valid: uniqueErrors.length === 0,
    errors: uniqueErrors,
    receipt_truth_status: record.truth_status || 'blocked',
    truth_status: uniqueErrors.length ? 'blocked' as const : 'verified' as const,
    next_action: uniqueErrors.length
      ? `reject the Scout receipt and repair: ${uniqueErrors[0]}`
      : 'receipt structure, source links, canonical ordering, and digest are intact; source interpretation remains operator-supplied'
  };
}

export async function verifyScoutReceiptFile(input: { root: string; receipt_path: string }) {
  assertExactKeys(input, ['root', 'receipt_path'], 'scout receipt verification input');
  const root = await canonicalRoot(input.root);
  const receiptPath = await resolveReceiptPath(root, input.receipt_path);
  const value = await readBoundedJson(root, receiptPath);
  return { ...verifyScoutReceipt(value), receipt_path: receiptPath };
}

function normalizeSpec(value: ScoutReceiptSpec): ScoutReceiptSpec {
  if (!isObject(value)) throw new Error('spec must be an object');
  assertExactKeys(value, [
    'subject', 'clocks', 'sources', 'claims', 'acquisition_failures',
    'opposition', 'recommendation', 'stop_reason'
  ], 'scout receipt spec');
  const subject = exactObject(value.subject, ['canonical_name', 'aliases', 'canonical_url'], 'subject');
  const canonicalName = boundedText(subject.canonical_name, 'subject.canonical_name', 200);
  const canonicalUrl = httpUrl(subject.canonical_url, 'subject.canonical_url');
  const aliases = [...new Set(stringArray(subject.aliases, 'subject.aliases', 32, 200))].sort(compareStableText);
  const clocks = exactObject(value.clocks, ['registry_latest', 'release_tag', 'main_version', 'latest_commit', 'stability'], 'clocks');
  const stability = enumValue(clocks.stability, ['stable', 'release_candidate', 'unreleased', 'mixed', 'unknown'], 'clocks.stability');
  const normalizedClocks = {
    registry_latest: optionalText(clocks.registry_latest, 'clocks.registry_latest', 160),
    release_tag: optionalText(clocks.release_tag, 'clocks.release_tag', 160),
    main_version: optionalText(clocks.main_version, 'clocks.main_version', 160),
    latest_commit: optionalText(clocks.latest_commit, 'clocks.latest_commit', 160)
  };
  if (stability !== 'unknown' && Object.values(normalizedClocks).some((clock) => !clock)) {
    throw new Error('all four version clocks are required when clocks.stability is not unknown');
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > MAX_SOURCES) {
    throw new Error(`sources must contain 1-${MAX_SOURCES} items`);
  }
  const sources = value.sources.map((item, index) => normalizeSource(item, index)).sort((a, b) => compareStableText(a.id, b.id));
  const sourceIds = new Set(sources.map((item) => item.id));
  if (sourceIds.size !== sources.length) throw new Error('source ids must be unique');
  if (!Array.isArray(value.claims) || value.claims.length === 0 || value.claims.length > MAX_CLAIMS) {
    throw new Error(`claims must contain 1-${MAX_CLAIMS} items`);
  }
  const claims = value.claims.map((item, index) => normalizeClaim(item, index, sourceIds)).sort((a, b) => compareStableText(a.id, b.id));
  if (new Set(claims.map((item) => item.id)).size !== claims.length) throw new Error('claim ids must be unique');
  if (!Array.isArray(value.acquisition_failures) || value.acquisition_failures.length > MAX_SOURCES) {
    throw new Error(`acquisition_failures must be an array with at most ${MAX_SOURCES} items`);
  }
  const acquisitionFailures = value.acquisition_failures.map((item, index) => {
    const record = exactObject(item, ['source_id', 'kind', 'note'], `acquisition_failures[${index}]`);
    const sourceId = idValue(record.source_id, `acquisition_failures[${index}].source_id`);
    return {
      source_id: sourceId,
      kind: enumValue(record.kind, FAILURE_KINDS, `acquisition_failures[${index}].kind`) as FailureKind,
      note: boundedText(record.note, `acquisition_failures[${index}].note`, 600)
    };
  }).sort((a, b) => compareStableText(`${a.source_id}:${a.kind}`, `${b.source_id}:${b.kind}`));
  return {
    subject: { canonical_name: canonicalName, aliases, canonical_url: canonicalUrl },
    clocks: {
      ...normalizedClocks,
      stability: stability as ScoutReceiptSpec['clocks']['stability']
    },
    sources,
    claims,
    acquisition_failures: acquisitionFailures,
    opposition: boundedText(value.opposition, 'opposition', 2000),
    recommendation: boundedText(value.recommendation, 'recommendation', 2000),
    stop_reason: boundedText(value.stop_reason, 'stop_reason', 1000)
  };
}

function normalizeSource(value: unknown, index: number): ScoutReceiptSpec['sources'][number] {
  const label = `sources[${index}]`;
  const record = exactObject(value, [
    'id', 'canonical_url', 'access_path', 'source_class', 'retrieved_at', 'version', 'revision',
    'content_digest', 'authority', 'freshness', 'directness'
  ], label);
  const retrievedAt = exactString(record.retrieved_at, `${label}.retrieved_at`);
  if (!isIsoDate(retrievedAt)) throw new Error(`${label}.retrieved_at must be an ISO timestamp`);
  const contentDigest = exactString(record.content_digest, `${label}.content_digest`);
  if (!SHA256_PATTERN.test(contentDigest)) throw new Error(`${label}.content_digest must be sha256:<64 lowercase hex>`);
  return {
    id: idValue(record.id, `${label}.id`),
    canonical_url: httpUrl(record.canonical_url, `${label}.canonical_url`),
    access_path: boundedText(record.access_path, `${label}.access_path`, 300),
    source_class: enumValue(record.source_class, ['official', 'implementation', 'third_party', 'community', 'contrarian', 'local'], `${label}.source_class`) as ScoutReceiptSpec['sources'][number]['source_class'],
    retrieved_at: retrievedAt,
    version: optionalText(record.version, `${label}.version`, 160),
    revision: optionalText(record.revision, `${label}.revision`, 160),
    content_digest: contentDigest,
    authority: enumValue(record.authority, ['high', 'medium', 'low'], `${label}.authority`) as 'high' | 'medium' | 'low',
    freshness: enumValue(record.freshness, ['high', 'medium', 'low'], `${label}.freshness`) as 'high' | 'medium' | 'low',
    directness: enumValue(record.directness, ['high', 'medium', 'low'], `${label}.directness`) as 'high' | 'medium' | 'low'
  };
}

function normalizeClaim(value: unknown, index: number, sourceIds: Set<string>): ScoutReceiptSpec['claims'][number] {
  const label = `claims[${index}]`;
  const record = exactObject(value, ['id', 'text', 'source_ids', 'confidence', 'uncertainty', 'decision_impact'], label);
  const claimSourceIds = stringArray(record.source_ids, `${label}.source_ids`, MAX_SOURCES, 96)
    .map((item) => idValue(item, `${label}.source_ids`))
    .sort(compareStableText);
  if (claimSourceIds.length === 0) throw new Error(`${label}.source_ids must not be empty`);
  for (const sourceId of claimSourceIds) {
    if (!sourceIds.has(sourceId)) throw new Error(`${label} references unknown source: ${sourceId}`);
  }
  return {
    id: idValue(record.id, `${label}.id`),
    text: boundedText(record.text, `${label}.text`, 2000),
    source_ids: [...new Set(claimSourceIds)],
    confidence: enumValue(record.confidence, ['high', 'medium', 'low'], `${label}.confidence`) as 'high' | 'medium' | 'low',
    uncertainty: optionalText(record.uncertainty, `${label}.uncertainty`, 1000),
    decision_impact: boundedText(record.decision_impact, `${label}.decision_impact`, 1000)
  };
}

async function canonicalRoot(value: string) {
  const resolved = path.resolve(value || '.');
  const real = await fsp.realpath(resolved);
  const stat = await fsp.lstat(real);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`root must be a regular physical directory: ${real}`);
  return real;
}

async function resolveReceiptPath(root: string, value: string) {
  const candidate = path.resolve(root, value);
  if (!pathWithin(root, candidate)) throw new Error(`receipt path escapes root: ${candidate}`);
  if (candidate === root) throw new Error('receipt path must be a file below root');
  return candidate;
}

async function writeImmutableJson(root: string, target: string, value: unknown) {
  await ensureRegularDirectoryPath(root, path.dirname(target));
  const parents = await captureRegularDirectoryPath(root, path.dirname(target), 'Scout receipt write');
  const noFollow = process.platform !== 'win32' && typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(
      target,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
      0o600
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`receipt already exists and will not be overwritten: ${target}`);
    throw error;
  }
  let targetCreated = false;
  let writeFailure: unknown;
  try {
    const opened = await handle.stat();
    targetCreated = opened.isFile();
    await revalidateRegularDirectoryPath(parents, 'Scout receipt write');
    const current = await fsp.lstat(target);
    if (
      !opened.isFile()
      || current.isSymbolicLink()
      || !current.isFile()
      || current.dev !== opened.dev
      || current.ino !== opened.ino
    ) {
      throw new Error(`Scout receipt changed identity before writing: ${target}`);
    }
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    const afterOpened = await handle.stat();
    const after = await fsp.lstat(target);
    await revalidateRegularDirectoryPath(parents, 'Scout receipt write');
    if (
      after.isSymbolicLink()
      || !after.isFile()
      || after.dev !== opened.dev
      || after.ino !== opened.ino
      || afterOpened.dev !== opened.dev
      || afterOpened.ino !== opened.ino
    ) {
      throw new Error(`Scout receipt changed identity while writing: ${target}`);
    }
  } catch (error) {
    writeFailure = error;
  }
  try {
    await handle.close();
  } catch (error) {
    writeFailure ||= error;
  }
  if (writeFailure) {
    if (targetCreated) {
      throw new AggregateError(
        [writeFailure],
        `Scout receipt write failed; the possibly partial file was preserved for manual identity inspection because pathname cleanup cannot be proven safe: ${target}`
      );
    }
    throw writeFailure;
  }
}

async function ensureRegularDirectoryPath(root: string, target: string) {
  const relative = path.relative(root, target);
  if (relative === '') return;
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`directory path escapes root: ${target}`);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stat = await fsp.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`expected a regular directory path segment: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await fsp.mkdir(current, { mode: 0o700 });
      const stat = await fsp.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`created directory changed identity: ${current}`);
    }
  }
}

async function readBoundedJson(root: string, target: string) {
  const parents = await captureRegularDirectoryPath(root, path.dirname(target), 'Scout receipt read');
  const before = await fsp.lstat(target);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`Scout receipt must be a regular non-symlink file: ${target}`);
  }
  if (before.size > MAX_RECEIPT_BYTES) throw new Error(`Scout receipt exceeds ${MAX_RECEIPT_BYTES} bytes`);
  const noFollow = process.platform !== 'win32' && typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  const handle = await fsp.open(target, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    await revalidateRegularDirectoryPath(parents, 'Scout receipt read');
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error(`Scout receipt changed identity while opening: ${target}`);
    }
    if (opened.size > MAX_RECEIPT_BYTES) throw new Error(`Scout receipt exceeds ${MAX_RECEIPT_BYTES} bytes`);
    const bytes = await readBoundedHandle(handle, MAX_RECEIPT_BYTES);
    const after = await fsp.lstat(target);
    const afterOpened = await handle.stat();
    await revalidateRegularDirectoryPath(parents, 'Scout receipt read');
    if (
      after.isSymbolicLink()
      || !after.isFile()
      || after.dev !== opened.dev
      || after.ino !== opened.ino
      || afterOpened.dev !== opened.dev
      || afterOpened.ino !== opened.ino
      || afterOpened.size !== opened.size
      || bytes.length !== opened.size
    ) {
      throw new Error(`Scout receipt changed identity while reading: ${target}`);
    }
    return JSON.parse(bytes.toString('utf8'));
  } finally {
    await handle.close();
  }
}

async function readBoundedHandle(handle: fsp.FileHandle, maxBytes: number) {
  const buffer = Buffer.alloc(maxBytes + 1);
  let total = 0;
  while (total < buffer.length) {
    const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  if (total > maxBytes) throw new Error(`Scout receipt exceeds ${maxBytes} bytes while being read`);
  return buffer.subarray(0, total);
}

async function captureRegularDirectoryPath(root: string, target: string, label: string) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} escapes root: ${target}`);
  const identities: PathIdentity[] = [];
  let current = root;
  for (const segment of relative ? ['', ...relative.split(path.sep)] : ['']) {
    if (segment) current = path.join(current, segment);
    const stat = await fsp.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} expected a regular directory: ${current}`);
    identities.push({ path: current, dev: stat.dev, ino: stat.ino });
  }
  return identities;
}

async function revalidateRegularDirectoryPath(identities: PathIdentity[], label: string) {
  for (const identity of identities) {
    const stat = await fsp.lstat(identity.path);
    if (
      !stat.isDirectory()
      || stat.isSymbolicLink()
      || stat.dev !== identity.dev
      || stat.ino !== identity.ino
    ) {
      throw new Error(`${label} parent changed identity: ${identity.path}`);
    }
  }
}

function exactObject(value: unknown, keys: string[], label: string) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  assertExactKeys(value, keys, label);
  return value;
}

function assertExactKeys(value: unknown, keys: string[], label: string, optional: string[] = []) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  const allowed = new Set(keys);
  const required = keys.filter((key) => !optional.includes(key));
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !(key in value));
  if (extra.length || missing.length) throw new Error(`${label} keys invalid; missing=[${missing.join(',')}], extra=[${extra.join(',')}]`);
}

function assertRecordKeys(value: JsonRecord, keys: string[], errors: string[], label: string) {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${label}_unexpected_key:${key}`);
  for (const key of keys) if (!(key in value)) errors.push(`${label}_missing_key:${key}`);
}

function stringArray(value: unknown, label: string, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must be an array with at most ${maxItems} items`);
  return value.map((item, index) => boundedText(item, `${label}[${index}]`, maxLength));
}

function boundedText(value: unknown, label: string, maxLength: number) {
  const text = exactString(value, label).trim();
  if (!text) throw new Error(`${label} must not be empty`);
  if (text.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error(`${label} contains control characters`);
  return text;
}

function optionalText(value: unknown, label: string, maxLength: number) {
  const text = exactString(value, label).trim();
  if (text.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error(`${label} contains control characters`);
  return text;
}

function idValue(value: unknown, label: string) {
  const text = exactString(value, label);
  if (!ID_PATTERN.test(text)) throw new Error(`${label} must match ${ID_PATTERN}`);
  return text;
}

function httpUrl(value: unknown, label: string) {
  const text = boundedText(value, label, 2048);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(`${label} must use http or https`);
  if (parsed.username || parsed.password) throw new Error(`${label} must not contain URL credentials`);
  if (urlSearchContainsCredentials(parsed.searchParams)) throw new Error(`${label} must not contain URL credentials`);
  const fragment = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : '';
  if (urlTextContainsCredentials(parsed.pathname) || urlTextContainsCredentials(fragment)) {
    throw new Error(`${label} must not contain URL credentials`);
  }
  if (fragment.includes('=') && urlSearchContainsCredentials(new URLSearchParams(fragment))) {
    throw new Error(`${label} must not contain URL credentials`);
  }
  return parsed.toString();
}

function urlTextContainsCredentials(value: string) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // The URL parser already validated the URL. Scan the original text when percent decoding is malformed.
  }
  return URL_CREDENTIAL_VALUE_PATTERNS.some((pattern) => pattern.test(decoded));
}

function urlSearchContainsCredentials(params: URLSearchParams) {
  for (const [rawKey, value] of params.entries()) {
    const key = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (URL_CREDENTIAL_KEYS.has(key)) return true;
    if (urlTextContainsCredentials(value)) return true;
  }
  return false;
}

function enumValue(value: unknown, allowed: readonly string[], label: string) {
  const text = exactString(value, label);
  if (!allowed.includes(text)) throw new Error(`${label} must be one of ${allowed.join('|')}`);
  return text;
}

function exactString(value: unknown, label: string) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function pathWithin(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isIsoDate(value: unknown) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
