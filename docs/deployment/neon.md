# Neon PostgreSQL (QA)

Verifies Neon as a drop-in `DATABASE_URL` replacement for Aurora in the QA environment only.
**AWS/Aurora production and staging are untouched by this document or this phase** — this is an
additive review, not a migration of any real environment.

## Architecture

```
Local development   →   docker-compose's postgres:16-alpine container, plain TCP, no TLS
QA                  →   Neon (serverless Postgres, autosuspend, built-in pooler, TLS required)
Staging/Production  →   Aurora Serverless v2 / Aurora provisioned, behind PgBouncer, TLS required
```

All three are the same Prisma `provider = "postgresql"` datasource, differentiated **only** by the
value of one environment variable, `DATABASE_URL`. No environment-specific Prisma code path exists
anywhere in `apps/api-gateway/src` or `prisma/schema.prisma`.

## Review findings

| Area | Finding |
|---|---|
| Prisma schema (`schema.prisma:5-8`) | `datasource db { provider = "postgresql", url = env("DATABASE_URL") }` — no `directUrl`, no `shadowDatabaseUrl`, no `binaryTargets`, no `previewFeatures`, no `relationMode` override. `prisma/migrations/migration_lock.toml` locks the provider to plain `"postgresql"` (not a provider-specific dialect) — fully portable to any standard Postgres-wire-protocol service. |
| Prisma Client initialization (`prisma.service.ts`) | Plain `PrismaClient` subclass; `onModuleInit` → `$connect()`, `onModuleDestroy` → `$disconnect()`. No Aurora-specific connection logic (no IAM auth token generation, no RDS Proxy awareness, no hardcoded SSL mode). |
| `PrismaModule` | `@Global()`, single provider/export — no environment branching. |
| Shutdown hooks | Handled entirely by `main.ts`/`worker-main.ts`'s `app.enableShutdownHooks()` + SIGTERM/SIGINT handlers (reviewed in Phase DEV-3) — `PrismaService.onModuleDestroy()` is what actually runs `$disconnect()`, environment-agnostic. |
| Retry logic | None exists at the Prisma layer today (no custom retry wrapper around `$connect()`/queries) — connection failures surface immediately as thrown errors, confirmed for real in Phase DEV-3's local validation (a bad `DATABASE_URL` crashed the process on `onModuleInit` rather than retrying). This behavior is identical regardless of whether the target is Aurora or Neon. |
| Connection lifecycle | Synchronous within Nest's module-init phase: `$connect()` is awaited before `app.listen()` runs (see DEV-3's "Startup sequence" section) — same guarantee holds against Neon. |
| Migration strategy | 19 existing migrations under `prisma/migrations/`, applied via `prisma migrate deploy` (the Kubernetes `migrate-job.yaml` PreSync hook, Phase 9) in staging/production, `prisma migrate dev` locally. No migration file contains raw SQL referencing an Aurora-specific extension, role, or syntax (confirmed by the fact the schema/migration lock only ever targeted plain `postgresql`). |
| Seed strategy (`prisma/seed.ts`) | Fifteen ordered seed modules run via `tsx prisma/seed.ts` (`pnpm db:seed`), using a plain `new PrismaClient()` — reads `DATABASE_URL` the same way the app does, no environment-specific seed logic. |
| Connection pooling | Aurora sits behind PgBouncer in staging/production (`docs/infrastructure/migrations.md`: "the migration Job's `DATABASE_URL`... points at PgBouncer, identically to `api-gateway`/`workers`"). The schema has no `directUrl` configured — meaning the app has always talked to a *pooled* connection string, never a direct one. Neon's own built-in pooler (a PgBouncer-based transaction-mode pooler, exposed via a `-pooler` suffix on the compute endpoint hostname) is the direct architectural analog — same "app only ever sees one pooled connection string" pattern already in place for Aurora. |
| SSL handling | No explicit SSL configuration exists anywhere in application code — Prisma's `postgresql` provider reads SSL entirely from the connection string's own query parameters (`sslmode=require`, etc.), unlike the Redis client (which needed a separate `REDIS_TLS` boolean because ioredis's API requires it). For Postgres/Prisma, **SSL is a `DATABASE_URL` value change, not a code change** — confirmed both by inspecting `prisma.service.ts` (no SSL-related code at all) and by the schema exposing only `url = env("DATABASE_URL")`. |
| Health checks (`health.service.ts`) | `checkDatabase()` runs `this.prisma.$queryRaw\`SELECT 1\`` — a trivial, provider-agnostic query. Works identically against Neon. |
| Startup ordering | Unchanged from Phase DEV-3's finding — Database connects (and must succeed) before `app.listen()`, regardless of which Postgres provider `DATABASE_URL` points at. |

## Connection

**Confirmed: `DATABASE_URL` is the only configuration Neon requires.** No other environment
variable, Prisma schema field, or application code path references Aurora, RDS, or AWS in any way
that would need changing for Neon. No Aurora-specific assumption exists in `apps/api-gateway/src`
or `prisma/schema.prisma` — the only Aurora-specific things in the whole platform live in
`patheya-express-terraform` (the `aurora` module itself, IAM, Secrets Manager rotation), none of
which this repository's application code touches directly.

## SSL

**No Prisma/code changes are required.** Neon mandates TLS on every connection; this is satisfied
entirely by the connection string's query parameters:

```
postgresql://<user>:<password>@<endpoint>.<region>.aws.neon.tech/<database>?sslmode=require
```

`sslmode=require` is the minimum Neon needs; Neon also supports `channel_binding=require` for
stricter verification, at the operator's discretion — either is a connection-string-only choice,
not an application concern.

## Prisma compatibility with Neon — confirmed

`PrismaService`, `PrismaModule`, the shutdown hooks, the (absent) retry logic, and the connection
lifecycle are all environment-agnostic today, and nothing found in this review requires changing
any of them for Neon. This matches the same conclusion Phase DEV-1 already reached
(`docs/deployment/qa-environment.md`'s predecessor audit): swapping to Neon is a `DATABASE_URL`
value change only.

## Migration strategy recommendation for QA

Three options exist (`package.json`: `db:migrate:deploy`, `db:push`; `db:migrate` for `migrate dev`
locally); **do not change any implementation** — this is a recommendation only:

- **`prisma migrate deploy` (recommended)**: applies the same, already-committed migration history
  staging/production apply, in the same order, without ever touching the schema outside of
  recorded migrations. This is what makes QA a meaningful signal — a migration that would break
  staging/production breaks QA first, the same way. This should be QA's default, matching exactly
  how `migrate-job.yaml`'s PreSync hook already runs it for the Kubernetes path (§ Migrations,
  `docs/infrastructure/migrations.md`).
- **`prisma migrate reset` (acceptable, occasional/manual use only)**: drops and recreates the QA
  database from scratch, replaying every migration then optionally reseeding. Reasonable for QA
  specifically (data isn't precious) when a tester wants a known-clean slate — but should never be
  the *routine* deploy path, since it hides whether `migrate deploy` itself would succeed
  cleanly against an already-existing database (the real production/staging scenario).
- **`db push` (not recommended for QA)**: pushes the current schema directly, bypassing the
  migration history entirely. This would let QA's schema silently diverge from what
  `migrate deploy` actually produces — defeating the entire purpose of using QA as an early
  warning for a broken migration. Appropriate only for rapid local prototyping before a migration
  file even exists, never for QA.

**Recommendation: `prisma migrate deploy` on every QA deploy, with `prisma migrate reset` available
as a manual, on-demand "start fresh" operation — never `db push`.**

## Validation performed

Real commands run this phase, with `DATABASE_URL` set to a Neon-shaped (but non-functional
placeholder) connection string:

```
postgresql://neondb_owner:<password>@ep-<endpoint-id>.<region>.aws.neon.tech/patheya_express_qa?sslmode=require
```

- `pnpm --filter api-gateway exec prisma validate` → **"The schema at prisma\schema.prisma is
  valid"** — confirms the schema itself makes no assumption incompatible with a Neon-shaped URL.
- `pnpm --filter api-gateway exec prisma generate` → **succeeded**, Prisma Client generated
  normally.
- `pnpm --filter api-gateway run build` → **succeeded** (`nest build`, no errors).

None of these three commands connect to a real database (`generate`/`validate`/`build` are all
schema/type-level operations), so this validates exactly what it can validate honestly: the
Neon-shaped URL format itself introduces no parsing or code-generation problem, and no code change
is required to accept it. **Not validated** (would require a real Neon project, out of this
session's reach, same honesty standard as prior phases): an actual `migrate deploy` run or live
query against a real Neon endpoint.

## Performance — review only, no changes made

- **Autosuspend/cold start**: Neon computes suspend after a period of inactivity (configurable per
  Neon project; free/low-cost tiers suspend aggressively). The first query after a suspend incurs a
  cold-start delay (typically low single-digit seconds) while the compute endpoint resumes. Aurora
  Serverless v2 (already used for `development`/`staging` per `cost-review.md`) scales toward a
  minimum ACU floor rather than a hard suspend, so QA on Neon may show an occasional slow *first*
  request after idle periods that staging/production would not — worth setting tester expectations
  for, not a defect.
- **Built-in pooler**: Neon's pooled connection string (`-pooler` hostname suffix) should be used
  for the application's normal `DATABASE_URL`, mirroring the existing PgBouncer-in-front-of-Aurora
  pattern exactly — same reasoning `migrations.md` already documents for why the schema has no
  `directUrl` configured.
- **Region latency**: no current guidance exists on which Neon region to provision in relative to
  Render's region (backend compute) — colocating both minimizes cross-region latency, a QA
  provisioning decision, not a code one.

## Known limitations

- Live connectivity, an actual `migrate deploy` run, and query-level behavior against a real Neon
  project were not exercised in this review — no Neon project exists in this session. Everything
  above is verified by schema/code inspection and the three real local commands listed under
  Validation, consistent with how every other "QA-tier cloud service" phase in this migration has
  been verified.
- Neon's autosuspend behavior (above) is a genuine behavioral difference from Aurora Serverless v2
  that testers should be told about, even though it requires no code change to accommodate.
- This document, like the rest of the QA migration work, does not change `DATABASE_URL`'s value in
  any real environment — provisioning a real Neon project and populating the QA `.env`/Render
  environment variable with its connection string is a deployment-time action, not something this
  review performs.

## Comparison: Local PostgreSQL → Neon → Aurora

| | Local PostgreSQL | Neon (QA) | Aurora (staging/production) |
|---|---|---|---|
| Hosting | `docker-compose`'s `postgres:16-alpine` container | Neon serverless Postgres | AWS Aurora (Serverless v2 for dev/staging, provisioned `db.r6g.xlarge`+reader for production) |
| `DATABASE_URL` TLS | None (`docker-compose`'s plain container has no TLS) | `sslmode=require` mandatory | TLS via Aurora's own certificate, fronted by PgBouncer |
| Connection pooling | None (single container, low concurrency) | Neon's built-in pooler (`-pooler` endpoint) | PgBouncer (`modules/eks-addons/pgbouncer.tf`) |
| Autoscaling/suspend | None (always-on local container) | Autosuspend after inactivity, resumes on next query | Aurora Serverless v2 scales toward a minimum ACU floor (dev/staging); production is fixed-provisioned, always on |
| Migration application | `prisma migrate dev` (interactive, generates new migrations) | `prisma migrate deploy` (recommended, see above) | `prisma migrate deploy` via the Kubernetes `migrate-job.yaml` PreSync hook |
| Secrets delivery | Plain `.env` file (gitignored) | Render/Vercel-native environment variable (per `docs/deployment/render.md`) | External Secrets Operator → AWS Secrets Manager |
| Code path in `apps/api-gateway/src` | Identical | Identical | Identical |

Every row above differs only in *how the connection is provisioned and secured*, never in
application code — this is exactly what "drop-in replacement" means for this codebase, and this
phase's review and validation found nothing to contradict that.
