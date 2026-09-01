import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, type BigIntStats } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { compareStableText } from './stable-order.js';

export const INSTALL_RECEIPT_NAME = '.yam-flow-install-receipt.json';
export const INSTALL_LOCK_NAME = '.yam-flow-install.lock';
export const INSTALL_RECEIPT_SCHEMA = 'yam.install-receipt.v1';
export const INSTALL_TRANSACTION_PREFIX = '.yam-flow-install-';
const TRANSACTION_OWNER_MARKER = '.yam-flow-transaction-owner';

export type InstallFileDigest = {
  path: string;
  bytes: number;
  sha256: string;
};

export type InstallReceipt = {
  schema: typeof INSTALL_RECEIPT_SCHEMA;
  package: {
    name: string;
    version: string;
  };
  source: {
    kind: 'package-bundled-skills';
    identity: string;
  };
  destination: string;
  installed_at: string;
  transaction_id: string;
  skills: string[];
  integrity: {
    algorithm: 'sha256';
    file_count: number;
    source_digest: string;
    files: InstallFileDigest[];
  };
};

export type InstallFailpointEvent = {
  phase:
    | 'after-stage'
    | 'before-mutation'
    | 'after-backup'
    | 'skill-installed'
    | 'receipt-installed'
    | 'mirror-cleaned'
    | 'before-verify';
  skill?: string;
};

export type TransactionalInstallOptions = {
  sourceRoot: string;
  destination: string;
  codexMirror?: string;
  packageName: string;
  version: string;
  skills: string[];
  replaceSkills?: string[];
  legacySkills?: string[];
  retiredSkills?: string[];
  now?: () => Date;
  transactionId?: string;
  failpoint?: (event: InstallFailpointEvent) => void | Promise<void>;
};

export type InstallationInspectionOptions = Pick<
  TransactionalInstallOptions,
  'sourceRoot' | 'destination' | 'packageName' | 'version' | 'skills'
> & {
  ignoreRecoveryArtifacts?: boolean;
};

export type SkillInstallStatus = {
  skill: string;
  status: 'ok' | 'missing' | 'drift';
  issues: string[];
};

export type InstallationInspection = {
  ok: boolean;
  destination: string;
  receiptPath: string;
  receiptStatus: 'ok' | 'missing' | 'drift';
  receipt?: InstallReceipt;
  sourceDigest?: string;
  recoveryArtifacts: string[];
  skills: SkillInstallStatus[];
  issues: string[];
};

export type TransactionalInstallResult = {
  receipt: InstallReceipt;
  receiptPath: string;
  installedFiles: number;
  sourceDigest: string;
  cleanupWarnings: string[];
};

export type SkillInstallPlanOperation = {
  action: 'create' | 'replace_managed' | 'replace_explicitly_authorized' | 'remove_retired' | 'write_receipt';
  skill: string;
  path: string;
  reason: string;
};

export type SkillInstallPlan = {
  schema: 'yam.install-plan.v1';
  generated_at: string;
  mutation_authorized: false;
  package: {
    name: string;
    version: string;
  };
  source: {
    root: string;
    digest: string;
    file_count: number;
  };
  destination: string;
  receipt_path: string;
  operations: SkillInstallPlanOperation[];
  preserved_paths: string[];
  blockers: string[];
  ready: boolean;
  truth_status: 'verified' | 'blocked';
  plan_digest: string;
  next_action: string;
};

export type SafeUninstallOptions = {
  destination: string;
  codexMirror?: string;
  packageName: string;
  skills: string[];
  failpoint?: (event: SafeUninstallFailpointEvent) => void | Promise<void>;
};

export type SafeUninstallFailpointEvent = {
  phase: 'before-mutation' | 'after-backup' | 'before-verify';
};

export type SafeUninstallResult = {
  receiptPath: string;
  removedSkills: string[];
  cleanupWarnings: string[];
};

type MovedEntry = {
  original: string;
  backup: string;
  originalBoundary: string;
  backupBoundary: string;
};

type OwnershipPreflight = {
  receipt?: InstallReceipt;
  replaceNames: string[];
};

type TreeMutationSnapshot = {
  name: string;
  files: InstallFileDigest[];
};

type ReceiptMutationSnapshot =
  | { exists: false }
  | {
      exists: true;
      bytes: Buffer;
      sha256: string;
      receipt: InstallReceipt;
    };

type MutationSnapshot = {
  trees: TreeMutationSnapshot[];
  receipt: ReceiptMutationSnapshot;
};

type PathIdentity = {
  path: string;
  dev: number;
  ino: number;
};

type InstalledEntry = {
  path: string;
  dev: bigint;
  ino: bigint;
  kind: 'directory' | 'file';
  birthtimeNs?: bigint;
  handle?: fsp.FileHandle;
  contentsSha256?: string;
  treeDigest?: string;
  ownershipMarker?: {
    name: string;
    sha256: string;
  };
};

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function validateManagedNames(names: string[]) {
  for (const name of names) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      throw new Error(`unsafe managed skill name: ${name}`);
    }
  }
}

function safeRoot(value: string, label: string) {
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    throw new Error(`${label} cannot be a filesystem root: ${resolved}`);
  }
  return resolved;
}

async function exists(target: string) {
  try {
    await fsp.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }
}

function pathWithinBoundary(boundary: string, target: string) {
  const relative = path.relative(boundary, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function captureRegularParentPath(boundaryValue: string, targetValue: string, label: string) {
  const boundary = path.resolve(boundaryValue);
  const target = path.resolve(targetValue);
  if (!pathWithinBoundary(boundary, target)) {
    throw new Error(`${label} escapes its trusted path boundary: ${target}`);
  }

  const targetParent = target === boundary ? boundary : path.dirname(target);
  const relativeParent = path.relative(boundary, targetParent);
  const candidates = [boundary];
  if (relativeParent) {
    let current = boundary;
    for (const segment of relativeParent.split(path.sep)) {
      current = path.join(current, segment);
      candidates.push(current);
    }
  }

  const identities: PathIdentity[] = [];
  for (const candidate of candidates) {
    const stat = await fsp.lstat(candidate);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} has a symlinked parent path segment: ${candidate}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`${label} parent path segment must be a regular directory: ${candidate}`);
    }
    identities.push({ path: candidate, dev: stat.dev, ino: stat.ino });
  }
  return identities;
}

async function revalidateRegularParentPath(identities: PathIdentity[], label: string) {
  for (const identity of identities) {
    const stat = await fsp.lstat(identity.path);
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || stat.dev !== identity.dev
      || stat.ino !== identity.ino
    ) {
      throw new Error(`${label} parent path changed identity: ${identity.path}`);
    }
  }
}

async function captureRegularDirectoryPath(boundaryValue: string, directoryValue: string, label: string) {
  const boundary = path.resolve(boundaryValue);
  const directory = path.resolve(directoryValue);
  if (boundary === directory) {
    const stat = await fsp.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${label} must be a regular directory: ${directory}`);
    }
    return [{ path: directory, dev: stat.dev, ino: stat.ino }];
  }
  const identities = await captureRegularParentPath(boundary, directory, label);
  const stat = await fsp.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular directory: ${directory}`);
  }
  identities.push({ path: directory, dev: stat.dev, ino: stat.ino });
  return identities;
}

function readOnlyNoFollowFlags() {
  const noFollow = process.platform !== 'win32' && typeof fsConstants.O_NOFOLLOW === 'number'
    ? fsConstants.O_NOFOLLOW
    : 0;
  return fsConstants.O_RDONLY | noFollow;
}

async function confirmWindowsPathForHandle(
  target: string,
  opened: BigIntStats,
  before: BigIntStats,
  label: string
) {
  if (before.birthtimeNs <= 0n) {
    throw new Error(`${label} requires a positive birthtime on Windows: ${target}`);
  }
  let pathHandle: fsp.FileHandle | undefined;
  try {
    pathHandle = await fsp.open(target, fsConstants.O_RDONLY);
    const pathOpened = await pathHandle.stat({ bigint: true });
    const confirmed = await fsp.lstat(target, { bigint: true });
    if (
      !opened.isFile()
      || !pathOpened.isFile()
      || pathOpened.dev !== opened.dev
      || pathOpened.ino !== opened.ino
      || confirmed.isSymbolicLink()
      || !confirmed.isFile()
      || confirmed.dev !== before.dev
      || confirmed.ino !== before.ino
      || confirmed.birthtimeNs !== before.birthtimeNs
    ) {
      throw new Error(`${label} changed identity while confirming Windows path ownership: ${target}`);
    }
    return confirmed;
  } finally {
    if (pathHandle) await pathHandle.close();
  }
}

