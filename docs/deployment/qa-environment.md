# QA environment

## Purpose

QA is a low-cost, always-on environment for functional/manual verification of a build before it's
promoted toward AWS staging. It exists to give testers and reviewers a real, shared, publicly
reachable deployment without provisioning any AWS infrastructure for it — the platform's Terraform,
GitOps, Kubernetes, and existing GitHub Actions release/promote workflows are entirely AWS/EKS/
ArgoCD-shaped (see the Phase DEV-1 assessment) and are **not used for QA in any way**. QA is
deliberately a parallel, separate deployment path, not a new tier inside the existing AWS pipeline.

## How QA differs from staging

| | Staging | QA |
| --- | --- | --- |
| Hosting | AWS (EKS, Aurora, ElastiCache) | Render (backend), Vercel (frontend) |
| Database | Aurora Postgres (AWS-managed) | Neon Postgres |
| Redis | ElastiCache | Upstash |
| Object/media storage | Cloudinary (same driver as production) | Cloudinary (same driver, separate account/folder) |
| Deployment mechanism | GitOps PR → ArgoCD sync onto EKS | Platform-native deploy (Render/Vercel build hooks or direct Git integration) — no Kubernetes manifests involved |
| Secrets delivery | External Secrets Operator → AWS Secrets Manager | Platform-native environment variables (Render env groups, Vercel project env vars) — there is no Kubernetes API server for QA, so ESO does not apply |
| Config source | `k8s/overlays/staging` + Terraform-provisioned Secrets Manager entries | `.env.qa.example` (backend) + `environment.qa.ts` (frontend), both committed placeholders populated with real values only in each platform's own env var UI |
| Purpose | Pre-production validation against production-shaped AWS infrastructure | Fast, cheap, disposable environment for functional/manual testing earlier in the pipeline |

Staging exists to catch AWS/Kubernetes-environment-specific issues before production. QA exists to
let testers exercise a build without needing AWS access at all, and at a fraction of staging's cost.
Both environments run the same application code — nothing in `apps/api-gateway/src` or the Angular
apps changes based on which environment it's deployed to; only connection strings, credentials, and
frontend origins differ per environment.

## Cloud services QA uses

- **Render** — hosts the backend `api-gateway` service (and, optionally, a `worker` background
  service using the same image/entrypoint already built for Kubernetes).
- **Vercel** — hosts the four static Angular builds (`customer-app`, `restaurant-app`,
  `delivery-app`, `admin-app`), each built with `nx build <app> --configuration=qa`.
- **Neon** — Postgres database for QA. The backend's `DATABASE_URL` is a single connection string
  (Prisma `datasource` block), so this is a drop-in swap — no backend code change required.
- **Upstash** — Redis for QA (BullMQ queues, Socket.IO pub/sub adapter, cache). The backend's shared
  `getRedisConnectionOptions()` reads `REDIS_HOST`/`REDIS_PORT`/`REDIS_TLS`/`REDIS_AUTH_TOKEN` as
  plain ioredis options, so Upstash's TLS endpoint works as-is — no backend code change required.
- **Cloudinary** — object storage for QA, same `cloudinary` `STORAGE_DRIVER` already used by
  staging/production. A separate QA-scoped account or folder is a configuration decision, not a
  code change.

## What was added in this phase

- `apps/api-gateway/.env.qa.example` — QA env var template, structurally identical to
  `.env.example`, with QA-appropriate defaults (`STORAGE_DRIVER=cloudinary`, `REDIS_TLS=true`,
  `LOG_TO_FILE=false`) and placeholder values for Neon/Upstash/Cloudinary/SMTP/Razorpay/frontend
  URLs.
- `environment.qa.ts` in each of the four Angular apps (`customer-app`, `admin-app`,
  `delivery-app`, `restaurant-app`), mirroring each app's existing `environment.staging.ts` with
  only `apiBaseUrl`/`socketUrl`/`mediaBaseUrl` replaced by QA placeholders — every other field
  (`razorpayKeyId`, `maps.googleMapsApiKey`) is unchanged from staging.
- A `qa` build configuration (and matching `serve` configuration) added to each app's
  `project.json`, mirroring the `staging` configuration exactly except for which environment file
  it swaps in via `fileReplacements`.

Deployment steps for Render/Vercel (service creation, environment variable population, build hook
wiring) are intentionally **not** covered here — this document defines what QA is and how it
differs from staging; the how-to-deploy runbook is a separate, later piece of work.
