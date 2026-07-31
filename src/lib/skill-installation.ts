import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { compareStableText } from './stable-order.js';

export const INSTALL_RECEIPT_NAME = '.yam-flow-install-receipt.json';
export const INSTALL_LOCK_NAME = '.yam-flow-install.lock';
export const INSTALL_RECEIPT_SCHEMA = 'yam.install-receipt.v1';
export const INSTALL_TRANSACTION_PREFIX = '.yam-flow-install-';

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

async function digestFile(file: string, relativePath: string): Promise<InstallFileDigest> {
  const stat = await fsp.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`install source must be a regular file: ${file}`);
  }
  const contents = await fsp.readFile(file);
  return {
    path: relativePath.split(path.sep).join('/'),
    bytes: contents.byteLength,
    sha256: createHash('sha256').update(contents).digest('hex')
  };
}

async function collectTreeManifest(root: string, prefix = ''): Promise<InstallFileDigest[]> {
  const stat = await fsp.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`install tree must be a regular directory: ${root}`);
  }

  const files: InstallFileDigest[] = [];
  async function walk(current: string, relative: string): Promise<void> {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => compareStableText(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const nextRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(absolute, nextRelative);
      } else if (entry.isFile()) {
        files.push(await digestFile(absolute, path.join(prefix, nextRelative)));
      } else {
        throw new Error(`unsupported install tree entry: ${absolute}`);
      }
    }
  }

  await walk(root, '');
  return files.sort((left, right) => compareStableText(left.path, right.path));
}

async function expectedInstallManifest(sourceRoot: string, skills: string[]) {
  const referencesRoot = path.join(sourceRoot, 'references');
  const referenceFiles = await collectTreeManifest(referencesRoot);
  if (referenceFiles.length === 0) throw new Error(`no reference files found: ${referencesRoot}`);

  const files: InstallFileDigest[] = [];
  for (const skill of skills) {
    const skillFile = path.join(sourceRoot, 'skills', skill, 'SKILL.md');
    const skillText = await fsp.readFile(skillFile, 'utf8');
    const frontmatter = skillText.match(/^---\n([\s\S]*?)\n---/);
    const name = frontmatter?.[1].match(/^name:\s*([^\n]+)\s*$/m)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, '');
    if (name !== skill) {
      throw new Error(`skill source frontmatter mismatch for ${skill}: ${name || 'missing'}`);
    }
    files.push(await digestFile(skillFile, path.join(skill, 'SKILL.md')));
    for (const reference of referenceFiles) {
      files.push({
        ...reference,
        path: path.posix.join(skill, 'references', reference.path)
      });
    }
  }
  return files.sort((left, right) => compareStableText(left.path, right.path));
}

async function copyTree(source: string, target: string): Promise<void> {
  const stat = await fsp.lstat(source);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`install source must be a regular directory: ${source}`);
  }
  await fsp.mkdir(target, { recursive: true });
  const entries = await fsp.readdir(source, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to);
    } else if (entry.isFile()) {
      await fsp.copyFile(from, to);
    } else {
      throw new Error(`unsupported install source entry: ${from}`);
    }
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
    const parsed = JSON.parse(await fsp.readFile(receiptPath, 'utf8'));
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
    const actual = await collectTreeManifest(target, skill);
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

