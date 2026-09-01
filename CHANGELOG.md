# Changelog

All notable changes to yam-flow are documented here.

## v2.8.0 - 2026-09-01

### Added

- Added `yam.next-step.v1` plus CLI create/verify commands and Loop integration. Changed-artifact reports now require an evidence-bound whole-process scan, critical opinion, recommendations, and ordered fix-first/planned work immediately after Study Note.
- Added pure `yam install --dry-run --json` plans with ownership-aware operations, explicit replacement previews, deterministic plan digests, and no mutation authorization.
- Added immutable `yam.scout-receipt.v1` source/claim baselines with canonical entity aliases, four freshness clocks, acquisition-failure taxonomy, claim links, local integrity verification, and explicit operator-supplied truth boundaries.
- Added clean-source and strict signed-release ref gates plus exact-tarball Linux/macOS/Windows lifecycle workflows and explicit manual-dispatch npm OIDC/provenance publishing.

### Improved

- Strengthened Scout guidance with canonical entity resolution, registry/release/main/latest-commit comparison, stable/RC/unreleased classification, opposition, stop reasons, and delta-scan receipts.
- Updater checks and component receipts now retain npm integrity/`gitHead`, PyPI release-file SHA-256 values, or the Git-pinned Insane Search manifest commit as applicable. Apply commands pin the official npm registry or isolated PyPI index, and Insane Search requires a clean tracked local manifest whose bytes match Git plus matching pre/post-add marketplace commits and pinned manifest versions.
- Registry readiness now probes the exact immutable package version, accepts only an explicit E404 as unpublished, fails closed on auth or network errors, and binds downstream release-report parsing to the same package/version identity.
- Install dry-run plans list unowned legacy, retired, and mirror paths that the real transaction preserves.
- README, commands, roadmap, project pack, route skills, manifest, package exports, and self-verification now describe and exercise the new contracts.

### Security

- Next step receipts reject unknown fields, contradictory blocker/truth combinations, weak evidence for strong claims, invalid ordering, limit overruns, and digest tampering.
- Scout receipts reject path escapes, symlinked paths, overwrite attempts, credential-bearing URLs, oversized or non-canonical content, incomplete clocks paired with a known stability, unknown claim sources, and digest drift while never trusting fetched content as instructions. Failed opened writes are preserved for manual inspection instead of using an unsafe pathname cleanup.
- Release workflows pin third-party actions to reviewed commit SHAs, grant OIDC only to the final no-checkout publish job, and require the publish artifact to match the independently carried SHA-256 receipt.

### Verification

- Focused typecheck/build, Next step, Scout receipt, install-transaction, external-update, packaged CLI, release-ref, and same-tarball lifecycle smokes.
- Full self-verification, package boundary/secrets, dependency audit/signatures, update/status/Doctor, Mission receipt gate, and bounded Deep false-completion audit are release criteria.

## v2.7.0 - 2026-08-24

### Added

- Added immutable final-scope verification closure receipts that bind declared work to the current Git dirty, staged, and untracked path set, promote release-sensitive changes, and separate selected checks from operator-declared execution evidence.
- Added optional demand-gated media provider receipts with exact call/execution/dry-run/submit state plus confined, identity-bound local asset provenance.

### Improved

- Skill installation and removal now use no-follow regular-file access where available, verify descriptor and path identity, and revalidate parent-directory identity around read, copy, move, rollback, and mutation boundaries.
- Verification closure and media receipt reads and immutable writes apply confined path, non-symlink parent, descriptor identity, size, and digest checks; media asset hashing is sequential and bounded.

### Security

- Symlinked install source/destination segments, raced path identities, rollback or cleanup targets whose recorded type/device/inode no longer match, unplanned final Git paths, unavailable Git scope, receipt path escapes, local asset symlinks, and incoherent provider-execution claims fail closed.
- Node does not expose descriptor-relative `openat` traversal, and arbitrary Windows reparse-point coverage remains unverified; these limits are documented instead of overstated.

### Verification

