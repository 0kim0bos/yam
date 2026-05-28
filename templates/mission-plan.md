# yam Mission Prompt

```text
$mission
아래 구현 계획은 확정됐어.

목표:
-

범위:
-

금지사항:
-

Acceptance criteria:
-

역할:
- Implementer: 범위 안에서 구현
- Reviewer: 코드/구조/리스크/방향성 검토
- UX/browser verifier: 화면/상태/브라우저 흐름 확인
- Doctor/scanner: stale context, 과검증/검증부족, false-completion risk, cleanup, 남은 fix-first 점검

Subagent 판단:
- 실제 subagent/team 사용 가능 여부:
- meaningful split:
- decision: used / downgraded_to_deep / unavailable_partial / blocked
- 이유:
- subagent가 불가능하거나 불필요하면 기본적으로 $deep으로 전환:

검증:
- 필요한 가장 작은 검증 명령을 우선 실행
- 필요하면 tmux/dev server/browser QA/process cleanup proof 사용
- 검증하지 못한 것은 skipped/blocked/assumed로 명확히 보고

최종 보고:
- 구현 요약
- 역할별 교차 검증 결과
- subagent decision
- 실제 evidence
- truth status
- cleanup status
- fix-first items
- remaining tasks
```
