# yam

`yam` is a progressive proof-first personal agent flow for fast product building, high-quality UI work, and honest verification.

```text
Direction before execution.
Start with momentum.
Deepen deliberately.
Basic direction fit and honest verification always.
Honest by design.
Heavy proof when risk or user intent calls for it.
Token-aware by default.
Context-reuse first.
End with remaining tasks and fix-first items.
Security-first project guidance.
Useful change insight for non-specialists.
Study Note for changed artifacts.
Verification Ladder for larger claims.
Reference-led judgment with clear source boundaries.
```

## Routes

- `$quick`: fast scoped implementation, small fixes, and quick error scans.
- `$ueye`: tight UI/UX/design implementation and visual review with reference-read proof, comparison, and quality judgment.
- `$question`: direct Q&A without turning simple questions into research projects.
- `$scout`: conduct broad investigations, gather evidence, analyze options, and provide recommendations.
- `$deep`: single-agent heavy verification by request, including runtime/tmux/browser/process proof when needed.
- `$mission`: approved-plan execution with real subagent/team lanes, cross-verification, doctor scan, and final proof.

See `COMMANDS.md` for copy-ready examples.
See `ROADMAP.md` for remaining implementation stages.

## Defaults

- No required hooks.
- Optional `yam-lite` hook is advisory-only and off by default.
- Optional `study-note` hook adds a prompt reminder and a bounded final-response check; it is off by default.
- No automatic Team routing.
- No automatic proof loops.
- No automatic tmux.
- No false completion claims: verification, cleanup, and visual checks must match actual evidence.
- `yam` is not lightweight-only; it is progressive: fast direction, broader judgment when useful, stronger proof as scope/risk grows.
- Every route should check project direction and use the L0-L5 Verification Ladder honestly.
- Small work stays small, but serious work is allowed to become serious.
- Security-sensitive work is never treated as ordinary polish.
- When code, config, release metadata, documentation, or project artifacts changed, final reports include a Study Note even if no yam skill was invoked.
- Useful Study Notes explain what the changed code or artifact does, what role it has, what was wrong or missing, what changed, what behavior is expected, one small syntax/structure insight, what was verified, and what remains uncertain.
- Research and reference scans should keep source boundaries clear, then rework good ideas into yam style.
- Token economy is part of quality.
- Project packs prevent re-reading and re-planning from scratch.
- Memory is opt-in, project-local, and sparse.
- Final reports should compactly mention remaining tasks and fix-first issues when useful.

## Project Pack

For repeated work in a project, add a small `yam.project.md` at the project root.

```bash
yam init-project .
yam pack .
```

Routes should read this pack before broad project exploration. The pack is user-owned and should stay compact: `yam` creates it only when missing, checks it with `pack`, and avoids automatic rewrites.

## Memory

For repeated mistakes, wrong decisions, direction changes, or durable lessons, use opt-in project memory.

```bash
yam memory init .
yam memory add . --kind lesson --summary "Keep UI checks visual before declaring done" --action "Use $ueye after major UI changes"
yam memory summary .
```

Memory writes to `.yam/memory/` only when you run the command. Routes should prefer `.yam/memory/summary.md` and should not read every record by default.

## Lite Hook

`yam-lite` can be enabled when you want a tiny route/direction nudge in every prompt without automatic checks or proof gates.
It is only the always-on entry layer, not the full ambition of `yam`.

```bash
yam hook status --global
yam hook enable lite --global
yam hook disable lite --global
```

It only adds short advisory context. It does not run verification, tmux, browser QA, subagents, or dependency installs.

## Study Note Hook

Enable this profile when you want Codex to check changed work at final-response time as well as remind the agent at prompt time.

```bash
yam hook enable study-note --global
yam hook status --global
```

