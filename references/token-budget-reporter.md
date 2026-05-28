# Token Budget Reporter

`yam` tracks token pressure without hooks or automatic surveillance.

Use the CLI after a run when you want a quick budget check:

```bash
yam measure quick --files 3 --commands 1 --report-lines 5 --seconds 40
yam measure ueye --files 7 --commands 2 --report-lines 18 --seconds 260
```

## Metrics

- `files`: files or large snippets intentionally read.
- `commands`: verification or inspection commands that materially shaped the answer.
- `report-lines`: approximate final answer length in rendered lines.
- `seconds`: rough elapsed working time.

## Meaning

`ok` means the run fit the route's intended weight.

`over budget` means the route may still be valid, but the next run should either narrow scope or intentionally choose a heavier route.

`no measurements` means no actuals were provided; use `yam budget <route>` for static limits.

## Route Policy

- `$quick`: should stay small. If it repeatedly exceeds budget, the request is probably `$deep` or `$mission`.
- `$ueye`: may use visual/browser checks and nearby design context, but should avoid broad design archaeology unless the user asked for design-heavy work.
- `$question`: should answer directly. If it needs sources or comparison, switch to `$scout`.
- `$scout`: may gather a bounded set of high-signal sources and should separate evidence from judgment.
- `$deep`: can exceed ordinary budgets, but the reason must be risk-tied; single-agent runtime/tmux/browser checks belong here when verification needs them.
- `$mission`: can spend more context on real subagent/team lanes, cross-verification, doctor scan, and runtime evidence, but only for approved plans where real subagents are used or explicitly unavailable/partial.

## Design Baseline

Strict proof would favor stronger automatic evidence collection.

Modular skill workflows favor selective, low-context reporting.

Minimal-core design removes the measurement unless it changes behavior.

`yam` keeps manual measurement because it helps reduce over-reading without installing hooks.
