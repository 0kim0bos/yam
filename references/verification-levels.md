# Verification Levels

## Level 0: Read/Inspect

For copy, spacing, small CSS, docs, or no-runtime changes.

Expected:

- Re-read the changed file or relevant snippet.
- Check local project fit.
- Report that no command was run.

## Level 1: One Relevant Check

For small JS/TS/component changes.

Examples:

- One focused test.
- Typecheck.
- Lint for touched area.

## Level 2: Focused Confidence

For feature-sized work.

Examples:

- Typecheck plus related test.
- Build if no narrower test exists.

## Level 3: UI Confidence

For visible UI changes.

Expected when feasible:

- Desktop screenshot or browser check.
- Mobile viewport check.
- Check overflow, alignment, contrast, density, and core states.

## Level 4: Deep Confidence

For auth, payment, DB, migration, release, broad refactor, or user-requested deep verification.

Examples:

- Build.
- Test suite or relevant suites.
- Browser QA.
- Security check.
- Proof summary.

