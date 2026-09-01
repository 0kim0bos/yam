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

- Copy/CSS/docs: L1 is often enough after re-reading the changed snippet.
- TS/JS or app logic: prefer typecheck, related test, lint, or build in that order when available.
- Build-fix: use a compact PASS/FAIL matrix for command results.
- If verification is skipped, partial, blocked, or assumed, say that plainly.
- Escalate beyond L2 only when the changed behavior, user-facing impact, or risk surface needs it.

Use `references/quick.md` for the merged fast/build rules.
Use `references/verification-levels.md` for the L0-L5 ladder.
Use `references/truth-matrix.md` for truth labels.
Use `references/db-supabase-safety-lite.md` when a command or prompt contains DB/Supabase mutation signals.
Use `references/token-economy.md` to keep context small.
Use `references/context-reuse.md` before broad project reading.
Use `references/study-note.md` when any code, config, docs, or project artifact changed; include role, execution point, before/after, expected behavior, one syntax/structure insight, verification, limits, and architecture hygiene when relevant.
Use `references/final-report.md` to close with remaining tasks and fix-first items when useful.
Use `references/token-budget-reporter.md` when a run needs measured budget feedback.

## Final Response

Keep it compact:

- What changed or what the scan found.
- Study Note when code, config, docs, or project artifacts changed: what changed, what role it has, where it runs or is read, what was wrong or missing, before/after behavior, what behavior is expected, one useful syntax/structure insight, what was verified, and what remains uncertain.
- Next step immediately after Study Note when artifacts changed; use `references/next-step.md` to record the whole-process scan, critical opinion, recommendations, and ordered fix-first then planned actions.
- Architecture hygiene when relevant: flag if the change risks dumping unrelated logic into `page.tsx`, one-off component CSS into `global.css`, or structured product data into broad DB `jsonb` blobs.
- What was checked.
- What was skipped, blocked, or still risky.
- Handoff when useful: fix-first items, remaining tasks, recommended direction, why that next step matters, blocker kind, safe retry, evidence level/stamp, and owner scope when another route or person may continue.