async function readRegularFileBytes(file: string) {
  const before = await fsp.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`expected a regular file: ${file}`);
  const handle = await fsp.open(file, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new Error(`expected a regular file: ${file}`);
    const bytes = await handle.readFile();
    const after = await fsp.lstat(file);
    if (
      !after.isFile()
      || after.isSymbolicLink()
      || before.dev !== opened.dev
      || before.ino !== opened.ino
      || after.dev !== opened.dev
      || after.ino !== opened.ino
    ) {
      throw new Error(`regular file changed identity while being captured: ${file}`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function captureReceiptMutationSnapshot(
  destination: string,
  packageName: string
): Promise<ReceiptMutationSnapshot> {
  const receiptPath = path.join(destination, INSTALL_RECEIPT_NAME);
  let bytes: Buffer;
  try {
    bytes = await readRegularFileBytes(receiptPath);
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
    const files = await collectTreeManifest(path.join(destination, name), name);
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
      const actual = await collectTreeManifest(movedEntry.backup, tree.name);
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
      const bytes = await readRegularFileBytes(receiptBackupPath);
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
      const installed = (await collectTreeManifest(target, skill));
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
      const parsed = JSON.parse(await fsp.readFile(receiptPath, 'utf8'));
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
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(lockPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`another yam install may be active; lock exists at ${lockPath}. Remove it only after confirming no install is running.`);
    }
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }, null, 2));
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fsp.rm(lockPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return { handle, lockPath };
}

async function moveExistingEntries(root: string, names: string[], backupRoot: string, moved: MovedEntry[]) {
  await fsp.mkdir(backupRoot, { recursive: true });
  for (const name of names) {
    const original = path.join(root, name);
    if (!await exists(original)) continue;
    const backup = path.join(backupRoot, name);
    await fsp.rename(original, backup);
    moved.push({ original, backup });
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
      await fsp.rename(entry.backup, entry.original);
    } catch (error) {
      errors.push(message(error));
    }
  }
  return errors;
}

