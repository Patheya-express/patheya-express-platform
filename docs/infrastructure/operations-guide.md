# Application operations guide

Day-to-day operation of the deployed `api-gateway`/`worker`/frontend workloads — companion to
[`deployment-guide.md`](deployment-guide.md) (how it gets deployed) and
[`../ci-cd/pipeline-troubleshooting-guide.md`](../ci-cd/pipeline-troubleshooting-guide.md) (pipeline
problems, not runtime ones).

## Health endpoints

| Endpoint | Checks | Used by |
| --- | --- | --- |
| `GET /api/v1/health/live` | Nothing — process-only | `startupProbe`/`livenessProbe` |
| `GET /api/v1/health/ready` | Database, Redis, Queues, Storage | `readinessProbe` |
| `GET /api/v1/health` | Same as `/ready` plus Socket.IO gateway status | Manual/dashboard use |
| `GET /metrics` | N/A — Prometheus scrape target (Phase 9) | `ServiceMonitor`/`PodMonitor` |

`worker`'s `/health` reports `websocket: "not_applicable"` (Phase 9's `HealthService` change) —
expected, not a bug: the worker process imports `RealtimeModule` for its processors' own event
emission but never accepts inbound Socket.IO connections itself.

## Metrics to actually watch

| Metric | What it tells you |
| --- | --- |
| `patheya_http_requests_total{app,method,route,status}` | Request volume/error rate per route — feeds `Critical-ApiGateway-SLOBurnRateFast/Slow` |
| `patheya_http_request_duration_seconds{app,method,route}` | Latency — feeds the p95/p99 recording rules already built in Phase 5 |
| `patheya_bullmq_queue_depth{queue}` | Backlog per queue — a sustained climb on `dispatch`/`orders` means processing can't keep up with intake |
| `patheya_bullmq_jobs_failed_total{queue}` | Feeds `Warning-Worker-JobFailed-<queue>` |
| `patheya_process_*` | Node process defaults (`prom-client`'s `collectDefaultMetrics`) — event loop lag, heap, GC |

Grafana's "Application Overview" dashboard (`patheya-express-terraform`'s
`modules/observability/grafana-dashboards.tf`) was built in Phase 5 *before* these metrics existed
— it should show real data now for the first time; if it doesn't, confirm the ServiceMonitor/
PodMonitor actually got created (`kubectl get servicemonitor,podmonitor -n patheya-backend`) and
that Prometheus picked it up (`kubectl port-forward` to Prometheus, check Targets page).

## Scaling

HPA (CPU+memory for `api-gateway`, `k8s/base/api-gateway/hpa.yaml`; CPU-only for frontend apps) is
the primary lever — Karpenter (Terraform, Phase 3) provisions nodes to match. If HPA is scaling but
pods stay `Pending`, that's a Karpenter/node-capacity problem, not an application problem — check
`kubectl describe pod` for scheduling events before assuming the app itself is broken.

`worker`'s HPA is independent of `api-gateway`'s — queue depth (not HTTP load) is the signal that
should actually drive it; today it scales on CPU/memory like `api-gateway` (no custom-metrics HPA
on `patheya_bullmq_queue_depth` yet) — a reasonable next improvement, not built in this phase since
it would require the Prometheus Adapter (a new platform component, out of this phase's "no new
platform technologies" scope).

## Common operational tasks

- **Restart a stuck pod**: `kubectl rollout restart deployment/api-gateway -n patheya-backend` —
  or, preferably, let ArgoCD do it via a trivial GitOps PR so the action is Git-tracked
  (`platform-standards.md` Section 1 principle 5).
- **Check what's actually deployed**: `kubectl get pods -n patheya-backend -o
  jsonpath='{.items[*].metadata.annotations.patheya-express\.io/git-commit}'` — every pod's
  git-commit/build-id annotation traces back to the exact CI run that built it (Phase 9's
  extension to `gitops-image-update`).
- **Investigate a failing readiness probe**: `kubectl exec` into the pod is explicitly *not* the
  first move (`platform-standards.md` Section 1 principle 6) — `curl` the pod's own `/health/ready`
  via `kubectl port-forward` first, read the response body's per-dependency breakdown
  (`database`/`redis`/`queues`/`storage`), and go straight to whichever one is failing.

## Ownership boundaries, restated for this phase

This repo's `k8s/` (and the frontend repo's `infrastructure/kubernetes/`) are the **source
templates** — the actually-deployed, ArgoCD-reconciled copies live in
`patheya-express-gitops/applications/{backend,frontend}/`. A structural change (new probe, new
resource limit, new volume) needs updating both copies in sync; an image-tag/annotation bump only
ever touches the gitops repo copy, done exclusively by CI (never by hand).
