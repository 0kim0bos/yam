import { createHash } from 'node:crypto';

export type NextStepKind = 'fix_first' | 'planned';
export type NextStepEvidenceLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type NextStepTruthStatus =
  | 'proven'
  | 'verified'
  | 'partial'
  | 'fixture_only'
  | 'fixture_instrumented_real'
  | 'integration_optional'
  | 'real_required_missing'
  | 'skipped'
  | 'blocked'
  | 'assumed';
export type NextStepOwnerRoute = '$quick' | '$ueye' | '$question' | '$scout' | '$deep' | '$mission';

export interface NextStepItemInput {
  kind?: NextStepKind;
  action?: string;
  why?: string;
  owner_route?: string;
  owner_scope?: string[];
  blocked_by?: string[];
  safe_retry?: string;
  side_effects?: string[];
}

export interface NextStepInput {
  current_situation?: string;
  forward_outlook?: string;
  critical_opinion?: string;
  improvement_recommendations?: string[];
  steps?: NextStepItemInput[];
  evidence_level?: NextStepEvidenceLevel;
  evidence_stamp?: string;
  truth_status?: NextStepTruthStatus;
}

export interface NextStepReceipt {
  schema: 'yam.next-step.v1';
  scan: {
    current_situation: string;
    forward_outlook: string;
    critical_opinion: string;
    improvement_recommendations: string[];
  };
  steps: Array<{
    order: number;
    kind: NextStepKind;
    action: string;
    why: string;
    owner_route: NextStepOwnerRoute;
    owner_scope: string[];
    blocked_by: string[];
    safe_retry: string;
    side_effects: string[];
  }>;
  evidence: {
    level: NextStepEvidenceLevel;
    stamp: string;
  };
  contract_valid: boolean;
  contract_errors: string[];
  truth_status: NextStepTruthStatus;
  digest: string;
}

const MAX_STEPS = 12;
const MAX_LIST_ITEMS = 8;
const MAX_CONTRACT_ERRORS = 64;
const EVIDENCE_LEVELS = new Set<NextStepEvidenceLevel>(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
const EVIDENCE_RANK: Record<NextStepEvidenceLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };
const STEP_KINDS = new Set<NextStepKind>(['fix_first', 'planned']);
const TRUTH_STATUSES = new Set<NextStepTruthStatus>([
  'proven',
  'verified',
  'partial',
  'fixture_only',
  'fixture_instrumented_real',
  'integration_optional',
  'real_required_missing',
  'skipped',
  'blocked',
  'assumed'
]);
const OWNER_ROUTES = new Set<NextStepOwnerRoute>(['$quick', '$ueye', '$question', '$scout', '$deep', '$mission']);
const INPUT_KEYS = ['current_situation', 'forward_outlook', 'critical_opinion', 'improvement_recommendations', 'steps', 'evidence_level', 'evidence_stamp', 'truth_status'];
const STEP_INPUT_KEYS = ['kind', 'action', 'why', 'owner_route', 'owner_scope', 'blocked_by', 'safe_retry', 'side_effects'];
const TOP_LEVEL_KEYS = ['schema', 'scan', 'steps', 'evidence', 'contract_valid', 'contract_errors', 'truth_status', 'digest'];
const SCAN_KEYS = ['current_situation', 'forward_outlook', 'critical_opinion', 'improvement_recommendations'];
const STEP_KEYS = ['order', 'kind', 'action', 'why', 'owner_route', 'owner_scope', 'blocked_by', 'safe_retry', 'side_effects'];
const EVIDENCE_KEYS = ['level', 'stamp'];

