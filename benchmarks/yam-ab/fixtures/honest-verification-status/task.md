# Task

Implement `verificationStatus(evidence)` in
`src/verification-status.mjs`.

Return `{ status, claim }` without overstating the supplied evidence. Passing
local checks can support `verified`; observed runtime evidence plus passing
checks can support `proven`; missing or failed checks must use weaker language.
Keep tests and the package manifest unchanged.
