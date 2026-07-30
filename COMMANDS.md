# yam Commands

Use these as prompt commands in Codex after restarting the app.

## Quick

```text
$quick
회원가입 버튼 padding을 2px 늘리고 라벨을 "Start free"로 바꿔줘.
프로젝트 방향성과 기존 버튼 패턴에 맞게 최소 수정만 해줘.
```

```text
$quick
현재 빌드/타입 에러를 빠르게 스캔하고,
가장 작은 원인부터 하나씩 고쳐줘.
검증은 관련 명령만 실행해줘.
```

## Ueye

```text
$ueye
첨부한 레퍼런스 이미지의 분위기를 참고해서 가격 카드 UI를 고급스럽게 개선해줘.
구현 전에 레퍼런스에서 읽은 디자인 특징을 짧게 증명하고,
구현 후 레퍼런스와 결과물을 비교해서 비슷한 점과 다른 점을 정리해줘.
이 프로젝트의 디자인 방향성과 맞게 구현하고,
가능하면 기본/모바일/오류 상태를 실제 화면 기준으로 확인해줘.
```

```text
$ueye
이 스크린샷을 UX/UI 관점에서 봐줘.
방향성, CTA, 대비, 정렬, spacing, 모바일 리스크를 P0-P3로 정리하고,
가능한 안전한 수정안을 제안해줘.
```

```text
yam template ueye-comparison
```

Opt-in visual evidence helpers:

```bash
yam ueye preflight /path/to/project --json
yam ueye capture --url http://localhost:3000 --out .yam/screens/home.png
yam ueye compare --reference ./reference.png --actual .yam/screens/home.png
yam ueye report --reference ./reference.png --actual .yam/screens/home.png --preflight-id ueye-preflight-123 --p0-risk "mobile CTA may clip" --quality-gate-note "check CTA contrast before done" --brief-dimension "primary CTA clarity" --constraint "mobile first" --acceptance-criterion "primary CTA remains visible on mobile" --design-system-evidence "uses existing button token" --implementation-evidence "browser screenshot reviewed" --state-check default:pass --state-check mobile:partial --skipped-check "hover state not checked on touch viewport" --residual-risk "tablet breakpoint still needs visual pass" --stop-condition "stop after primary states are checked and residual risk is recorded" --resume-hint "capture tablet screenshot next" --review-session-id pricing-card-v1 --provider-context local --execution-surface in-app-browser --browser-surface in-app-browser --similar "overall hierarchy" --different "button glow intensity" --missing "mobile state" --design-quality needs-polish --json
yam ueye report --reference ./reference.png --actual .yam/screens/home.png --completion-claim done --design-quality pass --direction-locked --reference-read --states-checked --mobile-checked --contrast-checked --cta-checked --json
yam ueye asset add --manifest .yam/ueye/assets.json --id official-logo --file ./assets/logo.png --license-note "operator supplied; local review" --operator-provided --do-not-replace --json
yam ueye asset verify --manifest .yam/ueye/assets.json --json
yam ueye revision archive --file .yam/screens/home.png --round 1 --artifact-id home --root .yam/ueye/revisions --json
yam ueye revision verify --manifest .yam/ueye/revisions/manifest.json --json
yam media proof --requested --attempted --output ./generated.png --wait-loop --json
yam proof --route ueye --truth partial --visual "browser/local screenshot comparison executed" --require-visual
```

## Review-Only

```text
$deep
현재 변경사항을 리뷰해줘.
방향성, 코드 리스크, 검증 부족을 P0-P3로 정리하고 수정은 하지 마.
```

## Question

```text
$question
tmux가 무엇이고, 지금 내 작업에 꼭 필요한지 짧게 설명해줘.
구현이나 넓은 조사는 하지 말고 바로 답해줘.
```

## Deep

```text
$deep
결제 플로우 상태 처리를 안정화해줘.
성공/실패/로딩/재시도 상태와 회귀 위험까지 깊게 검증해줘.
필요하면 tmux/dev server/browser QA/cleanup proof까지 사용해줘.
```

## Mission

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

