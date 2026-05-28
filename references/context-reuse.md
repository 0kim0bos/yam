# Context Reuse

One purpose of `yam` is to avoid re-reading the whole project and re-planning from scratch every run.

Default order:

```text
1. Read project direction pack if present.
2. Read `.yam/memory/summary.md` only when repeated mistakes or direction changes matter.
3. Read the specific files needed for the request.
4. Reuse known commands and constraints from the pack.
5. Expand context only when evidence shows the pack is stale or incomplete.
```

Preferred project pack:

```text
yam.project.md
```

What it should contain:

- Product direction.
- Current UI/design direction.
- Tech stack.
- Important commands.
- Test/build expectations.
- Key directories.
- Things not to do.
- Current known risks.
- Recent decisions.

Optional memory summary:

```text
.yam/memory/summary.md
```

Use it only for known wrong decisions, repeated mistakes, direction changes, and lessons that would otherwise be rediscovered.

Rules:

- Do not regenerate a broad plan when `yam.project.md` already answers the direction question.
- Do not reread architecture docs unless the task touches architecture.
- Do not reread full design docs for tiny UI work when the pack has the relevant style direction.
- If the pack is stale, update the pack narrowly instead of carrying stale assumptions in chat.
- Keep the pack short; it is a context-saving artifact, not a second README.
- Do not read every `.yam/memory/records/*.json` file by default; use `yam memory summary`.
- Follow `references/markdown-management.md` when creating or updating markdown surfaces.

Suggested size:

```text
500 to 1200 words.
```

Truth rule:

If no project pack exists, say that direction was inferred from local files, not from a maintained project pack.