The profile installs `UserPromptSubmit` and `Stop` handlers. At `Stop`, yam checks the latest assistant message with the same read-only Study Note Guard used by `yam study-note check`. If changed artifacts lack the required role, execution point, before/after, expected behavior, syntax/structure, verification, limits, or relevant architecture hygiene, Codex receives one correction prompt. A second failed check warns but does not loop forever. If Git change scope is unavailable, the guard reports partial truth and keeps a manual-inspection warning visible instead of claiming the project is clean. The hook never writes the Study Note or runs verification for the agent.

Hook stdin is limited to 1 MiB. Malformed JSON or an oversized payload produces a valid fail-open response without echoing the rejected content, deriving hook context from it, or mutating the workspace. Other CLI commands that read piped text use a 4 MiB limit and fail closed when it is exceeded.

`yam hook status` reports stale or missing command targets as `broken` and exits nonzero. Run `yam hook enable <profile> --global` again to create a timestamped backup, preserve unrelated hooks, and migrate that profile to the current installed path and event coverage. Restart Codex or open a new task after changing hooks.

## Install

Recommended:

```bash
cd ~/Documents/Codex/tools/yam
yam install
```

`yam install` first checks ownership of every existing active skill. A skill is replaced automatically only when the previous yam receipt names it and its complete regular-file inventory and content hashes still match the receipt. The installer then stages every managed skill plus the shared `references/` directory, verifies the complete staged file manifest with SHA-256, and replaces the verified active set in `~/.agents/skills/`. If any commit or post-install verification step fails, yam restores the previous managed skill set and receipt.

If an existing active directory is user-owned, locally modified, or cannot be proven yam-owned, installation stops before staging and preserves it. After reviewing the files, replace only the intended conflicting name explicitly:

```bash
yam install --replace-user-skill quick
```

Repeat `--replace-user-skill <name>` for each reviewed conflict. Unproven legacy, retired, and Codex mirror directories are preserved rather than deleted by name.

A successful install writes `~/.agents/skills/.yam-flow-install-receipt.json`. The receipt records the package version, source identity, install timestamp, destination, managed skill inventory, and per-file hashes. Integrity paths and digests use locale-independent ordinal ordering; receipts written by yam 2.5.0 and earlier are also checked against their stored legacy order during upgrade. `yam status` independently recomputes source and installed hashes, so a stale package install, local file change, unexpected file, or modified receipt is reported as drift.

The receipt is local integrity provenance, not a cryptographic signature or a security boundary against another process running as the same OS user. An actor that can rewrite both the receipt and every recorded file can forge local ownership evidence.

An ordinary install error rolls back automatically. An abrupt process or machine termination can leave `.yam-flow-install.lock` and a hidden transaction directory; `yam status` surfaces the unfinished transaction and yam refuses another mutation while recovery state remains. Remove the lock only after confirming no install is running, and preserve any transaction directory until the previous installation state has been inspected.

Manual copying can still make a skill loadable, but it intentionally remains unverified: without a matching receipt, `yam status` exits non-zero and recommends `yam install`.

Restart Codex after installing so skills reload.

## External Updates

Update checks are read-only and never authorize a mutation by themselves:

```bash
yam update check
yam update check --json
```

Apply requires an explicit component or `--all`:

```bash
yam update apply --component scrapling
yam update apply --component insane-search
yam update apply --component yam
yam update apply --all --json
```

`--all` processes Scrapling, then Insane Search, then yam so the running updater replaces itself last. It stops at the first failed or manual-only component. After the global npm install, yam resolves `npm root -g`, the installed package manifest and bin mapping, the first `yam` on `PATH`, canonical realpaths, and the observed version before any `yam install` mutation. A same-version PATH shadow, malformed package, or identity mismatch fails closed; legitimate multi-hop symlinks remain valid. Rollback repeats the same identity check before rollback-side yam commands.

A yam update is successful only after the installed version and status checks plus a final read-only `yam doctor --json` return the expected healthy contract. Doctor failure triggers the existing rollback path, and rollback is considered automatic only when its own identity, version, status, and Doctor checks pass. The deepest actionable rollback or Doctor cause remains primary even if receipt persistence also fails. Each attempt writes a bounded, redacted component receipt under `~/.local/state/yam/update-receipts/` with the old/new version, source revision, executable identity, checks, side effects, outcome, and rollback guidance. The aggregate apply response emits and verifies the strict `yam.gate-result.v1`; an already-held lock also returns a blocked gate without mutating components. A lock prevents concurrent apply runs.

