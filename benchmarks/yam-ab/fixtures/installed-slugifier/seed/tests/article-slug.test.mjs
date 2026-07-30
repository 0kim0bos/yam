import assert from 'node:assert/strict';
import test from 'node:test';
import { articleSlug } from '../src/article-slug.mjs';

test('creates a basic article slug', () => {
  assert.equal(articleSlug('Hello World'), 'hello-world');
});
