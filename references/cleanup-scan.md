# Cleanup Scan

`yam cleanup scan` is advisory only.

It helps identify confusing local surfaces before a route starts drifting:

- active hooks
- project-local skill folders
- competing instruction files
- old skill/package traces
- stale proof or runtime artifacts

It must not delete, rename, disable, uninstall, or rewrite anything.

Use it when:

- routes feel unexpectedly heavy
- old instructions keep influencing a project
- install state is unclear
- proof artifacts may be mistaken for current evidence

Safe cleanup requires explicit user approval and a backup-minded next action.

Every finding should include:

- `risk_level`
- `surface`
- `why_it_matters`
- `safe_next_action`
- `destructive: false`
- `truth_status`

If cleanup is not needed, say so plainly and keep moving.
