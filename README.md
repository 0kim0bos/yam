# yam

`yam` is a progressive proof-first personal agent flow for fast product building, high-quality UI work, and honest verification.

```text
Direction before execution.
Start fast.
Deepen deliberately.
Basic direction fit and honest verification always.
Honest by design.
Heavy proof when risk or user intent calls for it.
Token-aware by default.
Context-reuse first.
End with remaining tasks and fix-first items.
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
- `yam` is not lightweight-only; it is progressive: quick entry, stronger proof as scope/risk grows.
- Every route should check project direction and use an honest verification level.
- Small work stays small, but serious work is allowed to become serious.
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
yam proof /path/to/project
yam proof write /path/to/project --route quick --truth verified --command "npm run verify:self: pass"
yam proof --route ueye --truth verified --visual "reference image only"
yam proof --route ueye --truth partial --visual-provenance '{"source_kind":"reference","source_hash":"unknown","comparison_result":"not-verified","truth_status":"partial"}'
yam ueye capture --url http://localhost:3000 --out .yam/screens/home.png
yam ueye compare --reference ./reference.png --actual .yam/screens/home.png
yam ueye report --reference ./reference.png --actual .yam/screens/home.png --design-quality needs-polish --json
yam media proof --requested --attempted --output ./generated.png --wait-loop --json
yam proof --route mission --mission-envelope '{"agent_id":"implementer","assigned_scope":"target component","changed_files":["src/file.ts"],"verification_hint":"npm run typecheck","truth_status":"partial"}'
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
- runtime truth matrix
- visual evidence caps
- Ueye visual run reports
- runtime backend evidence
- runtime evidence mini summaries
- mission patch queue lite records
- release report JSON
- structured diagnostic next actions
- media generation proof caps
- DB/Supabase safety signals

It is implemented locally in `src/lib/trust-kernel.ts` and kept route-scoped. It is not an always-on release gate.

## Flow Artifact Shapes

These shapes keep reports machine-readable without turning normal work into a heavy gate.

- Runtime evidence mini: compact route, command/process, observation, cleanup, truth status, and next action fields for `$deep` or `$mission` runtime claims.
- Patch queue lite: `$mission` lane records with pending/applied/verified/reverted/blocked state, changed files, verification hint, rollback hint, truth status, and next action.
- Release report JSON: `yam release report --json` summarizes typecheck, forbidden-name scan, package boundary, registry status, CLI smoke, dist freshness, diagnostics, and final truth status.
- Benchmark optimization loop lite: use `yam measure <route>` and `yam template tuning` to record baseline, one route wording change, rerun result, keep/revert decision, and stop condition.
- Structured diagnostic next action: every doctor/release diagnostic should say what was observed, what evidence supports it, what to do next, owner route, severity, and truth status.
- Ueye review continuity/comparison report: `$ueye` run reports can link a previous review, current evidence, comparison delta, design quality result, and next action.

## Ueye Capture And Compare

`$ueye` stays one skill. It starts fast by default, then uses capture/compare only when a visual claim needs real evidence.

```bash
yam ueye capture --url http://localhost:3000 --out .yam/screens/home.png
yam ueye compare --reference ./reference.png --actual .yam/screens/home.png --json
yam ueye report --reference ./reference.png --actual .yam/screens/home.png --design-quality pass --json
```

`capture` uses a Playwright install from the current project when present, then falls back to the package context. It does not install browsers or add runtime dependencies by itself. If capture is unavailable, the visual claim stays `partial` or `blocked` until a real screenshot is supplied.

`compare` is local-only and dependency-free. It records file hashes, dimensions, comparison result, and proof-ready visual provenance. Exact image matches can be `verified`; different screenshots stay `partial` so visual parity is not overclaimed.

`report` gathers reference sources, implementation screenshots, comparison result, continuity fields, design quality judgment, and next action into one compact proof-ready JSON object.

Generated media can guide visual direction, but it cannot prove the implemented UI by itself:

```bash
yam media proof --requested --attempted --output ./generated.png --wait-loop --json
```

For agent-driven visual QA, prefer the Codex in-app Browser plugin. Use the user's Chrome browser only when explicitly requested or when Chrome-only session/profile state is required.
