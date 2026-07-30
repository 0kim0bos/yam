import path from 'node:path';

export function safeUploadPath(baseDir, filename) {
  if (typeof filename !== 'string') {
    throw new TypeError('filename must be a string');
  }

  if (
    filename.length === 0
    || filename.includes('\0')
    || filename.includes('/')
    || filename.includes('\\')
    || filename === '.'
    || filename === '..'
    || /^[A-Za-z]:/.test(filename)
    || path.posix.isAbsolute(filename)
    || path.win32.isAbsolute(filename)
  ) {
    throw new Error('filename must be one portable filename component');
  }

  const resolvedBase = path.resolve(baseDir);
  const destination = path.resolve(resolvedBase, filename);
  const relative = path.relative(resolvedBase, destination);

  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('filename resolves outside the upload directory');
  }

  return destination;
}
