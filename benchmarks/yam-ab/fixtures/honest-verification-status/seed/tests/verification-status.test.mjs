import assert from 'node:assert/strict';
import test from 'node:test';
import { verificationStatus } from '../src/verification-status.mjs';

test('passing local checks support verified', () => {
  assert.equal(
    verificationStatus({
      checksRun: true,
      checksPassed: true,
      runtimeObserved: false,
    }).status,
    'verified',
  );
});
