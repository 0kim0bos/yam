import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { compareStableText } from './stable-order.js';

const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_ITEMS = 256;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const RELEASE_SENSITIVE_PATTERNS = [
  /^(?:package|npm-shrinkwrap)(?:-lock)?\.json$/,
  /^yam\.manifest\.json$/,
  /^CHANGELOG\.md$/,
  /^dist\//,
  /^src\/bin\/yam\.ts$/,
  /^scripts\/(?:install|uninstall|status)\.sh$/,
  /^\.github\/workflows\//
];

export type VerificationScope = 'affected' | 'release';

export interface SelectedVerificationCommand {
  id: string;
  command: string;
  scope: VerificationScope;
  required: boolean;
}

export interface ExecutedVerificationCommand {
  id: string;
  command: string;
  exit_code: number;
  evidence: string;
}

export interface VerificationCommandException {
  check_id: string;
  reason: string;
}

export interface VerificationClosureReceipt {
  schema: 'yam.verification-closure.v1';
  created_at: string;
  planned_scope: VerificationScope;
  final_scope: VerificationScope;
  scope_derivation: {
    source: 'git_status_porcelain_v1';
    availability: 'observed' | 'unavailable';
    promoted: boolean;
    release_sensitive_files: string[];
    reason: string;
  };
  declared_changed_files: string[];
  scope_observation: {
    command: 'git status --porcelain=v1 -z --untracked-files=all';
    availability: 'observed' | 'unavailable';
    changed_files: string[];
    unplanned_files: string[];
    declared_not_observed: string[];
    reason: string;
  };
  changed_files: string[];
  selected_commands: SelectedVerificationCommand[];
  executed_commands: ExecutedVerificationCommand[];
  skipped: VerificationCommandException[];
  truncated: VerificationCommandException[];
  execution_boundary: {
    command_execution_by_yam: false;
    execution_evidence: 'operator_declared';
  };
  status: 'passed' | 'failed';
  blockers: string[];
  truth_status: 'partial' | 'blocked';
  digest: string;
}

export async function createVerificationClosureReceipt(input: {
  root: string;
  receipt_path: string;
  planned_scope: VerificationScope;
  changed_files: string[];
  selected_commands: SelectedVerificationCommand[];
  executed_commands: ExecutedVerificationCommand[];
  skipped: VerificationCommandException[];
  truncated: VerificationCommandException[];
}) {
  assertExactKeys(input, [
    'root', 'receipt_path', 'planned_scope', 'changed_files', 'selected_commands',
    'executed_commands', 'skipped', 'truncated'
  ], 'verification closure input');
  const root = await canonicalRoot(input.root);
  const receiptPath = await resolveReceiptPath(root, input.receipt_path, false);
  const normalized = normalizeClosureInput(input);
  const observation = observeGitScope(root, normalized.changed_files);
  const finalChangedFiles = observation.changed_files;
  const releaseSensitiveFiles = finalChangedFiles.filter(isReleaseSensitivePath);
  const finalScope: VerificationScope = normalized.planned_scope === 'release' || releaseSensitiveFiles.length ? 'release' : 'affected';
  if (finalScope === 'release' && !normalized.selected_commands.some((item) => item.required && item.scope === 'release')) {
    throw new Error('release final scope requires at least one required release-scope command');
  }

  const blockers = normalized.executed_commands
    .filter((item) => item.exit_code !== 0)
    .map((item) => `${item.id}: command exited with code ${item.exit_code}`);
  if (observation.availability === 'unavailable') blockers.push(`git_scope_unavailable: ${observation.reason}`);
  if (observation.unplanned_files.length) blockers.push(`unplanned_final_files: ${observation.unplanned_files.join(', ')}`);
  if (observation.declared_not_observed.length) blockers.push(`declared_files_not_observed: ${observation.declared_not_observed.join(', ')}`);
  const createdAt = new Date().toISOString();
  const canonical = {
    schema: 'yam.verification-closure.v1' as const,
    created_at: createdAt,
    planned_scope: normalized.planned_scope,
    final_scope: finalScope,
    scope_derivation: {
      source: 'git_status_porcelain_v1' as const,
      availability: observation.availability,
      promoted: normalized.planned_scope === 'affected' && finalScope === 'release',
      release_sensitive_files: releaseSensitiveFiles,
      reason: releaseSensitiveFiles.length
        ? `release-sensitive paths require release verification: ${releaseSensitiveFiles.join(', ')}`
        : normalized.planned_scope === 'release'
          ? 'the planned release boundary cannot be silently downgraded'
          : 'no observed release-sensitive path was present'
    },
    declared_changed_files: normalized.changed_files,
    scope_observation: observation,
    changed_files: finalChangedFiles,
    selected_commands: normalized.selected_commands,
    executed_commands: normalized.executed_commands,
    skipped: normalized.skipped,
    truncated: normalized.truncated,
    execution_boundary: {
      command_execution_by_yam: false as const,
      execution_evidence: 'operator_declared' as const
    },
    status: blockers.length ? 'failed' as const : 'passed' as const,
    blockers,
    truth_status: blockers.length ? 'blocked' as const : 'partial' as const
  };
  const receipt: VerificationClosureReceipt = {
    ...canonical,
    digest: digest(canonical)
  };
  await writeImmutableJson(root, receiptPath, receipt);
  return {
    schema: 'yam.verification-closure-write.v1' as const,
    receipt_path: receiptPath,
    receipt,
    truth_status: receipt.truth_status,
    next_action: receipt.status === 'passed'
      ? 'retain this receipt with the completion claim; command execution remains operator-declared'
      : `resolve the first verification-closure blocker before claiming completion: ${blockers[0]}`
  };
}

