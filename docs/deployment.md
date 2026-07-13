# Deployment

## Building the image

The Docker build context is the **repository root**, not `apps/api-gateway` — the Dockerfile
needs the pnpm workspace's lockfile and manifests to resolve dependencies.

```bash
docker build -f Dockerfile -t patheya-express-api-gateway .
```

The image is a multi-stage build:

1. **build** — installs the full pnpm workspace, runs `prisma generate`, compiles the app with
   `nest build`, then produces a production-only `node_modules` via `pnpm deploy`.
2. **runtime** — a minimal `node:24-alpine` image containing only `dist/`, `prisma/`,
   `package.json`, and the production `node_modules`. Runs as a non-root user (`app`). No
   package manager, no dev dependencies, no source code.

## Running the container

```bash
docker run -p 3000:3000 --env-file apps/api-gateway/.env patheya-express-api-gateway
```

The container needs a reachable Postgres and Redis — see `infrastructure/docker/docker-compose.yml`
for a local dependency stack (development only; it does not run the API itself).

## Required environment variables

See `apps/api-gateway/.env.example` for the full list with local-development defaults. At minimum,
production requires:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_HOST` / `REDIS_PORT` | Redis connection (BullMQ, presence, tracking cache) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Distinct, long, random secrets — rotating either invalidates all sessions |
| `KAFKA_BROKER` | Kafka broker address |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Live Razorpay credentials |
| `CUSTOMER_APP_URL` / `RESTAURANT_APP_URL` / `ADMIN_APP_URL` / `DELIVERY_APP_URL` | Deployed origin of each frontend app — the CORS allowlist |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Password-reset email delivery |

Optional, feature-gated variables (`STORAGE_DRIVER=s3` + `S3_*`, `BANK_ACCOUNT_ENCRYPTION_KEY`)
are validated at the point of use, not at boot — an environment that never exercises that feature
doesn't need them set.

## Health checks

- `GET /api/v1/health/live` — process-only liveness. Use this for the container/orchestrator
  liveness probe. Always 200 if the Node process is running.
- `GET /api/v1/health/ready` — readiness. Verifies Postgres and Redis are reachable. Use this for
  the readiness probe / load-balancer target health check, not liveness — a transient DB blip
  should not cause a healthy container to be killed and restarted.

The image's own `HEALTHCHECK` instruction targets `/health/live` for exactly this reason.

## Frontend builds

Each Angular app builds against a committed environment file selected via Angular file
replacements — no environment variables are read at container runtime for the frontends, since
they're static SPAs:

```bash
nx build customer-app --configuration=production   # apps/customer-app/src/environments/environment.prod.ts
nx build customer-app --configuration=staging       # apps/customer-app/src/environments/environment.staging.ts
nx build customer-app                                # development — environment.ts, no replacement
```

Before the first real production deploy, update every `environment.prod.ts` (customer-app,
restaurant-app, admin-app, delivery-app) with the real production API origin, and update
`customer-app`'s with the real live Razorpay key — both currently contain clearly-marked
placeholder values.

## CI/CD

No pipeline exists yet in either repository. This Dockerfile and these build configurations are
intended to be the target of one — not covered by this phase.
