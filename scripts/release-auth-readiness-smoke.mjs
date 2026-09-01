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

function workflowJobLines(workflowText, jobId) {
  const lines = workflowText.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^  ${jobId}:\\s*(?:#.*)?$`).test(line));
  assert(start >= 0, `release workflow must define the ${jobId} job`);
  const relativeEnd = lines.slice(start + 1).findIndex((line) => /^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(line));
  return lines.slice(start, relativeEnd < 0 ? lines.length : start + 1 + relativeEnd);
}

function activeStepCommands(jobLines) {
  const stepsStart = jobLines.findIndex((line) => /^    steps:\s*(?:#.*)?$/.test(line));
  assert(stepsStart >= 0, 'release lifecycle must define steps');
  const stepLines = jobLines.slice(stepsStart + 1);
  const steps = [];
  let current = [];
  for (const line of stepLines) {
    if (/^      -\s+/.test(line)) {
      if (current.length) steps.push(current);
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) steps.push(current);

  return steps.flatMap((step) => {
    const runIndex = step.findIndex((line) => /^(?:      -\s+|        )run:\s*/.test(line));
    if (runIndex < 0) return [];
    const runMatch = step[runIndex].match(/^(?:      -\s+|        )run:\s*(.*)$/);
    const value = runMatch?.[1]?.trim() || '';
    const command = /^[>|]-?$/.test(value)
      ? step.slice(runIndex + 1)
        .filter((line) => /^          \S/.test(line) && !/^\s*#/.test(line))
        .map((line) => line.trim())
        .join(' ')
      : value;
    return command ? [{
      command,
      conditional: step.some((line) => /^(?:      -\s+|        )if:\s*/.test(line)),
      non_blocking: step.some((line) => /^(?:      -\s+|        )continue-on-error:\s*/.test(line))
    }] : [];
  });
}

function yamlListValues(lines, keyPattern, itemPattern) {
  const start = lines.findIndex((line) => keyPattern.test(line));
  assert(start >= 0, `release workflow must define ${keyPattern.source}`);
  const values = [];
  for (const line of lines.slice(start + 1)) {
    const match = line.match(itemPattern);
    if (match) {
      values.push(match[1]);
      continue;
    }
    if (line.trim() && !/^\s*#/.test(line) && /^\s{0,8}\S/.test(line)) break;
  }
  return values;
}

function assertReleaseLifecycleGate(workflowText) {
  const lifecycleLines = workflowJobLines(workflowText, 'lifecycle');
  const steps = activeStepCommands(lifecycleLines);
  const expectedPackedLifecycle = 'node scripts/packed-lifecycle-smoke.mjs --artifact-dir package-artifact --receipt package-artifact/receipt.json --expected-sha256 "${{ needs.package.outputs.sha256 }}"';
  const dependencyInstall = steps.findIndex((step) => step.command === 'npm ci --ignore-scripts');
  const transactionSmoke = steps.findIndex((step) => step.command === 'npm run install-transaction-smoke');
  const packedLifecycle = steps.findIndex((step) => step.command === expectedPackedLifecycle);
  assert(dependencyInstall >= 0, 'release lifecycle must install exact dependencies');
  assert(transactionSmoke >= 0, 'release lifecycle must execute transaction safety smoke');
  assert(packedLifecycle >= 0, 'release lifecycle must execute the exact artifact digest and packed lifecycle check');
  assert(
    dependencyInstall < transactionSmoke && transactionSmoke < packedLifecycle,
    'release lifecycle must run dependency installation and transaction safety before the packed lifecycle'
  );
  for (const index of [dependencyInstall, transactionSmoke, packedLifecycle]) {
    assert(!steps[index].conditional, 'required release lifecycle steps must be unconditional');
    assert(!steps[index].non_blocking, 'required release lifecycle steps must block on failure');
  }
  assert(
    !lifecycleLines.some((line) => /^    continue-on-error:\s*/.test(line)),
    'release lifecycle job must block publish on failure'
  );
  assert(
    !lifecycleLines.some((line) => /^        exclude:\s*/.test(line)),
    'release lifecycle matrix must not exclude required operating systems'
  );
  assert(
    lifecycleLines.some((line) => /^    needs:\s*package\s*(?:#.*)?$/.test(line)),
    'release lifecycle must depend on the package job'
  );
  assert(
    lifecycleLines.filter((line) => /^    runs-on:\s*/.test(line)).length === 1
      && lifecycleLines.some((line) => /^    runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}\s*(?:#.*)?$/.test(line)),
    'release lifecycle must run on every matrix operating system'
  );

  const matrixOs = yamlListValues(lifecycleLines, /^        os:\s*(?:#.*)?$/, /^          -\s+([^#\s]+)\s*(?:#.*)?$/);
  for (const os of ['ubuntu-latest', 'macos-latest', 'windows-latest']) {
    assert(
      matrixOs.includes(os),
      `release lifecycle matrix must include ${os}`
    );
  }

  const publishLines = workflowJobLines(workflowText, 'publish');
  const publishNeeds = yamlListValues(publishLines, /^    needs:\s*(?:#.*)?$/, /^      -\s+([^#\s]+)\s*(?:#.*)?$/);
  assert(
    publishLines.filter((line) => /^    runs-on:\s*/.test(line)).length === 1
      && publishLines.some((line) => /^    runs-on:\s*ubuntu-latest\s*(?:#.*)?$/.test(line)),
    'release publish job must use the reviewed GitHub-hosted runner'
  );
  const permissionsStart = publishLines.findIndex((line) => /^    permissions:\s*(?:#.*)?$/.test(line));
  assert(permissionsStart >= 0, 'release publish job must define job-local permissions');
  const permissionsEnd = publishLines.slice(permissionsStart + 1)
    .findIndex((line) => line.trim() && !/^\s*#/.test(line) && /^\s{0,4}\S/.test(line));
  const permissionLines = publishLines.slice(
    permissionsStart + 1,
    permissionsEnd < 0 ? publishLines.length : permissionsStart + 1 + permissionsEnd
  );
  assert(
    permissionLines.filter((line) => /^      id-token:\s*/.test(line)).length === 1
      && permissionLines.some((line) => /^      id-token:\s*write\s*(?:#.*)?$/.test(line)),
    'release publish job must grant job-local id-token write permission'
  );
  assert(
    !publishLines.some((line) => /^    if:\s*/.test(line)),
    'release publish job must not override lifecycle dependency failure'
  );
  assert(
    publishNeeds.includes('package') && publishNeeds.includes('lifecycle'),
    'release publish job must depend on package and the lifecycle matrix'
  );
  assert(
    !publishLines.some((line) => /^    continue-on-error:\s*/.test(line)),
    'release publish job must report publish failures'
  );
  const publishSteps = activeStepCommands(publishLines);
  const expectedPublish = 'npm publish "package-artifact/yam-flow-${{ needs.package.outputs.version }}.tgz" --access public --provenance --ignore-scripts --registry https://registry.npmjs.org/';
  const publishStep = publishSteps.find((step) => step.command === expectedPublish);
  assert(publishStep, 'release publish job must publish the exact tested tarball with provenance');
  assert(!publishStep.conditional, 'release publish step must be unconditional after successful dependencies');
  assert(!publishStep.non_blocking, 'release publish step must report failure');
}

const actualWorkflowText = readFileSync('.github/workflows/release.yml', 'utf8');
const actualWorkflow = inspectTrustedPublisherWorkflowText(
  actualWorkflowText,
  '.github/workflows/release.yml',
  true
);
assert.equal(actualWorkflow.configured, true, `actual release workflow missing: ${actualWorkflow.missing_checks.join(', ')}`);
assertReleaseLifecycleGate(actualWorkflowText);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '        run: npm run install-transaction-smoke',
    '        # run: npm run install-transaction-smoke'
  )),
  /execute transaction safety smoke/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '        run: npm run install-transaction-smoke',
    '        if: false\n        run: npm run install-transaction-smoke'
  )),
  /must be unconditional/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '      - name: Verify transactional cleanup safety\n        run:',
    '      - if: false\n        name: Verify transactional cleanup safety\n        run:'
  )),
  /must be unconditional/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '        run: npm run install-transaction-smoke',
    "        if: runner.os != 'Windows'\n        run: npm run install-transaction-smoke"
  )),
  /must be unconditional/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '        run: npm run install-transaction-smoke',
    '        continue-on-error: true\n        run: npm run install-transaction-smoke'
  )),
  /must block on failure/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '      - name: Verify transactional cleanup safety\n        run:',
    '      - continue-on-error: true\n        name: Verify transactional cleanup safety\n        run:'
  )),
  /must block on failure/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '          --artifact-dir package-artifact\n          --receipt package-artifact/receipt.json\n          --expected-sha256 "${{ needs.package.outputs.sha256 }}"',
    '          --self-test'
  )),
  /exact artifact digest and packed lifecycle check/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '        run: npm ci --ignore-scripts',
    '        run: __transaction_placeholder__'
  ).replace(
    '        run: npm run install-transaction-smoke',
    '        run: npm ci --ignore-scripts'
  ).replace(
    '        run: __transaction_placeholder__',
    '        run: npm run install-transaction-smoke'
  )),
  /transaction safety before/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '          - windows-latest',
    '          # - windows-latest'
  )),
  /must include windows-latest/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '    runs-on: ${{ matrix.os }}',
    '        exclude:\n          - os: windows-latest\n    runs-on: ${{ matrix.os }}'
  )),
  /must not exclude required operating systems/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '    runs-on: ${{ matrix.os }}',
    '    runs-on: ubuntu-latest'
  )),
  /must run on every matrix operating system/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '    needs: package',
    '    # needs: package'
  )),
  /must depend on the package job/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '  lifecycle:\n    name:',
    '  lifecycle:\n    continue-on-error: true\n    name:'
  )),
  /lifecycle job must block publish on failure/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '      - lifecycle',
    '      # - lifecycle'
  )),
  /must depend on package and the lifecycle matrix/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '  publish:\n    name:',
    '  publish:\n    if: always()\n    name:'
  )),
  /must not override lifecycle dependency failure/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    permissions:',
    '    runs-on: self-hosted\n    timeout-minutes: 10\n    permissions:'
  )),
  /must use the reviewed GitHub-hosted runner/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '      id-token: write',
    '      id-token: read'
  )),
  /must grant job-local id-token write permission/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '  publish:\n    name:',
    '  publish:\n    continue-on-error: true\n    name:'
  )),
  /publish job must report publish failures/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '      - name: Publish the tested bytes with OIDC and provenance\n        run:',
    '      - name: Publish the tested bytes with OIDC and provenance\n        continue-on-error: true\n        run:'
  )),
  /publish step must report failure/
);
assert.throws(
  () => assertReleaseLifecycleGate(actualWorkflowText.replace(
    '          --provenance\n',
    '          --dry-run\n'
  )),
  /publish the exact tested tarball with provenance/
);

console.log('release-auth-readiness-smoke: ok (OIDC boundary, manual fallback, and cross-platform transaction publish gate preserved)');