Effective yam identity currently verifies POSIX-style executable/symlink layouts through `which` and canonical realpaths. Windows npm `.cmd` shim identity is intentionally unverified and fails closed until a dedicated shim parser and fixture exist.

Scrapling updates install an exact stable PyPI version into a new versioned virtual environment. `pip check`, ordinary HTTP extraction, and headless browser extraction must pass before the executable symlink changes atomically; the previous environment is retained. An existing environment must have a matching `.yam-scrapling-install.json` ownership marker before yam will replace its link. Insane Search uses only the official `codex plugin` commands. yam never edits `.codex/plugins/cache`, never removes the plugin first, and returns `manual_plugin_update_required` when the installed Codex CLI cannot update it safely in place.

There is no unattended updater. The exact project trigger in `AGENTS.md` grants one-time authorization for a checked `--all` run, and Codex is never restarted automatically.

### Scrapling Usage

The isolated executable can be used directly from the shell:

```bash
scrapling --version
scrapling extract get https://example.com example.txt --css-selector h1
scrapling extract stealthy-fetch https://example.com example-browser.txt --css-selector h1 --headless
```

From Python inside the installed environment:

```python
from scrapling.fetchers import Fetcher, StealthyFetcher

page = Fetcher.get("https://example.com")
print(page.css("h1::text").get())

browser_page = StealthyFetcher.fetch("https://example.com", headless=True)
print(browser_page.css("h1::text").get())
```

Use `Fetcher` for ordinary HTTP pages and `StealthyFetcher` only when a real browser or stronger anti-bot behavior is needed; the browser path is heavier.

## Uninstall

```bash
cd ~/Documents/Codex/tools/yam
yam uninstall
```

`yam uninstall` verifies the receipt, complete active inventory, and current file hashes before deleting anything. A missing receipt or locally modified active skill blocks the whole uninstall. Verified active skills and the receipt are removed transactionally; unproven legacy, retired, and Codex mirror entries remain untouched.

No hooks, automations, or global config files are installed.

## Manage