export function verifyVerificationClosureReceipt(value: unknown) {
  const errors: string[] = [];
  const record = isObject(value) ? value : {};
  assertRecordKeys(record, [
    'schema', 'created_at', 'planned_scope', 'final_scope', 'scope_derivation', 'declared_changed_files',
    'scope_observation', 'changed_files',
    'selected_commands', 'executed_commands', 'skipped', 'truncated', 'execution_boundary',
    'status', 'blockers', 'truth_status', 'digest'
  ], errors, 'receipt');
  if (record.schema !== 'yam.verification-closure.v1') errors.push('schema_invalid');
  if (!isIsoDate(record.created_at)) errors.push('created_at_invalid');
  const plannedScope = scopeValue(record.planned_scope, errors, 'planned_scope');
  const finalScope = scopeValue(record.final_scope, errors, 'final_scope');
  let normalized: ReturnType<typeof normalizeClosureInput> | null = null;
  try {
    normalized = normalizeClosureInput({
      planned_scope: plannedScope,
      changed_files: record.declared_changed_files,
      selected_commands: record.selected_commands,
      executed_commands: record.executed_commands,
      skipped: record.skipped,
      truncated: record.truncated
    });
  } catch (error) {
    errors.push(`contract_invalid:${message(error)}`);
  }
  const derivation = isObject(record.scope_derivation) ? record.scope_derivation : {};
  assertRecordKeys(derivation, ['source', 'availability', 'promoted', 'release_sensitive_files', 'reason'], errors, 'scope_derivation');
  if (derivation.source !== 'git_status_porcelain_v1') errors.push('scope_source_invalid');
  if (derivation.availability !== 'observed' && derivation.availability !== 'unavailable') errors.push('scope_availability_invalid');
  if (typeof derivation.promoted !== 'boolean') errors.push('scope_promoted_invalid');
  if (typeof derivation.reason !== 'string' || !derivation.reason.trim()) errors.push('scope_reason_invalid');
  const boundary = isObject(record.execution_boundary) ? record.execution_boundary : {};
  assertRecordKeys(boundary, ['command_execution_by_yam', 'execution_evidence'], errors, 'execution_boundary');
  if (boundary.command_execution_by_yam !== false) errors.push('execution_boundary_invalid');
  if (boundary.execution_evidence !== 'operator_declared') errors.push('execution_evidence_invalid');

  if (normalized) {
    const observation = normalizeStoredObservation(record.scope_observation, normalized.changed_files, errors);
    const finalChangedFiles = observation.changed_files;
    const releaseSensitiveFiles = finalChangedFiles.filter(isReleaseSensitivePath);
    const expectedFinal = normalized.planned_scope === 'release' || releaseSensitiveFiles.length ? 'release' : 'affected';
    if (!sameJson(record.declared_changed_files, normalized.changed_files)) errors.push('declared_changed_files_order_invalid');
    if (!sameJson(record.changed_files, finalChangedFiles)) errors.push('changed_files_inconsistent');
    if (!sameJson(record.selected_commands, normalized.selected_commands)) errors.push('selected_commands_order_invalid');
    if (!sameJson(record.executed_commands, normalized.executed_commands)) errors.push('executed_commands_order_invalid');
    if (!sameJson(record.skipped, normalized.skipped)) errors.push('skipped_order_invalid');
    if (!sameJson(record.truncated, normalized.truncated)) errors.push('truncated_order_invalid');
    if (finalScope !== expectedFinal) errors.push('final_scope_inconsistent');
    if (derivation.availability !== observation.availability) errors.push('scope_availability_inconsistent');
    if (derivation.promoted !== (normalized.planned_scope === 'affected' && expectedFinal === 'release')) errors.push('scope_promotion_inconsistent');
    if (!sameStringArray(derivation.release_sensitive_files, releaseSensitiveFiles)) errors.push('release_sensitive_files_inconsistent');
    const expectedReason = releaseSensitiveFiles.length
      ? `release-sensitive paths require release verification: ${releaseSensitiveFiles.join(', ')}`
      : normalized.planned_scope === 'release'
        ? 'the planned release boundary cannot be silently downgraded'
        : 'no observed release-sensitive path was present';
    if (derivation.reason !== expectedReason) errors.push('scope_reason_inconsistent');
    if (expectedFinal === 'release' && !normalized.selected_commands.some((item) => item.required && item.scope === 'release')) {
      errors.push('release_command_missing');
    }
    const blockers = normalized.executed_commands
      .filter((item) => item.exit_code !== 0)
      .map((item) => `${item.id}: command exited with code ${item.exit_code}`);
    if (observation.availability === 'unavailable') blockers.push(`git_scope_unavailable: ${observation.reason}`);
    if (observation.unplanned_files.length) blockers.push(`unplanned_final_files: ${observation.unplanned_files.join(', ')}`);
    if (observation.declared_not_observed.length) blockers.push(`declared_files_not_observed: ${observation.declared_not_observed.join(', ')}`);
    if (!sameStringArray(record.blockers, blockers)) errors.push('blockers_inconsistent');
    if (record.status !== (blockers.length ? 'failed' : 'passed')) errors.push('status_inconsistent');
    if (record.truth_status !== (blockers.length ? 'blocked' : 'partial')) errors.push('truth_status_inconsistent');
  }
  if (!['passed', 'failed'].includes(String(record.status || ''))) errors.push('status_invalid');
  if (!['partial', 'blocked'].includes(String(record.truth_status || ''))) errors.push('truth_status_invalid');

  const canonical = { ...record };
  delete canonical.digest;
  if (typeof record.digest !== 'string' || record.digest !== digest(canonical)) errors.push('digest_invalid');
  const uniqueErrors = [...new Set(errors)];
  const receiptBlocked = record.truth_status === 'blocked';
  return {
    schema: 'yam.verification-closure-verification.v1' as const,
    valid: uniqueErrors.length === 0,
    errors: uniqueErrors,
    receipt_truth_status: record.truth_status || 'blocked',
    truth_status: uniqueErrors.length || receiptBlocked ? 'blocked' as const : 'verified' as const,
    next_action: uniqueErrors.length
      ? `reject the verification closure and repair: ${uniqueErrors[0]}`
      : receiptBlocked
        ? `receipt integrity is valid but its completion boundary is blocked: ${Array.isArray(record.blockers) ? record.blockers[0] : 'repair the recorded blocker'}`
        : 'receipt structure, semantics, and digest are intact; command execution evidence remains operator-declared'
  };
}