export function buildNextStep(input: NextStepInput = {}): NextStepReceipt {
  const errors: string[] = [];
  const source = isRecord(input) ? input as NextStepInput : {};
  if (!isRecord(input)) errors.push('input_invalid');
  else unexpectedKeys(input, INPUT_KEYS, 'input', errors);
  const currentSituation = requiredText(source.current_situation, 'current_situation', 1200, errors);
  const forwardOutlook = requiredText(source.forward_outlook, 'forward_outlook', 1200, errors);
  const criticalOpinion = requiredText(source.critical_opinion, 'critical_opinion', 1200, errors);
  const improvementRecommendations = textList(
    source.improvement_recommendations,
    'improvement_recommendations',
    MAX_LIST_ITEMS,
    600,
    true,
    errors
  );

  const rawSteps = Array.isArray(source.steps) ? source.steps : [];
  if (!Array.isArray(source.steps) || !rawSteps.length) errors.push('steps_missing');
  if (rawSteps.length > MAX_STEPS) errors.push('step_limit_exceeded');
  let plannedSeen = false;
  const steps = rawSteps.slice(0, MAX_STEPS).map((value, index) => {
    const step = isRecord(value) ? value as NextStepItemInput : {};
    if (!isRecord(value)) errors.push(`steps[${index}]_invalid`);
    else unexpectedKeys(value, STEP_INPUT_KEYS, `steps[${index}]`, errors);
    const rawKind = normalizedText(step.kind, 32);
    const kind = STEP_KINDS.has(rawKind as NextStepKind) ? rawKind as NextStepKind : 'planned';
    if (!STEP_KINDS.has(rawKind as NextStepKind)) errors.push(`steps[${index}].kind_invalid`);
    if (kind === 'planned') plannedSeen = true;
    if (kind === 'fix_first' && plannedSeen) errors.push(`steps[${index}].fix_first_out_of_order`);

    const rawRoute = normalizedText(step.owner_route, 32).toLowerCase();
    const routeWithSigil = rawRoute && !rawRoute.startsWith('$') ? `$${rawRoute}` : rawRoute;
    const ownerRoute = OWNER_ROUTES.has(routeWithSigil as NextStepOwnerRoute)
      ? routeWithSigil as NextStepOwnerRoute
      : '$quick';
    if (!OWNER_ROUTES.has(routeWithSigil as NextStepOwnerRoute)) errors.push(`steps[${index}].owner_route_invalid`);

    const blockedBy = textList(step.blocked_by, `steps[${index}].blocked_by`, MAX_LIST_ITEMS, 500, false, errors);
    if (step.safe_retry !== undefined && typeof step.safe_retry !== 'string') {
      errors.push(`steps[${index}].safe_retry_invalid`);
    }
    const suppliedSafeRetry = normalizedText(step.safe_retry, 800);
    if (normalizedLength(step.safe_retry) > 800) errors.push(`steps[${index}].safe_retry_too_long`);
    if (blockedBy.length && !suppliedSafeRetry) errors.push(`steps[${index}].safe_retry_missing`);
    const safeRetry = suppliedSafeRetry || 'not required; confirm the recorded evidence is still current before execution';

    return {
      order: index + 1,
      kind,
      action: requiredText(step.action, `steps[${index}].action`, 800, errors),
      why: requiredText(step.why, `steps[${index}].why`, 800, errors),
      owner_route: ownerRoute,
      owner_scope: textList(step.owner_scope, `steps[${index}].owner_scope`, MAX_LIST_ITEMS, 300, true, errors),
      blocked_by: blockedBy,
      safe_retry: safeRetry,
      side_effects: textList(step.side_effects, `steps[${index}].side_effects`, MAX_LIST_ITEMS, 500, true, errors)
    };
  });
  const actions = steps.map((step) => step.action).filter(Boolean);
  if (new Set(actions).size !== actions.length) errors.push('duplicate_step_action');

  const rawEvidenceLevel = normalizedText(source.evidence_level, 8);
  const evidenceLevel = EVIDENCE_LEVELS.has(rawEvidenceLevel as NextStepEvidenceLevel)
    ? rawEvidenceLevel as NextStepEvidenceLevel
    : 'L0';
  if (!EVIDENCE_LEVELS.has(rawEvidenceLevel as NextStepEvidenceLevel)) errors.push('evidence_level_invalid');
  const evidenceStamp = requiredText(source.evidence_stamp, 'evidence_stamp', 512, errors);
  const rawTruthStatus = normalizedText(source.truth_status, 48);
  const requestedTruth = TRUTH_STATUSES.has(rawTruthStatus as NextStepTruthStatus)
    ? rawTruthStatus as NextStepTruthStatus
    : 'assumed';
  if (!TRUTH_STATUSES.has(rawTruthStatus as NextStepTruthStatus)) errors.push('truth_status_invalid');

  const hasBlockers = steps.some((step) => step.blocked_by.length > 0);
  if (hasBlockers && requestedTruth !== 'blocked') errors.push('truth_status_contradicts_blockers');
  if (!hasBlockers && requestedTruth === 'blocked') errors.push('blocked_truth_without_blocker');
  if (requestedTruth === 'verified' && EVIDENCE_RANK[evidenceLevel] < EVIDENCE_RANK.L2) {
    errors.push('verified_truth_requires_l2_evidence');
  }
  if (requestedTruth === 'proven' && EVIDENCE_RANK[evidenceLevel] < EVIDENCE_RANK.L4) {
    errors.push('proven_truth_requires_l4_evidence');
  }

  const contractErrors = boundedContractErrors(errors);
  const contractValid = contractErrors.length === 0;
  const truthStatus: NextStepTruthStatus = contractValid
    ? hasBlockers ? 'blocked' : requestedTruth
    : 'blocked';
  const canonical = {
    schema: 'yam.next-step.v1' as const,
    scan: {
      current_situation: currentSituation,
      forward_outlook: forwardOutlook,
      critical_opinion: criticalOpinion,
      improvement_recommendations: improvementRecommendations
    },
    steps,
    evidence: { level: evidenceLevel, stamp: evidenceStamp },
    contract_valid: contractValid,
    contract_errors: contractErrors,
    truth_status: truthStatus
  };
  return {
    ...canonical,
    digest: digest(canonical)
  };
}

