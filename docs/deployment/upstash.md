# Upstash Redis (QA)

Verifies Upstash Redis as a drop-in `REDIS_*` replacement for ElastiCache in the QA environment
only. **AWS/ElastiCache production and staging are untouched by this document or this phase** —
this is an additive review, not a migration of any real environment.

## Architecture

```
Local development   →   docker-compose's redis:7-alpine container, plain TCP, no TLS, no AUTH
QA                  →   Upstash Redis (standard Redis-protocol endpoint, TLS + AUTH mandatory)
Staging/Production  →   ElastiCache (transit_encryption_enabled=true, AUTH token, replicated)
```

Every consumer in the process — `RedisService`, BullMQ (`QueuesModule`'s `BullModule.forRoot`), and
the Socket.IO Redis adapter (`RealtimeGateway.afterInit`) — shares one function,
`getRedisConnectionOptions()` (`redis-connection.config.ts`), that builds a plain ioredis options
object from four environment variables. No consumer has its own, separate connection logic.

## Review findings

| Area | Finding |
|---|---|
| `RedisModule` | `@Global()`, single provider/export (`RedisService`) — no environment branching. |
| `RedisService` | Constructs one `new Redis(getRedisConnectionOptions())` in its constructor; exposes `get`/`set`/`del`/`getClient()`; `onModuleDestroy()` calls `this.redis.quit()`. Nothing ElastiCache-specific — a plain ioredis client. |
| `BullMQ` (`QueuesModule`) | `BullModule.forRoot({ connection: getRedisConnectionOptions() })` — same shared options function, same client shape BullMQ expects from any ioredis-compatible connection. |
| `QueueService` | Six queues (`dispatch`, `notifications`, `payments`, `search`, `tickets`, `orders`) injected via `@InjectQueue`; `checkHealth()` checks one queue's underlying client `status === 'ready'` (representative of all six, since they share one connection registered via `forRoot`). No provider-specific behavior. |
| Socket.IO Redis adapter (`RealtimeGateway.afterInit`) | Two **dedicated** ioredis clients (`pubClient` + `subClient = pubClient.duplicate()`), never the shared `RedisService`/BullMQ connections — correct, since a Redis Pub/Sub subscriber connection cannot issue any other command once subscribed. Built from the same `getRedisConnectionOptions()`. |
| Redis connection helpers (`redis-connection.config.ts`) | `host`/`port`/`password`/`tls`/`retryStrategy`/`reconnectOnError`/`maxRetriesPerRequest: null` — all plain ioredis options, all environment-variable-driven. Code comments reference ElastiCache (AUTH token convention, Amazon Trust Services cert, failover `READONLY` behavior) but every mechanism described is generic ioredis behavior, not an ElastiCache-only code path. |
| Health checks (`health.service.ts`) | `checkRedis()` calls `this.redis.getClient().ping()`, expects `'PONG'` — a standard Redis command, provider-agnostic. `QueueService.checkHealth()` similarly checks `client.status`. Both now feed into `/api/v1/health`'s real `status` field (fixed in Phase DEV-3) and `/api/v1/health/ready`'s dependency breakdown. |

**Conclusion: no ElastiCache-specific assumption exists in any of the six areas reviewed.** Every
consumer already goes through the one shared, environment-variable-driven connection function.

## Connection

**Confirmed: exactly the four environment variables the phase named are sufficient** —
`REDIS_HOST`, `REDIS_PORT`, `REDIS_AUTH_TOKEN`, `REDIS_TLS` — and no others. No code anywhere reads
an ElastiCache endpoint discovery mechanism, cluster-mode topology, or IAM-based Redis auth; the
app always connects to one host:port pair with a plain AUTH password, which is exactly Upstash's
connection model too.

## TLS

**No code changes are required.** `REDIS_TLS=true` produces `tls: {}` (ioredis's "use the default,
publicly-trusted CA trust store" option) — this already works for ElastiCache (whose certificate
chains to Amazon Trust Services) and works identically for Upstash, which also presents a
publicly-trusted TLS certificate on its standard endpoint. Upstash requires TLS on every connection
by default (no plaintext option on its cloud offering), so `REDIS_TLS=true` is mandatory for
Upstash, exactly as it already is for ElastiCache — this is a value change
(`REDIS_TLS=true` in `.env.qa.example`, already set since Phase DEV-2), not a code change.

## BullMQ compatibility

| Aspect | Review |
|---|---|
| Queue initialization | `BullModule.registerQueue(...)` — six named queues, registered against the one `forRoot` connection. No provider-specific option set anywhere (no ElastiCache cluster-mode flags). |
| Worker initialization | Every processor (`NotificationProcessor`, `AssignmentExpiryProcessor`, `OrderAcceptanceTimeoutProcessor`) extends `@nestjs/bullmq`'s `WorkerHost`, which creates its own internal BullMQ `Worker` against the shared connection options — no manual worker wiring to review beyond what's already provider-agnostic. |
| Retry behavior | BullMQ's own job-level retry/backoff (configured per-job, e.g. `addAssignmentExpiryJob`'s `delay`) is independent of which Redis the connection points at. Connection-level retry (`retryStrategy`, exponential backoff capped at 2s) is ioredis's own reconnect logic, identical regardless of provider. |
| Connection lifecycle | `maxRetriesPerRequest: null` is BullMQ's own hard requirement (documented in-code already) — required identically whether the target is ElastiCache or Upstash; this is not an ElastiCache-specific accommodation. |
| Graceful shutdown | `WorkerHost`'s built-in `onModuleDestroy()` closes the underlying BullMQ `Worker` (letting in-flight jobs finish) — triggered by the same `app.enableShutdownHooks()` wiring reviewed in Phase DEV-3, unrelated to which Redis provider is in use. |