```bash
yam list
yam status
yam verify
yam doctor
yam tools doctor /path/to/project
yam tools doctor /path/to/project --json
yam context pressure /path/to/project --json
yam cleanup scan /path/to/project --json
yam detect /path/to/project --json
yam study-note check /path/to/project --text "Study Note: ..." --json
yam proof /path/to/project
yam proof write /path/to/project --route quick --truth verified --command "npm run verify:self: pass"
yam proof --route ueye --truth verified --visual "reference image only"
yam proof --route ueye --truth partial --visual-provenance '{"source_kind":"reference","source_hash":"unknown","comparison_result":"not-verified","truth_status":"partial"}'
yam ueye capture --url http://localhost:3000 --out .yam/screens/home.png
yam ueye compare --reference ./reference.png --actual .yam/screens/home.png
yam ueye preflight /path/to/project --json
yam ueye report --reference ./reference.png --actual .yam/screens/home.png --preflight-id ueye-preflight-123 --p0-risk "mobile CTA may clip" --quality-gate-note "check CTA contrast before done" --acceptance-criterion "primary CTA remains visible on mobile" --state-check default:pass --state-check mobile:partial --implementation-evidence "browser screenshot reviewed" --completion-claim done --design-quality pass --direction-locked --reference-read --states-checked --mobile-checked --contrast-checked --cta-checked --provider-context local --execution-surface in-app-browser --app-surface codex-app --browser-surface in-app-browser --preserved-state --json
yam ueye asset add --manifest .yam/ueye/assets.json --id official-logo --file ./assets/logo.png --license-note "operator supplied; local review" --operator-provided --do-not-replace --json
yam ueye asset verify --manifest .yam/ueye/assets.json --json
yam ueye revision archive --file .yam/screens/home.png --round 1 --artifact-id home --root .yam/ueye/revisions --json
yam ueye revision verify --manifest .yam/ueye/revisions/manifest.json --json
yam ueye production canvas create --session-id campaign --title "Campaign plan review" --demand-kind multi_asset_production --demand-evidence "Five coordinated campaign assets require one bounded review package" --artifact-spec ./canvas-artifact.json --json
yam ueye production canvas comment --session-path .yam/ueye/design-production/campaign/plan-review.json --render-path .yam/ueye/design-production/campaign/canvas.html --comment-id finding-1 --artifact-id campaign-plan --anchor-kind line --locator L12 --finding "CTA hierarchy is ambiguous" --requested-change "Make the primary CTA explicit" --json
yam ueye production canvas close --session-path .yam/ueye/design-production/campaign/plan-review.json --render-path .yam/ueye/design-production/campaign/canvas.html --verdict request_changes --json
yam ueye production revision init --session-id campaign --json
yam ueye production gallery verify --manifest-path .yam/ueye/design-production/campaign/gallery.json --json
yam ueye production finalize --demand-kind multi_asset_production --demand-evidence "Five coordinated campaign assets require one bounded review package" --canvas-session-path .yam/ueye/design-production/campaign/plan-review.json --revision-state-path .yam/ueye/design-production/campaign/revision-state.json --gallery-manifest-path .yam/ueye/design-production/campaign/gallery.json --receipt-path .yam/ueye/design-production/campaign/phase-receipt.json --json
yam ueye production phase verify --receipt-path .yam/ueye/design-production/campaign/phase-receipt.json --json
yam proof --route ueye --truth verified --visual "implementation screenshot evidence recorded" --design-completion '{"completion_claim":"done","has_implementation_screenshot":true,"design_quality":"pass","states_checked":true,"mobile_checked":true,"contrast_checked":true,"cta_checked":true,"direction_locked":true,"truth_status":"verified"}'
yam media proof --requested --attempted --output ./generated.png --wait-loop --json
yam proof --route mission --mission-envelope '{"agent_id":"implementer","assigned_scope":"target component","changed_files":["src/file.ts"],"verification_hint":"npm run typecheck","truth_status":"partial"}'
yam mission receipt --thread-id reviewer-1 --role reviewer --lifecycle stopped --outcome passed --scope "read-only review" --evidence "review completed without edits" --out .yam/mission/reviewer-1.json --json
yam mission gate --expected-thread reviewer-1 --receipt .yam/mission/reviewer-1.json --out .yam/mission/completion.json --json
yam loop report --route quick --intent "fix release readiness" --stage "inspect:passed:read release report" --evidence "typecheck passed" --evidence-level local --evidence-stamp "sha256:release-report" --touched-file src/bin/yam.ts --read-file README.md --verified-file scripts/cli-smoke.mjs --skipped-check "npm publish skipped by design" --stop-condition "stop after readiness evidence is recorded" --resume-hint "rerun release report after npm auth refresh" --readiness-state blocked --covered-requirement "release report is read-only" --uncovered-requirement "npm auth verified" --blocked-kind auth_blocked --failure-cause auth_token_invalid --safe-retry "retry after npm whoami succeeds" --recovery-hint "refresh npm auth, then rerun readiness checks" --fix-first-item "npm auth must be verified before publish" --remaining-task "rerun release report after auth refresh" --recommended-direction "fix npm auth first, then publish manually" --implementation-note "keep loop report read-only" --why-this-next "auth blocks public release claims" --blocked-by "npm whoami E401" --owner-route deep --owner-scope "release readiness only" --scope-owner deep --side-effect "no publish attempted" --avoidance-note "do not retry publish before npm auth is proven" --issue-code "src/bin/yam.ts release report" --issue-role "summarizes release readiness without publishing" --issue-symptom "npm auth failure needs clearer next action" --changed-code "yam loop report" --changed-role "records loop evidence and learning note" --change-summary "added a read-only loop artifact" --why-important "it helps users learn what changed without overclaiming verification" --learning-note "fix blockers before claiming done" --json
yam release report --json
yam safety "supabase db reset"
yam pack /path/to/project
yam hook status --global
yam hook enable lite --global
yam hook enable study-note --global
yam hook disable lite --global
yam budget ueye
yam measure ueye --files 5 --commands 2 --report-lines 12 --seconds 180
yam template ueye
yam template ueye-comparison
yam template mission
yam template proof
yam tune-log /path/to/project
yam memory list /path/to/project
yam memory summary /path/to/project
yam examples
yam path
yam version
yam init-project /path/to/project
```

