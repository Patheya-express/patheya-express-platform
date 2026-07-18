# Workers (BullMQ)

## Current application architecture

`QueuesModule` (`apps/api-gateway/src/infrastructure/queues/queues.module.ts`) is `@Global()` and
registers six BullMQ queues (`notifications`, `dispatch`, `payments`, `search`, `tickets`,
`orders`) plus their processors in the **same NestJS module graph** as every HTTP controller —
there is only one `main.ts` entrypoint, and it always starts both the HTTP server and every queue
processor together. The processors depend directly on business services
(`OrdersService`, `NotificationsService`, `DispatchRepository`, ...), which in turn pull in most of
the rest of the app's module graph.

Splitting this into a truly separate worker process (a second bootstrap file that starts only the
queue graph, no HTTP listener) is an **application architecture change** — out of scope for this
infrastructure-only phase. It's a reasonable Phase 2 candidate; see the recommendation below.

## What was built instead

`k8s/base/workers/deployment.yaml` is a second `Deployment` running the **identical image**:

- Its own `HorizontalPodAutoscaler`, `PodDisruptionBudget`, `ServiceAccount`, resource
  requests/limits, `PriorityClass` — genuinely independent scaling and disruption policy, as
  Step 11 requires.
- **No `Service`, no `Ingress` attachment** — nothing routes external HTTP traffic to it. In
  practice, it's a pure BullMQ-processing pool even though the binary it runs is technically
  HTTP-capable.
- Liveness/readiness probes still target the same `/api/v1/health/*` endpoints — this is
  convenient (zero extra code) since the worker pods are still full app instances; a probe hitting
  `/health/ready` correctly reflects whether *this* replica's DB/Redis/queue connections are
  healthy, which is exactly what you'd want gating whether it stays in rotation for job processing
  too (K8s doesn't route jobs, but an unhealthy pod should still be recycled).

The equivalent exists in Docker Compose: `infrastructure/docker/docker-compose.yml`'s opt-in
`worker` profile and `docker-compose.prod.yml`'s `worker` service — same pattern, same image, no
published port.

## Trade-offs of this approach

**What you get for free:** independent scaling (add worker replicas without adding HTTP capacity
and vice versa), independent disruption budgets, zero code risk, zero divergence between the HTTP
and worker binaries (one image, one build, one thing to patch/update).

**What you don't get:** true resource isolation. Every worker pod still runs an Express server,
Socket.IO gateway, and the full Nest DI container for controllers it'll never route to — extra
memory/startup-time overhead per pod compared to a lean queue-only process. It also still binds
port 3000 and could technically serve HTTP if something misconfigured routed traffic to it (low
risk in practice: no Service/Ingress references it).

## Phase 2 recommendation

Add a second bootstrap entrypoint (e.g. `worker-main.ts`) that calls
`NestFactory.createApplicationContext(WorkerModule)` instead of `NestFactory.create(AppModule)` +
`app.listen()` — a `WorkerModule` importing only `ConfigModule`, `PrismaModule`, `RedisModule`, and
`QueuesModule` (dropping `RealtimeModule`, controllers, and every other HTTP-only concern). This
is an additive, non-breaking change (a new file + a new slim module), but it's still an
application-code decision that deserves its own review — not bundled into an infra-only phase.
