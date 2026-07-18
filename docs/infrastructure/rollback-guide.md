# Rollback guide (application workloads)

Three distinct things can need rolling back, each with a different mechanism — conflating them is
the most common way a rollback makes an incident worse, not better.

## 1. Application code (no schema/data change involved)

**`argocd app rollback backend-<environment>`** (or the frontend equivalent) to the prior Git
revision in `patheya-express-gitops` — the only sanctioned path
(`platform-standards.md` Section 10). A `kubectl rollout undo` run by hand against a GitOps-managed
Deployment is itself an incident: it creates drift ArgoCD's `selfHeal` (development) or the next
sync (staging/production) will immediately try to reconcile away, potentially re-introducing the
exact bug just rolled back from.

Equivalent, PR-based alternative: revert the merge commit in `patheya-express-gitops` and let the
normal PR process (or auto-merge, for development) land it — slower, but leaves a clean audit trail
for anything reviewed more carefully.

## 2. Database schema (a migration shipped a problem)

See [`migrations.md`](migrations.md) for the full explanation. Summary: Prisma migrations are
forward-only. In order of preference:

1. Roll back the application (#1 above) if the schema itself is fine and the new *code* is the
   problem — additive migrations are specifically written so old code tolerates a newer schema.
2. Write a new forward migration that undoes the specific change, if the schema change itself is
   wrong.
3. Aurora point-in-time restore, only for actual data loss — the slowest, heaviest option, coordinate
   with the DR runbook (`disaster-recovery.md`) owner first.

Never attempt to manually edit `_prisma_migrations` or hand-run reverse DDL against production —
that desyncs Prisma's own migration history from the schema's real state, which is a worse problem
than whatever the original migration caused.

## 3. A GitOps image-tag bump that shouldn't have gone to staging/production

`backend-promote.yml`/`frontend-promote.yml` never rebuild — they only bump a tag that was already
built, scanned, signed, and attested by an earlier `*-release.yml` run. Rolling back a bad
promotion is the same as #1: `argocd app rollback`, or re-run `*-promote.yml` with the prior known-
good tag as the `image-tag` input (both are equally valid; the second is more explicit about
*which* tag you're going back to, useful when the incident review needs that spelled out).

## What rollback does NOT cover

- **Redis state** (BullMQ jobs, presence, Socket.IO room membership) — not versioned, not
  rolled-back-able; see `disaster-recovery.md`'s "Recovering from a Redis wipe" section for the
  actual recovery steps when Redis itself is the problem, not the application version.
- **External secrets content** (`backend-app-secrets`, etc.) — a bad secret value is fixed by
  correcting it in AWS Secrets Manager (`patheya-express-terraform`'s `docs/secrets-guide.md`), not
  by an application-level rollback of any kind.

## Verifying a rollback actually worked

Same checklist as any deploy: `GET /api/v1/health/ready` on real pods, check the
`patheya-express.io/git-commit` annotation matches the commit you expected to roll back to
(`kubectl get pods -n patheya-backend -o jsonpath=...`, see `operations-guide.md`), and watch
`patheya:http_requests_errors:rate5m` (Grafana) actually drop before declaring the incident
resolved.