- Focused install-transaction and phase-adoption smokes cover source/destination race handling, rollback preservation, Git-scope drift, immutable/tampered receipts, bounded media assets, and packaged CLI compatibility.
- Release checks include typecheck, clean build/self-verification, distribution freshness, package boundary/secrets, registry version availability, and CLI smoke.

## v2.6.0 - 2026-08-07

### Added

- Added effective executable identity validation for global yam install and rollback, including npm global root, package/bin mapping, PATH target, canonical realpaths, and observed version.
- Added bounded paired-sample promotion receipts with explicit thresholds, deterministic evidence digests, operator-asserted measurement truth, and strict keep/revert gates.
- Added a capability matrix to `yam tools doctor --json` that separates maturity from observed runtime readiness.
- Added digest-bound strict gate results at release, external-update, Mission-completion, and benchmark-promotion boundaries.
- Added the opt-in Demand-Gated Design Production Phase: pre-recorded operator demand, local static Plan Review Canvas Lite, at most two chronologically finding-backed revisions, final gallery manifest, and digest-verifiable immutable phase receipt.

### Improved

- External update receipts preserve the deepest actionable Doctor or rollback failure as the primary blocker while keeping receipt persistence failures as secondary evidence.
- Ueye design-production artifacts bind one canonical revision state to its closed Canvas, enforce Canvas-comment and archive chronology at record time, and revalidate source, exact anchors, protected-asset editability, final-round gallery linkage, upstream digests, nested receipt semantics, session state, and aggregate state without upgrading those checks into visual, license, or implementation proof.

### Security

- Same-version PATH shadows, malformed global package/bin identities, path/symlink escapes, protected-asset replacement attempts, and inconsistent gate contracts fail closed.
- Canvas rendering is local static HTML with a no-script/no-network CSP and escaped reviewer content; it starts no server or background process.

### Verification

- Focused external-update identity, strict-gate/promotion/capability/Mission, and design-production smokes.
- TypeScript typecheck, clean build, self-verification, packaged CLI, package-boundary/secret, and bounded Deep checks.

## v2.5.1 - 2026-07-31

### Added

- Added bounded stdin readers with a 1 MiB hook limit and a 4 MiB general CLI limit. Malformed or oversized hook payloads now return a valid fail-open response without echoing or acting on rejected input.
- Added a final read-only `yam doctor --json` verification to yam updates and automatic rollbacks. The updater accepts success only when the command exits cleanly and returns the expected healthy Doctor contract.
- Added a release-time secret guard over the actual npm dry-run packlist. It scans regular UTF-8 text files for high-signal private-key and provider credential patterns while reporting only pattern, path, and line metadata.

### Improved

- Install and Ueye integrity manifests now use locale-independent ordinal ordering. Existing yam 2.5.0-and-earlier receipts retain compatibility with their stored legacy order while new digests are deterministic across locales.

### Security

- Rejected stdin payloads are byte-bounded, are not included in diagnostics, and cannot supply hook context or trigger workspace mutation.
- `verify:self`, `prepack`, `prepublishOnly`, and `release:check` now inherit the npm packlist secret guard; the inner pack inspection disables lifecycle scripts to avoid recursive execution.
- Updater Doctor output recorded in receipts remains redacted and bounded, and an unhealthy rollback is not reported as an automatic recovery.

### Verification

- TypeScript typecheck and build
- Bounded hook latency/read-only smoke and packaged CLI smoke
- Locale-independent install/Ueye manifest regression smokes
- External update/rollback Doctor smoke
- Npm packlist secret-pattern and redaction smoke

## v2.5.0 - 2026-07-30

### Added

- Added read-only `yam update check [--json]` for yam, Scrapling, and Insane Search with official registry/manifest versions and source-revision metadata.
- Added explicitly authorized component/all update application with per-component receipts, a concurrent-run lock, exact stable versions, verification evidence, and rollback guidance.
- Added isolated Scrapling version environments with `pip check`, HTTP extraction, browser extraction, and atomic executable switching; the previous environment remains available for rollback.
- Added deterministic temp-only updater smoke coverage, including receipt-failure symlink rollback, manual Codex plugin fallback, strict no-remove/cache behavior, and yam-last `--all` ordering.

### Improved

