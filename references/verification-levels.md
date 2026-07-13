# Verification Ladder

`yam` starts with momentum, but it is not lightweight-only. Verification should become heavier when scope, risk, public release, runtime state, UI completion, auth, DB, broad refactor, or user intent makes false completion costly.

Use the smallest level that honestly supports the claim, then escalate deliberately.

## L0: Stated

Explanation only. No code or artifact was inspected deeply enough to support an implementation claim.

Use for:

- Pure Q&A.
- Early plan or hypothesis.
- Scout recommendation before implementation.

Report:

- Truth status: `assumed` or `skipped`.
- Say no verification ran.

## L1: Inspected

Relevant file, snippet, error, screenshot, or project context was read.

Use for:

- Tiny docs/copy/config edits.
- Local explanation based on source reading.
- First pass on a small bug.

Expected:

- Re-read the changed snippet.
- Check local project fit.
- Report that no command ran if none did.

Truth cap:

- Usually `partial` or `assumed`, not `verified`.

## L2: Local Check

One focused local check supports the claim.

Use for:

- Small TS/JS/app logic changes.
- Narrow bug fixes.
- Focused build/type/lint/test failures.

Examples:

- Typecheck.
- Lint for touched area.
- One focused test.
- Small CLI smoke for the touched command.

Truth cap:

- `verified` only for the checked surface.

## L3: Integrated

The change was checked through a broader local workflow or user-facing path.

Use for:

- Feature-sized work.
- Package-facing CLI changes.
- UI changes with visible behavior.
- Changes that affect multiple files or flows.

Examples:

- Build.
- CLI smoke.
- Relevant workflow command.
- Browser check or screenshot.
- UI state/responsive check.

Truth cap:

- `verified` for the exercised workflow.
- `partial` when important states, devices, or integrations remain untested.

## L4: Release / Runtime / Visual Proof

Proof artifact or runtime/visual/release evidence supports the claim.

Use for:

- Public release readiness.
- Runtime process claims.
- Cleanup claims.
- Browser or screenshot visual verification.
- Auth/payment/DB/deployment/security-sensitive changes.

Examples:

- `yam release report --json`.
- Runtime evidence with process, port, URL, or cleanup observation.
- Ueye visual report with screenshot/provenance.
- DB/security readiness report.
- Readiness receipt or proof bundle.

Truth cap:

- `proven` only when runtime/process evidence exists.
- `verified` only when the relevant check actually passed.
- `blocked` when auth/tool/runtime evidence is required but unavailable.

## L5: Bounded Deep

Multiple relevant checks are combined, with a stop condition, skipped checks, residual risk, and handoff.

Use for:

- Broad refactors.
- Release candidates.
- Risky auth/payment/DB/runtime/deployment work.
- User-requested deep verification.
- Work with high learning value or high false-completion cost.

Expected:

- Define acceptance criteria.
- Run the relevant set of checks, not every possible check.
- Record proof summary or proof bundle lite.
- List skipped checks and why.
- List residual risks and remaining tasks.

Stop condition:

- Stop after the smallest meaningful verification set has passed, or after three relevant checks have run and any remaining uncertainty is clearly listed as blocked/remaining work.
- Stop earlier when the same blocker repeats, a required tool/auth/runtime is unavailable, or a user decision is needed.
- Do not keep retrying the same failure. Classify `failure_cause`, give `recovery_hint`, and hand off.

## Route Defaults

- `$question`: L0-L1.
- `$scout`: L0-L1 for judgment; source-backed but not implementation verification.
- `$quick`: L1-L2 by default; L3 only when the claim needs it.
- `$ueye`: L1-L3 for ordinary UI work; L4 when claiming visual done.
- `$deep`: L3-L5 when risk or user intent calls for strong verification.
- `$mission`: L4-L5 when real subagents/team lanes are used, with cross-verification, per-thread receipts, and a passing aggregate completion gate.

## Completion Claim Rule

Completion claims require evidence at or above the level implied by the claim:

- Code changed: at least L1, preferably L2.
- User-facing behavior changed: L2-L3.
- UI done claim: L3-L4 with visual evidence when feasible.
- Runtime/cleanup claim: L4.
- Release/auth/DB/security claim: L4-L5.
- Mission verified/proven claim: L4-L5 plus expected-thread receipt coverage and completion gate.

If the evidence level is lower than the claim, lower the truth status and report the gap.
