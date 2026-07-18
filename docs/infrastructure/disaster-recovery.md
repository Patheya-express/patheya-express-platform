# Disaster recovery — application workload steps

**Phase 9 update**: this document originally described Phase 1A's pre-AWS state ("no backup
automation, no tested restore procedure... this repo not provisioning a managed service"). That's
no longer true — `patheya-express-terraform`'s Aurora/ElastiCache modules (Phase 4) and the
blueprint's own Section 12 now define the real backup/replication/failover strategy. This document
is the **application-workload-specific** companion to that infrastructure-level strategy: what to
actually do, in this repo and the gitops repo, during a real incident. Phase 1A's original
content is kept below under "Historical (Phase 1A) notes," corrected where it's now simply wrong,
not deleted.

## The real infrastructure DR strategy (reference, not owned by this repo)

- **RPO ≤ 5 minutes, RTO ≤ 60 minutes** at current (pilot-light) scale — blueprint Section 12.
- **Aurora**: automated backups, 35-day point-in-time recovery, nightly cross-region snapshot copy
  to the DR account, Aurora Global Database replication (~1s lag) once warm-standby is adopted.
- **ElastiCache Redis**: treated as rebuildable, not a system of record (unchanged from Phase 1A's
  original assessment — still correct) — BullMQ job state lost on a full Redis wipe means in-flight
  delayed jobs (`assignment-expiry`, `order-acceptance-timeout`) silently don't fire; see
  "Recovering from a Redis wipe" below for what that actually requires.
- **Failover**: manual-trigger, human-confirmed — never automatic (blueprint Section 12's own
  reasoning: a false-positive automatic failover is worse than a slower, confirmed one).

Full procedure ownership: `patheya-express-terraform`'s docs. This document starts where that one
stops — once the data layer is confirmed healthy (or a failover/restore there is already underway),
what does this repo's own workload need?

## Recovering the application workloads after an infrastructure-level failover/restore

1. **Confirm the new/restored Aurora and Redis endpoints are what `backend-database-url` and
   `backend-redis-credentials` (External Secrets Operator, `modules/eks-addons/external-secrets.tf`)
   actually point at.** These Secrets template the connection string from Terraform outputs/Secrets
   Manager values — if a failover changed which endpoint is primary, the fix happens at the
   Terraform/Secrets Manager layer (re-apply or re-populate), not by hand-editing anything in this
   repo or the gitops repo. `refreshInterval: 1h` on both ExternalSecrets means a change propagates
   into the cluster within an hour on its own; force it sooner with
   `kubectl annotate externalsecret backend-database-url force-sync=$(date +%s) --overwrite -n patheya-backend`
   (same for `backend-redis-credentials`).
2. **Restart api-gateway/workers to pick up the refreshed Secret**: External Secrets Operator
   updates the underlying Kubernetes `Secret` object, but a running pod's already-injected
   environment variables don't change until the pod restarts (env vars are set at container start,
   never live-reloaded) — `kubectl rollout restart deployment/api-gateway deployment/worker -n
   patheya-backend`, or open a trivial GitOps PR (e.g. bumping a no-op annotation) to get ArgoCD to
   do the same restart through the normal path.
3. **Re-run the migration Job if the restore point predates a migration that's already merged**:
   `k8s/base/api-gateway/migrate-job.yaml`'s PreSync hook only runs automatically on the *next*
   ArgoCD sync — after a restore, force one (`argocd app sync backend-<environment>`) rather than
   waiting for the next real deploy, so schema and restored data are confirmed consistent before
   traffic resumes.
4. **Validate readiness before considering the incident resolved**: `GET /api/v1/health/ready` on
   a real pod (not just "the Deployment shows Ready") — it checks Database, Redis, Queues, and
   Storage together, which is exactly the four things a data-layer incident could have left in a
   half-recovered state.

## Recovering from a Redis wipe specifically (no Aurora impact)

Since BullMQ job state is genuinely rebuildable but not automatically reconciled:

1. Any `payment-reconciliation`/`trending-search-aggregation`/`ticket-escalation` repeatable job
   (`QueueService.upsertJobScheduler`) re-registers itself automatically the next time
   `workers` restarts and its owning service runs its normal startup path — no manual action.
2. One-shot delayed jobs (`assignment-expiry`, `order-acceptance-timeout`) that were in-flight at
   the time of the wipe are genuinely lost — there is no queue-side record to replay them from.
   The compensating control is the underlying business state in Aurora (an `Order` stuck in
   `PENDING_ACCEPTANCE` past its expected timeout, an `Assignment` stuck unconfirmed) — a manual
   query against Aurora for orders/assignments past their expected timeout with no corresponding
   completed job is the actual recovery step, escalated to on-call, not automated by this phase.
3. Socket.IO's Redis adapter (Phase 9) has no persistent state to recover — a wipe just means every
   currently-connected client's room membership is gone until it reconnects and rejoins (the
   client-side reconnect logic already handles this as an ordinary disconnect).

## Rollback

See [`docs/ci-cd/promotion-guide.md`](../ci-cd/promotion-guide.md) (application version rollback,
`argocd app rollback`) and [`migrations.md`](migrations.md) (schema rollback strategy — forward-only
migrations, three escalating options). This document's job is data-layer recovery; those two cover
code/schema recovery.

## Known gaps (honest, not hidden)

- No DR drill has ever actually been run against this application's own workload-recovery steps
  above (only the infrastructure layer's drill cadence is established, blueprint Section 12's
  quarterly cadence) — these steps are reasoned-through, not yet drilled-and-confirmed.
- Step 1's `force-sync` annotation trick is External Secrets Operator's documented mechanism but
  hasn't been exercised against a real Secrets Manager change in this platform yet.

---

## Historical (Phase 1A) notes

Kept for context; superseded by the sections above where they conflict.

Phase 1A originally documented: no backup automation, no tested restore procedure, no RPO/RTO
commitment, and treated Postgres as "an external managed service not provisioned by this repo."
All of that is now handled by `patheya-express-terraform` (Aurora with 35-day PITR, ElastiCache
with automatic failover, the RPO/RTO commitments in the blueprint's Section 12) — the original
"Recommendation before Phase 2" section's asks are exactly what Phases 2-4 delivered.

Failure-mode behavior Phase 1A built (still accurate, unchanged): pod crash/restart handling via
probes + PDB + `maxUnavailable: 0`, graceful shutdown via `SIGTERM`/`enableShutdownHooks`,
topology-spread/anti-affinity for node/AZ-level resilience, and readiness-probe-driven traffic
removal on a dependency outage.
