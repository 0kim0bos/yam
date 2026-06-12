# Truth Matrix

Use precise verification language.

```text
verified
Actual command, browser check, screenshot, or test passed.

proven
Runtime-specific: physical or process evidence supports the claim, such as a live server response, browser check, tmux pane evidence, or verified process exit.

partial
Some meaningful checks passed, but not the full surface.

fixture_only
Fixture or mock evidence exists, but it cannot support a real runtime claim.

fixture_instrumented_real
A real backend or process was involved, but the run was shaped by fixture instrumentation. Do not report it as fully proven.

integration_optional
A live integration/runtime check was optional and not requested. This is not a failure, but it is not verified.

real_required_missing
The user or route required live runtime evidence, but that evidence was unavailable.

skipped
Verification intentionally skipped because the change is tiny or not runnable.

blocked
Verification could not run because of environment, tool, auth, network, or time limits.

assumed
Reasonable inference from code reading, but no execution evidence.
```

Never say `verified` when the correct status is `partial`, `skipped`, `blocked`, or `assumed`.

Never say `proven` for runtime work unless the runtime evidence exists.

Never say cleanup is `proven` from a cleanup intention alone. Cleanup needs observed exit, closure, or an explicit intentional-left-running record.

Never say full visual `verified` when the only evidence is a reference image, generated image, code reading, or text-only critique.

Ueye preflight is `partial` by design. It can identify design risks before work starts, but it cannot prove visual quality without implementation screenshot/comparison evidence.

For ordinary routes, prefer `verified`, `partial`, `skipped`, `blocked`, or `assumed`.
For `$deep` runtime verification and `$mission`, use the more precise runtime statuses when they prevent overclaiming.

`yam` implements a small truth cap in `src/lib/trust-kernel.ts`.
If requested truth is stronger than evidence, cap it downward and report the cap.
