# QA cloud platform — provisioning guide

A complete, from-scratch provisioning guide for the QA environment across all five cloud
services this migration targets: **Neon, Upstash, Render, Vercel, Cloudinary**. Synthesizes the
compatibility reviews already done in `neon.md` (DEV-5), `upstash.md` (DEV-6),
`render-blueprint.md` (DEV-7), and `qa-release-checklist.md` (DEV-7.5), plus the frontend's
`vercel.md` (DEV-4), into one ordered, standalone reference.

**This document does not deploy or automate anything** — no account was created, no resource was
provisioned, no API call was made. It is a guide a human follows manually. Free-tier limits and
exact regional availability are approximate/typical figures based on how these providers have
generally structured their plans — **confirm the current numbers on each provider's own pricing
page at provisioning time**, since these change over time and no live account exists in this
session to verify them freshly.

## Provisioning order

Follow `qa-release-checklist.md`'s dependency order — provision data stores before compute, compute
before frontend:

```
1. Neon (database)        — no dependency on anything else
2. Upstash (Redis)        — no dependency on anything else
3. Cloudinary (storage)   — no dependency on anything else
4. Render (API + Worker)  — needs Neon + Upstash + Cloudinary connection details first
5. Vercel (4 frontend apps) — needs Render's real API URL first
```

---

## 1. Neon PostgreSQL

**Purpose**: QA's Postgres database, replacing Aurora for this environment only
(`docs/deployment/neon.md`).

| | |
|---|---|
| Free tier limits (typical, confirm current values) | One project, a storage cap in the low single-digit GB, autosuspend after a short idle period (Phase DEV-5 flagged this cold-start behavior explicitly) |
| Recommended region | Pick one region and reuse it for Render too (minimizes cross-service latency) — see § Naming Standards / Regions below |
| Required settings | `sslmode=require` on every connection string (mandatory, not optional — Phase DEV-5) |
| Naming convention | See § Naming Standards |
| Environment variables | `DATABASE_URL` only (Phase DEV-5's core conclusion: nothing else is required) |
| Security recommendations | Use Neon's own role/password (not a shared personal login); rotate the password if it's ever pasted anywhere other than Render's `sync: false` prompt; never commit a real connection string (already gitignored at the `.env` level, `.env.qa.example` stays a placeholder) |
| Backup considerations | Neon takes automatic point-in-time-recovery snapshots on paid tiers; QA data is inherently disposable (seed data, test orders) — do not treat QA's Neon branch as a source of truth worth backing up separately; if QA data is ever lost, re-seed via `pnpm db:seed` rather than restoring |

### Project
Create one Neon project for QA. Do not reuse or branch from any project that might later back a
real staging/production Postgres — QA's Neon project should be entirely separate from Aurora,
consistent with "AWS Production (Aurora) must remain completely unchanged" (Phase DEV-5).

### Database
Create one database inside the project: **`patheya_express_qa`** (matches the value already used
in `.env.qa.example`'s `DATABASE_URL` placeholder — reuse it exactly, don't invent a new name).

### Branch strategy
Neon's branching feature (copy-on-write database branches) is a genuine differentiator worth using
deliberately for QA:
- Keep a **`main`** branch as QA's actual running database (what Render's `DATABASE_URL` points
  at).
- Create a **short-lived branch per test cycle** (e.g. before a risky manual test, or before
  re-running the full smoke-test suite from `qa-release-checklist.md`) when you want a disposable,
  resettable copy rather than mutating `main` directly — delete the branch afterward.
