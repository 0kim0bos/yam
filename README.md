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

- No hooks.
- Optional `yam-lite` hook is advisory-only and off by default.
- No automatic Team routing.
- No automatic proof loops.
- No automatic tmux.
- No false completion claims: verification, cleanup, and visual checks must match actual evidence.
- `yam` is not lightweight-only; it is progressive: fast direction, broader judgment when useful, stronger proof as scope/risk grows.
- Every route should check project direction and use an honest verification level.
- Small work stays small, but serious work is allowed to become serious.
- Security-sensitive work is never treated as ordinary polish.
- Useful reports explain what the changed code does, how it changed, and why the change matters.
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

## Install

Recommended:

```bash
cd ~/Documents/Codex/tools/yam
yam install
```

This copies each skill plus the shared `references/` directory into `~/.agents/skills/`, which is the user skill root used by this Codex desktop setup.

Manual install is also possible by copying selected skill folders into your active Codex user skill root, but make sure each installed skill also receives a `references/` folder.

Recommended v0:

```bash
mkdir -p ~/.agents/skills
for skill in quick ueye question scout deep mission; do
  rm -rf "$HOME/.agents/skills/$skill"
  mkdir -p "$HOME/.agents/skills/$skill"
  cp "skills/$skill/SKILL.md" "$HOME/.agents/skills/$skill/SKILL.md"
  cp -R references "$HOME/.agents/skills/$skill/references"
done
```

Restart Codex after installing so skills reload.

## Uninstall

```bash
cd ~/Documents/Codex/tools/yam
yam uninstall
```

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
yam proof /path/to/project
yam proof write /path/to/project --route quick --truth verified --command "npm run verify:self: pass"
yam proof --route ueye --truth verified --visual "reference image only"
yam proof --route ueye --truth partial --visual-provenance '{"source_kind":"reference","source_hash":"unknown","comparison_result":"not-verified","truth_status":"partial"}'
yam ueye capture --url http://localhost:3000 --out .yam/screens/home.png
yam ueye compare --reference ./reference.png --actual .yam/screens/home.png
yam ueye preflight /path/to/project --json
yam ueye report --reference ./reference.png --actual .yam/screens/home.png --preflight-id ueye-preflight-123 --p0-risk "mobile CTA may clip" --quality-gate-note "check CTA contrast before done" --completion-claim done --design-quality pass --direction-locked --reference-read --states-checked --mobile-checked --contrast-checked --cta-checked --provider-context local --execution-surface in-app-browser --app-surface codex-app --browser-surface in-app-browser --preserved-state --json
yam proof --route ueye --truth verified --visual "implementation screenshot evidence recorded" --design-completion '{"completion_claim":"done","has_implementation_screenshot":true,"design_quality":"pass","states_checked":true,"mobile_checked":true,"contrast_checked":true,"cta_checked":true,"direction_locked":true,"truth_status":"verified"}'
yam media proof --requested --attempted --output ./generated.png --wait-loop --json
yam proof --route mission --mission-envelope '{"agent_id":"implementer","assigned_scope":"target component","changed_files":["src/file.ts"],"verification_hint":"npm run typecheck","truth_status":"partial"}'
yam loop report --route quick --intent "fix release readiness" --stage "inspect:passed:read release report" --evidence "typecheck passed" --evidence-level local --evidence-stamp "sha256:release-report" --blocked-kind auth_blocked --safe-retry "retry after npm whoami succeeds" --fix-first-item "npm auth must be verified before publish" --remaining-task "rerun release report after auth refresh" --recommended-direction "fix npm auth first, then publish manually" --implementation-note "keep loop report read-only" --why-this-next "auth blocks public release claims" --blocked-by "npm whoami E401" --owner-route deep --owner-scope "release readiness only" --scope-owner deep --side-effect "no publish attempted" --issue-code "src/bin/yam.ts release report" --issue-role "summarizes release readiness without publishing" --issue-symptom "npm auth failure needs clearer next action" --changed-code "yam loop report" --changed-role "records loop evidence and learning note" --change-summary "added a read-only loop artifact" --why-important "it helps users learn what changed without overclaiming verification" --learning-note "fix blockers before claiming done" --json
yam release report --json
yam safety "supabase db reset"
yam detect /path/to/project
yam pack /path/to/project
yam hook status --global
yam hook enable lite --global
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
- Release report JSON: `yam release report --json` summarizes typecheck, forbidden-name scan, package boundary, registry status, CLI smoke, dist freshness, diagnostics, and final truth status.
- Loop report JSON: `yam loop report --json` records a read-only handoff artifact: guided stages, evidence level/stamp, blocker kind, safe retry, owner route/scope, side effects, next action, fix-first items, remaining tasks, recommended direction, implementation notes, blocked-by notes, tool intent, truth status, and study note.
- Study note: `yam.study-note.v1` keeps short non-specialist explanations for what code was failing, what role it plays, how the symptom showed up, what changed, and why it matters. Missing details stay in `limits` instead of being guessed.
- Publish blocker evidence: release reports classify common npm auth, permission, OTP, immutable-version, cache, registry, and tarball failures into safe next actions.
- Publish readiness evidence: release reports run read-only registry/auth/version probes, redact account/token details, and keep npm publish outside the report.
- Context pressure: `yam context pressure` explains when project context is getting stale, broad, or confusing enough to summarize, refresh, narrow scope, or deepen route.
- Cleanup scan: `yam cleanup scan` is read-only and advisory; it reports confusing hooks, local skill folders, stale traces, or old proof artifacts without deleting anything.
- Benchmark optimization loop lite: use `yam measure <route>` and `yam template tuning` to record baseline, one route wording change, rerun result, keep/revert decision, and stop condition.
- Structured diagnostic next action: every doctor/release diagnostic should say what was observed, what evidence supports it, what to do next, owner route, severity, and truth status.
- Ueye review continuity/comparison report: `$ueye` run reports can link a previous review, current evidence, comparison delta, design quality result, and next action.
- Ueye surface context: `$ueye` run reports can record provider context, provider badge, execution surface, app surface, browser surface, control mode, preserved URL/state, and evidence id.
- Ueye design completion gate: `$ueye` can stay fast for draft work, but a `done` claim is capped until implementation evidence, comparison/design-quality status, P0/P1 status, key states, mobile/responsive behavior, contrast/accessibility visuals, CTA affordance, and direction/reference-read proof are recorded when relevant.
- Ueye design brief and anti-slop review: `$ueye` reports can record operator-provided brief dimensions, constraints, invented metrics, placeholder copy, generic visuals, and custom anti-slop blockers. P0 anti-slop findings block `done` claims.

