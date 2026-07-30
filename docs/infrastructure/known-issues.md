# Known issues

Every genuine gap or inconsistency this phase found and either fixed or deliberately left for a
documented reason — consolidated here so it isn't only discoverable by reading commit-by-commit
comments across two repos.

## Fixed in this phase

- **Two real OIDC/Sigstore identity bugs** (Terraform repo, `modules/iam`/
  `modules/supply-chain-security`): the GitHub org login was hardcoded all-lowercase; the frontend
  repo's real name is `frontend`, not `patheya-express-frontend`. Fixed in Phase 8, re-verified
  still correct in this phase.
- **Frontend's own Kubernetes namespace bug** (`patheya-express-dev/staging/prod` instead of
  Terraform-owned `patheya-frontend`) — identical to a bug already fixed for the backend in an
  earlier phase; found and fixed the same way in Phase 8, unaffected by this phase.
- **Backend's Ingress/CORS domains were `.example.com` placeholders** inconsistent with the real
  `patheyaexpress.com` apex — fixed in this phase across `k8s/base/ingress.yaml` and all three
  overlays' `CUSTOMER_APP_URL`/etc.
- **Frontend's own Ingress domains used `.patheyaexpress.example`** (a placeholder TLD) — fixed to
  `.com` in this phase, across all four apps' base Ingress objects and all three overlays' patches.
- **Local `secretGenerator` placeholder secrets retired** — `api-gateway-secrets` (sourced from
  `secret.env.example`) replaced by three real ExternalSecret-produced Secrets
  (`backend-database-url`, `backend-redis-credentials`, `backend-app-secrets`).
- **Redis had no TLS/AUTH/retry configuration** despite ElastiCache already requiring both — fixed
  via `redis-connection.config.ts`, shared by `RedisService`, BullMQ's connection, and the Socket.IO
  Redis adapter's pub/sub clients.
- **No standalone worker process existed** — `worker-main.ts`/`WorkerModule` built, closing a gap
  flagged since Phase 1A's own audit.
- **Socket.IO had no Redis adapter** (cross-pod fanout never worked, only nginx sticky sessions
  papered over it) and **hardcoded `cors: { origin: '*' }`** — both fixed.

## Deliberately not fixed — documented, not silent

- **Frontend's Ingress subdomain naming (`customer`/`restaurant`) doesn't match
  `cloud-architecture-blueprint.md` Section 4's own example (`app`/`partner`)**, and frontend's
  env-prefix ordering (`dev.customer.patheyaexpress.com`) differs from the backend's
  (`api.dev.patheyaexpress.com`, matching the blueprint's Section 6 convention exactly). Not
  renamed in this phase — doing so touches TLS SANs, ExternalDNS-managed records, and would be a
  real, risk-bearing restructure of already-built frontend Ingress objects, not a bounded
  "integrate the application" task. Flagged for an explicit decision, not guessed at.
- **A pre-existing `ci-deployer` RBAC identity in the frontend repo**
  (`infrastructure/kubernetes/base/rbac-ci-deployer.yaml`) grants direct kubectl-apply-style
  permissions — contradicts this platform's entire GitOps mandate. Not used by any workflow this
  or the prior phase built; not removed either, since deleting security RBAC is a decision better
  made explicitly than as a drive-by side effect of a workload-deployment phase.
- **Frontend's `infrastructure/kubernetes/platform/` directory** (cert-manager ClusterIssuers,
  ExternalDNS, metrics-server, RBAC) duplicates what `patheya-express-terraform`'s Terraform-managed
  EKS add-ons already own — never migrated into the gitops repo (Phase 8) or touched by this phase,
  flagged for a future ownership decision.
- **`worker`'s HPA scales on CPU/memory, not queue depth** — the metric
  (`patheya_bullmq_queue_depth`) exists as of this phase, but wiring a custom-metrics HPA needs the
  Prometheus Adapter, a new platform component this phase's scope explicitly excludes.
- ~~3 of 6 BullMQ queues (`payments`, `search`, `tickets`) have no `@Processor`~~ — **fixed**, no
  longer accurate: `PaymentReconciliationProcessor`, `TrendingSearchProcessor`, and
  `TicketEscalationProcessor` now consume all three (Production Readiness — BullMQ producer/
  consumer separation). A sustained backlog on any of the six queues is a genuine signal now, not
  an expected gap — see `docs/infrastructure/incident-runbooks.md`'s "Queue backlog" runbook.
- **`BANK_ACCOUNT_ENCRYPTION_KEY` has no Secrets Manager entry** — optional/enforced-at-point-of-use
  today, so nothing fails yet, but no code path decrypting a restaurant bank account can work until
  one is added (`patheya-express-terraform`'s `docs/secrets-guide.md` documents the gap).
- **`kustomize edit set label` was deliberately not used to dynamically stamp
  `app.kubernetes.io/version`** — a labels-transformer risks also touching a Deployment's
  `spec.selector.matchLabels` (immutable; a dynamic value there breaks every future rollout). The
  label stays a static `"unset"` placeholder (satisfies Kyverno's presence check); only the
  `patheya-express.io/git-commit`/`build-id` *annotations* are dynamically stamped per deploy
  (annotations carry no selector risk).
- **3 stale `namespace.yaml` files remain on disk** in the frontend repo's overlay directories
  (unreferenced by their `kustomization.yaml`, hence inert) — a `Bash rm` was denied by this
  session's permission classifier; delete them manually.
- **Repo-wide pre-existing lint debt**: `backend-ci.yml`'s `lint:ci` gate (`--max-warnings=0`,
  Phase 8) would fail on ~680 pre-existing findings unrelated to any phase's actual changes
  (`no-unsafe-*`/`any`-typing across many controllers/services/repositories). Not a Phase 9
  regression — it predates this phase and was only discovered by actually running the linter for
  real. Needs an explicit remediation decision (bulk fix, or relax the gate with a tracked ADR)
  before `backend-ci.yml` can pass on an unrelated PR.
