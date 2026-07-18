# Release and go-live checklist

Two related but distinct checklists: **release** (routine, per-deploy) and **go-live** (one-time,
first real production traffic). Every item states whether it's already satisfied (with evidence)
or still outstanding.

## Release checklist (every deploy, already satisfied by the built pipeline)

- [x] CI passed (lint, typecheck, test, Prisma validate, OpenAPI validate) — `backend-ci.yml`/`ci.yml`
- [x] Image built, scanned (Trivy blocking gate), signed (Cosign), SBOM-attested, SLSA provenance
      generated — `reusable-docker-publish.yml`
- [x] GitOps PR opened with the new image tag + git-commit/build-id annotations —
      `gitops-image-update`
- [x] GitOps PR itself validated (kustomize build, schema, policy) — `gitops-ci.yml`, **re-verified
      for real this phase** (kubeconform: 0 invalid; conftest: 100% pass after fixing a real Rego
      syntax bug)
- [ ] Migration Job completes successfully *(requires a live cluster — not yet exercised for real)*
- [ ] ArgoCD sync completes, all resources Healthy *(requires a live cluster)*

## Go-live checklist (one-time, before real production traffic)

### Infrastructure
- [ ] `terraform apply` run successfully for every environment/stage (management, security,
      shared-services, development, staging, production — each stage in order)
- [ ] All 4 human-populated Secrets Manager entries populated for real
      (`jwt-signing-key`/`cloudinary`/`razorpay`/`smtp`, per-environment) —
      `patheya-express-terraform`'s `docs/secrets-guide.md`
- [ ] `BANK_ACCOUNT_ENCRYPTION_KEY` secret created (currently has no Secrets Manager entry at all —
      `known-issues.md`)

### CI/CD
- [ ] All repo secrets/variables configured (`docs/ci-cd/ci-cd-guide.md`'s table) — ECR push role
      ARNs, `GITOPS_PR_TOKEN`, `PLATFORM_RELEASE_READ_TOKEN`
- [ ] Branch protection actually configured per `docs/ci-cd/branch-protection.md` (documented, not
      yet applied to a real GitHub org)
- [ ] `CODEOWNERS` added to frontend/terraform/gitops repos (only backend has one)

### Security
- [ ] Backend's 10 high-severity `pnpm audit` findings triaged (`ws`, `multer` at minimum — the
      `pnpm`-self findings are build-time, lower urgency)
- [ ] Frontend's 15 high-severity `pnpm audit` findings triaged (confirm which are dev-tooling-only
      vs. shipped in the production bundle)
- [ ] The pre-existing `ci-deployer` RBAC identity in the frontend repo either removed or
      explicitly accepted with a documented reason (contradicts GitOps-only)

### Application
- [ ] First real end-to-end functional pass: registration, login, restaurant onboarding, menu CRUD,
      cart, checkout, payment, order lifecycle, dispatch, realtime tracking, notifications, BullMQ
      processing, Cloudinary uploads — **none of this has been executed against a real environment
      in any phase to date**
- [ ] Backend test coverage raised from its current measured 0.43% to a level the team is actually
      comfortable calling "production-ready" (`platform-standards.md` §1 principle 3)

### Observability
- [ ] Confirm Grafana's "Application Overview" dashboard shows real data (built in Phase 5 against
      metric names Phase 9 only just started emitting — never confirmed against a real Prometheus)
- [ ] Confirm PagerDuty/Slack routing keys are real, not the placeholder no-op behavior

### Disaster recovery
- [ ] At least one real Aurora restore drill executed and timed against the RPO/RTO targets
      (blueprint Section 12) — never drilled in any phase to date
- [ ] `docs/infrastructure/disaster-recovery.md`'s application-recovery steps exercised at least
      once, even in a non-production environment

### Sign-off
- [ ] Every one of Phase 10's sign-off sections (architecture, infrastructure, security,
      operations, performance, DR, release) actually granted by a real reviewer — see the Phase 10
      final report for the current state of each (**not yet granted — this session cannot grant
      them, only prepare the evidence a real reviewer needs**)

## What "done" looks like

Every unchecked box above with "requires a live cluster"/"never exercised" next to it is real,
outstanding work — not a formality. This checklist exists specifically so a future session (or a
human) can pick up exactly where Phase 10's audit left off, rather than re-discovering what's
actually missing.
