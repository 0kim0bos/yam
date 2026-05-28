# Risk Escalation

Escalate by recommendation, not silent mode switching.

Recommend `$deep` when work touches:

- DB schema or data mutation.
- Supabase destructive commands, migrations, production writes, RLS, or policy changes.
- Auth, payment, billing, permissions.
- Security-sensitive code.
- Deployment or release configuration.
- Broad refactor or many files.
- Failing verification.
- Unknown ownership or unclear acceptance criteria.
- Long-running process lifecycle.

Recommend `$mission` only when the user has an approved plan and real subagent/team execution would materially reduce risk.

Suggested phrase:

```text
This looks like a deeper route because it touches <risk>.
I can continue lightly, or switch to $deep for stronger single-agent verification.
Use $mission only if you want real subagent/team execution.
```

Use `db-supabase-safety-lite.md` for the short DB/Supabase guardrail.