- The build now preserves executable mode on `dist/bin/yam.js`, and dist freshness fails if a global npm install would expose a non-executable `yam` target.

### Security

- Insane Search updates pin the official manifest to the exact observed Git revision and use only official Codex CLI commands. A missing safe in-place path returns `manual_plugin_update_required`; an unreadable post-upgrade state fails closed before `add`; yam never removes the plugin first or writes `.codex/plugins/cache` directly.
- External commands use argument arrays without a shell, version/component allowlists, redacted captured output, and fail-closed apply locking.
- Existing Scrapling links require a matching yam ownership marker, and an unwritable receipt stops `--all` before any later component mutation.

### Verification

- `npm run external-updates-smoke`
- `npm run typecheck`
- `npm run verify:self`
- `npm run cli-smoke`
- `npm run dist:freshness`
- `npm run package-boundary:check`

## v2.4.0 - 2026-07-27

### Added

- Added ownership-aware skill replacement: an existing active skill is replaced only when the previous yam receipt and complete regular-file inventory and content hashes prove yam ownership, unless the operator explicitly names that skill with `--replace-user-skill`.
- Added a central CLI help contract so `--help` and `-h` return usage before any command dispatch, including install and uninstall.
- Added deterministic smoke coverage for user-owned conflicts, explicit replacement, prior-version upgrades, local drift, safe uninstall and rollback, preserved legacy/mirror entries, and help-path state immutability.
- Added `yam detect [dir] --json` changed-file verification recommendations for dirty, staged, and untracked Git paths. Each advisory records its matched rule, confidence, reason, fallback, and source files; its command plan deduplicates available project commands while retaining rule/file provenance, and unavailable Git scope cannot masquerade as a clean project.
- Added a deterministic packaged-hook latency and read-only regression smoke for zero, one, and many changed files, including the eight-file prompt cap and bounded Study Note `Stop` behavior.

### Improved

- `yam uninstall` now requires a valid receipt and matching active skill hashes, then removes the verified set transactionally. User-owned, locally modified, legacy, retired, and Codex mirror entries that cannot be proven yam-owned are preserved.
- Install ownership is checked before staging and again immediately before mutation so conflicts fail closed without replacing the existing skill or receipt.
- `yam doctor` reports safely preserved legacy/retired/mirror entries as informational unproven entries instead of failing with an ineffective reinstall recommendation.
- `yam cleanup scan` now includes a bounded, advisory-only AGENTS/SKILL directive-duplication budget with exact normalized matching, digests, redacted limited previews, and file/line provenance. It remains non-destructive and never becomes a hard gate.
- Study Note check, prompt, and `Stop` paths now preserve Git change-scope availability. A non-Git or failed Git probe reports partial truth and a manual-inspection warning instead of silently claiming that no artifacts changed.

### Verification

- Passed TypeScript typecheck, clean build, hook latency/read-only smoke, the 174-file install/uninstall transaction smoke, packaged CLI smoke, self-verification, forbidden-name scan, distribution freshness, package-boundary validation, and diff whitespace checks.

## v2.3.2 - 2026-07-21

### Added

- Added a bounded Codex `Stop` completion gate to the opt-in `study-note` hook profile. Changed work with a missing or incomplete Study Note receives one correction prompt before completion.
- Added hook health inspection for missing executables, missing script targets, incomplete event coverage, duplicate handlers, unsupported command shapes, and unreadable hook config.
- Added deterministic packaged-CLI smoke coverage for broken-path detection, nonzero health status, backup-backed migration, unrelated-hook preservation, Stop blocking/passing, and loop prevention.

### Improved

- `yam hook status` now reports configured-but-broken profiles as `broken` and exits nonzero instead of calling a stale command `enabled`.
- Re-enabling a hook profile migrates stale absolute paths to the current installed Node and package entrypoint, adds the required events, preserves unrelated hooks, creates a timestamped backup, and writes config atomically.
- Study Note Guard checks now cover execution point, expected behavior, syntax or structure insight, verification, and limits separately.

### Verification

- `npm run verify:self`
- `npm run dist:freshness`
- `npm run package-boundary:check`
- `npm run cli-smoke`

