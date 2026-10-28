# Test check completion gate

Test check validates changed work before a completion claim, even without a commit
or push request. It is separate from report formatting and Security check. It does
not certify every possible input or prove a live deployment from a fixture.

## Contract

1. At work start, identify the exact baseline commit and expected behavior. Review
   the project-owned policy before executing its commands. Commands run as the
   caller without a shell; they are authorized project code, not a security sandbox.
2. Configure `testing/policy.json` (shared) or `.yam/testing/policy.json` (private).
   `yam template test-check` prints a starter that cannot pass without an adapter.
3. Each changed source file must match a surface's exact path or `directory/**`.
   Declare risk, targets and required scenarios. Built-in risk floors cannot be
   reduced by deleting checks. API/DB/auth/UI require integration or E2E evidence.
4. At implementation end, `plan` checks impact and required scenarios; `run` executes
   adapters and records exit codes/output hashes. Empty changes, zero tests, zero
   assertions, skips, failing results and missing observations block. One identical
   command executes once per run, even when it reports several scenarios.
5. `check` revalidates the policy, receipt, note, entire source snapshot, environment
   identity and required scenario inventory. A relevant edit invalidates the result.
6. Completion requires PASS. An unavailable environment is BLOCKED, with a truthful
   incomplete handoff permitted; it must not be described as completed verification.
   Stop accepts a standalone `Test check: BLOCKED` status line, including bold
   Markdown and a following explanation. This ends the reporting correction loop;
   the failed check stays BLOCKED and grants no commit/push/deployment approval.
   Quoted or fenced examples do not count as a status handoff. `symlink_rejected`
   means a source or evidence path contains a symbolic link: inspect the project
   paths and resolve ownership/layout before retrying, without disabling link checks.

### Repository skill aliases

Source snapshots recognize only `.<tool>/skills/<name>` aliases for `.agent`,
`.claude`, `.codex`, `.cursor`, `.gemini`, `.opencode` and `.windsurf`. Names use
ASCII letters/digits with dots, underscores or hyphens and start with a letter
or digit. The stored target must be exactly `../../.agents/skills/<name>`.
The target must contain a regular `SKILL.md`; current directory parents and the
target cannot redirect through links. Historical/index snapshots validate the
same target against regular entries in that exact Git tree, rather than the
current checkout. Missing, absolute, external, cyclic or alternate targets block.

The collector never traverses the alias. Its path, `120000` mode and target bytes
participate in the source fingerprint consistently in worktree, baseline, index,
outgoing and CI checks. Alias changes need scenario mapping, just like other
collected changes; Codex alias metadata is included despite other `.codex` data
being excluded. Canonical skill contents remain outside the application source
scope, as before; this is not a skill-content audit or permission to execute it.
Policy, observation, environment, receipt and deployment evidence files still
require regular files. General application source links remain unsupported.
Checkouts must materialize actual symbolic links; text placeholders produced by
Git with `core.symlinks=false` are rejected rather than treated as equivalent.

With a configured project, the automatic Stop hook distinguishes three states:
unchanged files since a reliable turn baseline need no new Test check; changed
files require current PASS; unavailable scope blocks completion claims even if
an earlier receipt passes. An explicit `Test check: BLOCKED` handoff ends the
correction without approving completion. Do not rerun failed commands unchanged.
Restore the scope or explain its limitation. Explicit Test check and
commit/push/CI/deployment gates retain their own evidence requirements.

Turn scope excludes the generated audit/work directories `.yam/deep/`,
`.yam/investigations/` and `.yam/ueye/`, alongside the existing generated paths.
This includes copied candidate source trees and SQL snapshots, not just logs.
Keep live project source/configuration outside these work directories, or opt it
in explicitly. Private `.yam/testing/` is mixed: data/report outputs (JSON/JSONL,
logs, Markdown, text, CSV, HTML, raster images, PDF, Office attachments and ZIP)
are excluded, but executable adapters and `policy.json`, `config.json`,
`setup.json`, `package.json`, `package-lock.json`, `tsconfig.json`,
`environment.json` and `*.config.json` stay visible. Custom data/config names
there require an explicit include. Public `testing/` is not excluded.
`.yam/study-note.json` `include` overrides generated-output exclusions and still
enforces the same file/byte limits. Scope errors expose only fixed diagnostic
codes, never file contents. These rules govern turn detection, not Test check's
source/evidence validation or symbolic-link rejection.

Risk floors:

| Risk | Required scenarios |
| --- | --- |
| docs | inspection |
| logic | success, invalid, boundary |
| api | success, invalid, contract |
| db | success, denied, invalid, readback, rollback, migration_upgrade, migration_fresh |
| auth | success, denied, cross_scope, revoked |
| ui | success, error |
| release | artifact, integrity |

