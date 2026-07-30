import path from 'node:path';

export function safeUploadPath(baseDir, filename) {
  if (
    typeof baseDir !== 'string'
    || !baseDir
    || typeof filename !== 'string'
    || !filename
    || filename.includes('\0')
    || /[\\/]/.test(filename)
    || /^[A-Za-z]:/.test(filename)
    || path.basename(filename) !== filename
  ) {
    throw new Error('invalid upload filename');
  }
  const base = path.resolve(baseDir);
  const target = path.resolve(base, filename);
  if (path.dirname(target) !== base) throw new Error('upload path escapes base directory');
  return target;
}
