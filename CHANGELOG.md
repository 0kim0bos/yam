# Changelog

All notable changes to yam-flow are documented here.

## v2.0.0 - 2026-06-24

### Added

- Extended `yam loop report --json` with lightweight requirement coverage, `failure_cause`, `recovery_hint`, and `avoidance_note` so handoff artifacts can show what must still be covered before a completion claim.
- Added `readiness_receipt` to `yam release report --json` to summarize the read-only evidence basis for package/version, registry, auth, git, dist, tarball, and release-check readiness.

### Improved

- Uncovered loop requirements now block verified truth, default `blocked_kind` to `requirement_uncovered`, and point the default next action at the first uncovered requirement.
- Documented that loop avoidance notes are report-only; durable learning remains explicit through `yam memory add`.

### Verification

- `npm run typecheck`
- `npm run build`
- `npm run cli-smoke`
- `npm run verify:self`
- `node ./dist/bin/yam.js loop report --json` with uncovered requirement truth blocking
- `node ./dist/bin/yam.js release report --json` (blocked as expected by npm auth readiness and dirty git, with `readiness_receipt`)

## v1.9.1 - 2026-06-19

### Added

- Extended `yam loop report --json` with guided stage conventions, `evidence_level`, `evidence_stamp`/`source_digest`, `blocked_kind`, `safe_retry`, `owner_scope`, `scope_owner`, and `side_effects` so the report can act as a clearer handoff artifact without adding a new command.
- Updated loop report smoke coverage to assert the new handoff fields.

### Improved

- Updated README, COMMANDS, final-report guidance, implementation skill final-response rules, and manifest principles to prefer fix-first handoff with evidence level, blocker kind, safe retry, and owner/scope clarity.

## v0.1.9 - 2026-06-18

### Added

- Expanded `yam loop report --json` into a read-only handoff artifact with `fix_first_items`, `recommended_direction`, `implementation_notes`, `why_this_next`, `blocked_by`, and `owner_route`.
- Added loop report smoke coverage for the new handoff fields while keeping the existing minimal and blocked report paths.

### Improved

- Updated `$quick`, `$deep`, `$mission`, and `$ueye` final response guidance so implementation work can include Study Note and handoff habits without forcing a CLI artifact for ordinary work.
- Updated `references/final-report.md`, README, COMMANDS, and manifest principles to treat Study Note and handoff direction as final-report practices.

### Verification

- `npm run typecheck`
- `npm run build`
- `node ./dist/bin/yam.js loop report --json` with handoff fields
- `npm run cli-smoke`
- `npm run verify:self`
- `npm run forbidden-names:check`
- `npm run package-boundary:check`
- `npm run dist:freshness`

## v0.1.8 - 2026-06-16

### Added

- Added `yam loop report [--json]` as a read-only loop artifact for intent, stages, evidence, blockers, next action, remaining tasks, tool intent, truth status, and study note.
- Added `yam.study-note.v1` so reports can carry short non-specialist explanations of the failing code, its role, observed symptom, changed code, why it matters, and learning note without guessing missing details.
- Added `publish_readiness` and `study_note` to `yam release report --json` with read-only npm registry/auth/version probes and redacted account/token details.
- Added Ueye `design_brief` and `anti_slop_review` fields with `--brief-dimension`, `--constraint`, `--anti-slop`, `--invented-metric`, `--placeholder-copy`, and `--generic-visual`.

### Improved

- Ueye anti-slop P0 findings now feed the design completion gate so `done` claims are blocked until fix-first issues are resolved.
- Release reports now separate publish readiness evidence from the publish action; `npm publish` remains outside the report.
- CLI smoke coverage now asserts loop report, study note limits, and Ueye design brief/anti-slop blocked paths.

### Verification