export function verifyNextStep(value: unknown) {
  const errors: string[] = [];
  const record = isRecord(value) ? value : {};
  exactKeys(record, TOP_LEVEL_KEYS, 'receipt', errors);
  if (record.schema !== 'yam.next-step.v1') errors.push('schema_invalid');

  const scan = isRecord(record.scan) ? record.scan : {};
  if (!isRecord(record.scan)) errors.push('scan_invalid');
  exactKeys(scan, SCAN_KEYS, 'scan', errors);
  validateText(scan.current_situation, 'current_situation', 1200, errors);
  validateText(scan.forward_outlook, 'forward_outlook', 1200, errors);
  validateText(scan.critical_opinion, 'critical_opinion', 1200, errors);
  validateTextList(scan.improvement_recommendations, 'improvement_recommendations', MAX_LIST_ITEMS, 600, true, errors);

  const steps = Array.isArray(record.steps) ? record.steps : [];
  if (!Array.isArray(record.steps) || !steps.length) errors.push('steps_missing');
  if (steps.length > MAX_STEPS) errors.push('step_limit_exceeded');
  let plannedSeen = false;
  let hasBlockers = false;
  const actions: string[] = [];
  for (const [index, value] of steps.entries()) {
    const step = isRecord(value) ? value : {};
    if (!isRecord(value)) errors.push(`steps[${index}]_invalid`);
    exactKeys(step, STEP_KEYS, `steps[${index}]`, errors);
    if (step.order !== index + 1) errors.push(`steps[${index}].order_invalid`);
    if (!STEP_KINDS.has(step.kind as NextStepKind)) errors.push(`steps[${index}].kind_invalid`);
    if (step.kind === 'planned') plannedSeen = true;
    if (step.kind === 'fix_first' && plannedSeen) errors.push(`steps[${index}].fix_first_out_of_order`);
    validateText(step.action, `steps[${index}].action`, 800, errors);
    validateText(step.why, `steps[${index}].why`, 800, errors);
    if (typeof step.action === 'string' && step.action) actions.push(step.action);
    if (!OWNER_ROUTES.has(step.owner_route as NextStepOwnerRoute)) errors.push(`steps[${index}].owner_route_invalid`);
    validateTextList(step.owner_scope, `steps[${index}].owner_scope`, MAX_LIST_ITEMS, 300, true, errors);
    validateTextList(step.blocked_by, `steps[${index}].blocked_by`, MAX_LIST_ITEMS, 500, false, errors);
    validateText(step.safe_retry, `steps[${index}].safe_retry`, 800, errors);
    validateTextList(step.side_effects, `steps[${index}].side_effects`, MAX_LIST_ITEMS, 500, true, errors);
    const blockedBy = Array.isArray(step.blocked_by) ? step.blocked_by : [];
    if (blockedBy.length) hasBlockers = true;
  }
  if (new Set(actions).size !== actions.length) errors.push('duplicate_step_action');

  const evidence = isRecord(record.evidence) ? record.evidence : {};
  if (!isRecord(record.evidence)) errors.push('evidence_invalid');
  exactKeys(evidence, EVIDENCE_KEYS, 'evidence', errors);
  if (!EVIDENCE_LEVELS.has(evidence.level as NextStepEvidenceLevel)) errors.push('evidence_level_invalid');
  validateText(evidence.stamp, 'evidence_stamp', 512, errors);
  if (!TRUTH_STATUSES.has(record.truth_status as NextStepTruthStatus)) errors.push('truth_status_invalid');
  if (hasBlockers && record.truth_status !== 'blocked') errors.push('truth_status_contradicts_blockers');
  if (!hasBlockers && record.truth_status === 'blocked' && record.contract_valid === true) errors.push('blocked_truth_without_blocker');
  if (record.truth_status === 'verified' && EVIDENCE_RANK[evidence.level as NextStepEvidenceLevel] < EVIDENCE_RANK.L2) {
    errors.push('verified_truth_requires_l2_evidence');
  }
  if (record.truth_status === 'proven' && EVIDENCE_RANK[evidence.level as NextStepEvidenceLevel] < EVIDENCE_RANK.L4) {
    errors.push('proven_truth_requires_l4_evidence');
  }

  const contractErrors = Array.isArray(record.contract_errors) ? record.contract_errors : [];
  if (!Array.isArray(record.contract_errors) || contractErrors.some((item) => typeof item !== 'string' || !item)) {
    errors.push('contract_errors_invalid');
  }
  if (contractErrors.length > MAX_CONTRACT_ERRORS) errors.push('contract_error_limit_exceeded');
  if (typeof record.contract_valid !== 'boolean') errors.push('contract_valid_missing');
  if (record.contract_valid === true && contractErrors.length) errors.push('contract_valid_with_errors');
  if (record.contract_valid === false) errors.push('receipt_contract_invalid');

  const canonical = {
    schema: record.schema,
    scan: record.scan,
    steps: record.steps,
    evidence: record.evidence,
    contract_valid: record.contract_valid,
    contract_errors: record.contract_errors,
    truth_status: record.truth_status
  };
  const expectedDigest = digest(canonical);
  if (typeof record.digest !== 'string' || record.digest !== expectedDigest) errors.push('digest_invalid');
  const uniqueErrors = [...new Set(errors)];
  return {
    schema: 'yam.next-step-verification.v1' as const,
    valid: uniqueErrors.length === 0,
    errors: uniqueErrors,
    receipt_truth_status: TRUTH_STATUSES.has(record.truth_status as NextStepTruthStatus)
      ? record.truth_status as NextStepTruthStatus
      : 'blocked' as const,
    truth_status: uniqueErrors.length ? 'blocked' as const : 'verified' as const,
    next_action: uniqueErrors.length
      ? `reject the Next step receipt and repair: ${uniqueErrors[0]}`
      : 'retain the digest with the final report and execute steps in order'
  };
}

