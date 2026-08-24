import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { compareStableText } from './stable-order.js';

const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = 512 * 1024 * 1024;
const MAX_ASSETS = 128;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/;

type JsonRecord = Record<string, unknown>;

export interface MediaProviderAssetInput {
  id: string;
  role: 'input' | 'output';
  file_path: string;
  provenance: {
    kind: 'operator' | 'provider';
    source_ref: string;
    recorded_at: string;
  };
}

export interface MediaProviderReceipt {
  schema: 'yam.media-provider-receipt.v1';
  created_at: string;
  demand_trigger: {
    kind: 'media_generation' | 'media_transformation';
    evidence: string;
    evidence_truth: 'operator_asserted';
  };
  provider: {
    name: string;
    model: string;
  };
  provider_calls: number;
  provider_execution: boolean;
  dry_run: boolean;
  submit: boolean;
  assets: Array<MediaProviderAssetInput & { sha256: string; bytes: number }>;
  execution_boundary: {
    provider_calls_by_yam: false;
    provider_claim_source: 'operator_asserted';
    optional: true;
  };
  claims: {
    asset_integrity: 'digest_bound';
    provider_execution: 'operator_asserted';
    visual_correctness: 'not_verified';
    implementation_correctness: 'not_verified';
  };
  truth_status: 'partial';
  digest: string;
}

export async function createMediaProviderReceipt(input: {
  root: string;
  receipt_path: string;
  demand_trigger: {
    kind: 'media_generation' | 'media_transformation';
    evidence: string;
  };
  provider: {
    name: string;
    model: string;
  };
  provider_calls: number;
  provider_execution: boolean;
  dry_run: boolean;
  submit: boolean;
  assets: MediaProviderAssetInput[];
}) {
  assertExactKeys(input, [
    'root', 'receipt_path', 'demand_trigger', 'provider', 'provider_calls',
    'provider_execution', 'dry_run', 'submit', 'assets'
  ], 'media provider input');
  const root = await canonicalRoot(input.root);
  const receiptPath = await resolveReceiptPath(root, input.receipt_path, false);
  const normalized = await normalizeInput(root, input);
  const createdAt = new Date().toISOString();
  const canonical = {
    schema: 'yam.media-provider-receipt.v1' as const,
    created_at: createdAt,
    demand_trigger: {
      ...normalized.demand_trigger,
      evidence_truth: 'operator_asserted' as const
    },
    provider: normalized.provider,
    provider_calls: normalized.provider_calls,
    provider_execution: normalized.provider_execution,
    dry_run: normalized.dry_run,
    submit: normalized.submit,
    assets: normalized.assets,
    execution_boundary: {
      provider_calls_by_yam: false as const,
      provider_claim_source: 'operator_asserted' as const,
      optional: true as const
    },
    claims: {
      asset_integrity: 'digest_bound' as const,
      provider_execution: 'operator_asserted' as const,
      visual_correctness: 'not_verified' as const,
      implementation_correctness: 'not_verified' as const
    },
    truth_status: 'partial' as const
  };
  const receipt: MediaProviderReceipt = { ...canonical, digest: digest(canonical) };
  await writeImmutableJson(root, receiptPath, receipt);
  return {
    schema: 'yam.media-provider-receipt-write.v1' as const,
    receipt_path: receiptPath,
    receipt,
    truth_status: 'partial' as const,
    next_action: input.provider_execution
      ? 'retain the receipt as operator-asserted provider execution evidence; verify visual and implementation correctness separately'
      : 'retain the dry-run receipt only when planning provenance is useful; no provider call occurred'
  };
}

