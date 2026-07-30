import assert from 'node:assert/strict';
import test from 'node:test';
import { createUser } from '../src/create-user.mjs';

test('stores a canonical email', () => {
  assert.equal(createUser('  ADA@EXAMPLE.COM ').email, 'ada@example.com');
});
