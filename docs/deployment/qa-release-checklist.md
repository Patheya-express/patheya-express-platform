# QA release checklist

This is a hardening artifact (Phase DEV-7.5), not a deployment — no QA deploy has been performed
in any phase of this migration. It exists so the first real QA deploy, whenever it happens, follows
a reviewed, repeatable process instead of improvising one. Companion to `render-blueprint.md`
(what the Blueprint contains) and `render.md`/`neon.md`/`upstash.md` (per-service compatibility
reviews).

## Database migration strategy — recommendation

Three options were evaluated for how `prisma migrate deploy` runs against the Neon QA database:

- **Option A — Manual migration step**: someone runs `prisma migrate deploy` ad hoc, whenever they
  remember to, with no fixed process. Simplest, but the least safe — nothing stops a deploy from
  going out with pending migrations un-applied, and there's no record of whether it was actually
  done.
- **Option B — Dedicated migration service**: add a third Render service (built from the
  Dockerfile's `migrate` stage, the same one `k8s/base/api-gateway/migrate-job.yaml` already uses
  for the Kubernetes/ArgoCD path) that runs automatically before every deploy. This is the most
  automated option, but it's real added complexity for QA specifically: a third `render.yaml`
  service to maintain, and Render's Blueprint schema does not have a first-class "run once, then
  stop" job primitive with the same guarantees ArgoCD's PreSync hook has — approximating it well
  would take more Blueprint surface than QA's deploy frequency justifies.
- **Option C — Release checklist migration step (recommended)**: formalize the manual step as an
  explicit, mandatory, checked-off item in this document, run the same way Option A would (Render
  Shell against a one-off build of the `migrate` stage, or locally against the Neon connection
  string), but never skippable because it's a named step in a checklist someone actually follows,
  not an ad hoc "someone remembers to do it."

**Recommendation: Option C.** It closes the real gap in Option A (accountability — the step is
named, ordered, and checked off, not left to memory) without Option B's added complexity (a third
service, extra Blueprint surface, extra billing, for a QA environment that deploys infrequently).
Option B remains the better choice if QA deploy frequency ever increases enough that a manual step
becomes a real bottleneck or a repeatedly-missed one — revisit then, not now. This directly answers
`render-blueprint.md`'s "No migration automation in this Blueprint" limitation: the answer isn't
automation, it's an explicit, unskippable step (§ Deployment, below).

## Deployment order

```
Neon (database)
   ↓
Upstash (Redis)
   ↓
Migration  (prisma migrate deploy, against Neon — Option C above)
   ↓
API        (Render Web Service — api-gateway)
   ↓
Worker     (Render Background Worker)
   ↓
Frontend   (4x Vercel apps, pointed at the API's real QA URL)
```

