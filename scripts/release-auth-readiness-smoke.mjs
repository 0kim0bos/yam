#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildReleaseAuthReadiness,
  inspectTrustedPublisherWorkflowText
} from '../dist/lib/release-auth-readiness.js';

const completeWorkflow = `
on:
  workflow_dispatch:
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    steps:
      - run: npm publish package.tgz --provenance --registry https://registry.npmjs.org/
`;

const oidc = buildReleaseAuthReadiness({
  workflow: inspectTrustedPublisherWorkflowText(completeWorkflow),
  local_token: { command: 'npm whoami', ok: false, note: 'npm error code E401' },
  requested_mode: 'auto'
});
assert.equal(oidc.mode, 'trusted_publisher_oidc');
assert.equal(oidc.status, 'workflow_configured_account_unverified');
assert.equal(oidc.local_token.required_for_selected_mode, false);
assert.equal(oidc.local_token.status, 'not_authenticated');
assert.equal(oidc.blockers[0]?.kind, 'trusted_publisher_account_unverified');
assert.doesNotMatch(oidc.next_action, /npm whoami|npm login|token/i);

const incomplete = buildReleaseAuthReadiness({
  workflow: inspectTrustedPublisherWorkflowText(completeWorkflow.replace('id-token: write', 'contents: read')),
  local_token: { command: 'npm whoami', ok: true, note: '' },
  requested_mode: 'oidc'
});
assert.equal(incomplete.mode, 'trusted_publisher_oidc');
assert.equal(incomplete.blockers[0]?.kind, 'oidc_workflow_incomplete');
assert(incomplete.trusted_publisher.missing_checks.includes('id_token_write'));

const commentsOnly = inspectTrustedPublisherWorkflowText(`
# workflow_dispatch:
# id-token: write
# runs-on: ubuntu-latest
# npm publish package.tgz --provenance --registry https://registry.npmjs.org/
`);
assert.equal(commentsOnly.configured, false);
assert(commentsOnly.missing_checks.includes('npm_publish'));

const manualBlocked = buildReleaseAuthReadiness({
  workflow: inspectTrustedPublisherWorkflowText('', '.github/workflows/release.yml', false),
  local_token: { command: 'npm whoami', ok: false, note: 'npm error code E401' },
  requested_mode: 'auto'
});
assert.equal(manualBlocked.mode, 'manual_token');
assert.equal(manualBlocked.local_token.required_for_selected_mode, true);
assert.equal(manualBlocked.blockers[0]?.kind, 'auth_not_verified');
assert.match(manualBlocked.next_action, /npm whoami/);

const manualReady = buildReleaseAuthReadiness({
  workflow: inspectTrustedPublisherWorkflowText('', '.github/workflows/release.yml', false),
  local_token: { command: 'npm whoami', ok: true, note: '' },
  requested_mode: 'token'
});
assert.equal(manualReady.truth_status, 'verified');
assert.equal(manualReady.blockers.length, 0);

const explicitManualWithWorkflow = buildReleaseAuthReadiness({
  workflow: inspectTrustedPublisherWorkflowText(completeWorkflow),
  local_token: { command: 'npm whoami', ok: false, note: 'npm error code E401' },
  requested_mode: 'token'
});
assert.equal(explicitManualWithWorkflow.mode, 'manual_token');
assert.equal(explicitManualWithWorkflow.local_token.required_for_selected_mode, true);
assert.equal(explicitManualWithWorkflow.blockers[0]?.kind, 'auth_not_verified');

const actualWorkflow = inspectTrustedPublisherWorkflowText(
  readFileSync('.github/workflows/release.yml', 'utf8'),
  '.github/workflows/release.yml',
  true
);
assert.equal(actualWorkflow.configured, true, `actual release workflow missing: ${actualWorkflow.missing_checks.join(', ')}`);

console.log('release-auth-readiness-smoke: ok (OIDC E401 ignored, account proof required, incomplete workflow blocked, manual token fallback preserved)');
