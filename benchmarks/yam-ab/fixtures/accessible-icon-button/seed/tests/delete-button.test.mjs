import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDeleteButton } from '../src/delete-button.mjs';

test('renders a button with a trash icon', () => {
  const html = renderDeleteButton();
  assert.match(html, /<button\b/);
  assert.match(html, /<svg\b/);
});
