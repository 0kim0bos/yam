import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';

export const SECURITY_STATUSES = ['passed', 'needs_improvement', 'failed', 'unverified', 'not_applicable'] as const;
export type SecurityStatus = typeof SECURITY_STATUSES[number];
export type SecurityStage = 'commit' | 'push' | 'deploy';
export const SEC_AREAS = {
  'SEC-01': '사용자·관리자·외부 서비스·DB·파일 사이의 신뢰 경계와 보호할 데이터·작업을 식별한다.',
  'SEC-02': '명시적으로 허용한 접근만 열고, 사용자·서비스 계정에 필요한 최소 권한만 부여한다.',
  'SEC-03': '화면을 우회한 API·서버 함수·DB·파일·백그라운드 작업에서도 사용자·조직·대상별 권한을 확인한다.',
  'SEC-04': '계정 정지·승인 철회·탈퇴·소속 변경 후 기존 세션·토큰·캐시에서도 권한 회수가 반영된다.',
  'SEC-05': '코드의 보안 정책·migration·ACL·환경 설정이 대상 배포 환경의 실제 상태와 일치한다.',
  'SEC-06': '로그인·관리자 인증·세션 만료·로그아웃·비밀번호 재설정·계정 복구가 계정 탈취를 막도록 동작한다.',
  'SEC-07': '외부 입력·파일 업로드·출력의 형식·크기·경로를 검증하고 SQL 주입·XSS·SSRF·CSRF 등 해당 공격을 방어한다.',
  'SEC-08': 'API 키·토큰·개인키·개인정보가 코드·브라우저 번들·로그·점검 기록에 불필요하게 노출되지 않는다.',
  'SEC-09': '의존성·CI/CD 권한·배포 자격증명·릴리스 산출물의 출처와 무결성을 확인해 공급망 위험을 통제한다.'
} as const;
export const SECURITY_AREA_IDS = Object.keys(SEC_AREAS) as Array<keyof typeof SEC_AREAS>;
export const STATUS_KO: Record<SecurityStatus, string> = {
  passed: '점검 완료 - 이상 없음', needs_improvement: '점검 완료 - 보완 필요', failed: '점검 실패',
  unverified: '미검증', not_applicable: '해당 없음'
};

export interface SecurityPolicy { version?: string; required_at?: Partial<Record<keyof typeof SEC_AREAS, SecurityStage[]>>; required?: string[]; digest?: string; }
export interface SecurityBinding { stage: SecurityStage; [key: string]: unknown }
export interface SecurityEvidence { reference: string; sha256: string; checker: string; checked_at: string; result?: string; }
export interface SecurityAreaRecord { id: keyof typeof SEC_AREAS; explanation: string; status: SecurityStatus; required_at: SecurityStage[]; evidence?: SecurityEvidence[]; reason?: string; finding?: string; severity?: string; owner?: string; follow_up?: string; mitigation?: string; }
export interface SecurityCheckInput { run_id?: string; time?: string; stage: SecurityStage; policy?: SecurityPolicy; policy_digest?: string; binding: SecurityBinding; environment: string; scope: string[]; checker: string; areas?: SecurityAreaRecord[]; evidence?: SecurityEvidence[]; retry_of?: string; }
export interface SecurityCheckResult { schema: 'yam.security-check-result.v1'; run_id: string; time: string; stage: SecurityStage; policy: SecurityPolicy; policy_digest: string; binding: SecurityBinding; environment: string; scope: string[]; checker: string; areas: SecurityAreaRecord[]; result: 'PASS' | 'BLOCKED'; blocking: string[]; deferred: string[]; errors: string[]; digest: string; retry_of?: string; }

