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

## Truth Caps

- Full visual verification requires real implementation evidence and relevant recheck.
- Reference-only evidence can support direction, not implementation proof.
- Generated-only evidence can support ideation or annotation, not implemented-screen verification.
- Missing screenshots, unavailable browser, or text-only review should cap the result at `partial`, `blocked`, or `assumed`.
