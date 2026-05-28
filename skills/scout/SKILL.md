---
name: scout
description: Lightweight investigation and judgment route. Use when the user invokes $scout or asks to find options, references, docs, tools, product direction, or third-party perspective before implementation.
---

# yam Scout

Use for:

- Tool/library comparison.
- Current documentation lookup.
- Design or product references.
- Technical direction checks.
- Risk discovery before implementation.
- Third-party judgment before committing to a direction.
- Objective and subjective evaluation together.
- Macro, realistic, and future-facing judgment.

## Principles

- Scout, do not sprawl.
- Token economy is part of quality.
- Reuse `yam.project.md` before broad context reading when present.
- Prefer official and primary sources.
- Use current docs proof only when SDK/API/cloud-service freshness matters.
- Keep the question narrow.
- Do not change code unless the user asks.
- Return a practical recommendation.
- Separate fact, inference, opinion, and recommendation.
- Treat "objective" as evidence plus constraints, not certainty theater.
- Treat "subjective" as named taste, product instinct, and likely user perception.
- Keep source count bounded by default; use `$deep` only when the user asks for heavy verification.

## Workflow

1. Clarify the decision being scouted.
2. Choose the lane:
   - quick lookup
   - option comparison
   - design/reference scan
   - product/technical direction memo
   - risk discovery
3. Read `yam.project.md` first when project direction matters.
4. Gather 3-7 high-signal sources by default.
5. Compare options by fit, risk, cost, implementation effort, and durability.
6. Give both objective and subjective judgment when useful.
7. Recommend a direction.
8. State uncertainty and what would change the recommendation.

## Output

Use concise sections:

- Best pick.
- Objective judgment.
- Subjective judgment.
- Macro / realistic / future view when the decision benefits from it.
- Alternatives.
- Risks.
- Sources or local evidence.

Use `references/token-economy.md`; default to 3-7 high-signal sources.
Use `references/current-docs.md` for current SDK/API/cloud-service questions.
Use `references/context-reuse.md`; do not rescout known decisions unless they may be stale.
Use `references/markdown-management.md` before creating or updating project packs.
Use `references/final-report.md` to close with remaining tasks and fix-first items when useful.
Use `references/token-budget-reporter.md` when a run needs measured budget feedback.

## Final Response

Mention the recommended direction, key tradeoffs, remaining tasks, and fix-first items before planned tasks when useful.
