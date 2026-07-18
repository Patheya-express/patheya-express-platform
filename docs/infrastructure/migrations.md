# Database migrations

How `prisma migrate deploy` actually runs against this platform — companion to
[`docs/ci-cd/promotion-guide.md`](../ci-cd/promotion-guide.md) and the Terraform repo's
`docs/secrets-guide.md`.

## Why a separate image tag

The running service's image (`patheya-express-api-gateway:<tag>`) deliberately excludes the
`prisma` CLI — it's a devDependency, pruned by `pnpm deploy --prod` in the `runtime` build stage,
because the running service only ever needs the generated `@prisma/client`, never the CLI itself.
`prisma migrate deploy` needs the CLI, so the Dockerfile's `migrate` stage reuses `build`'s full,
unpruned `node_modules` instead. CI pushes it as `patheya-express-api-gateway-migrate:<tag>` — same
ECR repository, second tag, never a second repository.

## Ordering: PreSync hook, not a sync-wave number

`k8s/base/api-gateway/migrate-job.yaml` carries `argocd.argoproj.io/hook: PreSync` — ArgoCD's hook
phases (PreSync → Sync → PostSync) always complete in full before the next phase starts, which is a
stronger guarantee than sync-wave ordering (waves only order resources *within* the same Sync
phase). A migration that fails blocks the entire sync — api-gateway's and workers' Deployments
never see a new pod roll out against a schema they don't match.

`hook-delete-policy: BeforeHookCreation` keeps the previous run's Job (and its logs) inspectable
until the *next* deploy needs the name again, rather than deleting it the moment it succeeds.

## Rollback strategy

Prisma migrations are forward-only by design — there is no `prisma migrate down`. Three layers,
in the order to actually reach for them:

1. **Roll back the application, not the schema**, whenever the migration itself succeeded and the
   problem is purely in the new application code that shipped alongside it: `argocd app rollback`
   to the prior Git revision (this repo's only sanctioned rollback path,
   `platform-standards.md` Section 10) — the schema stays forward-migrated (new columns/tables are
   harmless to an old binary that doesn't reference them, as long as migrations are written
   additively — see "Writing a safe migration" below).
2. **Write a new forward migration that reverses the change**, when the schema change itself is the
   problem (e.g. a bad default, a constraint that's rejecting valid data). This is the normal path
   for anything short of active data loss — a new migration, reviewed and merged like any other
   change, going through the exact same PreSync hook next deploy.
3. **Restore from Aurora's point-in-time recovery** (`patheya-express-terraform`'s `modules/aurora`,
   35-day PITR window), only for actual data loss/corruption a forward migration can't undo — this
   is a full database restore, RPO ≤ 5 minutes per the blueprint's Section 12, and the heaviest,
   slowest option of the three. Coordinate with whoever owns the DR runbook before starting one.

## Writing a safe migration (so option 1 above stays available)

- Add columns as nullable or with a default — never `NOT NULL` with no default against a table an
  old, still-running pod might insert into during a rolling update.
- Never drop or rename a column/table in the same migration a code change stops using it in — ship
  the code change first (old code ignores the now-unused column), then drop it in a later,
  separate migration once no running pod references it anymore.
- Additive, two-step changes are the norm specifically because rolling updates and this migration
  Job's PreSync timing mean an old pod and the new schema can briefly coexist during any deploy —
  never assume the migration and the new code that depends on it become active at the exact same
  instant across every replica.

## Connection pooling and this Job

The migration Job's `DATABASE_URL` (from the `backend-database-url` Secret) points at PgBouncer,
identically to `api-gateway`/`workers` — never a separate direct-to-Aurora connection string.
PgBouncer's transaction-pooling mode is compatible with `prisma migrate deploy`'s DDL statements at
this platform's scale; revisit only if a specific migration's lock behavior ever proves otherwise
(Prisma's own docs recommend a direct, non-pooled connection for `migrate deploy` in some setups —
not yet needed here, but the schema has no `directUrl` configured, so adding one is the fix if it
ever is).
