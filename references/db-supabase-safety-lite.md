# DB/Supabase Safety Lite

This is an advisory proof-first trust layer, not a database scanner.

Use it when a prompt, command, migration, or code change touches database mutation, Supabase, RLS, production data, or schema changes.

## Risk Signals

Recommend `$deep` when you see:

- `DROP`, `TRUNCATE`, `DELETE FROM`, broad `UPDATE`, or `ALTER TABLE`.
- `supabase db reset`, `supabase db push`, migration generation, migration apply, or remote/linked project commands.
- ORM migration commands such as Prisma, Drizzle, Knex, or Sequelize migrations.
- RLS/policy/permission changes: `CREATE POLICY`, `ALTER POLICY`, `GRANT`, `REVOKE`.
- Production/remote signals: `prod`, `production`, `live`, `DATABASE_URL`, `service_role`, `--db-url`, `--linked`, `--remote`, or `--project-ref`.

## Guardrail

Before claiming safe:

- identify local/staging/production target
- prefer read-only inspection first
- require explicit user approval for destructive or production writes
- know the rollback or backup path when data can be lost
- run the smallest honest verification that matches the claim

## Truth Language

- Pattern detection is `assumed`, not proof.
- Read-only inspection can be `partial` or `verified` for the inspected surface.
- A successful migration command is not automatically safe; it only proves that command execution completed.
- Do not claim production safety without environment evidence.

## Design Baseline

Strict proof would gate destructive DB work more aggressively.

Modular skill workflows keep the check selective and evidence-bound.

Minimal-core design keeps this as a short rule and a small detector, not a full DB policy engine.
