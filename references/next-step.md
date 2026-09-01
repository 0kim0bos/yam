# Next step

`Next step` is a compact ordered handoff produced after a quick scan of the whole completed process. It is not a renamed list of leftover tasks. Its job is to combine what is true now, what is likely next, a critical opinion about the current direction, and bounded recommendations into an executable sequence.

## Placement

When code, config, documentation, release metadata, or another project artifact changed, put `Next step` immediately after `Study Note`. Do not insert verification, risk, or unrelated sections between them. When no artifact changed, a Study Note is not required, but `Next step` may still be used when a sequenced handoff is useful.

## Whole-process scan

Before writing the sequence, quickly re-check:

- the original goal and acceptance criteria;
- changed, verified, skipped, and blocked surfaces;
- current repository, runtime, release, and cleanup state when relevant;
- likely downstream work and whether it depends on current evidence;
- direction drift, avoidable complexity, security exposure, and false-completion risk.

Record four scan results: `current_situation`, `forward_outlook`, `critical_opinion`, and one or more `improvement_recommendations`. Critical opinion should identify a concrete weakness or tradeoff; it must not be generic praise or pessimism.

## Ordered sequence

Use one to twelve actionable steps. Put every `fix_first` item before any `planned` item. Each step must state:

- the action and why it matters;
- owner route and bounded owner scope;
- blockers, or an empty blocker list;
- a safe retry instruction when blocked;
- expected side effects, including an explicit `none expected` when appropriate.

The sequence should cover meaningful downstream work even when the current request has no leftovers. Do not invent work to make the list longer. If no meaningful next work exists, use one planned step that says to preserve the evidence and stop, with the reason.

## Evidence and truth

Bind the scan to an `L0`-`L5` evidence level and a concrete evidence stamp such as a command result, receipt digest, reviewed commit, or file inspection. The receipt has no timestamp, so identical normalized input produces the same digest.

- `verified` requires at least L2 evidence and a non-empty stamp.
- `proven` requires at least L4 evidence and a non-empty stamp.
- Any blocker requires overall truth `blocked`.
- A `blocked` truth claim requires a concrete blocker.
- Empty or contradictory verified/proven claims fail closed to `blocked`.

The truth status describes the evidence behind the scan and ordering, not completion of future actions. Use `verifyNextStep` to detect tampering or malformed receipts before another command relies on them.

An evidence stamp binds the assessment to a named source but does not authenticate that source by itself. When the stamp points to another receipt or gate, the caller remains responsible for verifying that upstream artifact before making a completion claim.

## Compact report shape

```text
Study Note:
- ...

Next step:
1. [fix first] <action> — <why>
   Owner: <$route>; scope: <bounded scope>
   Blocker/safe retry: <none or concrete recovery>
   Evidence: <L0-L5>; <stamp>; truth: <status>
   Side effects: <expected effects>
2. [planned] ...

Situation: <current state>
Outlook: <likely downstream state>
Critical opinion: <specific weakness or tradeoff>
Recommendation: <bounded improvement>
```

The JSON form is `yam.next-step.v1`, built by `buildNextStep` in `src/lib/next-step.ts`.
