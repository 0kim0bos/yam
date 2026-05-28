# Doctor Scan

Doctor scan is the final mission pass that looks for false completion, stale context, hidden failures, and avoidable follow-up risk.

It is not another broad implementation pass.

## Checklist

Direction:

- `yam.project.md` was read when project direction matters.
- The implementation still matches product direction, UI direction, tech stack, and no-go rules.
- New complexity is justified by the mission scope.

Changed surface:

- Changed files are within the approved mission scope.
- No unrelated refactors or metadata churn were introduced.
- Any generated files or markdown artifacts are intentional.

Verification:

- The smallest honest checks were run.
- Failed or skipped checks are reported.
- Browser, screenshot, or visual claims have actual visual evidence.
- Runtime/tmux/process claims have PID, port, session, pane, log, or equivalent evidence when relevant.

Cleanup:

- Dev servers, watchers, tmux panes, or child processes are stopped or intentionally left running.
- Cleanup is not claimed unless exit/closure was checked.
- Remaining running processes are named.

Truth status:

- `verified` or `proven` is used only when evidence supports it.
- `partial`, `blocked`, `skipped`, or `assumed` is used when appropriate.
- Fixture or mock evidence is not promoted to real runtime proof.

Report hygiene:

- Final answer includes remaining tasks when real work remains.
- Fix-first items are listed before planned tasks when they can block or distort the next run.
- The report is concise enough to avoid wasting context in the next session.

## Output Shape

```text
Doctor scan:
- Direction fit:
- Scope control:
- Verification:
- Runtime/cleanup:
- Truth status:
- Fix-first:
```
