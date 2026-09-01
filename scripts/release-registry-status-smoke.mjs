#!/usr/bin/env node
import assert from 'node:assert/strict';
import { releaseRegistryStatusFromChecks } from '../dist/lib/release-registry-status.js';

const expected = { package_name: 'yam-flow', version: '2.8.0' };
const unpublished = releaseRegistryStatusFromChecks([
  {
    id: 'registry_status',
    status: 'passed',
    note: 'registry:check: ok (yam-flow@2.8.0 is not published)'
  }
], expected);
assert.equal(unpublished.checked, true, 'exact-version E404 output must be recognized');
assert.equal(unpublished.not_published, true, 'exact-version E404 output must classify the package version as unpublished');
assert.equal(unpublished.latest_version, '', 'an exact-version E404 does not prove the registry latest version');
assert.equal(unpublished.queried_package, 'yam-flow');
assert.equal(unpublished.queried_version, '2.8.0');

const scoped = releaseRegistryStatusFromChecks([
  {
    id: 'registry_status',
    status: 'passed',
    note: 'registry:check: ok (@scope/yam-flow@2.8.0 is not published)'
  }
], { package_name: '@scope/yam-flow', version: '2.8.0' });
assert.equal(scoped.checked, true, 'scoped package identities must use the final @ as the version boundary');

for (const note of [
  'registry:check: ok (yam-flow@2.7.0 is not published)',
  'registry:check: ok (another-package@2.8.0 is not published)',
  'registry:check: ok (latest 2.7.0, 2.8.0 is not published yet)',
  'registry:check: ok'
]) {
  const result = releaseRegistryStatusFromChecks([
    { id: 'registry_status', status: 'passed', note }
  ], expected);
  assert.equal(result.checked, false, `mismatched or stale output must not prove release status: ${note}`);
  assert.equal(result.parse_failed, true, `mismatched or stale passed output must fail closed: ${note}`);
}

const failed = releaseRegistryStatusFromChecks([
  { id: 'registry_status', status: 'failed', note: 'registry probe failed with E401' }
], expected);
assert.equal(failed.checked, false);
assert.equal(failed.parse_failed, false, 'a failed check is already blocked and should not be mislabeled as a parser failure');

console.log('release-registry-status-smoke: ok');
