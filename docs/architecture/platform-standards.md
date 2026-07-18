# Patheya Express — Platform Engineering Standards

**Status:** Mandatory reference. Documentation only — no source, manifest, Terraform, AWS, or
CI/CD changes made or implied by this document itself. Every future implementation phase must
read this document **and** `cloud-architecture-blueprint.md` before making implementation
decisions; where the two ever appear to disagree, this document's naming/process rules govern and
the blueprint's architecture governs — file an ADR (Section 23) to resolve the conflict rather than
silently picking one.

**How to use this document**: it is opinionated by design — one standard per topic, not a menu.
"Provide two options and let the team decide" is exactly what this document exists to prevent.
Every rule below states the rule, a concrete example, and (where it isn't obvious) why.

---

## Section 1 — Architecture Principles

These eleven principles are the filter every design decision in every future phase passes through.
Where a proposal violates one of these, the proposal changes — the principle doesn't bend.

1. **Enterprise-first.** Design for the platform this becomes, not the platform it is today. This
   doesn't mean building unused capacity now — it means never choosing something that has to be
   torn out to reach enterprise scale (see every ADR in the blueprint's Section 16 for what
   "enterprise-first without over-building" looks like in practice).
2. **No MVP shortcuts.** "We'll fix it before production" is not a plan — see Section 23's
   ADR/deprecation rules for how a deliberate, time-boxed shortcut gets tracked instead of quietly
   becoming permanent.
3. **Production-ready only.** Nothing merges to `main` that wouldn't be acceptable running in
   production today, even if it isn't deployed there yet. Feature flags gate exposure, not code
   quality.
4. **Infrastructure as Code.** Every AWS resource, every Kubernetes object, every DNS record has a
   Git-tracked definition. If it exists and isn't in Git, it's drift, not infrastructure —
   `terraform plan`/`argocd app diff` are the only accepted way to discover what's actually running.
5. **GitOps.** Production changes happen by merging to Git, never by running a mutating command
   against a live cluster or AWS account by hand. This is enforced by RBAC (Section 7, Section 13),
   not just written policy.
6. **Immutable infrastructure.** Nodes, containers, and AMIs are replaced, never patched in place.
   `docker exec` into a production container to "quickly fix something" is an incident, not a
   maintenance action.
7. **Security by default.** The default configuration for anything new is the locked-down one —
   opening something up is an explicit, reviewed change, never the starting state.
8. **Least privilege.** Every IAM role, RBAC binding, and Security Group rule grants exactly what
   its function needs and nothing else — continuing the zero-grant-ServiceAccount stance Phase 1A
   already established for workloads that don't call AWS/K8s APIs.
9. **Zero trust.** No network segment is trusted by default because of where it sits (`private`
   subnet ≠ implicit permission) — NetworkPolicies, Security Groups, and mTLS (once adopted) enforce
   this explicitly rather than relying on network topology alone.
10. **High availability.** Every production component tolerates the loss of one Availability Zone
    without a customer-visible outage — a design that only survives with human intervention within
    an AZ failure isn't highly available, it's a documented incident with extra steps.
11. **Observability first.** A feature isn't done when it works — it's done when its failure modes
    are visible in the dashboards and alerting defined in Section 12, before it ships, not after
    the first incident.

**Everything documented**: any decision covered by an ADR trigger in Section 23 gets one before
merge, not retroactively after someone asks "why did we do it this way."

## Section 2 — Repository Standards

| Repository | Purpose | Status |
| --- | --- | --- |
| `patheya-express-frontend` | Nx workspace — Customer, Partner, Delivery, Admin Angular apps + shared libs | exists |
| `patheya-express-backend` | NestJS API gateway + workers (single deployable image, per `docs/infrastructure/workers.md`) | exists (this repo) |
| `patheya-express-gitops` | Kustomize overlays ArgoCD watches — the only path to a running cluster state | introduced in Phase 7 |
| `patheya-express-terraform` | All AWS infrastructure as code | introduced in Phase 2 |
| Documentation repository | **Not introduced.** `docs/` inside each application repo remains canonical until cross-repo documentation needs (e.g. a shared runbook referenced by three repos) actually arise — a docs repo created speculatively is itself an MVP-shortcut-in-reverse (Section 1, principle 2 applies to "extra structure nobody needs yet" too) |

### Folder structure (backend repository — already established, formalized here)

```
apps/api-gateway/src/
  modules/<domain>/
    controllers/
    services/
    repositories/
    dto/
  infrastructure/          # cross-cutting: database, redis, queues, logger
  common/                  # middleware, interceptors, guards shared across modules
  core/                    # filters, events — framework-level cross-cutting concerns
k8s/
  base/
  overlays/{development,staging,production}/
docs/
  architecture/            # this document, the blueprint, ADRs
  infrastructure/          # operational guides (docker.md, kubernetes.md, health-checks.md, ...)
```

### Folder structure (Terraform repository — Section 9 has the full standard; summarized here for repo-structure completeness)

```
patheya-express-terraform/
  modules/<resource>/       # vpc, eks, aurora, elasticache, ...
  environments/{dev,staging,prod}/
```

### Ownership

Every repository has a `CODEOWNERS` file mapping directories to teams (`apps/api-gateway/` →
backend team, `k8s/` → platform team, `modules/eks/` → platform team). No directory in a repository
is ownerless — an unowned directory is a Section 23 escalation ("who approves changes here?") to
resolve before more code lands in it.

### README requirements

Every repository's root `README.md` contains, in this order, and nothing else at the root level
(deeper detail belongs in `docs/`): one-paragraph purpose, prerequisites, local setup (copy-paste
runnable), how to run tests, how to deploy (or a link to `docs/deployment.md`/the GitOps repo),
link to this document and the architecture blueprint.

### Documentation hierarchy

`README.md` (orientation) → `docs/deployment.md` (quick-start entry point) →
`docs/infrastructure/*.md` (operational depth, one file per subsystem) →
`docs/architecture/*.md` (why, not how — blueprint, standards, ADRs). A reader should never need to
read `docs/architecture/` to deploy the app, and never need to read `docs/infrastructure/` to
understand why a decision was made — each tier answers a different question.

## Section 3 — Git Standards

- **Branch strategy**: trunk-based. `main` is the only long-lived branch. Feature branches are
  short-lived (days, not weeks) and delete on merge.
- **Protected branches**: `main` requires: 1 approval minimum (2 for anything touching
  `k8s/`, `modules/` in the Terraform repo, or `Dockerfile`), all CI checks green, no unresolved
  review conversations, branch up to date with `main` before merge. No force-push to `main`, ever,
  by anyone, including admins.
- **Commit message format**: Conventional Commits — `<type>(<scope>): <subject>`, e.g.
  `fix(health): add storage check to readiness probe`, `feat(k8s): add worker HPA`,
  `docs(architecture): add platform standards`. Types: `feat`, `fix`, `docs`, `refactor`, `chore`,
  `ci`, `test`. Scope is the module/directory most affected.
- **Pull Request standards**: PR title follows the same Conventional Commits format (it becomes the
  squash-merge commit message — see Merge strategy). Description states what changed and why, not
  what the diff already shows. Every PR links the issue/ticket it closes.
- **Review requirements**: at least one reviewer who is not the author and who owns (per
  `CODEOWNERS`) at least one changed path. AI-generated code (Section 22) has no exemption from
  this — the same human review bar applies regardless of who or what wrote the diff.
- **Merge strategy**: squash-merge only. `main`'s history is one commit per PR — bisectable,
  readable, and matching the release-note generation Section 3's tagging relies on.
- **Release tagging**: `v<major>.<minor>.<patch>` (Semantic Versioning) on `main`, tagged by the
  release workflow (Section 10) immediately after a merge that's promoted to production, never
  tagged manually ahead of that.
- **Semantic Versioning**: `major` = breaking API change (Section 15's deprecation policy applies
  before a major bump ships), `minor` = backward-compatible feature, `patch` = backward-compatible
  fix. Internal-only changes (infra, docs, CI) don't bump the application version at all.
- **Hotfix strategy**: `hotfix/<ticket>-<slug>` branched from the last production release **tag**,
  not from `main` (main may already contain unreleased, unvetted changes) — merged back to `main`
  via the normal PR process after the hotfix ships, so the fix is never lost on the next regular
  release.

## Section 4 — Naming Conventions

**General rule**: `kebab-case` everywhere a name is machine-read (repos, Docker images, K8s
resources, Terraform resources, branches). `snake_case` only where the tool itself mandates it
(Prometheus metric names, Postgres identifiers). Never `camelCase` or `PascalCase` in
infrastructure-facing names — reserved for application source code identifiers only.

| Category | Pattern | Example |
| --- | --- | --- |
| Applications | `<name>` | `api-gateway`, `worker`, `customer-app`, `partner-app`, `delivery-app`, `admin-app` |
| Repositories | `patheya-express-<repo-purpose>` | `patheya-express-backend`, `patheya-express-gitops` |
| Docker images (local/CI) | `patheya-express-<app>` | `patheya-express-api-gateway` (already the standard — Phase 1A's Dockerfile) |
| ECR repositories | `patheya-express/<app>` | `patheya-express/api-gateway` |
| Image tags | `<semver>-<git-sha-short>` | `1.4.2-a1b2c3d` — immutable, never `latest` outside local dev (already the blueprint's Section 9 standard) |
| Namespaces | `<function>` (no environment suffix — environment is the cluster/account, not the namespace, per the blueprint's one-cluster-per-environment model) | `patheya-backend`, `patheya-frontend`, `platform` |
| Deployments | `<app>` (no `-deployment` suffix — `kind:` already disambiguates) | `api-gateway`, `worker`, `customer-app` |
| Pods | generated by the Deployment (`<deployment>-<replicaset-hash>-<pod-hash>`) — never manually named | `api-gateway-7d9f8c6b5-x2k9p` |
| Services | `<app>` (matches its Deployment name) | `api-gateway` |
| Ingress | `<app>` for a single-app Ingress, `<domain>` for a shared one | `api-gateway`, `frontend` |
| ConfigMaps | `<app>-config` (Kustomize `configMapGenerator` base name — hash-suffixed at build) | `api-gateway-config` |
| Secrets | `<app>-secrets` (same generator pattern) | `api-gateway-secrets` |
| PersistentVolumes / Claims | `<app>-<purpose>` | `postgres-staging-data` (only for genuinely stateful in-cluster needs — Aurora/ElastiCache are managed, so this pattern is rare by design) |
| Jobs | `<app>-<purpose>-job` | `api-gateway-migrate-job` |
| CronJobs | `<app>-<purpose>-cron` | `backend-db-backup-verify-cron` |
| ServiceAccounts | `<app>` (matches the Deployment) | `api-gateway`, `worker` |
| Roles / RoleBindings | `<app>-role` / `<app>-rolebinding` | `external-secrets-role` |
| ClusterRoles | `platform-<function>-clusterrole` | `platform-alb-controller-clusterrole` |
| PriorityClasses | `patheya-express-<tier>` (cluster-scoped, not app-scoped) | `patheya-express-critical`, `patheya-express-standard`, `platform-critical` |
| HorizontalPodAutoscalers | `<app>` (matches the target Deployment) | `api-gateway`, `worker` |
| VerticalPodAutoscalers | `<app>` (same rule) | `api-gateway` |
| Terraform modules | `<resource>` (directory name under `modules/`) | `modules/vpc`, `modules/eks`, `modules/aurora` |
| Terraform workspaces | **Not used** — see Section 9 | — |
| Terraform state | `<environment>/<component>/terraform.tfstate` (S3 key) | `prod/eks/terraform.tfstate` |
| VPCs | `patheya-<env>-vpc` | `patheya-prod-vpc` |
| Subnets | `patheya-<env>-<tier>-<az>` | `patheya-prod-private-app-ap-south-1a` |
| Security Groups | `patheya-<env>-<purpose>-sg` | `patheya-prod-aurora-sg` |
| NAT Gateways | `patheya-<env>-nat-<az>` | `patheya-prod-nat-ap-south-1a` |
| Load Balancers | `patheya-<env>-<purpose>-lb` | `patheya-prod-ingress-nlb` |
| Route Tables | `patheya-<env>-<tier>-rt-<az>` | `patheya-prod-private-app-rt-ap-south-1a` |
| Elastic IPs | `patheya-<env>-eip-<purpose>-<az>` | `patheya-prod-eip-nat-ap-south-1a` |
| Aurora clusters | `patheya-<env>-aurora` | `patheya-prod-aurora` |
| ElastiCache clusters | `patheya-<env>-redis` | `patheya-prod-redis` |
| SNS topics | `patheya-<env>-<purpose>` | `patheya-prod-alerts-critical` |
| SQS queues | `patheya-<env>-<purpose>` | `patheya-prod-dlq-notifications` (only where SQS is actually used — BullMQ/Redis remains primary per the blueprint's ADR-010) |
| CloudFront distributions | `patheya-<env>-<purpose>-cdn` | `patheya-prod-static-cdn` |
| Route53 hosted zones | the bare domain | `patheyaexpress.com` |
| Cloudflare DNS records | `<subdomain>.patheyaexpress.com` matching the app it fronts | `api.patheyaexpress.com`, `app.patheyaexpress.com` |
| IAM roles | `patheya-<env>-<function>-role` | `patheya-prod-external-secrets-role` |
| IAM policies | `patheya-<env>-<function>-policy` | `patheya-prod-external-secrets-policy` |
| KMS keys | alias `alias/patheya-<env>-<data-class>` | `alias/patheya-prod-aurora` |
| S3 buckets | `patheya-express-<purpose>-<env>-<account-id>` (account-id suffix guarantees global uniqueness without a random string) | `patheya-express-compliance-docs-prod-123456789012` |
| CloudWatch log groups | `/patheya-express/<env>/<app>` | `/patheya-express/prod/api-gateway` |

## Section 5 — AWS Tagging Standards

Every taggable AWS resource carries all fourteen tags below. A resource created without the full
set fails the mandatory AWS Config tag-compliance rule (Section 13) and is treated as
non-conformant infrastructure, not a paperwork gap.

| Tag | Example value | Purpose |
| --- | --- | --- |
| `Environment` | `production` | Drives cost reporting and blast-radius reasoning |
| `Project` | `patheya-express` | Constant across every resource in the platform |
| `Owner` | `platform-engineering` | Team accountable for the resource |
| `ManagedBy` | `terraform` | `terraform` or `manual` — `manual` on anything but a genuine one-off is itself a finding |
| `CostCenter` | `eng-platform` | Feeds chargeback (Section 20) |
| `Repository` | `patheya-express-terraform` | Where the resource's IaC definition lives |
| `Application` | `api-gateway` | The specific app the resource serves (`platform` for shared infra) |
| `Version` | `1.4.2` | The application version currently deployed, where applicable |
| `Confidentiality` | `internal` | `public` / `internal` / `confidential` / `restricted` — drives access review scope |
| `BusinessUnit` | `engineering` | For multi-BU cost allocation as the org grows |
| `Compliance` | `pci-adjacent` | e.g. anything in the payment flow's data path — `none` where genuinely not applicable |
| `Retention` | `35-days` | Matches the actual backup/log retention configured, not aspirational |
| `CreatedBy` | `terraform-ci` | The identity (human or automation) that provisioned it |
| `Purpose` | `primary-database` | One-line human-readable "what is this" |

Example (Terraform):

```hcl
tags = {
  Environment    = "production"
  Project        = "patheya-express"
  Owner          = "platform-engineering"
  ManagedBy      = "terraform"
  CostCenter     = "eng-platform"
  Repository     = "patheya-express-terraform"
  Application    = "aurora"
  Version        = "n/a"
  Confidentiality = "confidential"
  BusinessUnit   = "engineering"
  Compliance     = "pci-adjacent"
  Retention      = "35-days"
  CreatedBy      = "terraform-ci"
  Purpose        = "primary-database"
}
```

## Section 6 — Environment Standards

| Environment | AWS account | Cluster | Domain | Purpose |
| --- | --- | --- | --- | --- |
| Development | `patheya-dev` | `patheya-dev` EKS | `dev.patheyaexpress.com` (+ per-app subdomains) | Continuous deploy on every merge to `main` |
| Staging | `patheya-staging` | `patheya-staging` EKS | `staging.patheyaexpress.com` | Pre-production validation, DR drill target (blueprint Section 12) |
| Production | `patheya-prod` | `patheya-prod` EKS | `patheyaexpress.com` | Customer-facing, manual-approval-gated deploys only |

**Naming**: environment name is always the AWS account/cluster name, never encoded into an
application's own config (an app doesn't know or care which environment it's in beyond its
injected `NODE_ENV` — everything else is infrastructure's job to route correctly).

**Variables**: every environment-varying value is a ConfigMap/Secret entry (Section 7), never a
conditional in application code (`if (env === 'production')` in business logic is a Section 23
review flag — environment-conditional *behavior*, as opposed to environment-conditional
*configuration*, almost always indicates a design that should be a config value instead).

**URLs/Domains/DNS**: `<app-subdomain>.<environment-prefix.>patheyaexpress.com` — production has no
environment prefix (`app.patheyaexpress.com`), every other environment does
(`app.dev.patheyaexpress.com`, `app.staging.patheyaexpress.com`). One pattern, no exceptions,
enforced by ExternalDNS reading directly from each overlay's `Ingress.spec.rules[].host`.

**Secrets**: never shared across environments, even accidentally — Section 13's Secrets Manager
design uses a separate secret per environment by construction (separate AWS accounts), not a
shared secret with environment-scoped IAM conditions layered on top.

**Certificates**: ACM, DNS-validated, one certificate per environment domain, auto-renewing — no
manually-issued or manually-renewed certificate anywhere in the platform.

## Section 7 — Kubernetes Standards

- **Namespaces**: Section 4's table. `ResourceQuota` and `LimitRange` mandatory on every
  non-`platform` namespace.
- **Labels**: every object carries the full `app.kubernetes.io/*` set — `name`, `component`
  (`api`/`worker`/`frontend`), `part-of` (`patheya-express`), `managed-by` (`kustomize`), `version`
  (the image tag) — exactly Phase 1A's existing label scheme, now mandatory rather than
  incidental.
- **Annotations**: reserved for tool-consumed metadata only (`nginx.ingress.kubernetes.io/*`,
  `external-dns.alpha.kubernetes.io/*`) — never a substitute for a label a query might need to
  select on.
- **Selectors**: match on `app.kubernetes.io/name` only, never a combination that could
  accidentally overlap two unrelated Deployments — one selector, one owner, always.
- **Resource Requests/Limits**: mandatory on every container, no exceptions (Kyverno enforces this
  admission-time per the blueprint's Section 11) — `requests` sized from real VPA data once
  available (blueprint Section 14), `limits` set to prevent one pod from starving its node, not set
  equal to `requests` (that would defeat bin-packing entirely).
- **Affinity/Anti-affinity/Topology Spread**: every multi-replica Deployment carries pod
  anti-affinity and `topologySpreadConstraints` across `kubernetes.io/hostname` at minimum, across
  `topology.kubernetes.io/zone` for anything with `minReplicas >= 3` — exactly Phase 1A's existing
  pattern, now the floor every new Deployment must meet, not a best-effort addition.
- **Network Policies**: default-deny (Phase 1A's base), explicit allow per real traffic need —
  a new Deployment ships with its NetworkPolicy in the same PR, not as later hardening.
- **RBAC**: Section 4's naming. Every `RoleBinding` maps to a real least-privilege `Role` — no
  `ClusterRole: cluster-admin` binding for anything except the platform team's own break-glass
  access, which is itself audited (CloudTrail-equivalent, Section 13).
- **Priority Classes**: every Deployment sets one explicitly — no default-priority workload in
  `patheya-backend`/`patheya-frontend` (an unset `priorityClassName` is a review-blocking omission,
  not an acceptable default).
- **Pod Security**: `restricted` Pod Security Standard label on every non-`platform` namespace.
- **Admission Policies**: Kyverno policies (blueprint Section 11) are the enforcement mechanism for
  every rule in this section that's technically enforceable — a standard that only lives in this
  document and isn't backed by an admission policy where one is possible is a Section 23 gap to
  close, not a permanently-manual check.

## Section 8 — Docker Standards

Continues Phase 1A's Dockerfile pattern as the mandatory shape for every containerized app in the
platform (backend and frontend alike):

- **Multi-stage builds**: always at least `build` + `runtime` stages — a `runtime` stage never
  contains a compiler, package manager, or source file it doesn't need to execute.
- **Image size**: runtime stage minimized deliberately — alpine base, production-only dependencies,
  no dev tooling. Not an arbitrary size target; a size regression in CI (image grows >15% between
  releases with no corresponding intentional dependency addition) is a review flag.
- **Base images**: pinned major version (`node:24-alpine`, never bare `node:alpine` or `node:latest`)
  — reproducible builds over always-latest convenience.
- **OCI labels**: mandatory (`org.opencontainers.image.source/revision/created/version/title`) —
  Phase 1A's `--build-arg VCS_REF`/`BUILD_DATE`/`IMAGE_VERSION` pattern is the standard every
  Dockerfile in the platform follows.
- **Health checks**: mandatory `HEALTHCHECK` instruction targeting the liveness endpoint (never
  readiness — Phase 1A's documented reasoning in `docs/infrastructure/health-checks.md` applies to
  every future service, not just `api-gateway`).
- **Security**: non-root `USER`, `tini` (or equivalent) as PID 1, no secrets baked into any layer
  (verified by the CI Trivy scan, blueprint Section 11), `.dockerignore` excludes `.env*`,
  `node_modules`, and build output from the build context.
- **Image naming/tagging/registry**: Section 4's tables — no exceptions per-app.

## Section 9 — Terraform Standards

- **Repository layout**:
  ```
  patheya-express-terraform/
    modules/
      vpc/
      eks/
      aurora/
      elasticache/
      iam/
    environments/
      dev/
        main.tf          # module calls only — no resource blocks directly in an environment dir
        backend.tf
        terraform.tfvars
      staging/
      prod/
  ```
- **Module layout**: every module has `main.tf`, `variables.tf`, `outputs.tf`, `versions.tf`, and a
  `README.md` documenting its inputs/outputs in prose, not just relying on `terraform-docs` output
  as the only documentation.
- **Environment layout**: an environment directory only calls modules and sets variables — it never
  defines a raw AWS resource directly. If an environment needs something a module doesn't expose,
  the module gets a new input, not a workaround resource block in the environment.
- **State naming/Remote backend**: S3 backend, bucket `patheya-express-terraform-state-<account-id>`
  (per-account, so dev/staging/prod state can never cross-contaminate even via misconfiguration),
  key `<environment>/<component>/terraform.tfstate` (Section 4), DynamoDB table
  `patheya-express-terraform-locks` for state locking, versioning enabled on the state bucket,
  bucket-level encryption via the platform KMS key.
- **Variables**: every module variable has a `description` and, where it isn't universally
  applicable, a `validation` block — an undocumented Terraform variable is treated the same as an
  undocumented function parameter in application code: a review-blocking gap.
- **Outputs**: every module outputs everything a consuming environment or another module could
  plausibly need (VPC ID, subnet IDs, security group IDs) — under-exposing outputs is what causes
  the raw-resource-block workaround this standard explicitly forbids above.
- **Version pinning**: exact provider version pins in `versions.tf`
  (`required_providers { aws = { version = "= 5.x.y" } }`), Terraform CLI version pinned via
  `required_version` and a committed `.terraform-version` (tfenv-compatible) — no floating `~>`
  ranges in `environments/` (modules may use a narrow `~>` for patch-level flexibility; environments
  never do, since an environment apply is where an unreviewed provider bump becomes a live change).
- **Formatting/Validation**: `terraform fmt -check` and `terraform validate` are required CI checks
  on every PR touching the Terraform repository — unformatted Terraform doesn't merge.
- **Workspaces — explicitly not used.** Terraform workspaces make it possible to run
  `terraform apply` against the wrong environment with a single forgotten `terraform workspace
  select`. Separate state files per environment directory (already in the repository layout above)
  make the target environment a property of *which directory you're in*, not an easily-mistaken CLI
  flag — a deliberate, opinionated rejection of a feature Terraform itself offers, because the
  failure mode it enables (a `prod` apply run from a `dev` mental context) is worse than the
  duplication it would save.

## Section 10 — CI/CD Standards

- **GitHub Actions workflow naming**: `<repo-purpose>-<trigger>.yml`, e.g. `backend-ci.yml`,
  `backend-release.yml`, `terraform-plan.yml`.
- **Job naming**: verb-first, matching what it does — `lint`, `test`, `build`, `scan`, `sign`,
  `push`.
- **Artifact naming**: matches Section 4's image-tag standard exactly — a CI artifact and its
  eventual ECR image share the same `<semver>-<git-sha-short>` identifier end to end, so a build
  can always be traced from a running pod back to the exact CI run that produced it.
- **Image naming**: Section 4.
- **Signing**: cosign, keyless/OIDC (blueprint Section 11) — every image, no exceptions, including
  `development`-bound images. An unsigned image is inadmissible in any cluster, not just `production`.
- **Scanning**: Trivy, `HIGH`/`CRITICAL` fails the build with no inline suppression — a
  genuinely-accepted-risk CVE gets an ADR (Section 23) and an explicit, time-boxed
  `.trivyignore` entry referencing that ADR's number, never a silent suppression.
- **Promotion**: an image built once is promoted unchanged from `dev` → `staging` → `production` —
  never rebuilt per environment (rebuilding risks a different artifact reaching production than
  what was actually tested in staging).
- **Rollback**: `argocd app rollback` to the prior Git revision (blueprint Section 9) — the only
  sanctioned rollback path. A `kubectl rollout undo` run by hand against a GitOps-managed
  Deployment is itself an incident (it creates drift ArgoCD will immediately try to reconcile away).

## Section 11 — Logging Standards

Continues Phase 1A's Winston JSON structured-logging pattern as the mandatory shape for every
service in the platform.

- **Format**: JSON only, one object per line, no exceptions — never a human-formatted string log
  line in any environment past local development.
- **Mandatory fields**: `timestamp` (ISO 8601, UTC, e.g. `2026-07-17T08:36:11.657Z`), `level`
  (`error`/`warn`/`info`/`debug`/`verbose` — matches Nest's `LoggerService` levels exactly),
  `message`, `context` (the originating module/service name).
- **Correlation IDs**: `requestId` — generated per inbound HTTP/WS request (Phase 1A's
  `RequestIdMiddleware`, already the standard). `correlationId` — a **new**, mandatory addition
  once a request's effect crosses a process boundary (e.g. an HTTP request that enqueues a BullMQ
  job): the same `correlationId` is attached to the job payload and logged by the `workers` process
  that picks it up, so one order's full lifecycle is traceable across both processes by a single ID
  — `requestId` alone cannot do this, since it dies with the originating HTTP request/response
  cycle.
- **Trace/Span IDs**: `traceId`/`spanId` fields, populated once OpenTelemetry lands (blueprint
  Phase 5) — reserved field names from day one so no future log-shape migration is needed, even
  before the tracing infrastructure that populates them exists.
- **Log levels**: `error` = the request/job failed and a human may need to act; `warn` = handled
  but noteworthy (e.g. a retried external API call); `info` = normal operational events (Phase 1A's
  `health_check` event is the model); `debug`/`verbose` = development only, never enabled in
  `staging`/`production` (`LOG_LEVEL` env var, already the Phase 1A mechanism).
- **Field naming**: `camelCase` for every field (matches the JSON/JS convention, not the
  infrastructure `kebab-case` rule from Section 4 — logging payloads are data, not resource names).
- **Retention**: 30 days hot (CloudWatch/Loki queryable), 1 year cold (S3, lifecycle-transitioned)
  for `production` only — `staging`/`development` logs retain 7 days hot, no cold tier (matches
  Section 6's environment-scoped-everything principle).

## Section 12 — Monitoring Standards

- **Metrics naming**: Prometheus convention, `patheya_<domain>_<metric>_<unit>`, `snake_case`, unit
  suffix mandatory (`_seconds`, `_total`, `_bytes`) — e.g. `patheya_orders_created_total`,
  `patheya_http_request_duration_seconds`, `patheya_bullmq_queue_depth`.
- **Dashboards**: one Grafana dashboard per application (`api-gateway`, `worker`, per frontend app)
  plus one platform-wide overview — a dashboard sprawl of ad hoc, undocumented panels is itself a
  Section 23 review flag (dashboards are reviewed in PR, same as code, since a Grafana JSON model
  is committed to the observability repo/ConfigMap, not click-configured in the UI and left there).
- **Alert naming**: `<Severity>-<Service>-<Condition>`, e.g. `Critical-ApiGateway-ErrorRateHigh`,
  `Warning-Worker-QueueDepthElevated`.
- **Alert severity**: `Critical` (pages on-call, breaches an SLO error budget materially) /
  `Warning` (Slack only, a leading indicator before it becomes Critical) / `Info` (dashboard-only,
  no notification) — three tiers, no more, so severity is never ambiguous at 3am.
- **SLO/SLI/Error budgets**: defined per-service in the blueprint's Section 10 (API availability
  99.9%, order-creation p95 latency, realtime 99.5%) — this document's job is the *naming*
  convention for the alerts that enforce them (`Critical-ApiGateway-SLOBurnRateFast`,
  `Warning-ApiGateway-SLOBurnRateSlow`, the standard multi-window burn-rate alerting pattern), not
  re-deriving the SLO targets themselves.

## Section 13 — Security Standards

- **Secrets**: AWS Secrets Manager, synced via External Secrets Operator (blueprint Section 11) —
  never a plaintext secret in Git, a Kubernetes `Secret` created by hand, or a secret value in a CI
  workflow log. Phase 1A's `secret.env.example` placeholder pattern is explicitly a
  Phase-1A-through-Phase-5 bridge, not the permanent state — Section 6's Phase 6 retires it.
- **IAM**: Section 1 principle 8 (least privilege) applied concretely — every role's policy is
  reviewed for `Resource: "*"` and `Action: "*"` as an automatic review-blocking finding, no
  exceptions without an ADR (Section 23) explaining why no narrower scope is achievable.
- **RBAC**: Section 7.
- **Encryption**: KMS at rest for every data store (Section 4's key-alias naming), TLS 1.2+ in
  transit everywhere, no exceptions — an internal-only connection ("it's inside the VPC, it's
  fine") is exactly the trust-by-topology Section 1 principle 9 (zero trust) forbids.
- **Certificates**: Section 6 — ACM only, DNS-validated, auto-renewing.
- **Network Policies**: Section 7.
- **Image Signing/SBOM/Vulnerability Scanning**: Section 10.
- **Key rotation**: KMS CMKs — automatic annual rotation enabled (AWS-native, no operational
  burden to decline). Aurora credentials — Secrets Manager's native rotation Lambda, 30-day cycle.
  JWT signing secrets — manual rotation only (a JWT secret rotation invalidates every active
  session, which is a deliberate, communicated action, never an automated surprise).

## Section 14 — Documentation Standards

- **Markdown**: every document in this repository is Markdown, GitHub-flavored, Mermaid diagrams
  fenced with ` ```mermaid ` (renders natively on GitHub and in this repo's own tooling — no
  external diagram-hosting dependency for anything that Mermaid can express).
- **ADRs**: Section 16 of the blueprint is the model — every ADR states Problem, Options
  Considered, Decision, Tradeoffs, in that order, no exceptions. New ADRs live in
  `docs/architecture/adr/NNNN-<slug>.md` once the blueprint's own Section 16 needs a home for
  ADRs written *after* the blueprint's initial set (the blueprint's ten are the seed; they don't
  get edited in place to add an eleventh — a new numbered file does).
- **README**: Section 2.
- **Architecture documents**: `docs/architecture/` — the blueprint (what) and this document (how) —
  reviewed together whenever either changes, since a naming-convention change here can invalidate
  an example in the blueprint and vice versa.
- **Runbooks**: `docs/infrastructure/` for operational, "how do I..." documents (already the
  pattern — `docker.md`, `kubernetes.md`, `disaster-recovery.md`); a runbook that hasn't been
  exercised in an actual incident or drill within 12 months gets flagged for a re-verification pass
  in the next DR drill (blueprint Section 12) rather than trusted stale.
- **Diagrams**: Mermaid only for anything checked into Git (renders as text, diffable, no binary
  asset drift) — a tool that can't export to Mermaid or an equivalent text format isn't used for
  architecture diagrams in this platform.
- **Folder structure**: Section 2.
- **Versioning**: documentation isn't separately versioned from code — it lives and moves with the
  commit that made it true, same PR, same review.

## Section 15 — API Standards

- **REST conventions**: resource-plural-noun endpoints (`/orders`, `/restaurants`, not
  `/getOrders`), standard HTTP verbs mapped to CRUD semantics — already the existing pattern
  throughout `apps/api-gateway/src/modules/*/controllers/`.
- **Versioning**: URI versioning, `/api/v1/...` (already Phase 1A's `app.setGlobalPrefix('api/v1')`)
  — a breaking change bumps to `/api/v2/...` and runs alongside `v1` for the deprecation window
  defined in Section 23, never an in-place breaking change to `v1`.
- **Endpoint naming**: `kebab-case` path segments (`/order-acceptance-timeout`-style resource names
  where multi-word, matching the existing BullMQ job-naming convention for consistency across the
  platform), `camelCase` for query parameters and JSON body/response fields (matching the
  TypeScript/JSON convention, not the infra `kebab-case` rule).
- **Error responses**: the existing `GlobalExceptionFilter` shape is the mandatory standard —
  every error response is `{ success: false, timestamp, error: { message, statusCode } }`
  (mirroring the existing `ResponseInterceptor`'s success shape `{ success: true, timestamp, data
  }` exactly) — no endpoint returns a bare, unwrapped error body.
- **Pagination**: cursor-based for any endpoint returning an unbounded or fast-growing collection
  (orders, notifications), offset-based acceptable only for genuinely small, bounded collections
  (a restaurant's own menu categories) — standard query params `?cursor=`/`?limit=` or
  `?offset=`/`?limit=`, never both styles on the same endpoint.
- **Filtering/Sorting**: `?filter[field]=value` / `?sort=field` / `?sort=-field` (leading `-` for
  descending) — one query-param convention platform-wide, not per-endpoint bespoke parsing.
- **OpenAPI**: generated from the existing `@nestjs/swagger` decorators (already in place, `/api/docs`)
  — the OpenAPI document is the source of truth for the SDK generation below, never hand-maintained
  separately from the decorators that produce it.
- **SDK generation**: the frontend repository's `api-sdk` shared library is generated from the
  backend's published OpenAPI document, not hand-written against the API — a hand-written client
  drifting from the actual API contract is exactly the class of bug generation eliminates.

## Section 16 — Database Standards

- **Prisma**: the existing `schema.prisma` conventions continue unchanged — this section documents
  and mandates them, not introduces new ones.
- **Migration naming**: `<timestamp>_<ticket-code>_<slug>` — matches the existing real migration
  history exactly (e.g. `20260713084810_erph2b1_restaurant_onboarding`) — the ticket code makes
  every schema change traceable to the work item that required it, not just a free-text guess at
  intent months later.
- **Indexes**: every foreign key column is indexed (Prisma's `@relation` doesn't auto-index the FK
  side on every database — explicit `@@index` where the query patterns need it), every column used
  in a `WHERE`/`ORDER BY` in a hot-path query gets a reviewed, justified index — an index added
  "just in case" without a query pattern driving it is a review flag (indexes aren't free; they
  cost write throughput).
- **Foreign Keys**: `onDelete`/`onUpdate` behavior explicit on every relation — never left to
  Prisma's default without a deliberate decision recorded in the migration's own name/description.
- **Naming conventions**: `PascalCase` model names (matches existing Prisma convention),
  `camelCase` field names, `snake_case` for the underlying Postgres table/column names via
  `@@map`/`@map` (already the pattern) — Prisma-side and Postgres-side naming are deliberately
  different conventions, each idiomatic to its own layer.
- **Connection pooling**: PgBouncer (blueprint Section 5) — no application code connects directly
  to the Aurora writer/reader endpoints; `DATABASE_URL` always points at the in-cluster PgBouncer
  service, enforced by there being no other connection string anywhere in configuration.

## Section 17 — Queue Standards

- **BullMQ**: the existing `QueuesModule` pattern (`@nestjs/bullmq`, one `Queue`/`Processor` pair
  per domain) is the mandatory shape for every future queue — no second queueing library
  introduced without an ADR justifying why BullMQ genuinely can't serve the need (see the
  blueprint's ADR-010 for the bar this has to clear).
- **Queue naming**: singular domain noun, `lowercase` — matches the existing six exactly
  (`notifications`, `dispatch`, `payments`, `search`, `tickets`, `orders`); a new queue follows the
  same pattern, never a compound or prefixed name (`orders-v2`, `new-notifications`).
- **Job naming**: `kebab-case`, verb-first where the job performs an action
  (`send-notification`, `assignment-expiry`, `order-acceptance-timeout` — the existing pattern).
- **Retry strategy**: exponential backoff, base 2 seconds, maximum 5 attempts — the default for
  every job unless a specific job's failure mode genuinely warrants a different policy (documented
  in that processor's own code comment, not silently overridden).
- **Backoff**: BullMQ's built-in `backoff: { type: 'exponential', delay: 2000 }` — never a custom
  hand-rolled retry loop inside a processor.
- **Dead-letter strategy**: a job that exhausts its retries moves to BullMQ's `failed` state
  (retained, not discarded) and triggers a `Warning-Worker-JobFailed-<queue>` alert (Section 12's
  naming convention) — a human reviews and either manually retries or explicitly discards, so a
  silently-lost job is never possible.

## Section 18 — Realtime Standards

- **Socket.IO**: the existing `RealtimeGateway`/`RealtimeService` pattern is the mandatory shape —
  one gateway per logical connection concern (today: a single general-purpose gateway; a second
  gateway is justified only when connection-level concerns genuinely diverge, e.g. a
  high-volume admin-only telemetry stream that shouldn't share a connection pool with
  customer-facing realtime).
- **Room naming**: `<resource>:<id>` — matches the existing exact pattern
  (`user:<id>`, `order:<id>`, `restaurant:<id>`, `ticket:<id>`), plus the existing named exception
  (`support-queue`) for a genuinely resource-less broadcast room. A new realtime feature reuses this
  pattern; it does not invent a new room-naming shape.
- **Event naming**: `kebab-case`, present-tense/noun-phrase — matches the existing pattern
  (`new-order`, `location-update`).
- **Namespaces**: Socket.IO namespaces (the `/foo` path-prefix concept, distinct from Kubernetes
  namespaces) are **not used** — a single default namespace with room-based scoping (the existing
  design) is simpler to reason about and sufficient for every current and foreseeable use case; a
  proposal to add a Socket.IO namespace needs an ADR explaining what room-based scoping can't
  express.
- **Scaling / Redis adapter**: mandatory once any environment runs more than 1 `api-gateway`
  replica — blueprint Phase 4 makes this concrete platform-wide; until then, the Ingress
  sticky-session mitigation (Phase 1A) is the accepted interim state, explicitly not the permanent
  one (see the blueprint's Section 8 for exactly why sticky sessions alone are insufficient).

## Section 19 — Disaster Recovery Standards

- **Backups**: Section 5 (blueprint) is the concrete design — this section is the standard that
  every future stateful service must meet the same bar: automated, tested, cross-region-copied
  backups from day one of that service existing, not retrofitted after the first data-loss scare.
- **Restore**: every backup type has a documented, drilled restore procedure — a backup nobody has
  ever restored from is unverified and, for planning purposes, treated as not existing.
- **Testing**: quarterly DR drills (blueprint Section 12), executed against `staging`'s own DR
  pair — the same cadence and rigor applies to any future stateful service's own backup/restore
  path, folded into the same quarterly exercise rather than a separate, easily-forgotten schedule.
- **Runbooks**: Section 14 — every DR procedure is a runbook in `docs/infrastructure/`, kept
  current by the quarterly drill (a drill that follows a stale runbook and finds it wrong is
  exactly the point of drilling).
- **Failover**: manual-trigger, human-confirmed (blueprint Section 12's explicit reasoning — a
  false-positive automatic failover is a worse incident than a slightly slower confirmed one) at
  every scale tier this document anticipates; revisit only alongside the blueprint's own
  warm-standby transition (its Section 13 growth table), not independently.
- **Recovery objectives**: RPO ≤ 5 minutes, RTO ≤ 60 minutes (blueprint Section 12) — the standard
  every new stateful service is measured against before it's considered production-ready
  (Section 1, principle 3).

## Section 20 — Cost Governance Standards

- **Budgets**: an AWS Budget per account (Section 2's account structure) with alerts at 50%/80%/100%
  of forecast, owned by platform engineering — a budget breach is a Section 23-worthy review, not
  just a notification to ignore.
- **Cost allocation**: driven entirely by the mandatory tag set (Section 5) — `CostCenter` and
  `Application` tags are what Cost Explorer/Cost and Usage Reports group by; a resource without
  correct tags is invisible to cost allocation, which is exactly why Section 5's tags are mandatory,
  not optional metadata.
- **Reserved Instances/Savings Plans**: blueprint Section 14 — committed once instance-class sizing
  stabilizes past the "launch" tier, reviewed and re-committed at each growth-tier transition
  (blueprint Section 13), never committed speculatively ahead of real usage data.
- **Spot**: blueprint Section 14 — Karpenter-managed, safe specifically because PodDisruptionBudgets
  are mandatory (Section 7) for anything spot-eligible.
- **Rightsizing**: VPA recommendation data (blueprint Section 14) is the input; a resource
  `requests`/`limits` change based on VPA data is a normal PR, reviewed like any other config
  change, not a special "cost optimization" process with different rules.
- **Chargeback**: `CostCenter`-tagged spend reported monthly per team — informational at current
  scale (platform engineering owns the shared infrastructure bill), becomes a real internal
  chargeback mechanism only if/when the org structure genuinely has multiple cost-accountable
  product teams sharing this platform (not pre-built ahead of that need, per Section 1 principle 2).

## Section 21 — Developer Experience Standards

- **Code generation**: Prisma Client (from `schema.prisma`) and the frontend `api-sdk` (from the
  backend's OpenAPI document, Section 15) are the two mandatory generated-not-hand-written
  artifacts in the platform — both regenerated in CI, never manually edited, drift between the
  generator's output and a hand-edit is treated as a bug in the generated file, not a valid patch.
- **Scripts/CLI**: `scripts/` at each repository root, `<verb>-<noun>.ps1`/`.sh` naming
  (`start-dev.ps1`, already the existing pattern) — every script has a one-line comment header
  stating what it does; a script without one doesn't merge.
- **Tooling**: `pnpm` (backend/shared workspace), `nx` (frontend workspace) — the existing toolchain,
  not re-litigated per repository or per engineer's preference.
- **Local development**: `docker compose -f infrastructure/docker/docker-compose.yml up` is the
  mandatory minimum-friction path to a fully running local stack (already true as of Phase 1A) —
  any future dependency this platform adds must ship with a corresponding local-dev story in the
  same PR, not "figure it out later."
- **Documentation**: Section 14 — every new script, CLI flag, or local-dev step gets a line in the
  relevant `README.md`/`docs/infrastructure/*.md` in the same PR that introduces it.

## Section 22 — AI Development Standards

Applies equally to Claude Code, GitHub Copilot, ChatGPT, or any future AI coding assistant used
against this platform — the standard is tool-agnostic by design, since the risk being managed is
*unreviewed AI-generated infrastructure/code reaching production*, not any specific tool's quirks.

- **Mandatory document review before implementation.** Any AI agent (or the human directing one)
  doing infrastructure or platform-level work **must** read this document and
  `cloud-architecture-blueprint.md` before generating implementation output — not as a courtesy,
  as a hard precondition, exactly the same way a human engineer joining the platform team would be
  expected to read both before their first infrastructure PR. An AI-generated PR whose
  author/reviewer cannot confirm this was done is treated as non-compliant regardless of the
  code's technical quality.
- **Architecture validation.** AI-proposed architecture decisions are checked against this
  document's naming conventions (Section 4) and the blueprint's existing ADRs (blueprint Section
  16) before being accepted — a proposal that contradicts an existing ADR needs a new ADR
  explicitly superseding the old one (Section 23), not a silent divergence introduced because the
  AI wasn't aware of the prior decision.
- **AI-generated code review.** No exemption from Section 3's PR review standard — same reviewer
  count, same `CODEOWNERS` requirement, same CI gates. "An AI wrote it" is never a reason to relax
  review; if anything, AI-generated infrastructure changes (Terraform, Kubernetes manifests) warrant
  the same two-approver bar Section 3 already sets for that class of change regardless of authorship.
- **Prompt/instruction storage.** Durable, reusable instructions that shape how AI assistants work
  on this platform belong in this repository's existing `.ai/` directory
  (`.ai/standards/`, `.ai/context/`, `.ai/architecture/` — already established conventions in this
  repo) — not left as ephemeral chat history that the next engineer or the next AI session has no
  access to. A one-off task prompt doesn't need to be archived; a standing instruction
  ("always structure NestJS modules this way," "always validate env vars this way") does, and
  `.ai/standards/` is where it goes.
- **This document's own provenance**: this file and `cloud-architecture-blueprint.md` were
  themselves produced via an AI-assisted documentation task, under exactly the review bar this
  section describes — reviewed and merged like any other PR before being treated as binding, not
  auto-authoritative the moment they were generated.

## Section 23 — Decision Governance

- **When an ADR is required**: any new AWS service or managed component, any new external SaaS
  dependency, any database engine or schema-shape change with cross-module impact, any change to a
  cross-cutting security control (auth mechanism, secret storage, network policy default), any
  proposal that contradicts an existing ADR in the blueprint or a future `docs/architecture/adr/`
  file. A change confined to one module's internal implementation, with no cross-cutting or
  infrastructure impact, does not need one — ADRs document decisions the *platform* depends on,
  not every implementation choice.
- **Architecture review process**: an ADR is proposed as a PR against `docs/architecture/adr/`
  (Section 14), reviewed by at least one platform-engineering principal-level reviewer, discussed
  to resolution in the PR itself (not a separate meeting whose outcome doesn't make it back into
  the document) — merged ADR = decided; an open ADR PR is not yet a decision anyone should build
  against.
- **Approval process**: the same PR review bar as Section 3, with the principal-level-reviewer
  requirement added specifically for ADRs and for anything touching the Terraform repository's
  `modules/` directory or the GitOps repository's `production` overlay.
- **Breaking-change policy**: a breaking API change requires an ADR, a new API version
  (Section 15), and a minimum two-release-cycle deprecation window on the old version before
  removal — announced in the API's own changelog and, for anything customer-facing, communicated
  through whatever the frontend team's release-notes channel is at the time.
- **Deprecation policy**: anything marked deprecated (a config key, an API version, an
  infrastructure pattern this document itself might later supersede) is removed on a tracked
  timeline stated at the moment it's deprecated, not left indefinitely — an ADR that deprecates
  something without stating a removal timeline is incomplete and shouldn't merge as-is.

---

Every future infrastructure or platform decision references this document and
`cloud-architecture-blueprint.md` together. Where a future phase's implementation needs a
convention this document doesn't cover, that gap is itself a signal to extend this document (via
the same PR review process, Section 23) before writing the implementation that needed it — not to
improvise a one-off convention and document it after the fact.
