# Runtime Verification

Runtime verification now lives inside `$deep` and may be used by `$mission`.

It combines tmux/process management, cleanup confirmation, browser QA, and proof summary when a verification claim needs runtime evidence.

Use for:

- Long-running dev servers.
- Test watchers.
- Multi-step broad tasks.
- Browser QA sessions.
- Work requiring before/after evidence.

Do not use for ordinary small edits.

## tmux Policy

tmux is a first-class runtime verification tool in `yam`, but it is not automatic.

Use tmux when it improves the work:

- Long-running dev servers.
- Test watchers.
- Multiple concurrent panes.
- Work where preserving logs or panes helps verification.
- Tasks that need a stable server while browser QA runs.

Do not use tmux just to make a small task look more verified.

When tmux is used, record:

- Session name.
- Pane id when available.
- Command running in the pane.
- Before/during/after observation.
- Whether the pane was left running intentionally or closed.

Runtime proof should include:

- Goal.
- Steps run.
- Commands/processes started.
- PIDs, ports, sessions, or panes when available.
- Checks before and after.
- Cleanup result.
- Truth status: proven, verified, partial, fixture_only, fixture_instrumented_real, integration_optional, real_required_missing, skipped, blocked, assumed.

## Cleanup Rule

Do not claim cleanup succeeded unless one of these is true:

- Process exit was checked.
- tmux pane/session was checked closed.
- The process was intentionally left running and reported that way.

For `$deep` runtime verification and `$mission`, cleanup evidence matters more than a polished final sentence.
