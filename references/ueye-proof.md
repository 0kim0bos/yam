# Ueye Proof

Ueye proof keeps visual claims honest without turning design review into a heavy release gate.

## When To Use

Use Ueye proof artifacts when:

- The user asks for UI/UX/design review.
- A reference image, screenshot, or target design is part of the task.
- The final answer needs to claim visual quality, visual parity, or responsive correctness.
- A screenshot or browser check exists and should be tied to the conclusion.

Skip or compress them when:

- The change is text-only or documentation-only.
- The user asks for a quick opinion and no visual source exists.
- The only possible evidence is code reading; mark the result `assumed` or `partial`.

## Artifact Set

### Opt-In CLI Helpers

Ueye is one route. It should not split into separate lite/deep skills. Use these helpers only when the current visual claim needs real evidence:

```bash
yam ueye capture --url http://localhost:3000 --out .yam/screens/home.png
yam ueye compare --reference ./reference.png --actual .yam/screens/home.png --json
yam ueye report --reference ./reference.png --actual .yam/screens/home.png --design-quality needs-polish --provider-context local --execution-surface in-app-browser --browser-surface in-app-browser --preserved-state --json
```

- `capture` uses a project-local capture backend when present, then reports `blocked` instead of installing dependencies or pretending a screenshot exists.
- `compare` is local-only and dependency-free. It records hashes, dimensions, comparison result, and visual provenance. Different screenshots stay `partial`; exact file matches can be `verified`.
- `report` records the Ueye run as reference sources, implementation sources, comparison result, surface context, design quality, blocked reason, next action, and truth status.
- `report` may include continuity fields when a previous review or screenshot is being rechecked.
- Without capture or user-provided screenshots, report implementation/source review separately from visual verification and cap the visual claim.

### Media Generation Proof

Generated media can help with direction and visual ideation, but it is derivative evidence. It cannot prove that the implemented UI was captured or compared.

```bash
yam media proof --requested --attempted --output ./generated.png --wait-loop --json
```

Record:

- tool name, when relevant
- whether generation was requested
- whether generation was attempted
- output path and hash, when a local image exists
- whether the wait loop was checked
- blocked reason and next action
- truth status

### Browser Preference

- Prefer the in-app browser for local pages, localhost, file URLs, and ordinary visual QA.
- Do not silently switch to a profile-dependent browser when the in-app browser cannot capture or inspect.
- Use a profile-dependent browser only when the user explicitly asks for it, or when the task requires existing cookies, sessions, extensions, or profile state.
- If the in-app browser is unavailable and a profile-dependent browser was not explicitly requested or required, cap the visual claim at `partial` or `blocked`.

### Visual Evidence Inventory

Purpose: identify what visual sources were inspected.

Minimum useful fields:

- Label:
- Type:
- Path/URL:
- Dimensions:
- sha256:
- Viewport:
- State:
- Role:

Bounds:

- Default to 1-3 primary visual sources.
- Cap ordinary inventories at 5 rows.
- Record missing dimensions or hashes as `unknown`, not as failure.
- Use generated annotations only as derivative aids.

### Visual Provenance

Purpose: prove the visual source path from reference reading to implementation recheck.

Record these fields when a reference or screenshot materially affects the claim:

- `source_kind`
- `source_path`
- `source_hash`
- `reference_id`
- `screenshot_id`
- `provider_context`
- `provider_badge`
- `execution_surface`
- `app_surface`
- `browser_surface`
- `viewport`
- `state`
- `local_only`
- `redacted`
- `operator_provided`
- `comparison_result`
- `truth_status`

Use `unknown` for missing hashes and `not-verified` for comparisons that were not actually rechecked. Do not upgrade a visual claim only because a reference was supplied.

### Surface Context

Purpose: preserve where and how a visual claim was observed without turning Ueye into an always-on capture gate.

Record these fields when they affect the visual claim:

- `provider_context`
- `provider_badge`
- `execution_surface`
- `app_surface`
- `browser_surface`
- `control_mode`
- `url`
- `viewport`
- `screenshot_id`
- `evidence_id`
- `preserved_state`
- `preserved_url`
- `truth_status`

Use `not-recorded` when the field was not observed. Prefer `partial` over `verified` when surface context exists but no actual implementation screenshot was captured or supplied.

### Reference Read Proof

Purpose: separate reading the reference from judging the implementation.

Capture:

- Layout:
- Hierarchy:
- Typography:
- Color/contrast:
- Component detail:
- Interaction/motion:
- Responsiveness:
- Brand/mood:

Keep this concise. It should explain what the reference asks for, not become a full design essay.

### Reference vs Implementation Matrix

Purpose: compare reference direction against the actual implementation evidence.

Status values:

- `matched`
- `similar`
- `different`
- `not-verified`
- `not-applicable`

Rows to use only when relevant:

- Layout and spacing.
- Visual hierarchy.
- Typography.
- Color and contrast.
- Component detail.
- Interaction and motion.
- Responsiveness.
- Accessibility-relevant visuals.
- Brand and mood fit.

### Design Quality Review

Purpose: judge the implemented UI on design quality after evidence is established.

Dimensions:

- Visual hierarchy.
- Layout and spacing.
- Typography.
- Color and contrast.
- Component detail.
- Interaction and motion.
- Responsiveness.
- Accessibility.
- Brand and mood fit.

Report findings as P0-P3. Keep P2/P3 short unless the user requested a full polish pass.
For each relevant design dimension, use `pass`, `needs-polish`, or `fails`.

### Review Continuity And Comparison Report

Use this when a Ueye task continues a previous visual review, rechecks a fix, or compares two review runs.

Minimum fields:

- `previous_report_id` or `previous_report_path`
- `previous_screenshot_id`, when available
- `previous_source_hash`, when available
- `current_report_id` or `current_source_path`
- `current_screenshot_id`, when available
- `current_source_hash`, when available
- `viewport`
- `state`
- `changed_surface`
- `comparison_result`: improved / regressed / unchanged / not-verified
- `regression`: true / false / not-verified
- `resolved_findings`
- `new_findings`
- `still_open_findings`
- `design_quality`
- `truth_status`
- `next_action`

Do not claim continuity from memory alone. Link it to a previous report, screenshot, source path/hash, or an explicit user-provided prior finding.

## Truth Caps

- Full visual verification requires real implementation evidence and relevant recheck.
- Reference-only evidence can support direction, not implementation proof.
- Generated-only evidence can support ideation or annotation, not implemented-screen verification.
- Missing screenshots, unavailable browser, or text-only review should cap the result at `partial`, `blocked`, or `assumed`.
