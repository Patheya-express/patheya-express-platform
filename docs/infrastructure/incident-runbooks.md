# Incident runbooks

Scenario-driven companion to [`runbook.md`](runbook.md) (organized by "which alert fired") and
[`operations-guide.md`](operations-guide.md) (day-to-day, not incident). Each entry below follows
the same structure: **Symptoms** (what you'd notice), **Diagnosis** (how to confirm it's actually
this), **Metrics**/**Logs** (exactly what to look at, by name — all `patheya_*` metrics are on the
`/metrics` Prometheus endpoint; all logs are structured JSON via `AppLoggerService`, one JSON object
per line, filterable by the `event`/`context` fields named below), **Recovery steps**, and
**Escalation**. Written as part of the Production Readiness Stage B observability pass — every
metric/log field named here was verified to actually exist and populate correctly against a real
running instance during that pass, not assumed from reading the code.

## Redis outage

**Symptoms**: `GET /api/v1/health/ready` returns 503 with `redis: "disconnected"` (and usually
`queues: "disconnected"` too, since BullMQ shares the same Redis). Socket.IO cross-pod delivery
stops working. Order placement's idempotency fast-path (`OrdersService`'s Redis lock) silently
degrades to DB-constraint-only correctness rather than failing outright — not itself an outage
symptom, but explains why order placement keeps working while everything else visibly breaks.

**Diagnosis**: `patheya_redis_active_connections` dropping toward 0 alongside a spike in
`patheya_redis_disconnect_count`/`patheya_redis_reconnect_count` confirms it's Redis itself, not a
single connection type (e.g. only the Socket.IO adapter). `patheya_redis_auth_failure_count`
climbing instead points at an AUTH token rotation problem, not an availability problem — a
different fix (see `known-issues.md`'s ExternalSecret section) than an actual Redis outage.

**Metrics**: `patheya_redis_active_connections`, `patheya_redis_reconnect_count`,
`patheya_redis_disconnect_count`, `patheya_redis_auth_failure_count`, `patheya_redis_average_ping_ms`
(reads `null`/0 until at least one per-command latency sample has been wired — see
`redis-metrics.service.ts`'s doc comment; don't rely on this one alone).

**Logs**: `RedisLifecycleService`'s connect/ready/close/reconnecting log lines (one per registered
connection — general, BullMQ shared, per-queue QueueEvents, Socket.IO pub/sub) name which
connection(s) are affected. `health_check` (context `HealthService`) confirms which dependency the
readiness probe itself saw fail.

**Recovery steps**:
1. Confirm it's genuinely Redis and not this process's network path to it — `GET /health/ready`
   from a different pod; if only one pod reports `disconnected`, it's that pod, not Redis itself.
2. Check ElastiCache/the Redis instance's own health directly (CloudWatch/hosting dashboard) —
   this application has no failover/promotion logic of its own; `reconnectOnError` only handles a
   `READONLY` response during ElastiCache's own automatic failover, transparently.
3. Once Redis is reachable again, `RedisLifecycleService`'s `retryStrategy` (exponential backoff,
   capped at 2s) reconnects automatically — no restart needed. Confirm via `patheya_redis_active_connections`
   returning to its expected count (one per registered connection type, per process).
4. If a pod's connections never recover after Redis itself is confirmed healthy, restart that pod
   (`operations-guide.md`'s "Restart a stuck pod") rather than waiting indefinitely.

**Escalation**: Redis/ElastiCache infrastructure health itself escalates to whoever owns
`patheya-express-terraform` (same boundary as `runbook.md`'s existing Escalation section). Recovery
of *state* Redis held (BullMQ jobs in flight, presence, Socket.IO room membership) is covered by
`disaster-recovery.md`'s "Recovering from a Redis wipe" — this runbook only covers the connectivity
incident itself.

## Database (Postgres/Aurora) outage

**Symptoms**: `GET /api/v1/health/ready` returns 503 with `database: "disconnected"`. Every request
touching Prisma fails; `GlobalExceptionFilter`'s `EXCEPTION` logs show a Prisma connection error as
the `cause` on otherwise-generic 500s.

**Diagnosis**: `patheya_prisma_query_errors_total` climbing alongside the readiness probe's
`database` field flipping confirms it's the database connection itself, not a single bad query.
`patheya_prisma_query_duration_seconds`'s count stalling (no new samples) while errors climb is the
clearest signal — queries are failing before they can even be timed.

**Metrics**: `patheya_prisma_query_errors_total`, `patheya_prisma_query_duration_seconds` (count/sum
— a stalled count is as informative as the errors counter), `patheya_http_requests_total{status="500"}`
climbing across unrelated routes (a database outage is never route-specific).

**Logs**: `prisma_error` (context `PrismaService`) — Prisma's own `error` log-level event, fired for
engine-level failures (lost connection, pool exhaustion). Does **not** cover every individual failed
query (an application-level query failure rejects the calling `await` directly and is logged by
whichever service issued it) — see this doc's note in `metrics.service.ts`/`prisma.service.ts` about
that being an honest, documented limitation, not full coverage.

**Recovery steps**:
1. Confirm it's the database, not this process — same "check from another pod" first step as the
   Redis runbook above.
2. Check Aurora/Postgres's own health directly. This application has no connection-pool failover
   logic beyond Prisma's own client-side retry/reconnect — a genuine database-side outage requires
   the database layer to recover first.
3. `api-gateway-migrate` Job failures are a related-but-distinct scenario — see `runbook.md`'s
   existing entry for that specifically (a failed migration blocks deploys, not necessarily an
   active outage of an already-running database).
4. Once the database is reachable again, Prisma's own connection pool reconnects automatically —
   no application restart needed. Confirm via `/health/ready`'s `database` field and
   `patheya_prisma_query_errors_total` flattening out.

**Escalation**: Aurora/database infrastructure health escalates to whoever owns
`patheya-express-terraform`, same as Redis above. An actual data-loss scenario (not just an
availability blip) escalates per `disaster-recovery.md`.

## Queue backlog (any of the 6 BullMQ queues)

**Symptoms**: Delayed processing a user would notice — dispatch assignment taking longer than
expected, notifications arriving late, payment reconciliation/trending-search/ticket-escalation
runs falling behind their `every` schedule.

**Diagnosis**: `patheya_bullmq_jobs_waiting{queue}` climbing over a sustained window (not a single
spike — queues drain in bursts around normal traffic patterns) with
`patheya_bullmq_oldest_waiting_job_age_seconds{queue}` also climbing is a genuine backlog. Check
`patheya_bullmq_jobs_failed_total{queue}` for the same queue first — a backlog caused by jobs
silently failing and retrying (see `patheya_bullmq_job_retries_total{queue}`) looks identical to
genuine under-capacity until you check this; the fix is completely different (find and fix why jobs
are failing, vs. scale the worker).

**Metrics**: `patheya_bullmq_jobs_waiting`/`active`/`delayed`/`oldest_waiting_job_age_seconds`
(current state, all labeled by `queue`), `patheya_bullmq_jobs_failed_total`/`completed_total`
(labeled by `queue`), `patheya_bullmq_job_duration_seconds` (labeled by `queue`+`outcome` — a rising
p95 here explains a backlog even with jobs still completing, not just failing),
`patheya_bullmq_job_retries_total{queue}`.

**Logs**: Each processor logs its own job-started/completed/failed events with `orderId`/
`assignmentId`/etc. context (e.g. `dispatch_assignment_job_started`, context
`AssignmentExpiryProcessor`) — filter by `queue` and the relevant job name to see what's actually
taking long or failing.

**Recovery steps**:
1. Check `worker`'s pod count and CPU/memory first — if HPA hasn't scaled up despite headroom,
   that's a node-capacity question (`kubectl describe pod`), not a code problem
   (`runbook.md`'s existing entry covers this exact triage step).
2. If jobs are failing (not just slow), read the specific processor's log line for the failing job
   — every processor logs enough context (order/assignment/payment id) to reproduce.
3. All six queues have real processors as of this pass (`known-issues.md`'s prior "3 queues have no
   processor" note is fixed and stale) — a backlog on any of them, including `payments`/`search`/
   `tickets`, is a genuine signal now, not an expected gap.
4. `dispatch` specifically also has `DispatchReconciliationService`'s periodic re-scan (every 5
   minutes) as a backstop for anything a `dispatch-assignment` job fails to complete — see the
   Dispatch degradation runbook below if the backlog is dispatch-specific.

**Escalation**: Sustained backlog despite adequate worker capacity and no failing jobs — i.e. the
system is genuinely under-provisioned for current load — escalates to whoever owns capacity
planning/Karpenter node-pool limits (`patheya-express-terraform`).

## Worker process crash / restart loop

**Symptoms**: `worker` pods in `CrashLoopBackOff`, or a pod flapping between `Running` and
`NotReady`. Queue depth climbs across every queue simultaneously (distinguishes this from a
single-queue backlog above) since nothing is consuming any of them.

**Diagnosis**: `worker`'s own `/api/v1/health/live` (process-only, no dependency checks) failing to
even respond means the process itself is down or not booting — check pod logs immediately, don't
wait on metrics (a crashed process emits none). A `NestJS UnknownDependenciesException` at startup
(visible in `kubectl logs` before the process ever reaches "Nest application successfully started")
means a module-wiring bug, not an infrastructure problem — this pass found and fixed exactly one
of these live (`DispatchCoreModule` wasn't exporting `DispatchReconciliationService`, which
`AssignmentExpiryProcessor` depends on — the worker could not boot at all until fixed). Treat any
`UnknownDependenciesException` the same way: the named provider needs adding to the owning module's
`exports` array (or the consuming module needs to import the module that already exports it).

**Metrics**: None from the crashed process itself (it never started far enough to expose `/metrics`)
— rely on `patheya_bullmq_jobs_waiting` climbing across *all* queues simultaneously as observed from
a healthy `api-gateway` pod (the Producer side keeps enqueueing regardless of Worker health), and
your orchestrator's own pod-restart-count metric.

**Logs**: `kubectl logs -n patheya-backend -l app.kubernetes.io/name=worker --previous` (the
crashed instance's logs, not the new restart) — a DI wiring bug shows immediately, before
`worker_started` (context `WorkerBootstrap`) ever logs. If `worker_started` *did* log and the crash
happened later, it's a runtime error, not a boot error — check whichever processor's log line
appears last before the crash.

**Recovery steps**:
1. `kubectl logs --previous` first, always — this is the single fastest way to distinguish "never
   booted" (DI/config error, fix-and-redeploy) from "booted then crashed" (runtime bug in a specific
   processor, needs its own investigation).
2. A DI wiring bug (`UnknownDependenciesException`) is a code fix, not an infra one — add the
   missing export/import, rebuild, redeploy. Verify locally first by actually booting
   `dist/src/worker-main.js` against a real (or throwaway Docker) Redis before redeploying — this
   is exactly how this pass caught the `DispatchCoreModule` bug, which `npm test`/`typecheck` alone
   did not catch (unit tests mock dependencies away; nothing had exercised the real Nest DI
   container for the worker's actual module graph end-to-end until this pass did).
3. If it boots but crashes later, check for unhandled promise rejections in whichever processor was
   last active — `EventBusService.publish()` and BullMQ's own retry both catch handler/processor
   errors, so an actual process-crashing error usually means something outside those (e.g. a
   `RedisConnectionFactory` connection setup failure at a bad time).

**Escalation**: A crash loop that persists after a clean rebuild/redeploy, with no code-level cause
found, escalates the same way a stuck-`Pending` pod does (`runbook.md`) — likely node-capacity or
platform-level, not application-level.

## Dispatch degradation (orders not getting assigned to a delivery partner)

**Symptoms**: Orders sit in `READY_FOR_PICKUP` longer than expected with no delivery partner
assigned; customers/restaurants report missing delivery assignment.

**Diagnosis**: `patheya_dispatch_orders_awaiting_assignment` (set by each reconciliation run, every
5 minutes) being consistently non-zero across multiple runs — not just one — is the clearest
sustained-problem signal (a single non-zero run is often just a momentary partner-availability gap,
which is expected and not incident-worthy by itself). Cross-check
`patheya_dispatch_assignment_attempts_total{source}` — a healthy system shows most attempts labeled
`order.ready` (the normal path); a system relying heavily on `expired`/`rejected`/`reconciliation`
sources means normal-path assignment itself is failing, not just occasionally needing a retry.

**Metrics**: `patheya_dispatch_assignment_attempts_total{source}` (source ∈ `order.ready`,
`rejected`, `expired`, `reconciliation`), `patheya_dispatch_redispatch_total{reason}`,
`patheya_dispatch_assignment_duration_seconds` (a rising p95 here suggests
`DispatchService.assignOrder()` itself is slow — e.g. a slow partner-availability query — not that
partners are unavailable), `patheya_dispatch_reconciliation_runs_total`,
`patheya_dispatch_orders_awaiting_assignment`.

**Logs**: `dispatch_assignment_job_started` (context `AssignmentExpiryProcessor`, includes
`orderId`/`sourceEvent`/`attempt`), `dispatch_assignment_expired` (an assignment timed out
unaccepted), the reconciliation service's own warn log naming exactly how many stranded orders it
found and re-enqueued.

**Recovery steps**:
1. Confirm partners are actually available in the affected area/time — a genuine zero-partner
   situation is a business/ops problem (delivery partner supply), not an application bug, and no
   amount of retrying fixes it.
2. If attempts are failing with partners genuinely available, check `dispatch_assignment_job_started`
   logs for the specific `orderId`s stuck in `patheya_dispatch_orders_awaiting_assignment` and trace
   forward from there — `DispatchService.assignOrder()` is idempotent and safe to have re-run
   manually via `addDispatchAssignmentJob` if a specific order needs a manual nudge.
3. Reconciliation already re-attempts every 5 minutes automatically — don't manually re-trigger
   unless an order needs to be unblocked faster than that.

**Escalation**: A genuine partner-supply shortage escalates to Operations, not Engineering. A
systematic assignment failure (partners available, attempts still failing) with no obvious cause in
the logs above escalates to whoever owns the Dispatch module.

## Payment provider (Razorpay) outage

**Symptoms**: Checkout's payment step fails for customers; `patheya_payments_failed_total` climbs
while `patheya_payments_success_total` stalls.

**Diagnosis**: A genuine provider outage affects *verification/webhook* calls broadly, not one
customer's payment specifically — check whether failures cluster on Razorpay-calling code paths
(`PaymentsService`'s `error` logs naming a Razorpay HTTP failure) versus failing on signature/
ownership/amount-mismatch checks (which are correctness rejections, not an outage — see
`payments.concurrency.spec.ts`'s own coverage of exactly these rejection paths, which must keep
rejecting correctly even during a provider outage).

**Metrics**: `patheya_payments_failed_total`, `patheya_payments_success_total`,
`patheya_payment_latency_seconds` (a rising p95 alongside climbing failures suggests Razorpay itself
is slow/timing out, not rejecting outright), `patheya_payments_refunded_total`/
`patheya_refund_duration_seconds` (if the outage is specifically affecting refunds).

**Logs**: `PaymentsService`'s `error` logs around `verifyPayment`/webhook handling name the specific
Razorpay call and failure. `PaymentReconciliationService`'s periodic re-scan (every 5 minutes, same
pattern as dispatch reconciliation) picks back up any payment left `PENDING` once Razorpay recovers
— confirm via that service's own run logs rather than assuming a manual reconciliation is needed.

**Recovery steps**:
1. Check Razorpay's own status page/support channel first — this is an external dependency with no
   failover; there is nothing to "fix" on this platform's side during a genuine provider outage.
2. Once Razorpay recovers, `PaymentReconciliationService`'s existing 5-minute re-scan catches up
   any payment left in `PENDING` from during the outage — no manual intervention needed for that
   part specifically.
3. If failures are actually correctness rejections (signature/ownership/amount mismatch) rather
   than a real outage, that's not this runbook — check for a client-side integration bug (wrong
   amount sent, stale/reused signature) instead.

**Escalation**: A confirmed Razorpay-side outage has no internal escalation path beyond monitoring
their status and communicating expected impact to Operations/Support for customer-facing messaging.

## Storage (Cloudinary/local) outage

**Symptoms**: Restaurant logo/banner/menu-item image uploads fail; existing images (served via
direct URL, not proxied) are typically unaffected unless the outage is at the CDN/origin itself.

**Diagnosis**: `GET /api/v1/health/ready`'s `storage: "disconnected"` field
(`StorageService.checkHealth()`) confirms the provider itself is unreachable, distinct from a
single bad upload (wrong file type/size, a client-side validation rejection).

**Metrics**: `patheya_storage_upload_failures_total`, `patheya_storage_upload_duration_seconds` (a
climbing p95 before failures start suggests the provider is slow/degrading, not yet fully down),
`patheya_storage_download_failures_total` (wired to `StorageService.exists()`, the nearest existing
proxy for a read/download failure in this codebase — see that method's own doc comment for why
there's no genuine download/proxy operation to instrument instead).

**Logs**: Upload/replace call sites' own error handling (each controller/service calling
`StorageService.upload`/`replace` surfaces the provider's rejection reason in its own error
response) — `StorageService` itself doesn't log on failure beyond incrementing the metric, by
design (the caller already has richer context — which restaurant, which image field — to log with).

**Recovery steps**:
1. Confirm it's the provider, not a single bad request — `/health/ready`'s `storage` field is the
   fastest check.
2. Check Cloudinary's own status page (if using the Cloudinary provider) — no failover exists on
   this platform's side.
3. If running the local storage provider (`LocalStorageProvider`, dev/self-hosted only), check disk
   space/permissions on the `/uploads` volume directly — a different failure mode than a Cloudinary
   outage.

**Escalation**: Cloudinary-side outage has no internal fix, same as the Razorpay entry above —
monitor and communicate. A local-storage-provider disk/permissions problem escalates to whoever
owns the underlying volume/node.

## Deployment rollback

Full mechanism-by-mechanism detail already lives in [`rollback-guide.md`](rollback-guide.md) — this
entry is the incident-response entry point into it, not a duplicate.

**Symptoms**: A just-deployed revision is causing errors/degradation a previous revision didn't.

**Diagnosis**: Confirm it's actually the deploy and not a coincident infra issue — check the
`patheya-express.io/git-commit` pod annotation against when symptoms started, and check whether
`smoke-test.ts` was run (and passed) against this revision immediately after rollout; a revision
that failed its smoke test but was deployed anyway is the clearest confirmation.

**Metrics**: `patheya:http_requests_errors:rate5m` (Grafana recording rule) spiking right at the
deploy's rollout time; compare before/after on the same dashboard.

**Logs**: `GlobalExceptionFilter`'s `EXCEPTION` logs naming the failing route/error class
(`runbook.md`'s existing `Critical-ApiGateway-SLOBurnRateFast/Slow` entry covers this exact
diagnosis step already).

**Recovery steps**: See `rollback-guide.md` for the three distinct rollback mechanisms (application
code / database schema / GitOps image-tag bump) — never `kubectl rollout undo` against a
GitOps-managed Deployment. After rolling back, re-run `smoke-test.ts` (extended in this pass with
`metrics:endpoint` and `queue:dispatch-reconciliation-processed` checks, alongside the existing
health/auth/websocket/checkout checks) against the rolled-back revision before declaring the
incident resolved — the same verification a fresh deploy should have passed in the first place.

**Escalation**: If rolling back doesn't resolve the symptoms, the deploy wasn't the actual cause —
re-triage against the other runbooks above (Redis/database/queue/dispatch/payment/storage) rather
than continuing to treat it as a deployment problem.