async function captureRegularFile(file: string, boundary = path.dirname(file)) {
  const parents = await captureRegularParentPath(boundary, file, 'regular file read');
  const before = await fsp.lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`expected a regular file: ${file}`);
  const handle = await fsp.open(file, readOnlyNoFollowFlags());
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) throw new Error(`expected a regular file: ${file}`);
    const bytes = await handle.readFile();
    const afterOpened = await handle.stat({ bigint: true });
    const after = process.platform === 'win32'
      ? await confirmWindowsPathForHandle(file, opened, before, 'regular file')
      : await fsp.lstat(file, { bigint: true });
    await revalidateRegularParentPath(parents, 'regular file read');
    if (
      !after.isFile()
      || after.isSymbolicLink()
      || afterOpened.dev !== opened.dev
      || afterOpened.ino !== opened.ino
      || (process.platform !== 'win32' && (
        before.dev !== opened.dev
        || before.ino !== opened.ino
        || after.dev !== opened.dev
        || after.ino !== opened.ino
      ))
    ) {
      throw new Error(`regular file changed identity while being captured: ${file}`);
    }
    return { bytes, mode: Number(opened.mode & 0o777n) };
  } finally {
    await handle.close();
  }
}

async function readRegularFileBytes(file: string, boundary = path.dirname(file)) {
  return (await captureRegularFile(file, boundary)).bytes;
}

async function copyRegularFile(
  source: string,
  target: string,
  sourceBoundary: string,
  targetBoundary: string
) {
  const sourceFile = await captureRegularFile(source, sourceBoundary);
  const targetParents = await captureRegularParentPath(targetBoundary, target, 'install copy target');
  const noFollow = process.platform !== 'win32' && typeof fsConstants.O_NOFOLLOW === 'number'
    ? fsConstants.O_NOFOLLOW
    : 0;
  const handle = await fsp.open(
    target,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
    sourceFile.mode
  );
  try {
    await handle.writeFile(sourceFile.bytes);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) throw new Error(`install copy target must be a regular file: ${target}`);
    const openedIdentity = { dev: opened.dev, ino: opened.ino };
    const afterOpened = await handle.stat({ bigint: true });
    if (afterOpened.dev !== openedIdentity.dev || afterOpened.ino !== openedIdentity.ino) {
      throw new Error(`install copy target changed descriptor identity: ${target}`);
    }
    await revalidateRegularParentPath(targetParents, 'install copy target');
    const beforeInstalled = await fsp.lstat(target, { bigint: true });
    const installed = process.platform === 'win32'
      ? await confirmWindowsPathForHandle(target, opened, beforeInstalled, 'install copy target')
      : beforeInstalled;
    if (
      !installed.isFile()
      || installed.isSymbolicLink()
      || (process.platform !== 'win32' && (
        installed.dev !== openedIdentity.dev
        || installed.ino !== openedIdentity.ino
      ))
    ) {
      throw new Error(`install copy target changed path identity: ${target}`);
    }
  } finally {
    await handle.close();
  }
}

export async function findInstallRecoveryArtifacts(root: string) {
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.name.startsWith(INSTALL_TRANSACTION_PREFIX) && entry.name !== INSTALL_RECEIPT_NAME)
      .map((entry) => path.join(root, entry.name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function digestFile(
  file: string,
  relativePath: string,
  boundary = path.dirname(file)
): Promise<InstallFileDigest> {
  const stat = await fsp.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`install source must be a regular file: ${file}`);
  }
  const contents = await readRegularFileBytes(file, boundary);
  return {
    path: relativePath.split(path.sep).join('/'),
    bytes: contents.byteLength,
    sha256: createHash('sha256').update(contents).digest('hex')
  };
}

async function collectTreeManifest(
  root: string,
  prefix = '',
  boundary = root
): Promise<InstallFileDigest[]> {
  const rootIdentity = await captureRegularDirectoryPath(boundary, root, 'install tree');

  const files: InstallFileDigest[] = [];
  async function walk(current: string, relative: string): Promise<void> {
    const directoryIdentity = await captureRegularDirectoryPath(boundary, current, 'install tree');
    const entries = await fsp.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => compareStableText(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const nextRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(absolute, nextRelative);
      } else if (entry.isFile()) {
        files.push(await digestFile(absolute, path.join(prefix, nextRelative), boundary));
      } else {
        throw new Error(`unsupported install tree entry: ${absolute}`);
      }
    }
    await revalidateRegularParentPath(directoryIdentity, 'install tree');
  }

  await walk(root, '');
  await revalidateRegularParentPath(rootIdentity, 'install tree');
  return files.sort((left, right) => compareStableText(left.path, right.path));
}

async function expectedInstallManifest(sourceRoot: string, skills: string[]) {
  const sourceIdentity = await captureRegularDirectoryPath(sourceRoot, sourceRoot, 'install source root');
  const referencesRoot = path.join(sourceRoot, 'references');
  const referenceFiles = await collectTreeManifest(referencesRoot, '', sourceRoot);
  if (referenceFiles.length === 0) throw new Error(`no reference files found: ${referencesRoot}`);

  const files: InstallFileDigest[] = [];
  for (const skill of skills) {
    const skillFile = path.join(sourceRoot, 'skills', skill, 'SKILL.md');
    const skillBytes = await readRegularFileBytes(skillFile, sourceRoot);
    const skillText = skillBytes.toString('utf8');
    const frontmatter = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const name = frontmatter?.[1].match(/^name:\s*([^\r\n]+)\s*$/m)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, '');
    if (name !== skill) {
      throw new Error(`skill source frontmatter mismatch for ${skill}: ${name || 'missing'}`);
    }
    files.push({
      path: path.join(skill, 'SKILL.md').split(path.sep).join('/'),
      bytes: skillBytes.byteLength,
      sha256: createHash('sha256').update(skillBytes).digest('hex')
    });
    for (const reference of referenceFiles) {
      files.push({
        ...reference,
        path: path.posix.join(skill, 'references', reference.path)
      });
    }
  }
  await revalidateRegularParentPath(sourceIdentity, 'install source root');
  return files.sort((left, right) => compareStableText(left.path, right.path));
}

async function copyTree(
  source: string,
  target: string,
  sourceBoundary = source,
  targetBoundary = target
): Promise<void> {
  const sourceIdentity = await captureRegularDirectoryPath(sourceBoundary, source, 'install source tree');
  const targetParents = await captureRegularParentPath(targetBoundary, target, 'install target tree');
  await fsp.mkdir(target, { recursive: true });
  const targetIdentity = await captureRegularDirectoryPath(targetBoundary, target, 'install target tree');
  await revalidateRegularParentPath(sourceIdentity, 'install source tree');
  await revalidateRegularParentPath(targetParents, 'install target tree');
  const entries = await fsp.readdir(source, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to, sourceBoundary, targetBoundary);
    } else if (entry.isFile()) {
      await copyRegularFile(from, to, sourceBoundary, targetBoundary);
    } else {
      throw new Error(`unsupported install source entry: ${from}`);
    }
  }
  await revalidateRegularParentPath(sourceIdentity, 'install source tree');
  await revalidateRegularParentPath(targetIdentity, 'install target tree');
}

async function moveRegularDirectory(
  source: string,
  target: string,
  sourceBoundary: string,
  targetBoundary: string,
  label: string,
  onMoved?: () => void,
  identityOwner?: InstalledEntry[]
): Promise<InstalledEntry | undefined> {
  const sourceParents = await captureRegularParentPath(sourceBoundary, source, `${label} source`);
  const sourceStat = await fsp.lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`${label} source must be a regular directory: ${source}`);
  }
  const targetParents = await captureRegularParentPath(targetBoundary, target, `${label} target`);
  if (await exists(target)) throw new Error(`${label} target unexpectedly exists: ${target}`);
  const recorded = identityOwner ? await captureRecordedEntry(source, 'directory', label) : undefined;
  let identityTransferred = false;
  try {
    await fsp.rename(source, target);
    if (!recorded) onMoved?.();
    if (recorded) {
      recorded.path = target;
      identityOwner?.push(recorded);
      identityTransferred = true;
    }
    await revalidateRegularParentPath(sourceParents, `${label} source`);
    await revalidateRegularParentPath(targetParents, `${label} target`);
    const targetStat = await fsp.lstat(target);
    if (
      !targetStat.isDirectory()
      || targetStat.isSymbolicLink()
      || targetStat.dev !== sourceStat.dev
      || targetStat.ino !== sourceStat.ino
    ) {
      throw new Error(`${label} directory changed identity while being moved: ${target}`);
    }
    return recorded;
  } catch (error) {
    if (recorded && !identityTransferred) await closeRecordedEntry(recorded);
    throw error;
  }
}

