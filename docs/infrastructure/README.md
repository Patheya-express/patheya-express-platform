# Infrastructure — Phase 1A

Backend infrastructure audit and Kubernetes platform build-out for `apps/api-gateway`, matching the
frontend repo's Phase 0/1 infra maturity. Scope was strictly infrastructure — no business logic,
API, Prisma schema, or auth changes. See the other guides in this directory for details:

- [`docker.md`](./docker.md) — Dockerfile, Docker Compose (dev + prod-rehearsal)
- [`kubernetes.md`](./kubernetes.md) — the Kustomize-based `k8s/` platform
- [`health-checks.md`](./health-checks.md) — liveness/readiness contract
- [`workers.md`](./workers.md) — how BullMQ background processing is deployed
- [`socketio.md`](./socketio.md) — realtime/WebSocket scaling constraints
- [`disaster-recovery.md`](./disaster-recovery.md) — backup/restore and failure-mode notes

## Audit findings

**Already solid before this phase** (reused as-is): multi-stage non-root Dockerfile with a
`HEALTHCHECK`, liveness/readiness endpoints checking DB/Redis/queues, helmet + compression + a real
CORS allowlist, global validation pipe, structured Winston JSON logging, request-id middleware,
comprehensive Joi env validation.

**Gaps closed by this phase:**

| Gap | Fix |
| --- | --- |
| No graceful shutdown (`SIGTERM` never disconnected Prisma/Redis) | `app.enableShutdownHooks()` + bounded shutdown handler in `main.ts` |
| No `trust proxy` — rate limiting saw the ingress's IP, not the client's | `app.set('trust proxy', 1)` |
| Winston file transports wrote to ephemeral pod disk, unrotated | `LOG_TO_FILE` env gate (default on, off in every K8s overlay) |
| `.env.example` files were silently git-ignored by an overly broad `.gitignore` rule, never actually committed | Added `!.env.example` / `!**/.env.example` exceptions |
| Two duplicate `docker-compose.yml` files (one stray, inside `src/`) | Removed the stray copy, rebuilt the canonical one |
| No Docker Compose healthchecks, named project, or app/worker services | Added to `infrastructure/docker/docker-compose.yml` + new `docker-compose.prod.yml` |
| No Kubernetes manifests at all | New `k8s/` (Kustomize base + development/staging/production overlays) |
| Readiness didn't check storage reachability | Added `StorageProvider.checkHealth()` + `storage` field on `/health/ready` |
| stale `start:prod` npm script (`dist/main`, actual output is `dist/src/main.js`) | Fixed |
| `docker-compose.yml`'s `CLOUDINARY_*`/`RAZORPAY_*` vars defaulted to `${VAR:-}` (empty string), which Joi's `.optional()` rejects (allows *absent*, not *empty*) — the container crash-looped on first live validation | Switched Cloudinary vars to bare passthrough (real value or fully absent, never empty); see the Razorpay row below for why that one needed an actual default instead |

**Known limitations, not fixed in this phase** (see the linked guides for why and what to do about
them in Phase 2):

- Socket.IO has no Redis adapter → cross-pod fanout doesn't work; mitigated with Ingress session
  affinity. See [`socketio.md`](./socketio.md).
- BullMQ workers run in-process with the HTTP app (no standalone worker entrypoint exists in the
  code) → the K8s `workers` Deployment is the same image, scaled independently, just excluded from
  external traffic rather than a truly separate process. See [`workers.md`](./workers.md).
- `KAFKA_BROKER` is a required env var and `kafka`/`zookeeper` remain in Docker Compose, but no
  application code uses Kafka anywhere (no client dependency, no import) — dead infrastructure,
  left in place for backward compatibility. Candidate for removal once someone confirms it's
  genuinely unused, which is an application/env-validation decision outside this phase's scope.
- `apps/customer-app` in this repo is an empty Angular stub (no Dockerfile/CI/k8s) — it is not the
  "already Kubernetes-ready frontend" referenced by the task brief, which must live in a separate
  repository. No parity work was attempted against it.
- No CI pipeline — `docs/deployment.md` already flagged this as out of scope before this phase;
  unchanged.

**Bug found during live validation, not fixed (business logic, out of scope):**
`RazorpayProvider` (`apps/api-gateway/src/modules/payments/providers/razorpay.provider.ts:11-16`)
constructs the Razorpay SDK client unconditionally in its constructor, reading
`process.env.RAZORPAY_KEY_ID!`/`RAZORPAY_KEY_SECRET!` directly (non-null-asserted, not through
`ConfigService`, not validated by `env.validation.ts`, not lazy like `CloudinaryStorageProvider`'s
`configure()`). Reproduced live: the container crash-loops on boot in *any* environment without
real-looking Razorpay keys — contradicting `docs/deployment.md`'s framing of Razorpay as a
production-only requirement and `env.validation.ts`'s silence on it (it isn't in the Joi schema at
all, so nothing catches a missing value before the raw SDK error). Worked around at the infra layer
only: `infrastructure/docker/docker-compose.yml` now supplies a dev-mode placeholder default so
`docker compose up` works out of the box. The actual fix (lazy construction, mirroring
`CloudinaryStorageProvider`) is an application-code change for the payments module, out of scope here.

## Readiness scoring

**Kubernetes readiness: 8/10.** Full Kustomize base + 3 overlays, probes, HPA/PDB/NetworkPolicy/
PriorityClass/RBAC-via-least-privilege all present and validated to render cleanly
(`kubectl kustomize`, all 4 configurations, zero warnings after fixing one deprecated-field usage
found along the way). Points held back: no live cluster was available to `kubectl apply`/exercise
this against — the manifests are proven well-formed, not proven to behave correctly under a real
scheduler/CNI (see `docs/infrastructure/kubernetes.md` §Validation) — and Socket.IO multi-pod
fanout is a real functional gap under horizontal scaling until the Redis adapter is added in
application code.

**Infrastructure maturity: 9/10.** Docker/Compose/health/shutdown/logging were all validated live,
not just reviewed: built the hardened image, ran the full `docker compose` stack (Postgres, Redis,
api-gateway), and confirmed all three health endpoints respond correctly (`200` with the new
`storage`/`websocket` fields populated) and that `SIGTERM` triggers the new graceful-shutdown log
line. That process also caught two real bugs before they'd have hit a cluster — the compose
empty-string/Joi issue and the pre-existing Razorpay eager-construction bug (see above) — both
addressed or documented. Point held back for the pre-existing Razorpay bug itself (infra-layer
workaround only, real fix is out of scope) and the absence of CI (explicitly deferred, not a
regression from this phase).

## Remaining risks before Phase 2

1. Socket.IO fanout across pods (functional bug under >1 replica today, masked by sticky sessions).
2. No true process isolation for workers (resource contention between HTTP and queue processing
   isn't fully separated — see `workers.md`).
3. Dead Kafka infra should be either wired up or formally removed (env validation still requires it).
4. Production overlay's `secretGenerator` still points at placeholder values — a real secret
   source (sealed-secrets/external-secrets/Vault, or at minimum a gitignored per-cluster env file)
   must be wired in before any real deployment.
5. No live-cluster validation was performed (see Validation section of `kubernetes.md`).