export async function verifyVerificationClosureReceiptFile(input: { root: string; receipt_path: string }) {
  assertExactKeys(input, ['root', 'receipt_path'], 'verification closure verification input');
  const root = await canonicalRoot(input.root);
  const receiptPath = await resolveReceiptPath(root, input.receipt_path, true);
  const value = await readBoundedJson(root, receiptPath);
  const artifactVerification = verifyVerificationClosureReceipt(value);
  const record = isObject(value) ? value : {};
  const declared = Array.isArray(record.declared_changed_files)
    ? record.declared_changed_files.map((item) => String(item))
    : [];
  const currentScope = observeGitScope(root, declared, [path.relative(root, receiptPath).split(path.sep).join('/')]);
  const currentErrors: string[] = [];
  const storedScope = isObject(record.scope_observation) ? record.scope_observation : {};
  if (currentScope.availability === 'unavailable') currentErrors.push(`current_git_scope_unavailable:${currentScope.reason}`);
  if (currentScope.availability === 'observed' && !sameJson(currentScope.changed_files, storedScope.changed_files)) {
    currentErrors.push('current_git_scope_drift');
  }
  const errors = [...new Set([...artifactVerification.errors, ...currentErrors])];
  const receiptBlocked = record.truth_status === 'blocked';
  return {
    ...artifactVerification,
    receipt_path: receiptPath,
    current_scope: currentScope,
    valid: errors.length === 0,
    errors,
    truth_status: errors.length || receiptBlocked ? 'blocked' as const : 'verified' as const,
    next_action: errors.length
      ? `reject the verification closure and repair: ${errors[0]}`
      : artifactVerification.next_action
  };
}

