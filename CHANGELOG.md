# Changelog

All notable changes to yam-flow are documented here.

## v0.1.4 - 2026-06-03

### Added

- Added `yam runtime evidence` details for pid, port, URL, exit code, screenshot id, and runtime timing metadata.
- Added `yam mission queue` patch queue items with lane id, status, dependencies, tool intent, patch envelope, rollback hint, optional JSON output, and queue depth.
- Added Ueye review continuity fields for resolved findings, new findings, still-open items, regressions, viewport, state, previous screenshot id, and current screenshot id.
- Added release tarball provenance and release freshness summaries to `yam release report`.
- Added structured diagnostic next-action metadata with priority, owner route, tool intent, fix-first, and release-blocking signals.
- Added `yam benchmark report` for compact before/after performance notes.

### Improved

- Expanded CLI smoke coverage for Ueye report continuity, runtime evidence, mission queue, and benchmark report commands.
- Strengthened docs, skill guidance, and templates for visual provenance, mission lane handoff, runtime proof, and final report evidence.
- Kept advanced scheduler, persistent queue, and attachment-gate ideas deferred so the default flow stays fast.

## v0.1.3 - 2026-05-31

### Added

- Added `yam ueye report` for compact visual run reports with reference sources, implementation screenshots, comparison result, design quality, next action, and truth status.
- Added `yam media proof` to record media generation attempts, outputs, blocked states, and proof caps without treating generated media as implemented UI evidence.
- Added runtime backend evidence fields to `yam proof`, including backend, claim, evidence id, command, cleanup check, and truth status.
- Added `yam doctor --json` with machine-readable issues and next-action hints.
- Added framework mini checklist output to `yam detect` and `yam tools doctor`.

### Improved

- Expanded Ueye proof guidance for reference evidence, implementation screenshots, comparison reports, and generated media limits.
- Extended CLI smoke checks to cover the new Ueye report and media proof commands.
- Kept visual and media proof helpers opt-in so fast routes remain lightweight.
