import { createHash } from 'node:crypto';

export type GateBoundary = 'release' | 'update' | 'mission' | 'generic';
export type GateCheckStatus = 'passed' | 'failed' | 'skipped';

export interface GateCheckInput {
  id?: string;
  status?: GateCheckStatus;
  note?: string;
  required?: boolean;
}

export interface StrictGateInput {
  gate_id?: string;
  boundary?: GateBoundary;
  checks?: GateCheckInput[];
  blockers?: string[];
  evidence?: string[];
  next_action?: string;
}

export interface StrictGateResult {
  schema: 'yam.gate-result.v1';
  generated_at: string;
  gate_id: string;
  boundary: GateBoundary;
  status: 'passed' | 'failed';
  checks: Array<{
    id: string;
    status: GateCheckStatus;
    note: string;
    required: boolean;
  }>;
  blockers: string[];
  evidence: string[];
  next_action: string;
  contract_valid: boolean;
  contract_errors: string[];
  digest: string;
  truth_status: 'verified' | 'blocked';
}

const GATE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const BOUNDARIES = new Set<GateBoundary>(['release', 'update', 'mission', 'generic']);
const CHECK_STATUSES = new Set<GateCheckStatus>(['passed', 'failed', 'skipped']);

export function buildStrictGateResult(input: StrictGateInput = {}): StrictGateResult {
  const gateId = boundedText(input.gate_id || '', 96);
  const boundary = BOUNDARIES.has(input.boundary as GateBoundary) ? input.boundary as GateBoundary : 'generic';
  const contractErrors: string[] = [];
  if (!GATE_ID_PATTERN.test(gateId)) contractErrors.push('gate_id_invalid');
  if (!BOUNDARIES.has(input.boundary as GateBoundary)) contractErrors.push('boundary_invalid');
  if (Array.isArray(input.checks) && input.checks.length > 128) contractErrors.push('check_limit_exceeded');
  if (Array.isArray(input.blockers) && input.blockers.length > 64) contractErrors.push('blocker_limit_exceeded');
  if (Array.isArray(input.evidence) && input.evidence.length > 128) contractErrors.push('evidence_limit_exceeded');

  const checks = Array.isArray(input.checks) ? input.checks.slice(0, 128).map((check, index) => {
    const id = boundedText(check?.id || '', 96);
    const status = CHECK_STATUSES.has(check?.status as GateCheckStatus) ? check?.status as GateCheckStatus : 'failed';
    if (!GATE_ID_PATTERN.test(id)) contractErrors.push(`check_id_invalid:${index}`);
    if (!CHECK_STATUSES.has(check?.status as GateCheckStatus)) contractErrors.push(`check_status_invalid:${id || index}`);
    return {
      id,
      status,
      note: boundedText(check?.note || '', 512),
      required: check?.required !== false
    };
  }) : [];
  if (!checks.length) contractErrors.push('checks_missing');
  const checkIds = checks.map((check) => check.id).filter(Boolean);
  if (new Set(checkIds).size !== checkIds.length) contractErrors.push('duplicate_check_id');

  const blockers = uniqueBounded(input.blockers, 64, 512);
  const evidence = uniqueBounded(input.evidence, 128, 512);
  if (!evidence.length) contractErrors.push('evidence_missing');
  for (const check of checks) {
    if (check.required && check.status !== 'passed') blockers.push(`${check.id || 'unnamed_check'}: ${check.note || 'required gate check did not pass'}`);
  }
  for (const error of contractErrors) blockers.push(`gate_contract_invalid: ${error}`);
  const finalBlockers = [...new Set(blockers)];
  const contractValid = contractErrors.length === 0;
  const passed = contractValid && finalBlockers.length === 0;
  const generatedAt = new Date().toISOString();
  const nextAction = boundedText(input.next_action || finalBlockers[0] || 'gate passed; retain the evidence digest with the dependent completion claim', 512);
  const uniqueContractErrors = [...new Set(contractErrors)];
  const truthStatus = passed ? 'verified' as const : 'blocked' as const;
  const canonical = {
    schema: 'yam.gate-result.v1',
    generated_at: generatedAt,
    gate_id: gateId,
    boundary,
    status: passed ? 'passed' : 'failed',
    checks,
    blockers: finalBlockers,
    evidence,
    next_action: nextAction,
    contract_valid: contractValid,
    contract_errors: uniqueContractErrors,
    truth_status: truthStatus
  };
  return {
    schema: 'yam.gate-result.v1',
    generated_at: generatedAt,
    gate_id: gateId,
    boundary,
    status: passed ? 'passed' : 'failed',
    checks,
    blockers: finalBlockers,
    evidence,
    next_action: nextAction,
    contract_valid: contractValid,
    contract_errors: uniqueContractErrors,
    digest: `sha256:${createHash('sha256').update(stableJson(canonical)).digest('hex')}`,
    truth_status: truthStatus
  };
}

