# Memory

`yam memory` is an opt-in, project-local memory layer.

It keeps only the lightest useful parts from heavier workflow patterns:

- Sparse records, one file per durable claim, and deliberate forgetting instead of injecting every old claim.
- Wrongness memory for repeated mistakes, wrong decisions, stale assumptions, and overconfident claims.
- Separate evidence, inference, and recommendation.
- Keep the mechanism small enough to obey.

Storage:

```text
.yam/memory/records/<id>.json
.yam/memory/summary.md
```

Use it for:

- Wrong decisions that should not be repeated.
- Repeated mistakes that waste time.
- Project direction changes.
- Lessons learned after a bug, failed implementation, or UX review.
- Verification command notes that should survive across sessions.

Do not use it for:

- Secrets, tokens, credentials, local private paths that should not be committed, or personal data.
- Full proof logs.
- Large research reports.
- Automatic gates or route enforcement.
- Every minor thought from a session.

Commands:

```bash
yam memory init .
yam memory add . --kind wrong_decision --summary "..." --evidence "..." --action "..."
yam memory list .
yam memory summary .
yam memory resolve . mem-YYYYMMDD... --note "..."
```

Kinds:

- `wrong_decision`
- `repeat_mistake`
- `direction_change`
- `lesson`
- `risk`
- `command`

Route behavior:

- Routes may read `.yam/memory/summary.md` only when the task is likely to repeat a known mistake or touch project direction.
- Routes should not read all memory records by default.
- If memory is stale or noisy, report that as a fix-first item instead of expanding context.
- Memory never proves completion by itself; it only informs direction and avoids repeated waste.
