# Realistic load test — runbook

A bounded production read test against a **seeded `LOADTEST_` catalogue** with **one CUSTOMER
login**, measured server-side by `scripts/watchdog.sh`. It extends, and does not replace, the
procedures in [README.md](README.md) (security gates, `LOADTEST_` dataset, test account, rate-limit
lifecycle). Everything here uses the existing pinned image (`grafana/k6:2.3.0`), hard limits and
production gate.

> The 2026-10-11 ramp (empty catalogue, no login: 30,563 requests, 0 errors, API 2 → 3 → 2 tasks)
> proved autoscaling only. It is **not** evidence for catalogue-heavy reads, authenticated traffic,
> checkout, orders or payments.

## 1. Scope

| Flow | In this test | Why |
|---|---|---|
| Home, restaurant listing, search, restaurant detail/menu, offers | **Yes** (`browse`, `search`, `restaurantDetail`, `otherReads`) | Read-only; served from the `LOADTEST_` catalogue |
| Authenticated reads: profile, unread count, my orders, wallet, cart, addresses, coupons, favourites | **Yes** (`account`, `cartRead`), one shared CUSTOMER JWT from `setup()` | Read-only `GET`s; login happens once per run (it is rate-limited and writes a refresh-token row) |
| Cart writes, order placement, order lifecycle, payment, refunds, payouts | **No** | See section 6 — needs a payment sandbox and a non-production order path that do not exist today |

Journey weights are in `lib/journeys.js`. All journeys are `GET`s.

## 2. Prerequisites (all required)

1. **Approval recorded** (section 3) — window, traffic ceiling, data scope, cost ceiling.
2. **Rate limit raised** to 60,000 through the established workflow (README "Rate-limit
   lifecycle"): Terraform `-var api_rate_limit_max=60000` on `environments/production/app`, then
   `backend-deploy-ecs.yml` with the **currently deployed** image tag. Verify with
   `./scripts/rate-limit-status.sh --expect-at-least=60000` and the API boot log
   (`Rate limit: 60000 ... NON-DEFAULT`).
3. **Catalogue seeded** — `scripts/catalogue-task.sh plan`, then `seed` (README "Load-test data").
   Keep the manifest it prints; cleanup is manifest-driven.
4. **Test customer** — a CUSTOMER account created per README "Load-test customer account", its
   credentials held only in the operator's shell as `LT_EMAIL` / `LT_PASSWORD` (passed to Docker by
   name; never written to files or logs).
5. **Queue metrics live** (if the worker queue publisher has been deployed): `Patheya/Queues`
   `BacklogWaiting` has datapoints in the last 5 minutes. If not deployed, the watchdog logs
   `backlog=[None]` and skips that guard — record that in the results.
6. **Alerts confirmed**: SNS email subscriptions confirmed (they are, 2026-10-10).
7. `./scripts/preflight.sh` passes (it also checks the rate-limit override) within 15 minutes of
   starting k6.

## 3. Approval record (fill in before starting)

| Item | Value |
|---|---|
| Window (UTC) | e.g. 2026-10-xx 05:30–06:30, outside peak |
| Profile / VU ceiling | `realistic`, `MAX_VUS=75` (lower to stop earlier) |
| Request-rate ceiling | `MAX_RPS=60` (k6 hard cap; actual is lower with think time) |
| Max duration | 21 min (profile) + 1 min ramp-down; hard limit 60 min in code |
| Data scope | `LOADTEST_` catalogue from the seed manifest + one CUSTOMER account; no writes |
| Cost ceiling | API at most 6 tasks (live max) for ≤ 30 min ≈ $0.16 Fargate in total; worker at most 3 tasks ≈ $0.04 |
| Approver | |

## 4. Run

Terminal 1 (k6, local REST API on 127.0.0.1:6565 for the watchdog):

```bash
cd loadtest/k6
BASE_URL=https://api.patheyaexpress.com ./scripts/preflight.sh          # must PASS
PROFILE=realistic MAX_VUS=75 MAX_RPS=60 \
  BASE_URL=https://api.patheyaexpress.com CONFIRM_PRODUCTION=I_UNDERSTAND \
  ./scripts/k6.sh | tee results/realistic-$(date -u +%Y%m%dT%H%MZ).log
```

Terminal 2 (server-side guard, start before or immediately after k6):

