# Security check contract v1

This document defines the security-check contract and the human-readable `Security check` block in a Yam note. `yam security check` validates supplied reports, trusted stage policy, target bindings and evidence-file hashes, then writes a note. It is not an automatic vulnerability scanner and does not change `yam.study-note.v1`. A passing gate proves that the supplied evidence contract matches the checked target; it does not independently establish the truth or completeness of the evidence.

## Scope and timing

Assess security applicability during new development and changes. Before commit, push, or deployment, require a note and evidence for the checks required at that stage. A new project receives an initial assessment of all nine areas; later work reassesses changed boundaries and may reuse unchanged evidence with its source and validity reason.

- Commit: bind the run to the actual staged tree and base revision, including newly staged files. Unstaged working files are not proof of the staged content. Changing the index invalidates the result.
- Push: bind the run to the exact outgoing commit IDs and destination. Recheck the outgoing changes; a local note alone is insufficient proof for the future remote CI gate.
- Deploy: bind the run to the exact artifact digest, source commit, target environment, and relevant configuration revision. Verify actual environment settings; build success does not establish deployment security.
- Evidence reuse is valid only when the checked content, policy version, dependencies, and relevant environment/configuration remain unchanged. A code digest alone cannot validate live environment evidence.

Commit, push, and deployment are distinct actions. A remote CI failure generally blocks protected-branch merge or deployment; it does not mean the preceding Git push was rejected. Local hooks can be bypassed or absent. Do not claim that `--no-verify` is automatically observable; future CI must independently check incoming revisions. Direct deployments must use the same required gate or access restrictions, otherwise enforcement remains incomplete.

## Fixed areas and concrete summaries

Every run includes each ID exactly once with a concrete explanation, a status, and the applicable evidence or reason. An ID or short heading alone does not satisfy the explanation requirement. These summaries are the canonical minimum; add project-specific targets without removing their security meaning.

| ID | Required security explanation summary |
| --- | --- |
| SEC-01 | 사용자·관리자·외부 서비스·DB·파일 사이의 신뢰 경계와 보호할 데이터·작업을 식별한다. |
| SEC-02 | 명시적으로 허용한 접근만 열고, 사용자·서비스 계정에 필요한 최소 권한만 부여한다. |
| SEC-03 | 화면을 우회한 API·서버 함수·DB·파일·백그라운드 작업에서도 사용자·조직·대상별 권한을 확인한다. |
| SEC-04 | 계정 정지·승인 철회·탈퇴·소속 변경 후 기존 세션·토큰·캐시에서도 권한 회수가 반영된다. |
| SEC-05 | 코드의 보안 정책·migration·ACL·환경 설정이 대상 배포 환경의 실제 상태와 일치한다. |
| SEC-06 | 로그인·관리자 인증·세션 만료·로그아웃·비밀번호 재설정·계정 복구가 계정 탈취를 막도록 동작한다. |
| SEC-07 | 외부 입력·파일 업로드·출력의 형식·크기·경로를 검증하고 SQL 주입·XSS·SSRF·CSRF 등 해당 공격을 방어한다. |
| SEC-08 | API 키·토큰·개인키·개인정보가 코드·브라우저 번들·로그·점검 기록에 불필요하게 노출되지 않는다. |
| SEC-09 | 의존성·CI/CD 권한·배포 자격증명·릴리스 산출물의 출처와 무결성을 확인해 공급망 위험을 통제한다. |

SEC-01 applicability assessment and SEC-08 note disclosure review are required for every run. Other areas can be inapplicable only with a concrete project and stage reason. A static site may still have deployment credentials, third-party scripts, or dependencies. Lack of access or a missing test is `미검증`, never `해당 없음`.

Conditional subchecks belong under the relevant area: atomic multi-record writes and incomplete reads under SEC-01/03; retry/idempotency and concurrent resource changes under SEC-03; stable IDs and organization ownership under SEC-03/04; export permissions and CSV output under SEC-03/07; audit history access/retention under SEC-08. Record applicable subchecks separately so one passing subcheck cannot hide another unchecked subcheck. Static-analysis findings require reproduction or other adequate evidence before dismissal. N+1 and index tuning remain performance concerns unless there is a concrete availability, data-boundary, or integrity risk.

## Five statuses and deterministic gate

| Status | Meaning | Required-at-stage gate |
| --- | --- | --- |
| 점검 완료 - 이상 없음 | All applicable required subchecks passed with matching evidence. | Allow |
| 점검 완료 - 보완 필요 | The check ran and identified an unresolved issue; include severity, owner, follow-up and mitigation. | Block |
| 점검 실패 | A security requirement failed or a defect was reproduced. | Block |
| 미검증 | Required evidence is absent, incomplete, stale, or unavailable. | Block |
| 해당 없음 | No applicable requirement exists for this project and stage; include the reason. | Allow |

