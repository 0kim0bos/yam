import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export interface InspectedImageFile {
  path: string;
  sha256: string;
  bytes: number;
  dimensions: string;
}

export interface UeyeAssetEntry {
  id: string;
  file_path: string;
  source_url: string;
  source_page_url: string;
  retrieved_at: string;
  license_note: string;
  operator_provided: boolean;
  do_not_replace: boolean;
  allowed_for_edit: boolean;
  sha256: string;
  bytes: number;
  dimensions: string;
}

export interface UeyeAssetManifest {
  schema: 'yam.ueye-asset-manifest.v1';
  updated_at: string;
  assets: UeyeAssetEntry[];
}

export interface UeyeRevisionEntry {
  artifact_id: string;
  round: number;
  source_path: string;
  archived_path: string;
  archived_at: string;
  sha256: string;
  bytes: number;
  dimensions: string;
}

export interface UeyeRevisionHistory {
  schema: 'yam.ueye-revision-history.v1';
  updated_at: string;
  revisions: UeyeRevisionEntry[];
}

export async function inspectImageFile(file: string): Promise<InspectedImageFile> {
  const absolute = path.resolve(file);
  const buffer = await fsp.readFile(absolute);
  const stat = await fsp.stat(absolute);
  return {
    path: absolute,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    bytes: stat.size,
    dimensions: imageDimensions(buffer)
  };
}

export async function upsertUeyeAsset(input: {
  manifest_path: string;
  id: string;
  file: string;
  source_url?: string;
  source_page_url?: string;
  retrieved_at?: string;
  license_note?: string;
  operator_provided?: boolean;
  do_not_replace?: boolean;
  allowed_for_edit?: boolean;
  replace?: boolean;
}) {
  const manifestPath = path.resolve(input.manifest_path);
  const id = safeId(input.id, 'asset id');
  const info = await inspectImageFile(input.file);
  validateOptionalHttpUrl(input.source_url, 'source_url');
  validateOptionalHttpUrl(input.source_page_url, 'source_page_url');
  const manifest = await readAssetManifest(manifestPath);
  const existingIndex = manifest.assets.findIndex((asset) => asset.id === id);
  const existing = existingIndex >= 0 ? manifest.assets[existingIndex] : null;
  if (existing?.do_not_replace && existing.sha256 !== info.sha256 && !input.replace) {
    throw new Error(`asset ${id} is protected by do_not_replace; pass --replace only after explicit review`);
  }
  const duplicate = manifest.assets.find((asset) => asset.id !== id && asset.sha256 === info.sha256);
  if (duplicate) throw new Error(`asset content already exists as ${duplicate.id}; reuse that asset id`);
  const entry: UeyeAssetEntry = {
    id,
    file_path: relativePortablePath(path.dirname(manifestPath), info.path),
    source_url: String(input.source_url ?? existing?.source_url ?? ''),
    source_page_url: String(input.source_page_url ?? existing?.source_page_url ?? ''),
    retrieved_at: String(input.retrieved_at ?? existing?.retrieved_at ?? new Date().toISOString()),
    license_note: String(input.license_note ?? existing?.license_note ?? ''),
    operator_provided: input.operator_provided ?? existing?.operator_provided ?? (!input.source_url && !input.source_page_url),
    do_not_replace: input.do_not_replace ?? existing?.do_not_replace ?? false,
    allowed_for_edit: input.allowed_for_edit ?? existing?.allowed_for_edit ?? false,
    sha256: info.sha256,
    bytes: info.bytes,
    dimensions: info.dimensions
  };
  if (existingIndex >= 0) manifest.assets[existingIndex] = entry;
  else manifest.assets.push(entry);
  manifest.assets.sort((left, right) => left.id.localeCompare(right.id));
  manifest.updated_at = new Date().toISOString();
  await writeJsonAtomic(manifestPath, manifest);
  const warnings = assetWarnings(entry);
  return {
    schema: 'yam.ueye-asset-update.v1',
    action: existing ? 'updated' : 'added',
    manifest_path: manifestPath,
    asset: entry,
    warnings,
    next_action: warnings[0] || 'run `yam ueye asset verify` before relying on this manifest for a done claim',
    truth_status: warnings.length ? 'partial' : 'verified'
  };
}