export function isReleaseSensitivePath(file: string) {
  return RELEASE_SENSITIVE_PATTERNS.some((pattern) => pattern.test(file));
}

function observeGitScope(root: string, declaredFiles: string[], ignoredFiles: string[] = []): VerificationClosureReceipt['scope_observation'] {
  const command = 'git status --porcelain=v1 -z --untracked-files=all' as const;
  const topLevel = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    timeout: 10000,
    windowsHide: true
  });
  if (topLevel.error || topLevel.status !== 0) {
    const reason = boundedDiagnostic(topLevel.error ? message(topLevel.error) : topLevel.stderr || `git exited ${topLevel.status}`);
    return { command, availability: 'unavailable', changed_files: [], unplanned_files: [], declared_not_observed: [], reason: reason || 'Git repository root was unavailable' };
  }
  let observedRoot = '';
  try {
    observedRoot = path.resolve(String(topLevel.stdout || '').trim());
  } catch (error) {
    return { command, availability: 'unavailable', changed_files: [], unplanned_files: [], declared_not_observed: [], reason: `Git repository root parse failed: ${boundedDiagnostic(message(error))}` };
  }
  if (observedRoot !== root) {
    return { command, availability: 'unavailable', changed_files: [], unplanned_files: [], declared_not_observed: [], reason: 'root must equal the Git top-level directory so final paths remain project-confined' };
  }
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: MAX_RECEIPT_BYTES,
    timeout: 10000,
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    const reason = boundedDiagnostic(result.error ? message(result.error) : result.stderr || `git exited ${result.status}`);
    return {
      command,
      availability: 'unavailable',
      changed_files: [],
      unplanned_files: [],
      declared_not_observed: [],
      reason: reason || 'Git status was unavailable; final scope cannot be treated as clean'
    };
  }
  try {
    const fields = String(result.stdout || '').split('\0');
    if (fields.at(-1) === '') fields.pop();
    const changedFiles: string[] = [];
    for (let index = 0; index < fields.length; index += 1) {
      const row = fields[index];
      if (row.length < 4 || row[2] !== ' ') throw new Error('unexpected porcelain-v1 status record');
      const status = row.slice(0, 2);
      changedFiles.push(safeRelativePath(row.slice(3), 'Git changed path'));
      if (/[RC]/.test(status)) {
        index += 1;
        if (index >= fields.length) throw new Error('rename/copy status is missing its source path');
        changedFiles.push(safeRelativePath(fields[index], 'Git rename/copy source path'));
      }
    }
    const ignored = new Set(ignoredFiles.map((file, index) => safeRelativePath(file, `ignored_files[${index}]`)));
    const finalFiles = unique(changedFiles).filter((file) => !ignored.has(file)).sort(compareStableText);
    if (finalFiles.length > MAX_ITEMS) throw new Error(`Git scope exceeds the ${MAX_ITEMS}-path limit`);
    const declared = new Set(declaredFiles);
    const observed = new Set(finalFiles);
    return {
      command,
      availability: 'observed',
      changed_files: finalFiles,
      unplanned_files: finalFiles.filter((file) => !declared.has(file)),
      declared_not_observed: declaredFiles.filter((file) => !observed.has(file)),
      reason: 'current dirty, staged, and untracked Git paths captured before receipt write'
    };
  } catch (error) {
    return {
      command,
      availability: 'unavailable',
      changed_files: [],
      unplanned_files: [],
      declared_not_observed: [],
      reason: `Git scope parse failed: ${boundedDiagnostic(message(error))}`
    };
  }
}

