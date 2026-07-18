# Patheya Express — Backend Platform

NestJS API gateway and workers for the Patheya Express food-delivery platform — REST + Socket.IO
realtime, Prisma/PostgreSQL, Redis-backed BullMQ queues, Cloudinary media storage. Deploys as a
single container image (`api-gateway`, also reused unmodified as the `workers` Deployment — see
[`docs/infrastructure/workers.md`](docs/infrastructure/workers.md)) into the shared Patheya
Express Kubernetes platform. The Angular frontend apps live in the separate `frontend` repository;
all AWS infrastructure lives in `patheya-express-terraform`; all cluster state is reconciled from
`patheya-express-gitops`.

## Prerequisites

- Node.js 24.x
- pnpm (version pinned in `devEngines.packageManager`; `corepack enable` picks it up automatically)
- Docker (for the local Postgres/Redis/Kafka stack)

## Local setup

```bash
pnpm install
cp apps/api-gateway/.env.example apps/api-gateway/.env   # fill in local values
docker compose -f infrastructure/docker/docker-compose.yml up -d   # Postgres, Redis, Kafka (unused)
pnpm --filter api-gateway run db:migrate
pnpm --filter api-gateway run start:dev
```

## Running tests

```bash
pnpm --filter api-gateway run lint
pnpm --filter api-gateway run typecheck
pnpm --filter api-gateway run test
pnpm --filter api-gateway run test:e2e
```

## Deploying

No manual deploy path — GitHub Actions builds, scans, signs, and publishes the image on every
merge to `main`; `patheya-express-gitops` is the only path to a running cluster. See
[`docs/deployment.md`](docs/deployment.md) for the build/image contract and
[`docs/ci-cd/ci-cd-guide.md`](docs/ci-cd/ci-cd-guide.md) for the full pipeline.

## Further reading

- [`docs/architecture/platform-standards.md`](docs/architecture/platform-standards.md) — naming,
  process, and repository conventions (how)
- [`docs/architecture/cloud-architecture-blueprint.md`](docs/architecture/cloud-architecture-blueprint.md)
  — the platform this repository deploys onto (what)