실제 subagent/team 단위로 구현하고,
implementer/reviewer/UX verifier/doctor lane으로 교차 검증해줘.
필요하면 tmux/dev server/browser QA/cleanup proof까지 포함해줘.
최종 보고에는 evidence, truth status, cleanup status, fix-first items, remaining tasks를 포함해줘.
```

## Scout

```text
$scout
Next.js에서 이 기능을 구현하는 가장 안전한 방식을 찾아줘.
공식 문서와 신뢰 가능한 근거 중심으로 보고,
객관적 판단과 주관적 판단, 현실적/미래적 관점까지 나눠서 추천해줘.
코드는 아직 수정하지 마.
```

## Project Pack

Use the CLI to create and inspect the small project direction file.

```bash
yam init-project /path/to/project
yam pack /path/to/project
yam context pressure /path/to/project
yam template mission
```

## Memory

Use this only when a lesson should survive across sessions.

```bash
yam memory init /path/to/project
yam memory add /path/to/project --kind repeat_mistake --summary "UI work was declared done without visual review" --evidence "Missed spacing regression" --action "Run $ueye after major UI work"
yam memory summary /path/to/project
```

## Token Budget

```bash
yam budget quick
yam measure quick --files 3 --commands 1 --report-lines 5 --seconds 40
yam template tuning
```

## External Updates

```bash
yam update check
yam update check --json
yam update apply --component scrapling --json
yam update apply --component insane-search --json
yam update apply --component yam --json
yam update apply --all --json
```

`yam update check` is read-only. Every `apply` needs explicit authorization, uses a concurrent-run lock, records a component receipt, and stops on failed/manual results. `--all` runs yam last. Insane Search is never remove-first and `.codex/plugins/cache` is never edited directly.

## Tool Doctor / Proof / Safety

Read-only readiness and evidence helpers. These do not install, deploy, query databases, or run verification by themselves.

```bash
yam tools doctor /path/to/project
yam tools doctor /path/to/project --json
yam context pressure /path/to/project --json
yam cleanup scan /path/to/project --json
yam detect /path/to/project --json
yam study-note check /path/to/project --text "Study Note: The hook handler's role is final-report validation. It runs at Codex Stop. Before it only reminded; after it requests one correction pass. Expected behavior is a complete note. Structure insight: decision=block creates a continuation prompt. Verification checked the packaged CLI. Limits: a restarted real task remains to be observed." --json
yam loop report --route quick --intent "fix release readiness" --stage "inspect:passed:read release report" --evidence "typecheck passed" --evidence-level local --evidence-stamp "sha256:release-report" --touched-file src/bin/yam.ts --read-file README.md --verified-file scripts/cli-smoke.mjs --skipped-check "npm publish skipped by design" --stop-condition "stop after readiness evidence is recorded" --resume-hint "rerun release report after npm auth refresh" --readiness-state blocked --covered-requirement "release report is read-only" --uncovered-requirement "npm auth verified" --blocked-kind auth_blocked --failure-cause auth_token_invalid --safe-retry "retry after npm whoami succeeds" --recovery-hint "refresh npm auth, then rerun readiness checks" --fix-first-item "npm auth must be verified before publish" --remaining-task "rerun release report after auth refresh" --recommended-direction "fix npm auth first, then publish manually" --implementation-note "keep loop report read-only" --why-this-next "auth blocks public release claims" --blocked-by "npm whoami E401" --owner-route deep --owner-scope "release readiness only" --scope-owner deep --side-effect "no publish attempted" --avoidance-note "do not retry publish before npm auth is proven" --issue-code "src/bin/yam.ts release report" --issue-role "summarizes release readiness without publishing" --issue-symptom "npm auth failure needs clearer next action" --changed-code "yam loop report" --changed-role "records loop evidence and learning note" --change-summary "added a read-only loop artifact" --why-important "it helps users learn what changed without overclaiming verification" --learning-note "fix blockers before claiming done" --json
yam proof /path/to/project
yam proof --route deep --truth verified --command "npm run build: pass"
yam proof --route ueye --truth verified --visual "reference image only"
yam proof --route ueye --truth partial --visual-provenance '{"source_kind":"reference","source_hash":"unknown","comparison_result":"not-verified","truth_status":"partial"}'
yam ueye capture --url http://localhost:3000 --out .yam/screens/home.png
yam ueye compare --reference ./reference.png --actual .yam/screens/home.png --json
yam ueye report --reference ./reference.png --actual .yam/screens/home.png --design-quality pass --provider-context local --execution-surface in-app-browser --browser-surface in-app-browser --json
yam proof --route ueye --truth verified --visual "implementation screenshot evidence recorded" --design-completion '{"completion_claim":"done","has_implementation_screenshot":true,"design_quality":"pass","states_checked":true,"mobile_checked":true,"contrast_checked":true,"cta_checked":true,"direction_locked":true,"truth_status":"verified"}'
yam media proof --requested --attempted --output ./generated.png --wait-loop --json
yam runtime evidence --backend terminal --claim observed --evidence-id dev-server-1 --command "npm run dev" --pid 123 --port 3000 --json
yam runtime evidence --backend terminal --claim cleanup-verified --cleanup-observed --exit-code 0 --cleanup-method "process exit checked" --json
yam mission queue --agent-id implementer --scope "checkout form" --changed src/checkout.tsx --verification-hint "npm run typecheck" --rollback-hint "revert checkout form patch if typecheck or smoke fails" --json
yam mission receipt --thread-id implementer-1 --role implementer --access-mode write --lifecycle stopped --outcome passed --scope "checkout form" --changed src/checkout.tsx --evidence "typecheck passed" --out .yam/mission/implementer-1.json --json
yam mission receipt --thread-id reviewer-1 --role reviewer --lifecycle stopped --outcome passed --scope "read-only checkout review" --evidence "review completed without edits" --out .yam/mission/reviewer-1.json --json
yam mission gate --expected-thread implementer-1 --expected-thread reviewer-1 --receipt .yam/mission/implementer-1.json --receipt .yam/mission/reviewer-1.json --out .yam/mission/completion.json --json
yam benchmark report --label "render time" --baseline 100 --current 86 --unit ms --target lower --json
yam proof --route mission --mission-envelope '{"agent_id":"implementer","assigned_scope":"target component","changed_files":["src/file.ts"],"verification_hint":"npm run typecheck","truth_status":"partial"}'
yam proof --route deep --truth proven --require-runtime --runtime "mock server fixture"
yam proof write /path/to/project --route deep --truth partial --command "npm run build: pass"
yam proof write /path/to/project --format md --truth assumed --assumption "No runtime was started"
yam safety "supabase db reset --linked"
```

Release reporting intentionally runs the release checks and returns a machine-readable summary.

```bash
yam release report --json
```

## Flow Artifact Shapes

Use existing templates and JSON outputs for compact support records:

```bash
yam template proof
yam template mission
yam template tuning
yam tools doctor /path/to/project --json
yam release report --json
yam runtime evidence --backend terminal --claim cleanup-verified --cleanup-observed --exit-code 0 --cleanup-method "exit observed" --json
yam mission receipt --thread-id reviewer-1 --role reviewer --lifecycle stopped --outcome passed --scope "changed files review" --evidence "read-only findings recorded" --json
yam benchmark report --label "bundle size" --baseline 120 --current 118 --unit kB --target lower --json
yam loop report --route deep --intent "verify release readiness" --blocked "npm auth not verified" --next-action "refresh npm token, then rerun npm whoami" --json
```

Supported report shapes:

- Runtime evidence mini: command/process, observation, cleanup, truth status, next action.
- Patch queue lite: mission lane status, changed files, verification hint, rollback hint, truth status.
- Verification Ladder: L0 stated, L1 inspected, L2 local check, L3 integrated, L4 release/runtime/visual proof, L5 bounded deep with stop condition and skipped/remaining work.
- Loop report: intent, guided stage outcomes, touched/read/verified files, skipped checks, stop condition, resume hint, readiness state, evidence level/stamp, blockers, blocker kind, safe retry, next action, fix-first items, remaining tasks, recommended direction, blocked-by notes, owner route/scope, side effects, and study note.
- Study note: non-specialist explanation of the changed code/artifact, its role, execution point, before/after behavior, expected behavior, one syntax/structure insight, verification, uncertainty, and architecture hygiene around `page.tsx`, `global.css`, and DB `jsonb`.
- Study Note guard: read-only check for changed files and supplied final-report text; the opt-in `study-note` hook adds a prompt reminder and one bounded Codex `Stop` correction pass.
- Benchmark optimization loop lite: baseline, one change, rerun, keep/revert decision.
- Structured diagnostic next action: severity, evidence, owner route, next action, truth status.
- Ueye continuity/comparison: previous report, current report, comparison delta, design quality, next action.
- Ueye design brief/anti-slop: brief dimensions, constraints, invented metrics, placeholder copy, generic visuals, and custom P0 blockers.
- Ueye deep visual review: acceptance criteria, touched/read/verified files, skipped checks, residual risks, stop condition, resume hint, design-system evidence, implementation evidence, and state matrix.
- Context pressure: project pack age/size, memory summary, dirty scope, scripts, instruction surfaces, and route hint.
- Changed-file verification detector: dirty/staged/untracked Git paths grouped into advisory rules with confidence, reason, fallback, source files, and available project commands; the command plan is deduplicated while retaining rule/file provenance, Git-unavailable scope stays low confidence, and no recommendation is executed.
- Cleanup scan: advisory-only list of confusing surfaces with `destructive=false`, plus a bounded exact-normalized AGENTS/SKILL cross-surface duplication budget with file/line provenance.

## Hooks

`lite` is advisory-only. `study-note` runs the read-only Study Note Guard against the final assistant message and can request one correction pass; neither profile runs verification or forces routes.

```bash
yam hook status --global
yam hook enable lite --global
yam hook enable study-note --global
yam hook disable lite --global
yam hook disable study-note --global
```

`yam hook status` exits nonzero for unreadable configs, stale paths, missing targets, duplicate handlers, or incomplete event coverage. Re-enable the affected profile to back up the file, preserve unrelated hooks, and migrate its command and events.
