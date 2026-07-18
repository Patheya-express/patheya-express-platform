# Socket.IO / Realtime

`RealtimeGateway` (`apps/api-gateway/src/modules/realtime/gateways/realtime.gateway.ts`) attaches
to the same HTTP server as the REST API — every api-gateway pod runs its own independent Socket.IO
server instance.

## The gap

No `@socket.io/redis-adapter` (or any adapter) is configured. Socket.IO rooms
(`user:<id>`, `order:<id>`, `restaurant:<id>`, `ticket:<id>`, `support-queue` — see
`realtime.gateway.ts`'s `isAuthorizedForRoom`) are **per-process only**. `server.to(room).emit(...)`
(`RealtimeService`) only reaches sockets connected to the *same pod* that called it. With more than
one api-gateway replica — which every K8s overlay here runs by default — an event fired because of
work done on pod A never reaches a client connected to pod B, even if that client is in the target
room.

This is an application-code fix (adding the adapter, wiring it to the same Redis instance
`RedisService` already uses), which changes realtime fanout *behavior* — out of scope for an
infrastructure-only phase per this task's ABSOLUTE RULES.

## What was done instead (infra-layer mitigation)

`k8s/base/ingress.yaml` sets nginx cookie-based session affinity
(`nginx.ingress.kubernetes.io/affinity: cookie`, persistent mode) plus `proxy-http-version: "1.1"`
and long `proxy-read-timeout`/`proxy-send-timeout` (long-lived WebSocket connections need this —
the ingress controller's default proxy timeouts are far shorter than a realistic Socket.IO session).

**What this fixes:** a given client's connection consistently lands on the same pod across
reconnects, so the room-join state (`client.join(room)`, established per-connection in
`handleConnection`/`joinRoom`) stays valid without a Redis adapter.

**What this does NOT fix:** cross-pod fanout. If restaurant staff are connected to pod A and a
courier update triggers `emitToOrder()` on pod B (because that request happened to be routed
there), staff on pod A never receive it. Sticky sessions only help a *single* client stay
consistently connected to *one* pod — they do nothing for server-to-server event delivery between
pods.

**Also noted (audit-only, not changed):** `RealtimeGateway`'s `@WebSocketGateway({ cors: { origin:
'*' } })` is a hardcoded wildcard, inconsistent with the strict origin-allowlist `main.ts` enforces
for the REST API. Same reasoning as above — changing WebSocket CORS policy is an application
security-behavior decision, flagged here rather than silently changed.

## Phase 2 recommendation

Add `@socket.io/redis-adapter` in `RealtimeModule`/`realtime.gateway.ts`, pointed at the same Redis
`RedisService` already connects to (a pub/sub pair, per the adapter's usual setup — check whether a
second Redis connection or `ioredis`'s duplicate-connection pattern is preferred given the existing
`RedisService` shape). Once that's in place, sticky sessions become optional (nice for cache
locality, no longer required for correctness), and the `origin: '*'` CORS gap should be reconciled
with `main.ts`'s allowlist in the same pass.
