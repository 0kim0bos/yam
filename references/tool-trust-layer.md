# Tool Trust Layer

`yam` should grow a proof-first trust layer, but not a proof-first cage.

The goal is to help a beginner start small and then move toward professional implementation with evidence, without making every step feel like a release gate.
This is not a lightweight-only direction. `yam-lite` is light; `yam` is progressive.

## Depth Ladder

Every route carries a basic contract:

- respect project direction before changing code
- use context packs or memory before broad re-reading
- verify only what was actually checked
- report remaining tasks and fix-first issues when useful

Then depth increases by route:

- `$question`: answer without unnecessary research.
- `$scout`: investigate and judge without implementation by default.
- `$quick`: implement quickly with focused verification.
- `$ueye`: implement/review UI with real visual evidence when feasible.
- `$deep`: prove risky single-agent work with stronger runtime/tool evidence.
- `$mission`: coordinate real subagents/team lanes with cross-verification.

## Surfaces To Wrap

- Codex CLI/App readiness.
- Browser and Computer Use availability.
- tmux and long-running process lifecycle.
- Subagent/team availability for `$mission`.
- imagegen or screenshot evidence for `$ueye`.
- Context7 or official docs for current package/API questions.
- codex-lb or provider routing health when configured.
- DB/Supabase safety for destructive or migration work.
- Research, QA, wiki/context, proof, and release-gate workflows.

## yam Policy

Default:

- No automatic trust gate.
- No automatic proof loop.
- No automatic tmux.
- No automatic subagents.
- No automatic external provider setup.
- Basic direction fit and honest verification boundaries still apply.

Advisory:

- `yam-lite` hook may suggest routes and warn about overclaiming.
- `yam pack` may warn about stale project direction, command drift, active hooks, or legacy proof surfaces.

On demand:

- `$quick`: smallest honest local verification.
- `$ueye`: visual evidence and truth caps.
- `$deep`: single-agent heavy proof, runtime/tmux/browser/process cleanup.
- `$mission`: real subagent/team execution with cross-verification.
- `yam tools doctor`: inspect tool readiness without changing project state.
- `yam proof`: summarize actual evidence without running verification.
- `src/lib/trust-kernel.ts`: classify evidence, cap truth claims, distinguish fake/real proof, and summarize runtime truth.

## Strict Proof Inputs

- Tool readiness checks.
- Hook status and trust reporting.
- DB/Supabase destructive-operation gate thinking.
- Computer Use and screenshot evidence caps.
- tmux/process cleanup truth.
- Source-intelligence proof for current docs.
- Destructive DB/Supabase command detection and production-write caution.
- Fake-vs-real and runtime truth matrix checks, reduced to local route-scoped helpers.
- Feature/release inventory as an optional doctor, not a default gate.

## Modular Skill Inputs

- Selective install and profiles.
- Evidence boundaries.
- Low-context command detection.
- Optional orchestration instead of always-on orchestration.

## Design Quality Inputs

- Real preview/screenshot evidence.
- Compact design direction.
- P0 visual gates for design-heavy work.

## Reject

- Always-on Team route.
- Always-on hook enforcement.
- Release gates for normal coding.
- Mandatory generated image review for every UI task.
- Broad MCP/tool scans before small work.
- Provider config mutation without explicit user approval.

## Implemented Shape

`yam tools doctor` should be read-only by default:

- report installed/available tools
- report package scripts
- report hook conflicts
- report known high-risk surfaces
- suggest route and proof level
- do not install, configure, or mutate

`yam proof` should summarize what actually ran:

- command evidence
- browser/screenshot evidence
- runtime/tmux/process cleanup evidence
- truth status
- skipped/blocked/assumed items
