# Ueye

`ueye` is the merged UI/design route: design-heavy implementation, screenshot-led UX review, and visual QA.

## Selected Principles

Visual proof:

- Source-screen inventory before visual claims.
- P0-P3 issue ledger.
- Fix P0/P1 first, then cheap local P2 issues.
- Recheck changed or high-risk screens after fixes when feasible.
- Cap text-only or missing-screenshot reviews as partial instead of fully verified.

Kept out by design:

- Mandatory generated annotated images.
- Image voxel ledgers.
- Release gates for every UI change.
- Always-on proof loops.

Design quality:

- Real examples and previews matter more than abstract prose.
- Design direction should be compact and searchable.
- P0 gates should reject placeholder visuals, generic UI, and broken responsive states.
- UI work should be self-contained enough to inspect.

Evidence boundaries:

- Separate evidence from judgment.
- Keep review output compact.
- Escalate only when the risk justifies it.

## Source-Screen Inventory

Acceptable sources:

- User-provided screenshot.
- Browser screenshot from a local or remote URL.
- Exported static artifact image.
- Current screen when the browser tool can inspect it.
- Reference image, as direction evidence only.
- Generated annotated image, as derivative review aid only.

Record:

- Source type.
- Screen or URL.
- State: default, loading, error, empty, disabled, hover/focus, mobile, or unknown.
- Whether visual verification is full, partial, skipped, or blocked.

Bound:

- Inspect 1-3 primary images by default.
- Keep the source-screen inventory to the 5 most important rows by default.
- Generated callout images are optional and should usually be at most one per review pass.
- P0/P1 issues can expand the review; P2/P3 should stay top-few unless the user asks for a full polish pass.

## Ueye Proof Artifacts

Use these when the task depends on visual truth, reference matching, or design quality judgment. They are proof aids, not a separate lite/deep split.

1. Visual Evidence Inventory.
2. Reference Read Proof.
3. Reference vs Implementation Matrix.
4. Design Quality Review.
5. Review Continuity and Comparison Report.
6. Design Completion Gate.
7. Deep Visual Review, when Ueye needs Deep-grade verification.
8. Asset Manifest, when local reference media affects the design.
9. Revision History, when an iterative visual artifact is about to be replaced.

Default bound:

- Use only the artifacts that support the claim being made.
- Keep evidence to the smallest set of screenshots, references, or URLs that can honestly support the result.
- Prefer paths, URLs, dimensions, and hashes for images when available.
- Do not require voxel grids, exhaustive callouts, or generated annotations.
- Do not let proof artifacts turn Ueye into always-on heavy orchestration.

### Asset Manifest

Use `yam ueye asset add|verify` for important local references such as official identity files, supplied photos, and editable visual sources.

Record source URL/page when known, a license or usage note, operator-provided status, `do_not_replace`, `allowed_for_edit`, dimensions, bytes, and SHA-256. Missing licensing stays visible as a warning. The helper does not fetch URLs or infer usage rights.

### Revision History

Use `yam ueye revision archive` before replacing an artifact during an iterative design pass. Archives are written to numbered round folders with exclusive-copy behavior, so a different payload cannot silently overwrite an existing round. `yam ueye revision verify` recomputes hashes before the history supports a done claim.

### Visual Evidence Inventory

Record the real screens and image sources behind the review.

Include when known:

- Label.
- Type: implementation screenshot, browser URL, user screenshot, reference image, artifact export, generated annotation.
- Path or URL.
- Dimensions.
- sha256.
- Viewport or device.
- State: default, loading, error, empty, disabled, hover/focus, mobile, or unknown.
- Role: proof, reference direction, annotation, or partial evidence.

Images without hashes or dimensions can still be useful, but mark the missing fields plainly.

### Reference Read Proof

Before judging a reference match, state what was actually read from the reference.

Keep it visual and bounded:

- Layout structure.
- Hierarchy and emphasis.
- Typography feel.
- Color and contrast.
- Component shapes and details.
- Interaction or motion cues when visible.
- Responsive implication if the reference includes multiple sizes.
- Brand or mood fit.

Reference read proof describes the direction. It is not proof that the implementation matches.

### Reference vs Implementation Matrix

Use when a user supplies, names, or implies a reference visual.

Compare only meaningful dimensions:

- Layout and spacing.
- Visual hierarchy.
- Typography.
- Color and contrast.
- Component detail.
- Interaction and motion.
- Responsiveness.
- Accessibility-relevant visual behavior.
- Brand or mood fit.

For each row, record `matched`, `similar`, `different`, `not-verified`, or `not-applicable`, plus the smallest evidence note.

### Design Quality Review

