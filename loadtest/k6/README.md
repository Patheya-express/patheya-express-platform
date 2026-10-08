# Patheya Express — API capacity test (k6)

Measures how much read traffic the current production topology sustains, and which component
gives out first, so ECS autoscaling can be set from evidence instead of guesses.

> **Status: prepared, not executed.** Nothing in this directory has been run against production.
> Follow [the test plan](#test-plan-production) in order; every step marked **APPROVAL** needs an
> explicit go-ahead first.

```
loadtest/k6/
  main.js                       entry point: options, setup() discovery, per-stage summary
  lib/config.js                 profiles, HARD limits, abort thresholds, production gate
  lib/api.js                    HTTP helper (route tags, envelope checks, 429 tracking), login
  lib/journeys.js               weighted read-only user journeys (real routes only)
  scripts/k6.sh                 runs k6 in Docker (grafana/k6:2.3.0) — no global install
  scripts/preflight.sh          read-only go/no-go gate; writes results/preflight.json
  scripts/watchdog.sh           server-side abort guard (CloudWatch + readiness → stops k6)
  scripts/rate-limit-status.sh  read-only: which RATE_LIMIT_MAX the running API revision has
  scripts/catalogue-task.sh     runs the LOADTEST_ catalogue CLI as a one-off ECS task
  results/                      run output (git-ignored)

apps/api-gateway/scripts/loadtest-catalogue/
  plan.ts / cli.ts / plan.test.ts   deterministic LOADTEST_ dataset: plan | status | seed | cleanup
```

---

## Prerequisites (state as prepared)

| # | Item | State |
|---|---|---|
| 1 | Aurora writer `db.r6g.large`, 1 writer / 0 readers | Done (reported healthy). `preflight.sh` re-verifies on every run |
| 2 | Unauthenticated `/system/*`, `/metrics`, `/api/docs` | Fixed in code ([Security changes](#security-changes-in-this-release)), **not yet deployed** |
| 3 | App rate limit 100/min/IP blocks a single load generator at ~3 VUs | `RATE_LIMIT_MAX` is now configurable, default still 100. **Not yet deployed**; the temporary override needs a Terraform change ([lifecycle](#rate-limit-lifecycle)) |
| 4 | Empty catalogue | `LOADTEST_` dataset + CLI ready ([Load-test data](#load-test-data-loadtest_)). **Not seeded** |
| 5 | CUSTOMER test account | Procedure ready ([Test account](#load-test-customer-account)). **Not created** |
| 6 | k6 | Runs from Docker via `scripts/k6.sh`; nothing to install |

---

## Security changes in this release

| Surface | Before | After |
|---|---|---|
| `GET /api/v1/system/{redis-test,queue-test,queue-health,presence-test/:id}` | Anonymous; wrote a Redis key / enqueued a BullMQ job | **Not registered in production** (`systemModulesFor`). Elsewhere: JWT + ADMIN/SUPER_ADMIN. Nothing in the platform used them |
| `GET /metrics` | Anonymous, reachable through the ALB | Production: in-task loopback only (ECS Exec `curl localhost:3000/metrics`) or `Authorization: Bearer $METRICS_AUTH_TOKEN` if that is configured; **404 for everyone else**. Keys on the TCP peer, not `X-Forwarded-For`. Non-production unchanged. No scraper exists in ECS today |
| `/api/docs`, `/api/docs-json`, `/api/docs-yaml` | Mounted everywhere | **Off in production by default**; `SWAGGER_ENABLED=true` re-enables. On by default in dev/staging/QA. The frontend SDK is generated from `localhost:3000/api/docs-json` and CI exports OpenAPI in-process with `NODE_ENV=development`, so nothing depends on the production docs |

`scripts/smoke-test.ts` now reports `/metrics` as *skipped (protected)* in production unless
`SMOKE_TEST_METRICS_TOKEN` is provided.

---

## Rate-limit lifecycle

The global limiter (`ThrottlerGuard`, 60 s window, keyed on the client IP) reads
`RATE_LIMIT_MAX` (`apps/api-gateway/src/config/rate-limit.config.ts`):

- unset or blank → **100** (normal production; unchanged behaviour);
- integer 1–100 000 → that limit, **still enforced** (an override is not a bypass, and per-route
  limits like login 5/min are untouched);
- anything else → the app refuses to boot, so the ECS deployment circuit breaker keeps the
  previous revision.

Each boot logs the active value: `Rate limit: 100 requests / 60s per client IP (default)`, or a
**WARN** line `... NON-DEFAULT (RATE_LIMIT_MAX override, default 100)`.
`scripts/rate-limit-status.sh` prints what the running revision has:
`NORMAL` or `LOAD-TEST OVERRIDE`.

```
NORMAL PRODUCTION   RATE_LIMIT_MAX unset (= 100)
LOAD TEST           RATE_LIMIT_MAX=60000      (≥ 800 req/s ceiling × 60 s from one generator IP)
AFTER TEST          RATE_LIMIT_MAX unset (= 100) — verified with rate-limit-status.sh --expect=default
```

**How the value reaches ECS.** Terraform owns every task-definition setting
(`environments/production/app`, `local.app_environment`). `backend-deploy-ecs.yml` copies the
latest ACTIVE revision and swaps only the image. So each change is:

1. **(APPROVAL, Terraform, separate change.)** Add `RATE_LIMIT_MAX` to `app_environment`, driven
   by a committed variable (for example `api_rate_limit_max`, default `100`, with a validation
   block, set in its own `*.auto.tfvars` like `operating-mode.auto.tfvars`). The active mode is then
   a reviewed Git change. `terraform apply` registers a new task-definition revision.
2. **(APPROVAL)** Run `backend-deploy-ecs.yml` with the **currently deployed** image tag. It
   renders a revision from the new ACTIVE one and rolls the service.
3. Verify with `./scripts/rate-limit-status.sh` and the boot log line.

The revert after the test is the same two steps with the variable back at `100` (or removed),
then `rate-limit-status.sh --expect=default`. The elevated value is never left configured.
Nothing in this repository change touches Terraform.

---

## Load-test data (`LOADTEST_`)

`apps/api-gateway/scripts/loadtest-catalogue/` defines a small, deterministic, clearly synthetic
catalogue. `plan` prints every row ID before anything is written; IDs are name-based UUIDs, so
they are identical on every run.

| Rows | Count | Marking |
|---|---|---|
| Owner user (`RESTAURANT_OWNER`) | 1 | `LOADTEST_Owner`, `loadtest-owner@loadtest.invalid`, **no password** (cannot log in) |
| Cuisines | 8 | `LOADTEST_North Indian`, … |
| Restaurants (APPROVED, active, 6 featured) | 60 | `LOADTEST_Restaurant_001…060`, slug `loadtest-restaurant-…`, description "Synthetic load-test record — not a real business" |
| Branches (primary; 5 cities, lat/lng near centre) | 60 | `LOADTEST_Branch_…`, address "LOADTEST synthetic address — not a real location", postal code `000000` |
| Operating hours (00:00–23:59, 7 days) | 420 | — |
| Menu categories / items | 240 / 1 920 | `LOADTEST_Starters`, `LOADTEST_Chicken Biryani`, … (realistic dish words so search hits) |
| Restaurant offers | 20 | `LOADTEST_10% off (synthetic)` |

Not created: reviews, orders, payments, coupons, staff, documents, bank or tax data. Ratings
are set directly on the restaurant rows. No existing row is updated, and seeding refuses to run
if any `LOADTEST_`/`loadtest-` row already exists.

**Seed** (one transaction; prints a single `LOADTEST_MANIFEST {...}` log line with every ID):

```bash
# APPROVAL required. Profile must be allowed ecs:RunTask + iam:PassRole (not ReadOnly).
AWS_PROFILE=<prod deploy profile> CONFIRM_PRODUCTION=I_UNDERSTAND \
  ./scripts/catalogue-task.sh seed --confirm=LOADTEST_SEED
```

**Cleanup** (one transaction; removes ONLY the dataset):

```bash
AWS_PROFILE=<prod deploy profile> CONFIRM_PRODUCTION=I_UNDERSTAND \
  ./scripts/catalogue-task.sh cleanup --confirm=LOADTEST_CLEANUP
AWS_PROFILE=<prod deploy profile> CONFIRM_PRODUCTION=I_UNDERSTAND ./scripts/catalogue-task.sh status  # expect all zeros
```

Cleanup deletes by **exact planned ID and** the `LOADTEST_`/`loadtest-` marker, then lets the
foreign keys cascade. It aborts, deleting nothing, if: the owner owns any restaurant outside the
dataset; any order references a `LOADTEST_` restaurant; or any non-`LOADTEST_` restaurant is
linked to a `LOADTEST_` cuisine. The test customer's cart, if it was pointed at a `LOADTEST_`
restaurant, has that reference set to null by the foreign key.

`catalogue-task.sh` starts a one-off Fargate task from the **currently deployed** API task
definition, with the command overridden to `node dist/scripts/loadtest-catalogue/cli.js …`. It
uses the same subnets, security groups and `DATABASE_URL` secret as the service, waits for the task
to stop, and prints its log. The image must be a release that contains the CLI. The task's
container health check will report unhealthy (no HTTP server); for a standalone task that has no
effect.

Locally: `pnpm --filter api-gateway exec tsx scripts/loadtest-catalogue/cli.ts plan|status|seed|cleanup`.

---

## Load-test customer account

Mechanism: the normal public registration endpoint, `POST /api/v1/auth/register`. It always
creates role **CUSTOMER** (`AuthService.register` → `registerWithRole(dto, CUSTOMER)`) and hashes
the password normally. No admin path, no direct database insert, and no payment data is ever
attached. The k6 suite logs in once per run and **refuses any account whose role is not
CUSTOMER**.

One-time setup (**APPROVAL**; run by an operator, not automated):

```bash
# 1. Generate a password and store it in your password manager / a secret store — never in Git.
LT_PASSWORD="$(openssl rand -base64 24)"
# 2. Register (one request). Identity is obviously synthetic; .invalid can never receive email.
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.patheyaexpress.com/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  --data "$(printf '{"firstName":"LOADTEST_Customer","lastName":"Synthetic","email":"loadtest-customer@loadtest.invalid","password":"%s"}' "$LT_PASSWORD")"
# expect 201
```

For runs, export `LT_EMAIL=loadtest-customer@loadtest.invalid` and `LT_PASSWORD` from the
secret store. `scripts/k6.sh` passes both to the container **by name only**.

Removal after the test (the account deletes itself: soft delete, email/phone/password cleared,
refresh tokens revoked, so login is impossible afterwards):

```bash
TOKEN=$(curl -s -X POST https://api.patheyaexpress.com/api/v1/auth/login -H 'Content-Type: application/json' \
  --data "$(printf '{"email":"%s","password":"%s"}' "$LT_EMAIL" "$LT_PASSWORD")" \
  | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $TOKEN" \
  https://api.patheyaexpress.com/api/v1/users/me    # expect 200; a later login returns 401
unset TOKEN LT_PASSWORD
```

---

## Discovered API surface

Global prefix `/api/v1` (except `/metrics`). Responses are wrapped by `ResponseInterceptor` as
`{ success, timestamp, data }`. Source: `apps/api-gateway/src/modules/**/controllers`.

**Used, public and read-only:** `GET /customer/home` (~6 queries in parallel), `/restaurants`
(filters/sort/paging), `/restaurants/:id`, `/menu/:restaurantId`, `/restaurants/:id/reviews`,
`/restaurants/:restaurantId/branches`, `/offers/restaurants/:restaurantId`,
`/search/{suggestions,global,menu-items,trending}`, `/cuisines`, `/offers/{featured,home}`,
`/faqs`, `/health/ready`. None has a response cache; every request reaches PostgreSQL through
RDS Proxy.

**Used, CUSTOMER JWT, read-only:** `/users/me`, `/notifications/me/unread-count`, `/orders/me`,
`/wallet/balance`, `/cart` (the first call inserts one empty cart row via `findOrCreateCart`),
`/addresses`, `/coupons/available`, `/favorites/restaurants`. Each request also does two Redis
GETs in `JwtStrategy`.

**Excluded (mutating, money-moving or side effects):** all order, payment, wallet-apply, coupon
validation, cart mutation, auth register/refresh/logout/password routes (login runs once per run,
in `setup()`), search log/recent writes, and every POST/PATCH/PUT/DELETE elsewhere.
Delivery-partner and restaurant-owner routes need role accounts and are out of scope. The
Socket.IO realtime gateway (`/socket.io`, JWT at handshake) needs its own test.

---

## Workload model

- A **VU is one simulated, actively browsing session**: it picks a journey, makes 1–6 requests
  with human think time (1–3 s between page views, 2–5 s reading a menu, 0.3–0.7 s typing),
  then picks the next one. **A VU is not a registered user and not an installed app.**
- On the local validation run: ~2.5 requests per journey and **~0.5 req/s per VU** (71 requests
  in 70 s at 2 VUs), so roughly **500 req/s at 1000 VUs**. The report uses measured req/s.
- From VUs to users: peak concurrent active sessions ≈ sustainable VUs. Daily active users ≈ that
  ÷ the peak-concurrency ratio (an assumption to state, often 5–15% at dinner peak).

| Journey | Weight | Requests |
|---|---|---|
| browse | 35% | home (80% with city lat/lng) → restaurant list |
| search | 20% | 1–3 autocomplete → global search → 30% dish search |
| restaurant_detail | 15% | restaurant → menu → 50% reviews, 40% offers, 30% branches |
| account (CUSTOMER) | 10% | profile, unread count, order history, 40% wallet |
| cart_read (CUSTOMER) | 10% | cart, addresses, available coupons, 30% favourites |
| other_reads | 10% | cuisines / offers / trending / FAQs |

Without `LT_EMAIL`/`LT_PASSWORD`, or once the shared 15-minute token is about to expire, the
CUSTOMER journeys run as anonymous browsing instead; the summary reports them as `auth_fallbacks`.

## Profiles

| `PROFILE` | Shape | Duration | Purpose |
|---|---|---|---|
| `smoke` | 2 VUs | ~2 min | Route/script validation. Run first, every time |
| `baseline` | 25 VUs | ~12 min | Reference latency |
| `ramp` | 25 → 50 → 100 → 250 → 500 → 750 → 1000, each 30 s ramp + 4.5 min hold | ~36.5 min | **Capacity search** |
| `stress` | `STRESS_VUS` (required) | ~16 min | Just above the sustainable point, then recovery |
| `spike` | 25 → `SPIKE_VUS` (default 500) → 25 | ~12 min | Burst and recovery |
| `soak` | `SOAK_VUS` (required, ~70% of sustainable) for 45 min | ~48 min | Leaks and drift |

---

## Safety limits (unchanged)

**Hard limits in code** (`lib/config.js`; env may lower, never raise): `HARD_MAX_VUS = 1000`,
`HARD_MAX_DURATION_SECONDS = 3600`, `HARD_MAX_RPS = 1000` (default `MAX_RPS=800`). Plain `http`
is accepted only for `localhost` / `127.0.0.1` / `host.docker.internal` (local validation); every
other target must be `https`.

**Production gate:** for `api.patheyaexpress.com`, k6 refuses to start without
`CONFIRM_PRODUCTION=I_UNDERSTAND` **and** a passing `results/preflight.json` under 15 minutes old
for the same `BASE_URL`. `setup()` re-checks readiness.

**Client-side aborts** (k6 `abortOnFail`, per stage): errors > 2% (1 min grace); p95 > 2 s or
p99 > 5 s (2 min into the stage); HTTP 429 > 1% (30 s, the run is invalid); checks < 98%.

**Server-side aborts** (`scripts/watchdog.sh`, every 60 s, "sustained" = 3 one-minute datapoints):
ECS API CPU or memory > 85%; Aurora writer CPU > 80%; Aurora connections > 80% of the proxy's
share (`DB_MAX_CONNECTIONS` × 80% × 80%, default 1800 → 1152; verify `SHOW max_connections;`);
Redis engine CPU > 80% or memory > 75%; ALB healthy hosts < 1 or any unhealthy host (immediate);
readiness non-200 twice; BullMQ waiting jobs growing for 5 polls (needs `METRICS_URL` +
`METRICS_TOKEN`; production `/metrics` is internal-only, so this check is off unless a
`METRICS_AUTH_TOKEN` is deployed).

**Stop rule:** when a stage breaches, stop there. Never re-run higher to "see it fail".

**Manual stop:** `Ctrl+C`, `docker stop patheya-k6`, or
`curl -X PATCH http://127.0.0.1:6565/v1/status -H 'Content-Type: application/json' -d '{"data":{"type":"status","id":"default","attributes":{"stopped":true}}}'`.

---

## Test plan (production)

Run from `loadtest/k6/`. `AWS_PROFILE` is a read-only production profile unless a step says
otherwise.

| # | Step | Command / action | Gate |
|---|---|---|---|
| 1 | Deploy the security fixes | Normal release → `backend-deploy-ecs.yml` | **APPROVAL** |
| 2 | Same release ships configurable rate limit, default 100 | (same deploy) · `./scripts/rate-limit-status.sh --expect=default` | — |
| 3 | Verify production health | `/api/v1/health/ready` = 200; ECS 1/1; ALB healthy; from outside: `/metrics`, `/api/docs`, `/api/v1/system/redis-test` all **404** | — |
| 4 | Create `LOADTEST_` catalogue | `./scripts/catalogue-task.sh seed --confirm=LOADTEST_SEED`, then save the `LOADTEST_MANIFEST` line | **APPROVAL** |
| 5 | Create the CUSTOMER account | [one-time procedure](#load-test-customer-account) | **APPROVAL** |
| 6 | Temporarily raise the limit | Terraform `RATE_LIMIT_MAX=60000` + redeploy the current image · `./scripts/rate-limit-status.sh --expect-at-least=60000` | **APPROVAL** |
| 7 | Preflight | `BASE_URL=https://api.patheyaexpress.com ./scripts/preflight.sh` (also checks the override) | must PASS |
| 8 | Smoke | `PROFILE=smoke BASE_URL=… CONFIRM_PRODUCTION=I_UNDERSTAND ./scripts/k6.sh` | all checks pass |
| 9 | Ramp (≤ 1000 VUs) | `./scripts/preflight.sh` then `PROFILE=ramp … ./scripts/k6.sh`; terminal 2: `BASE_URL=… ./scripts/watchdog.sh` | **APPROVAL** (traffic) |
| 10 | Stop early on any threshold | automatic (k6 thresholds + watchdog) | — |
| 11 | Return the limit to 100 | Terraform back to default + redeploy · `./scripts/rate-limit-status.sh --expect=default` | **APPROVAL** |
| 12 | Verify production health | as step 3 | — |
| 13 | Remove `LOADTEST_` data | `./scripts/catalogue-task.sh cleanup --confirm=LOADTEST_CLEANUP` → `status` all zeros | **APPROVAL** |
| 14 | Remove the test account | `DELETE /users/me` ([above](#load-test-customer-account)); confirm login → 401 | — |
| 15 | Capacity report | from `results/ramp-*.txt`, `*.json`, `watchdog-*.log` ([template](#capacity-report-template)) | — |
| 16 | Autoscaling design | only after the report is reviewed | review |

Exact k6 invocations (Docker; values come from your environment, never from the command line):

```bash
export BASE_URL=https://api.patheyaexpress.com CONFIRM_PRODUCTION=I_UNDERSTAND
export LT_EMAIL=loadtest-customer@loadtest.invalid   # LT_PASSWORD exported from the secret store
PROFILE=smoke ./scripts/k6.sh
PROFILE=ramp  ./scripts/k6.sh
PROFILE=spike SPIKE_VUS=<≤ 1.5 × sustainable> ./scripts/k6.sh      # only after ramp review
PROFILE=soak  SOAK_VUS=<~0.7 × sustainable>   ./scripts/k6.sh      # only after ramp review
```

Never pass `--http-debug` (it prints the bearer token). `handleSummary` strips `setup_data`.
Output: `results/<profile>-<ts>.{json,txt}` and `results/watchdog-<ts>.log`.

---

## What to watch during the run

Names: prefix `patheya-production`, region `ap-south-1`, 1-minute resolution.

| Component | Namespace / source | Dimensions | Metrics |
|---|---|---|---|
| ECS API | `AWS/ECS` | `ClusterName=patheya-production-ecs`, `ServiceName=patheya-production-api` | CPUUtilization, MemoryUtilization |
| | `ECS/ContainerInsights` (if enabled) | same | RunningTaskCount, DesiredTaskCount |
| ECS Worker | `AWS/ECS` | `ServiceName=patheya-production-worker` | CPUUtilization, MemoryUtilization |
| ALB | `AWS/ApplicationELB` | `LoadBalancer=app/patheya-production-alb/…`, `TargetGroup=targetgroup/patheya-production-api-tg/…` | RequestCount, RequestCountPerTarget, TargetResponseTime (p50/p95/p99), HTTPCode_Target_2XX/4XX/5XX_Count, HTTPCode_ELB_5XX_Count, HealthyHostCount, UnHealthyHostCount, TargetConnectionErrorCount |
| Aurora writer | `AWS/RDS` | `DBInstanceIdentifier=patheya-production-aurora-writer` | CPUUtilization, DatabaseConnections, CommitLatency, ReadLatency, WriteLatency, FreeableMemory, ReadIOPS, WriteIOPS |
| Aurora cluster | `AWS/RDS` | `DBClusterIdentifier=patheya-production-aurora` | VolumeReadIOPs, VolumeWriteIOPs |
| RDS Proxy | `AWS/RDS` | `ProxyName=patheya-production-aurora-proxy` | ClientConnections, DatabaseConnections, DatabaseConnectionsBorrowLatency, DatabaseConnectionsCurrentlyBorrowed, **DatabaseConnectionsCurrentlySessionPinned**, DatabaseConnectionRequests |
| Redis | `AWS/ElastiCache` | `CacheClusterId=patheya-production-redis-001` | EngineCPUUtilization, CPUUtilization, DatabaseMemoryUsagePercentage, CacheHits, CacheMisses, GetTypeCmds + SetTypeCmds, CurrConnections, NewConnections, Evictions |
| BullMQ + app | `GET /metrics` — **internal-only in production**: ECS Exec `curl -s localhost:3000/metrics`, or a bearer token if `METRICS_AUTH_TOKEN` is deployed | — | `patheya_bullmq_jobs_{waiting,active,delayed}`, `_jobs_{completed,failed}_total`, `_job_duration_seconds`, `_oldest_waiting_job_age_seconds`, `patheya_http_requests_in_flight`, `patheya_prisma_query_duration_seconds`, `patheya_prisma_query_errors_total` |
| Logs | `/patheya-express/production/ecs/api` | — | Prisma `P2024` (pool timeout), 5xx traces, Redis reconnects, the boot `Rate limit:` line |

- **Prisma pool.** The production `DATABASE_URL` sets no `connection_limit`, so each task's pool
  defaults to `num_cpus × 2 + 1`, a handful of connections, while `/customer/home` alone runs ~6
  queries at once. If latency climbs while API CPU, Aurora CPU and Proxy connections stay low and
  flat, the pool is the bottleneck (`P2024` in the logs). That is a `connection_limit` setting,
  not more tasks.
- **Proxy pinning.** Prisma's prepared statements can pin RDS Proxy sessions. A high
  `DatabaseConnectionsCurrentlySessionPinned` means the proxy is not multiplexing.

---

## Capacity report template

1. **Maximum sustainable VUs**: the highest stage with p95 < 2 s, p99 < 5 s, errors < 2%, and no server-side limit crossed. Also give a stricter product SLO figure (e.g. p95 < 500 ms).
2. **Maximum sustainable req/s**: k6 `http_reqs` rate at that stage, cross-checked with ALB RequestCount ÷ 60. If it sits at `MAX_RPS`, the result is client-limited.
3. **p50 / p95 / p99 per stage**: k6 per-stage table, plus ALB TargetResponseTime (server-side).
4. **First bottleneck**, with evidence (metric, value, stage).
5. **Second bottleneck**: the next-closest resource to its limit at the breaking stage.
6. **API horizontal scaling needed?** Yes if API CPU or memory limited first, or the pool did and `connection_limit` cannot rise further.
7. **Worker horizontal scaling needed?** This workload barely touches the worker; judge from queue depth and age.
8. **Aurora**: CPU, commit/read latency, FreeableMemory. 9. **Redis**: engine CPU, memory, evictions. 10. **RDS Proxy**: borrow latency, pinning, client vs DB connections.

Always state: the workload model, topology (task count/size, writer class), catalogue size (60
restaurants / 1 920 items), whether auth journeys ran, and the rate-limit override in effect.

## Autoscaling design (after review — not implemented)

Existing: `patheya-express-terraform/modules/ecs/autoscaling.tf`, CPU + memory target tracking
for API and worker, bounds from `operating_mode` (`build` 1/1, `live` API 3–10, worker 3–6).
Choose the API signal that **led** the latency breach in the ramp data:
- CPU, if CPU tracked latency;
- otherwise ALB `RequestCountPerTarget` at ~60–70% of measured sustainable req/s per task.

Bound the API max by DB connections (tasks × `connection_limit` ≤ proxy share) and the 30-vCPU
Fargate quota. Use a short scale-out (~60 s) and a long scale-in (~300 s) cooldown, checked
against `spike` recovery. For the worker, prefer queue-based scaling (`patheya_bullmq_jobs_waiting`
or oldest-job age, published to CloudWatch, which needs a metric bridge that doesn't exist today).