## v2.3.1 - 2026-07-21

### Added

- Added a transactional skill installer that stages and SHA-256 verifies the complete managed skill set before replacing the active installation.
- Added `yam.install-receipt.v1` with the installed package version, source identity, timestamp, destination, skill inventory, per-file hashes, and aggregate source digest.
- Added deterministic install transaction smoke coverage for successful commit, forced mid-commit rollback, drift detection and repair, mirror cleanup, and concurrent-install locking.

### Improved

- `yam status` now detects missing files, unexpected files, hash drift, receipt drift, and package-version drift instead of checking only for `SKILL.md` and `references/` existence.
- Failed commits restore the previous managed skill set and receipt; legacy and retired skill cleanup now participates in the same rollback boundary.
- Unfinished transaction artifacts are surfaced by `yam status` and block a new install so recovery backups are not silently overwritten.
- `yam uninstall` removes the install receipt and refuses to run while an install lock is present.

### Verification

- `npm run verify:self`
- `npm run dist:freshness`
- `npm run package-boundary:check`
- `npm run cli-smoke`

## v2.3.0 - 2026-07-13

### Added

- Added `yam mission receipt` with reviewer/doctor read-only contracts, explicit lifecycle/outcome separation, verification evidence, and per-thread completion eligibility.
- Added `yam mission gate` to block Mission completion when expected thread receipts are missing, duplicated, unexpected, ambiguous, failed, or violate read-only role boundaries.
- Added `yam ueye asset add|verify` for local reference provenance, license notes, protection/edit flags, dimensions, and SHA-256 integrity checks.
- Added `yam ueye revision archive|verify` for non-overwriting round archives with hashed revision history.

### Improved

- Mission proof requests for `verified` or `proven` now recompute and validate supplied completion gates, then cap the claim when a passing gate is missing.
- Ueye reports can attach asset and revision manifests; a supplied invalid manifest blocks a visual `done` claim.

## v2.2.1 - 2026-07-09

### Improved

- Strengthened `$scout` into a wider research harness with source mapping, evidence ledger, opposition pass, and blocked-source fallback guidance.
- Added `references/scout-wide-scan.md` for broad searches across tools, agent systems, protocols, harnesses, markets, and third-party ecosystems.
- Clarified that `insane-search` should be used as blocked-source acquisition for high-signal sources, not as Scout's default search path.
- Clarified that real subagent or parallel research lanes are explicit-only and should not turn ordinary scouting into `$mission`.

## v2.2.0 - 2026-07-07

### Added

- Added `yam study-note check` as a read-only Study Note Guard Lite for changed files and supplied final-report text.
- Added an opt-in `study-note` hook profile via `yam hook enable study-note --global` for prompt-time Study Note reminders without auto-generating or editing reports.
- Extended `yam loop report --json` with resume-ready handoff fields: touched/read/verified files, skipped checks, stop condition, resume hint, and readiness state.
- Added Ueye deep visual review fields for acceptance criteria, touched/read/verified files, skipped checks, residual risks, stop condition, resume hint, design-system evidence, implementation evidence, and state matrix.

### Improved

- Strengthened Study Note v3 guidance for non-developer learning with execution point, before/after behavior, expected behavior, and architecture hygiene checks for `page.tsx`, `global.css`, and DB `jsonb` boundaries.
- Strengthened Ueye guidance so serious UI work can carry Deep-grade verification inside the Ueye route without requiring a separate Deep route.

## v2.1.0 - 2026-06-30

### Added

- Added `references/study-note.md` with required Study Note guidance for any changed code, config, release metadata, documentation, or project artifact.
- Reworked `references/verification-levels.md` into an L0-L5 Verification Ladder covering stated, inspected, local check, integrated, release/runtime/visual proof, and bounded deep verification.

### Improved

- Updated core, final-report, route skill, project-pack, and trust-layer guidance so serious claims can require heavier evidence while bounded stop conditions prevent endless proof loops.
- Strengthened `$quick`, `$deep`, `$mission`, and `$ueye` final report rules so changed artifacts include code/artifact role, expected behavior, syntax or structure insight, verification note, and uncertainty.

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