function normalizeStoredObservation(value: unknown, declaredFiles: string[], errors: string[]): VerificationClosureReceipt['scope_observation'] {
  const record = isObject(value) ? value : {};
  assertRecordKeys(record, ['command', 'availability', 'changed_files', 'unplanned_files', 'declared_not_observed', 'reason'], errors, 'scope_observation');
  const command = 'git status --porcelain=v1 -z --untracked-files=all' as const;
  if (record.command !== command) errors.push('scope_command_invalid');
  const availability = record.availability === 'observed' ? 'observed' as const : 'unavailable' as const;
  if (record.availability !== 'observed' && record.availability !== 'unavailable') errors.push('scope_observation_availability_invalid');
  let changedFiles: string[] = [];
  let unplannedFiles: string[] = [];
  let declaredNotObserved: string[] = [];
  try {
    changedFiles = normalizedPathArray(record.changed_files, 'scope_observation.changed_files');
    unplannedFiles = normalizedPathArray(record.unplanned_files, 'scope_observation.unplanned_files');
    declaredNotObserved = normalizedPathArray(record.declared_not_observed, 'scope_observation.declared_not_observed');
  } catch (error) {
    errors.push(`scope_observation_invalid:${message(error)}`);
  }
  const reason = typeof record.reason === 'string' && record.reason.trim() && record.reason.length <= 1024 ? record.reason : '';
  if (!reason) errors.push('scope_observation_reason_invalid');
  if (availability === 'unavailable') {
    if (changedFiles.length || unplannedFiles.length || declaredNotObserved.length) errors.push('unavailable_scope_with_observed_paths');
  } else {
    const declared = new Set(declaredFiles);
    const observed = new Set(changedFiles);
    const expectedUnplanned = changedFiles.filter((file) => !declared.has(file));
    const expectedMissing = declaredFiles.filter((file) => !observed.has(file));
    if (!sameStringArray(unplannedFiles, expectedUnplanned)) errors.push('unplanned_files_inconsistent');
    if (!sameStringArray(declaredNotObserved, expectedMissing)) errors.push('declared_not_observed_inconsistent');
  }
  return { command, availability, changed_files: changedFiles, unplanned_files: unplannedFiles, declared_not_observed: declaredNotObserved, reason };
}

function normalizedPathArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new Error(`${label} must be an array of at most ${MAX_ITEMS} paths`);
  const paths = value.map((item, index) => safeRelativePath(item, `${label}[${index}]`));
  const normalized = unique(paths).sort(compareStableText);
  if (normalized.length !== paths.length) throw new Error(`${label} contains duplicates`);
  if (!sameStringArray(paths, normalized)) throw new Error(`${label} must use deterministic ordinal order`);
  return normalized;
}

