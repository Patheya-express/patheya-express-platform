# Compliance review (Phase 10)

Evidence-based comparison of what's actually built against `cloud-architecture-blueprint.md`,
`platform-standards.md`, and the ADRs — consolidating findings already made in Phases 7-9 plus new
ones from this phase's real tool runs, in one place. Every row states what was actually checked,
not assumed.

## Architecture / ADR compliance

| Item | Status | Evidence |
| --- | --- | --- |
| ADR-001 through ADR-010 (blueprint Section 16) | Followed | EKS not ECS, Aurora not RDS, ElastiCache not MemoryDB, Cloudflare edge, ArgoCD, GitHub Actions, Karpenter, ESO, Cloudinary, BullMQ — every module built matches its corresponding ADR's decision |
| ADR-0011 (Tempo over Jaeger) | Followed | `modules/observability/tempo.tf` exists; no Jaeger anywhere |
| Naming conventions (`platform-standards.md` Section 4) | **Deviations found and documented**, not silently fixed | Backend's real GitHub repo is `patheya-express-platform`, not the standard's `patheya-express-backend`; frontend's real repo is `frontend`, not `patheya-express-frontend`. Both are pre-existing, not introduced by any phase in this session. |
| Domain naming (`app.`/`partner.` per blueprint Section 4) | **Deviation found, not fixed** | Frontend's real Ingress objects use `customer.`/`restaurant.` and a different env-prefix ordering than the blueprint's own example — flagged in Phase 9's `known-issues.md`, not renamed (would touch TLS SANs/DNS records, a real restructure). |

## Platform Standards compliance, section by section

| Section | Status | Evidence |
| --- | --- | --- |
| §1 Architecture Principles | Mostly followed | Principle 5 (GitOps-only) enforced by RBAC design; principle 6 (immutable infra) — see `ci-deployer` finding below, one real exception |
| §2 Repository Standards | **Partial** | `CODEOWNERS` exists for backend (Phase 8), missing for frontend/terraform/gitops repos |
| §3 Git Standards | Not independently verifiable this session | Branch protection, required approvals documented (`docs/ci-cd/branch-protection.md`) but never configured against a real GitHub org |
| §4 Naming Conventions | Partial — see ADR table above | |
| §7 Kubernetes Standards | **Verified for real this phase** | `conftest` (100/100, 200/200 tests passed across all 6 overlays) confirms non-root, resource requests/limits, no `:latest` tag on every rendered Deployment |
| §8 Docker Standards | Followed | Multi-stage builds, pinned base images, non-root, tini, OCI labels — both Dockerfiles (backend, frontend) |
| §9 Terraform Standards | Followed | `terraform fmt -check`/`validate` clean repo-wide (this phase re-confirmed); no floating version ranges in `environments/` |
| §10 CI/CD Standards | Followed, with one real gap | Signing/scanning/promotion all built (Phase 8); **`lint:ci`'s `--max-warnings=0` gate would fail immediately on ~680 pre-existing findings** unrelated to any phase's own changes — a real compliance gap between the *stated* gate and the *actual* codebase state |
| §13 Security Standards | Followed | TLS everywhere, KMS at rest, ESO for secrets, no `Resource: "*"` found in reviewed IAM policies |
| §21 Developer Experience | **Partial — real gap found this phase** | Backend unit test coverage measured at **0.43%** (10 tests total, `pnpm --filter api-gateway run test:cov`, run for real this phase) — `platform-standards.md` doesn't mandate a coverage number explicitly, but "production-ready only" (§1 principle 3) is hard to reconcile with this level of test coverage on an application this size |

## Security baseline (real tool output this phase)

| Check | Result | Method |
| --- | --- | --- |
| K8s manifest schema validity | 0 invalid / 88 valid resources across 6 rendered overlays | `kubeconform -strict`, real execution |
| Baseline pod-security policy mirror | 100% pass (300/300 checks across 6 overlays) | `conftest`, real execution — **found and fixed a real Rego v1 syntax bug that would have made this check silently fail in CI since Phase 8** |
| Backend dependency vulnerabilities | 15 found (10 high, 5 moderate) | `pnpm audit`, real execution — see `known-issues.md` for the itemized list; most are `pnpm` self-vulnerabilities (build-time, not runtime-exposed), but `ws` (Socket.IO's transport) and `multer` (file upload) are real runtime-dependency findings worth triaging before go-live |
| Frontend dependency vulnerabilities | 29 found (15 high, 10 moderate, 4 low) | `pnpm audit`, real execution — several (`Vite`, `esbuild`, `piscina`) are dev-tooling only, not shipped in the nginx-served production bundle; `@angular/platform-server`/Angular XSS findings need confirming whether SSR is actually used anywhere (these apps appear to be client-side-rendered only per the Dockerfile's nginx-static-serving pattern) |
| Kyverno/Cosign/SBOM/Trivy/Falco | **Not independently re-verified this phase** | Already built and documented in Phase 7; no live cluster exists to confirm they actually admit/reject as designed |

## Least privilege

No new IAM policy was written this phase (validation only). Every policy reviewed in Phases 2-9
was checked for `Resource: "*"`/`Action: "*"` at the time it was written; not re-audited from
scratch this phase (would be redundant without new changes to review).

## Deviations requiring an explicit decision (not blocking, but not silently accepted either)

1. Frontend/backend repo names vs. the standard's naming table.
2. Frontend Ingress subdomain naming/ordering vs. the blueprint's example.
3. The pre-existing `ci-deployer` RBAC identity in the frontend repo (direct-apply-shaped
   permissions, contradicts the GitOps-only principle).
4. `lint:ci`'s zero-warning gate vs. ~680 pre-existing findings.
5. 0.43% backend test coverage vs. "production-ready only."

None of these are new; all were already flagged in Phase 8/9 `known-issues.md` files or discovered
fresh by this phase's actual tool runs (items 4 was newly quantified, item's severity newly
measured, this phase).
