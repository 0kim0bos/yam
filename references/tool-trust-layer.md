# Tool Trust Layer

`yam` should grow a proof-first trust layer, but not a proof-first cage.

The goal is to help a non-specialist start with momentum and then move toward professional implementation with evidence, wider judgment, security-first guidance, and useful change insight.
This is not a lightweight-only direction. `yam-lite` is light; `yam` is progressive and is allowed to become deeper as the user's knowledge and project risk grow.

## Depth Ladder

Every route carries a basic contract:

- respect project direction before changing code
- use context packs or memory before broad re-reading
- verify only what was actually checked
- report remaining tasks and fix-first issues when useful
- include a Study Note when code, config, release metadata, documentation, or project artifacts changed
- explain what changed, what role it has, what behavior is expected, and one useful syntax or structure insight in plain language
- treat security as the first project lens
- preserve source boundaries when outside references shaped the judgment

Then depth increases by route:

- `$question`: answer without unnecessary research.
- `$scout`: investigate and judge without implementation by default.
- `$quick`: implement quickly with focused verification.
- `$ueye`: implement/review UI with real visual evidence when feasible.
- `$deep`: prove risky single-agent work with stronger runtime/tool evidence.
- `$mission`: coordinate real subagents/team lanes with cross-verification.

Verification should follow the L0-L5 ladder: stated, inspected, local check, integrated, release/runtime/visual proof, bounded deep. Serious claims can require serious evidence, but stop after the smallest meaningful proof set passes or after remaining uncertainty is clearly handed off.

## Surfaces To Wrap

- Local CLI/app readiness.
- Browser and screen-control availability.
- tmux and long-running process lifecycle.
- Subagent/team availability for `$mission`.
- imagegen or screenshot evidence for `$ueye`.
- Current official docs for package/API questions.
- provider routing health when configured.
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
- Screen-control and screenshot evidence caps.
- tmux/process cleanup truth.
- Source-intelligence proof for current docs.
- Destructive DB/Supabase command detection and production-write caution.
- Security-first risk surfacing for non-specialists.
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

## Change Insight Inputs

- What the touched code or artifact is responsible for.
- What changed in behavior, contract, UI, or safety posture.
- What syntax, schema, or structure insight helps a non-specialist understand the change.
- What verification level supports the claim.
- Why the change matters to the product or user.
- What remains uncertain or unverified.
- What should be fixed first before the next planned task.

## Reject

- Always-on Team route.
- Always-on hook enforcement.
- Release gates for normal coding.
- Mandatory generated image review for every UI task.
- Broad connector/tool scans before small work.
- Provider config mutation without explicit user approval.

## Implemented Shape

`yam tools doctor` should be read-only by default:

- report installed/available tools
- report package scripts
- report hook conflicts
- report known high-risk surfaces
- suggest route and proof level
- do not install, configure, or mutate

Tool intent labels stay advisory and route-scoped:

- `read_only`: inspect, list, or report.
- `write`: edit workspace files or local generated artifacts.
- `destructive`: delete, reset, overwrite, publish irreversible data, or mutate production-like state.
- `runtime`: start, stop, probe, or depend on a live process.
- `visual`: capture, compare, or inspect screen evidence.
- `publish`: package, release, push, deploy, or expose artifacts.

`yam proof` should summarize what actually ran:

- command evidence
- browser/screenshot evidence
- visual provenance for reference-based UI work
- mission patch envelopes for real team lanes
- per-thread Mission receipts and aggregate completion gate
- runtime evidence mini for route-level runtime claims
- patch queue lite when mission lane apply/verify order matters
- rollback hints for risky changes
- runtime/tmux/process cleanup evidence
- structured diagnostic next action
- truth status
- skipped/blocked/assumed items

Reviewer and doctor Mission lanes use `read_only` intent by default. A receipt that claims write access or changed files for those roles is a contract violation, and a stopped thread without an explicit outcome is not success evidence.

`yam release report --json` should collect release readiness into a machine-readable artifact:

- typecheck
- forbidden names
- package boundary
- registry status
- CLI smoke
- dist freshness
- release tarball provenance: package name/version, tarball path, sha256, generated_at, source commit/tree state, included files summary
- diagnostics with structured next action
- final truth status

## Compact Artifact Contracts

Runtime evidence mini:

```json
{
  "kind": "runtime_evidence_mini",
  "route": "deep",
  "required": true,
  "command": "npm run dev",
  "target": "http://localhost:3000",
  "pid": "unknown",
  "port": "3000",
  "url": "http://localhost:3000",
  "exit_code": null,
  "screenshot_id": "",
  "started_at": "",
  "stopped_at": "",
  "process": {
    "session": "",
    "pane": ""
  },
  "observation": {
    "before": "",
    "after": ""
  },
  "cleanup": {
    "status": "checked_stopped",
    "evidence": ""
  },
  "truth_status": "partial",
  "next_action": {
    "kind": "run_check",
    "summary": ""
  }
}
```

Patch queue lite:

```json
{
  "kind": "patch_queue_lite",
  "items": [
    {
      "status": "pending",
      "lane_id": "",
      "depends_on": [],
      "assigned_scope": "",
      "changed_files": [],
      "verification_hint": "",
      "rollback_hint": "",
      "truth_status": "partial",
      "next_action": ""
    }
  ]
}
```

Structured diagnostic next action:

```json
{
  "status": "needs_action",
  "severity": "P2",
  "owner_route": "quick",
  "priority": "fix_first",
  "fix_first": true,
  "blocks_release": false,
  "observation": "",
  "evidence": "",
  "next_action": {
    "kind": "run_command",
    "command": "",
    "reason": ""
  },
  "truth_status": "partial"
}
```
