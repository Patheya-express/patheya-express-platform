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
cp infrastructure/docker/.env.compose.example infrastructure/docker/.env   # first time only
docker compose -f infrastructure/docker/docker-compose.yml up
```

Named project `patheya-express`. Services: `postgres` and `redis` (both with real healthchecks —
`pg_isready` / `redis-cli ping`), `kafka` + `zookeeper` (present only because `KAFKA_BROKER` is a
required env var — no application code actually uses Kafka, see the audit notes in
[`README.md`](./README.md)), `api-gateway` (built from the root `Dockerfile`, waits on Postgres/
Redis healthchecks), and an opt-in `worker` service (`docker compose --profile worker up`) — the
same image, a second BullMQ-processing replica, for exercising the workers topology locally (see
[`workers.md`](./workers.md)).

**Live-validated**: built the image, ran this stack, confirmed `/api/v1/health/live`,
`/health/ready`, and `/health` all return `200` with the expected fields, and that `SIGTERM`
(`docker compose stop`) triggers the graceful-shutdown log line. Along the way, two real bugs
surfaced and were fixed/documented — see `docs/infrastructure/README.md`'s audit findings
(a Joi empty-string validation crash from how optional Cloudinary vars were defaulted, and a
pre-existing Razorpay-provider bug that requires real-looking keys to boot in *any* environment).

Prefer the native workflow (`scripts/start-dev.ps1`, faster inner loop)? Just start the
dependency containers and skip `api-gateway`:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up postgres redis kafka zookeeper
```

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