async function moveRegularFile(
  source: string,
  target: string,
  sourceBoundary: string,
  targetBoundary: string,
  label: string,
  onMoved?: () => void,
  identityOwner?: InstalledEntry[]
): Promise<InstalledEntry | undefined> {
  const sourceParents = await captureRegularParentPath(sourceBoundary, source, `${label} source`);
  const sourceStat = await fsp.lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`${label} source must be a regular file: ${source}`);
  }
  const targetParents = await captureRegularParentPath(targetBoundary, target, `${label} target`);
  if (await exists(target)) throw new Error(`${label} target unexpectedly exists: ${target}`);
  const recorded = identityOwner ? await captureRecordedEntry(source, 'file', label) : undefined;
  let identityTransferred = false;
  try {
    await fsp.rename(source, target);
    if (!recorded) onMoved?.();
    if (recorded) {
      recorded.path = target;
      identityOwner?.push(recorded);
      identityTransferred = true;
    }
    await revalidateRegularParentPath(sourceParents, `${label} source`);
    await revalidateRegularParentPath(targetParents, `${label} target`);
    const targetStat = await fsp.lstat(target);
    if (
      !targetStat.isFile()
      || targetStat.isSymbolicLink()
      || targetStat.dev !== sourceStat.dev
      || targetStat.ino !== sourceStat.ino
    ) {
      throw new Error(`${label} file changed identity while being moved: ${target}`);
    }
    return recorded;
  } catch (error) {
    if (recorded && !identityTransferred) await closeRecordedEntry(recorded);
    throw error;
  }
}

function manifestDigest(files: InstallFileDigest[]) {
  return digestManifestFiles([...files].sort((left, right) => compareStableText(left.path, right.path)));
}

function digestManifestFiles(files: InstallFileDigest[]) {
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(file.path);
    digest.update('\0');
    digest.update(String(file.bytes));
    digest.update('\0');
    digest.update(file.sha256);
    digest.update('\n');
  }
  return digest.digest('hex');
}

function allowsLegacyManifestOrder(version: unknown) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version || ''));
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return major < 2 || (major === 2 && (minor < 5 || (minor === 5 && patch === 0)));
}

function receiptManifestDigestMatches(files: InstallFileDigest[], digest: unknown, version: unknown) {
  if (digest === manifestDigest(files)) return true;
  return allowsLegacyManifestOrder(version) && digest === digestManifestFiles(files);
}

function manifestIssues(expected: InstallFileDigest[], actual: InstallFileDigest[], label: string) {
  const issues: string[] = [];
  const expectedByPath = new Map(expected.map((file) => [file.path, file]));
  const actualByPath = new Map(actual.map((file) => [file.path, file]));
  if (actualByPath.size !== actual.length) issues.push(`${label} contains duplicate file paths`);

  for (const expectedFile of expected) {
    const actualFile = actualByPath.get(expectedFile.path);
    if (!actualFile) {
      issues.push(`${label} missing file: ${expectedFile.path}`);
      continue;
    }
    if (actualFile.bytes !== expectedFile.bytes || actualFile.sha256 !== expectedFile.sha256) {
      issues.push(`${label} hash drift: ${expectedFile.path}`);
    }
  }
  for (const actualFile of actual) {
    if (!expectedByPath.has(actualFile.path)) issues.push(`${label} unexpected file: ${actualFile.path}`);
  }
  return issues;
}

function isFileDigest(value: unknown): value is InstallFileDigest {
  if (!value || typeof value !== 'object') return false;
  const file = value as Record<string, unknown>;
  return typeof file.path === 'string'
    && typeof file.bytes === 'number'
    && Number.isSafeInteger(file.bytes)
    && file.bytes >= 0
    && typeof file.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(file.sha256);
}

function isSafeManifestPath(value: string) {
  if (!value || value.includes('\\') || path.posix.isAbsolute(value)) return false;
  const parts = value.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..')
    && path.posix.normalize(value) === value;
}

function ownershipReceiptIssues(
  receipt: unknown,
  packageName: string,
  destination: string
) {
  const issues: string[] = [];
  if (!receipt || typeof receipt !== 'object') return ['install receipt must be a JSON object'];
  const value = receipt as Record<string, any>;
  if (value.schema !== INSTALL_RECEIPT_SCHEMA) issues.push(`install receipt schema mismatch: ${value.schema || 'missing'}`);
  if (value.package?.name !== packageName) issues.push(`install receipt package mismatch: ${value.package?.name || 'missing'}`);
  if (typeof value.package?.version !== 'string' || !value.package.version) issues.push('install receipt package version missing');
  if (value.source?.kind !== 'package-bundled-skills') issues.push('install receipt source kind mismatch');
  if (value.source?.identity !== `${value.package?.name}@${value.package?.version}`) {
    issues.push('install receipt source identity mismatch');
  }
  if (typeof value.destination !== 'string' || path.resolve(value.destination) !== destination) {
    issues.push('install receipt destination mismatch');
  }
  if (typeof value.installed_at !== 'string' || Number.isNaN(Date.parse(value.installed_at))) {
    issues.push('install receipt timestamp missing or invalid');
  }
  if (typeof value.transaction_id !== 'string' || !value.transaction_id) {
    issues.push('install receipt transaction id missing');
  }
  if (
    !Array.isArray(value.skills)
    || value.skills.length === 0
    || !value.skills.every((skill: unknown) => typeof skill === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(skill))
    || unique(value.skills).length !== value.skills.length
  ) {
    issues.push('install receipt skill inventory is malformed');
  }
  if (value.integrity?.algorithm !== 'sha256') issues.push('install receipt integrity algorithm mismatch');
  if (!Array.isArray(value.integrity?.files) || !value.integrity.files.every(isFileDigest)) {
    issues.push('install receipt file manifest is malformed');
    return issues;
  }

  const files = value.integrity.files as InstallFileDigest[];
  const paths = files.map((file) => file.path);
  if (files.some((file) => !isSafeManifestPath(file.path))) {
    issues.push('install receipt file manifest contains an unsafe path');
  }
  if (unique(paths).length !== paths.length) {
    issues.push('install receipt file manifest contains duplicate paths');
  }
  if (value.integrity?.file_count !== files.length) {
    issues.push('install receipt file count does not match its manifest');
  }
  if (!receiptManifestDigestMatches(files, value.integrity?.source_digest, value.package?.version)) {
    issues.push('install receipt source digest does not match its manifest');
  }
  if (Array.isArray(value.skills)) {
    const inventory = new Set<string>(value.skills);
    for (const file of files) {
      if (!inventory.has(file.path.split('/')[0])) {
        issues.push(`install receipt file is outside its skill inventory: ${file.path}`);
      }
    }
    for (const skill of inventory) {
      if (!files.some((file) => file.path.startsWith(`${skill}/`))) {
        issues.push(`install receipt has no file manifest for skill: ${skill}`);
      }
    }
  }
  return issues;
}

async function readOwnershipReceipt(
  destination: string,
  packageName: string
): Promise<{ exists: boolean; receipt?: InstallReceipt; issues: string[] }> {
  const receiptPath = path.join(destination, INSTALL_RECEIPT_NAME);
  if (!await exists(receiptPath)) {
    return { exists: false, issues: [`install receipt missing: ${receiptPath}`] };
  }
  try {
    const stat = await fsp.lstat(receiptPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { exists: true, issues: [`install receipt must be a regular file: ${receiptPath}`] };
    }
    const parsed = JSON.parse((await readRegularFileBytes(receiptPath, destination)).toString('utf8'));
    const issues = ownershipReceiptIssues(parsed, packageName, destination);
    return issues.length
      ? { exists: true, issues }
      : { exists: true, receipt: parsed as InstallReceipt, issues: [] };
  } catch (error) {
    return { exists: true, issues: [`install receipt unreadable: ${message(error)}`] };
  }
}

function receiptFilesForSkill(receipt: InstallReceipt, skill: string) {
  return receipt.integrity.files.filter((file) => file.path.startsWith(`${skill}/`));
}

async function verifyReceiptOwnedSkill(
  root: string,
  skill: string,
  receipt: InstallReceipt
) {
  if (!receipt.skills.includes(skill)) {
    return [`install receipt does not own active skill: ${skill}`];
  }
  const expected = receiptFilesForSkill(receipt, skill);
  if (expected.length === 0) return [`install receipt has no file manifest for skill: ${skill}`];
  const target = path.join(root, skill);
  if (!await exists(target)) return [`receipt-owned skill is missing: ${skill}`];
  try {
    const actual = await collectTreeManifest(target, skill, root);
    return manifestIssues(expected, actual, `installed ${skill}`);
  } catch (error) {
    return [`installed ${skill} cannot be verified: ${message(error)}`];
  }
}

