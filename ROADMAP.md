# yam Roadmap

## Current State

Implemented:

- Skills-first workflow.
- Six routes: quick, ueye, question, scout, deep, mission.
- Shared references.
- Local CLI: list, status, verify, doctor, examples, path, install, uninstall.
- CLI helpers: detect, budget, template, tune-log, version.
- Optional advisory `yam-lite` hook with status/enable/disable. Done.
- Opt-in project memory: init, add, list, summary, resolve.
- Honest completion guard: no verified/cleanup/visual claims without evidence.
- No hooks, automations, or global config.
- Token economy policy.

## Next Stages

### 1. Real-Use Tuning

Goal: improve route wording from actual use.

Tasks:

- Try `$quick` on tiny code/UI edits and quick build/type error scans.
- Try `$ueye` on one real design-heavy UI improvement.
- Try `$ueye` on screenshot review.
- Record where the skill over-reads, under-checks, or reports too much.
- Add tuning log helper. Done.
- Tighten instructions.

### 2. Direction Pack

Goal: make project direction checks faster.

Tasks:

- Add optional `yam.project.md` template. Done.
- Capture product direction, design tone, tech stack, test commands, and no-go rules.
- Let routes read this one small file before broader project context.
- Strengthen `yam pack`: stale pack, command drift, active hooks/instruction surfaces, and legacy pack detection. Done.

### 3. Verification Detector

Goal: suggest the smallest useful verification command.

Tasks:

- Read `package.json` scripts.
- Detect common commands: typecheck, lint, test, build. Done.
- Map changed files to likely checks. Partial: route-level suggestions added.
- Keep this advisory, not mandatory.

### 4. Token Budget Reporter

Goal: keep the workflow honest about context usage.

Tasks:

- Add `yam budget` command. Done.
- Print recommended read budgets per route. Done.
- Add warning for broad context in quick/Ueye routes. Partial: route budgets define expand triggers.

### 5. Ueye Workflow

Goal: make screenshot/UI review and reference-led design implementation more repeatable.

Tasks:

- Merge `ui`, `eye`, and `review` into `ueye`. Done.
- Add Ueye checklist refinements. Done.
- Add Visual Evidence Inventory, Reference Read Proof, Reference vs Implementation Matrix, and Design Quality Review. Done.
- Add optional browser/screenshot capture notes.
- Keep image generation optional, never a gate.

### 6. Deep Runtime Workflow

Goal: make long-running verification reliable without keeping runtime as a separate route.

Tasks:

- Add runtime proof template. Done.
- Add process lifecycle checklist. Done.
- Fold tmux/dev server/browser QA/cleanup proof into `$deep`. Done.
- Retire standalone `$runtime`. Done.

### 7. Packaging

Goal: make install/update simpler.

Tasks:

- Add symlink-friendly local install.
- Add version command. Done.
- Consider npm packaging only after route behavior stabilizes.

### 8. Scout / Research Workflow

Goal: give yam a research lane that is evidence-bound, lightweight, and decision-oriented.

Research reference points:

- Evidence boundaries.
- Source freshness.
- Fact/inference/recommendation separation.
- Decision-oriented summaries.

Tasks:

- Strengthen `$scout` into the main research/investigation route. Done.
- Add an explicit third-party judgment format. Done:
  - objective judgment: evidence, constraints, market/technical reality
  - subjective judgment: taste, product instinct, likely user perception
  - macro view: broad direction and category movement
  - realistic view: near-term feasibility and cost
  - future view: second-order effects and durable bets
- Keep source count bounded by default; heavy research remains opt-in. Done.
- Avoid making research a default gate for implementation. Done.

### 9. Question Workflow

Goal: add a very-light question-answer route for simple explanations.

Tasks:

- Add `$question` as a tiny Q&A skill. Done.
- Use it for direct questions where no code changes, no broad research, and no heavy verification are needed. Done.
- Treat it as the very-light version of `$scout`. Done.
- Keep answers concise, with explicit uncertainty when relevant. Done.

### 10. GitHub Publishing

Goal: prepare yam for a personal GitHub repo under `0kim0bos`.

Tasks:

