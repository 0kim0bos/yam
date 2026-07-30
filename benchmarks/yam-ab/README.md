# yam A/B Evaluation

This directory contains a controlled A/B evaluation for a small
implementation-choice policy. Arm A preserves the pinned `yam-flow@2.4.0`
baseline. Arm B adds only the three treatment sentences recorded in
[`experiment.json`](experiment.json).

The implementation is safe by default:

- running `run-experiment.mjs` without `--execute` only prints a plan;
- actual calls require both `--execute` and `YAM_AB_AGENTIC_ENABLED=1`;
- model and reasoning effort must be explicit;
- the Codex CLI version must match the pinned experiment version;
- a hook/plugin/app/network isolation canary must pass before fixture work;
- every fixture starts in a new operating-system temporary workspace;
- credentials are never read or copied by the runner;
- API-key and access-token environment variables are not forwarded;
- dangerous sandbox and hook-trust bypass flags are never used;
- raw Codex JSONL and editable workspaces are not retained;
- scorers and canonical protected files remain outside agent workspaces.

The runner contract follows the official Codex non-interactive guidance for
`codex exec`, `--ephemeral`, `--ignore-user-config`, `--ignore-rules`,
`--json`, structured outputs, and least-privilege `workspace-write` sandboxing.
See [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode.md).

## Baseline identity

```text
Git commit: bfc09e66e23cc0ea05a3e04fb9efa0a7cc3664db
Package: yam-flow@2.4.0
Installed skill receipt digest:
cf5024b8c8540d0cfed8fe07e027e5022719cc483cdae07d5e38b1ebdfef6609
Codex CLI: 0.146.0
```

The baseline builder reads committed Git objects. It does not copy the dirty
working tree, and its manifest does not contain the local repository path.

## Offline verification

Run both offline checks before any paid execution:

```bash
node benchmarks/yam-ab/scripts/selftest.mjs
node benchmarks/yam-ab/scripts/runner-selftest.mjs
```

The first check reconstructs and hashes the baseline, then verifies all eight
fixture seeds, good references, bad references, protected-file gates, and
temporary-directory cleanup.

The second uses a local Codex test double. It verifies the isolation canary,
balanced scheduling, scorer integration, token/tool/duration/cost extraction,
receipt generation, blind packet creation, unblinding, and cleanup without a
model or authentication call.

To inspect a baseline manually:

```bash
temp_root="$(node -p "require('node:os').tmpdir()")"
node benchmarks/yam-ab/scripts/prepare-baseline.mjs \
  --out "$temp_root/yam-ab-baseline-2.4.0" \
  --json
```

The target must be new, below Node's operating-system temp directory, outside
the yam repository, and free of symbolic-link parent components.

## Fixtures

| Fixture | Policy surface | Hard target |
| --- | --- | --- |
| `reuse-helper` | Existing project capability | Reuse `formatCurrency` |
| `safe-upload-path` | Security boundary | Lexically contain one portable filename component |
| `native-query-parser` | Native platform API | Use `URL` query parsing |
| `installed-slugifier` | Installed capability | Reuse the approved slugifier |
| `shared-email-normalizer` | Shared root cause | Fix the normalizer, not callers |
| `accessible-icon-button` | Accessibility | Explicit name and decorative icon semantics |
| `honest-verification-status` | Evidence honesty | Never overstate verification |
| `minimal-initials` | Smallest custom code | Handle edge cases without dependency or abstraction |

Every bad reference passes its visible happy-path test but fails at least one
hidden behavior, integrity, security, accessibility, or design gate.

## Plan an experiment

Planning is offline and does not require authentication:

```bash
node benchmarks/yam-ab/scripts/run-experiment.mjs \
  --model "<exact-model-id>" \
  --reasoning medium \
  --repetitions 3 \
  --seed yam-ab-v1
```

The full default plan contains 48 fixture calls: eight fixtures, two arms, and
three repetitions. Actual execution adds one isolation-canary call.