export async function verifyUeyeAssetManifest(manifestFile: string) {
  const manifestPath = path.resolve(manifestFile);
  const manifest = await readAssetManifest(manifestPath, false);
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenHashes = new Map<string, string>();
  for (const asset of manifest.assets) {
    try {
      validateOptionalHttpUrl(asset.source_url, `${asset.id}.source_url`);
      validateOptionalHttpUrl(asset.source_page_url, `${asset.id}.source_page_url`);
      const file = resolveManifestFile(manifestPath, asset.file_path);
      const info = await inspectImageFile(file);
      if (info.sha256 !== asset.sha256) errors.push(`${asset.id}: sha256 mismatch; the asset changed after it was recorded`);
      if (asset.bytes && info.bytes !== asset.bytes) errors.push(`${asset.id}: byte size mismatch`);
      if (asset.dimensions && info.dimensions !== asset.dimensions) errors.push(`${asset.id}: dimensions mismatch`);
      const duplicate = seenHashes.get(info.sha256);
      if (duplicate && duplicate !== asset.id) errors.push(`${asset.id}: duplicates ${duplicate} by sha256`);
      else seenHashes.set(info.sha256, asset.id);
      warnings.push(...assetWarnings(asset));
    } catch (error) {
      errors.push(`${asset.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!manifest.assets.length) errors.push('asset manifest is empty');
  const uniqueWarnings = uniqueStrings(warnings);
  return {
    schema: 'yam.ueye-asset-verification.v1',
    manifest_path: manifestPath,
    asset_count: manifest.assets.length,
    protected_count: manifest.assets.filter((asset) => asset.do_not_replace).length,
    editable_count: manifest.assets.filter((asset) => asset.allowed_for_edit).length,
    errors: uniqueStrings(errors),
    warnings: uniqueWarnings,
    ready: errors.length === 0,
    next_action: errors[0] || uniqueWarnings[0] || 'attach this manifest verification to the Ueye report when asset provenance matters',
    truth_status: errors.length ? 'blocked' : uniqueWarnings.length ? 'partial' : 'verified'
  };
}

export async function archiveUeyeRevision(input: {
  file: string;
  root: string;
  manifest_path?: string;
  round: number;
  artifact_id?: string;
}) {
  const round = Number(input.round);
  if (!Number.isInteger(round) || round < 1) throw new Error('revision round must be a positive integer');
  const source = await inspectImageFile(input.file);
  const root = path.resolve(input.root);
  const manifestPath = path.resolve(input.manifest_path || path.join(root, 'manifest.json'));
  const extension = path.extname(source.path);
  const artifactId = safeId(input.artifact_id || path.basename(source.path, extension), 'artifact id');
  const roundDir = path.join(root, `r${round}`);
  const archivedPath = path.join(roundDir, `${artifactId}${extension}`);
  await fsp.mkdir(roundDir, { recursive: true });
  let action = 'archived';
  try {
    await fsp.copyFile(source.path, archivedPath, fsConstants.COPYFILE_EXCL);
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await inspectImageFile(archivedPath);
    if (existing.sha256 !== source.sha256) {
      throw new Error(`revision r${round}/${artifactId} already exists with different content; choose a new round`);
    }
    action = 'already_archived';
  }
  const history = await readRevisionHistory(manifestPath);
  const existingIndex = history.revisions.findIndex((entry) => entry.round === round && entry.artifact_id === artifactId);
  const entry: UeyeRevisionEntry = {
    artifact_id: artifactId,
    round,
    source_path: source.path,
    archived_path: relativePortablePath(path.dirname(manifestPath), archivedPath),
    archived_at: new Date().toISOString(),
    sha256: source.sha256,
    bytes: source.bytes,
    dimensions: source.dimensions
  };
  if (existingIndex >= 0) {
    if (history.revisions[existingIndex].sha256 !== entry.sha256) {
      throw new Error(`revision history already records different content for r${round}/${artifactId}`);
    }
    entry.archived_at = history.revisions[existingIndex].archived_at;
    history.revisions[existingIndex] = entry;
  } else {
    history.revisions.push(entry);
  }
  history.revisions.sort((left, right) => left.round - right.round || left.artifact_id.localeCompare(right.artifact_id));
  history.updated_at = new Date().toISOString();
  await writeJsonAtomic(manifestPath, history);
  return {
    schema: 'yam.ueye-revision-archive.v1',
    action,
    manifest_path: manifestPath,
    revision: entry,
    next_action: 'edit the live artifact, then use a later round for the next preserved version',
    truth_status: 'verified'
  };
}

export async function verifyUeyeRevisionHistory(manifestFile: string) {
  const manifestPath = path.resolve(manifestFile);
  const history = await readRevisionHistory(manifestPath, false);
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const revision of history.revisions) {
    const key = `${revision.round}:${revision.artifact_id}`;
    if (seen.has(key)) errors.push(`${key}: duplicate revision entry`);
    seen.add(key);
    try {
      const file = resolveManifestFile(manifestPath, revision.archived_path);
      const info = await inspectImageFile(file);
      if (info.sha256 !== revision.sha256) errors.push(`${key}: sha256 mismatch; archived content changed`);
      if (revision.bytes && info.bytes !== revision.bytes) errors.push(`${key}: byte size mismatch`);
      if (revision.dimensions && info.dimensions !== revision.dimensions) errors.push(`${key}: dimensions mismatch`);
    } catch (error) {
      errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!history.revisions.length) errors.push('revision history is empty');
  return {
    schema: 'yam.ueye-revision-verification.v1',
    manifest_path: manifestPath,
    revision_count: history.revisions.length,
    rounds: [...new Set(history.revisions.map((entry) => entry.round))].sort((left, right) => left - right),
    errors: uniqueStrings(errors),
    ready: errors.length === 0,
    next_action: errors[0] || 'attach this revision history to the Ueye report when iterative visual work matters',
    truth_status: errors.length ? 'blocked' : 'verified'
  };
}

async function readAssetManifest(file: string, allowMissing = true): Promise<UeyeAssetManifest> {
  try {
    const data = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (data.schema !== 'yam.ueye-asset-manifest.v1' || !Array.isArray(data.assets)) throw new Error('invalid Ueye asset manifest schema');
    return data;
  } catch (error: any) {
    if (allowMissing && error?.code === 'ENOENT') return { schema: 'yam.ueye-asset-manifest.v1', updated_at: '', assets: [] };
    throw error;
  }
}

async function readRevisionHistory(file: string, allowMissing = true): Promise<UeyeRevisionHistory> {
  try {
    const data = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (data.schema !== 'yam.ueye-revision-history.v1' || !Array.isArray(data.revisions)) throw new Error('invalid Ueye revision history schema');
    return data;
  } catch (error: any) {
    if (allowMissing && error?.code === 'ENOENT') return { schema: 'yam.ueye-revision-history.v1', updated_at: '', revisions: [] };
    throw error;
  }
}

async function writeJsonAtomic(file: string, value: unknown) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fsp.rename(temporary, file);
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => {});
  }
}

function validateOptionalHttpUrl(value: unknown, label: string) {
  const text = String(value || '');
  if (!text) return;
  const url = new URL(text);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${label} must use http or https`);
}

function assetWarnings(asset: UeyeAssetEntry): string[] {
  const warnings: string[] = [];
  if (!asset.source_url && !asset.source_page_url && !asset.operator_provided) warnings.push(`${asset.id}: source provenance is missing`);
  if (!asset.license_note) warnings.push(`${asset.id}: license_note is missing; usage rights were not recorded`);
  if (asset.dimensions === 'unknown') warnings.push(`${asset.id}: image dimensions are unknown`);
  return warnings;
}

function safeId(value: unknown, label: string): string {
  const text = String(value || '');
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(text)) throw new Error(`${label} must match [A-Za-z0-9._-] and be at most 64 characters`);
  return text;
}

function relativePortablePath(base: string, target: string): string {
  return path.relative(base, target).split(path.sep).join('/') || path.basename(target);
}

function resolveManifestFile(manifestPath: string, file: string): string {
  return path.isAbsolute(file) ? file : path.resolve(path.dirname(manifestPath), file);
}

function imageDimensions(buffer: Buffer): string {
  const png = pngDimensions(buffer);
  if (png) return png;
  const jpeg = jpegDimensions(buffer);
  if (jpeg) return jpeg;
  const gif = gifDimensions(buffer);
  if (gif) return gif;
  return 'unknown';
}

function pngDimensions(buffer: Buffer): string {
  if (buffer.length < 24) return '';
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return '';
  return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
}

function gifDimensions(buffer: Buffer): string {
  if (buffer.length < 10) return '';
  const signature = buffer.toString('ascii', 0, 6);
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return '';
  return `${buffer.readUInt16LE(6)}x${buffer.readUInt16LE(8)}`;
}

function jpegDimensions(buffer: Buffer): string {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return '';
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return '';
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return `${buffer.readUInt16BE(offset + 7)}x${buffer.readUInt16BE(offset + 5)}`;
    if (length < 2) return '';
    offset += 2 + length;
  }
  return '';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