const secretPatterns = [/https?:\/\/[^\s/]+:[^\s/]+@/i, /[?&](?:token|key|secret|password)=[^\s&]+/i, /\bgh[pousr]_[A-Za-z0-9]{20,}\b/i, /\bnpm_[A-Za-z0-9]{20,}\b/i, /\bsk-[A-Za-z0-9_-]{20,}\b/i, /\bAKIA[A-Z0-9]{16}\b/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /(?:password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,}]{8,}/i];
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const unsafeText = (x: unknown): boolean => typeof x === 'string' && (/[\r\n\x00-\x1f\x7f<>]/.test(x) || x.length > 2048);
const iso = (x: unknown) => typeof x === 'string' && !Number.isNaN(Date.parse(x));
const obj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const stable = (x: unknown): string => {
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x as Record<string, unknown>).filter(k => (x as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(x);
};
const digest = (x: unknown) => `sha256:${createHash('sha256').update(stable(x)).digest('hex')}`;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const hasSecret = (x: unknown): boolean => secretPatterns.some((p) => p.test(typeof x === 'string' ? x : JSON.stringify(x)));

export function createSecurityStarter(input: { stage: SecurityStage; policy?: SecurityPolicy; binding: SecurityBinding; environment: string; scope?: string[]; checker?: string; now?: Date; run_id?: string }): SecurityCheckInput {
  const policy = clone(input.policy || { version: 'security-check-v1', required_at: {} });
  const requiredAt = policy.required_at || {};
  return { run_id: input.run_id || `security-${randomUUID()}`, time: (input.now || new Date()).toISOString(), stage: input.stage, policy, policy_digest: policy.digest || digest(policy), binding: clone(input.binding), environment: input.environment, scope: input.scope || [], checker: input.checker || 'yam-security-check', areas: SECURITY_AREA_IDS.map((id) => ({ id, explanation: SEC_AREAS[id], status: 'unverified', required_at: requiredAt[id] || [input.stage] })) };
}

function evidenceErrors(e: SecurityEvidence, index: number): string[] {
  const out: string[] = [];
  if (!obj(e)) return [`evidence_invalid:${index}`];
  if (typeof e.reference !== 'string' || !e.reference.trim() || e.reference.includes('\0')) out.push(`evidence_reference_invalid:${index}`);
  if (!SHA256.test(String(e.sha256 || ''))) out.push(`evidence_sha256_invalid:${index}`);
  if (typeof e.checker !== 'string' || !e.checker.trim() || hasSecret(e.checker)) out.push(`evidence_checker_invalid:${index}`);
  if (!iso(e.checked_at)) out.push(`evidence_time_invalid:${index}`);
  if (Object.values(e).some(unsafeText)) out.push(`evidence_text_invalid:${index}`);
  if (hasSecret(e)) out.push(`evidence_secret:${index}`);
  return out;
}

export function validateSecurityCheck(input: unknown, expectedBinding?: SecurityBinding, expectedPolicy?: SecurityPolicy): SecurityCheckResult {
  const errors: string[] = [];
  const x = obj(input) ? input as SecurityCheckInput : {} as SecurityCheckInput;
  const validRun = typeof x.run_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(x.run_id);
  const runId = validRun ? x.run_id : `invalid-${randomUUID()}`;
  if (!validRun) errors.push('run_id_invalid');
  if (!['commit', 'push', 'deploy'].includes(x.stage)) errors.push('stage_invalid');
  if (!iso(x.time)) errors.push('time_invalid');
  if (!obj(x.binding)) errors.push('binding_missing');
  if (x.binding?.stage !== x.stage) errors.push('binding_stage_mismatch');
  if (x.stage === 'deploy' && x.environment !== x.binding?.environment) errors.push('environment_binding_mismatch');
  if (Object.values(x).filter(v => typeof v === 'string').some(unsafeText)) errors.push('record_text_invalid');
  if (expectedBinding && stable(x.binding) !== stable(expectedBinding)) errors.push('binding_mismatch');
  if (typeof x.environment !== 'string' || !x.environment.trim()) errors.push('environment_invalid');
  if (!Array.isArray(x.scope) || !x.scope.length || x.scope.some(v => typeof v !== 'string' || !v.trim() || unsafeText(v))) errors.push('scope_invalid');
  if (typeof x.checker !== 'string' || !x.checker.trim()) errors.push('checker_invalid');
  const policy = obj(x.policy) ? clone(x.policy) : { version: 'security-check-v1', required_at: {} };
  const policyDigest = x.policy_digest || policy.digest || digest(policy);
  if (expectedPolicy && stable(policy) !== stable(expectedPolicy)) errors.push('policy_mismatch');
  if (typeof x.policy_digest === 'string' && !SHA256.test(x.policy_digest)) errors.push('policy_digest_invalid');
  if (!Array.isArray(x.areas)) errors.push('areas_missing');
  const supplied = Array.isArray(x.areas) ? x.areas : [];
  const byId = new Map<string, SecurityAreaRecord>();
  supplied.forEach((a, i) => { if (!obj(a) || !Object.prototype.hasOwnProperty.call(SEC_AREAS, a.id)) errors.push(`area_invalid:${i}`); else if (byId.has(a.id)) errors.push(`area_duplicate:${a.id}`); else byId.set(a.id, clone(a)); });
  const requiredAt = (expectedPolicy || policy).required_at || {};
  if (!policy.version || unsafeText(policy.version)) errors.push('policy_version_invalid');
  for (const id of SECURITY_AREA_IDS) {
    const stages = requiredAt[id];
    if (!Array.isArray(stages) || !stages.length || stages.some(v => !['commit','push','deploy'].includes(v))) errors.push(`policy_requirement_invalid:${id}`);
  }
  for (const id of SECURITY_AREA_IDS) if (!byId.has(id)) errors.push(`area_missing:${id}`);
  const areas = SECURITY_AREA_IDS.map((id) => {
    const a = byId.get(id) || { id, explanation: SEC_AREAS[id], status: 'unverified' as const, required_at: requiredAt[id] || [x.stage] };
    if (a.explanation !== SEC_AREAS[id]) errors.push(`explanation_mismatch:${id}`);
    if (!SECURITY_STATUSES.includes(a.status)) errors.push(`status_invalid:${id}`);
    const trustedRequired = Array.isArray(requiredAt[id]) && requiredAt[id].length ? requiredAt[id] : ['commit','push','deploy'] as SecurityStage[];
    if (Object.values(a).filter(v => typeof v === 'string').some(unsafeText)) errors.push(`area_text_invalid:${id}`);
    if (a.status === 'passed' && Array.isArray(a.evidence) && a.evidence.some(e => e?.result !== 'passed')) errors.push(`evidence_result_mismatch:${id}`);
    if (a.status === 'passed' && (!Array.isArray(a.evidence) || !a.evidence.length)) errors.push(`evidence_missing:${id}`);
    if (['SEC-01','SEC-08'].includes(id) && (a.status === 'not_applicable' || !trustedRequired.includes(x.stage))) errors.push(`mandatory_area_invalid:${id}`);
    if (JSON.stringify(a.required_at) !== JSON.stringify(trustedRequired)) errors.push(`required_at_tampered:${id}`);
    if (a.status === 'not_applicable' && (!a.reason || !a.reason.trim())) errors.push(`not_applicable_reason_missing:${id}`);
    if (a.status === 'needs_improvement' && (!a.finding || !a.severity || !a.owner || !a.follow_up || !a.mitigation)) errors.push(`improvement_details_missing:${id}`);
    if (a.status === 'failed' && (!a.finding || !a.severity || !a.owner || !a.follow_up || !a.mitigation || !a.evidence?.length)) errors.push(`failure_details_missing:${id}`);
    if (a.evidence && !Array.isArray(a.evidence)) errors.push(`evidence_array_invalid:${id}`);
    (Array.isArray(a.evidence) ? a.evidence : []).forEach((e, i) => errors.push(...evidenceErrors(e, i).map((z) => `${id}:${z}`)));
    return { ...a, explanation: SEC_AREAS[id], required_at: trustedRequired };
  });
  if (areas.filter((a) => a.id === 'SEC-01').length !== 1 || areas.filter((a) => a.id === 'SEC-08').length !== 1) errors.push('mandatory_areas_missing');
  if (hasSecret(x)) errors.push('record_contains_secret');
  const blocking = areas.filter((a) => (a.required_at || []).includes(x.stage) && !['passed', 'not_applicable'].includes(a.status)).map((a) => `${a.id}:${a.status}`);
  const allErrors = [...new Set(errors)];
  const finalBlocking = [...new Set([...blocking, ...allErrors.map((e) => `contract:${e}`)])];
  const result = finalBlocking.length ? 'BLOCKED' as const : 'PASS' as const;
  const canonical = { schema: 'yam.security-check-result.v1' as const, retry_of: x.retry_of || 'none', run_id: runId, time: x.time, stage: x.stage, policy, policy_digest: policyDigest, binding: x.binding, environment: x.environment, scope: x.scope || [], checker: x.checker, areas, result, blocking: finalBlocking, deferred: areas.filter((a) => !(a.required_at || []).includes(x.stage) && a.status === 'unverified').map((a) => a.id), errors: allErrors };
  return { ...canonical, digest: digest(canonical) };
}

function ensureSafePath(root: string, target: string): string {
  const r = path.resolve(root); const t = path.resolve(target); if (t !== r && !t.startsWith(`${r}${path.sep}`)) throw new Error('path_outside_root'); return t;
}
async function noSymlinkComponents(root: string, target: string) {
  const rel = path.relative(root, target); let cur = root;
  for (const part of rel.split(path.sep).filter(Boolean)) { cur = path.join(cur, part); try { if ((await fsp.lstat(cur)).isSymbolicLink()) throw new Error('symlink_path_rejected'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; } }
}
async function withLock(lock: string, fn: () => Promise<void>) { for (let i = 0; i < 50; i++) { try { await fsp.mkdir(lock); break; } catch (e: any) { if (e.code !== 'EEXIST') throw e; await new Promise((r) => setTimeout(r, 10)); } if (i === 49) throw new Error('security_note_lock_timeout'); } try { await fn(); } finally { await fsp.rm(lock, { recursive: true, force: true }); } }

export async function persistSecurityCheck(dir: string, input: SecurityCheckInput, result?: SecurityCheckResult, options: { notePath?: string } = {}) {
  const root = await fsp.realpath(dir);
  let checked = validateSecurityCheck(input);
  // Integration may only add blocking findings; it cannot promote a failed contract.
  if (result?.result === 'BLOCKED') {
    checked = { ...checked, result: 'BLOCKED', errors: [...new Set([...checked.errors, ...result.errors])], blocking: [...new Set([...checked.blocking, ...result.blocking])] };
  }
  if (hasSecret(checked) || checked.errors.some(e => /text_invalid|secret/.test(e))) {
    const sanitized = createSecurityStarter({ stage: ['commit','push','deploy'].includes(input?.stage) ? input.stage : 'commit', binding: { stage: input?.stage || 'commit', withheld: true }, environment: 'withheld', scope: ['unsafe input omitted'], checker: 'yam-security-check' });
    checked = validateSecurityCheck(sanitized);
    checked.errors.push('unsafe_input_redacted'); checked.blocking.push('contract:unsafe_input_redacted');
  }
  checked.digest = digest({ ...checked, digest: undefined });
  const base = ensureSafePath(root, path.join(root, '.yam', 'security'));
  await noSymlinkComponents(root, base);
  await fsp.mkdir(base, { recursive: true, mode: 0o700 });
  const runs = ensureSafePath(root, path.join(base, 'runs'));
  const originalRoot = path.resolve(dir);
  const requestedNote = options.notePath ? path.resolve(originalRoot, options.notePath) : path.join(originalRoot, '.yam', 'security', 'notes.md');
  ensureSafePath(originalRoot, requestedNote);
  const note = ensureSafePath(root, path.resolve(root, path.relative(originalRoot, requestedNote)));
  const lock = path.join(base, '.lock');
  await noSymlinkComponents(root, note);
  await noSymlinkComponents(root, runs);
  let runPath = '';
  await withLock(lock, async () => {
    await noSymlinkComponents(root, note);
    await fsp.mkdir(path.dirname(note), { recursive: true, mode: 0o700 });
    await fsp.mkdir(runs, { recursive: true, mode: 0o700 });
    runPath = ensureSafePath(runs, path.join(runs, `${checked.run_id}.json`));
    await noSymlinkComponents(root, runPath);
    try { await fsp.lstat(runPath); throw new Error('security_run_exists'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    const handle = await fsp.open(note, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
    try {
      const info = await handle.stat(); if (!info.isFile() || info.nlink !== 1) throw new Error('unsafe_note_file');
      await fsp.writeFile(runPath, JSON.stringify(checked, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await handle.writeFile(renderSecurityNote(checked), 'utf8'); await handle.sync();
    } finally { await handle.close(); }
  });
  return { run_path: path.relative(root, runPath), note_path: path.relative(root, note), result: checked };
}

export function renderSecurityNote(result: SecurityCheckResult): string {
  const clean = (x: unknown) => String(x ?? '').replace(/[\r\n\x00-\x1f\x7f]/g, ' ');
  const lines = ['-- Security check --', '', 'Contract: security-check-v1', `Run: ${clean(result.run_id)}; Time: ${clean(result.time)}`, `Stage: ${result.stage}; Policy: ${clean(result.policy_digest)}`, `Environment: ${clean(result.environment)}`, `Binding: ${clean(JSON.stringify(result.binding))}`, `Scope: ${result.scope.map(clean).join(', ')}`, `Checker: ${clean(result.checker)}`, ''];
  result.areas.forEach((a, i) => {
    lines.push(`${i + 1}. ${a.id} : "${SEC_AREAS[a.id]}" : ${STATUS_KO[a.status] || '미검증'}`);
    lines.push(`   - Required at: ${a.required_at.join(', ')}`);
    if (Array.isArray(a.evidence) && a.evidence.length) lines.push(`   - Evidence: ${a.evidence.map(e => `${clean(e.reference)} (${clean(e.sha256)}) by ${clean(e.checker)} at ${clean(e.checked_at)}`).join('; ')}`);
    for (const field of ['reason','finding','severity','owner','follow_up','mitigation'] as const) if (a[field]) lines.push(`   - ${field}: ${clean(a[field])}`);
  });
  lines.push('', `Retry of: ${clean(result.retry_of || 'none')}`, `Result: ${result.result}`, `Blocking: ${result.blocking.map(clean).join(', ') || 'none'}`, `Deferred: ${result.deferred.join(', ') || 'none'}`, '-- End Security check --', ''); return lines.join('\n');
}
