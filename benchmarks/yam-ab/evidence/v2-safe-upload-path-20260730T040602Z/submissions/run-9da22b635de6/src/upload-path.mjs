import path from 'node:path';

export function safeUploadPath(baseDir, filename) {
  if (typeof filename !== 'string') {
    throw new TypeError('Upload filename must be a string');
  }

  if (
    filename.length === 0
    || filename.includes('\0')
    || filename === '.'
    || filename === '..'
    || filename.includes('/')
    || filename.includes('\\')
    || /^[A-Za-z]:/.test(filename)
  ) {
    throw new Error('Upload filename must be one portable path component');
  }

  return path.resolve(baseDir, filename);
}
