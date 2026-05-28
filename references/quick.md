# Quick

`quick` is the merged small-work route: fast patching, ordinary scoped implementation, and fast error scanning.

## Selected Principles

Strict proof:

- Honest completion language.
- Real versus assumed verification.
- Stop instead of claiming success when evidence is missing.

Focused execution:

- Detect the smallest useful command.
- Group build/type/lint/test errors by file and root cause.
- Fix one error class at a time.
- Re-run the same focused command after a fix.
- Use a compact PASS/FAIL matrix.

Minimal core:

- Keep the instruction short enough to obey.
- Read the smallest useful context.
- Avoid ceremony unless it changes the result.

## Lanes

Patch:

- Best for copy, CSS, labels, simple bugs, small docs, and small config changes.
- Usually read 1-3 files.
- Usually run 0-1 command.

Build-fix:

- Best when there is a concrete command failure.
- Read the error output first.
- Sort dependency/import/type errors before logic errors.
- Fix one root cause before moving to the next.

Scan:

- Best when the user wants to know what is broken before editing.
- Report grouped errors, likely root cause, smallest first fix, and verification command.
- If the scan sees destructive DB/Supabase, migration, production write, or RLS/policy signals, stop quick mode and recommend `$deep`.

## Stop Conditions

Stop or recommend a heavier route when:

- The same error survives three focused attempts.
- A fix creates more errors than it removes.
- The change requires a new dependency, architecture change, or broad refactor.
- The surface touches auth, payments, data mutation, security, deployment, or process lifecycle.
- The requested work needs visual reference interpretation or screenshot-led QA.

## Verification Matrix

Use this compact shape when commands were run:

```text
Verification:
- typecheck: pass/fail/skipped
- lint: pass/fail/skipped
- test: pass/fail/skipped
- build: pass/fail/skipped
```

Only include rows that matter to the actual run.
