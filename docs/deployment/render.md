# Render deployment

Backend production-readiness for Render, as a QA-tier alternative to the AWS/EKS/ArgoCD path.
This document describes the two Render services the backend needs and how to configure them.
**It intentionally does not cover GitHub Actions/CI wiring** — that's a separate, later piece of
work; today this assumes a manual or Render-native (Git-connected) deploy.

## Architecture

Render hosts two services built from the same Docker image (`Dockerfile`, `runtime` stage) — the
same "one image, two entrypoints" model already used by the Kubernetes `workers/deployment.yaml`
and `docker-compose.prod.yml`'s `worker` service, extended here to Render:

```
                        ┌──────────────────────────┐
  Browser/mobile  ───▶  │  Web Service (api-gateway)│──▶ Neon (Postgres)
                        │  node dist/src/main.js    │──▶ Upstash (Redis)
                        └──────────────────────────┘──▶ Cloudinary (media)
                                     │
                                     │ shares the same Postgres/Redis
                                     ▼
                        ┌──────────────────────────┐
                        │ Background Worker (worker)│──▶ Neon (Postgres)
                        │ node dist/src/worker-main.js│─▶ Upstash (Redis, BullMQ)
                        └──────────────────────────┘
```

Both services run the identical image and connect to the identical Neon/Upstash instances — the
Web Service serves HTTP/WebSocket traffic and enqueues jobs; the Background Worker only processes
BullMQ jobs (`dispatch`, `notifications`, `payments`, `search`, `tickets`, `orders`) and never
receives inbound traffic. This mirrors the Kubernetes topology exactly, just without ArgoCD/EKS.

## What was reviewed and what changed this phase

Real gaps found and fixed (backend-only, no AWS/Terraform/GitOps/K8s changes):

1. **`/health`'s `status` field was hardcoded to `'ok'`** regardless of actual database/Redis/
   queue state (`health.service.ts`) — useless as a deploy health check. Now computed from the
   same database/Redis/queue checks the endpoint already reported per-field, with a new `queues`
   field added to `HealthResponseDto` for parity with the readiness endpoint.
2. **Both `docker-compose.yml`'s `worker` profile and `docker-compose.prod.yml`'s `worker`
   service were missing a `command` override** — without it, they silently ran the image's
   default CMD (`main.js`, the full HTTP app) instead of `worker-main.js`, unlike
   `k8s/base/workers/deployment.yaml`, which correctly overrides `args`. Both compose files now
   explicitly run `["node", "dist/src/worker-main.js"]`, and this same command is what Render's
   Background Worker service must be configured with (see below).
3. **`package.json` gained a `start:worker` script** (`node dist/src/worker-main.js`), mirroring
   the existing `start:prod` (`node dist/src/main.js`) — a convenience for whichever start-command
   convention Render (or a human) uses.
4. **`.env.qa.example` was missing three variables the code actually reads**:
   `RAZORPAY_WEBHOOK_SECRET`, `APP_NAME`, `SHUTDOWN_TIMEOUT_MS` — none were in `.env.example`
   either (a pre-existing gap), now documented in `.env.qa.example`.

Everything else reviewed was already Render-compatible with no code change needed — see the
per-item findings below.

## Render compatibility findings

