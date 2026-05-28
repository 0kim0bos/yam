# Markdown Management

`yam` uses markdown as a small direction layer, not as an automatic control system.

## Design Baseline

Strict proof systems:

- Creates and manages more markdown surfaces for agent control, route instructions, proof, and dashboards.
- Good for strict verification and anti-fake-work pressure.
- Risk: too much generated context and too much automatic intervention.

Modular skill systems:

- Splits markdown into modular instructions, rules, skills, and commands.
- Good for selective installation and low-context operation.
- Risk: too many optional files can still become noisy if installed wholesale.

Minimal-core systems:

- Keeps the core instruction document short and human-readable.
- Good for speed, obedience, and easy maintenance.
- Risk: weaker automated structure when work becomes broad or risky.

## yam Policy

- `yam.project.md` is project-local, short, and user-owned.
- `SKILL.md` files are route instructions managed by the `yam` source.
- `references/*.md` files are optional detail and should be opened only when needed.
- `.yam/*.md` files are optional logs, summaries, or proof notes.
- `.yam/memory/records/*.json` files are opt-in sparse memory records, not an automatic control layer.
- Do not install hooks or automations to keep markdown "fresh".
- Do not overwrite an existing project pack during normal init.
- Update stale project packs narrowly instead of re-reading the whole project every run.

## Project Pack Size

Target:

```text
500 to 1200 words
```

Hard preference:

- Short enough to read before each route.
- Specific enough to prevent re-planning from scratch.
- Focused on product direction, UI direction, commands, risks, and no-go rules.

## Write Rules

- Create `yam.project.md` only when missing.
- Never replace a user-edited pack without explicit approval.
- If command detection changes, report the new command and let the user or route update the pack narrowly.
- Keep generated sections clearly marked.
- Prefer one project pack over multiple competing instruction files.