## npm / npx Prep

The package exposes the `yam` binary. It does not mutate your home directory during package installation.

```bash
npx -y --package yam-flow yam list
npx -y --package yam-flow yam install
npm install -g yam-flow
yam status
```

After `yam status` reports all skills and the install receipt as `ok`, restart Codex so the refreshed skills reload.

Before packaging or publishing, `verify:self` inspects the exact file list returned by `npm pack --dry-run --json --ignore-scripts`. The release gate scans regular UTF-8 text files up to 2 MiB for high-signal private-key, npm, GitHub, OpenAI, Anthropic, and AWS credential patterns. Findings expose only the pattern id, package-relative path, and line number; matched text is never printed. Binary, symlink, non-regular, unreadable, outside-root, and oversized entries are reported as skipped rather than silently represented as scanned.

Publishing still requires confirming the final npm package name and account access.

## Trust Kernel

`yam` includes a small local trust kernel:

- completion proof shape
- truth caps
- fake versus real distinction
- security-first risk signals
- runtime truth matrix
- visual evidence caps
- Ueye visual run reports
- Ueye surface context metadata
- Ueye design completion gate
- runtime backend evidence
- runtime evidence mini summaries
- mission patch queue lite records
- Mission read-only reviewer/doctor contracts, subagent receipts, and completion gate
- Ueye local asset provenance and non-overwriting revision history
- release report JSON
- loop report JSON
- study note JSON
- structured diagnostic next actions
- context pressure summaries
- advisory cleanup scans
- publish blocker evidence
- publish readiness evidence
- change insight reporting
- reference source boundary notes
- media generation proof caps
- DB/Supabase safety signals

It is implemented locally in `src/lib/trust-kernel.ts` and kept route-scoped. It is not an always-on release gate.

## Flow Artifact Shapes

These shapes keep reports machine-readable without turning normal work into a heavy gate.

