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
- PID, port, URL, session, pane, screenshot id, started_at, stopped_at, and exit_code when available.
- Checks before and after.
- Cleanup result.
- Truth status: proven, verified, partial, fixture_only, fixture_instrumented_real, integration_optional, real_required_missing, skipped, blocked, assumed.

## Runtime Evidence Mini

Use the mini shape when a final report, release report, or doctor scan needs runtime evidence without a full runtime proof artifact.

Minimum fields:

- `kind`: `runtime_evidence_mini`
- `route`: `deep` or `mission`
- `required`: true / false
- `command` or check name
- `target`: URL, port, process, or service
- `pid`, `port`, `url`, `exit_code`, `screenshot_id`, `started_at`, `stopped_at`
- `process`: session, pane, or `unknown` when process detail is unavailable
- `observation`: before and after notes
- `cleanup`: status and evidence
- `truth_status`
- `next_action`: one concrete follow-up when status is not fully proven

Truth caps:

- Missing process/target evidence cannot support `proven`.
- Missing cleanup evidence cannot support a cleanup-complete claim.
- Optional runtime checks may be `integration_optional`; required but unavailable runtime checks should be `real_required_missing`, `blocked`, or `partial`.

## Cleanup Rule

Do not claim cleanup succeeded unless one of these is true:

- Process exit was checked.
- tmux pane/session was checked closed.
- The process was intentionally left running and reported that way.

For `$deep` runtime verification and `$mission`, cleanup evidence matters more than a polished final sentence.