Use as the judgment layer after evidence is separated and reference comparison is complete.

Review dimensions:

- Visual hierarchy.
- Layout and spacing.
- Typography.
- Color and contrast.
- Component detail.
- Interaction and motion.
- Responsiveness.
- Accessibility.
- Brand and mood fit.

For each relevant dimension, record `pass`, `needs-polish`, or `fails`.
Keep actionable findings in P0-P3 order. Prefer fixing P0/P1 and cheap local P2 issues before broad polish.

### Design Completion Gate

Use before claiming a Ueye implementation or serious review is done. This is the design-side completion check, not a separate route.

Record:

- `completion_claim`: draft, needs-polish, or done.
- `mode`: fast or strict.
- `design_score`, when score-based completion is useful.
- P0 and P1 open findings.
- Whether direction, reference read proof, implementation evidence, comparison, design quality, CTA affordance, state coverage, mobile/responsive behavior, and contrast/accessibility visuals were checked.
- blockers, warnings, next action, and truth status.

Gate behavior:

- Draft and needs-polish can stay fast.
- `done` automatically behaves as strict.
- P0 or blocked reason should return blocked.
- Missing required checks for a done claim should cap truth at partial.
- Only claim done when the gate says `ready_to_claim_done: true`.

### Deep Visual Review

Use when Ueye should stay in the UI/design route but needs stronger verification than a quick screenshot note.

Record:

- acceptance criteria for the visual claim.
- touched, read, and verified files.
- skipped checks and why they are acceptable or still risky.
- residual risks.
- stop condition for bounded verification.
- resume hint for the next visual pass.
- deep visual checks that ran.
- design-system evidence such as tokens, components, or nearby patterns read.
- implementation evidence such as screenshot, browser check, source inspection, or responsive check.
- state matrix for default, loading, error, empty, disabled, hover/focus, and mobile states when relevant.

Behavior:

- Failed or blocked state matrix rows should block the deep visual review.
- Skipped checks and residual risks should keep the claim partial unless the remaining claim is narrow and explicitly bounded.
- Deep visual review does not replace implementation screenshot evidence when the claim depends on seeing the real screen.
- Stop conditions prevent endless visual proof loops; resume hints make the next pass cheap to restart.

### Review Continuity and Comparison Report

Use when a screen has more than one visual pass, a reference needs follow-up, or a previous Ueye report should stay connected to the next one.

Record:

- `review_session_id` for the current pass.
- previous report path or previous session id when available.
- reference sources and implementation screenshot sources.
- comparison result.
- previous and current screenshot ids when available.
- viewport and state.
- similar, different, and missing items.
- resolved findings, new findings, still-open findings, and regression status.
- design quality result.
- next visual action.
- truth status.

Use `yam ueye report --previous-report previous.json --review-session-id current-pass --provider-context local --execution-surface in-app-browser --browser-surface in-app-browser --similar "..." --different "..." --missing "..." --json` when you need a compact continuity record.

### Surface Context

Use surface context when a Ueye claim depends on preserving the current app/browser state or explaining where visual evidence came from.

Fields:

- provider context and badge.
- execution surface.
- app surface.
- browser surface.
- control mode.
- preserved URL/state.
- evidence id.

Keep this metadata descriptive. It should support honest visual claims, not force a heavy browser workflow for every Ueye run.

## P0-P3 Ledger

- P0: blocker, unusable, impossible to complete primary workflow, severe accessibility or responsive failure.
- P1: major issue that strongly harms conversion, comprehension, trust, or task completion.
- P2: noticeable quality issue: spacing, alignment, hierarchy, contrast, density, state polish.
- P3: optional polish.

## Implementation Loop

1. Direction fit.
2. Visual Evidence Inventory.
3. Reference Read Proof when a reference is used.
4. Nearby pattern and token scan.
5. Implementation.
6. Screenshot/browser recheck when feasible.
7. Reference vs Implementation Matrix when reference fidelity matters.
8. Design Quality Review.
9. Design Completion Gate before any done claim.
10. Deep Visual Review when the work needs acceptance criteria, state matrix, skipped checks, residual risks, stop condition, or resume hint.
11. Review Continuity and Comparison Report when the work spans multiple passes.
12. P0/P1 closeout.
13. Truth status.

## Truth Caps

- Full visual verification: real source-screen evidence and relevant recheck.
- Partial: text-only review, no screenshot, browser unavailable, or source-state gaps.
- Blocked: requested visual claim cannot be inspected.
- Assumed: implementation follows code patterns but visual result was not observed.
- Reference-only or generated-only evidence cannot upgrade a result to full visual verification.
- A done claim without a passing design completion gate cannot upgrade beyond partial or blocked.
