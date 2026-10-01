# Yam note security-check starter

Copy the block below into the project's Yam note for each run. Replace every placeholder with actual scope/evidence; do not infer a pass from the template. The authoritative status and gate rules are in [Security check contract v1](../references/security-check.md).

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

For `점검 완료 - 보완 필요` or `점검 실패`, add a concrete finding, severity, owner, follow-up action/date and mitigation. For `해당 없음`, add a project/stage-specific reason. Keep missing evidence as `미검증`. All applicable conditional subchecks must appear in the details; one passing test cannot cover an untested requirement.