export async function verifyMediaProviderReceipt(input: { root: string; receipt_path: string }) {
  assertExactKeys(input, ['root', 'receipt_path'], 'media provider verification input');
  const root = await canonicalRoot(input.root);
  const receiptPath = await resolveReceiptPath(root, input.receipt_path, true);
  const value = await readBoundedJson(root, receiptPath);
  const errors: string[] = [];
  const record = isObject(value) ? value : {};
  assertRecordKeys(record, [
    'schema', 'created_at', 'demand_trigger', 'provider', 'provider_calls', 'provider_execution',
    'dry_run', 'submit', 'assets', 'execution_boundary', 'claims', 'truth_status', 'digest'
  ], errors, 'receipt');
  if (record.schema !== 'yam.media-provider-receipt.v1') errors.push('schema_invalid');
  if (!isIsoDate(record.created_at)) errors.push('created_at_invalid');
  validateStoredContracts(record, errors);
  try {
    const normalized = await normalizeInput(root, {
      demand_trigger: stripDemandTruth(record.demand_trigger),
      provider: record.provider,
      provider_calls: record.provider_calls,
      provider_execution: record.provider_execution,
      dry_run: record.dry_run,
      submit: record.submit,
      assets: stripStoredAssetFacts(record.assets)
    }, record.assets, record.created_at);
    if (!sameJson(normalized.assets, record.assets)) errors.push('asset_integrity_mismatch');
  } catch (error) {
    errors.push(`contract_or_asset_invalid:${message(error)}`);
  }
  const canonical = { ...record };
  delete canonical.digest;
  if (typeof record.digest !== 'string' || record.digest !== digest(canonical)) errors.push('digest_invalid');
  const uniqueErrors = [...new Set(errors)];
  return {
    schema: 'yam.media-provider-receipt-verification.v1' as const,
    receipt_path: receiptPath,
    valid: uniqueErrors.length === 0,
    errors: uniqueErrors,
    receipt_truth_status: 'partial' as const,
    truth_status: uniqueErrors.length ? 'blocked' as const : 'verified' as const,
    next_action: uniqueErrors.length
      ? `reject the media receipt and repair: ${uniqueErrors[0]}`
      : 'receipt and local asset digests are intact; provider execution, visual quality, and implementation correctness remain outside integrity verification'
  };
}