Path heuristics are conservative supplementary detection, not a complete dependency
or semantic graph. SQL functions/procedures/policies/triggers found in the old and
new SQL file must have explicit targets, e.g. `function:public.receiving`. Quoted
identifiers and dynamic SQL currently block for manual review; overloaded signatures,
indirect effects and application-specific dependencies require explicit project tests.
Do not label a function passing merely because a broad file-level test passed.

## Commands and activation

For authorized implementation work, prepare a missing project connection at the
start rather than repeatedly ending with an unconfigured-gate handoff. Pure Q&A
or read-only review does not need setup. Existing policy/adapter files remain
user-owned and are never overwritten by the initializer.

```bash
BASE=$(git rev-parse HEAD) # capture before implementing the requested change
yam test-check status --json
yam test-check init --base "$BASE" --dry-run --json
yam test-check init --base "$BASE" --json
# Review the discovered commands, narrow draft paths/targets and connect real tests.
# Set testing/policy.json setup_status to ready after that project review.
yam test-check plan --base "$BASE" --json
yam test-check run --base "$BASE" --json
yam test-check check --json
```

`init` reads bounded repository paths and package-script metadata without executing
project commands. It creates four files: `testing/policy.json`,
`testing/yam-adapter.mjs`, `testing/yam-observations.mjs`, and `testing/setup.json`.
The setup file retains the exact baseline, discovered command names/frameworks,
risk areas and ordered next actions. It omits raw script bodies. Commands are
candidates to review, not permission to run production tasks or use credentials.
The process bridge supports structured observations supplied by the project;
it does not automatically parse or approve every framework's result format.

Initializer success means draft files were created, with `approval_granted:false`;
it grants no completion, commit or deployment approval. `setup_status:"draft"`
blocks command execution through the gate. The generated observer also fails closed
until connected to actual reports. Setting `ready` alone cannot pass. Existing
policies without this optional field retain their existing contract.

The agent implementing the requested feature should connect the existing tests,
map named cases to required scenarios and verify the connection within scope.
A suite total or an earlier passing browser run is not a substitute for scenario
mapping, measured assertions, source identity or real DB environment observations.
Broad draft paths are conservative candidates: refine them to real boundaries;
SQL functions and other specific targets still require explicit mapping.
Missing tests or unavailable environments remain BLOCKED; never add fake passing
counts, echo expected DB state, or change application/user permissions for setup.

`status` separately reports `configuration_status:not_configured|draft|configured`
(or `unavailable` when inspection fails). An unconfigured or draft project has
`result:BLOCKED` with `project_setup_required` and an actionable next step. A
configured project still needs a current passing run; configuration is not approval.
`init --dry-run` writes nothing; repeated init preserves existing public/private
policies, and collisions, links, another owner's lock or write failure block safely.
The initializer does not install hooks, change CI pins, create Git history or
modify DB accounts. Hook/CI enforcement remains the separate activation below.

`yam template test-check` remains a manual starter with the same draft requirement.

`BASE` must be an exact existing commit ID. A base equal to the candidate with no
changes cannot authorize completion. Generated/private `.yam`, dist, build, coverage,
node_modules, host agent configs and tarball/log files are excluded from source
snapshots; runtime dependency/configuration identities belong in environment evidence.
Source symlinks/submodules are unsupported and block, rather than silently omitted.

For a configured project, the existing opt-in `study-note` prompt/Stop hook also
runs Test check validation. Enable through `yam hook enable study-note --project .`
(or use an existing global study-note hook). Prompt captures changed-turn scope;
Stop checks the receipt only, never launches long tests. Unlike the report-format
one-correction rule, Test check remains blocked on repeated Stop calls. A response
containing the marker `Test check: BLOCKED` on its own status line may finish as an incomplete-status
handoff. This marker grants no machine gate approval. No-change/read-only turns
skip the completion check. Without a configured policy/hook the route instruction
is guidance, not host enforcement; missing host discovery must be reported.

Before commit use `check --stage commit`: the index must match the tested working
snapshot. Before push use `check --stage push --source "$SOURCE"` for every outgoing
commit; SOURCE must be an exact commit ID and match the tested snapshot. `check --base <expected starting commit>` rejects a receipt from a different baseline;
Security check supplies the actual CI base automatically. Stage ci
or deploy additionally requires an administrator-reviewed `--policy-digest`.
Missing CI/deploy pins are rejected before any project test command executes.
`run` supports the same stage/source requirements. Deploy additionally requires
`--artifact <repository-local-file> --configuration <repository-local-file>`
and a deployment-stage receipt. Both files are measured before/after the tests
and remeasured on check; completion-only evidence cannot approve deployment.
Adapters receive YAM_TEST_ARTIFACT / YAM_TEST_CONFIGURATION and must test those
exact inputs rather than create a substitute package. Run stage checks before operations,
not concurrently with index/source changes. Existing Security check invokes this
validation automatically when a default project policy exists; CI/deploy callers
must supply `yam security check --test-policy-digest "$PIN"`. Existing custom project
runners must generate the Test check receipt first. Do not overwrite other hooks.

