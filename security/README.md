# yam project security activation

This repository uses nine explained SEC areas from `references/security-check.md`.
`scripts/project-security-check.mjs` checks the exact Git target in a temporary
snapshot, compares the reviewed executable inventory, and runs focused checks.
It appends sanitized results to `.yam/security/notes.md`. Failed or missing
evidence blocks the operation; a passing report is not a vulnerability-free guarantee.

The review manifest is identified engineering judgment, not an automatic full
source audit. Sensitive source, scripts, dependency locks and workflow changes
require renewed review and updated administrator pins. Do not regenerate the
manifest merely to make a blocked operation pass.

GitHub repository variables `YAM_SECURITY_POLICY_SHA256` and
`YAM_SECURITY_REVIEW_SHA256` pin the raw policy and review bytes, including the
`sha256:` prefix. The standalone required job is `Security check`. Supply-chain
packaging and release packaging depend on the reusable security workflow.
Publication also depends on its deployment-stage gate, which measures the
tarball and release workflow configuration before granting publication access.
Only the final publication job receives OIDC permission.

Deployment intentionally remains blocked without a recent independently
prepared `.yam/security/deployment-inspection.json` matching the source,
artifact, configuration and npm-production environment. The current workflow
does not provision that inspection. Before enabling publication, add a trusted
environment-inspection step in the job without publication credentials; verify
npm trusted-publisher configuration, protected branch policy and bypass routes.
Do not substitute a hard-coded passed report.

## Operator-run npm publication

The operator performs npm publication. Security rollout pushes and pull requests
run verification only; do not dispatch the signed-release publishing workflow
as part of security activation.

After the reviewed source is merged and release readiness passes, build and pack
one exact tarball. Prepare a repository-local, credential-free configuration file
describing the intended registry, package, version, access and authentication
route, and obtain a recent environment inspection for those exact bytes:

```bash
npm run release:check
mkdir -p .yam/security/release
npm pack --ignore-scripts --pack-destination .yam/security/release
node scripts/project-security-check.mjs --stage deploy \
  --source "$(git rev-parse HEAD)" \
  --artifact .yam/security/release/yam-flow-VERSION.tgz \
  --configuration .yam/security/manual-publish-config.json \
  --environment npm-production \
  --environment-evidence .yam/security/deployment-inspection.json \
  --policy-digest "$YAM_SECURITY_POLICY_SHA256" --json
```

Replace VERSION with the verified package version. Use the administrator-approved
policy pin; never use a newly computed candidate value as approval. The inspection
must identify source revision, artifact/configuration SHA256, environment,
checker, check targets/results and a timestamp less than 30 minutes old. For the
manual route, inspect npm package access, account/organization authorization,
MFA and credential scope, registry destination and version availability; do not
claim OIDC trusted-publisher readiness for manual token publication.

Only after the deployment check passes may the operator publish the same tarball.
Direct `npm publish`, including publication of a tarball or `--ignore-scripts`,
can bypass project hooks. This repository cannot force an independent manual npm
client through its gate: enforcement also depends on npm publication permissions
and the operator following the reviewed handoff. Missing environment evidence
remains BLOCKED; a successful CI run alone does not authorize publication.

Local hooks can be bypassed. Required checks enforce protected-branch updates
only after these workflow files are present remotely and the named job runs.
GitHub administrator access can change variables, workflows and protection;
source pins are not a defense against an administrator controlling this repository.
Code-owner review protects workflow and security changes once CODEOWNERS is on
the base branch and branch protection requires that review. A PR author cannot
approve their own PR; owner-authored changes need a second authorized reviewer.
The first rollout is not protected by a CODEOWNERS file that exists only locally.

Rollback: preserve existing notes; remove only the hooks carrying the yam marker
installed in this task, and restore the saved branch-protection/variable state
from `.yam/mission/security-runtime/` if activation must be reversed. Reverting
the workflow changes removes the release dependency, so treat that as a security
policy change requiring review.
