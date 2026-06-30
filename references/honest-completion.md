# Honest Completion

`yam` should prevent false completion without turning every task into a heavy proof ceremony.

## Completion Rule

Never claim that work is done, verified, cleaned up, visually checked, deployed, or fixed unless the matching evidence exists.

Use precise language:

- `done`: the requested edit or answer was completed.
- `verified`: an actual relevant check passed.
- `partial`: meaningful evidence exists, but not the full surface.
- `assumed`: inferred from code or context, with no execution evidence.
- `blocked`: the check could not run.
- `skipped`: intentionally not checked because it was not worth the cost.

## Default Guard

Every route should ask before final response:

- What did I actually change or answer?
- What evidence do I actually have?
- What did I not check?
- Is the truth status stronger than the evidence?
- Are there fix-first items before the next planned task?

## Lightweight By Default

For small work, the guard can be one sentence:

```text
Verification: not run; change was limited to copy/CSS and inspected locally.
```

For larger work, include proof summary and residual risk.

Use the L0-L5 Verification Ladder:

- L0 stated.
- L1 inspected.
- L2 local check.
- L3 integrated.
- L4 release/runtime/visual proof.
- L5 bounded deep.

Escalate when the claim touches public release, UI done, auth, payment, DB, runtime, deployment, broad refactor, security, high learning value, or explicit user intent.

Bounded heavy verification must stop after the smallest meaningful proof set passes, or after three relevant checks have run and remaining uncertainty is listed as blocked, skipped, or remaining work.

## Runtime Guard

Runtime work needs stronger evidence because long-running processes can create false success:

- Record the command or process that was started.
- Record the PID, port, session, or tmux pane when available.
- Do not claim cleanup unless process exit or intended persistence is confirmed.
- Do not claim browser/visual verification unless a browser check, screenshot, or equivalent evidence exists.

## What yam Does Not Do By Default

- No automatic proof gates.
- No forced subagents.
- No automatic tmux for ordinary work.
- No release-blocking runtime proof unless the user chooses `$deep` or `$mission`.
- No full `$mission` claim without real subagent/team evidence; downgrade to `$deep`, or mark mission partial/blocked.

Design baseline:

- Strict proof collects stronger physical proof and gates completion more aggressively.
- Modular skill workflows keep evidence boundaries and report what is known vs inferred.
- Minimal-core design keeps the rule short and obeyable.

`yam` keeps the guard explicit, cheap, and route-aware.