```bash
AWS_PROFILE=<production profile> BASE_URL=https://api.patheyaexpress.com ./scripts/watchdog.sh
```

Terminal 3 (evidence): ECS desired/running counts, scaling activities and target health every
30 s, as in `results/autoscale-2026-10-11/scaling.log`.

## 5. Stop conditions

Automatic, client side (k6 `abortOnFail`): failed requests > 2% (1 min grace, global and per stage);
**HTTP 5xx > 1%** (30 s); HTTP 429 > 1% (30 s — the run is invalid); checks < 98%; per stage
p95 > 2 s or p99 > 5 s (2 min grace).

Automatic, server side (`watchdog.sh`, "sustained" = 3 one-minute datapoints):

| Guard | Default | Variable |
|---|---|---|
| ECS API CPU / memory | > 85% | `ECS_API_CPU_MAX`, `ECS_API_MEM_MAX` |
| Aurora writer CPU | > 80% | `DB_CPU_MAX` |
| Aurora connections | > 1152 (80% of the proxy's 80% share) | `DB_MAX_CONNECTIONS` |
| Aurora read / write latency | > 50 ms | `DB_READ_LATENCY_MAX`, `DB_WRITE_LATENCY_MAX` |
| Redis engine CPU / memory | > 80% / > 75% | `REDIS_CPU_MAX`, `REDIS_MEM_MAX` |
| ALB 5xx, target 5xx | > 10 per minute | `HTTP_5XX_PER_MIN_MAX` |
| Queue backlog (`Patheya/Queues` BacklogWaiting) | > 200 waiting jobs | `QUEUE_BACKLOG_MAX` |
| API / worker held at autoscaling maximum | 6 / 3 tasks for 3 polls | `API_TASKS_MAX`, `WORKER_TASKS_MAX` |
| ALB healthy hosts < 1 or any unhealthy | immediate | — |
| Readiness non-200 | 2 polls | — |

Manual stop: `Ctrl+C`, `docker stop patheya-k6`, or the PATCH in README "Manual stop". **Stop rule:
when a stage breaches, stop there; never re-run higher to see it fail.**

## 6. Checkout, orders and payments — not runnable today

Prerequisites before any write-path test, none of which exist in the approved account scope:

1. **Payment sandbox**: the API configured with Razorpay **test-mode** keys (`rzp_test_...`) and a
   test webhook secret, on a deployment that never carries live keys. Production carries live
   payment configuration; switching production to test keys is not acceptable.
2. **Isolated order path**: orders placed only against `LOADTEST_` restaurants, with dispatch,
   notifications (SMS/email/push) and restaurant/delivery-partner fan-out suppressed or routed to
   test sinks, and a cleanup that removes orders, payments, ledger and audit rows created by the
   run (the current catalogue CLI covers catalogue rows only).
3. **A non-production environment** to run it in. Development, QA and Staging hold no workloads
   under the four-account policy, so this needs an explicit decision (e.g. a time-boxed test stack)
   before it can be planned.

The harness must not gain checkout journeys until those exist; `main.js` only issues `GET`s plus
the single `setup()` login.

## 7. After the run

1. Stop the watchdog if it is still running; confirm `docker ps` has no `patheya-k6`.
2. Restore the rate limit to 100 (README "Return the limit to 100") and verify with
   `./scripts/rate-limit-status.sh --expect=default` and the boot log.
3. Clean up data: `catalogue-task.sh cleanup` with the seed manifest (deletes only manifest rows),
   then `status` (expect all zeros); soft-delete the test customer (`DELETE /users/me`) and confirm
   login returns 401.
4. Observe scale-in back to the minimum (API 2, worker 1) and confirm all alarms are OK.

## 8. Reading the results

- **Capacity per task**: the stage before the first breach. Cross-check k6 `http_reqs` rate with
  ALB `RequestCount` ÷ 60; if it sits at `MAX_RPS`, the result is client-limited, not a capacity.
- **Scaling**: time from the request alarm (`TargetTracking-...-AlarmHigh`) to a healthy new target
  (about 4–5 minutes on 2026-10-11: ~3 minutes of ALB metric lag + ~50 s task start).
- **First bottleneck**: whichever watchdog series rises first — API CPU (as in the 2026-10-08
  single-task test), Aurora latency/connections, or Redis.
- Any 5xx: correlate with ALB access logs (`elb_status_code`, `target_status_code`,
  `error_reason`) before attributing it to the application.
