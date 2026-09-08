# Docker

## Image (root `Dockerfile`)

Build context is the repo root (pnpm workspace), not `apps/api-gateway`:

```bash
docker build -f Dockerfile -t patheya-express-api-gateway .

# with OCI label metadata (all optional):
docker build -f Dockerfile \
  --build-arg VCS_REF=$(git rev-parse --short HEAD) \
  --build-arg BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --build-arg IMAGE_VERSION=1.0.0 \
  -t patheya-express-api-gateway .
```

Two stages:

1. **build** — full pnpm workspace install (BuildKit cache-mounted pnpm store for faster repeat
   builds), `prisma generate`, `nest build`, `pnpm deploy --prod` for a production-only
   `node_modules`.
2. **runtime** — `node:24-alpine`, non-root `app` user, `tini` as PID 1 (correct `SIGTERM`
   forwarding + zombie reaping — running Node directly as PID 1 does neither), only
   `dist/`, `prisma/`, `package.json`, and prod `node_modules`. No package manager, no source.

**Writable paths**: with `readOnlyRootFilesystem: true` (set in every K8s Deployment), the only
paths the container writes to are `/app/logs` (Winston, when `LOG_TO_FILE=true`) and
`/app/uploads` (`LocalStorageProvider`, when `STORAGE_DRIVER=local`) — both pre-created with
correct ownership in the image, both mounted as `emptyDir` volumes in `k8s/base/*/deployment.yaml`.

**Healthcheck**: the image's own `HEALTHCHECK` hits `/api/v1/health/live` (process-only liveness,
not readiness — a transient DB/Redis blip shouldn't make Docker mark an otherwise-healthy container
unhealthy).

## Compose

Two files, both under `infrastructure/docker/`:

### `docker-compose.yml` — local development

```bash
cp infrastructure/docker/.env.compose.example infrastructure/docker/.env.compose   # first time only
docker compose -f infrastructure/docker/docker-compose.yml --env-file infrastructure/docker/.env.compose up
```

`--env-file` is explicit and required — this file is deliberately named `.env.compose`, not `.env`,
so nothing depends on Compose's own same-directory `.env` auto-discovery (a bare `docker compose up`
here would silently fall back to this file's own placeholder JWT-secret defaults, which
`env.validation.ts` rejects at boot in every environment, `api-gateway` included). The frontend
repo's `pnpm run setup`/`pnpm run dev` do this for you automatically — scaffolding this file,
generating real local JWT secrets, and always passing `--env-file` — see the frontend repo's
`tools/dev/DEVELOPMENT.md`'s "Local secrets (JWT)" section.

Named project `patheya-express`. Services: `postgres` and `redis` (both with real healthchecks —
`pg_isready` / `redis-cli ping`), `kafka` + `zookeeper` (present only because `KAFKA_BROKER` is a
required env var — no application code actually uses Kafka, see the audit notes in
[`README.md`](./README.md)), `api-gateway` (built from the root `Dockerfile`, waits on Postgres/
Redis healthchecks), and an opt-in `worker` service (`docker compose --profile worker up`) — the
same image, a second BullMQ-processing replica, for exercising the workers topology locally (see
[`workers.md`](./workers.md)).

`postgres` publishes on host port **15432** (container port 5432 is unchanged) — not 5432 — so it
doesn't race a native PostgreSQL install that already owns 5432 on your machine; `api-gateway`
still reaches it at `postgres:5432` on the Compose network regardless. Host-side tools (Prisma
CLI, `psql`, GUI clients) should connect via `localhost:15432`.

**Live-validated**: built the image, ran this stack, confirmed `/api/v1/health/live`,
`/health/ready`, and `/health` all return `200` with the expected fields, and that `SIGTERM`
(`docker compose stop`) triggers the graceful-shutdown log line. Along the way, two real bugs
surfaced and were fixed/documented — see `docs/infrastructure/README.md`'s audit findings
(a Joi empty-string validation crash from how optional Cloudinary vars were defaulted, and a
pre-existing Razorpay-provider bug that requires real-looking keys to boot in *any* environment).

Prefer the native workflow (faster inner loop)? Just start the dependency containers and skip
`api-gateway`:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up postgres redis kafka zookeeper
```

`scripts/start-dev.ps1` automates this native path (native Postgres + `pnpm start:dev`) and now
refuses to run if something is already listening on :3000, so it won't collide with a
Docker-managed api-gateway — but it's still the advanced/manual path, assuming a native Windows
Postgres install on the standard port 5432. That path reads `apps/api-gateway/.env` — a separate
file from this section's `infrastructure/docker/.env.compose` (see that file's own top comment) —
and since that file's checked-in default now points at Docker's port (`localhost:15432`), a
developer using this native path needs `DATABASE_URL` in their own `apps/api-gateway/.env` to say
`localhost:5432` instead. The canonical, cross-platform local setup — for a new developer, or anyone
not specifically doing native-Postgres backend work — is documented once, in the frontend repo's
`tools/dev/DEVELOPMENT.md`, which drives this file via Docker Compose exactly as shown above.

### `docker-compose.prod.yml` — production-shaped local rehearsal

**Not** a Kubernetes replacement (see `k8s/` for the real production target) — no local Postgres/
Redis containers here (external in production, never a Compose concern). Useful for smoke-testing
a built image before it goes to `k8s/`:

```bash
docker build -f Dockerfile -t patheya-express-api-gateway:local .
IMAGE_TAG=local docker compose -f infrastructure/docker/docker-compose.prod.yml up
```

Real secrets go in a gitignored `infrastructure/docker/.env.production` (see
`.env.compose.example` for the variable list) — referenced as an optional `env_file` so the
compose file itself stays valid (`docker compose config` succeeds) even before that file exists.

## Cleanup performed

A stray, byte-identical duplicate of the dev compose file previously existed at
`apps/api-gateway/src/infrastructure/docker/docker-compose.yml` — inside the TypeScript source
tree by mistake. Removed; `infrastructure/docker/docker-compose.yml` is the only canonical copy.