Pins bind reviewed bytes; they do not independently approve policy authorship.
Policy/scenario removal and changed test adapters require renewed engineering review
and CI-protected policy approval. CI must independently run the reviewed tests;
local hooks/Stop hooks can be bypassed or disabled. This feature does not configure
GitHub protection or change installed global skills/hooks by package installation.

## Adapter protocol

A command emits one JSON document on stdout (logs can go to stderr). Each selected
check must appear exactly once. Reports are data and are never executed.

```json
{
  "schema": "yam.test-observation.v1",
  "tests": [{
    "id": "save-success",
    "target": "function:public.receiving",
    "scenario": "success",
    "evidence": "integration",
    "status": "passed",
    "tests": 1,
    "assertions": 4,
    "failed": 0,
    "skipped": 0,
    "mocked": false,
    "environment": {}
  }]
}
```

The empty environment above is illustrative and cannot pass DB validation. DB
checks require `environment` to point to a repository-local expected manifest,
preferably ignored `.yam/testing/environment.json`, containing:

- schema `yam.test-environment.v1`, engine and exact engine_version;
- source_digest from `yam test-check plan`;
- configuration_digest, roles_digest and fixtures_digest (`sha256:...`);
- migrations: the complete sorted candidate `migrations/` inventory, each with
  file and SHA256. Existing baseline migrations must also be included.

The adapter queries the *actual* isolated environment and returns the same structured
fields only after comparing applied migration order/content, runtime/roles/settings
and synthetic fixture identity. Returning the expected file without measuring the
DB is not valid evidence. yam compares reports and candidate manifests; adapter
assertions and environment truth are still trusted project code, not independently
attested by the generic runner. Misreported `mocked:false` cannot be detected by a
JSON validator. Review and protect the adapters as rigorously as the application.

Use actual DB operations with synthetic records and representative roles. Success
means saved headers/items and separate readback match, not just HTTP 200. Verify
failure rollback, duplicate/retry behavior, revoked access and relevant triggers.
Do not use owner/service credentials to stand in for ordinary-user authorization.
Test in disposable environments. Transaction rollback does not undo email, external
files, webhooks or all sequence effects; verify external isolation and cleanup.

## Records, safety and limits

Each run appends an explained `-- Test check --` block to private
`.yam/testing/notes.md`, writes an immutable JSON under `runs/` and updates
`latest.json`. Note/receipt write failure blocks; concurrent persistence uses an
exclusive lock, rejects links/hardlinks and never removes someone else's lock.
Raw stdout/stderr, command arguments and environment values are not persisted;
only allowlisted facts and hashes are recorded. Do not put secrets in explanations
or command arguments. Use the project's existing least-privilege test environment.

A checksum is not a signature against a hostile same-user process. Timeout marks a
command failed; descendant-process cleanup is not attested by spawnSync. Native
JUnit/Playwright/Postgres result parsers, property/stateful/combination testing and
mutation testing are project adapters or future extensions, not built-in scanners.
The regression suite uses real Git/process/filesystem fixtures and simulated DB
observations; it does not claim to have tested any production RO database.

Implementation boundaries: existing verification-closure remains an immutable
operator-declared command receipt. Test check adds actual process execution and
scenario checks without promoting those older receipts into runtime proof.

## Hosted rollout

The yam repository workflow runs Test check before Security check and uploads its
sanitized notes/runs. Activation after review requires `YAM_TEST_POLICY_SHA256`
alongside the existing reviewed source/security-policy pins. This change does not
set repository variables, update global hooks, commit, push or publish. An absent
or outdated pin intentionally blocks hosted approval rather than silently using
candidate-computed trust. Local project source-review manifests must be refreshed
only after the executable changes have been reviewed.

## Optional real PostgreSQL simulation

From a source checkout, `npm run test-check-postgres-smoke` requires Docker access and an existing local
`postgres:17-alpine` image (override with YAM_TEST_PG_IMAGE). It never pulls an
image, publishes a port, mounts host data, or connects to a production database.
The disposable database reproduces SQLSTATE 42702 after successful function DDL,
then verifies fixed normal save/readback, access denial/revocation, invalid input,
rollback, retry, fresh/upgrade migrations, out-of-band function drift, and a
16-case role/brand/quantity matrix. The
adapter queries actual server/function/ACL/migration state rather than echoing an
expected manifest. Cleanup must confirm the owned container is absent.
This is real PostgreSQL with synthetic application data, not verification of any
production application's SQL or authorization rules. It stays opt-in, outside
ordinary verification so a missing Docker daemon never silently becomes a mock.

Invalid stage/base values are rejected before persistence. Malformed run options
leave a sanitized failed note. Git discovery failure does not disable a previously
configured Stop gate; quoted examples of the handoff marker cannot approve it.
