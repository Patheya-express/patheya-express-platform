# Database migrations

How `prisma migrate deploy` actually runs against this platform — companion to
[`docs/ci-cd/promotion-guide.md`](../ci-cd/promotion-guide.md) and the Terraform repo's
`docs/secrets-guide.md`.

## Why a separate image tag

The K8s/ArgoCD path never runs `prisma migrate deploy` inside the running service's own container —
the Dockerfile's `migrate` stage reuses `build`'s full, unpruned `node_modules` (which already has
the CLI, being a full dev install) instead. CI pushes it as `patheya-express-api-gateway-migrate:<tag>`
— same ECR repository, second tag, never a second repository, and the `migrate-job.yaml` PreSync
Job is what actually invokes it (see below).

`runtime` — the `api-gateway`/`worker` services' own image — still deliberately excludes every
*other* devDependency (TypeScript, ESLint, Jest, the NestJS CLI, etc.), pruned by `pnpm deploy
--prod` exactly as before. The one exception: `prisma` (the CLI) itself moved from
`devDependencies` to `dependencies` in `apps/api-gateway/package.json` (Production hardening —
Render migration automation), so it now survives that same prune and is present in `runtime` too —
see "The Render path" below for why. This costs `runtime` roughly +70MB (measured: 720MB → 791MB
for a real build of this Dockerfile) — accepted specifically because it's the only way Render's
native `preDeployCommand` can run migrations at all (Render always runs that command against the
exact image a service deploys; it cannot target a different Dockerfile stage — verified against
Render's own documentation, not assumed). The K8s path is entirely unaffected by this: it never
uses `runtime`'s bundled CLI, and `docker build --target migrate`/`--target runtime` (what CI's
`reusable-docker-publish.yml` actually runs) is unaffected by anything added to `runtime`'s
dependency list, since `--target` always overrides Docker's own "build the last stage" default
regardless of what stages exist elsewhere in the file.

## Ordering: PreSync hook, not a sync-wave number

`k8s/base/api-gateway/migrate-job.yaml` carries `argocd.argoproj.io/hook: PreSync` — ArgoCD's hook
phases (PreSync → Sync → PostSync) always complete in full before the next phase starts, which is a
stronger guarantee than sync-wave ordering (waves only order resources *within* the same Sync
phase). A migration that fails blocks the entire sync — api-gateway's and workers' Deployments
never see a new pod roll out against a schema they don't match.

`hook-delete-policy: BeforeHookCreation` keeps the previous run's Job (and its logs) inspectable
until the *next* deploy needs the name again, rather than deleting it the moment it succeeds.

## The Render path

Render has no equivalent of ArgoCD's PreSync hook, no way to select a different Dockerfile stage
per service, and its "One-off Jobs" feature is explicitly tied to a base service's *same* build
artifact (confirmed against Render's docs) — none of the K8s path's mechanisms carry over as-is.
What Render does have, and what `render.yaml`'s `api-gateway` service now sets, is
`preDeployCommand`: a command that runs in a separate, ephemeral instance of the *same* image the
service is about to deploy, after the build finishes and before the new deploy receives traffic —
Render blocks (and does not promote) the deploy if it exits non-zero. That "same image" constraint
is exactly why the CLI had to move into `runtime` (see above) rather than Render being pointed at
`migrate` some other way — there isn't another way, verified directly against Render's
documentation before implementing this, not assumed from how the K8s path happens to work.

```yaml
preDeployCommand: node_modules/.bin/prisma migrate deploy
```

Direct binary invocation, not `pnpm exec prisma ...` — `runtime` still has no functioning pnpm
(only the `corepack` shim Node's own base image ships unconditionally, not an activated package
manager), so the CLI is invoked the same way any other `node_modules/.bin/*` executable would be.

Only the `api-gateway` Web Service has this set, not `worker` — migrations should run exactly once
per deploy, and both services build from the same commit/image on every push, so gating it on one
service is sufficient. (Prisma's own migration-lock table would make a second, accidental
concurrent `migrate deploy` safe — it waits, then finds nothing left to apply — but there's no
reason to rely on that when a single owner is simpler.)

**Verified end-to-end against a real, deliberately-behind Postgres database** (not assumed):
built the actual `runtime` image, applied migrations only through the one before
`add_review_replies`, confirmed the `reviews` table was missing `replyText` (reproducing the exact
reported production error), ran `node_modules/.bin/prisma migrate deploy` from inside that same
built image against that database (exactly how Render's `preDeployCommand` invokes it), confirmed
all pending migrations applied and `replyText` now exists, then booted the same image against the
now-current schema and got a real HTTP 200 from `GET /restaurants/:id/reviews` with genuine reply
data in the response.

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