| Requirement | Status | Evidence |
|---|---|---|
| PORT comes entirely from environment | ✅ Already correct | `main.ts:164` / `worker-main.ts:87`: `app.listen(process.env.PORT \|\| 3000)`. Render injects `PORT` automatically for Web Services; the Background Worker doesn't need to bind a port at all — the worker still listens (for its own `/api/v1/health/*` surface, useful for manual checks) but Render's Background Worker type doesn't require or check it. |
| Health endpoint exists | ✅ Already correct, improved this phase | `/api/v1/health`, `/api/v1/health/live`, `/api/v1/health/ready` all exist; `/health`'s `status` field now genuinely reflects dependency state (fix #1 above). |
| Graceful shutdown works | ✅ Already correct | `app.enableShutdownHooks()` (`main.ts:131`, `worker-main.ts:64`) wires Nest's `onModuleDestroy` lifecycle to real process signals. |
| SIGTERM handling is correct | ✅ Already correct | Both entrypoints register `SIGTERM`/`SIGINT` handlers that log the signal and set an `unref()`'d force-exit timer (`SHUTDOWN_TIMEOUT_MS`, default 10s) as a safety net if a lifecycle hook hangs — a clean shutdown that finishes first is never held open by the timer. |
| Prisma disconnects cleanly | ✅ Already correct | `PrismaService.onModuleDestroy()` calls `this.$disconnect()` (`prisma.service.ts:14-16`), triggered by the shutdown hook above. |
| BullMQ shuts down cleanly | ✅ Already correct | Every processor (`NotificationProcessor`, `AssignmentExpiryProcessor`, `OrderAcceptanceTimeoutProcessor`) extends `@nestjs/bullmq`'s `WorkerHost`, which implements `onModuleDestroy` internally (closes the underlying BullMQ `Worker`, letting in-flight jobs finish) — no application code needed for this. |
| Redis reconnect strategy is appropriate | ✅ Already correct | `getRedisConnectionOptions()` (`redis-connection.config.ts`): exponential backoff capped at 2s, `reconnectOnError` on `READONLY` (originally written for ElastiCache failover, but the mechanism is generic ioredis behavior that applies equally to Upstash), `maxRetriesPerRequest: null` (BullMQ's hard requirement). |

## Startup sequence

The requested order — Database → Redis → BullMQ → Application → Ready — holds today without any
new code:

1. **Database**: `PrismaModule` is imported early in `AppModule`/`WorkerModule`; `PrismaService`'s
   `onModuleInit()` calls `await this.$connect()`, and Nest's `NestFactory.create()` awaits every
   module's `onModuleInit` before returning — so the app cannot reach `app.listen()` with an
   unconnected/misconfigured database. **Verified for real this phase**: with a database the app
   couldn't authenticate against, the process crashed immediately and loudly (Prisma's
   `P1000: Authentication failed` error, non-zero exit) rather than hanging or serving in a broken
   state — exactly the fail-fast behavior a Render deploy needs to surface a bad `DATABASE_URL`
   quickly.
2. **Redis**: `RedisService`'s constructor creates the ioredis client immediately
   (`redis.service.ts:12`); ioredis's default offline queue means any command issued before the
   TCP handshake completes just queues in memory rather than failing, so this doesn't need to
   block bootstrap.
3. **BullMQ**: `BullModule.forRoot` (`queues.module.ts`) shares the same connection options; same
   offline-queue behavior applies to job enqueue/processing.
4. **Application / Ready**: `app.listen()` runs only after every module's `onModuleInit` has
   resolved — by this point Database is confirmed connected; Redis/BullMQ connections are
   in-flight-safe. `/api/v1/health/ready` is what an operator (or Render, if pointed at it) should
   use to confirm all four dependencies — database, Redis, queues, storage — are actually
   reachable before considering the deploy live.

No artificial "wait for X before starting Y" gate was added — Nest's own module-init ordering
already provides the guarantee that matters (Database confirmed before `listen()`), and
introducing an extra blocking handshake for Redis/BullMQ would only slow cold starts without
removing any real risk, given ioredis's offline queueing.

## Health checks

`/api/v1/health` (general status), `/api/v1/health/live` (liveness — process-only, no dependency
checks), `/api/v1/health/ready` (readiness — 503 if any dependency is down) all exist unchanged in
routing; `/api/v1/health`'s `status` field is the one fix this phase made (see above).

