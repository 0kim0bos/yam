import assert from 'node:assert/strict';
import test from 'node:test';
import { campaignSource } from '../src/campaign-source.mjs';

test('returns the campaign source', () => {
  assert.equal(
    campaignSource('https://example.test/article?utm_source=newsletter'),
    'newsletter',
  );
});
