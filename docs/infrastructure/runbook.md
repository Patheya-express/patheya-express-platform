# Application runbook

On-call playbook for the deployed `api-gateway`/`worker`/frontend workloads. Companion to
`patheya-express-terraform`'s `docs/incident-response.md` (supply-chain/runtime-security layer —
Kyverno/Trivy/Falco alerts) and [`../ci-cd/pipeline-troubleshooting-guide.md`](../ci-cd/pipeline-troubleshooting-guide.md)
(CI/CD pipeline failures) — this one is "the application itself is unhealthy in a running cluster."
Organized by which alert fired; [`incident-runbooks.md`](incident-runbooks.md) is the
scenario-driven companion (Redis/database/queue/worker/dispatch/payment/storage/deployment), useful
when you know *what's* broken but not yet which alert (if any) caught it.

## `Critical-ApiGateway-SLOBurnRateFast/Slow` fired

1. Check `patheya:http_requests_errors:rate5m{app="api-gateway"}` in Grafana against
   `patheya:http_requests:rate5m` — confirm it's a genuine error-rate spike, not a traffic drop
   making the ratio noisy at low volume.
2. `kubectl logs -n patheya-backend -l app.kubernetes.io/name=api-gateway --tail=200` — the
   `GlobalExceptionFilter`'s structured JSON logs name the failing route and error class directly.
3. If errors cluster on one route touching a specific dependency (DB/Redis/Cloudinary/Razorpay),
   check that dependency's own health first — `GET /api/v1/health/ready`'s per-field breakdown is
   the fastest way to confirm which one.
4. If it's a bad deploy, not a dependency: `docs/infrastructure/rollback-guide.md` — `argocd app
   rollback`, never `kubectl rollout undo`.

## `Warning-Worker-QueueDepthElevated` / rising `patheya_bullmq_queue_depth`

1. Check `worker`'s pod count and CPU/memory utilization first — if HPA hasn't scaled up despite
   headroom, that's a Karpenter/node-capacity question (`kubectl describe pod` for scheduling
   events), not a code problem.
2. Check `patheya_bullmq_jobs_failed_total{queue}` for the same queue — a backlog caused by jobs
   silently failing and retrying looks identical to one caused by genuine under-capacity until you
   check this.
3. All six queues (`dispatch`/`notifications`/`orders`/`payments`/`search`/`tickets`) have real
   processors and should always drain — a sustained backlog on any of them is a genuine signal, not
   an expected gap (`known-issues.md`'s prior note that `payments`/`search`/`tickets` had no
   processor is now fixed and stale). See `incident-runbooks.md`'s "Queue backlog" runbook for the
   full triage steps.

## `api-gateway-migrate` Job failed (blocks all deploys to that environment)

1. `kubectl logs job/api-gateway-migrate -n patheya-backend` — Prisma's own CLI output names the
   exact migration and SQL error.
2. This blocks the *entire* ArgoCD sync (PreSync hook semantics) — the Deployment rollout that
   would have followed never happens, which is the deliberate point (`docs/infrastructure/
   migrations.md`), not a secondary bug to also chase.
3. Fix forward (a corrective migration) per `migrations.md`'s "Writing a safe migration" section —
   do not hand-edit the failed migration's SQL file and re-run; Prisma's migration history expects
   append-only, immutable migration files.

## A pod is stuck `Pending`

Almost always Karpenter/node capacity, not the application: `kubectl describe pod <name> -n
patheya-backend` — a `FailedScheduling` event naming insufficient CPU/memory or an unsatisfied
`topologySpreadConstraint`/anti-affinity rule points at the actual cause. Compare against the
namespace's `ResourceQuota` (`patheya-express-terraform`'s `modules/eks-addons/namespaces.tf`) — a
quota ceiling being hit looks identical to a node-capacity problem from `kubectl describe pod`
alone.

## Realtime (Socket.IO) events aren't reaching a connected client

1. Confirm the Redis adapter actually attached: `kubectl logs -n patheya-backend -l
   app.kubernetes.io/name=api-gateway | grep "Redis adapter attached"` — one log line per pod at
   startup (`RealtimeGateway.afterInit`).
2. If the adapter attached but events still don't cross pods, check ElastiCache's own health
   (Grafana's "Redis" dashboard, CloudWatch-sourced) — the adapter's pub/sub channel depends on the
   same ElastiCache cluster everything else does.
3. Confirm the client actually re-joined its room after any reconnect — `join-room` is a per-
   connection action (`RealtimeGateway.joinRoom`), not something the server remembers across a
   disconnect/reconnect cycle by itself.

## `backend-app-secrets`/`backend-database-url`/`backend-redis-credentials` missing or stale

1. `kubectl get externalsecret -n patheya-backend` — check `STATUS` and `LAST REFRESH TIME`.
2. `kubectl describe externalsecret backend-app-secrets -n patheya-backend` — a sync failure
   (wrong IAM permissions, a source secret in the wrong JSON shape) shows in `Events`.
3. Cross-check the source Secrets Manager entry's shape against `patheya-express-terraform`'s
   `docs/secrets-guide.md` — a key-name mismatch there produces an empty (not missing) environment
   variable in the pod, which fails much less obviously than a missing Secret would.

## Escalation

Anything touching the data layer directly (Aurora/ElastiCache health, a required failover) escalates
to whoever owns `patheya-express-terraform`'s infrastructure — this runbook's job stops at "confirm
which layer is actually broken," matching the same first-question discipline as that repo's own
`docs/incident-response.md`.