- Do **not** treat Neon branches as a substitute for `prisma migrate deploy`'s own migration
  history (Phase DEV-5's migration-strategy recommendation is unaffected by branching) — branches
  are for isolating *data* changes during manual testing, not for managing *schema* changes.

### Connection string
```
postgresql://<role>:<password>@<endpoint-id>.<region>.aws.neon.tech/patheya_express_qa?sslmode=require
```
This is the exact value that goes into Render's `DATABASE_URL` `sync: false` prompt
(`render.yaml`) — nowhere else.

### SSL
`sslmode=require` is mandatory and already the only SSL-related thing this connection string needs
(Phase DEV-5 confirmed zero Prisma/application code changes are required for TLS). Neon also
supports `channel_binding=require` for stricter verification — optional, at the operator's
discretion.

---

## 2. Upstash Redis

**Purpose**: QA's Redis, replacing ElastiCache for this environment only
(`docs/deployment/upstash.md`) — backs `RedisService`, all six BullMQ queues, and the Socket.IO
Redis adapter's pub/sub pair.

| | |
|---|---|
| Free tier limits (typical, confirm current values) | A daily command-count cap and a capped number of concurrent connections — Phase DEV-6 already flagged that this process alone opens **four** persistent connections per running instance (`RedisService` + shared BullMQ + pub/sub pair), so check the free tier's connection cap against `api-gateway` + `worker` both running simultaneously (8 connections minimum) before assuming free tier is sufficient |
| Recommended region | Same region as Render, for the same latency reason as Neon |
| Required settings | TLS mandatory on Upstash's standard endpoint (matches `REDIS_TLS=true`, already set) |
| Naming convention | See § Naming Standards |
| Environment variables | `REDIS_HOST`, `REDIS_PORT`, `REDIS_TLS`, `REDIS_AUTH_TOKEN` (Phase DEV-6's confirmed complete list) |
| Security recommendations | Use the database's own generated password as `REDIS_AUTH_TOKEN`, delivered only via Render's `sync: false` prompt; rotate it if ever exposed; restrict to TLS-only endpoint (no plaintext fallback) |
| Backup considerations | Redis here holds only ephemeral/derived state (queued jobs, cache, pub/sub) — nothing in `apps/api-gateway/src` treats Redis as a system of record. No backup strategy is needed; a flushed QA Redis instance self-heals (queues empty, cache repopulates) with no data-loss concern beyond in-flight jobs |

### Redis database
Create one Upstash Redis database for QA — **not** an Upstash "Vector" or "QStash" product, the
plain Redis database offering with a standard TCP endpoint.

### TLS
Confirm the database's connection details expose a `rediss://`-style (TLS) endpoint — this is
Upstash's default for its cloud offering, matching `REDIS_TLS=true` with no code change (Phase
DEV-6).

### Connection limits
Before finalizing a plan, check the exact concurrent-connection cap against this application's
actual usage: 4 connections × 2 services (`api-gateway` + `worker`) = **8 baseline**, growing by 4
for every additional replica of either service (Phase DEV-6's scaling note, reiterated in
`render-blueprint.md`'s Scaling section). QA is expected to run one instance of each service, so 8
is the number to check against whichever plan is chosen.

### Recommended plan
Whichever Upstash tier comfortably covers the 8-connection baseline above with headroom — exact
tier/pricing should be checked live against Upstash's current plan table, since this wasn't (and
couldn't be) verified against a real account in this review.

---

## 3. Render

**Purpose**: hosts both backend services — `api-gateway` (Web Service) and `worker` (Background
Worker) — from one Blueprint (`render.yaml`, `docs/deployment/render-blueprint.md`).

| | |
|---|---|
| Free tier limits (typical, confirm current values) | Render's free instance type (where offered) typically spins down after a period of inactivity, causing a cold-start delay on the next request — acceptable for QA's expected low, bursty traffic, but Background Workers have historically required at least a paid plan (no free tier for that service type) — confirm current offering before assuming cost |
| Recommended region | Same region as Neon/Upstash where available |
| Required settings | `runtime: docker`, `dockerfilePath: ./Dockerfile`, `dockerContext: .` for both services (already in `render.yaml`) |
| Naming convention | See § Naming Standards |
| Environment variables | The full 28-variable `patheya-qa-shared` group in `render.yaml`, categorized in `render-blueprint.md`'s table (Database/Redis/Cloudinary/JWT/SMTP/Razorpay/Logging/Application) |
| Security recommendations | Every credential-shaped variable uses `sync: false` (never committed); `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` use `generateValue: true` (Render-generated, never human-chosen or reused from another environment) |
| Backup considerations | Render services themselves are stateless (the app writes nothing durable to local disk — `uploads`/`logs` are Cloudinary/stdout-routed); nothing on Render itself needs backing up. State lives in Neon/Upstash/Cloudinary, each already covered above |

### Web Service
`patheya-express-api-gateway-qa` — serves HTTP/WebSocket traffic, the only one of the two with a
public URL.

### Background Worker
`patheya-express-worker-qa` — same image, `dockerCommand: node dist/src/worker-main.js`, no public
URL, no health check field (Render Background Workers don't support one).

### Health check
`/api/v1/health/ready` (Phase DEV-7.5's decision, superseding DEV-7's original `/api/v1/health`) —
the only endpoint that returns a real, non-200 status when a dependency is actually down, which is
what Render's health-check gate needs to hold back traffic from a not-yet-ready instance.

### Build command
None set explicitly — Render builds directly from `dockerfilePath: ./Dockerfile` with
`dockerContext: .` (repo root). No separate "Build Command" field applies when `runtime: docker` is
used; the Dockerfile's own build stages are the build process.

### Start command
- Web Service: none set — the image's own `CMD ["node", "dist/src/main.js"]` runs unmodified,
  confirmed identical to `start:prod`.
- Background Worker: `dockerCommand: node dist/src/worker-main.js`, confirmed identical to
  `start:worker`, invoked directly (not via `pnpm start:worker`) since the runtime image has no
  package manager installed.

### Scaling
Both services scale independently via Render's own instance-count/plan controls. If the Worker is
ever scaled beyond one instance, re-check Upstash's connection limit (§ 2, above) before doing so.

---

## 4. Vercel

**Purpose**: hosts the four static Angular apps (`docs/deployment/vercel.md`, frontend repo).

| | |
|---|---|
| Free tier limits (typical, confirm current values) | Vercel's Hobby plan is typically generous enough for QA-scale static-site traffic (bandwidth/build-minute caps exist but are high relative to a QA testing audience) |
| Recommended region | Not applicable in the same sense as the others — Vercel serves static assets from its global edge network regardless of which region you provision in; no single-region choice materially affects this pure-static deployment |
| Required settings | Root Directory = repo root (required for Nx workspace resolution) for all four projects; `vercel.json`'s SPA rewrite (`docs/deployment/vercel.md`) applies to all four automatically since they share the same repo root |
| Naming convention | See § Naming Standards |
| Environment variables | None at the Vercel platform level — `apiBaseUrl`/`socketUrl`/`mediaBaseUrl` are baked in at build time via `environment.qa.ts` (Phase DEV-2/DEV-4's confirmed finding: no runtime env-injection mechanism exists), so there is nothing to set in Vercel's own environment-variable UI for these apps today |
| Security recommendations | Nothing secret is ever passed to these builds (no API keys live in `environment.qa.ts` beyond the already-public Razorpay client key and a since-blank Google Maps key) — no Vercel secret-management feature is needed for this phase's scope |
| Backup considerations | Static builds are fully reproducible from source + `environment.qa.ts` — nothing on Vercel itself needs backing up; redeploying from the same commit reproduces the exact same output |

### Project names
Four separate Vercel projects, one per app:
- **`patheya-customer-qa`**
- **`patheya-restaurant-qa`**
- **`patheya-delivery-qa`**
- **`patheya-admin-qa`**

(Exact names already established in `vercel.md`'s architecture diagram — reuse them, don't rename.)

### Domains
Vercel assigns each project a default `<project-name>.vercel.app` domain automatically — sufficient
for QA (no custom domain purchase/DNS work needed for a testing tier). If a custom QA subdomain is
ever wanted later (e.g. `qa.customer.patheyaexpress.com`), that's a DNS/CNAME decision made at that
time, out of scope here.

### Build commands
- `patheya-customer-qa`: `npx nx build customer-app --configuration=qa`
- `patheya-restaurant-qa`: `npx nx build restaurant-app --configuration=qa`
- `patheya-delivery-qa`: `npx nx build delivery-app --configuration=qa`
- `patheya-admin-qa`: `npx nx build admin-app --configuration=qa`

### Output directory
**`dist/apps/<app-name>/browser`** for every project — confirmed by inspecting real build output in
Phase DEV-4, not the parent `dist/apps/<app-name>` (which also holds non-servable build artifacts).

### Environment variables
None required at the Vercel project-settings level (see table above) — update
`apps/<app>/src/environments/environment.qa.ts`'s `apiBaseUrl`/`socketUrl`/`mediaBaseUrl` in source
once Render's real QA API URL exists, commit, then let Vercel rebuild from that commit.

---

## 5. Cloudinary

**Purpose**: QA's media storage (`STORAGE_DRIVER=cloudinary`) — restaurant/menu images, profile
photos, delivery-partner documents, backed by `CloudinaryStorageProvider` (Phase DEV-1's audit
confirmed this is already the intended non-local driver, fully independent of AWS/S3).

| | |
|---|---|
| Free tier limits (typical, confirm current values) | Cloudinary's free tier is typically expressed as a monthly "credits" budget covering combined storage + bandwidth + transformations — generous enough for QA-scale manual testing, but re-check current terms before relying on it long-term |
| Recommended region | Cloudinary doesn't expose a region choice the way database/cache providers do — it's a global CDN-backed service; no regional decision needed here |
| Required settings | `STORAGE_DRIVER=cloudinary` plus the three credential variables below (already the complete list, Phase DEV-1) |
| Naming convention | See § Naming Standards |
| Environment variables | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| Security recommendations | Use a QA-specific Cloudinary account or, at minimum, a QA-specific API key pair scoped separately from any real production Cloudinary account — never point QA at a production Cloudinary account, since QA test uploads (including ones testers might upload with placeholder/dummy content) should never mix with real user media |
| Backup considerations | QA media uploads are disposable test data (Phase DEV-1's storage review) — no backup strategy needed; if the QA Cloudinary account is ever reset, testers simply re-upload during their next test pass |

### Folder structure
Organize QA uploads under one top-level prefix so they're trivially distinguishable from anything
else that might ever share the account, and mirror the entity types the app already uploads for:

```
qa/
  restaurants/<restaurantId>/logo
  restaurants/<restaurantId>/banner
  menu-items/<menuItemId>/
  delivery-partners/<partnerId>/documents/
  users/<userId>/profile/
```

(`CloudinaryStorageProvider` builds its own upload paths at call time — this structure is a
*recommendation* for how to organize the QA account for manual browsing/cleanup, not something the
application code currently enforces or needs configured.)

### Upload presets
Not required by the current code (`CloudinaryStorageProvider` uploads directly via the Admin
API using the account's API key/secret, not a named unsigned upload preset) — no preset needs
creating for this application to function. If a preset is ever wanted for manual/ad hoc testing
outside the app itself, name it `qa-manual-upload` to keep it clearly distinct from anything
programmatic.

### Recommended organization
One QA-dedicated Cloudinary account (or, at minimum, sub-account/API-key scoping if the platform
supports it) — never share credentials with a real production Cloudinary account, consistent with
the security recommendation above.

---

## Naming standards

One consistent `<product>-<component>-<environment>` pattern across every provider, reusing exactly
what earlier phases already established rather than introducing a new scheme:

| Resource type | Name | Established in |
|---|---|---|
| Render Web Service | `patheya-express-api-gateway-qa` | `render.yaml` (Phase DEV-7) |
| Render Background Worker | `patheya-express-worker-qa` | `render.yaml` (Phase DEV-7) |
| Vercel project — customer | `patheya-customer-qa` | `vercel.md` (Phase DEV-4) |
| Vercel project — restaurant | `patheya-restaurant-qa` | `vercel.md` (Phase DEV-4) |
| Vercel project — delivery | `patheya-delivery-qa` | `vercel.md` (Phase DEV-4) |
| Vercel project — admin | `patheya-admin-qa` | `vercel.md` (Phase DEV-4) |
| Neon database | `patheya_express_qa` | `.env.qa.example` (Phase DEV-2) — snake_case since it's a literal SQL identifier, unlike every other resource name above |
| Neon project | `patheya-express-qa` | New, this phase — follows the same pattern as every other provider |
| Upstash Redis database | `patheya-express-qa` | New, this phase |
| Cloudinary folder prefix | `qa/` | New, this phase (§ 5, above) |

**Pattern**: `patheya-<app-or-component>-qa` (kebab-case) for every platform-level resource name a
provider's dashboard displays; `patheya_express_qa` (snake_case) is the one deliberate exception,
because it's a literal Postgres database identifier, not a dashboard label.

### Regions

Recommend picking **one** region and using it consistently across Render, Neon, and Upstash
wherever each provider's own region list allows it — minimizing cross-service latency between the
API and its two data stores matters far more for perceived QA responsiveness than which specific
region is chosen. Vercel's global edge network makes its own region choice not directly comparable
to the other three. **Exact regional availability was not verified against live provider region
lists in this review** — confirm each provider's currently supported regions at provisioning time
and pick the closest mutually-supported one to where testers actually are, rather than assuming a
specific region name here that could be stale or unavailable by the time this is acted on.

---

## What this document does not do

- Does not create any account, project, service, or resource on any of the five providers.
- Does not run `render.yaml` against a real Render account, or trigger any Vercel/Neon/Upstash/
  Cloudinary API call.
- Does not change any application source code, Terraform, GitOps, Kubernetes manifest, or existing
  GitHub Actions workflow.
- Does not replace `qa-release-checklist.md`'s deployment-order/failure-recovery/rollback content —
  this document is what to provision; that one is how to deploy and operate once provisioned.
