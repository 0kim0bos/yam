---
name: mission
description: Explicit real-subagent/team execution route for approved implementation plans. Use when the user invokes $mission or asks for team implementation with real subagents, cross-verification, doctor scan, runtime/tmux/browser QA, and final proof summary.
---

# yam Mission

Use for:

- Approved implementation plans or scenarios.
- Broad implementation where real subagent/team separation reduces risk.
- Team execution with real implementer, reviewer, verifier, and doctor lanes when tool support is available.
- Work that needs implementation plus cross-verification.
- Work that may need deep runtime/tmux/browser QA as part of final proof.

Do not use for:

- Tiny changes or ordinary scoped implementation. Use `$quick`.
- Design-heavy UI/UX implementation or screenshot-led review. Use `$ueye`.
- Pure investigation. Use `$scout`.
- Pure verification without real subagent/team execution. Use `$deep`.
- Heavy single-agent work, even with runtime/tmux/browser proof. Use `$deep`.
- Mission-shaped work when real subagents are unavailable or unsafe to use. Downgrade to `$deep` and report the downgrade.

## Principles

- Direction before execution.
- Mission is explicit-only; never auto-escalate small tasks into mission.
- Start from the user's approved plan or ask for one if the plan is missing.
- Mission requires real subagent/team orchestration; role-only self-review belongs in `$deep`.
- Keep role separation real and useful, not theatrical.
- Token economy still matters.
- Use real subagents only when they are available and the work has separable, high-risk, or parallel lanes.
- If real subagents are not available, unsafe, or not worth using, downgrade to `$deep` by default.
- If the user explicitly insists on `$mission` despite unavailable subagents, mark the mission `partial` or `blocked` instead of pretending role-play is team execution.
- Use tmux/dev server/browser QA only when the mission needs runtime evidence.
- Cross-verify before claiming completion.
- Do not claim verified, cleaned up, or visually checked without evidence.
- Doctor scan is mandatory for mission finalization, but it should stay concise.

## Workflow

1. Restate the mission goal, scope, no-go rules, and acceptance criteria.
2. Confirm real subagent/team availability and a meaningful split.
3. If real subagents are unavailable, unsafe, or not useful, stop mission setup and downgrade to `$deep` unless the user explicitly asks to proceed with a partial/blocked mission.
4. Split work into real lanes:
   - Implementer: makes scoped changes.
   - Reviewer: checks code, risk, and project direction.
   - UX/browser verifier: checks screen behavior when relevant.
   - Doctor/scanner: checks direction fit, scope control, verification, cleanup, stale context, and false-completion risk.
5. Execute the implementation in bounded steps.
6. Record a compact patch envelope for each real lane that changes code.
7. Add rollback hints for touched files, generated files, before checks, and safe revert notes.
8. Use `$deep`-style runtime verification when the mission needs dev server, tmux, test watcher, browser QA, cleanup, or before/after evidence.
9. Cross-check findings and resolve contradictions.
10. Run the smallest honest final verification set.
11. Run doctor scan with `references/doctor-scan.md`.
12. Confirm cleanup or explicitly report intentionally running processes.
13. Produce final proof summary, truth status, remaining tasks, and fix-first items.

## Proof Summary

Include:

- Mission goal.
- Role work completed.
- Subagent decision: used / downgraded_to_deep / unavailable_partial / blocked, with reason.
- Files or surfaces changed.
- Patch envelope for each real code-changing lane.
- Rollback hint for risky or multi-file changes.
- Runtime/tmux/browser evidence when used.
- Cross-verification result.
- Doctor/scanner result.
- Cleanup status.
- Truth status: proven, verified, partial, fixture_only, fixture_instrumented_real, integration_optional, real_required_missing, skipped, blocked, or assumed.

Use `references/context-reuse.md`; read project pack before broad context.
Use `references/runtime-orchestration.md` only when runtime evidence is needed.
Use `references/doctor-scan.md` before final mission completion.
Use `references/db-supabase-safety-lite.md` for destructive DB/Supabase, migration, production-write, or RLS/policy lanes.
Use `references/current-docs.md` when any lane depends on current SDK/API/cloud-service behavior.
Use `references/honest-completion.md`; do not overclaim.
Use `references/final-report.md` to close with remaining tasks and fix-first items.
Use `references/token-budget-reporter.md` when budget drift matters.

## Prompt Pattern

Good mission prompts include:

- Goal.
- Scope.
- No-go rules.
- Acceptance criteria.
- Runtime/browser needs.
- Required final checks.

If the user invokes `$mission` without an approved plan, ask for the plan or propose a compact plan first.

## Final Response

Report:

- What the mission changed.
- Role/cross-verification summary.
- Evidence gathered.
- Truth status.
- Cleanup status.
- Remaining tasks.
- Fix-first items before planned tasks.
