---
name: quick
description: Fast implementation route for small changes, focused bug fixes, and quick error scans. Use when the user invokes $quick or asks for a quick scoped fix.
---

# yam Quick

Use for:

- Copy, label, spacing, color, small CSS, and small docs edits.
- Narrow bug fixes and ordinary scoped implementation.
- Fast error scans for build/type/lint/test failures.
- Small UI tweaks that do not need design exploration or visual review loops.

Do not use for:

- Design-heavy UI work or reference-image interpretation. Use `$ueye`.
- Risky, broad, or runtime-heavy work. Use `$deep`.
- DB/Supabase destructive commands, production writes, migrations, RLS, or schema changes. Recommend `$deep`.
- Real subagent/team implementation. Use `$mission`.
- Pure Q&A. Use `$question`.

## Principles

- Direction before execution.
- Context-reuse first.
- Token economy is part of quality.
- Start with the smallest likely edit surface.
- Follow existing project architecture, naming, UX flow, and test style.
- Verify at the lightest level that honestly supports completion.
- Do not use teams, orchestration, structured proof, or tmux.
- Do not run broad test suites for tiny changes.

## Lanes

Patch lane:

1. Read `yam.project.md` or `.yam/memory/summary.md` only when present and useful.
2. Inspect the smallest relevant file or nearby pattern.
3. Make the minimal change.
4. Re-read the changed snippet.
5. Run at most one or two focused checks when useful.

Build-fix lane:

1. Detect the smallest useful command from package scripts or project pack.
2. Group errors by file and root cause.
3. Fix one error class at a time.
4. Read only the local error context, usually the file and nearby imports.
5. Re-run the same focused command.
6. Stop if the same error survives three attempts, errors expand, dependency installation is needed, or the fix implies architecture change.

Scan lane:

1. Inspect the current error output or run the smallest detector.
2. Report grouped issues and the safest first fix.
3. Edit only when the user asked for implementation.

## Verification

- Copy/CSS/docs: Level 0 is often enough after re-reading the changed snippet.
- TS/JS or app logic: prefer typecheck, related test, lint, or build in that order when available.
- Build-fix: use a compact PASS/FAIL matrix for command results.
- If verification is skipped, partial, blocked, or assumed, say that plainly.

Use `references/quick.md` for the merged fast/build rules.
Use `references/truth-matrix.md` for truth labels.
Use `references/db-supabase-safety-lite.md` when a command or prompt contains DB/Supabase mutation signals.
Use `references/token-economy.md` to keep context small.
Use `references/context-reuse.md` before broad project reading.
Use `references/final-report.md` to close with remaining tasks and fix-first items when useful.
Use `references/token-budget-reporter.md` when a run needs measured budget feedback.

## Final Response

Keep it compact:

- What changed or what the scan found.
- Study Note when useful: what code was wrong, what role it has, how the symptom showed up, what changed, and why it matters in short non-specialist language.
- What was checked.
- What was skipped, blocked, or still risky.
- Handoff when useful: fix-first items, remaining tasks, recommended direction, and why that next step matters.