- `npm run typecheck`
- `npm run build`
- `npm run cli-smoke`
- `npm run verify:self`
- `npm run forbidden-names:check`
- `npm run package-boundary:check`
- `npm run dist:freshness`
- `node ./dist/bin/yam.js release report --json` (blocked as expected by npm auth readiness and dirty git)
- `npm whoami --registry https://registry.npmjs.org/` (E401, confirms auth/token blocker)

## v0.1.7 - 2026-06-12

### Added

- Added `yam context pressure [dir] [--json]` to explain when project context is becoming stale, broad, or confusing enough to summarize, refresh the project pack, narrow scope, or deepen the route.
- Added `yam cleanup scan [dir] [--json]` as a read-only advisory cleanup report for active hooks, project-local skill folders, competing instruction surfaces, old install traces, and stale proof/runtime artifacts.
- Added `contextPressure` and `realProbe` sections to `yam tools doctor --json` so readiness reports show local availability without starting browsers, servers, databases, or long-running processes.
- Added `publishBlockerEvidence` to `yam release report --json` to classify common npm auth, permission, OTP, immutable-version, cache, registry, and tarball/package-boundary failures into beginner-readable next actions.
- Added `yam ueye preflight [dir] [--json]` for pre-work UI/design quality checks before screenshots are available.
- Added optional Ueye report fields: `--preflight-id`, `--p0-risk`, and `--quality-gate-note`.
- Added stronger runtime cleanup evidence fields for `started_at`, `stopped_at`, `exit_code`, `pid`, `port`, `cleanup_method`, `cleanup_observed`, and `left_running_intentionally`.

### Improved

- Runtime cleanup claims no longer become `proven` from `--cleanup-checked` alone; observed cleanup plus exit/closure evidence is required.
- Ueye preflight can identify likely P0/P1 design risks while keeping completion truth capped until real implementation screenshot/comparison evidence exists.
- Release reports now turn likely npm publish blockers into safe next actions instead of leaving beginners with only raw npm logs.
- CLI smoke coverage now asserts JSON schemas and truth caps for context pressure, cleanup scan, tools doctor, Ueye preflight/report, and runtime cleanup evidence.

### Verification

- `npm run typecheck`
- `npm run forbidden-names:check`
- `npm run verify:self`
- `npm run cli-smoke`
- `npm run dist:freshness`
- `npm run package-boundary:check`
- `npm_config_cache=/private/tmp/yam-npm-cache npm pack --dry-run`
- `node ./dist/bin/yam.js release report --json`

## v0.1.6 - 2026-06-07

### Added

- Added the Ueye Design Completion Gate so Ueye can own design/UI/UX completion quality instead of relying on a separate code-risk route to catch unfinished visual work.
- Added `yam ueye report --completion-claim`, `--strict`, `--design-score`, P0/P1, CTA, state, mobile/responsive, contrast/accessibility, direction, and reference-read gate fields.
- Added `yam proof --design-completion` so design completion evidence can cap proof truth status when a Ueye done claim is not supported.
- Added design completion sections to Ueye review and comparison templates.

### Improved

- Ueye `done` claims now cap to partial or blocked when implementation evidence, design quality, P0/P1 status, state coverage, mobile/responsive checks, contrast/accessibility checks, CTA checks, or reference-read/comparison evidence is missing where relevant.
- Ueye report JSON now includes `design_completion_gate` in both the main run report and comparison report.
- Expanded CLI smoke coverage for Ueye completion gate success, partial, and blocked paths.

## v0.1.5 - 2026-06-04

### Added

- Added Ueye surface context metadata for provider context, provider badge, execution surface, app surface, browser surface, control mode, preserved URL, preserved state, and evidence id.
- Added surface context output to `yam ueye capture`, `yam ueye compare`, and `yam ueye report` so visual evidence can say where and how it was observed.
- Added provider and execution surface fields to Ueye visual provenance records.

### Improved

- Strengthened `yam ueye report` for fast UI state preservation without making capture or compare an always-on gate.
- Updated Ueye docs and templates so visual proof can distinguish source files, local screenshots, in-app browser checks, and other execution surfaces.

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
