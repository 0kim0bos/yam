# Final Report

Every `yam` route should end with a compact handoff that helps the next run avoid re-reading and re-planning.

## Required Closing Check

Include these when they are useful and keep them short:

- What changed or what was found.
- What verification ran.
- What was not checked.
- Truth status, when verification or runtime claims matter.
- Structured diagnostic next action, when a check found a concrete next step.
- Remaining tasks.
- Fix-first items before planned tasks.

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

## Route Weight

For `$quick`, one short paragraph or a compact verification matrix is enough.

For `$ueye`, include source evidence, states/viewports checked, and P0-P3 issues only when they matter.

For `$deep` and `$mission`, include evidence, remaining risks, remaining tasks, and fix-first items.

Do not pad the final answer when there are no meaningful remaining tasks or fix-first items.

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
