# yam Memory Summary

## Deferred Trigger Radar

Keep these notes small. Mention a deferred item only when its trigger appears in real work.

### Mission Patch Queue Lite

Mention when `$mission` uses two or more real subagent/lane outputs, nearby file edits become hard to track, or rollback/apply order starts to matter.

Recommended first step: mission-only queue metadata with lane id, assigned scope, changed files, verification hint, rollback hint, state, and truth status.

Avoid for now: automatic merge/apply engines, persistent locks, and parallel workers.

### Tool Intent Labels

Mention when routes combine several tool classes, or when read-only, write, destructive, runtime, and visual actions need clearer evidence.

Recommended first step: add tool intent, parallel safety, approval requirement, evidence kind, and truth status as metadata.

Avoid for now: automatic scheduling or mandatory tool graphs.

### MCP Scheduler Runtime

Mention only after tool intent labels are not enough, parallel tool execution becomes common, or write/destructive operations need deterministic ordering proof.

Recommended first step: scheduler proof object with read-only overlap, write/destructive serialization, and blocked/approved/skipped status.

Avoid for now: default scheduler, background runtime service, and route-wide mandatory scheduler.

### Appshots Attachment Gate

Mention only if Ueye visual provenance cannot identify the exact visual source, or a team/external workflow needs attachment-level audit trails.

Recommended first step: optional attachment source fields.

Avoid for now: required attachment ids or app-specific gates that block ordinary Ueye work.