**Important compatibility note, not a caveat against Upstash but worth being explicit about**:
BullMQ relies on Redis's blocking commands (e.g. `BZPOPMIN`) and Lua scripting (`EVAL`) for atomic
job-state transitions. This requires connecting over Upstash's **standard TCP Redis-protocol
endpoint** (exactly what `getRedisConnectionOptions()`'s `host`/`port`/`tls` already target) — it
would **not** work against Upstash's separate REST API product, which this codebase never uses.
Since the app has only ever spoken the standard Redis wire protocol via ioredis, this is already
satisfied with no code change.

## Socket.IO compatibility

`@socket.io/redis-adapter`'s `createAdapter(pubClient, subClient)` requires only standard Redis
Pub/Sub (`PUBLISH`/`SUBSCRIBE`), which Upstash's standard endpoint fully supports. No caveats found
against the adapter itself.

**Caveat worth documenting**: the two dedicated pub/sub connections `afterInit()` opens are
per-process (one pub + one sub client per running `api-gateway`/`worker` instance, not per
WebSocket client) — for QA's expected single-instance-per-service scale this is negligible, but
Upstash's pricing/connection-limit model (below, under Performance) means this is worth being
aware of before scaling QA to multiple replicas.

## Health checks

`checkRedis()` (`health.service.ts`) pings the shared `RedisService` client and reports
`'connected'`/`'disconnected'`; `QueueService.checkHealth()` reports the BullMQ connection's
`status`. Both are already wired into:
- `/api/v1/health` — `status` is `'degraded'` if Redis (or queues, or the database) is down (fixed
  in Phase DEV-3 to actually reflect this rather than a hardcoded `'ok'`).
- `/api/v1/health/ready` — returns HTTP 503 with a per-dependency breakdown if Redis is
  unreachable.

**Confirmed behavior when Redis is unavailable**: the app does not crash — `checkRedis()` and
`QueueService.checkHealth()` both catch and return `false` rather than throwing, so an Upstash
outage or network blip degrades the health/readiness endpoints' *reporting* without taking down the
process itself. ioredis's own `retryStrategy`/offline queueing (Phase DEV-3's startup-sequence
finding) means transient unavailability at connection time doesn't block `app.listen()` either.

## Validation performed

Real commands run this phase, with Upstash-shaped Redis environment variables set
(`REDIS_HOST=fake-qa-instance.upstash.io`, `REDIS_PORT=6379`, `REDIS_TLS=true`,
`REDIS_AUTH_TOKEN=placeholder-upstash-token`):

- `pnpm --filter api-gateway run build` → **succeeded** (`nest build`, no errors).
- Directly invoked the compiled `getRedisConnectionOptions()` (no network connection attempted) and
  inspected the returned object:
  ```json
  {
    "host": "fake-qa-instance.upstash.io",
    "port": 6379,
    "hasPassword": true,
    "tls": {},
    "maxRetriesPerRequest": null,
    "hasRetryStrategy": true,
    "hasReconnectOnError": true
  }
  ```
  This confirms the connection options object is built correctly from Upstash-shaped environment
  variables — TLS enabled, password present, BullMQ's required `maxRetriesPerRequest: null` intact,
  retry/reconnect logic present — **without fabricating a live connection result**. An actual TCP
  handshake against a real Upstash instance was not attempted — no Upstash account exists in this
  session, consistent with how every other QA-tier cloud service has been validated in this
  migration.

