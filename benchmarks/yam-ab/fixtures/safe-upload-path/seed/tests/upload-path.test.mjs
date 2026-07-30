import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { safeUploadPath } from '../src/upload-path.mjs';

test('places a normal filename inside the upload directory', () => {
  const baseDir = path.join(process.cwd(), 'uploads');
  assert.equal(
    safeUploadPath(baseDir, 'avatar.png'),
    path.join(baseDir, 'avatar.png'),
  );
});
