# Study Note

Study Note is required whenever code, config, release metadata, documentation, or project artifacts changed, even if no yam skill was explicitly invoked.

The goal is not to write a tutorial for every change. The goal is to help a non-specialist learn the meaning of the changed code a little at a time, without hiding uncertainty or padding the final report.

## Final Report Shape

This is final-report writing guidance, not a new CLI JSON schema. The current CLI artifact remains `yam.study-note.v1` with `problem`, `change`, `why_it_matters`, `learning_note`, `limits`, and `truth_status`. When using `yam loop report`, map the guidance below into the existing fields and put unknowns in `limits`.

Keep the default note short: 4-7 lines for ordinary work, longer only for `$deep`, `$mission`, release, DB, runtime, or learning-heavy work.

Include:

- Touched code/artifact: the file, function, component, config, or artifact that changed.
- Code/artifact role: what that code or artifact does in the project.
- Problem meaning: what was wrong, missing, unclear, or risky, and how the symptom appeared.
- Change meaning: what changed and what behavior the change should produce.
- Syntax or structure insight: one small language, API, schema, or structure insight for a non-specialist.
- Verification note: what was checked, or why verification is partial/skipped/blocked.
- Limits: what is not known; do not invent missing cause, behavior, or verification.

## Compact Example

```text
Study Note:
- Touched code: `buildLoopReport`, the function that turns loop inputs into report JSON.
- Code role: it decides whether a loop can honestly say it is verified, partial, or blocked.
- Problem meaning: a report could include unfinished requirements without making the completion risk obvious.
- Change meaning: `uncovered_requirements` now lowers the truth status to blocked and points the next action at the missing requirement.
- Syntax/structure: the code uses an array length check plus a conditional default to choose safer report fields.
- Verification: typecheck and CLI smoke covered the JSON shape.
- Limits: this does not infer requirements from prose; the agent/user still has to provide them.
```

## When Nothing Changed

For pure Q&A, planning, scouting, or review with no changed artifact, do not force a Study Note. Say `No code or project artifact changed` when that prevents ambiguity.

## Tone

- Use plain language before implementation jargon.
- Explain the code's responsibility before explaining the patch.
- Prefer one practical syntax or structure insight over broad teaching.
- Tie the note to evidence. If no check ran, say so.
- Keep remaining tasks separate from Study Note.

## What To Avoid

- Do not guess root cause when it was not verified.
- Do not over-explain common syntax when it distracts from the touched code.
- Do not turn every final report into a long lesson.
- Do not claim the user learned something; just leave a useful learning path.