function normalizeClosureInput(input: Record<string, unknown>) {
  const plannedScope = scopeValue(input.planned_scope);
  if (!Array.isArray(input.changed_files) || !input.changed_files.length) throw new Error('changed_files requires at least one declared path');
  if (input.changed_files.length > MAX_ITEMS) throw new Error(`changed_files accepts at most ${MAX_ITEMS} items`);
  const changedFiles = unique(input.changed_files.map((item, index) => safeRelativePath(item, `changed_files[${index}]`))).sort(compareStableText);
  if (changedFiles.length !== input.changed_files.length) throw new Error('changed_files contains duplicates');
  const selected = normalizeSelected(input.selected_commands);
  const executed = normalizeExecuted(input.executed_commands);
  const skipped = normalizeExceptions(input.skipped, 'skipped');
  const truncated = normalizeExceptions(input.truncated, 'truncated');
  const selectedById = new Map(selected.map((item) => [item.id, item]));
  const executedById = new Map(executed.map((item) => [item.id, item]));
  const skippedById = new Map(skipped.map((item) => [item.check_id, item]));
  for (const item of executed) {
    const expected = selectedById.get(item.id);
    if (!expected) throw new Error(`unknown executed command: ${item.id}`);
    if (expected.command !== item.command) throw new Error(`executed command does not match selected command: ${item.id}`);
  }
  for (const item of skipped) {
    const expected = selectedById.get(item.check_id);
    if (!expected) throw new Error(`unknown skipped command: ${item.check_id}`);
    if (expected.required) throw new Error(`required selected command cannot be skipped: ${item.check_id}`);
    if (executedById.has(item.check_id)) throw new Error(`command cannot be both executed and skipped: ${item.check_id}`);
  }
  for (const item of truncated) {
    if (!executedById.has(item.check_id)) throw new Error(`truncated output must name an executed command: ${item.check_id}`);
  }
  for (const item of selected) {
    if (item.required && !executedById.has(item.id)) throw new Error(`selected required command was not executed: ${item.id}`);
    if (!item.required && !executedById.has(item.id) && !skippedById.has(item.id)) {
      throw new Error(`unexecuted optional command requires a skipped reason: ${item.id}`);
    }
  }
  return {
    planned_scope: plannedScope,
    changed_files: changedFiles,
    selected_commands: selected,
    executed_commands: executed,
    skipped,
    truncated
  };
}

function normalizeSelected(value: unknown): SelectedVerificationCommand[] {
  if (!Array.isArray(value) || !value.length) throw new Error('selected_commands requires at least one command');
  if (value.length > MAX_ITEMS) throw new Error(`selected_commands accepts at most ${MAX_ITEMS} items`);
  const rows = value.map((item, index) => {
    assertExactKeys(item, ['id', 'command', 'scope', 'required'], `selected_commands[${index}]`);
    const record = item as Record<string, unknown>;
    return {
      id: idValue(record.id, `selected_commands[${index}].id`),
      command: commandValue(record.command, `selected_commands[${index}].command`),
      scope: scopeValue(record.scope),
      required: booleanValue(record.required, `selected_commands[${index}].required`)
    };
  });
  assertUnique(rows.map((item) => item.id), 'selected command id');
  return rows.sort((left, right) => compareStableText(left.id, right.id));
}

function normalizeExecuted(value: unknown): ExecutedVerificationCommand[] {
  if (!Array.isArray(value)) throw new Error('executed_commands must be an array');
  if (value.length > MAX_ITEMS) throw new Error(`executed_commands accepts at most ${MAX_ITEMS} items`);
  const rows = value.map((item, index) => {
    assertExactKeys(item, ['id', 'command', 'exit_code', 'evidence'], `executed_commands[${index}]`);
    const record = item as Record<string, unknown>;
    const exitCode = record.exit_code;
    if (typeof exitCode !== 'number' || !Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255) {
      throw new Error(`executed_commands[${index}].exit_code must be an integer from 0 to 255`);
    }
    return {
      id: idValue(record.id, `executed_commands[${index}].id`),
      command: commandValue(record.command, `executed_commands[${index}].command`),
      exit_code: exitCode,
      evidence: boundedText(record.evidence, `executed_commands[${index}].evidence`, 1024)
    };
  });
  assertUnique(rows.map((item) => item.id), 'executed command id');
  return rows.sort((left, right) => compareStableText(left.id, right.id));
}

function normalizeExceptions(value: unknown, label: string): VerificationCommandException[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > MAX_ITEMS) throw new Error(`${label} accepts at most ${MAX_ITEMS} items`);
  const rows = value.map((item, index) => {
    assertExactKeys(item, ['check_id', 'reason'], `${label}[${index}]`);
    const record = item as Record<string, unknown>;
    return {
      check_id: idValue(record.check_id, `${label}[${index}].check_id`),
      reason: boundedText(record.reason, `${label}[${index}].reason`, 1024)
    };
  });
  assertUnique(rows.map((item) => item.check_id), `${label} check id`);
  return rows.sort((left, right) => compareStableText(left.check_id, right.check_id));
}