Overall result is `PASS` only when every required area/subcheck is valid and is either evidenced `이상 없음` or justified `해당 없음`. Otherwise it is `BLOCKED`; show blocking IDs and reasons. Missing or duplicate IDs, missing explanations, invalid statuses, missing binding fields, unfilled template values, or a note-write failure also block the stage. Severity prioritizes remediation and does not silently turn an unresolved finding into a pass. This v1 contract has no automatic waiver path.

Some evidence is only available at a later stage. Record `required_at` per area/subcheck and keep the unresolved state visible as `미검증`; for example, live SEC-05 environment inspection may be required at `deploy`. This does not block a commit if the commit-stage policy explicitly defers that live check, but it blocks deployment until verified. Version the stage policy and record it with the run. Do not downgrade a required-at-current-stage check to a later stage merely to obtain `PASS`.

## Yam note format

In the source repository or package root, use `templates/security-check-note.md`. Installed skills copy references but not templates; use the self-contained starter below when that file is unavailable. `Security check` is an independent block, not a replacement for Study Note or Next step. In changed-artifact reports keep Next step immediately after Study Note; place Security check before that pair. The existing Study Note JSON schema is unchanged.

```text
-- Security check --

Contract: security-check-v1
Run: <unique run ID>; Time: <ISO timestamp with timezone>
Stage: <commit | push | deploy>; Policy: <stage-policy version>
Environment: <target environment or explicit local/not-applicable reason>
Binding: <commit: staged tree and base revision | push: outgoing commit IDs and destination | deploy: artifact digest, source commit, environment and configuration revision>
Scope: <changed paths and connected security boundaries>
Checker: <tool/version or named reviewer>; Evidence: <sanitized evidence references>

1. SEC-01 : "사용자·관리자·외부 서비스·DB·파일 사이의 신뢰 경계와 보호할 데이터·작업을 식별한다." : 미검증
   - Required at: <stages>; Target/evidence/result/time: <actual check details or missing evidence>
2. SEC-02 : "명시적으로 허용한 접근만 열고, 사용자·서비스 계정에 필요한 최소 권한만 부여한다." : 미검증
   - Required at: <stages>; Target/evidence/result/time: <actual check details or missing evidence>
3. SEC-03 : "화면을 우회한 API·서버 함수·DB·파일·백그라운드 작업에서도 사용자·조직·대상별 권한을 확인한다." : 미검증
   - Required at: <stages>; Target/evidence/result/time: <actual check details or missing evidence>
4. SEC-04 : "계정 정지·승인 철회·탈퇴·소속 변경 후 기존 세션·토큰·캐시에서도 권한 회수가 반영된다." : 미검증
   - Required at: <stages>; Target/evidence/result/time: <actual check details or missing evidence>
5. SEC-05 : "코드의 보안 정책·migration·ACL·환경 설정이 대상 배포 환경의 실제 상태와 일치한다." : 미검증
   - Required at: <stages>; Target/evidence/result/time: <actual check details or missing evidence>
6. SEC-06 : "로그인·관리자 인증·세션 만료·로그아웃·비밀번호 재설정·계정 복구가 계정 탈취를 막도록 동작한다." : 미검증
   - Required at: <stages>; Target/evidence/result/time: <actual check details or missing evidence>
7. SEC-07 : "외부 입력·파일 업로드·출력의 형식·크기·경로를 검증하고 SQL 주입·XSS·SSRF·CSRF 등 해당 공격을 방어한다." : 미검증
   - Required at: <stages>; Target/evidence/result/time: <actual check details or missing evidence>
8. SEC-08 : "API 키·토큰·개인키·개인정보가 코드·브라우저 번들·로그·점검 기록에 불필요하게 노출되지 않는다." : 미검증
   - Required at: <stages>; Target/evidence/result/time: <actual check details or missing evidence>
9. SEC-09 : "의존성·CI/CD 권한·배포 자격증명·릴리스 산출물의 출처와 무결성을 확인해 공급망 위험을 통제한다." : 미검증
   - Required at: <stages>; Target/evidence/result/time: <actual check details or missing evidence>

Result: BLOCKED
Blocking: <required-at-current-stage unresolved IDs/subchecks or invalid record fields>
Deferred: <later-stage missing evidence, required stage, owner and action; none if absent>
Retry of: <prior run ID or none>
-- End Security check --
```

This full starter contains all nine IDs and defaults to `미검증`/`BLOCKED`; copying it cannot create successful evidence. For `보완 필요` or `점검 실패`, record the finding, severity, owner, follow-up action/date and mitigation. For `해당 없음`, record the concrete project/stage reason.

