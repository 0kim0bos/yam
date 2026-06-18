---
name: deep
description: Heavy verification route for risky or user-requested deep work. Use when the user invokes $deep or explicitly asks for strong verification.
---

# yam Deep

Use for:

- Auth, payment, DB, security, deployment, or release work.
- Broad refactors.
- Regressions with unclear cause.
- User-requested heavy verification.
- Work where false completion would be costly.
- Long-running verification using dev servers, test watchers, browser QA, tmux, or process cleanup.
- Broad or risky work that does not require real subagent/team execution.
- `$mission` requests that cannot use real subagents; downgrade to `$deep` and report why.

## Principles

- Direction before execution.
- Token economy still matters, even in deep mode.
- Reuse `yam.project.md` before broad context reading when present.
- Strong verification is allowed here, but still bounded.
- Prefer focused evidence over ceremony.
- Stay single-agent by default; if real team/subagent execution is required, use `$mission`.
- Do not claim verified without actual evidence.
- Use runtime/tmux/process orchestration only when the verification claim needs it.
- Do not start long-running processes just to make small work look more proven.
- Do not claim cleanup unless process exit, tmux pane/session closure, or intentional persistence is confirmed.

## Workflow

1. Define the risk surface.
2. Identify acceptance criteria.
3. Build a focused verification plan.
4. Implement or inspect within scope.
5. Start dev servers, test watchers, tmux panes, or browser QA only when they materially support verification.
6. Run appropriate checks: tests, typecheck, build, browser QA, security, runtime, or data safety checks.
7. Confirm cleanup when claiming cleanup.
8. Classify truth status with `references/truth-matrix.md`.
9. Report proof summary and remaining risk.

## Verification

Use Level 4 from `references/verification-levels.md`.
Use `references/token-economy.md`; wider context is allowed only when tied to the risk surface.
Use `references/context-reuse.md`; update stale project packs narrowly when needed.
Use `references/markdown-management.md` before writing broad proof or direction markdown.
Use `references/runtime-orchestration.md` when long-running processes, tmux, browser QA, or cleanup proof are needed.
Use `references/db-supabase-safety-lite.md` for destructive DB/Supabase, migration, production-write, or RLS/policy work.
Use `references/current-docs.md` when SDK/API/cloud-service behavior may be current or version-sensitive.
Use `references/trust-kernel.md` when the task asks how yam prevents false completion or fake real proof claims.
Use `references/honest-completion.md`; do not overclaim verification, runtime, cleanup, or visual proof.
Use `references/final-report.md` to close with remaining tasks and fix-first items when useful.
Use `references/token-budget-reporter.md` when a run needs measured budget feedback.

Deep verification may include:

- Test suite or relevant suites.
- Build.
- Browser QA.
- Dev server, test watcher, tmux, or process lifecycle checks.
- Security or migration checks.
- Before/after screenshot.
- Risk-specific manual inspection.

## Final Response

Include:

- What was changed or reviewed.
- Study Note for implementation work: what code was wrong, what role it has, how the symptom showed up, what changed, and why it matters in short non-specialist language.
- Evidence gathered.
- Truth status.
- Blockers or remaining risk.
- Handoff: fix-first items, remaining tasks, recommended direction, and why that next step matters.