Use `--fixtures reuse-helper,safe-upload-path` for a smaller pilot. Repetitions
must be between 1 and 10. Fewer than three repetitions remain
`insufficient_agentic_runs` and cannot support adoption.

## Run the controlled A/B

Choose a new output path under Node's temp directory:

```bash
temp_root="$(node -p "require('node:os').tmpdir()")"
YAM_AB_AGENTIC_ENABLED=1 node benchmarks/yam-ab/scripts/run-experiment.mjs \
  --execute \
  --model "<exact-model-id>" \
  --reasoning medium \
  --repetitions 3 \
  --seed yam-ab-v1 \
  --out "$temp_root/yam-ab-run-001"
```

The runner reuses the Codex CLI's existing authenticated session, but does not
open, copy, print, or write `auth.json`. It invokes Codex with user config and
execpolicy rules ignored, hooks/plugins/apps/web disabled, ephemeral sessions,
`approval_policy="never"`, and `workspace-write`.

If the CLI version, login preflight, or isolation canary fails, no fixture
calls run.

### Optional explicit pricing

Codex JSONL provides token usage, not a stable per-run dollar cost. The runner
therefore refuses to invent pricing. Supply a reviewed price contract only
when a cost estimate is needed:

```json
{
  "model": "<exact-model-id>",
  "input_per_million_usd": 0,
  "cached_input_per_million_usd": 0,
  "output_per_million_usd": 0
}
```

Pass it with `--pricing /absolute/path/pricing.json`. The model must exactly
match `--model`. Without the file, token counts are recorded and
`estimated_cost_usd` remains `null`.

## Result artifacts

The new temp output contains:

- `canary-receipt.json`
- `run-contract.json`
- `receipts/*.json`
- `submissions/*` containing only declared mutable files
- `summary.json`
- `runtime-evidence.json`

Raw JSONL is hashed for provenance and then discarded. Agent last messages are
sanitized before entering receipts. The dedicated editable work root is
removed and its absence is checked. The result directory is intentionally
retained for review.

Automated decisions:

- `reject_candidate`: a security/accessibility regression was observed;
- `insufficient_agentic_runs`: pairs are missing or repetitions are below 3;
- `awaiting_blind_review`: deterministic evidence is sufficient to start
  blinded quality review.

## Blind review

Prepare a blinded packet after a completed run:

```bash
node benchmarks/yam-ab/scripts/prepare-blind-review.mjs \
  --run-dir "<temp-run-directory>"
```

Share only:

- `review-packet.json`
- a copy of `blind-reviews.template.json`

Do not share `unblinding-key.json` with the reviewer. Complete every comparison
with a submission id or `tie`, a confidence from 1 to 5, safety concerns, and
notes. Then finalize:

```bash
node benchmarks/yam-ab/scripts/finalize-blind-review.mjs \
  --run-dir "<temp-run-directory>" \
  --reviews "<completed-reviews.json>"
```

The finalizer validates packet identity and complete pair coverage before
unblinding. A candidate recommendation requires:

1. no security or accessibility regression;
2. complete minimum repetitions;
3. candidate pass rate not below baseline;
4. more blind preferences for candidate than baseline;
5. no unresolved reviewer safety concern.

## Preserved evidence

Completed, reviewed runs that must survive OS temporary-directory cleanup live
under `evidence/`. Each run uses a new immutable directory with a README and
`SHA256SUMS`. Preserve only sanitized receipts, submissions, review artifacts,
and final decisions; never add raw Codex JSONL, credentials, or editable work
roots. The benchmark directory is excluded from the published npm package.

## Deliberate limits

- The runner does not select a model or current pricing automatically.
- It does not run unattended, install dependencies, change global hooks, or
  restart Codex.
- It does not retain raw reasoning or JSONL transcripts.
- Human blind review is implemented; an additional LLM judge is intentionally
  omitted because it would add cost and correlated model bias without being
  required for the adoption gate.
- `safe-upload-path` measures lexical path construction. It rejects
  drive-qualified names such as `C:foo`, but does not claim that returning a
  path makes a later file write symlink-safe. The storage layer must use
  no-follow or equivalent exclusive-open semantics.