async function preflightInstallOwnership(
  destination: string,
  packageName: string,
  skills: string[],
  cleanupCandidates: string[],
  replaceSkills: string[]
): Promise<OwnershipPreflight> {
  const invalidOverrides = replaceSkills.filter((skill) => !skills.includes(skill));
  if (invalidOverrides.length) {
    throw new Error(`replacement override must name an active skill: ${invalidOverrides.join(', ')}`);
  }
  const existingActive: string[] = [];
  for (const skill of skills) {
    if (await exists(path.join(destination, skill))) existingActive.push(skill);
  }
  const receiptState = await readOwnershipReceipt(destination, packageName);
  const conflicts: string[] = [];
  if (receiptState.exists && !receiptState.receipt) {
    conflicts.push(`existing install receipt is unproven: ${receiptState.issues.join('; ')}`);
  }
  for (const skill of existingActive) {
    if (replaceSkills.includes(skill)) continue;
    if (!receiptState.receipt) {
      conflicts.push(
        `${skill} is user-owned or cannot be proven yam-owned: ${receiptState.issues.join('; ')}`
      );
      continue;
    }
    const ownershipIssues = await verifyReceiptOwnedSkill(destination, skill, receiptState.receipt);
    if (ownershipIssues.length) {
      conflicts.push(`${skill} is user-owned or locally modified: ${ownershipIssues.join('; ')}`);
    }
  }
  if (conflicts.length) {
    throw new Error(
      `active skill ownership conflict; no files were changed: ${conflicts.join('; ')}. `
      + 'Use an explicit per-skill replacement override only after reviewing the existing files.'
    );
  }

  const replaceNames = [...existingActive];
  if (receiptState.receipt) {
    for (const skill of cleanupCandidates) {
      if (!await exists(path.join(destination, skill))) continue;
      const ownershipIssues = await verifyReceiptOwnedSkill(destination, skill, receiptState.receipt);
      if (ownershipIssues.length === 0) replaceNames.push(skill);
    }
  }
  return {
    receipt: receiptState.receipt,
    replaceNames: unique(replaceNames)
  };
}

async function preflightSafeUninstallOwnership(
  destination: string,
  packageName: string,
  skills: string[]
) {
  const receiptState = await readOwnershipReceipt(destination, packageName);
  if (!receiptState.receipt) {
    throw new Error(
      `safe uninstall cannot prove yam ownership; no files were changed: ${receiptState.issues.join('; ')}`
    );
  }
  const receipt = receiptState.receipt;
  const inventoryMatches = receipt.skills.length === skills.length
    && skills.every((skill) => receipt.skills.includes(skill));
  if (!inventoryMatches) {
    throw new Error(
      'safe uninstall cannot prove ownership of the complete active skill inventory; no files were changed: '
      + `receipt has [${receipt.skills.join(', ')}], expected [${skills.join(', ')}]`
    );
  }

  const conflicts: string[] = [];
  for (const skill of skills) {
    const ownershipIssues = await verifyReceiptOwnedSkill(destination, skill, receipt);
    if (ownershipIssues.length) conflicts.push(`${skill}: ${ownershipIssues.join('; ')}`);
  }
  if (conflicts.length) {
    throw new Error(
      `safe uninstall found a user-owned or locally modified active skill; no files were changed: ${conflicts.join('; ')}`
    );
  }
  return receipt;
}