export function verifyStrictGateResult(value: unknown) {
  const errors: string[] = [];
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (record.schema !== 'yam.gate-result.v1') errors.push('schema_invalid');
  if (typeof record.generated_at !== 'string' || !isIsoDate(record.generated_at)) errors.push('generated_at_invalid');
  if (!GATE_ID_PATTERN.test(String(record.gate_id || ''))) errors.push('gate_id_invalid');
  if (!BOUNDARIES.has(record.boundary as GateBoundary)) errors.push('boundary_invalid');
  if (!['passed', 'failed'].includes(String(record.status || ''))) errors.push('status_invalid');
  const checks = Array.isArray(record.checks) ? record.checks : [];
  const blockers = Array.isArray(record.blockers) ? record.blockers : [];
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  const contractErrors = Array.isArray(record.contract_errors) ? record.contract_errors : [];
  if (!checks.length) errors.push('checks_missing');
  if (checks.length > 128) errors.push('check_limit_exceeded');
  if (blockers.length > 64) errors.push('blocker_limit_exceeded');
  if (evidence.length > 128) errors.push('evidence_limit_exceeded');
  if (!Array.isArray(record.blockers) || blockers.some((item) => typeof item !== 'string')) errors.push('blockers_invalid');
  if (!Array.isArray(record.evidence) || !evidence.length || evidence.some((item) => typeof item !== 'string' || !item.trim())) errors.push('evidence_missing');
  if (typeof record.contract_valid !== 'boolean') errors.push('contract_valid_missing');
  if (!Array.isArray(record.contract_errors) || contractErrors.some((item) => typeof item !== 'string')) errors.push('contract_errors_invalid');
  if (record.contract_valid === true && contractErrors.length) errors.push('contract_valid_with_errors');
  if (record.contract_valid === false && !contractErrors.length) errors.push('contract_invalid_without_errors');
  if (record.status === 'passed' && record.contract_valid !== true) errors.push('passed_with_invalid_contract');
  if (typeof record.next_action !== 'string' || !record.next_action.trim()) errors.push('next_action_missing');
  if (!['verified', 'blocked'].includes(String(record.truth_status || ''))) errors.push('truth_status_invalid');
  if (record.status === 'passed' && record.truth_status !== 'verified') errors.push('passed_truth_mismatch');
  if (record.status === 'failed' && record.truth_status !== 'blocked') errors.push('failed_truth_mismatch');
  for (const [index, check] of checks.entries()) {
    if (!check || typeof check !== 'object') {
      errors.push(`check_invalid:${index}`);
      continue;
    }
    const row = check as Record<string, unknown>;
    if (!GATE_ID_PATTERN.test(String(row.id || ''))) errors.push(`check_id_invalid:${index}`);
    if (!CHECK_STATUSES.has(row.status as GateCheckStatus)) errors.push(`check_status_invalid:${index}`);
    if (typeof row.note !== 'string') errors.push(`check_note_invalid:${index}`);
    if (typeof row.required !== 'boolean') errors.push(`check_required_invalid:${index}`);
  }
  const checkIds = checks
    .filter((check) => check && typeof check === 'object')
    .map((check) => String((check as Record<string, unknown>).id || ''))
    .filter(Boolean);
  if (new Set(checkIds).size !== checkIds.length) errors.push('duplicate_check_id');
  if (record.status === 'passed' && Array.isArray(record.blockers) && record.blockers.length > 0) errors.push('passed_with_blockers');
  if (record.status === 'passed' && checks.length) {
    const failedRequired = checks.some((check) => {
      if (!check || typeof check !== 'object') return true;
      const row = check as Record<string, unknown>;
      return row.required !== false && row.status !== 'passed';
    });
    if (failedRequired) errors.push('passed_with_failed_required_check');
  }
  if (record.status === 'failed') {
    const hasFailedRequired = checks.some((check) => {
      if (!check || typeof check !== 'object') return false;
      const row = check as Record<string, unknown>;
      return row.required !== false && row.status !== 'passed';
    });
    if (record.contract_valid === true && blockers.length === 0 && !hasFailedRequired) errors.push('failed_without_blocker_or_failed_check');
  }
  const canonical = {
    schema: record.schema,
    generated_at: record.generated_at,
    gate_id: String(record.gate_id || ''),
    boundary: record.boundary,
    status: record.status,
    checks,
    blockers,
    evidence,
    next_action: record.next_action,
    contract_valid: record.contract_valid,
    contract_errors: contractErrors,
    truth_status: record.truth_status
  };
  const expectedDigest = `sha256:${createHash('sha256').update(stableJson(canonical)).digest('hex')}`;
  if (typeof record.digest !== 'string' || record.digest !== expectedDigest) errors.push('digest_invalid');
  return {
    schema: 'yam.gate-result-verification.v1' as const,
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    truth_status: errors.length ? 'blocked' as const : 'verified' as const,
    next_action: errors.length ? `reject the gate result and repair: ${errors[0]}` : 'gate result contract is structurally valid'
  };
}

function isIsoDate(value: string) {
  return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function uniqueBounded(value: unknown, maxItems: number, maxChars: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => boundedText(item, maxChars)).filter(Boolean))].slice(0, maxItems);
}

function boundedText(value: unknown, max: number) {
  return String(value || '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
