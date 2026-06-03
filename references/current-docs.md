# Current Docs Rule

Use current docs proof only when stale knowledge is a realistic risk.

## Require Current Docs Proof

Use official docs or primary sources when the task depends on current behavior for:

- modern SDK/API syntax
- cloud services, model APIs, payment providers, or auth providers
- framework version behavior, migration, deprecation, or breaking changes
- CLI flags, deployment behavior, pricing/limits, security rules, or platform integrations
- user wording such as latest, current, recently changed, new version, official docs, migration, or upgrade

## Usually Skip

Do not force current-docs proof for:

- stable programming concepts
- local codebase pattern matching
- small copy/CSS/UI polish
- questions answered by the project pack or local source
- implementation that follows already-installed project conventions without external API uncertainty

## Output Line

Use one concise line:

```text
Current-docs proof: official docs checked for <SDK/service>; result applied to <decision>.
```

Or:

```text
Current-docs proof: skipped because this was stable/local/non-SDK work.
```

## Design Baseline

Strict proof favors source-backed evidence for current tool behavior.

Modular skill workflows keep research/context selective and low-context.

Minimal-core design says the rule is useful only when it changes the answer.
