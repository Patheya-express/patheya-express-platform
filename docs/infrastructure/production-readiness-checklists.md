# Production readiness checklists

Seven operational checklists for the backend (`api-gateway`/`worker`), written for whoever is
actually executing a deploy, rollback, incident, DR drill, scaling change, or pre-launch
verification — not a restatement of `go-live-checklist.md` (infra/CI/CD/sign-off, broader than
this repo) or `deployment-guide.md` (the mechanics of how a deploy reaches the cluster). This
file is the "what do I personally check, in what order" companion to both, produced during the
Stage D Enterprise Production Readiness pass and cross-referencing the runbooks/guides that
already exist rather than duplicating them.

## 1. Production deployment checklist

Before merging/promoting a change that will reach production:

- [ ] CI green: lint, typecheck, full test suite (`npm run lint && npm run typecheck && npm test`)
- [ ] If the change touches `prisma/schema.prisma`: migration reviewed for additive-only safety
      (no `DROP COLUMN`/non-defaulted `NOT NULL`/`RENAME` still read by the currently-running
      code) — see `migrations.md`'s "Writing a safe migration" section
- [ ] If the change adds/changes an env var: added to `k8s/base/*/deployment.yaml` (or the
      relevant ExternalSecret) for every environment, not just local `.env.example`
- [ ] If the change touches a BullMQ job body: confirmed idempotent (safe to run twice) — see
      §3 of `incident-runbooks.md`'s "Queue backlog" runbook for why this matters on every job
- [ ] `smoke-test.ts` still passes locally against a real (throwaway) Redis + the real dev
      Postgres, including the `queue:dispatch-reconciliation-processed` and `metrics:endpoint`
      checks (Production Readiness Stage B)
- [ ] Deploy via the standard pipeline (never `kubectl apply`/`kubectl edit` by hand —
      `platform-standards.md` §1)
- [ ] Post-deploy: `smoke-test.ts` run against the actually-deployed revision
      (`deploy:smoke-test`), before considering the rollout complete
- [ ] Post-deploy: `GET /api/v1/health/ready` on real pods returns `200`/`ok` for every replica,
      not just the first one to come up
- [ ] Post-deploy: `patheya:http_requests_errors:rate5m` (Grafana) has not spiked relative to the
      pre-deploy baseline

## 2. Rollback checklist

Full mechanism-by-mechanism detail: `rollback-guide.md`. Quick-reference sequence:

- [ ] Identify which of the three rollback types applies — application code / database schema /
      GitOps image-tag bump (`rollback-guide.md` §1-3) — conflating them is the most common way a
      rollback makes an incident worse
- [ ] `argocd app rollback backend-<environment>` to the prior revision — never `kubectl rollout
      undo` against a GitOps-managed Deployment
- [ ] If a migration shipped the problem: prefer rolling back the application first (additive
      migrations mean old code tolerates the newer schema) before touching the schema itself
- [ ] Re-run `smoke-test.ts` against the rolled-back revision before declaring the incident
      resolved — the same verification a fresh deploy should have passed in the first place
- [ ] Confirm the `patheya-express.io/git-commit` pod annotation matches the expected
      rolled-back commit (`operations-guide.md`)
- [ ] Watch `patheya:http_requests_errors:rate5m` actually drop before closing the incident

## 3. Incident response checklist

Full per-scenario triage: `incident-runbooks.md` (Redis/database/queue/worker/dispatch/
payment/storage/deployment) and `runbook.md` (alert-driven). First-response sequence for any
production incident:

- [ ] Confirm which layer is actually broken — `GET /api/v1/health/ready`'s per-field breakdown
      (`database`/`redis`/`queues`/`storage`) is the fastest first check
- [ ] Check `GlobalExceptionFilter`'s structured `EXCEPTION` logs for the failing route/error
      class if it's HTTP-facing
- [ ] Identify the matching runbook in `incident-runbooks.md` by symptom, follow its Diagnosis →
      Metrics → Logs → Recovery steps in order
- [ ] If genuinely a data-layer incident (Aurora/ElastiCache), escalate per `runbook.md`'s
      Escalation section — this repo's runbooks stop at "confirm which layer is broken"
- [ ] Log the incident timeline (what fired, what was checked, what fixed it) for the postmortem —
      not optional for anything that paged someone

## 4. Disaster recovery checklist

Full recovery procedures: `disaster-recovery.md`. Verification sequence for a DR drill or a real
event:

- [ ] Aurora/infra-level failover or restore — owned by `patheya-express-terraform`, not this
      repo; coordinate per `disaster-recovery.md`'s "real infrastructure DR strategy" section
- [ ] Application-workload recovery after an infra-level failover: `disaster-recovery.md`'s
      "Recovering the application workloads" section, step by step
- [ ] Redis-specific recovery (no Aurora impact): `disaster-recovery.md`'s "Recovering from a
      Redis wipe" section — confirms which application state is NOT Redis-durable and needs
      re-establishing (presence, in-flight Socket.IO room membership)
- [ ] After recovery: confirm every BullMQ repeatable scheduler re-registered correctly
      (`patheya_bullmq_jobs_waiting`/`oldest_waiting_job_age_seconds` per queue back to normal)
- [ ] After recovery: confirm Socket.IO cross-pod fanout works again (two real clients on
      different pods, one action, both receive the realtime push) — see `socketio.md`