- Runtime evidence mini: compact route, command/process, observation, cleanup, truth status, and next action fields for `$deep` or `$mission` runtime claims.
- Patch queue lite: `$mission` lane records with pending/applied/verified/reverted/blocked state, changed files, verification hint, rollback hint, truth status, and next action.
- Mission completion receipt: every expected thread records lifecycle and outcome separately; reviewer/doctor write access, missing evidence, ambiguous stops, and receipt inventory gaps block the aggregate gate.
- Verification Ladder: L0 stated, L1 inspected, L2 local check, L3 integrated, L4 release/runtime/visual proof, and L5 bounded deep. Heavier claims require heavier evidence, but stop conditions prevent endless proof loops.
- Release report JSON: `yam release report --json` summarizes typecheck, forbidden-name scan, package boundary, registry status, CLI smoke, dist freshness, diagnostics, readiness receipt, and final truth status.
- Loop report JSON: `yam loop report --json` records a read-only handoff artifact: guided stages, touched/read/verified files, skipped checks, stop condition, resume hint, readiness state, requirement coverage, evidence level/stamp, blocker kind, failure cause, safe retry, recovery hint, owner route/scope, side effects, next action, fix-first items, remaining tasks, recommended direction, implementation notes, blocked-by notes, avoidance note, tool intent, truth status, and study note.
- Study note: `yam.study-note.v1` and `references/study-note.md` keep non-specialist explanations for what code/artifact changed, what role it plays, where it runs, what changed from before to after, what behavior is expected, one syntax/structure insight, what was verified, and what remains uncertain. Missing details stay in `limits` instead of being guessed. Study Note v3 also asks whether work was dumped into `page.tsx`, `global.css`, or broad DB `jsonb` when a smaller component, style module/token, typed column, relation, or validation schema would teach and scale better.
- Study Note guard: `yam study-note check` is a read-only missing-note guard. The opt-in `yam hook enable study-note --global` profile reuses it for a prompt reminder and one bounded Codex `Stop` correction pass; it still does not generate or edit a report.
- Avoidance note: loop reports may include one short mistake-to-avoid note, but durable memory stays explicit through `yam memory add`; `yam loop report` does not write `.yam/memory`.
- Publish blocker evidence: release reports classify common npm auth, permission, OTP, immutable-version, cache, registry, and tarball failures into safe next actions.
- Publish readiness evidence: release reports run read-only registry/auth/version probes, redact account/token details, keep npm publish outside the report, and include a `yam.release-readiness-receipt.v1` basis for the readiness judgment.
- Context pressure: `yam context pressure` explains when project context is getting stale, broad, or confusing enough to summarize, refresh, narrow scope, or deepen route.
- Changed-file verification detector: `yam detect [dir] --json` reads dirty, staged, and untracked Git paths and returns advisory `matched_rule`, `confidence`, `reason`, `fallback`, source files, and only commands that exist in the project. Its deduplicated command plan retains the contributing rules and files, but never runs the commands. If Git status is unavailable, it reports a low-confidence fallback instead of claiming the project is clean.
- Cleanup scan: `yam cleanup scan` is read-only and advisory; it reports confusing hooks, local skill folders, stale traces, or old proof artifacts without deleting anything. Its bounded AGENTS/SKILL duplication budget scans at most 24 files and 128 KB per file, reports exact normalized cross-surface directive matches with redacted previews and provenance, and never becomes a hard gate.
- Benchmark optimization loop lite: use `yam measure <route>` and `yam template tuning` to record baseline, one route wording change, rerun result, keep/revert decision, and stop condition.
- Structured diagnostic next action: every doctor/release diagnostic should say what was observed, what evidence supports it, what to do next, owner route, severity, and truth status.
- Ueye review continuity/comparison report: `$ueye` run reports can link a previous review, current evidence, comparison delta, design quality result, and next action.
- Ueye surface context: `$ueye` run reports can record provider context, provider badge, execution surface, app surface, browser surface, control mode, preserved URL/state, and evidence id.
- Ueye design completion gate: `$ueye` can stay fast for draft work, but a `done` claim is capped until implementation evidence, comparison/design-quality status, P0/P1 status, key states, mobile/responsive behavior, contrast/accessibility visuals, CTA affordance, and direction/reference-read proof are recorded when relevant.
- Ueye design brief and anti-slop review: `$ueye` reports can record operator-provided brief dimensions, constraints, invented metrics, placeholder copy, generic visuals, and custom anti-slop blockers. P0 anti-slop findings block `done` claims.
- Ueye deep visual review: `$ueye` can record acceptance criteria, touched/read/verified files, skipped checks, residual risks, stop condition, resume hint, design-system evidence, implementation evidence, and a state matrix so serious UI work can carry Deep-grade verification without leaving the Ueye route.
- Ueye asset/revision integrity: `$ueye` can record license/provenance and protected/editable flags for local references, then preserve pre-edit artifacts in hash-verified numbered rounds.
- Demand-gated design production: when repeated Plan Review or large multi-asset work creates real coordination demand, Ueye can add a local static Canvas-lite review, at most two finding-backed revision rounds, a final gallery manifest, and one phase receipt. One-off review and single-asset work stay on the ordinary Ueye/Mission path. Integrity evidence never becomes proof of visual quality, licensing, or implementation correctness.
- Bounded promotion receipt: `yam benchmark report` can compare paired candidate/baseline measurements under explicit sample, mean-delta, and win-rate thresholds. Arithmetic is verified, while measurement provenance remains `operator_asserted` and overall truth stays `partial`.
- Honest capability matrix: `yam tools doctor --json` reports feature maturity separately from observed runtime readiness; instruction-only or unprobed capabilities are not reported as executed.
- Strict gate result: release, update, benchmark-promotion, and Mission completion boundaries emit a digest-bound `yam.gate-result.v1` and fail closed on missing or inconsistent required evidence.