async function normalizeInput(root: string, input: Record<string, unknown>, storedAssets?: unknown, maximumRecordedAt?: unknown) {
  assertExactKeys(input.demand_trigger, ['kind', 'evidence'], 'demand_trigger');
  const demand = input.demand_trigger as JsonRecord;
  if (demand.kind !== 'media_generation' && demand.kind !== 'media_transformation') {
    throw new Error('demand_trigger.kind must be media_generation or media_transformation');
  }
  const demandTrigger = {
    kind: demand.kind as 'media_generation' | 'media_transformation',
    evidence: boundedText(demand.evidence, 'demand_trigger.evidence', 1024)
  };
  assertExactKeys(input.provider, ['name', 'model'], 'provider');
  const provider = input.provider as JsonRecord;
  const normalizedProvider = {
    name: boundedText(provider.name, 'provider.name', 200),
    model: boundedText(provider.model, 'provider.model', 200)
  };
  const providerCalls = integerValue(input.provider_calls, 'provider_calls');
  const providerExecution = booleanValue(input.provider_execution, 'provider_execution');
  const dryRun = booleanValue(input.dry_run, 'dry_run');
  const submit = booleanValue(input.submit, 'submit');
  if (dryRun) {
    if (providerCalls !== 0 || providerExecution || submit) {
      throw new Error('dry_run requires provider_calls=0, provider_execution=false, and submit=false');
    }
  } else if (!providerExecution || !submit || providerCalls < 1) {
    throw new Error('non-dry-run requires provider_calls>=1, provider_execution=true, and submit=true');
  }
  if (!Array.isArray(input.assets) || !input.assets.length) throw new Error('assets requires at least one local asset');
  if (input.assets.length > MAX_ASSETS) throw new Error(`assets accepts at most ${MAX_ASSETS} items`);
  const storedRows = Array.isArray(storedAssets) ? storedAssets : [];
  const assets: MediaProviderReceipt['assets'] = [];
  for (let index = 0; index < input.assets.length; index += 1) {
    const item = input.assets[index];
    assertExactKeys(item, ['id', 'role', 'file_path', 'provenance'], `assets[${index}]`);
    const record = item as JsonRecord;
    const id = idValue(record.id, `assets[${index}].id`);
    if (record.role !== 'input' && record.role !== 'output') throw new Error(`assets[${index}].role must be input or output`);
    assertExactKeys(record.provenance, ['kind', 'source_ref', 'recorded_at'], `assets[${index}].provenance`);
    const provenance = record.provenance as JsonRecord;
    if (provenance.kind !== 'operator' && provenance.kind !== 'provider') {
      throw new Error(`assets[${index}].provenance.kind must be operator or provider`);
    }
    if (!isIsoDate(provenance.recorded_at)) throw new Error(`assets[${index}].provenance.recorded_at must be an ISO timestamp`);
    const recordedAt = new Date(String(provenance.recorded_at)).getTime();
    const upperBound = isIsoDate(maximumRecordedAt) ? new Date(String(maximumRecordedAt)).getTime() : Date.now();
    if (recordedAt > upperBound) throw new Error(`assets[${index}].provenance.recorded_at cannot be later than the receipt boundary`);
    const inspected = await inspectAsset(root, record.file_path, `assets[${index}].file_path`);
    const stored = storedRows[index];
    if (isObject(stored)) {
      if (stored.sha256 !== inspected.sha256) throw new Error(`asset sha256 mismatch: ${id}`);
      if (stored.bytes !== inspected.bytes) throw new Error(`asset byte size mismatch: ${id}`);
    }
    assets.push({
      id,
      role: record.role,
      file_path: inspected.file_path,
      provenance: {
        kind: provenance.kind,
        source_ref: boundedText(provenance.source_ref, `assets[${index}].provenance.source_ref`, 1024),
        recorded_at: String(provenance.recorded_at)
      },
      sha256: inspected.sha256,
      bytes: inspected.bytes
    });
  }
  assertUnique(assets.map((item) => item.id), 'asset id');
  assets.sort((left, right) => compareStableText(left.id, right.id));
  if (dryRun && assets.some((item) => item.role === 'output' || item.provenance.kind === 'provider')) {
    throw new Error('dry_run assets cannot claim provider provenance or provider output');
  }
  if (!dryRun && !assets.some((item) => item.role === 'output' && item.provenance.kind === 'provider')) {
    throw new Error('provider execution requires at least one provider-provenance output asset');
  }
  return {
    demand_trigger: demandTrigger,
    provider: normalizedProvider,
    provider_calls: providerCalls,
    provider_execution: providerExecution,
    dry_run: dryRun,
    submit,
    assets
  };
}

function validateStoredContracts(record: JsonRecord, errors: string[]) {
  const demand = isObject(record.demand_trigger) ? record.demand_trigger : {};
  assertRecordKeys(demand, ['kind', 'evidence', 'evidence_truth'], errors, 'demand_trigger');
  if (demand.evidence_truth !== 'operator_asserted') errors.push('demand_truth_invalid');
  const boundary = isObject(record.execution_boundary) ? record.execution_boundary : {};
  assertRecordKeys(boundary, ['provider_calls_by_yam', 'provider_claim_source', 'optional'], errors, 'execution_boundary');
  if (boundary.provider_calls_by_yam !== false || boundary.provider_claim_source !== 'operator_asserted' || boundary.optional !== true) {
    errors.push('execution_boundary_invalid');
  }
  const claims = isObject(record.claims) ? record.claims : {};
  assertRecordKeys(claims, ['asset_integrity', 'provider_execution', 'visual_correctness', 'implementation_correctness'], errors, 'claims');
  if (claims.asset_integrity !== 'digest_bound' || claims.provider_execution !== 'operator_asserted'
    || claims.visual_correctness !== 'not_verified' || claims.implementation_correctness !== 'not_verified') {
    errors.push('claims_invalid');
  }
  if (record.truth_status !== 'partial') errors.push('truth_status_invalid');
}

