import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceSummary } from '../src/invoice-summary.mjs';

test('formats an invoice summary', () => {
  assert.equal(
    invoiceSummary({ id: 'INV-7', totalCents: 1234 }),
    'INV-7: $12.34',
  );
});
