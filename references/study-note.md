# Study Note v4

Study Note is required whenever code, config, release metadata, documentation, or project artifacts changed, even if no yam skill was explicitly invoked.

The goal is not to write a tutorial for every change. The goal is to help a non-developer or non-specialist learn the meaning of the changed code or artifact a little at a time, without hiding uncertainty or padding the final report.

Study Note v4 retains the v3 expectations and adds one report-ordering rule:

- Explain where the changed code or artifact sits in the project flow: role, execution point, before/after behavior, and expected result.
- Add a small architecture hygiene check when implementation touched UI, styles, data shape, or storage boundaries.
- Put `Next step` immediately after Study Note. Build it from a quick whole-process scan, not only from leftover tasks; use `references/next-step.md` for its ordered, evidence-bound shape.

## Final Report Shape

This is final-report writing guidance, not a new CLI JSON schema. The current CLI artifact remains `yam.study-note.v1` with `problem`, `change`, `why_it_matters`, `learning_note`, `limits`, and `truth_status`. When using `yam loop report`, map the guidance below into the existing fields and put unknowns in `limits`.

Keep the default note short: 4-7 lines for ordinary work, longer only for `$deep`, `$mission`, release, DB, runtime, or learning-heavy work.

Include:

- Touched code/artifact: the file, function, component, config, or artifact that changed.
- Code/artifact role: what that code or artifact does in the project.
- Execution point: when or where it runs, loads, renders, validates, builds, publishes, or is read by another tool.
- Problem meaning: what was wrong, missing, unclear, or risky, and how the symptom appeared.
- Before/after: what the old behavior or guidance allowed, and what the new behavior or guidance should produce.
- Syntax or structure insight: one small language, API, schema, or structure insight for a non-specialist.
- Verification note: what was checked, or why verification is partial/skipped/blocked.
- Limits: what is not known; do not invent missing cause, behavior, or verification.

When relevant, include an architecture hygiene line:

- UI hygiene: do not dump unrelated state, data loading, actions, formatting, and large helper logic into `page.tsx`; keep route files focused and move reusable or complex work into local components, hooks, utilities, or server actions that match the project pattern.
- CSS hygiene: do not dump one-off component styling into `global.css`; prefer existing tokens, component styles, modules, utility classes, or scoped styles unless the rule is genuinely global.
- Data hygiene: do not use a broad DB `jsonb` blob as the default answer for structured product data; prefer named columns, typed tables, constraints, indexes, and migrations when the data has stable meaning, query needs, security policy, or reporting value.
- Boundary hygiene: keep auth, payment, DB, secret, release, and public-facing surfaces explicit; note when a change did or did not touch those sensitive paths.

## Compact Example

```text
Study Note:
- Touched code: `buildLoopReport`, the function that turns loop inputs into report JSON.
- Code role: it decides whether a loop can honestly say it is verified, partial, or blocked.
- Execution point: it runs when `yam loop report` builds the final report artifact.
- Before/after: before, unfinished requirements could be easy to miss; after, `uncovered_requirements` lowers the truth status to blocked and points the next action at the missing requirement.
- Syntax/structure: the code uses an array length check plus a conditional default to choose safer report fields.
- Verification: typecheck and CLI smoke covered the JSON shape.
- Hygiene: report logic stayed in the report builder instead of spreading status rules across unrelated command code.
- Limits: this does not infer requirements from prose; the agent or user still has to provide them.
```

## When Nothing Changed

For pure Q&A, planning, scouting, or review with no changed artifact, do not force a Study Note. Say `No code or project artifact changed` when that prevents ambiguity.

## Tone

- Use plain language before implementation jargon.
- Explain the code's responsibility before explaining the patch.
- Explain the execution point before claiming behavior.
- Prefer one practical syntax or structure insight over broad teaching.
- Tie the note to evidence. If no check ran, say so.
- Keep remaining tasks separate from Study Note.
- Do not insert another final-report section between Study Note and Next step when artifacts changed.

## What To Avoid

- Do not guess root cause when it was not verified.
- Do not over-explain common syntax when it distracts from the touched code.
- Do not turn every final report into a long lesson.
- Do not claim the user learned something; just leave a useful learning path.
- Do not present "put it all in `page.tsx`", "put it all in `global.css`", or "store it all in `jsonb`" as the easy default when project structure should carry the responsibility.
