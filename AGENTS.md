# yam Core Rules

1. Direction before execution.
2. Start with clear momentum, then deepen deliberately when scope, risk, learning value, or user intent calls for it.
3. Treat token economy as part of quality.
4. Reuse project context packs before broad reading.
5. Read only the context needed for the requested change.
6. Check local project fit before changing code, even for small work.
7. Prefer existing project patterns over new abstractions.
8. Make the smallest useful change.
9. Verify at the lightest level that honestly supports the claim, then escalate verification with the L0-L5 Verification Ladder when the claim, scope, risk, public release, runtime, UI completion, auth, DB, broad refactor, learning value, or user intent is larger.
10. Report skipped, partial, blocked, or assumed verification plainly.
11. Do not run broad tests for tiny changes, but do not under-verify risky, security-sensitive, or public work.
12. Do not use teams, orchestration, structured proof, or tmux unless risk, user intent, learning value, or an approved route justifies it.
13. Escalate risky work by asking or recommending, not by silently switching modes.
14. For UI work, inspect real states and responsive behavior when feasible.
15. For long-running processes, do not claim cleanup unless process exit is checked.
16. When code, config, release metadata, documentation, or project artifacts changed, include a Study Note even if no yam skill was explicitly invoked.
17. Explain useful change insight for non-specialists: what the touched code or artifact does, what role it has, where it runs or is read, what was wrong or missing, what changed before/after, what behavior is expected, one useful syntax/structure insight, what was verified, and what remains uncertain.
18. Use external references deliberately, preserve source clarity in research/proof notes, and rework good ideas into yam style.
19. Treat security as the first project lens: identify sensitive surfaces early and guide safer defaults before convenience.
20. Keep final reports short and concrete, but always include remaining tasks or state that none are meaningful.
21. When relevant, include architecture hygiene in the Study Note: avoid dumping unrelated logic into `page.tsx`, one-off component CSS into `global.css`, or structured product data into broad DB `jsonb` blobs when existing project boundaries, scoped styles, typed tables, constraints, or indexes fit better.
22. When an artifact changed, put `Next step` immediately after Study Note. Build it from a quick whole-process scan with current situation, forward outlook, a concrete critical opinion, improvement recommendations, and ordered fix-first then planned actions with evidence and ownership; do not merely rename remaining tasks.

## Latest Update Trigger

When the user says exactly `yam 최신 업데이트 사항 반영해줘` in a chat for this project, treat that phrase as explicit authorization to check and apply reviewed updates for yam, Scrapling, and Insane Search.

Run these commands sequentially from the yam project directory:

```bash
yam update check --json
yam update apply --all --json
yam version
yam status
```

- Request any environment approval required for network access or writes outside the workspace.
- Stop at the first failed command, report the blocker, and do not claim that later steps ran.
- Treat that exact phrase as one-time authorization for this run only; do not create an unattended updater, hook, or automation.
- Never edit `.codex/plugins/cache` directly. If Insane Search cannot be updated in place through the official Codex CLI, report `manual_plugin_update_required` and stop.
- After all four commands pass, summarize every component receipt, report the installed yam version and skill status, then tell the user that Codex can be restarted to reload updated skills/plugins.
- Do not restart Codex automatically.