- [ ] **Outstanding, not yet drilled** (`go-live-checklist.md`): a real Aurora restore drill timed
      against the documented RPO/RTO targets has never been executed in any phase to date — this
      remains real, unfinished work, not a formality

**Graceful shutdown / rolling restart (Production Readiness Stage D):** `PrismaService`/
`RedisService` disconnect on `onApplicationShutdown`, not `onModuleDestroy` — verified against
`@nestjs/core`'s actual shutdown-phase ordering (`callDestroyHook → callBeforeShutdownHook →
dispose() → callShutdownHook`) that the earlier `onModuleDestroy` placement tore down Prisma/Redis
*before* the HTTP server drained and *before* `@nestjs/bullmq`'s own graceful `Worker.close()`
drain ran — a real risk of spurious failures on in-flight requests/jobs during every rolling
deploy. Fixed; not independently re-verified via a live OS SIGTERM in this pass (this session's
Windows/git-bash sandbox cannot reliably deliver a real POSIX SIGTERM to a Node process — an
already-documented platform limitation from an earlier stage). Worth a real verification the next
time this runs in an actual Linux container/k8s pod: send SIGTERM mid-request, confirm the request
completes with 200 rather than a Prisma "engine not connected" error.

## 5. Scaling checklist

Evidence and current limits: this report's Phase 7 (capacity planning) and `operations-guide.md`'s
"Scaling" section.

- [ ] Confirm HPA is actually the lever being hit, not a Karpenter/node-capacity ceiling —
      `kubectl describe pod` for `FailedScheduling` events before assuming the app needs more
      replicas
- [ ] API replicas: currently `minReplicas: 2, maxReplicas: 10` (`k8s/base/api-gateway/hpa.yaml`)
      — CPU+memory scaling. Confirm current CPU/memory utilization against the trigger threshold
      before manually overriding
- [ ] Worker replicas: currently `minReplicas: 2, maxReplicas: 8` (`k8s/base/workers/hpa.yaml`)
      — also CPU+memory, **not** queue-depth-based yet (`known-issues.md`'s documented gap — would
      need the Prometheus Adapter, a new platform component, explicitly out of scope for an
      audit/hardening pass)
- [ ] Before raising `maxReplicas` on either: check Redis connection headroom (see this report's
      Phase 7 — each additional API replica adds ~10 Redis connections, each worker replica adds
      ~18) and Postgres connection headroom (Prisma's default per-pod pool is `cpus*2+1`; no
      explicit `connection_limit` is set on `DATABASE_URL` today)
- [ ] Scaling a queue's *throughput* specifically (not just replica count): check whether the
      bottleneck is BullMQ concurrency (per-replica, `@Processor(..., {concurrency: N})`) or
      replica count — raising replica count doesn't help a queue that's already
      concurrency-starved within each replica, and vice versa

## 6. Monitoring checklist

Full metric catalog: `operations-guide.md`'s "Metrics to actually watch" table. Dashboard/alert
recommendations: `observability-dashboard-alert-recommendations.md`.

- [ ] Confirm `/metrics` is actually being scraped — `kubectl get servicemonitor,podmonitor -n
      patheya-backend`, then check Prometheus's own Targets page
- [ ] Confirm the response is real Prometheus exposition text, not JSON-wrapped (`curl -s
      <pod>/metrics | head -1` should start with `# HELP`, not `{` — regression-guarded by
      `smoke-test.ts`'s `metrics:endpoint` check as of Production Readiness Stage B, after a real
      bug where the global response interceptor was silently wrapping this endpoint)
- [ ] Confirm Grafana's "Application Overview" dashboard shows real, moving data — **flagged in
      `go-live-checklist.md` as never confirmed against a real Prometheus to date**
- [ ] Confirm PagerDuty/Slack alert routing is real, not placeholder no-op behavior (same
      go-live-checklist flag)
- [ ] Spot-check that labeled Counters/Histograms with zero traffic show `# HELP`/`# TYPE` lines
      with no data rows (expected prom-client behavior, not a bug) vs. genuinely missing metrics

## 7. Production verification checklist

The first real end-to-end pass before/immediately after launch — **`go-live-checklist.md` flags
this as never executed against a real environment in any phase to date**; this is the concrete
sequence for whoever finally runs it:

- [ ] Registration → login → JWT refresh
- [ ] Restaurant onboarding → menu CRUD → Cloudinary image upload
- [ ] Cart → checkout → Razorpay payment (real sandbox/test-mode credentials, not mocked)
- [ ] Order lifecycle: placed → confirmed → preparing → ready → assigned → picked up → delivered
- [ ] Dispatch: automatic assignment finds and offers to a real available partner
- [ ] Realtime: order-tracking Socket.IO events actually reach a connected client, across pods
      (two pods, sticky-session-independent — the Redis adapter is what makes this work)
- [ ] Notifications: at least one push/notification actually delivered end-to-end
- [ ] BullMQ: confirm at least one job of each type (`dispatch-assignment`, `send-notification`,
      `order-acceptance-timeout`, plus a repeatable scheduler tick) completes successfully,
      visible in `patheya_bullmq_jobs_completed_total`
- [ ] Admin: an audit-logged admin action (suspend user, approve restaurant) actually appears in
      the audit log
- [ ] `GET /api/v1/health/ready` returns `200` on every replica, not just one
