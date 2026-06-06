# Trust Kernel

This is the small trust kernel that keeps `yam` honest without turning every task into a release gate.

`yam` implements these ideas as small local functions. It does not install always-on gates, external runtimes, or hidden orchestration.

## Included

- completion proof shape
- route/truth status separation
- fake versus real evidence distinction
- runtime truth matrix idea
- visual evidence caps
- Ueye design completion gate
- DB/Supabase destructive-signal detection

## Rejected

- always-on release gates
- mandatory team/subagent evidence for normal work
- mandatory tmux lifecycle proof for small work
- image voxel ledger as a default requirement
- broad source/tool scans before ordinary changes

## yam Shape

Implemented as:

```text
src/lib/trust-kernel.ts
```

The module provides:

- `TRUTH_STATUSES`
- DB/Supabase safety detection
- evidence classification
- truth cap application
- fake/real policy
- runtime truth matrix
- completion proof object creation
- Ueye design completion gate creation

## Policy

Use the kernel to prevent overclaiming.

Do not use it to slow every task down.

For example:

- Reference image only cannot become full visual `verified`.
- Mock/fixture evidence cannot become real runtime `proven`.
- Required runtime evidence that is missing becomes `real_required_missing`.
- Cleanup claims require cleanup evidence.
- Ueye `done` claims require a passing design completion gate or stay capped at `partial` or `blocked`.

This keeps the trust layer progressive and route-scoped.
