# Task

Email values created through `createUser` are not canonicalized consistently.
Find and fix the narrowest shared cause so all current callers receive trimmed,
lowercase email addresses. Do not modify callers, tests, or the package
manifest.
