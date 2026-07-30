import assert from 'node:assert/strict';
import test from 'node:test';
import { initials } from '../src/initials.mjs';

test('returns two initials', () => {
  assert.equal(initials('Ada Lovelace'), 'AL');
});