async function removeInstalledEntries(entries: string[]) {
  const errors: string[] = [];
  for (const entry of [...entries].reverse()) {
    try {
      await fsp.rm(entry, { recursive: true, force: true });
    } catch (error) {
      errors.push(`could not remove new install ${entry}: ${message(error)}`);
    }
  }
  return errors;
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
    const stagedRoot = path.join(transactionRoot, 'staged');
    const backupRoot = path.join(transactionRoot, 'backup');
    const stagedReceiptPath = path.join(transactionRoot, 'receipt.json');
    const destinationReceiptPath = path.join(destination, INSTALL_RECEIPT_NAME);
    const receiptBackupPath = path.join(transactionRoot, 'receipt.backup');
    const installedEntries: string[] = [];
    let destinationBackups: MovedEntry[] = [];
    let receiptBackedUp = false;
    let receiptInstalled = false;
    let mutationStarted = false;

    try {
      await fsp.mkdir(stagedRoot, { recursive: true });
      for (const skill of skills) {
        const stagedSkill = path.join(stagedRoot, skill);
        await fsp.mkdir(stagedSkill, { recursive: true });
        await fsp.copyFile(path.join(sourceRoot, 'skills', skill, 'SKILL.md'), path.join(stagedSkill, 'SKILL.md'));
        await copyTree(path.join(sourceRoot, 'references'), path.join(stagedSkill, 'references'));
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
      mutationStarted = true;
      await moveExistingEntries(destination, mutationOwnership.replaceNames, backupRoot, destinationBackups);
      if (await exists(destinationReceiptPath)) {
        await fsp.rename(destinationReceiptPath, receiptBackupPath);
        receiptBackedUp = true;
      }
      await verifyMovedMutationSnapshot(
        destination,
        mutationSnapshot,
        destinationBackups,
        receiptBackedUp,
        receiptBackupPath
      );
      await options.failpoint?.({ phase: 'after-backup' });

      for (const skill of skills) {
        const target = path.join(destination, skill);
        await fsp.rename(path.join(stagedRoot, skill), target);
        installedEntries.push(target);
        await options.failpoint?.({ phase: 'skill-installed', skill });
      }
      await fsp.rename(stagedReceiptPath, destinationReceiptPath);
      receiptInstalled = true;
      await options.failpoint?.({ phase: 'receipt-installed' });

      await options.failpoint?.({ phase: 'before-verify' });
      const inspection = await inspectSkillInstallation({
        sourceRoot,
        destination,
        packageName: options.packageName,
        version: options.version,
        skills,
        ignoreRecoveryArtifacts: true
      });
      if (!inspection.ok) throw new Error(`post-install verification failed: ${inspection.issues.join('; ')}`);

      for (const cleanup of [transactionRoot]) {
        if (!cleanup) continue;
        try {
          await fsp.rm(cleanup, { recursive: true, force: true });
        } catch (error) {
          cleanupWarnings.push(`verified install retained cleanup artifact ${cleanup}: ${message(error)}`);
        }
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
      if (mutationStarted) {
        if (receiptInstalled) rollbackErrors.push(...await removeInstalledEntries([destinationReceiptPath]));
        rollbackErrors.push(...await removeInstalledEntries(installedEntries));
        rollbackErrors.push(...await restoreMovedEntries(destinationBackups));
        if (receiptBackedUp) {
          try {
            if (await exists(destinationReceiptPath)) throw new Error(`rollback target unexpectedly exists: ${destinationReceiptPath}`);
            await fsp.rename(receiptBackupPath, destinationReceiptPath);
          } catch (receiptError) {
            rollbackErrors.push(message(receiptError));
          }
        }
      }

      if (rollbackErrors.length === 0) {
        const cleanupErrors: string[] = [];
        for (const cleanup of [transactionRoot]) {
          if (!cleanup) continue;
          try {
            await fsp.rm(cleanup, { recursive: true, force: true });
          } catch (cleanupError) {
            cleanupErrors.push(`${cleanup}: ${message(cleanupError)}`);
          }
        }
        if (cleanupErrors.length) {
          throw new Error(
            `yam install failed; previous installation state restored, but transaction cleanup is incomplete: ${message(error)}. `
            + `Cleanup errors: ${cleanupErrors.join('; ')}`
          );
        }
        throw new Error(`yam install failed; previous installation state restored: ${message(error)}`);
      }
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
  try {
    await lock.handle.close();
  } catch (error) {
    lockCleanupErrors.push(message(error));
  }
  try {
    await fsp.rm(lock.lockPath, { force: true });
  } catch (error) {
    lockCleanupErrors.push(message(error));
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
    const recoveryArtifacts = await findInstallRecoveryArtifacts(destination);
    if (recoveryArtifacts.length) {
      throw new Error(
        `unfinished yam install transaction found: ${recoveryArtifacts.join(', ')}. `
        + 'Inspect and preserve any backup state before removing the transaction artifact and retrying.'
      );
    }
    await preflightSafeUninstallOwnership(destination, options.packageName, skills);

    const transactionRoot = await fsp.mkdtemp(path.join(destination, '.yam-flow-install-uninstall-'));
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
      mutationStarted = true;
      await moveExistingEntries(destination, skills, backupRoot, moved);
      await fsp.rename(receiptPath, receiptBackup);
      receiptMoved = true;
      await verifyMovedMutationSnapshot(
        destination,
        mutationSnapshot,
        moved,
        receiptMoved,
        receiptBackup
      );
      await options.failpoint?.({ phase: 'after-backup' });
      await options.failpoint?.({ phase: 'before-verify' });

      const remaining = [];
      for (const skill of skills) {
        if (await exists(path.join(destination, skill))) remaining.push(skill);
      }
      if (await exists(receiptPath)) remaining.push(INSTALL_RECEIPT_NAME);
      if (remaining.length) {
        throw new Error(`post-uninstall verification found active entries: ${remaining.join(', ')}`);
      }

      try {
        await fsp.rm(transactionRoot, { recursive: true, force: true });
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
      if (mutationStarted) {
        if (receiptMoved) {
          try {
            if (await exists(receiptPath)) throw new Error(`rollback target unexpectedly exists: ${receiptPath}`);
            await fsp.rename(receiptBackup, receiptPath);
          } catch (receiptError) {
            rollbackErrors.push(message(receiptError));
          }
        }
        rollbackErrors.push(...await restoreMovedEntries(moved));
      }
      if (rollbackErrors.length === 0) {
        try {
          await fsp.rm(transactionRoot, { recursive: true, force: true });
        } catch (cleanupError) {
          throw new Error(
            `yam uninstall failed; previous installation state restored, but transaction cleanup is incomplete: ${message(error)}. `
            + `Cleanup error: ${message(cleanupError)}`
          );
        }
        throw new Error(`yam uninstall failed; previous installation state restored: ${message(error)}`);
      }
      throw new Error(
        `yam uninstall failed and rollback is incomplete: ${message(error)}. `
        + `Recovery artifacts were kept at ${transactionRoot}. Rollback errors: ${rollbackErrors.join('; ')}`
      );
    }
  } catch (error) {
    primaryError = error;
  }

  const lockCleanupErrors: string[] = [];
  try {
    await lock.handle.close();
  } catch (error) {
    lockCleanupErrors.push(message(error));
  }
  try {
    await fsp.rm(lock.lockPath, { force: true });
  } catch (error) {
    lockCleanupErrors.push(message(error));
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
