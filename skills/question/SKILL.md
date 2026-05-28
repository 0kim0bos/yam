---
name: question
description: Very-light Q&A route. Use when the user invokes $question or asks a direct conceptual or practical question that can be answered without code changes or broad research.
---

# yam Question

Use for:
- Simple conceptual explanations.
- "What is X?" or "Can I do Y?" questions.
- Local harness/project usage questions.
- Clarifying a decision that does not need fresh source gathering.

Do not use for:
- Code changes. Use `$quick` or `$ueye`.
- Multi-option research or current market/tool comparisons. Use `$scout`.
- Risky verification or broad debugging. Use `$deep`.

Principles:
- Direction before execution.
- Answer the question first.
- Keep context tiny.
- Do not browse or inspect files unless freshness, local truth, or accuracy requires it.
- Separate fact, inference, and recommendation when the distinction matters.
- State uncertainty plainly.
- Token economy is part of quality.
- End with remaining tasks and fix-first items only when they are useful.

Workflow:
1. Identify the exact question.
2. Answer from stable knowledge or already-loaded context.
3. Check local files only when the answer depends on installed/configured state.
4. Browse only when the fact is current, niche, or likely to have changed.
5. If the answer becomes comparison/research, switch to `$scout`.

Output:
- Direct answer.
- Short explanation.
- Practical next step, if any.
- Uncertainty or verification note, if relevant.

Token budget:
Use `references/token-budget-reporter.md`.
Use `references/current-docs.md` only when the question depends on current SDK/API/cloud-service behavior; otherwise answer directly.
Default: 0-2 files, 0 commands, short final answer.
