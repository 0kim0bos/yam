# Scout

`scout` is practical investigation and judgment, not academic research.

Use for:

- Current docs.
- Library or tool comparison.
- Design references.
- Product direction options.
- Risk discovery before implementation.
- Third-party judgment before implementation.
- Objective and subjective evaluation together.
- Macro, realistic, and future-facing direction checks.

Default behavior:

- Define the question narrowly.
- Prefer official or primary sources.
- Gather 3-7 high-signal references by default.
- Use current docs proof only for modern SDK/API/cloud-service behavior where stale knowledge is plausible.
- Summarize options and recommendation.
- Separate fact, inference, opinion, and recommendation.
- Do not change code unless the user asks.

Judgment format:

- Objective judgment: evidence, constraints, cost, feasibility, and known reality.
- Subjective judgment: taste, product instinct, design sensibility, and likely user perception.
- Macro view: category direction and broad movement.
- Realistic view: what can be done soon with the current project and skill level.
- Future view: second-order effects, durability, and what may age well or badly.

Escalate:

- Use `question` for direct answers that do not need sources.
- Use `deep` only when the user asks for heavy verification.
- Use implementation routes only after the user asks to change code.