async function captureReceiptMutationSnapshot(
  destination: string,
  packageName: string
): Promise<ReceiptMutationSnapshot> {
  const receiptPath = path.join(destination, INSTALL_RECEIPT_NAME);
  let bytes: Buffer;
  try {
    bytes = await readRegularFileBytes(receiptPath, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false };
    throw new Error(`cannot capture install receipt ownership boundary: ${message(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`cannot capture malformed install receipt: ${message(error)}`);
  }
  const issues = ownershipReceiptIssues(parsed, packageName, destination);
  if (issues.length) {
    throw new Error(`cannot capture unproven install receipt: ${issues.join('; ')}`);
  }
  return {
    exists: true,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    receipt: parsed as InstallReceipt
  };
}

async function captureMutationSnapshot(
  destination: string,
  packageName: string,
  names: string[],
  explicitReplacements: string[]
): Promise<MutationSnapshot> {
  const receipt = await captureReceiptMutationSnapshot(destination, packageName);
  const trees: TreeMutationSnapshot[] = [];
  for (const name of names) {
    const files = await collectTreeManifest(path.join(destination, name), name, destination);
    if (!explicitReplacements.includes(name)) {
      if (!receipt.exists) {
        throw new Error(`cannot capture receipt-owned skill without an install receipt: ${name}`);
      }
      if (!receipt.receipt.skills.includes(name)) {
        throw new Error(`captured install receipt does not own skill: ${name}`);
      }
      const issues = manifestIssues(receiptFilesForSkill(receipt.receipt, name), files, `captured ${name}`);
      if (issues.length) {
        throw new Error(`captured managed skill changed after ownership preflight: ${issues.join('; ')}`);
      }
    }
    trees.push({ name, files });
  }
  return { trees, receipt };
}

async function verifyMovedMutationSnapshot(
  destination: string,
  snapshot: MutationSnapshot,
  moved: MovedEntry[],
  receiptBackedUp: boolean,
  receiptBackupPath: string
) {
  const issues: string[] = [];
  const movedByOriginal = new Map(moved.map((entry) => [entry.original, entry]));
  for (const tree of snapshot.trees) {
    const original = path.join(destination, tree.name);
    const movedEntry = movedByOriginal.get(original);
    if (!movedEntry) {
      issues.push(`captured entry was not moved: ${tree.name}`);
      continue;
    }
    try {
      const actual = await collectTreeManifest(
        movedEntry.backup,
        tree.name,
        path.dirname(movedEntry.backup)
      );
      issues.push(...manifestIssues(tree.files, actual, `moved backup ${tree.name}`));
    } catch (error) {
      issues.push(`moved backup ${tree.name} cannot be verified: ${message(error)}`);
    }
  }

  if (snapshot.receipt.exists !== receiptBackedUp) {
    issues.push(
      snapshot.receipt.exists
        ? 'captured install receipt was not moved'
        : 'an install receipt appeared after the ownership snapshot'
    );
  } else if (snapshot.receipt.exists && receiptBackedUp) {
    try {
      const bytes = await readRegularFileBytes(receiptBackupPath, path.dirname(receiptBackupPath));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== snapshot.receipt.sha256 || !bytes.equals(snapshot.receipt.bytes)) {
        issues.push('moved install receipt differs from the captured bytes');
      }
    } catch (error) {
      issues.push(`moved install receipt cannot be verified: ${message(error)}`);
    }
  }
  if (issues.length) {
    throw new Error(`ownership snapshot mismatch after backup: ${issues.join('; ')}`);
  }
}

function receiptIssues(
  receipt: unknown,
  options: InstallationInspectionOptions,
  destination: string,
  expected: InstallFileDigest[]
) {
  const issues = ownershipReceiptIssues(receipt, options.packageName, destination);
  if (!receipt || typeof receipt !== 'object') return issues;
  const value = receipt as Record<string, any>;
  if (value.package?.version !== options.version) issues.push(`install receipt version drift: ${value.package?.version || 'missing'} != ${options.version}`);
  if (value.source?.identity !== `${options.packageName}@${options.version}`) issues.push('install receipt source identity drift');
  if (JSON.stringify(value.skills) !== JSON.stringify(options.skills)) issues.push('install receipt skill inventory drift');
  if (value.integrity?.file_count !== expected.length) issues.push('install receipt file count drift');
  const expectedDigest = manifestDigest(expected);
  if (value.integrity?.source_digest !== expectedDigest) issues.push('install receipt source digest drift');
  if (!Array.isArray(value.integrity?.files) || !value.integrity.files.every(isFileDigest)) {
    issues.push('install receipt file manifest is malformed');
  } else {
    issues.push(...manifestIssues(expected, value.integrity.files, 'install receipt'));
  }
  return issues;
}

export async function inspectSkillInstallation(options: InstallationInspectionOptions): Promise<InstallationInspection> {
  const destination = safeRoot(options.destination, 'skill destination');
  validateManagedNames(options.skills);
  const receiptPath = path.join(destination, INSTALL_RECEIPT_NAME);
  const issues: string[] = [];
  const recoveryArtifacts = options.ignoreRecoveryArtifacts ? [] : await findInstallRecoveryArtifacts(destination);
  for (const artifact of recoveryArtifacts) issues.push(`unfinished install transaction requires inspection: ${artifact}`);
  let expected: InstallFileDigest[];

  try {
    expected = await expectedInstallManifest(path.resolve(options.sourceRoot), options.skills);
  } catch (error) {
    const sourceIssue = `install source verification failed: ${message(error)}`;
    return {
      ok: false,
      destination,
      receiptPath,
      receiptStatus: 'drift',
      sourceDigest: undefined,
      recoveryArtifacts,
      skills: options.skills.map((skill) => ({ skill, status: 'drift', issues: [sourceIssue] })),
      issues: [...issues, sourceIssue]
    };
  }

  const skillStatuses: SkillInstallStatus[] = [];
  for (const skill of options.skills) {
    const target = path.join(destination, skill);
    const expectedForSkill = expected.filter((file) => file.path.startsWith(`${skill}/`));
    if (!await exists(target)) {
      const issue = `${skill} is not installed`;
      skillStatuses.push({ skill, status: 'missing', issues: [issue] });
      issues.push(issue);
      continue;
    }
    try {
      const installed = (await collectTreeManifest(target, skill, destination));
      const skillIssues = manifestIssues(expectedForSkill, installed, `installed ${skill}`);
      skillStatuses.push({ skill, status: skillIssues.length ? 'drift' : 'ok', issues: skillIssues });
      issues.push(...skillIssues);
    } catch (error) {
      const issue = `installed ${skill} cannot be verified: ${message(error)}`;
      skillStatuses.push({ skill, status: 'drift', issues: [issue] });
      issues.push(issue);
    }
  }

  let receiptStatus: InstallationInspection['receiptStatus'] = 'missing';
  let receipt: InstallReceipt | undefined;
  if (!await exists(receiptPath)) {
    issues.push(`install receipt missing: ${receiptPath}`);
  } else {
    try {
      const parsed = JSON.parse((await readRegularFileBytes(receiptPath, destination)).toString('utf8'));
      const problems = receiptIssues(parsed, options, destination, expected);
      if (problems.length) {
        receiptStatus = 'drift';
        issues.push(...problems);
      } else {
        receiptStatus = 'ok';
        receipt = parsed as InstallReceipt;
      }
    } catch (error) {
      receiptStatus = 'drift';
      issues.push(`install receipt unreadable: ${message(error)}`);
    }
  }

  return {
    ok: skillStatuses.every((skill) => skill.status === 'ok') && receiptStatus === 'ok' && recoveryArtifacts.length === 0,
    destination,
    receiptPath,
    receiptStatus,
    receipt,
    sourceDigest: manifestDigest(expected),
    recoveryArtifacts,
    skills: skillStatuses,
    issues
  };
}

async function acquireInstallLock(destination: string) {
  const lockPath = path.join(destination, INSTALL_LOCK_NAME);
  const destinationIdentity = await captureRegularDirectoryPath(destination, destination, 'skill destination');
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(lockPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`another yam install may be active; lock exists at ${lockPath}. Remove it only after confirming no install is running.`);
    }
    throw error;
  }
  let lockIdentity: InstalledEntry | undefined;
  try {
    const lockContents = JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }, null, 2);
    await handle.writeFile(lockContents);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) throw new Error(`install lock must be a regular file: ${lockPath}`);
    lockIdentity = await captureLockIdentity(lockPath, opened);
    lockIdentity.contentsSha256 = createHash('sha256').update(lockContents).digest('hex');
    await revalidateRegularParentPath(destinationIdentity, 'skill destination');
    const current = await fsp.lstat(lockPath, { bigint: true });
    if (
      current.isSymbolicLink()
      || !current.isFile()
      || current.dev !== lockIdentity.dev
      || current.ino !== lockIdentity.ino
      || (lockIdentity.birthtimeNs !== undefined && current.birthtimeNs !== lockIdentity.birthtimeNs)
    ) {
      throw new Error(`install lock changed identity while being acquired: ${lockPath}`);
    }
  } catch (error) {
    const cleanupErrors: string[] = [];
    cleanupErrors.push(...await closeFileHandle(handle, lockPath));
    try {
      await revalidateRegularParentPath(destinationIdentity, 'skill destination');
      if (!lockIdentity) throw new Error(`install lock identity was not captured: ${lockPath}`);
      await removeRecordedEntry(lockIdentity, 'install lock');
    } catch (cleanupError) {
      cleanupErrors.push(message(cleanupError));
    } finally {
      const closeErrors = lockIdentity
        ? await closeRecordedEntries([lockIdentity])
        : [];
      cleanupErrors.push(...closeErrors);
    }
    if (cleanupErrors.length) {
      throw new Error(`${message(error)}. Install lock cleanup failed: ${cleanupErrors.join('; ')}`);
    }
    throw error;
  }
  return { handle, lockPath, lockIdentity, destinationIdentity };
}

async function moveExistingEntries(root: string, names: string[], backupRoot: string, moved: MovedEntry[]) {
  await fsp.mkdir(backupRoot, { recursive: true });
  const backupBoundary = path.dirname(backupRoot);
  for (const name of names) {
    const original = path.join(root, name);
    if (!await exists(original)) continue;
    const backup = path.join(backupRoot, name);
    await moveRegularDirectory(
      original,
      backup,
      root,
      backupBoundary,
      'managed install backup',
      () => moved.push({
        original,
        backup,
        originalBoundary: root,
        backupBoundary
      })
    );
  }
}

async function restoreMovedEntries(entries: MovedEntry[]) {
  const errors: string[] = [];
  for (const entry of [...entries].reverse()) {
    try {
      if (await exists(entry.original)) {
        throw new Error(`rollback target unexpectedly exists: ${entry.original}`);
      }
      await fsp.mkdir(path.dirname(entry.original), { recursive: true });
      await moveRegularDirectory(
        entry.backup,
        entry.original,
        entry.backupBoundary,
        entry.originalBoundary,
        'managed install rollback'
      );
    } catch (error) {
      errors.push(message(error));
    }
  }
  return errors;
}

async function removeInstalledEntries(entries: InstalledEntry[]) {
  const errors: string[] = [];
  for (const entry of [...entries].reverse()) {
    try {
      await removeRecordedEntry(entry, 'rollback removal');
    } catch (error) {
      errors.push(`could not remove new install ${entry.path}: ${message(error)}`);
    }
  }
  return errors;
}

async function captureRecordedEntry(
  target: string,
  kind: InstalledEntry['kind'],
  label: string,
  ownershipMarker?: InstalledEntry['ownershipMarker']
): Promise<InstalledEntry> {
  const noFollow = process.platform !== 'win32' && typeof fsConstants.O_NOFOLLOW === 'number'
    ? fsConstants.O_NOFOLLOW
    : 0;
  const directoryOnly = kind === 'directory'
    && process.platform !== 'win32'
    && typeof fsConstants.O_DIRECTORY === 'number'
    ? fsConstants.O_DIRECTORY
    : 0;
  let handle: fsp.FileHandle | undefined;
  try {
    if (process.platform !== 'win32') {
      handle = await fsp.open(target, fsConstants.O_RDONLY | noFollow | directoryOnly);
    }
    if (handle) return await captureRecordedEntryFromHandle(target, kind, label, handle);
    const stat = await fsp.lstat(target, { bigint: true });
    const typeMatches = kind === 'directory'
      ? stat.isDirectory() && !stat.isSymbolicLink()
      : stat.isFile() && !stat.isSymbolicLink();
    if (!typeMatches || stat.birthtimeNs <= 0n) {
      throw new Error(`${label} must be one stable regular ${kind} with a positive birthtime: ${target}`);
    }
    const entry: InstalledEntry = {
      path: target,
      dev: stat.dev,
      ino: stat.ino,
      kind,
      birthtimeNs: stat.birthtimeNs,
      ownershipMarker
    };
    if (kind === 'file') {
      const bytes = await readRegularFileBytes(target, path.dirname(target));
      entry.contentsSha256 = createHash('sha256').update(bytes).digest('hex');
    } else if (!ownershipMarker) {
      entry.treeDigest = manifestDigest(await collectTreeManifest(target));
    }
    return entry;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    throw error;
  }
}

async function captureRecordedEntryFromHandle(
  target: string,
  kind: InstalledEntry['kind'],
  label: string,
  handle: fsp.FileHandle
): Promise<InstalledEntry> {
  const opened = await handle.stat({ bigint: true });
  const current = await fsp.lstat(target, { bigint: true });
  const typeMatches = kind === 'directory'
    ? opened.isDirectory() && current.isDirectory() && !current.isSymbolicLink()
    : opened.isFile() && current.isFile() && !current.isSymbolicLink();
  const birthtimeAvailable = opened.birthtimeNs > 0n && current.birthtimeNs > 0n;
  if (
    !typeMatches
    || opened.dev !== current.dev
    || opened.ino !== current.ino
    || (birthtimeAvailable && opened.birthtimeNs !== current.birthtimeNs)
  ) {
    throw new Error(`${label} must be one stable regular ${kind}: ${target}`);
  }
  return {
    path: target,
    dev: opened.dev,
    ino: opened.ino,
    kind,
    birthtimeNs: birthtimeAvailable ? opened.birthtimeNs : undefined,
    handle
  };
}

async function captureLockIdentity(target: string, created: BigIntStats): Promise<InstalledEntry> {
  const current = await fsp.lstat(target, { bigint: true });
  if (
    !created.isFile()
    || current.isSymbolicLink()
    || !current.isFile()
    || (process.platform !== 'win32' && (
      created.dev !== current.dev
      || created.ino !== current.ino
    ))
  ) {
    throw new Error(`install lock changed identity after exclusive creation: ${target}`);
  }

  let pinHandle: fsp.FileHandle | undefined;
  try {
    if (process.platform !== 'win32') {
      const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
      pinHandle = await fsp.open(target, fsConstants.O_RDONLY | noFollow);
      const pinned = await pinHandle.stat({ bigint: true });
      if (
        !pinned.isFile()
        || pinned.dev !== created.dev
        || pinned.ino !== created.ino
      ) {
        throw new Error(`install lock pin descriptor does not match exclusive creation: ${target}`);
      }
    } else {
      const confirmed = await confirmWindowsPathForHandle(target, created, current, 'install lock');
      return {
        path: target,
        dev: confirmed.dev,
        ino: confirmed.ino,
        kind: 'file',
        birthtimeNs: confirmed.birthtimeNs
      };
    }
    return {
      path: target,
      dev: created.dev,
      ino: created.ino,
      kind: 'file',
      handle: pinHandle
    };
  } catch (error) {
    if (pinHandle) await pinHandle.close().catch(() => {});
    throw error;
  }
}

async function removeRecordedEntry(entry: InstalledEntry, label: string) {
  try {
    let current;
    try {
      current = await fsp.lstat(entry.path, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const opened = entry.handle ? await entry.handle.stat({ bigint: true }) : undefined;
    const typeMatches = entry.kind === 'directory'
      ? current.isDirectory() && !current.isSymbolicLink()
      : current.isFile() && !current.isSymbolicLink();
    if (
      !typeMatches
      || current.dev !== entry.dev
      || current.ino !== entry.ino
      || (entry.birthtimeNs !== undefined && current.birthtimeNs !== entry.birthtimeNs)
      || (opened && (
        opened.dev !== current.dev
        || opened.ino !== current.ino
        || (entry.birthtimeNs !== undefined && opened.birthtimeNs !== current.birthtimeNs)
      ))
    ) {
      throw new Error(`${label} identity mismatch; preserved current path: ${entry.path}`);
    }
    if (entry.contentsSha256) {
      try {
        const bytes = await readRegularFileBytes(entry.path, path.dirname(entry.path));
        const currentSha256 = createHash('sha256').update(bytes).digest('hex');
        if (currentSha256 !== entry.contentsSha256) throw new Error('content digest changed');
      } catch (error) {
        throw new Error(`${label} identity mismatch (content: ${message(error)}); preserved current path: ${entry.path}`);
      }
    }
    if (entry.treeDigest) {
      try {
        const currentTreeDigest = manifestDigest(await collectTreeManifest(entry.path));
        if (currentTreeDigest !== entry.treeDigest) throw new Error('tree digest changed');
      } catch (error) {
        throw new Error(`${label} identity mismatch (tree: ${message(error)}); preserved current path: ${entry.path}`);
      }
    }
    if (entry.ownershipMarker) {
      try {
        const markerPath = path.join(entry.path, entry.ownershipMarker.name);
        const markerBytes = await readRegularFileBytes(markerPath, entry.path);
        const markerSha256 = createHash('sha256').update(markerBytes).digest('hex');
        if (markerSha256 !== entry.ownershipMarker.sha256) throw new Error('ownership marker digest changed');
      } catch (error) {
        throw new Error(`${label} identity mismatch (ownership marker: ${message(error)}); preserved current path: ${entry.path}`);
      }
    }
    await fsp.rm(entry.path, { recursive: entry.kind === 'directory', force: entry.kind === 'file' });
  } finally {
    await closeRecordedEntry(entry);
  }
}

async function captureTransactionRoot(target: string, label: string) {
  const markerContents = `${randomUUID()}\n`;
  const markerPath = path.join(target, TRANSACTION_OWNER_MARKER);
  await fsp.writeFile(markerPath, markerContents, { flag: 'wx', mode: 0o600 });
  return captureRecordedEntry(target, 'directory', label, {
    name: TRANSACTION_OWNER_MARKER,
    sha256: createHash('sha256').update(markerContents).digest('hex')
  });
}

async function closeRecordedEntry(entry: InstalledEntry) {
  const handle = entry.handle;
  entry.handle = undefined;
  if (handle) await handle.close();
}

async function closeRecordedEntries(entries: Array<InstalledEntry | undefined>) {
  const errors: string[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    try {
      await closeRecordedEntry(entry);
    } catch (error) {
      errors.push(`${entry.path}: ${message(error)}`);
    }
  }
  return errors;
}

async function closeFileHandle(handle: fsp.FileHandle, pathLabel: string) {
  try {
    await handle.close();
    return [];
  } catch (error) {
    return [`${pathLabel}: ${message(error)}`];
  }
}

export async function planSkillSetInstallation(options: TransactionalInstallOptions): Promise<SkillInstallPlan> {
  const sourceRoot = path.resolve(options.sourceRoot);
  const destination = safeRoot(options.destination, 'skill destination');
  const codexMirror = options.codexMirror ? safeRoot(options.codexMirror, 'Codex mirror') : '';
  const skills = unique(options.skills);
  const cleanupCandidates = unique([...(options.legacySkills || []), ...(options.retiredSkills || [])]);
  const replaceSkills = unique(options.replaceSkills || []);
  validateManagedNames([...skills, ...cleanupCandidates, ...replaceSkills]);

  const expected = await expectedInstallManifest(sourceRoot, skills);
  const sourceDigest = manifestDigest(expected);
  const receiptPath = path.join(destination, INSTALL_RECEIPT_NAME);
  const operations: SkillInstallPlanOperation[] = [];
  const blockers = await nonMutatingInstallGateBlockers(destination);

  let ownership: OwnershipPreflight | undefined;
  try {
    if (blockers.length) throw new Error(blockers[0]);
    ownership = await preflightInstallOwnership(
      destination,
      options.packageName,
      skills,
      cleanupCandidates,
      replaceSkills
    );
  } catch (error) {
    if (!blockers.length) blockers.push(message(error));
  }

  if (ownership) {
    const replaceNames = new Set(ownership.replaceNames);
    for (const skill of skills) {
      const target = path.join(destination, skill);
      const existing = await exists(target);
      operations.push({
        action: !existing
          ? 'create'
          : replaceSkills.includes(skill)
            ? 'replace_explicitly_authorized'
            : 'replace_managed',
        skill,
        path: target,
        reason: !existing
          ? 'active skill is not installed'
          : replaceSkills.includes(skill)
            ? 'operator supplied an explicit per-skill replacement override'
            : 'existing skill ownership and complete content integrity match the yam receipt'
      });
    }
    for (const skill of cleanupCandidates) {
      if (!replaceNames.has(skill) || skills.includes(skill)) continue;
      operations.push({
        action: 'remove_retired',
        skill,
        path: path.join(destination, skill),
        reason: 'retired or legacy skill is still proven yam-owned by the current receipt'
      });
    }
    operations.push({
      action: 'write_receipt',
      skill: '',
      path: receiptPath,
      reason: ownership.receipt ? 'replace the verified yam ownership receipt' : 'create the yam ownership receipt'
    });
  }

  const preservedPaths = codexMirror && codexMirror !== destination ? [codexMirror] : [];
  const replaceNames = new Set(ownership?.replaceNames || []);
  for (const skill of cleanupCandidates) {
    if (replaceNames.has(skill) || !await exists(path.join(destination, skill))) continue;
    preservedPaths.push(path.join(destination, skill));
  }
  preservedPaths.sort(compareStableText);
  const planBasis = {
    package: { name: options.packageName, version: options.version },
    source: { root: sourceRoot, digest: sourceDigest, file_count: expected.length },
    destination,
    receipt_path: receiptPath,
    operations,
    preserved_paths: preservedPaths,
    blockers
  };
  const planDigest = createHash('sha256').update(JSON.stringify(planBasis)).digest('hex');
  const ready = blockers.length === 0;
  return {
    schema: 'yam.install-plan.v1',
    generated_at: (options.now || (() => new Date()))().toISOString(),
    mutation_authorized: false,
    ...planBasis,
    ready,
    truth_status: ready ? 'verified' : 'blocked',
    plan_digest: planDigest,
    next_action: ready
      ? 'review this non-mutating plan, then run `yam install` without --dry-run to authorize the transaction'
      : 'resolve the listed lock, recovery, destination, or ownership blocker without deleting unreviewed state, then regenerate the plan'
  };
}

async function nonMutatingInstallGateBlockers(destination: string) {
  let stat;
  try {
    stat = await fsp.lstat(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return [`skill destination cannot be inspected: ${message(error)}`];
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return [`skill destination must be a regular physical directory: ${destination}`];
  }

  const blockers: string[] = [];
  const lockPath = path.join(destination, INSTALL_LOCK_NAME);
  if (await exists(lockPath)) {
    blockers.push(`another yam install may be active; lock exists at ${lockPath}`);
  }
  try {
    const recoveryArtifacts = await findInstallRecoveryArtifacts(destination);
    if (recoveryArtifacts.length) {
      blockers.push(`unfinished yam install transaction requires inspection: ${recoveryArtifacts.join(', ')}`);
    }
  } catch (error) {
    blockers.push(`install recovery state cannot be inspected: ${message(error)}`);
  }
  return blockers;
}

export async function installSkillSetTransactional(options: TransactionalInstallOptions): Promise<TransactionalInstallResult> {
  const sourceRoot = path.resolve(options.sourceRoot);
  const destination = safeRoot(options.destination, 'skill destination');
  if (options.codexMirror) safeRoot(options.codexMirror, 'Codex mirror');
  const skills = unique(options.skills);
  const cleanupCandidates = unique([...(options.legacySkills || []), ...(options.retiredSkills || [])]);
  const replaceSkills = unique(options.replaceSkills || []);
  validateManagedNames([...skills, ...cleanupCandidates, ...replaceSkills]);
  await fsp.mkdir(destination, { recursive: true });

  const lock = await acquireInstallLock(destination);
  const cleanupWarnings: string[] = [];
  let result: TransactionalInstallResult | undefined;
  let primaryError: unknown;
  try {
    await revalidateRegularParentPath(lock.destinationIdentity, 'skill destination');
    const recoveryArtifacts = await findInstallRecoveryArtifacts(destination);
    if (recoveryArtifacts.length) {
      throw new Error(
        `unfinished yam install transaction found: ${recoveryArtifacts.join(', ')}. `
        + 'Inspect and preserve any backup state before removing the transaction artifact and retrying.'
      );
    }
    await preflightInstallOwnership(
      destination,
      options.packageName,
      skills,
      cleanupCandidates,
      replaceSkills
    );
    const expected = await expectedInstallManifest(sourceRoot, skills);
    const transactionId = options.transactionId || randomUUID();
    const transactionRoot = await fsp.mkdtemp(path.join(destination, '.yam-flow-install-'));
    const transactionEntry = await captureTransactionRoot(transactionRoot, 'install transaction root');
    const stagedRoot = path.join(transactionRoot, 'staged');
    const backupRoot = path.join(transactionRoot, 'backup');
    const stagedReceiptPath = path.join(transactionRoot, 'receipt.json');
    const destinationReceiptPath = path.join(destination, INSTALL_RECEIPT_NAME);
    const receiptBackupPath = path.join(transactionRoot, 'receipt.backup');
    const installedEntries: InstalledEntry[] = [];
    const receiptInstalledEntries: InstalledEntry[] = [];
    let destinationBackups: MovedEntry[] = [];
    let receiptBackedUp = false;
    let receiptInstalled: InstalledEntry | undefined;
    let mutationStarted = false;

    try {
      await fsp.mkdir(stagedRoot, { recursive: true });
      for (const skill of skills) {
        const stagedSkill = path.join(stagedRoot, skill);
        await fsp.mkdir(stagedSkill, { recursive: true });
        await copyRegularFile(
          path.join(sourceRoot, 'skills', skill, 'SKILL.md'),
          path.join(stagedSkill, 'SKILL.md'),
          sourceRoot,
          stagedRoot
        );
        await copyTree(
          path.join(sourceRoot, 'references'),
          path.join(stagedSkill, 'references'),
          sourceRoot,
          stagedRoot
        );
      }
      const stagedManifest = await collectTreeManifest(stagedRoot);
      const stagedIssues = manifestIssues(expected, stagedManifest, 'staged install');
      if (stagedIssues.length) throw new Error(stagedIssues.join('; '));

      const receipt: InstallReceipt = {
        schema: INSTALL_RECEIPT_SCHEMA,
        package: { name: options.packageName, version: options.version },
        source: { kind: 'package-bundled-skills', identity: `${options.packageName}@${options.version}` },
        destination,
        installed_at: (options.now || (() => new Date()))().toISOString(),
        transaction_id: transactionId,
        skills,
        integrity: {
          algorithm: 'sha256',
          file_count: expected.length,
          source_digest: manifestDigest(expected),
          files: expected
        }
      };
      await fsp.writeFile(stagedReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
      await options.failpoint?.({ phase: 'after-stage' });

      const mutationOwnership = await preflightInstallOwnership(
        destination,
        options.packageName,
        skills,
        cleanupCandidates,
        replaceSkills
      );
      const mutationSnapshot = await captureMutationSnapshot(
        destination,
        options.packageName,
        mutationOwnership.replaceNames,
        replaceSkills
      );
      await options.failpoint?.({ phase: 'before-mutation' });
      await revalidateRegularParentPath(lock.destinationIdentity, 'skill destination');
      mutationStarted = true;
      await moveExistingEntries(destination, mutationOwnership.replaceNames, backupRoot, destinationBackups);
      if (await exists(destinationReceiptPath)) {
        await moveRegularFile(
          destinationReceiptPath,
          receiptBackupPath,
          destination,
          transactionRoot,
          'install receipt backup',
          () => { receiptBackedUp = true; }
        );
      }
      await verifyMovedMutationSnapshot(
        destination,
        mutationSnapshot,
        destinationBackups,
        receiptBackedUp,
        receiptBackupPath
      );
      await options.failpoint?.({ phase: 'after-backup' });
      await revalidateRegularParentPath(lock.destinationIdentity, 'skill destination');

      for (const skill of skills) {
        await revalidateRegularParentPath(lock.destinationIdentity, 'skill destination');
        const target = path.join(destination, skill);
        const installedEntry = await moveRegularDirectory(
          path.join(stagedRoot, skill),
          target,
          stagedRoot,
          destination,
          'staged skill install',
          undefined,
          installedEntries
        );
        if (!installedEntry) throw new Error(`staged skill install identity was not recorded: ${target}`);
        await options.failpoint?.({ phase: 'skill-installed', skill });
      }
      await revalidateRegularParentPath(lock.destinationIdentity, 'skill destination');
      receiptInstalled = await moveRegularFile(
        stagedReceiptPath,
        destinationReceiptPath,
        transactionRoot,
        destination,
        'staged install receipt',
        undefined,
        receiptInstalledEntries
      );
      if (!receiptInstalled) {
        throw new Error(`staged install receipt identity was not recorded: ${destinationReceiptPath}`);
      }
      await options.failpoint?.({ phase: 'receipt-installed' });

      await options.failpoint?.({ phase: 'before-verify' });
      await revalidateRegularParentPath(lock.destinationIdentity, 'skill destination');
      const inspection = await inspectSkillInstallation({
        sourceRoot,
        destination,
        packageName: options.packageName,
        version: options.version,
        skills,
        ignoreRecoveryArtifacts: true
      });
      if (!inspection.ok) throw new Error(`post-install verification failed: ${inspection.issues.join('; ')}`);

      const ownershipHandleErrors = await closeRecordedEntries([receiptInstalled, ...installedEntries]);
      if (ownershipHandleErrors.length) {
        cleanupWarnings.push(`verified install identity handle cleanup failed: ${ownershipHandleErrors.join('; ')}`);
      }

      try {
        await removeRecordedEntry(transactionEntry, 'install transaction cleanup');
      } catch (error) {
        cleanupWarnings.push(`verified install retained cleanup artifact ${transactionRoot}: ${message(error)}`);
      }
      result = {
        receipt,
        receiptPath: destinationReceiptPath,
        installedFiles: expected.length,
        sourceDigest: receipt.integrity.source_digest,
        cleanupWarnings
      };
    } catch (error) {
      const rollbackErrors: string[] = [];
      receiptInstalled ||= receiptInstalledEntries[0];
      let destinationStillOwned = true;
      try {
        await revalidateRegularParentPath(lock.destinationIdentity, 'skill destination');
      } catch (identityError) {
        destinationStillOwned = false;
        rollbackErrors.push(`skill destination identity changed; path-based rollback was not attempted: ${message(identityError)}`);
      }
      if (mutationStarted && destinationStillOwned) {
        if (receiptInstalled) rollbackErrors.push(...await removeInstalledEntries([receiptInstalled]));
        rollbackErrors.push(...await removeInstalledEntries(installedEntries));
        rollbackErrors.push(...await restoreMovedEntries(destinationBackups));
        if (receiptBackedUp) {
          try {
            if (await exists(destinationReceiptPath)) throw new Error(`rollback target unexpectedly exists: ${destinationReceiptPath}`);
            await moveRegularFile(
              receiptBackupPath,
              destinationReceiptPath,
              transactionRoot,
              destination,
              'install receipt rollback'
            );
          } catch (receiptError) {
            rollbackErrors.push(message(receiptError));
          }
        }
      }

      if (rollbackErrors.length === 0) {
        const cleanupErrors: string[] = [];
        try {
          await removeRecordedEntry(transactionEntry, 'install transaction cleanup');
        } catch (cleanupError) {
          cleanupErrors.push(`${transactionRoot}: ${message(cleanupError)}`);
        }
        if (cleanupErrors.length) {
          throw new Error(
            `yam install failed; previous installation state restored, but transaction cleanup is incomplete: ${message(error)}. `
            + `Cleanup errors: ${cleanupErrors.join('; ')}`
          );
        }
        throw new Error(`yam install failed; previous installation state restored: ${message(error)}`);
      }
      const retainedHandleErrors = await closeRecordedEntries([transactionEntry, receiptInstalled, ...installedEntries]);
      rollbackErrors.push(...retainedHandleErrors.map((item) => `identity handle cleanup failed: ${item}`));
      throw new Error(
        `yam install failed and rollback is incomplete: ${message(error)}. `
        + `Recovery artifacts were kept at ${transactionRoot}. `
        + `Rollback errors: ${rollbackErrors.join('; ')}`
      );
    }
  } catch (error) {
    primaryError = error;
  }

  const lockCleanupErrors: string[] = [];
  lockCleanupErrors.push(...await closeFileHandle(lock.handle, lock.lockPath));
  try {
    await revalidateRegularParentPath(lock.destinationIdentity, 'skill destination');
    await removeRecordedEntry(lock.lockIdentity, 'install lock cleanup');
  } catch (error) {
    lockCleanupErrors.push(message(error));
  } finally {
    lockCleanupErrors.push(...await closeRecordedEntries([lock.lockIdentity]));
  }
  if (lockCleanupErrors.length) {
    const warning = `install lock cleanup failed at ${lock.lockPath}: ${lockCleanupErrors.join('; ')}`;
    if (primaryError) primaryError = new Error(`${message(primaryError)}. ${warning}`);
    else cleanupWarnings.push(warning);
  }

  if (primaryError) throw primaryError;
  if (!result) throw new Error('yam install ended without a result');
  result.cleanupWarnings = cleanupWarnings;
  return result;
}

export async function uninstallSkillSetSafely(options: SafeUninstallOptions): Promise<SafeUninstallResult> {
  const destination = safeRoot(options.destination, 'skill destination');
  if (options.codexMirror) safeRoot(options.codexMirror, 'Codex mirror');
  const skills = unique(options.skills);
  validateManagedNames(skills);
  if (!await exists(destination)) {
    throw new Error(`safe uninstall requires a verified yam install receipt: ${path.join(destination, INSTALL_RECEIPT_NAME)}`);
  }

  const lock = await acquireInstallLock(destination);
  const cleanupWarnings: string[] = [];
  let result: SafeUninstallResult | undefined;
  let primaryError: unknown;
  try {
    await revalidateRegularParentPath(lock.destinationIdentity, 'skill destination');
    const recoveryArtifacts = await findInstallRecoveryArtifacts(destination);
    if (recoveryArtifacts.length) {
      throw new Error(
        `unfinished yam install transaction found: ${recoveryArtifacts.join(', ')}. `
        + 'Inspect and preserve any backup state before removing the transaction artifact and retrying.'
      );
    }
    await preflightSafeUninstallOwnership(destination, options.packageName, skills);

    const transactionRoot = await fsp.mkdtemp(path.join(destination, '.yam-flow-install-uninstall-'));
    const transactionEntry = await captureTransactionRoot(transactionRoot, 'uninstall transaction root');
    const backupRoot = path.join(transactionRoot, 'backup');
    const receiptPath = path.join(destination, INSTALL_RECEIPT_NAME);
    const receiptBackup = path.join(transactionRoot, INSTALL_RECEIPT_NAME);
    const moved: MovedEntry[] = [];
    let receiptMoved = false;
    let mutationStarted = false;
    try {
      await preflightSafeUninstallOwnership(destination, options.packageName, skills);
      const mutationSnapshot = await captureMutationSnapshot(
        destination,
        options.packageName,
        skills,
        []
      );
      await options.failpoint?.({ phase: 'before-mutation' });
      await revalidateRegularParentPath(lock.destinationIdentity, 'skill destination');
      mutationStarted = true;
      await moveExistingEntries(destination, skills, backupRoot, moved);
      await moveRegularFile(
        receiptPath,
        receiptBackup,
        destination,
        transactionRoot,
        'uninstall receipt backup',
        () => { receiptMoved = true; }
      );
      await verifyMovedMutationSnapshot(
        destination,
        mutationSnapshot,
        moved,
        receiptMoved,
        receiptBackup
      );
      await options.failpoint?.({ phase: 'after-backup' });
      await revalidateRegularParentPath(lock.destinationIdentity, 'skill destination');
      await options.failpoint?.({ phase: 'before-verify' });
      await revalidateRegularParentPath(lock.destinationIdentity, 'skill destination');

      const remaining = [];
      for (const skill of skills) {
        if (await exists(path.join(destination, skill))) remaining.push(skill);
      }
      if (await exists(receiptPath)) remaining.push(INSTALL_RECEIPT_NAME);
      if (remaining.length) {
        throw new Error(`post-uninstall verification found active entries: ${remaining.join(', ')}`);
      }

      try {
        await removeRecordedEntry(transactionEntry, 'uninstall transaction cleanup');
      } catch (error) {
        cleanupWarnings.push(`verified uninstall retained cleanup artifact ${transactionRoot}: ${message(error)}`);
      }
      result = {
        receiptPath,
        removedSkills: skills,
        cleanupWarnings
      };
    } catch (error) {
      const rollbackErrors: string[] = [];
      let destinationStillOwned = true;
      try {
        await revalidateRegularParentPath(lock.destinationIdentity, 'skill destination');
      } catch (identityError) {
        destinationStillOwned = false;
        rollbackErrors.push(`skill destination identity changed; path-based rollback was not attempted: ${message(identityError)}`);
      }
      if (mutationStarted && destinationStillOwned) {
        if (receiptMoved) {
          try {
            if (await exists(receiptPath)) throw new Error(`rollback target unexpectedly exists: ${receiptPath}`);
            await moveRegularFile(
              receiptBackup,
              receiptPath,
              transactionRoot,
              destination,
              'uninstall receipt rollback'
            );
          } catch (receiptError) {
            rollbackErrors.push(message(receiptError));
          }
        }
        rollbackErrors.push(...await restoreMovedEntries(moved));
      }
      if (rollbackErrors.length === 0) {
        try {
          await removeRecordedEntry(transactionEntry, 'uninstall transaction cleanup');
        } catch (cleanupError) {
          throw new Error(
            `yam uninstall failed; previous installation state restored, but transaction cleanup is incomplete: ${message(error)}. `
            + `Cleanup error: ${message(cleanupError)}`
          );
        }
        throw new Error(`yam uninstall failed; previous installation state restored: ${message(error)}`);
      }
      const retainedHandleErrors = await closeRecordedEntries([transactionEntry]);
      rollbackErrors.push(...retainedHandleErrors.map((item) => `identity handle cleanup failed: ${item}`));
      throw new Error(
        `yam uninstall failed and rollback is incomplete: ${message(error)}. `
        + `Recovery artifacts were kept at ${transactionRoot}. Rollback errors: ${rollbackErrors.join('; ')}`
      );
    }
  } catch (error) {
    primaryError = error;
  }

  const lockCleanupErrors: string[] = [];
  lockCleanupErrors.push(...await closeFileHandle(lock.handle, lock.lockPath));
  try {
    await revalidateRegularParentPath(lock.destinationIdentity, 'skill destination');
    await removeRecordedEntry(lock.lockIdentity, 'install lock cleanup');
  } catch (error) {
    lockCleanupErrors.push(message(error));
  } finally {
    lockCleanupErrors.push(...await closeRecordedEntries([lock.lockIdentity]));
  }
  if (lockCleanupErrors.length) {
    const warning = `install lock cleanup failed at ${lock.lockPath}: ${lockCleanupErrors.join('; ')}`;
    if (primaryError) primaryError = new Error(`${message(primaryError)}. ${warning}`);
    else cleanupWarnings.push(warning);
  }

  if (primaryError) throw primaryError;
  if (!result) throw new Error('yam uninstall ended without a result');
  result.cleanupWarnings = cleanupWarnings;
  return result;
}