Each detail records required stages, actual checked target, command/test/review reference, result and time, plus any skipped subcheck. Human review is acceptable for design checks when the reviewer and inspected scope are explicit. A status supplied by an agent is not independent runtime evidence. Do not call the whole system secure from this checklist alone.

## Persistence and enforcement boundaries

- Append one complete block per run to the project's existing Yam note. If none exists, the default is `.yam/security/notes.md`; keep it out of published package contents. Do not overwrite user notes or silently initialize Git hooks.
- Failed runs also leave a record. Preserve earlier records and connect retries by run ID; never rewrite a failure into a pass. Append-only behavior is a design requirement, not tamper-proof storage against the same OS user.
- Store only redacted findings and references. Never include secret values, credential-bearing URLs, raw environment dumps, personal data, or malicious payload contents in the note. If safe persistence fails, block and report a sanitized error.
- The validator rejects incomplete coverage and mismatched bindings; checks remeasure staged content, outgoing refs, or deployment files before persistence. Note writes are serialized with a bounded lock. Unsafe paths, links, duplicate run IDs and write failures block. A run JSON may remain if its note append fails: this is not a successful gate.
- Focused hook/CI tests cover normal pass, improvement needed, failure, missing evidence, justified non-applicability, staged/unstaged mismatch, changed outgoing revisions, changed deployment artifact/configuration, missing note writes, bypassed local hooks, and note secret redaction.
- `security init` and `security hooks enable` explicitly configure a project. No global hooks are installed by package installation. Remote branch protection and deployment authorization are outside the local CLI; until the required CI job and deployment dependency are configured, remote enforcement is incomplete.

## Runtime commands

```sh
yam security init
yam security status
yam template security
yam security check --stage commit --json
yam security hooks enable
```

Init preserves existing files, creates a private draft at `.yam/security/check.json`, a policy at `.yam/security/policy.json`, and pins the exact policy file digest in Git-local `yam-security.json`. Every draft area is unverified. Replace draft values with real stage-bound review/test evidence before enabling workflows. Init does not grant PASS. Report fields follow `SecurityCheckInput` in `src/lib/security-check.ts`; `createSecurityStarter` and `collectSecurityBinding` provide exact report construction for each stage. Evidence uses repository-relative regular files, `sha256:<64 hex>` of their bytes, checker, checked_at, and `result: "passed"` for passing checks. IDs, canonical explanations and stage requirements are mandatory.

Policy uses `version` and a `required_at` map for all nine IDs. SEC-01/08 must apply at every stage; other areas may defer only through the reviewed policy. CI maps to push requirements but has a distinct source/base/tree binding, so a local push report cannot stand in for a CI report. The exact policy file bytes are pinned, including whitespace. Reapprove a changed policy externally; do not take a policy pin from the same untrusted change that it is intended to verify.

```sh
# pre-push hook supplies refs on stdin and the actual remote destination.
yam security check --stage push --remote origin --destination <actual-destination> --json
# CI independently validates its report; policy pin comes from trusted runner settings.
yam security check --stage ci --source <exact-commit> --base <exact-base> --policy security/policy.json --policy-digest <trusted-sha256> --evidence security/check.json --json
# Deployment measures actual artifact/configuration file bytes as well as matching the report.
yam security check --stage deploy --source <exact-commit> --artifact <file> --artifact-digest <sha256> --configuration <file> --configuration-digest <sha256> --environment production --policy <file> --policy-digest <trusted-sha256> --evidence <report> --json
```

`--note <repository-local-file>` can append to an existing Yam note. The default private note is `.yam/security/notes.md`; JSON runs go under `.yam/security/runs/`. Hooks refuse existing hooks and custom `core.hooksPath` rather than overwrite them. POSIX hook setup is supported; Windows and custom hooks need manual integration. Ref deletion pushes fail closed pending a separately reviewed workflow. CI initial pushes without a valid base also fail closed; use a reviewed exact base instead of fabricating a prior revision.

`yam template security-ci` prints `templates/security-gate.yml`. It is a project setup template, not an active workflow in this repository: provision the trusted yam runner, approved policy pin, real test/review evidence, artifact retention and required branch check before enabling it. Put the same deployment gate immediately before the deployment operation, make later steps depend on success, and restrict bypass routes. Running a local command cannot change hosting-provider branch rules. Do not run untrusted project code with production credentials.

Conditional subchecks must be represented in the referenced review/test evidence for their parent area. The validator does not discover omitted application requirements or execute project scanners. Supply independently generated evidence or an identified reviewer; operator-authored status and hash alone can be fabricated. Deploy configuration file hashes prove file identity, not cloud state: include actual environment inspection evidence for SEC-05. Secret-pattern rejection is best effort and not a comprehensive privacy classifier; record only sanitized references and short findings, never raw personal data or credential values. Same-user concurrent filesystem replacement cannot be fully prevented with Node path checks; this is not an adversarial same-user sandbox.
