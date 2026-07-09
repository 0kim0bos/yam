# Scout

`scout` is broad practical investigation and judgment. It gives the user wider sight before implementation, then compresses the result into a decision.

Use for:

- Current docs.
- Library or tool comparison.
- Design references.
- Product direction options.
- Risk discovery before implementation.
- Third-party judgment before implementation.
- Objective and subjective evaluation together.
- Macro, realistic, and future-facing direction checks.
- Security-centered direction checks.
- Reference scans that find useful patterns to rework into yam style.
- Wide scans across tools, agent systems, protocols, harnesses, markets, or third-party ecosystems.

Default behavior:

- Define the decision clearly.
- Prefer official or primary sources.
- Gather 3-7 high-signal references for focused scouting, or more when the user asks for a wide scan.
- For wide scans, build a source map before deep reading: official/primary, implementation evidence, third-party analysis, community evidence, contrarian sources, and local evidence.
- Use current docs proof only for modern SDK/API/cloud-service behavior where stale knowledge is plausible.
- Use blocked-source fallback only when a high-signal source is blocked or platform-protected; treat `insane-search` as source acquisition, not as the default search path.
- Summarize options and recommendation.
- Separate fact, inference, opinion, and recommendation.
- Use a compact evidence ledger for broad recommendations.
- Run an opposition pass when false confidence would make the recommendation brittle.
- Keep source boundaries clear: cite what was read and do not present reference-derived judgment as direct verification.
- Put security before convenience: auth, payment, DB, secrets, permissions, deployment, supply chain, and public release get called out early.
- Do not change code unless the user asks.

Judgment format:

- Objective judgment: evidence, constraints, cost, feasibility, and known reality.
- Subjective judgment: taste, product instinct, design sensibility, and likely user perception.
- Macro view: category direction and broad movement.
- Realistic view: what can be done soon with the current project and skill level.
- Future view: second-order effects, durability, and what may age well or badly.
- Security view: sensitive surfaces, safer defaults, failure modes, and what a non-specialist might miss.
- Rework view: what ideas should be adapted into yam style and what should be rejected.
- Evidence view: important claim, source class, confidence, uncertainty, and decision impact.
- Opposition view: the strongest reason the preferred direction could be wrong.

Escalate:

- Use `question` for direct answers that do not need sources.
- Use `deep` only when the user asks for heavy verification.
- Use implementation routes only after the user asks to change code.

For broad scan mechanics, use `references/scout-wide-scan.md`.