## Ueye Capture And Compare

`$ueye` stays one skill. It starts fast by default, then uses capture/compare only when a visual claim needs real evidence.

```bash
yam ueye capture --url http://localhost:3000 --out .yam/screens/home.png
yam ueye compare --reference ./reference.png --actual .yam/screens/home.png --json
yam ueye preflight . --json
yam ueye report --reference ./reference.png --actual .yam/screens/home.png --brief-dimension "primary CTA clarity" --constraint "mobile first" --anti-slop "placeholder copy remains" --completion-claim done --design-quality pass --direction-locked --reference-read --states-checked --mobile-checked --contrast-checked --cta-checked --provider-context local --execution-surface in-app-browser --browser-surface in-app-browser --preserved-state --json
```

`capture` uses a Playwright install from the current project when present, then falls back to the package context. It does not install browsers or add runtime dependencies by itself. If capture is unavailable, the visual claim stays `partial` or `blocked` until a real screenshot is supplied.

`compare` is local-only and dependency-free. It records file hashes, dimensions, comparison result, and proof-ready visual provenance. Exact image matches can be `verified`; different screenshots stay `partial` so visual parity is not overclaimed.

`report` gathers reference sources, implementation screenshots, comparison result, continuity fields, design quality judgment, design completion gate, surface context, and next action into one compact proof-ready JSON object. Draft and needs-polish work can stay fast; `--completion-claim done` turns on the stricter design gate.

`preflight` does not claim visual verification. It is a pre-work checklist for reference source, target states, mobile/responsive needs, CTA/contrast/accessibility risk, screenshot availability, and likely P0/P1 candidates.

Generated media can guide visual direction, but it cannot prove the implemented UI by itself:

```bash
yam media proof --requested --attempted --output ./generated.png --wait-loop --json
```

For agent-driven visual QA, prefer the Codex in-app Browser plugin. Use the user's Chrome browser only when explicitly requested or when Chrome-only session/profile state is required.