- Choose repository description.
- Add a short public README intro.
- Add install/update instructions for local Codex skills.
- Add a clear note that yam installs no hooks and no automations by default.
- Re-run source/install verification before publishing.

### 11. Memory Workflow

Goal: preserve durable lessons without turning yam into a heavy automatic memory system.

Kept:

- Sparse one-record-per-file storage.
- Wrongness-style records for repeated mistakes and wrong decisions.
- Deliberate forgetting via resolve instead of permanent prompt injection.

Kept:

- Evidence before recommendation.
- Clear separation between observation and next action.

Kept out by design:

- Automatic context injection.
- Proof gates.
- Image voxel ledgers.
- Multi-worker publishing/index rebuilds.

Tasks:

- Add `.yam/memory/records/*.json` storage. Done.
- Add `yam memory init/add/list/summary/resolve`. Done.
- Add lightweight secret-pattern blocking. Done.
- Teach context reuse to prefer `summary.md`, not full record reads. Done.
- Keep memory opt-in only. Done.

### 12. Runtime Truth Workflow

Goal: prevent false runtime completion while keeping ordinary work fast.

Kept:

- Runtime truth vocabulary.
- Cleanup must be backed by exit/closure evidence.
- tmux physical proof idea, reduced to route-level evidence notes.

Kept:

- Evidence boundaries before recommendation.
- Explicit partial/blocked/assumed language.

Kept out by design:

- Automatic tmux for ordinary work.
- Forced release gates.
- Mandatory physical pane proof for every task.
- Real dynamic agent smoke by default.

Tasks:

- Add honest completion reference. Done.
- Expand truth matrix with runtime-specific statuses. Done.
- Treat tmux as first-class but opt-in inside `$deep` runtime verification. Done.
- Update runtime proof template with pane/process cleanup evidence. Done.

### 13. Mission Workflow

Goal: provide one explicit heavy execution route without increasing total skill count.

Kept:

- Real Team/subagent route boundary.
- Cross-verification before completion.
- Runtime/tmux/browser proof when mission evidence needs it.

Kept:

- Role-specific work boundaries.
- Evidence-first reporting.
- Doctor/scanner perspective.

Kept out by design:

- Auto-escalating small tasks into mission.
- Mission role-play without real subagents; single-agent heavy work belongs in `$deep`.
- Runtime as a separate skill.

Tasks:

- Add `$mission` route. Done.
- Retire `$runtime` route and clean installed skill on install. Done.
- Keep route count small. Done: six active routes.
- Make `$deep` own runtime/tmux/process verification. Done.
- Add mission prompt template. Done.
- Add doctor scan checklist. Done.
- Require real subagent/team execution for full `$mission`; otherwise downgrade to `$deep` or report partial/blocked. Done.

### 14. Quick / Ueye Consolidation

Goal: remove overlapping skill roles while preserving the best parts of the old routes.

Kept:

- Source screenshot inventory before visual claims.
- P0-P3 issue ledger.
- P0/P1-first fix loop.
- Partial truth cap for text-only or missing-screenshot review.

Kept:

- Smallest useful verification command.
- Group errors by file and root cause.
- Fix one error class at a time.
- Compact PASS/FAIL reporting.

Kept:

- Real preview/screenshot evidence.
- Compact design direction.
- P0 visual quality gates over placeholder output.
- Post-implementation design quality judgment across hierarchy, spacing, typography, color, component detail, interaction, responsiveness, accessibility, and brand fit.

Kept out by design:

- Mandatory generated annotated images.
- Always-on visual proof gates.
- Broad design-system archaeology for small polish.
- Separate review skill that overlaps implementation and visual QA.

Tasks:

- Add `$quick`. Done.
- Add `$ueye`. Done.
- Retire `$fast`, `$build`, `$ui`, `$eye`, and `$review`. Done.
- Update CLI budgets, templates, docs, manifest, install cleanup. Done.
- Re-run source and installed-skill verification. Pending after install.

### 15. Lite Hook / Progressive Tool Trust Layer