## Ueye Capture And Compare

`$ueye` stays one skill. It starts fast by default, then uses capture/compare only when a visual claim needs real evidence.

```bash
yam ueye capture --url http://localhost:3000 --out .yam/screens/home.png
yam ueye compare --reference ./reference.png --actual .yam/screens/home.png --json
yam ueye preflight . --json
yam ueye asset verify --manifest .yam/ueye/assets.json --json
yam ueye revision verify --manifest .yam/ueye/revisions/manifest.json --json
yam ueye production --help
yam ueye report --reference ./reference.png --actual .yam/screens/home.png --brief-dimension "primary CTA clarity" --constraint "mobile first" --anti-slop "placeholder copy remains" --acceptance-criterion "pricing card CTA remains visible on mobile" --design-system-evidence "uses existing button token" --implementation-evidence "browser screenshot reviewed" --state-check default:pass --state-check mobile:partial --skipped-check "hover state not checked on touch viewport" --residual-risk "tablet breakpoint still needs visual pass" --stop-condition "stop after primary states are checked and residual risk is recorded" --resume-hint "capture tablet screenshot next" --completion-claim done --design-quality pass --direction-locked --reference-read --states-checked --mobile-checked --contrast-checked --cta-checked --provider-context local --execution-surface in-app-browser --browser-surface in-app-browser --preserved-state --json
```

`capture` uses a Playwright install from the current project when present, then falls back to the package context. It does not install browsers or add runtime dependencies by itself. If capture is unavailable, the visual claim stays `partial` or `blocked` until a real screenshot is supplied.

`compare` is local-only and dependency-free. It records file hashes, dimensions, comparison result, and proof-ready visual provenance. Exact image matches can be `verified`; different screenshots stay `partial` so visual parity is not overclaimed.

`report` gathers reference sources, implementation screenshots, comparison result, continuity fields, design quality judgment, design completion gate, deep visual review, surface context, and next action into one compact proof-ready JSON object. Draft and needs-polish work can stay fast; `--completion-claim done` turns on the stricter design gate.

`preflight` does not claim visual verification. It is a pre-work checklist for reference source, target states, mobile/responsive needs, CTA/contrast/accessibility risk, screenshot availability, and likely P0/P1 candidates.

The design production phase is deliberately dormant by default. Use it only when repeated plan annotation or a large coordinated asset set makes prose/file-by-file review costly. The operator-asserted demand trigger is recorded before Canvas creation and must match at finalize. Canvas is static local HTML with no server; its closed `request_changes` session binds one canonical `revision-state.json`, so init/record/show/finalize cannot select an alternate state to reset the two-round budget. Each recorded round must link a current Canvas comment and a newly archived Ueye revision created within that review boundary; the final gallery verifies path/hash/dimension/final-round linkage only and must be created no earlier than Canvas close or the final revision record. `finalize` binds SHA-256 digests for Canvas, revision state, and gallery into an immutable receipt, while `phase verify` re-reads nested upstream semantics and detects later evidence changes. Overall truth remains `partial`, correctness claims remain false, and a two-round unresolved stop remains draft.

Generated media can guide visual direction, but it cannot prove the implemented UI by itself:

```bash
yam media proof --requested --attempted --output ./generated.png --wait-loop --json
```

For agent-driven visual QA, prefer the Codex in-app Browser plugin. Use the user's Chrome browser only when explicitly requested or when Chrome-only session/profile state is required.