function stripDemandTruth(value: unknown) {
  if (!isObject(value)) return value;
  return { kind: value.kind, evidence: value.evidence };
}

function stripStoredAssetFacts(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((item) => isObject(item) ? {
    id: item.id,
    role: item.role,
    file_path: item.file_path,
    provenance: item.provenance
  } : item);
}

async function inspectAsset(root: string, value: unknown, label: string) {
  const relative = safeRelativePath(value, label);
  const lexical = path.join(root, ...relative.split('/'));
  if (!isWithin(root, lexical)) throw new Error(`${label} escapes the project root`);
  const inspected = await withIdentityBoundFile(root, lexical, MAX_ASSET_BYTES, label, async (handle, size) => {
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (!bytesRead) throw new Error(`${label} became shorter while hashing`);
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return { sha256: `sha256:${hash.digest('hex')}`, bytes: size };
  });
  return {
    file_path: portableRelative(root, lexical),
    sha256: inspected.sha256,
    bytes: inspected.bytes
  };
}

async function resolveReceiptPath(root: string, value: unknown, mustExist: boolean) {
  const relative = safeRelativePath(value, 'receipt_path');
  if (!relative.startsWith('.yam/media/') || !relative.endsWith('.json')) {
    throw new Error('receipt_path must be a JSON file under .yam/media/');
  }
  const target = path.join(root, ...relative.split('/'));
  await assertSafeParentChain(root, path.dirname(target));
  if (mustExist) {
    const stat = await fsp.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('receipt_path must be a regular non-symlink file');
  }
  return target;
}

async function canonicalRoot(value: unknown) {
  const root = await fsp.realpath(path.resolve(String(value || '.')));
  const stat = await fsp.stat(root);
  if (!stat.isDirectory()) throw new Error('root must be a directory');
  return root;
}

