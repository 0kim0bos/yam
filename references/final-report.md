# Final Report

Every `yam` route should end with a compact handoff that helps the next run avoid re-reading and re-planning.

## Required Closing Check

Always keep final reports short. Include these when they apply:

- What changed or what was found.
- Change insight for non-specialists: what the touched code or artifact does, what role it has, what changed, what behavior is expected, and what remains uncertain.
- What verification ran.
- What was not checked.
- Truth status, when verification or runtime claims matter.
- Security notes when auth, payment, DB, secrets, permissions, deployment, dependency, or public-release surfaces are relevant.
- Source boundaries when reference material shaped the decision.
- Context pressure or cleanup findings when they could affect the next run.
- Publish blocker evidence when npm/release work fails.
- Structured diagnostic next action, when a check found a concrete next step.
- Study Note whenever code, config, release metadata, documentation, or project artifacts changed, even if no yam skill was explicitly invoked. This item is required for changed artifacts, not optional.
- Remaining tasks.
- Fix-first items before planned tasks.
- Recommended direction and why that next step matters when the handoff would otherwise be ambiguous.

## Anti-False-Completion Check

Before final response, compare claim strength to evidence:

- Do not say `verified` unless a relevant check actually ran and passed.
- Do not say cleanup is complete unless exit/closure was checked or the process is intentionally left running.
- Do not say UI was reviewed unless a screen, screenshot, browser check, or equivalent visual evidence was inspected.
- Do not hide skipped or blocked checks.

Use `references/honest-completion.md` and `references/truth-matrix.md` when the route has meaningful verification claims.

## Remaining Tasks

Use this for work that still belongs to the current roadmap or request.

Examples:

- Implement the next UI state.
- Add browser verification.
- Move large component logic into a helper.
- Run build after a data-flow change.

## Fix-First Items

Use this for issues that should be considered before starting the next planned task because they can slow work, break verification, or distort product direction.

Examples:

- Current lint/build errors.
- Failing tests.
- Broken dev server.
- Stale `yam.project.md`.
- Active hooks or instruction files that conflict with the route.
- Warnings that keep obscuring real problems.

## Study Note

Use this whenever implementation changed code or any project artifact changed:

- What code or artifact changed.
- What role that code or artifact plays in the project.
- What was wrong, missing, unclear, or risky.
- What changed and what behavior the change should produce.
- One small syntax, API, schema, or structure insight for a non-specialist.
- What was verified, or why verification is partial/skipped/blocked.
- What remains uncertain.

Keep it short: 4-7 lines for ordinary work, longer only when risk, learning value, `$deep`, `$mission`, release, runtime, or DB work justifies it. If the information is not known, say so instead of inventing it.

Use `references/study-note.md`.

## Handoff Direction

Use this when the next run needs a clear starting point:

- Fix-first items before planned work.
- Remaining tasks that still belong to the request or roadmap.
- Recommended direction.
- Why this next step matters.
- What is blocked, and by what.
- Covered and uncovered requirements when the next run could otherwise overclaim completion.
- Evidence level or stamp when the handoff relies on a specific command, file, or report.
- Blocker kind, failure cause, recovery hint, and safe retry when the next run should not blindly repeat the same action.
- Avoidance note when a repeated mistake should be easy to spot; durable memory still uses explicit `yam memory add`.
- Owner route, scope owner, and side effects when more than one person or route may continue the work.

`yam loop report` can record this as a handoff artifact with `fix_first_items`, `remaining_tasks`, `recommended_direction`, `implementation_notes`, `why_this_next`, `blocked_by`, `covered_requirements`, `uncovered_requirements`, `blocked_kind`, `failure_cause`, `recovery_hint`, `safe_retry`, `evidence_level`, `evidence_stamp`, `owner_route`, `owner_scope`, `scope_owner`, `side_effects`, and `avoidance_note`.

## Route Weight

For `$quick`, one short paragraph or a compact verification matrix is enough.

For `$ueye`, include source evidence, states/viewports checked, and P0-P3 issues only when they matter.

For `$deep` and `$mission`, include evidence, remaining risks, remaining tasks, and fix-first items.

Do not pad the final answer when there are no meaningful remaining tasks or fix-first items, but say so plainly when the user expects a handoff.

When budget drift matters, include or run `yam measure <route>` with approximate files, commands, report lines, and seconds.

## Diagnostic Next Action

When a report says something needs attention, include one concrete next action instead of a vague warning.

Compact shape:

```text
Diagnostic next action:
- severity:
- owner route:
- priority:
- fix first:
- blocks release:
- evidence:
- next action:
- truth status:
```

Use `none` when there is no meaningful next action.