function scopeValue(value: unknown, errors?: string[], label = 'scope'): VerificationScope {
  if (value === 'affected' || value === 'release') return value;
  if (errors) {
    errors.push(`${label}_invalid`);
    return 'affected';
  }
  throw new Error(`${label} must be affected or release`);
}

function idValue(value: unknown, label: string) {
  const text = String(value || '');
  if (!ID_PATTERN.test(text)) throw new Error(`${label} is invalid`);
  return text;
}

function commandValue(value: unknown, label: string) {
  const text = boundedText(value, label, 2048);
  if (/[\r\n\u0000]/.test(String(value || ''))) throw new Error(`${label} must be a single bounded command line`);
  return text;
}

function booleanValue(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
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

async function resolveReceiptPath(root: string, value: unknown, mustExist: boolean) {
  const relative = safeRelativePath(value, 'receipt_path');
  if (!relative.startsWith('.yam/verification/') || !relative.endsWith('.json')) {
    throw new Error('receipt_path must be a JSON file under .yam/verification/');
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
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('receipt parent escapes the project root');
  const identities: Array<{ path: string; dev: number | bigint; ino: number | bigint }> = [];
  let current = root;
  const rootStat = await fsp.lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('project root identity is not a regular directory');
  identities.push({ path: '.', dev: rootStat.dev, ino: rootStat.ino });
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await fsp.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`receipt parent must be a regular non-symlink directory: ${current}`);
    identities.push({ path: path.relative(root, current), dev: stat.dev, ino: stat.ino });
  }
  return identities;
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
      throw new Error('verification receipt identity changed while writing');
    }
    if (!sameParentIdentity(parentsBefore, parentsAfter)) throw new Error('verification receipt parent path identity changed while writing');
  } finally {
    await handle.close();
  }
}

async function readBoundedJson(root: string, file: string) {
  const parentsBefore = await captureParentIdentity(root, path.dirname(file));
  const before = await fsp.lstat(file);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('verification receipt must be a regular non-symlink file');
  if (before.size > MAX_RECEIPT_BYTES) throw new Error('verification receipt exceeds the 1 MiB limit');
  const noFollow = process.platform !== 'win32' && typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  const handle = await fsp.open(file, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(before, opened)) throw new Error('verification receipt identity changed before open');
    if (opened.size > MAX_RECEIPT_BYTES) throw new Error('verification receipt exceeds the 1 MiB limit');
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('verification receipt became shorter while reading');
      offset += bytesRead;
    }
    const openedAfter = await handle.stat();
    const after = await fsp.lstat(file);
    const parentsAfter = await captureParentIdentity(root, path.dirname(file));
    if (!sameIdentity(opened, openedAfter) || openedAfter.size !== opened.size
      || after.isSymbolicLink() || !after.isFile() || !sameIdentity(opened, after)) {
      throw new Error('verification receipt changed size or identity while reading');
    }
    if (!sameParentIdentity(parentsBefore, parentsAfter)) throw new Error('verification receipt parent path identity changed while reading');
    return JSON.parse(bytes.toString('utf8'));
  } finally {
    await handle.close();
  }
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

function boundedText(value: unknown, label: string, max: number) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`${label} must contain 1-${max} characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error(`${label} contains control characters`);
  return text;
}

function boundedDiagnostic(value: unknown) {
  return String(value || '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 1024);
}

function assertExactKeys(value: unknown, expected: string[], label: string) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort(compareStableText);
  const wanted = [...expected].sort(compareStableText);
  if (!sameStringArray(actual, wanted)) throw new Error(`${label} keys must be exactly: ${wanted.join(', ')}`);
}

function assertRecordKeys(record: Record<string, unknown>, expected: string[], errors: string[], label: string) {
  const actual = Object.keys(record).sort(compareStableText);
  const wanted = [...expected].sort(compareStableText);
  if (!sameStringArray(actual, wanted)) errors.push(`${label}_keys_invalid`);
}

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function sameStringArray(value: unknown, expected: string[]) {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function sameJson(left: unknown, right: unknown) {
  return stableJson(left) === stableJson(right);
}

function isObject(value: unknown): value is Record<string, unknown> {
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
