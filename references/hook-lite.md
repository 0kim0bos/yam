# Hook Lite

`yam-lite` is an opt-in advisory hook.

It exists to keep yam's direction present without turning every request into a proof gate.
It does not mean `yam` itself should stay shallow; it only keeps the always-on layer small enough to preserve momentum.

## Contract

Allowed:

- Add short route guidance through `UserPromptSubmit` additional context.
- Remind the agent to check project direction and keep ordinary work moving.
- Remind the agent not to overclaim verification, cleanup, or visual evidence.
- Suggest `$quick`, `$ueye`, `$question`, `$scout`, `$deep`, or `$mission` based on obvious prompt signals.
- Mention a project pack or memory summary when present.
- Warn when conflicting proof-harness surfaces are active in the current project.

Not allowed:

- Run verification commands.
- Start tmux, browser QA, dev servers, or subagents.
- Block tools or permissions.
- Read broad project context.
- Force `$quick` or any other route.
- Install dependencies.
- Modify source files.

## Toggle

```bash
yam hook status --global
yam hook enable lite --global
yam hook disable lite --global

yam hook status --project /path/to/project
yam hook enable lite --project /path/to/project
yam hook disable lite --project /path/to/project
```

Global hooks write to `~/.codex/hooks.json`.

Project hooks write to `<project>/.codex/hooks.json`.

`yam` backs up an existing hook file before enabling the lite hook.

## Design Baseline

Broad hook systems often use route prep, tool evidence, permission gates, subagent evidence, and stop gates.

Selective skill systems favor lower-context workflows.

Minimal-core systems avoid hooks unless the rule is short and changes behavior.

`yam` keeps this hook advisory-only so beginner momentum is preserved while the agent still receives a direction nudge. Deeper proof belongs in `$deep` and real team execution belongs in `$mission`, not in an always-on prompt hook.
