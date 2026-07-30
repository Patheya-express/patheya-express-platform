# Dashboard and alert recommendations (Production Readiness Stage B)

Every Grafana dashboard and Prometheus alert rule for this platform is Terraform-managed in the
separate `patheya-express-terraform` repo (`modules/observability/grafana-dashboards.tf` and its
alert-rule equivalent — see `operations-guide.md`'s reference to the existing "Application
Overview" dashboard, built in an earlier phase). That repo isn't part of this one and wasn't
touched by this pass — this document is the handoff: concrete panel and alert recommendations for
whoever owns that Terraform module to author, covering the metrics this Stage B pass added
(Dispatch, Orders, Payments, Socket.IO, Storage, Redis bridge, Prisma, HTTP in-flight — see
`operations-guide.md`'s "Metrics to actually watch" table for the full catalog). Nothing here is a
placeholder dashboard/alert file dropped in the wrong repo — it's a specification.

## Existing alerting this pass did not need to change

`Critical-ApiGateway-SLOBurnRateFast/Slow`, `Warning-Worker-QueueDepthElevated`, and
`Warning-Worker-JobFailed-<queue>` (all referenced in `runbook.md`) already cover HTTP error-rate
and basic queue-depth/failure signals from metrics that existed before this pass. Recommendations
below are additive, for the metrics that didn't exist until now.

## New dashboard panels recommended

Grouped to match a plausible new "Dispatch & Orders", "Payments", "Realtime & Storage", and
"Infrastructure Bridge" row on the existing Application Overview dashboard (or new dashboards,
whoever owns the Terraform module should decide based on existing dashboard real estate):

| Panel | Query shape | Why |
| --- | --- | --- |
| Dispatch assignment attempts by source | `sum by (source) (rate(patheya_dispatch_assignment_attempts_total[5m]))` | A healthy system is dominated by `order.ready`; a rising share of `expired`/`rejected`/`reconciliation` is the earliest signal of dispatch degradation, well before `orders_awaiting_assignment` itself climbs |
| Orders awaiting assignment | `patheya_dispatch_orders_awaiting_assignment` | Direct backlog gauge, refreshed every reconciliation run (5 min) |
| Dispatch assignment duration (p50/p95/p99) | `histogram_quantile(0.95, sum by (le) (rate(patheya_dispatch_assignment_duration_seconds_bucket[5m])))` | Distinguishes "partners unavailable" (attempts fast, still fail) from "assignment logic itself slow" |
| Order funnel | `sum(rate(patheya_orders_created_total[1h]))` vs `completed_total`/`cancelled_total` | Business-level funnel health, not just technical health |
| Order lifecycle duration by outcome | `histogram_quantile(0.95, sum by (le, outcome) (rate(patheya_order_lifecycle_duration_seconds_bucket[1h])))` | Time-to-delivery / time-to-cancellation trend |
| Payment success/failure rate | `sum(rate(patheya_payments_failed_total[5m])) / sum(rate(patheya_payments_success_total[5m]) + rate(patheya_payments_failed_total[5m]))` | The single most business-critical ratio on this platform |
| Payment latency (p95) | `histogram_quantile(0.95, sum by (le, outcome) (rate(patheya_payment_latency_seconds_bucket[5m])))` | Razorpay-side slowness shows here before it shows as outright failures |
| Socket.IO connected clients (per pod) | `patheya_socketio_connected_clients` | Realtime capacity/connection-leak visibility, per pod (compare across pods for imbalance) |
| Socket.IO broadcast/event rate | `sum by (roomType) (rate(patheya_socketio_broadcasts_total[5m]))` | Realtime traffic volume, by room type |
| Storage upload duration + failures | `histogram_quantile(0.95, ...)` + `rate(patheya_storage_upload_failures_total[5m])` | Cloudinary/provider health |
| Redis bridge counters | `patheya_redis_active_connections`, `rate(patheya_redis_reconnect_count[5m])`, `patheya_redis_auth_failure_count` | Connection-level Redis health, independent of `/health/ready`'s point-in-time check |
| Prisma query duration + errors | `histogram_quantile(0.95, sum by (le) (rate(patheya_prisma_query_duration_seconds_bucket[5m])))` + `rate(patheya_prisma_query_errors_total[5m])` | Database-side latency/error trend, not just the readiness probe's binary up/down |
| HTTP requests in flight | `patheya_http_requests_in_flight` | Requests piling up under a stalled downstream dependency, distinguishable from a genuine traffic spike (which `http_requests_total`'s rate would show growing too; in-flight climbing while the rate doesn't is the tell) |
| BullMQ per-queue detail | `patheya_bullmq_jobs_waiting`/`active`/`delayed`/`oldest_waiting_job_age_seconds` by `queue` | Finer-grained than the existing `queue_depth` panel — `oldest_waiting_job_age_seconds` is the actual staleness signal `incident-runbooks.md`'s "Queue backlog" runbook keys off |

## New alert rules recommended

Following this repo's existing `Critical-`/`Warning-` naming convention:

| Alert name | Condition (PromQL sketch) | Severity | Why |
| --- | --- | --- | --- |
| `Warning-Dispatch-OrdersAwaitingAssignment` | `patheya_dispatch_orders_awaiting_assignment > 0` for 3 consecutive reconciliation runs (~15 min) | Warning | A single non-zero run is often a momentary partner-availability gap (see `incident-runbooks.md`); sustained non-zero is a genuine problem |
| `Critical-Payments-FailureRateHigh` | `sum(rate(patheya_payments_failed_total[10m])) / sum(rate(patheya_payments_success_total[10m]) + rate(patheya_payments_failed_total[10m])) > 0.1` for 5 min | Critical | Payment failures directly block checkout — this platform's most revenue-critical path |
| `Warning-Redis-ReconnectRateElevated` | `rate(patheya_redis_reconnect_count[5m]) > 0` sustained over 10 min | Warning | Occasional reconnects are normal (ElastiCache failover); a sustained rate indicates flapping connectivity worth investigating before it becomes an outage |
| `Critical-Redis-AuthFailures` | `increase(patheya_redis_auth_failure_count[5m]) > 0` | Critical | Should never happen outside a credential rotation in progress — an unexpected auth failure means a stale/wrong `REDIS_AUTH_TOKEN`, not a transient blip |
| `Warning-Prisma-QueryErrorsElevated` | `rate(patheya_prisma_query_errors_total[5m]) > 0` sustained over 5 min | Warning | Engine-level errors (lost connection, pool exhaustion) — see `incident-runbooks.md`'s Database outage runbook |
| `Warning-Storage-UploadFailureRateHigh` | `rate(patheya_storage_upload_failures_total[10m]) > 0.05` (as a fraction of attempts, or an absolute rate threshold tuned to real traffic) | Warning | Cloudinary/provider degradation |
| `Warning-BullMQ-OldestJobStale` | `patheya_bullmq_oldest_waiting_job_age_seconds > 300` (tune per queue — `dispatch` should drain in seconds, `tickets` tolerates longer) | Warning | More precise than a raw depth threshold — a queue can have high depth but low staleness (bursty-but-draining), or low depth but one genuinely stuck old job |
| `Warning-HTTP-InFlightElevated` | `patheya_http_requests_in_flight > <tuned threshold>` sustained over 5 min | Warning | Requests piling up — usually a downstream dependency (DB/Redis/payment provider) slowing down, not raw traffic growth |

Thresholds above are starting points, not verified-against-production values (this pass had no
access to real production traffic/load patterns) — whoever owns the Terraform module should tune
each against actual traffic before enabling in `Critical` severity, per this platform's own
"verify against real signal, don't guess" standard.
