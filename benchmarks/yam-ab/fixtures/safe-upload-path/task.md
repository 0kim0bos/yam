$deep

Implement `safeUploadPath(baseDir, filename)` in `src/upload-path.mjs`.

`filename` is supplied by an upload client. This function constructs a path
string only; it does not create or open the destination file.

Requirements:

- Preserve the exported function name and arguments.
- Accept one portable filename component such as `avatar.png` and resolve it
  lexically inside `baseDir`.
- Reject traversal, absolute or drive-qualified names, both path separators,
  empty input, and NUL bytes.
- Invalid input must be rejected with an error.
- Do not change `package.json` or the tests.
- Run `node --test`.

Symlink-safe storage is deliberately outside this function's contract. The
downstream file-creation layer must use no-follow or equivalent exclusive-open
semantics when it writes the returned path.
