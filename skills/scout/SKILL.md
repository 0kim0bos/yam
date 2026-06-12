---
name: scout
description: Broad investigation and judgment route. Use when the user invokes $scout or asks to find options, references, docs, tools, product direction, security implications, or third-party perspective before implementation.
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
- Broad reference scans when the user needs wider perspective.
- Security-centered direction checks before implementation.
- Finding patterns worth reworking into yam style.

## Principles

- Scout broadly enough to see the field, then compress the judgment.
- Token economy is part of quality.
- Reuse `yam.project.md` before broad context reading when present.
- Prefer official and primary sources.
- Keep source boundaries clear: cite what was read, separate fact from inference, and do not blur reference material into yam claims.
- Use current docs proof only when SDK/API/cloud-service freshness matters.
- Keep the decision clear, but do not make the field of view artificially narrow when the user asks for a broad scan.
- Do not change code unless the user asks.
- Return a practical recommendation.
- Separate fact, inference, opinion, and recommendation.
- Treat "objective" as evidence plus constraints, not certainty theater.
- Treat "subjective" as named taste, product instinct, and likely user perception.
- Security is the first lens: call out auth, payment, DB, secrets, permission, deployment, supply-chain, and public-release risks early.
- Source count should match the decision: 3-7 high-signal sources for focused scouting, more when the user explicitly asks for wide research.
- Use `$deep` when the user asks for heavy verification or when false confidence would be costly.

## Workflow

1. Clarify the decision being scouted.
2. Choose the lane:
   - quick lookup
   - option comparison
   - design/reference scan
   - product/technical direction memo
   - risk discovery
3. Read `yam.project.md` first when project direction matters.
4. Gather enough high-signal sources to support the decision; keep source quality higher than source volume.
5. Compare options by fit, risk, cost, implementation effort, and durability.
6. Identify security and trust implications before convenience or aesthetics.
7. Give both objective and subjective judgment when useful.
8. Recommend a direction and which ideas are worth reworking into yam style.
9. State uncertainty and what would change the recommendation.

## Output

Use concise sections:

- Best pick.
- Objective judgment.
- Subjective judgment.
- Macro / realistic / future view when the decision benefits from it.
- Alternatives.
- Risks.
- Security lens.
- Ideas to rework into yam style.
- Sources or local evidence.
- Remaining tasks or useful next improvements.

Use `references/token-economy.md`; default to 3-7 high-signal sources unless the user asks for a broad research scan.
Use `references/current-docs.md` for current SDK/API/cloud-service questions.
Use `references/context-reuse.md`; do not rescout known decisions unless they may be stale.
Use `references/markdown-management.md` before creating or updating project packs.
Use `references/final-report.md` to close with remaining tasks and fix-first items when useful.
Use `references/token-budget-reporter.md` when a run needs measured budget feedback.

## Final Response

Mention the recommended direction, key tradeoffs, remaining tasks, and fix-first items before planned tasks when useful.
