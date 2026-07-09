# Scout Wide Scan

Use this reference when `$scout` needs broad search, powerful outside patterns, ecosystem comparison, agent/harness discovery, or source-heavy direction setting.

## Activation

Use wide scan when the user asks for:

- Broad search or "find powerful patterns".
- Tool, library, agent, harness, protocol, or market landscape comparison.
- Third-party perspective before committing to a direction.
- Evidence from multiple source classes.
- Ideas worth reworking into yam style.

Do not use wide scan for:

- Stable direct answers.
- Small implementation tasks.
- Local code questions that a focused file read answers.
- Heavy verification; use `$deep`.
- Real subagent/team execution; use `$mission` unless the user explicitly asks for parallel agent work inside the current route and the environment supports it.

## Scan Lanes

1. Decision frame: name the decision, audience, constraints, and what would change the recommendation.
2. Source map: decide which source classes are needed before reading deeply.
3. Acquisition: gather enough sources; recover blocked high-signal sources only when needed.
4. Triage: rank sources by authority, freshness, relevance, bias, and directness.
5. Comparison: compare by fit, risk, cost, implementation effort, durability, and evidence quality.
6. Opposition pass: name the strongest argument against the preferred direction.
7. Synthesis: compress into a practical recommendation and yam-style rework ideas.
8. Evidence ledger: record the important claims, evidence, confidence, and uncertainty.

## Source Map

Prefer a small balanced map over a large pile:

- Official or primary source: docs, specs, vendor pages, source repos, standards.
- Implementation evidence: source code, examples, package metadata, changelogs, local files.
- Third-party analysis: credible writeups, benchmarks, incident reports, adoption notes.
- Community evidence: issues, forum posts, social reports, user complaints; useful but lower trust.
- Contrarian source: the best reason the attractive option may be wrong.
- Local evidence: project constraints, existing route boundaries, installed tools, package scripts.

Default focused scout remains 3-7 high-signal sources. Wide scan may use more, but stop once the decision is supported and marginal sources repeat what is already known.

## Acquisition Ladder

1. Use local project context packs and relevant local files first when the decision is project-specific.
2. Use official or primary docs for current SDK/API/cloud-service behavior.
3. Use ordinary web search or documentation search for accessible external sources.
4. Use platform-specific public APIs or feeds when they are cleaner than rendered pages.
5. Use blocked-source fallback only for high-signal sources that ordinary access cannot read.

Blocked-source fallback:

- Treat `insane-search` as a source acquisition subroutine.
- Use it for blocked/WAF/platform-protected sources such as X, Reddit, YouTube, Naver, LinkedIn, Medium, Substack, or similar pages when they matter to the decision.
- Preserve provenance: original URL, access path, trace or fallback note, and whether the content came from API, cache, feed, rendered HTML, or archive.
- Do not use it for ordinary searches that normal web search can handle.
- Do not treat authentication, paywall, private data, or rate-limit boundaries as something to force through.

## Evidence Ledger

Use a compact ledger for broad scans:

```text
Claim:
Evidence:
Source class:
Confidence: high / medium / low
Uncertainty:
Decision impact:
```

Keep the ledger short. Include only claims that materially shape the recommendation.

## Parallel Research

Scout stays single-agent by default.

Use real subagents or parallel agent lanes only when all are true:

- The user explicitly asked for subagents, delegation, or parallel agent work.
- The available environment provides real subagent tools.
- The questions are independent and self-contained.
- The results can be summarized without flooding the main context.

Good lanes:

- Official/docs lane.
- Implementation/source lane.
- Community/contrarian lane.
- Security/risk lane.

Bad lanes:

- Multiple agents reading the same sources.
- Delegating the immediate blocking question.
- Role-playing subagents when no real subagent tool is available.
- Turning a normal scout into `$mission`.

## Opposition Pass

Before the recommendation, ask:

- What would make the best pick fail in this project?
- Which source is least trustworthy or most stale?
- What is the strongest cheaper/simpler alternative?
- What security or operational risk is easy to miss?
- What would we need to verify before implementation?

Report the opposition pass briefly. It should sharpen the recommendation, not bury it.

## Output

Use the normal Scout shape, adding only the sections that help:

- Best pick.
- Objective judgment.
- Subjective judgment.
- Macro / realistic / future view.
- Alternatives.
- Risks.
- Security lens.
- Opposition pass.
- Evidence ledger.
- Ideas to rework into yam style.
- Sources or local evidence.
- Remaining tasks.

## Source Clarity

When outside systems shape the answer, preserve boundaries:

- Fact: what the source says or what local files show.
- Inference: what follows from comparing sources.
- Opinion: taste, product instinct, or likely user perception.
- Recommendation: the action Scout would take.

Useful outside patterns to rework, not copy wholesale:

- Agent Skills: progressive disclosure through `SKILL.md` plus optional references/scripts/assets.
- Deep Research: multi-step search, backtracking, citations, and synthesis.
- Coding-agent subagents: isolated read-only research lanes for context-heavy side tasks.
- Agents SDK-style guardrails and tracing: lightweight checks and evidence records around runs.
- Deep Agents-style harnesses: planning, context offloading, subagents, memory, and human checkpoints.
- MCP/ACP-style protocols: standard tool/resource discovery and agent-client boundaries.

Keep yam's bias: start with momentum, deepen deliberately, stay security-first, and avoid always-on orchestration.