**No code changes were required or made** — confirmed by `git status` showing no modifications to
any Redis/BullMQ/Socket.IO source file this phase.

## Performance — review only, no changes made

- **Persistent connections**: this process opens up to **four** persistent Redis connections at
  steady state — one for `RedisService`, one shared by all six BullMQ queues (`forRoot`'s single
  connection), and two dedicated ones for the Socket.IO adapter (pub + sub). ElastiCache has no
  per-connection cost; Upstash's pricing (below) does account for concurrent connections, so this
  is worth knowing exactly, not just approximately.
- **Idle behavior**: ioredis's `retryStrategy` (exponential backoff capped at 2s) and
  `reconnectOnError` already handle a dropped idle connection transparently — if Upstash closes an
  idle TCP connection (a real possibility on lower-cost tiers, unlike ElastiCache's always-on
  nodes), the next command triggers a reconnect rather than an application-visible error. No code
  change needed to accommodate this; it already works this way for ElastiCache's own failover
  scenarios.
- **Connection limits**: Upstash plans (including some paid tiers) cap total concurrent
  connections. Four fixed connections per running process instance is a hard floor — running
  multiple `api-gateway`/`worker` replicas against the same Upstash instance multiplies this
  (e.g. 3 replicas × 4 connections = 12), worth checking against the specific Upstash plan's limit
  before scaling QA beyond a single instance of each service.
- **Cost considerations**: Upstash's pricing models are typically usage-based (per-command or
  per-request pricing on some tiers) rather than ElastiCache's fixed per-node-hour cost. BullMQ's
  `upsertJobScheduler`-based recurring jobs (`addPaymentReconciliationJob` every 5 min,
  `addTrendingSearchAggregationJob` every 15 min, `addTicketEscalationJob` every 30 min) plus the
  Socket.IO adapter's pub/sub traffic are recurring, predictable command volume worth estimating
  against Upstash's specific pricing tier before committing QA to it long-term — not measured in
  this review (would require a real Upstash account and real traffic).

## Known limitations

- No live Upstash connection was established in this review — no Upstash account/instance exists
  in this session. The validation above is a real, honest test of connection-options construction
  and a real build, not a fabricated live-connection result.
- Upstash's exact idle-connection-timeout and per-plan connection-limit values were not looked up
  against a specific real Upstash plan (would require picking one) — noted as "worth checking
  before scaling QA" rather than given a specific number that would otherwise need to be assumed.
- The BullMQ/REST-API distinction (above) is important enough to flag even though it isn't a
  problem for this codebase today — a future contributor reaching for Upstash's REST API client
  (e.g. for a serverless/edge use case) would break BullMQ; this code should keep using the
  standard ioredis TCP client for any Redis usage that touches queues.

## Comparison: Local Redis → Upstash → ElastiCache

| | Local Redis | Upstash (QA) | ElastiCache (staging/production) |
|---|---|---|---|
| Hosting | `docker-compose`'s `redis:7-alpine` container | Upstash managed Redis | AWS ElastiCache (replicated, `transit_encryption_enabled=true`) |
| TLS | None | Mandatory (`REDIS_TLS=true`) | Mandatory (`REDIS_TLS=true`) |
| AUTH | None (`REDIS_AUTH_TOKEN` unset, ioredis treats this as "don't authenticate") | Mandatory (`REDIS_AUTH_TOKEN` set) | Mandatory (`auth_token`, Terraform-managed, `ROTATE` update strategy) |
| Connection model | Single container, unlimited local connections | Standard Redis-protocol endpoint, plan-dependent connection cap | Direct node/cluster endpoint, no connection-count billing |
| Failover | None (single container) | Provider-managed, transparent to the app | `automatic_failover_enabled` when replicas exist; `reconnectOnError` on `READONLY` already handles the client-side transition |
| Pricing model | Free (local) | Usage-based (commands/requests, plan-dependent) | Fixed per-node-hour |
| Code path in `apps/api-gateway/src` | Identical | Identical | Identical |

Every row differs only in *how the connection is provisioned, secured, and billed*, never in
application code — confirming the same "drop-in replacement" conclusion this phase's review and
validation were asked to verify.
