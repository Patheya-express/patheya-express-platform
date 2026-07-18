# Health checks

Three endpoints under `apps/api-gateway/src/modules/health/`, all prefixed `/api/v1`:

| Endpoint | Purpose | Checks | Used by |
| --- | --- | --- | --- |
| `GET /health` | General status/diagnostics | DB, Redis, WebSocket (informational) | humans, dashboards |
| `GET /health/live` | Liveness | Nothing — process-only | Docker `HEALTHCHECK`, K8s `livenessProbe`/`startupProbe` |
| `GET /health/ready` | Readiness | DB, Redis, BullMQ queues' Redis connection, storage | K8s `readinessProbe`, load balancer target health |

**Liveness deliberately checks nothing but process health** — a transient DB or Redis blip
shouldn't make an orchestrator kill and restart an otherwise-healthy process; that's what
readiness is for. Restarting on a dependency blip would just add container-churn on top of an
already-degraded dependency.

## Readiness contract

```json
{
  "status": "ok | degraded",
  "database": "connected | disconnected",
  "redis": "connected | disconnected",
  "queues": "connected | disconnected",
  "storage": "connected | disconnected",
  "timestamp": "..."
}
```

Returns `200` when every field is `connected`, `503` (with a summary in the error message) otherwise.

- **database** — `SELECT 1` via Prisma.
- **redis** — `PING` via the shared ioredis client.
- **queues** — BullMQ's `notifications` queue's underlying Redis client status (every queue shares
  one Redis connection registered via `BullModule.forRoot`, so checking one is representative).
  2-second timeout so an unreachable Redis can't hang the probe.
- **storage** (new in this phase) — cheap, not a real network call:
  - `local` driver: confirms `./uploads` exists and is writable (`fs.access`).
  - `cloudinary` driver: confirms `CLOUDINARY_CLOUD_NAME`/`API_KEY`/`API_SECRET` are all set — no
    live API call, so the probe stays fast and can't be rate-limited by Cloudinary on a tight
    probe interval.

## General health contract

Adds a `websocket` field (`ready | not_ready`) — confirms the Socket.IO server is bound to the
HTTP server (`RealtimeService.isReady()`). This is informational only, not readiness-gating:
Socket.IO shares the api-gateway process, so if the process is up, the gateway is trivially
present; the field exists for dashboards/diagnostics, not for K8s decision-making.

## K8s probe wiring

See `k8s/base/api-gateway/deployment.yaml` and `k8s/base/workers/deployment.yaml`:

- `startupProbe` → `/health/live`, generous `failureThreshold: 30` at `periodSeconds: 2` (up to a
  minute for cold start — Prisma engine init, first Redis connect) — the much stricter liveness
  probe doesn't start counting failures until this passes.
- `readinessProbe` → `/health/ready`, every 10s.
- `livenessProbe` → `/health/live`, every 15s.
