# Token Economy

Token economy is part of quality.

Default behavior:

- Read `yam.project.md` first when present.
- Start with the narrowest likely file set.
- Prefer `rg`, file names, and local snippets over broad reading.
- Read nearby patterns before reading whole modules.
- Summarize large files instead of loading full context when possible.
- Stop searching once the edit surface is clear.
- Do not open long docs or generated files unless they are directly needed.
- Treat `yam.project.md` as the reusable context source; inspect it with `yam pack` when it seems stale.
- Do not produce long reports for small work.
- Use `yam measure <route>` after real runs when budget drift needs tuning.

Suggested read budgets:

```text
quick
- Start with 1 to 3 files for patch work.
- Allow a small module or error surface only when the first hypothesis fails or the scan points wider.
- Prefer one focused command, two at most.

ueye
- Project direction, source screen, target component, nearby styles/tokens.
- Avoid full design-system archaeology for simple tweaks.
- Visual claims require source-screen evidence or a partial truth cap.

question
- 0 to 2 files.
- Prefer current conversation context and stable knowledge.
- Switch to scout when evidence, source freshness, or comparison matters.

scout
- 3 to 7 high-signal sources.
- Prefer official docs and primary sources.

deep
- Wider single-agent reading is allowed, but explain why.
- Runtime/tmux/browser context should be tied to verification evidence.

mission
- Wider reading is allowed only for approved real subagent/team execution.
- Runtime/tmux/browser context should be tied to mission evidence.
```

Measured budgets:

```bash
yam measure quick --files 3 --commands 1 --report-lines 5 --seconds 40
yam measure deep --files 18 --commands 4 --report-lines 32 --seconds 900
```

Escalate reading only when:

- The first edit surface is wrong.
- Tests or runtime output contradict the hypothesis.
- Risk surface is broader than expected.
- The user asks for deeper analysis.