Why this order specifically:
- **Database and Redis must exist and be reachable before anything else** — both `api-gateway` and
  `worker` fail fast (crash on boot) if `DATABASE_URL` is unreachable (confirmed for real in Phase
  DEV-3's local validation), so provisioning order matters even though nothing enforces it in code.
- **Migration before API/Worker** — both processes' `PrismaService.onModuleInit()` runs
  `$queryRaw`-shaped queries against tables the migrations create; deploying either service before
  migrations are applied means every request fails with a Prisma "table does not exist" error
  rather than a clean boot failure.
- **API before Worker is not strictly required** (both only need Database/Redis/migrations to be
  ready, not each other), but deploying API first lets you confirm `/api/v1/health/ready` is green
  before adding the Worker, isolating which service a problem belongs to if one shows up.
- **Frontend last** — every Vercel app's `environment.qa.ts` is a *build-time* constant
  (`apiBaseUrl`/`socketUrl`/`mediaBaseUrl`, Phase DEV-2/DEV-4); deploying frontend before the API
  has a real, stable URL means rebuilding and redeploying all four apps again once that URL is
  known, rather than once.

## Failure recovery

| Scenario | What actually happens | Recovery |
|---|---|---|
| **Database (Neon) unavailable** | Both `api-gateway` and `worker` crash on boot (`PrismaService.onModuleInit()`'s `$connect()` throws) — confirmed for real in Phase DEV-3. An already-running instance that loses its connection mid-flight will fail its next query and report `database: 'disconnected'` on `/api/v1/health`/`/health/ready`, tripping Render's health check (now pointed at `/health/ready`, Phase DEV-7.5) and triggering a restart. | Confirm the Neon project is awake (check for autosuspend, Phase DEV-5's finding) and `DATABASE_URL` is still correct/unrotated; once reachable, Render's own restart-on-unhealthy behavior recovers the service without manual intervention. |
| **Redis (Upstash) unavailable** | Does **not** crash the process — `checkRedis()`/`QueueService.checkHealth()` both catch and return `false` (Phase DEV-6 finding), so `/health`/`/health/ready` report `redis`/`queues: 'disconnected'` and the readiness check fails (503), but the process stays up. BullMQ jobs queue in ioredis's offline queue and flush once reconnected; Socket.IO cross-pod fanout is degraded (same-pod delivery may still work) until the adapter's pub/sub clients reconnect. | Confirm the Upstash instance/token is valid; ioredis's own `retryStrategy` reconnects automatically once Upstash is reachable again — no restart needed unless the outage was long enough that Render's health check already cycled the instance. |
| **Migration failure** | `prisma migrate deploy` exits non-zero and leaves the migration marked as failed in Prisma's `_prisma_migrations` table — it does **not** partially apply and silently continue. The API/Worker should not be deployed against a database in this state (their queries would hit a schema that doesn't match their code's expectations). | Do not proceed to the API/Worker deploy step. Inspect the failed migration's SQL against the actual Neon schema state, fix forward with a new migration (never hand-edit an already-applied migration file), and re-run `prisma migrate deploy`. This mirrors `docs/infrastructure/migrations.md`'s existing additive-migration discipline. |
| **Worker failure** | The Web Service keeps serving HTTP traffic normally — orders/menu/auth all work — but BullMQ jobs (notifications, dispatch assignment expiry, order-acceptance timeouts, payment reconciliation, search/ticket schedulers) stop being processed and queue up in Redis. No user-facing error occurs immediately; symptoms are delayed notifications, orders not auto-expiring, etc. | Check the worker's own logs for the `worker_started` event (or its absence) and any crash trace; Render restarts a crashed Background Worker automatically. Queued jobs are not lost (they persist in Upstash) and drain once the worker is healthy again. |
| **Rollback** | See § Rollback below — Render Web Services and Background Workers can both be rolled back to a previous successful deploy via Render's own deploy history, independent of any AWS/GitOps rollback mechanism. | — |

## Release checklist

### Pre-deployment
- [ ] Neon QA project exists and is reachable; `DATABASE_URL` (with `?sslmode=require`) is ready to
      paste into Render's `sync: false` prompt (`docs/deployment/neon.md`).
- [ ] Upstash QA instance exists; `REDIS_HOST`/`REDIS_AUTH_TOKEN` ready, `REDIS_TLS=true` confirmed
      (`docs/deployment/upstash.md`).
- [ ] Cloudinary QA account/folder, Razorpay test keys, SMTP credentials, and the four Vercel QA
      frontend URLs are all on hand (`docs/deployment/qa-environment.md`).
- [ ] `render.yaml` reviewed — confirm `healthCheckPath: /api/v1/health/ready` (Phase DEV-7.5) and
      both services still point at the same `dockerfilePath`/`dockerContext`.
- [ ] Migration files reviewed — nothing pending that hasn't been through the additive-migration
      discipline (`docs/infrastructure/migrations.md`).

### Deployment
1. [ ] Confirm Neon and Upstash are both reachable (§ Deployment order).
2. [ ] **Run `prisma migrate deploy` against the Neon `DATABASE_URL`** (Option C, above) — via
       Render Shell against a one-off build of the Dockerfile's `migrate` stage, or locally. Do not
       proceed if this step fails or is skipped.
3. [ ] Apply the Render Blueprint (`render.yaml`) — creates/updates both services from the same
       commit.
4. [ ] Fill in every `sync: false` prompt with real QA values (Render only asks once per variable,
       on first apply or when a value is cleared).
5. [ ] Wait for the Web Service (`api-gateway`) to report healthy on `/api/v1/health/ready` before
       considering the Worker's deploy meaningful (§ Deployment order rationale).
6. [ ] Confirm the Worker's logs show `worker_started`.
7. [ ] Update all four Vercel apps' `environment.qa.ts` with the real API origin, then deploy each
       (`docs/deployment/vercel.md`).

### Post-deployment
- [ ] `/api/v1/health/ready` returns 200 with every dependency `connected`.
- [ ] `/api/v1/health` (general status) also reports `'ok'`, not `'degraded'`.
- [ ] Worker logs show no repeated crash/restart loop in the first few minutes.
- [ ] Confirm each of the four Vercel apps loads and its network requests hit the real QA API
      origin, not a stale placeholder.

### Smoke tests
- [ ] Register a new user, log in (issues real JWTs against the real `JWT_ACCESS_SECRET`/
      `JWT_REFRESH_SECRET` Render generated).
- [ ] Load the restaurant/menu discovery pages (exercises Database + Cloudinary-served media via
      `mediaBaseUrl`).
- [ ] Add an item to cart and reach checkout (exercises session/cart state through Redis).
- [ ] Confirm a Socket.IO connection succeeds from the browser (`socketUrl`) — join a room and
      confirm no immediate disconnect.
- [ ] Trigger one BullMQ-backed action (e.g. a notification-producing event) and confirm the Worker
      actually processes it, not just that the Web Service accepted the request.
- [ ] Hit `/api/docs` (Swagger) and confirm it loads — always mounted regardless of environment
      (Phase DEV-1 finding).

### Rollback
- [ ] **Web Service / Worker**: use Render's own deploy history to redeploy the previous successful
      build — both services are independent Render deploys, so either can roll back without
      affecting the other.
- [ ] **Migration rollback**: Prisma has no automatic "undo" for `migrate deploy` — if a migration
      needs reverting, write a new, forward migration that undoes the change (matches the
      additive-only discipline already documented for the Kubernetes path,
      `docs/infrastructure/migrations.md`) rather than attempting to hand-revert applied SQL.
      Rolling back the *application* deploy without also addressing the schema it now expects can
      reintroduce the very mismatch a bad migration caused — check which direction actually needs
      reverting before doing either.
- [ ] **Frontend**: each Vercel app has its own independent deploy history; roll back the specific
      app(s) affected, not all four reflexively.
- [ ] After any rollback, re-run the Smoke tests section before considering QA stable again.

## Validation performed this phase

- `render.yaml` re-parsed with `js-yaml` after the `healthCheckPath` edit — confirmed valid YAML,
  both services still share the identical `dockerfilePath`/`dockerContext`, worker's `dockerCommand`
  unchanged (`node dist/src/worker-main.js`), API's command still unmodified (matches `start:prod`).
- `Dockerfile` re-reviewed — unchanged since Phase DEV-3; `migrate` stage still exists and remains
  the correct (only) way to run `prisma migrate deploy` with the CLI available, per Option C above.
- Health endpoints re-reviewed — `/api/v1/health/ready`'s 503-on-failure behavior (Phase DEV-3 fix)
  is what makes it the correct Render health-check target; confirmed no further code change needed
  beyond the `render.yaml` edit itself.
- Startup sequence and worker startup re-reviewed against Phase DEV-3's findings — unchanged, still
  accurate: Database connects synchronously before `app.listen()`, Redis/BullMQ tolerate connecting
  late via ioredis's offline queue.

**Deployment process is now complete on paper** — every step from provisioning through rollback is
documented and ordered — but remains **entirely unexecuted**: no Neon/Upstash/Render/Vercel account
exists in this session, so nothing above has been run against real infrastructure. This is stated
explicitly, consistent with every other phase of this migration.
