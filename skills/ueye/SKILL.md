---
name: ueye
description: UI/UX/design implementation and visual review route with screenshot evidence. Use when the user invokes $ueye or asks for design-heavy UI work, reference-image-based implementation, or visual UX review.
---

# yam Ueye

Use for:

- Design-heavy UI/UX implementation.
- Reference-image-based UI direction.
- Reference-image-based visual fidelity work where the result must be compared against the reference.
- Screenshot, URL, or current-screen UX review.
- Pre-fix and post-fix visual QA.
- UI states, responsive behavior, hierarchy, CTA, contrast, alignment, spacing, and affordance.

Do not use for:

- Tiny UI tweaks. Use `$quick`.
- Pure review of non-visual code risk. Use `$deep` or `$mission` when risk is high.
- Broad implementation plans with role split, runtime proof, or doctor scan. Use `$mission`.

## Principles

- Direction before execution.
- Visual evidence before visual claims.
- Ueye is the tight UX/UI/design route, not Quick with screenshots.
- Reference-based work requires reference read proof before implementation and reference comparison after implementation.
- Context-reuse first.
- Token economy is part of quality.
- Product fit beats decoration.
- Use existing tokens, components, typography, icons, and layout patterns first.
- Build the actual usable screen, not a marketing detour.
- Text-only visual critique cannot be reported as fully verified when screenshot evidence was required.
- Generated annotated images are optional, not a default gate.
- Image evidence should stay bounded: inspect the primary screen first, then only the states/images needed to support the claim.
- Design quality judgment belongs after implementation/review: compare to the reference first, then judge whether the result is good design.
- Keep Ueye as one route: start fast, then opt into `yam ueye capture` and `yam ueye compare` only when a `verified` visual claim needs real screen evidence.
- Use `yam ueye report` when reference, implementation screenshot, comparison result, design quality, and next action should be recorded as one compact run report.
- For follow-up visual reviews, keep continuity explicit: previous report/source, current report/source, comparison delta, resolved findings, new findings, and next action.
- Generated media can guide direction, but it cannot verify the implemented screen without implementation screenshot evidence.
- Prefer the in-app browser for interactive visual checks. Do not switch to a profile-dependent browser unless the user explicitly asks or the task requires existing cookies, sessions, extensions, or profile state.

## Workflow

1. Read `yam.project.md` and `.yam/memory/summary.md` only when present and useful.
2. Identify the target screen, product direction, audience, and reference image or URL.
3. Build or capture a source-screen inventory:
   - user-provided screenshot
   - local/browser screenshot
   - exported static artifact image
   - URL/current screen, when accessible
4. When a reference image/screen is used, produce Reference Read Proof before changing UI:
   - 5-8 concrete observations about layout, spacing, typography, color, hierarchy, component shape, interaction/motion, and brand mood.
   - Mark any ambiguous or unobservable detail instead of inventing it.
5. Inspect nearby UI patterns, tokens, styles, and state handling.
6. Implement the smallest coherent design improvement when implementation is requested.
7. Check default, loading, error, empty, disabled, hover/focus, and mobile states when relevant.
8. Run browser/screenshot verification when feasible.
   - Prefer the in-app browser for local pages, localhost, file URLs, and ordinary visual QA.
   - Do not silently use a profile-dependent browser as a fallback. If the in-app browser cannot capture or inspect, report the visual cap as `partial` or `blocked`.
   - Use `yam ueye capture --url URL --out path.png` when a project-local capture backend is available and the claim needs real browser evidence.
   - Use `yam ueye compare --reference ref.png --actual shot.png` when reference fidelity needs a proof-ready local comparison record.
   - Use `yam ueye report --reference ref.png --actual shot.png --design-quality needs-polish --json` to preserve the run-level visual provenance and next action.
   - When continuing a prior review, include previous/current report or screenshot identifiers and mark the comparison as improved, regressed, unchanged, or not-verified.
9. Compare reference and implementation when reference fidelity was requested:
   - matched, similar, different, not-applicable, or not-verified.
   - Separate "faithful to reference" from "good design."
10. Run Design Quality Review after implementation/review:
   - visual hierarchy
   - layout and spacing
   - typography
   - color and contrast
   - component detail
   - interaction and motion
   - responsiveness
   - accessibility
   - brand or mood fit
   - mark each relevant dimension as pass, needs-polish, or fails.
11. Produce a P0-P3 visual issue ledger and fix path.
12. Recheck changed/high-risk screens after fixes when feasible.

## Required Ueye Artifacts

Use these artifacts for reference-led implementation or serious visual review. Keep them compact for small screens, but do not omit them when the claim depends on reference fidelity.

1. Visual Evidence Inventory:
   - reference, before, and after evidence when available.
   - path or URL, source type, state, viewport, and visual verification cap.
   - sha256 and dimensions when an image file is locally available.
2. Visual Provenance:
   - source kind, path, hash, reference id, screenshot id, redaction/locality flags, operator-provided flag, comparison result, and truth status.
   - use this to prove the route from reference reading to implementation recheck.
3. Reference Read Proof:
   - concrete observations from the reference before implementation.
   - no implementation claim should depend on an unrecorded reference observation.
4. Reference vs Implementation Matrix:
   - compare the implemented result against the reference by aspect.
   - record matched, similar, different, not-applicable, or not-verified.
5. Design Quality Review:
   - judge whether the result is good UI/UX/design after reference comparison.
   - use pass, needs-polish, or fails for each relevant design dimension.
6. Review Continuity and Comparison Report, when this is a follow-up review:
   - record previous source/report, current source/report, comparison delta, resolved findings, new findings, still-open findings, truth status, and next action.
7. Media Generation Proof, when generated images are part of the task:
   - record whether generation was requested, attempted, blocked, or produced an output.
   - use `yam media proof --requested --attempted --output path.png --wait-loop --json` when a generated image materially affects the design direction.
   - never use generated media proof as a substitute for implemented screen evidence.

## Visual Truth Caps

- Full visual verification requires real source-screen evidence.
- Reference images guide direction; they do not prove the implemented screen unless compared with real source-screen evidence.
- Reference fidelity claims require both Reference Read Proof and Reference vs Implementation Matrix.
- Generated or annotated images are derivative evidence; they cannot upgrade missing real screen evidence to `verified`.
- Inspect 1-3 primary images by default; expand only for P0/P1 risk, responsive breakage, or user-requested deep visual QA.
- Keep source-screen inventory to the 5 most important rows by default.
- Screenshot unavailable: cap the result at `partial` or `blocked`.
- Text-only review: cap the result at `partial`.
- Mock or invented screenshots: cap the result at `partial` and mark the source.
- Browser unavailable but source files reviewed: report implementation verification separately from visual verification.
- Generated callout images may improve review quality, but missing generated images must not block ordinary Ueye work.

## Design Checks

Use `references/ueye.md` and `references/ui-quality.md`.
Always consider:

- Direction fit.
- Hierarchy.
- CTA clarity.
- Spacing and alignment.
- Contrast.
- Density.
- Text fit.
- Responsive behavior.
- State coverage.
- Interaction affordance.
- Consistency with the project's visual language.

## Final Response

Report:

- What changed visually or what was reviewed.
- Source evidence used.
- Reference Read Proof and reference comparison result when a reference was used.
- Design Quality Review result when implementation or serious visual review was requested.
- Review continuity/comparison result when this continues a prior Ueye run.
- P0-P3 issues or confirmation that no blockers were found.
- States/viewports checked.
- Truth status and visual verification cap.
- Remaining tasks and fix-first items before planned tasks when useful.
