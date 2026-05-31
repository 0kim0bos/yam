# Changelog

All notable changes to yam-flow are documented here.

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