function requiredText(value: unknown, label: string, max: number, errors: string[]) {
  if (typeof value !== 'string') {
    errors.push(`${label}_invalid`);
    return '';
  }
  const text = normalizedText(value, max);
  if (!text) errors.push(`${label}_missing`);
  if (normalizedLength(value) > max) errors.push(`${label}_too_long`);
  return text;
}

function textList(
  value: unknown,
  label: string,
  maxItems: number,
  maxChars: number,
  required: boolean,
  errors: string[]
) {
  const items = Array.isArray(value) ? value : [];
  if (!Array.isArray(value) && value !== undefined) errors.push(`${label}_invalid`);
  if (items.length > maxItems) errors.push(`${label}_limit_exceeded`);
  const normalized = items.slice(0, maxItems).map((item, index) => requiredText(item, `${label}[${index}]`, maxChars, errors)).filter(Boolean);
  const unique = [...new Set(normalized)];
  if (unique.length !== normalized.length) errors.push(`${label}_duplicate`);
  if (required && !unique.length) errors.push(`${label}_missing`);
  return unique;
}

function validateText(value: unknown, label: string, max: number, errors: string[]) {
  if (typeof value !== 'string' || !value || value !== normalizedText(value, max)) errors.push(`${label}_invalid`);
  if (typeof value === 'string' && value.length > max) errors.push(`${label}_too_long`);
}

function validateTextList(
  value: unknown,
  label: string,
  maxItems: number,
  maxChars: number,
  required: boolean,
  errors: string[]
) {
  if (!Array.isArray(value)) {
    errors.push(`${label}_invalid`);
    return;
  }
  if (value.length > maxItems) errors.push(`${label}_limit_exceeded`);
  if (required && !value.length) errors.push(`${label}_missing`);
  for (const [index, item] of value.entries()) validateText(item, `${label}[${index}]`, maxChars, errors);
  if (new Set(value).size !== value.length) errors.push(`${label}_duplicate`);
}

function exactKeys(record: Record<string, unknown>, expected: string[], label: string, errors: string[]) {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(record)) {
    if (!expectedSet.has(key)) errors.push(`${label}_unexpected_key:${key}`);
  }
  for (const key of expected) {
    if (!(key in record)) errors.push(`${label}_missing_key:${key}`);
  }
}

function unexpectedKeys(record: Record<string, unknown>, allowed: string[], label: string, errors: string[]) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) errors.push(`${label}_unexpected_key:${key}`);
  }
}

function boundedContractErrors(errors: string[]) {
  const unique = [...new Set(errors)];
  if (unique.length <= MAX_CONTRACT_ERRORS) return unique;
  return [...unique.slice(0, MAX_CONTRACT_ERRORS - 1), 'contract_error_limit_exceeded'];
}

function normalizedLength(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().length
    : 0;
}

function normalizedText(value: unknown, max: number) {
  return typeof value === 'string'
    ? value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function digest(value: unknown) {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
