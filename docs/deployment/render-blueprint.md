# Render Blueprint (QA)

Explains `render.yaml` (repo root) — a Render **Blueprint** that deploys both backend services for
QA in one apply. This is Render's own native deploy mechanism (Blueprint sync / Git-connected
builds), **not GitHub Actions** — no CI/CD workflow was added or modified by this phase.

## What a Render Blueprint is

A `render.yaml` file at the repository root that Render reads when you create a "Blueprint" in its
dashboard (New → Blueprint, pointed at this repo). Render parses it and provisions/updates every
service and env var group it describes as one unit — the infrastructure-as-code equivalent, on
Render's side, of what Terraform does for AWS. It does not touch AWS, Terraform state, GitOps, or
Kubernetes in any way; it only exists inside Render's own control plane.

## Services

Both services build from the same repository and the same root `Dockerfile`, using its default
(final) stage — `runtime` — with no Docker build target override on either:

### `patheya-express-api-gateway-qa` (Web Service)
- **Build**: `dockerfilePath: ./Dockerfile`, `dockerContext: .` (repo root — required, since the
  Dockerfile's `pnpm install` needs the full workspace).
- **Start command**: none set — the image's own `CMD ["node", "dist/src/main.js"]` runs unmodified.
  This is **confirmed identical** to the `start:prod` npm script (`"start:prod": "node dist/src/main.js"`)
  — the API uses `start:prod`'s exact command, just via the Docker image's CMD rather than a
  separate Render "Start Command" field (Docker-runtime services on Render don't use that field;
  the Dockerfile's CMD is the start command).
- **Health check**: `/api/v1/health` (see below for why this path specifically, and its
  trade-off).
- **Receives inbound traffic**: yes, this is the one service with a public URL.

### `patheya-express-worker-qa` (Background Worker)
- **Build**: identical `dockerfilePath`/`dockerContext` — same image as the Web Service.
- **Start command**: `dockerCommand: node dist/src/worker-main.js` — this **overrides only the
  image's CMD** (Render's `dockerCommand` field replaces CMD, not ENTRYPOINT — `tini` stays PID 1,
  correct signal forwarding is preserved). This is the exact command the `start:worker` npm script
  runs (`"start:worker": "node dist/src/worker-main.js"`, added in Phase DEV-3) — **worker uses
  `start:worker`**, confirmed.
- **Why `node dist/src/worker-main.js` directly, not `pnpm start:worker`**: the Dockerfile's
  `runtime` stage deliberately has no `pnpm`/`corepack` installed — it's a minimal, production-only
  image (`pnpm deploy --prod`'s pruned `node_modules`, no package manager, no dev dependencies).
  Running `pnpm start:worker` inside that container would fail with "pnpm: command not found".
  Invoking the same underlying `node` command directly avoids that entirely while running the
  identical script.
- **No health check**: Render Background Workers don't support the Web Service health-check gate —
  `render.yaml` has no `healthCheckPath` on this service because the field doesn't apply to this
  service type.
- **Receives inbound traffic**: no — same image, no public URL, processes BullMQ jobs only.

## Shared build, shared image — confirmed

Both services reference the exact same `dockerfilePath: ./Dockerfile` and `dockerContext: .`, and
neither specifies a build target — meaning **both build the identical final `runtime` stage** of
the same Dockerfile. The only difference between the two running containers is the worker's
`dockerCommand` override; everything else (base image, installed dependencies, non-root user,
`tini`, file layout) is identical. Render builds each service independently (Render doesn't share a
literal image artifact between two separately-configured services the way a single `docker build`
+ two `docker run` invocations would), but the Dockerfile, build context, and resulting image
content are guaranteed identical since both point at the same file with no divergence.

## Required environment variables

All backend env vars live in one shared `envVarGroups` entry (`patheya-qa-shared`), imported by
both services via `fromGroup` — avoiding declaring the same 28 variables twice. Each service adds
exactly one variable of its own, `APP_NAME` (`api-gateway` vs. `worker`), since that's the one
value that must differ between the two.

**No secret value is stored in `render.yaml`** — every credential-shaped variable uses `sync: false`
(Render prompts for a real value in its own dashboard the first time the Blueprint is applied, and
never writes it back to this file or git); `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` use
`generateValue: true` (Render generates a random value itself — appropriate here since nothing
requires these to be human-chosen, only random and stable).

| Category | Variables | How set |
|---|---|---|
| Database | `DATABASE_URL` | `sync: false` — Neon connection string |
| Redis | `REDIS_HOST`, `REDIS_AUTH_TOKEN` | `sync: false` — Upstash endpoint/password |
| Redis | `REDIS_PORT`, `REDIS_TLS` | literal (`6379`, `true`) — structural, not secret |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | `sync: false` |
| JWT | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `generateValue: true` |
| SMTP | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | `sync: false` |
| SMTP | `SMTP_PORT`, `SMTP_FROM` | literal — structural, not secret |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | `sync: false` |
| Logging | `LOG_TO_FILE`, `LOG_LEVEL` | literal (`false`, `info`) |
| Application | `NODE_ENV`, `KAFKA_BROKER`, `STORAGE_DRIVER`, `SHUTDOWN_TIMEOUT_MS`, `APP_NAME` (per-service), `CUSTOMER_APP_URL`/`RESTAURANT_APP_URL`/`ADMIN_APP_URL`/`DELIVERY_APP_URL` | mixed — see `render.yaml`'s comments per variable |
| CORS (Swagger self-origin) | `API_PUBLIC_URL` | literal — Render's default domain is predictable from the service name, so this is set directly (`https://patheya-express-api-gateway-qa.onrender.com`), not `sync: false`; update it if a custom domain is ever attached |
| CORS (future expansion) | `EXTRA_ALLOWED_ORIGINS` | not set — optional, comma-separated, add via the dashboard only if a future need arises |
| Super Admin bootstrap | `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_FIRST_NAME`, `SUPER_ADMIN_LAST_NAME`, `SUPER_ADMIN_PHONE` | `sync: false` — all five required together for `AdminBootstrapService` to create the first SUPER_ADMIN on startup; missing any one skips bootstrap (logged, not thrown), it never blocks either service from starting |

### Super Admin bootstrap

`AdminBootstrapService` (`src/modules/admin/bootstrap/`) runs automatically on every startup of
both services via `OnApplicationBootstrap` — no API endpoint exists anywhere to create a
SUPER_ADMIN, this is the only path. It checks for an existing active `SUPER_ADMIN` inside a
`Serializable` Prisma transaction and creates one only if none exists; the same transaction's
isolation level plus `User.email`'s `@unique` constraint together prevent two SUPER_ADMINs ever
being created even if the Web Service and Worker (or several replicas of either) start
simultaneously against the same Neon database — whichever one loses the race gets a Prisma
serialization or unique-constraint error, both treated as "already exists," not a crash. Since both
services import `AuthModule` for `PasswordService` already (indirectly, via this new module),
either one bootstrapping is sufficient — in practice only one instance actually creates the row,
regardless of how many services/replicas run this code path.

`PORT` is deliberately **not set** for either service: Render auto-injects it for Web Services (the
app already reads `process.env.PORT`, `main.ts:164`), and the worker doesn't need one at all (its
own `process.env.PORT || 3000` fallback is fine since nothing external ever reaches it).

## Health check

**Updated in Phase DEV-7.5**: `healthCheckPath: /api/v1/health/ready`, not `/api/v1/health` (the
`api/v1` global prefix applies to every route except `/metrics` — `main.ts:87-89` — so the actual
registered paths are `/api/v1/health` and `/api/v1/health/ready`, never the bare `/health`/
`/health/ready`).

**Why `/health/ready` and not `/health`**: Render's health check gates whether an instance is
promoted to receive traffic — functionally closer to a Kubernetes *readiness* probe than a
liveness probe. `/api/v1/health` (used in the original Phase DEV-7 Blueprint, per that phase's
literal instruction to use `/health`) was fixed in Phase DEV-3 to report a real, non-hardcoded
`status` field (`'ok'`/`'degraded'`) reflecting database/Redis/queue state, but it **always returns
HTTP 200** regardless of that field's value — meaning it can never actually gate anything through
Render's health check, which only understands HTTP status codes, not response bodies.
`/api/v1/health/ready` returns a real 503 with a per-dependency breakdown
(`database`/`redis`/`queues`/`storage`) when anything is down, which is exactly the signal Render's
gate needs to hold back traffic from an instance that isn't actually ready, or restart one that
stays unready past its grace period. Phase DEV-7.5 revisited the DEV-7 trade-off explicitly and
resolved it in favor of `/health/ready` — this was the "one-line improvement" that phase's review
called for.

## Deployment flow

1. In the Render dashboard: **New → Blueprint**, connect this repository, Render detects
   `render.yaml` automatically.
2. Render prompts for every `sync: false` variable (Neon `DATABASE_URL`, Upstash host/token,
   Cloudinary/Razorpay/SMTP credentials, Vercel QA frontend URLs) — fill these in with real QA
   values at this step; nothing here was pre-filled or committed.
3. Render provisions both services from the one Blueprint apply — same commit, same Dockerfile,
   same env var group.
4. Migrations run automatically as part of the Web Service's deploy — `render.yaml`'s
   `preDeployCommand` (`node_modules/.bin/prisma migrate deploy`) runs before every deploy and
   blocks it on failure. No manual step required, including the first deploy against a fresh Neon
   database (see `docs/infrastructure/migrations.md`'s "The Render path" section — the earlier
   "no migration automation" limitation below is resolved, not a current gap).
5. Confirm `/api/v1/health` returns 200 on the Web Service, and check the worker's logs for
   `worker_started` (the log event `worker-main.ts` emits once its own bootstrap completes).
6. Subsequent pushes to the connected branch auto-deploy both services (`autoDeploy: true`), since
   both build from the same repo — this is Render's own native redeploy trigger, not a GitHub
   Actions workflow.

## Scaling

- `plan: starter` is set for both services — Render's lowest paid tier, appropriate for QA's
  expected traffic. Bump independently per service (the Web Service and worker have no reason to
  share an instance size) via the Render dashboard or by editing `render.yaml`'s `plan:` field.
- Both services can be scaled to multiple instances independently via Render's own scaling
  controls. If the worker is ever scaled beyond one instance, revisit Phase DEV-6's Upstash
  connection-count finding (`docs/deployment/upstash.md`) — each additional worker instance adds
  four more persistent Redis connections.
- The Web Service's `healthCheckPath` becomes more important at >1 instance, since it's what Render
  uses to decide whether a given instance receives traffic during a rolling deploy — see the Health
  check trade-off above.

## Limitations

- **Migration automation — resolved, not a current gap.** An earlier phase concluded
  `preDeployCommand` couldn't work here because it runs inside the *same* deployed image as the
  Web Service — the `runtime` stage, which deliberately excludes the Prisma CLI — and wiring it up
  would silently fail. That specific finding was correct: verified directly against Render's own
  documentation that `preDeployCommand` (and One-off Jobs) can only ever run against a service's
  own build artifact, with no way to target the Dockerfile's separate `migrate` stage instead.
  Production hardening (Stage: Render migration automation) resolved it the other direction —
  `prisma` (the CLI) moved from `devDependencies` to `dependencies` in
  `apps/api-gateway/package.json`, so it now survives `runtime`'s `pnpm deploy --prod` prune too
  (measured cost: +~70MB image size), and `render.yaml`'s `api-gateway` service now sets
  `preDeployCommand: node_modules/.bin/prisma migrate deploy`. Verified end-to-end against a real,
  deliberately-behind Postgres database, not assumed — see `docs/infrastructure/migrations.md`'s
  "The Render path" section for the full mechanism and verification evidence. The Kubernetes
  path's separately-tagged `-migrate` image is untouched and still used there; this only affects
  what ships in the Render/QA `runtime` image.
- **`/api/v1/health`'s always-200 behavior** (above) means Render's health gate is weaker than the
  Kubernetes path's `/health/ready`-based readiness probe — accepted per this phase's explicit
  instruction, documented rather than silently deviated from.
- **No live Render deployment was performed.** `render.yaml` was validated by parsing it with
  `js-yaml` and manually confirming every field (shared Dockerfile/context, correct
  worker/API commands, no secret values) — no Render account/Blueprint exists in this session. This
  is disclosed rather than implied, consistent with every other QA-tier service reviewed in this
  migration.
- **`envVarGroups` is a single flat list.** If the Web Service and worker ever need genuinely
  different values for the same conceptual variable (not just `APP_NAME`), the shared group
  approach would need splitting — not a problem today since every other variable is identical
  between the two services.