async function assertSafeParentChain(root: string, parent: string) {
  const relative = path.relative(root, parent);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('receipt_path escapes the project root');
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`receipt parent must not be a symlink: ${current}`);
      if (!stat.isDirectory()) throw new Error(`receipt parent must be a directory: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
}

async function captureParentIdentity(root: string, parent: string) {
  const relative = path.relative(root, parent);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('asset or receipt parent escapes the project root');
  const identities: Array<{ path: string; dev: number | bigint; ino: number | bigint }> = [];
  let current = root;
  const rootStat = await fsp.lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('project root identity is not a regular directory');
  identities.push({ path: '.', dev: rootStat.dev, ino: rootStat.ino });
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await fsp.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`parent path must be a regular non-symlink directory: ${current}`);
    identities.push({ path: path.relative(root, current), dev: stat.dev, ino: stat.ino });
  }
  return identities;
}

function sameIdentity(left: { dev: number | bigint; ino: number | bigint }, right: { dev: number | bigint; ino: number | bigint }) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameParentIdentity(
  left: Array<{ path: string; dev: number | bigint; ino: number | bigint }>,
  right: Array<{ path: string; dev: number | bigint; ino: number | bigint }>
) {
  return left.length === right.length && left.every((item, index) => item.path === right[index]?.path && sameIdentity(item, right[index]));
}

async function ensureAndCaptureParentIdentity(root: string, parent: string) {
  const relative = path.relative(root, parent);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('receipt parent escapes the project root');
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      await fsp.mkdir(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stat = await fsp.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`receipt parent must be a regular non-symlink directory: ${current}`);
  }
  return captureParentIdentity(root, parent);
}

async function writeImmutableJson(root: string, file: string, value: unknown) {
  const parentsBefore = await ensureAndCaptureParentIdentity(root, path.dirname(file));
  const noFollow = process.platform !== 'win32' && typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  const handle = await fsp.open(file, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    const opened = await handle.stat();
    const after = await fsp.lstat(file);
    const parentsAfter = await captureParentIdentity(root, path.dirname(file));
    if (!opened.isFile() || after.isSymbolicLink() || !after.isFile() || !sameIdentity(opened, after)) {
      throw new Error('media receipt identity changed while writing');
    }
    if (!sameParentIdentity(parentsBefore, parentsAfter)) throw new Error('media receipt parent path identity changed while writing');
  } finally {
    await handle.close();
  }
}

async function readBoundedJson(root: string, file: string) {
  const bytes = await withIdentityBoundFile(root, file, MAX_RECEIPT_BYTES, 'media receipt', async (handle, size) => {
    const value = Buffer.alloc(size);
    let offset = 0;
    while (offset < value.length) {
      const { bytesRead } = await handle.read(value, offset, value.length - offset, offset);
      if (!bytesRead) throw new Error('media receipt became shorter while reading');
      offset += bytesRead;
    }
    return value;
  });
  return JSON.parse(bytes.toString('utf8'));
}

async function withIdentityBoundFile<T>(
  root: string,
  file: string,
  maxBytes: number,
  label: string,
  reader: (handle: fsp.FileHandle, size: number) => Promise<T>
) {
  const parentsBefore = await captureParentIdentity(root, path.dirname(file));
  const before = await fsp.lstat(file);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error(`${label} must be a regular non-symlink file`);
  if (before.size > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
  const noFollow = process.platform !== 'win32' && typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  const handle = await fsp.open(file, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(before, opened)) throw new Error(`${label} identity changed before open`);
    if (opened.size > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
    const result = await reader(handle, opened.size);
    const openedAfter = await handle.stat();
    if (!sameIdentity(opened, openedAfter) || openedAfter.size !== opened.size) throw new Error(`${label} changed size or identity while reading`);
    const after = await fsp.lstat(file);
    const parentsAfter = await captureParentIdentity(root, path.dirname(file));
    if (after.isSymbolicLink() || !after.isFile() || !sameIdentity(opened, after)) throw new Error(`${label} identity changed while reading`);
    if (!sameParentIdentity(parentsBefore, parentsAfter)) throw new Error(`${label} parent path identity changed while reading`);
    return result;
  } finally {
    await handle.close();
  }
}

function safeRelativePath(value: unknown, label: string) {
  const text = String(value || '').trim();
  if (!text || text.length > 1024 || path.isAbsolute(text) || text.includes('\\') || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(`${label} must be a bounded project-relative POSIX path`);
  }
  const normalized = path.posix.normalize(text.replace(/^\.\//, ''));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.split('/').includes('..')) {
    throw new Error(`${label} escapes the project root`);
  }
  return normalized;
}

function portableRelative(root: string, file: string) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  if (!relative || relative.startsWith('../')) throw new Error('asset path escapes the project root');
  return relative;
}

function isWithin(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function idValue(value: unknown, label: string) {
  const text = String(value || '');
  if (!ID_PATTERN.test(text)) throw new Error(`${label} is invalid`);
  return text;
}

function integerValue(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be an integer >= 0; booleans are rejected`);
  }
  return value;
}

function booleanValue(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}

function boundedText(value: unknown, label: string, max: number) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`${label} must contain 1-${max} characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error(`${label} contains control characters`);
  return text;
}

function assertExactKeys(value: unknown, expected: string[], label: string) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort(compareStableText);
  const wanted = [...expected].sort(compareStableText);
  if (!sameStringArray(actual, wanted)) throw new Error(`${label} keys must be exactly: ${wanted.join(', ')}`);
}

function assertRecordKeys(record: JsonRecord, expected: string[], errors: string[], label: string) {
  const actual = Object.keys(record).sort(compareStableText);
  const wanted = [...expected].sort(compareStableText);
  if (!sameStringArray(actual, wanted)) errors.push(`${label}_keys_invalid`);
}

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
}

function sameStringArray(value: unknown, expected: string[]) {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function sameJson(left: unknown, right: unknown) {
  return stableJson(left) === stableJson(right);
}

function isObject(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value: unknown) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function digest(value: unknown) {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort(compareStableText).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