Goal: keep beginner momentum while creating a path toward professional proof-first work.
The hook stays light, but the `yam` direction does not. `yam` should support a depth ladder: direction fit first, focused proof for ordinary work, strong proof for risky work, and real team proof for `$mission`.

Kept:

- Hook status and trust reporting.
- Tool readiness as evidence.
- DB/Supabase safety thinking.
- Runtime/tmux/process cleanup truth.

Kept:

- Selective install and low-context operation.
- Evidence boundaries instead of always-on gates.

Kept out by design:

- Always-on proof gates.
- Auto-running `$quick`.
- Auto-running verification, tmux, subagents, or dependency install.
- Provider config mutation without explicit approval.

Tasks:

- Add `yam hook status|enable|disable|run lite`. Done.
- Keep `yam-lite` advisory-only through `UserPromptSubmit`. Done.
- Add `references/tool-trust-layer.md`. Done.
- Add read-only `yam tools doctor`. Done.
- Add `yam proof` summary command. Done.
- Add DB/Supabase safety lite. Done.
- Add current-docs/Context7 selective rule. Done.
- Strengthen Ueye image evidence caps. Done.
- Add `yam tools doctor --json`. Done.
- Add shallow `.sql` destructive keyword scan. Done.
- Add `yam proof write`. Done.
- Prepare npm/npx package metadata and dry-run packaging. Done.
- Add small route-scoped trust kernel: truth caps, fake/real policy, runtime truth matrix, and completion proof object. Done.

### 16. Deferred Triggers

Goal: keep useful future trust-layer ideas visible without turning them into always-on gates too early.

Rules:

- Do not implement deferred items just because they are listed here.
- Mention an item again when its trigger appears in real use.
- Prefer lite metadata before runtime systems.
- Keep ordinary `$quick`, `$question`, and `$scout` flows free of these gates.

#### Mission Patch Queue Lite

Status: documented lite shape for `$mission` only; implementation remains route-scoped.

Trigger:

- A mission uses two or more real subagent/lane outputs.
- Multiple lanes touch nearby files or the same subsystem.
- It becomes hard to tell who changed what, why, and how to revert it.
- Mission rollback or apply order starts to matter.

First shape:

- pending / applied / verified / reverted / blocked state.
- lane id and assigned scope.
- changed files.
- verification hint.
- rollback hint.
- truth status.

Keep out for now:

- automatic merge engine.
- persistent locks.
- parallel apply worker.
- broad runtime orchestration.

#### Tool Intent Label / Tool Trust Metadata

Status: near-term lightweight metadata.

Trigger:

- A route uses several tool classes together, such as browser, package manager, GitHub, filesystem, database, or deployment tools.
- Read-only and write actions need to be distinguished in proof.
- Destructive actions need a visible route recommendation before execution.
- Release or mission reports need clearer evidence about what kind of tool ran.

First shape:

- tool intent: read_only / write / destructive / runtime / visual.
- parallel safe: true / false / unknown.
- approval required: true / false / unknown.
- evidence kind and truth status.

Keep out for now:

- automatic scheduling.
- automatic permission mutation.
- mandatory tool graph.

#### MCP Scheduler Runtime

Status: later.

Trigger:

- Tool intent labels are no longer enough.
- The workflow starts coordinating multiple external tools inside one route.
- Write or destructive actions could run near read-only checks.
- Parallel tool execution becomes common and needs ordering.
- A mission needs deterministic tool sequence proof.

First shape:

- scheduler proof object.
- read-only overlap allowed.
- write/destructive serialization.
- blocked/approved/skipped status.

Keep out for now:

- default scheduler for normal work.
- route-wide mandatory scheduler.
- background runtime service.

#### Appshots Attachment Gate

Status: deferred.

Trigger:

- Ueye visual provenance cannot answer which exact visual source was used.
- A team workflow needs thread-level or attachment-level audit trails.
- Reference and implementation screenshots are easy to confuse.
- External review requires source image lineage beyond path/hash/id.

First shape:

- optional attachment source fields.
- no mandatory gate.
- preserve Ueye visual provenance as the default.

Keep out for now:

- required thread attachment ids.
- app-specific visual gates.
- blocking ordinary Ueye work when attachment metadata is absent.
