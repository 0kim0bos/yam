# yam Project Pack

## Product Direction

- yam is a progressive, proof-first workflow package for Codex-compatible agent skills and a local CLI.
- The primary user is a builder who wants fast ordinary work but stronger evidence when release, runtime, UI, security, or broad changes make false completion costly.
- The primary flow is: select the smallest fitting route, reuse local direction, implement narrowly, verify at the lightest honest level, then close with Study Note and an ordered Next step when artifacts changed.
- Keep ordinary use small. Heavy receipts, Mission lanes, runtime proof, design production, and provider boundaries stay explicit and demand-gated.

## UI Direction

- yam is CLI- and Markdown-first; there is no product UI surface in this repository.
- Human output should be short, readable, and paired with stable `--json` contracts where automation needs evidence.
- Do not introduce a dashboard or background service unless repeated real use proves the CLI and local artifacts are insufficient.

## Tech Stack

- Node.js 18+ ESM package, TypeScript source, compiled `dist/`, npm distribution.
- Tests are focused Node smoke scripts rather than a broad test framework.
- Playwright is optional verification support; it is not a default runtime dependency.
- External updates cover yam, Scrapling, and Insane Search through their supported distribution paths.

## Commands

- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Focused smoke: use the script matching the touched library or CLI surface.
- Full self-verification: `npm run verify:self`
- Release readiness: `npm run release:check`
- Package preview: `npm pack --dry-run --json --ignore-scripts`
- Installed health: `yam status` and `yam doctor --json`

## Key Paths

- `src/bin/yam.ts`: CLI routing and human/JSON command surfaces.
- `src/lib/`: small reusable trust, installation, update, evidence, and design contracts.
- `skills/`: installed route instructions.
- `references/`: progressively disclosed route guidance copied with each skill.
- `scripts/`: focused smoke, package boundary, secret, and release checks.
- `.github/workflows/`: public CI and trusted-publishing boundaries.
- `templates/`: user-owned project and proof artifact starters.

## Verification Policy

- Tiny docs or guidance changes: L1 inspection plus `git diff --check` when sufficient.
- TypeScript contract changes: typecheck, build, and the focused smoke for that contract.
- CLI/package changes: packaged CLI smoke against an actual tarball.
- Install/update changes: transaction/update smoke with ownership, rollback, identity, and no-mutation assertions.
- Release/security changes: L4-L5 evidence, exact packed artifact checks, registry metadata, and a concise Doctor scan.
- Stop after the smallest meaningful set passes or three relevant checks have run; report remaining uncertainty instead of repeating the same failure.

## Security Policy

- Treat installation paths, receipts, update sources, plugin caches, release credentials, fetched pages, and public package contents as sensitive boundaries.
- Preserve user-owned files unless ownership and integrity are proven or the operator explicitly authorizes one reviewed replacement.
- Never edit `.codex/plugins/cache` directly and never remove Insane Search first as an update strategy.
- Do not print tokens, matched secrets, private keys, or credential-bearing URLs. Keep npm publishing outside read-only readiness reports.
- Prefer short-lived OIDC publishing credentials and provenance after the repository workflow is configured as npm's trusted publisher.

## Report Policy

- Changed code, config, release metadata, docs, or artifacts require a Study Note explaining role, execution point, before/after behavior, expected result, one structure insight, verification, and limits.
- Put Next step immediately after Study Note. It must rescan the whole process, state the current situation and outlook, give a concrete critical opinion and recommendations, then order fix-first work before planned work with evidence and ownership.
- Keep final reports compact and distinguish verified, partial, blocked, skipped, and assumed claims.

## Known Risks

- Node cannot provide `openat`-grade descriptor-relative traversal; Windows reparse-point coverage and npm `.cmd` executable identity need dedicated fixtures before stronger claims.
- Local integrity receipts are not signatures against another process running as the same OS user.
- CI and trusted publishing prove a release path only after the npm package is explicitly connected to the reviewed workflow.
- Operator-supplied execution and research evidence stays partial unless an independent verifier checks the upstream artifact or runtime.

## Recent Decisions

- Add an immutable Scout source/claim receipt only for repeated research; do not create a default research database.
- Add a pure install dry-run plan before mutation while keeping actual install authorization explicit.
- Build and reuse one exact tarball across operating-system lifecycle checks.
- Keep Next step as a reusable contract connected to loop reports and the Study Note completion guard.
- Keep release authentication path-specific: auto-select the reviewed Trusted Publisher OIDC workflow, preserve explicit manual-token readiness, and never use `npm whoami` as OIDC proof.

## No-Go Rules

- No always-on orchestration, mandatory subagents, background daemon, automatic publish, automatic stale-lock deletion, or silent destructive cleanup.
- No broad binary context graph or global bridge/config mutation in the core package.
- Do not leave third-party comparison or attribution language in public product guidance, package metadata, release notes, or source comments.
- Do not claim deployment, publish, runtime cleanup, visual parity, or source truth without matching evidence.

## MD Management

- Owner: user-maintained project pack.
- Keep this file between roughly 500 and 1200 words and update only the sections affected by a durable decision.
- Generated receipts belong under ignored `.yam/` paths; do not turn this pack into a run log.
- `AGENTS.md` owns project-wide rules, `skills/*/SKILL.md` owns route behavior, and `references/*.md` owns optional detail.
