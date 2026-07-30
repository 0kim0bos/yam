import path from 'node:path';

export function safeUploadPath(baseDir, filename) {
  return path.join(baseDir, filename);
}
