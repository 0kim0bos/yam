# Mission

`mission` is the real-subagent/team execution route for approved plans.

It exists so `deep` can stay single-agent and verification-centered while `mission` owns real team/subagent implementation and cross-verification.

Use it when:

- The user has approved a broad implementation plan.
- Real subagent/team lanes would reduce risk.
- Implementation, review, visual/runtime verification, and final proof need to happen together.
- The work is too broad for `quick` or `ueye`.

Do not use it for:

- Small edits.
- Ordinary scoped feature work.
- Pure research.
- Pure verification or single-agent heavy work.
- Tasks without an approved plan or clear acceptance criteria.
- Tasks where real subagents are unavailable, unsafe, or not worth the token/time cost; use `deep` instead.

Role model:

- Implementer: makes the scoped changes.
- Reviewer: checks correctness, risk, architecture, and direction.
- UX/browser verifier: checks UI behavior, browser state, screenshots, or flows when relevant.
- Doctor/scanner: checks direction fit, scope control, command output, stale instructions, runtime/cleanup evidence, false-completion risk, and remaining fix-first items.

Subagent policy:

- Mission requires real subagent/team orchestration to be considered a full mission.
- Use mission when the environment supports subagents and the work can be split into independent implementation, review, or verification lanes.
- If the task is bounded, the split is artificial, or the token/time cost would exceed the safety benefit, choose `deep` instead.
- If the user invoked mission but real subagents are unavailable or unsafe, downgrade to `deep` by default and report `subagent decision: downgraded_to_deep`.
- If the user explicitly insists on mission despite missing subagents, mark the result `partial` or `blocked`; do not treat self-review as team execution.
- The final proof must record the subagent decision: `used`, `downgraded_to_deep`, `unavailable_partial`, or `blocked`, with the reason.

Runtime use:

- Mission may use deep runtime verification when needed, but runtime proof alone does not make a mission if subagents were not used.
- tmux is recommended when a persistent dev server, watcher, or browser QA loop materially improves evidence.
- tmux is not mandatory for every mission.

Completion rule:

- No verified claim without evidence.
- No cleanup claim without exit/closure confirmation or intentional persistence.
- No visual claim without screen, browser, or screenshot evidence.

Suggested prompt:

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
필요하면 tmux/dev server/browser QA/process cleanup proof까지 사용해줘.
최종 보고에는 evidence, truth status, cleanup status, fix-first items, remaining tasks를 포함해줘.
```

Doctor scan:

Use `references/doctor-scan.md` before final completion.
Keep the scan short, but cover direction fit, scope control, verification, runtime/cleanup, truth status, and fix-first items.

Design baseline:

- Strict proof would likely make this a team route with stronger gates and required agent evidence.
- Modular skill workflows split role responsibilities and keep evidence boundaries.
- Minimal-core design avoids adding this unless it clearly replaces a confusing middle route.

`yam` uses mission to replace the old standalone runtime route with a clearer heavy execution route.