**Render's Health Check Path should be `/api/v1/health/ready`**, not `/api/v1/health` or
`/api/v1/health/live` — Render's health check gates whether a new deploy is promoted to receive
traffic, which is exactly what a *readiness* check (not a liveness check) is for. `/health/ready`
already returns HTTP 503 with a per-dependency breakdown (`database`, `redis`, `queues`, `storage`)
when anything is down, and 200 only when every dependency is reachable — Render will correctly
hold traffic back from an instance that isn't fully ready, and correctly restart one that stays
unready past its configured grace period.

The Background Worker service should **not** use a Render health check path at all — Render
Background Workers aren't routed traffic and don't support the same HTTP health-check gate as Web
Services; the worker's own `/api/v1/health/*` endpoints exist for manual/ops use only (they aren't
Render's route-gating mechanism for a non-Web-Service type).

## Docker

Reviewed the existing `Dockerfile` — **no changes made**, per "optimize only if necessary, do not
redesign." It already satisfies everything Render needs from a container: non-root user, `tini`
as PID 1 (correct SIGTERM forwarding — matters as much on Render as on Kubernetes), a
production-only pruned `node_modules` via `pnpm deploy --prod`, and a `HEALTHCHECK` instruction
(Docker-level, informational on Render — Render's own health check path setting is what actually
gates traffic, but this doesn't conflict with it). Render can either build directly from this
`Dockerfile` (build context must be the repo root, matching the existing
`docker build -f Dockerfile -t ... .` instruction) or pull a pre-built image — either works
unchanged.

## Worker: deploying independently as a Render Background Worker

The `worker-main.ts` entrypoint (Phase 9) already exists specifically so the worker can run as an
independent process sharing nothing but Postgres/Redis with `api-gateway` — no code change was
needed for Render specifically. To deploy it as a Render Background Worker:

- **Same image/repo** as the Web Service, different **Start Command**:
  `node dist/src/worker-main.js` (or `pnpm start:worker`, added this phase).
- **Same environment variables** as the Web Service (both need `DATABASE_URL`, `REDIS_*`, JWT
  secrets, etc. — the worker's `WorkerModule` imports `PrismaModule`/`RedisModule`/`QueuesModule`/
  `RealtimeModule` for the same reasons documented in `worker.module.ts`).
- **No Render health check** (Background Worker services don't support the Web Service health
  check gate) — rely on Render's own process-alive restart behavior plus manual `/api/v1/health`
  checks if needed.
- **No public URL / no inbound port** needed, even though the process does bind `PORT` internally
  (for its own health endpoints) — this is harmless; nothing needs to reach it from outside.

## Required environment variables

Every variable `.env.qa.example` documents applies identically to Render (Render's own dashboard
env var UI replaces `.env` — the file is the reference list, not something Render reads directly).
Both the Web Service and Background Worker need the full set, since both processes load the same
`ConfigModule`/`WorkerModule`/`AppModule` configuration:

| Variable | Required for | Render source |
|---|---|---|
| `NODE_ENV` | both | literal `staging` (or `production` once a real Render production tier exists) |
| `PORT` | both (Web Service only needs Render's own injected value; worker can default) | Render auto-injects for Web Services |
| `DATABASE_URL` | both | Neon connection string (`?sslmode=require`) |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_TLS` / `REDIS_AUTH_TOKEN` | both | Upstash endpoint/port/password, `REDIS_TLS=true` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | both | generated random values |
| `KAFKA_BROKER` | both (required by schema, unused by any code — see `.env.qa.example`) | any placeholder value |
| `STORAGE_DRIVER` | both | `cloudinary` |
| `CLOUDINARY_CLOUD_NAME` / `API_KEY` / `API_SECRET` | both | QA Cloudinary account |
| `RAZORPAY_KEY_ID` / `KEY_SECRET` / `WEBHOOK_SECRET` | both (Razorpay client is constructed unconditionally at boot — see `docker-compose.yml`'s own comment on this) | Razorpay test keys |
| `CUSTOMER_APP_URL` / `RESTAURANT_APP_URL` / `ADMIN_APP_URL` / `DELIVERY_APP_URL` | Web Service (CORS allowlist + email links) | QA Vercel frontend URLs |
| `SMTP_HOST` / `PORT` / `USER` / `PASS` / `FROM` | Web Service (password reset) | any SMTP provider |
| `LOG_TO_FILE` / `LOG_LEVEL` | both | `false` / `info` (Render captures stdout — file logging is pointless and would be lost on redeploy anyway) |
| `APP_NAME` | both | `api-gateway` for the Web Service, `worker` for the Background Worker (differentiates the two in any shared metrics view) |
| `SHUTDOWN_TIMEOUT_MS` | both | `10000` — keep below whatever grace period Render allows before SIGKILL |

## Required Render services

### Web Service (`api-gateway`)
- **Build Command**: none needed if deploying via Docker (`Dockerfile` at repo root); if deploying
  from source without Docker, `pnpm install --frozen-lockfile && pnpm --filter api-gateway exec prisma generate && pnpm --filter api-gateway run build`.
- **Start Command**: `node dist/src/main.js` (or `pnpm start:prod`).
- **Health Check Path**: `/api/v1/health/ready`.
- **Port**: whatever Render injects via `PORT` (already handled — no hardcoding in app code).

### Background Worker (`worker`)
- **Build Command**: identical to the Web Service (same image/build).
- **Start Command**: `node dist/src/worker-main.js` (or `pnpm start:worker`).
- **No Health Check Path** (not supported for this Render service type).
- **No public port** needed.

## Deployment flow

1. Provision Neon (Postgres) and Upstash (Redis) instances for QA.
2. Run `prisma migrate deploy` against the Neon database — either as a Render **Job**/one-off
   command (`pnpm --filter api-gateway exec prisma migrate deploy`, needs the same `build`-stage
   `node_modules` the Kubernetes `migrate` Docker stage already reuses) or manually before first
   deploy. This mirrors the `migrate-job.yaml` PreSync-hook role in the Kubernetes/ArgoCD path,
   just without ArgoCD.
3. Deploy the Web Service (`api-gateway`) with the environment variables above.
4. Deploy the Background Worker (`worker`) with the same environment variables, different Start
   Command.
5. Confirm `/api/v1/health/ready` returns 200 on the Web Service before considering QA live.

## Render limitations found during this review

- Render Background Workers have no HTTP health-check gate — unlike Kubernetes' `readinessProbe`,
  there's no Render-native mechanism to hold the worker "unready" until its own dependencies are
  confirmed; it relies on the worker's own crash-on-bad-DB fail-fast behavior (confirmed real this
  phase) plus Render's process-restart-on-crash behavior.
- `env.validation.ts`'s Joi schema doesn't declare `REDIS_TLS`, `REDIS_AUTH_TOKEN`,
  `RAZORPAY_WEBHOOK_SECRET`, `LOG_TO_FILE`, `LOG_LEVEL`, `APP_NAME`, or `SHUTDOWN_TIMEOUT_MS` —
  a typo'd or missing value for any of these won't fail boot validation the way a missing
  `DATABASE_URL` would; it'll surface later, at first use (a webhook call, a log write). This is a
  pre-existing gap (not introduced this phase) worth closing in a future pass, since Render's
  dashboard-based env var entry has no schema of its own to catch a typo either.
- Full live validation (hitting `/health`, Swagger, and a real SIGTERM against a running instance)
  could not be completed against a real Postgres in this review's sandbox — the locally installed
  Postgres instance required credentials this session doesn't have. What *was* verified for real:
  a clean `pnpm run build`, and a full real boot log showing every module resolving in the correct
  order and the app correctly crashing fast (not hanging) on a bad database connection. This is
  disclosed rather than papered over — see the phase's final summary for the exact boundary
  between what was verified live and what was verified by code review.
