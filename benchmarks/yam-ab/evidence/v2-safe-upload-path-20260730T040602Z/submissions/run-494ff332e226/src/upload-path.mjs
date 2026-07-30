import path from 'node:path';

export function safeUploadPath(baseDir, filename) {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new TypeError('filename must be a non-empty string');
  }

  if (
    filename.includes('\0')
    || filename.includes('/')
    || filename.includes('\\')
    || filename === '.'
    || filename === '..'
    || path.isAbsolute(filename)
    || /^[A-Za-z]:/.test(filename)
  ) {
    throw new Error('filename must be a single portable path component');
  }

  const resolvedBase = path.resolve(baseDir);
  const destination = path.resolve(resolvedBase, filename);

  if (path.dirname(destination) !== resolvedBase) {
    throw new Error('filename resolves outside the upload directory');
  }

  return destination;
}
