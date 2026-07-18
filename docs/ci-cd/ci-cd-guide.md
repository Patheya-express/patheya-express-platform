# CI/CD guide

The enterprise CI/CD platform (Phase 8) built across all four repositories — what exists, where it
lives, and why. Companion docs: [`workflow-guide.md`](workflow-guide.md) (per-workflow reference),
[`release-guide.md`](release-guide.md), [`promotion-guide.md`](promotion-guide.md),
[`signing-guide.md`](signing-guide.md), [`pipeline-troubleshooting-guide.md`](pipeline-troubleshooting-guide.md),
[`branch-protection.md`](branch-protection.md).

## The one rule everything else follows

**CI publishes artifacts. GitOps deploys artifacts.** No workflow in any of the four repos ever
runs `kubectl`, `helm`, or `argocd` against a real cluster. Every workflow that proposes a deploy
does it by opening a pull request against `patheya-express-gitops` — ArgoCD (already installed,
Phase 6/ArgoCD phase) is the only thing that ever reconciles a Git commit into a running Deployment,
and only once a human (or, for `development` only, an auto-merge) actually merges that PR.

## Where things live, and why

| What | Lives in | Why |
| --- | --- | --- |
| Composite actions (7) | `patheya-express-platform/.github/actions/` | Single-job step sequences (setup, build+push, SBOM, sign, scan, GitOps PR, notify) reused identically by the backend and frontend repos — GitHub's `owner/repo/path@ref` syntax lets any repo reference these directly, no publishing to a separate marketplace/repo needed. |
| Reusable workflows (4) | `patheya-express-platform/.github/workflows/reusable-*.yml` | Whole-job orchestrations (Node quality gate, Docker build+scan+sign+publish, Terraform plan, GitOps validation) called via `workflow_call` from any of the four repos. |
| Repo-specific pipelines | Each repo's own `.github/workflows/` | `backend-ci.yml`/`backend-release.yml`/`backend-promote.yml` (platform repo), `ci.yml`/`docker-build.yml`/`frontend-release.yml`/`frontend-promote.yml`/`sdk-update.yml`/`security-scan.yml`/`codeql.yml` (frontend repo), `terraform-ci.yml` (Terraform repo), `gitops-ci.yml` (gitops repo). |
| Docs | `patheya-express-platform/docs/ci-cd/` (this directory) | The platform repo is where the shared composite actions/reusable workflows live, so it's the natural single home for the docs describing them — consistent with `platform-standards.md` Section 2's stance against a speculative separate docs repo. |

No fifth repo was created for this. `patheya-express-platform` was chosen over the alternative
(duplicating the same YAML into all four repos) because GitHub's cross-repo `uses:` syntax makes
one real, working repo just as reusable as a dedicated "actions" repo would be, without the
maintenance overhead of a repo that exists only to hold YAML.

## OIDC — the only credential mechanism

Every AWS-facing step authenticates via GitHub's OIDC provider (`modules/iam` in the Terraform
repo) — no long-lived AWS access key exists anywhere in any repo's secrets. Three purpose-specific
roles exist, least-privilege scoped:

| Role | Trust condition | Grants |
| --- | --- | --- |
| `<prefix>-terraform-role` | `repo:Patheya-express/patheya-express-terraform:ref:refs/heads/main` | Infrastructure provisioning (Terraform CI only) |
| `<prefix>-backend-ecr-push-role` | `repo:Patheya-express/patheya-express-platform:ref:refs/heads/main` | Push to the `api-gateway` ECR repository only |
| `<prefix>-frontend-ecr-push-role` | `repo:Patheya-express/frontend:ref:refs/heads/main` | Push to the four frontend app ECR repositories only |

All three require the exact, real GitHub organization login case (`Patheya-express`, capital P) —
verified against the GitHub API during this phase; a prior version of this repo's own IAM module
had the org hardcoded in all lowercase, which would never have matched a real token. See
`modules/iam/variables.tf` in the Terraform repo for the full history of that fix.

Cosign's keyless signing uses the same OIDC token via a different, ambient path — no `role-to-assume`
is needed for signing itself, only `permissions: id-token: write` at the workflow level (Sigstore's
Fulcio issues a short-lived certificate directly from the GitHub Actions OIDC token, independent of
AWS entirely).

## Required repository configuration (secrets and variables)

Not created by this phase (no GitHub API/Terraform GitHub-provider access from this session) —
configure these once, by hand, before the first real pipeline run:

| Name | Kind | Repos | Purpose |
| --- | --- | --- | --- |
| `BACKEND_ECR_PUSH_ROLE_ARN` | variable | platform | Output of `module.iam.backend_ecr_push_role_arn` |
| `FRONTEND_ECR_PUSH_ROLE_ARN` | variable | frontend | Output of `module.iam.frontend_ecr_push_role_arn` |
| `TF_ROLE_ARN_DEVELOPMENT` / `_STAGING` / `_PRODUCTION` / `_SHARED_SERVICES` / `_SECURITY` / `_MANAGEMENT` | variable | terraform | Per-account `module.iam.terraform_role_arn` output |
| `GITOPS_PR_TOKEN` | secret | platform, frontend | Token with `contents:write`+`pull-requests:write` on `patheya-express-gitops` — a GitHub App installation token is recommended (short-lived, scoped, auditable) over a personal PAT; see this doc's "GitOps PR token" section below |
| `PLATFORM_RELEASE_READ_TOKEN` | secret | frontend | Token that can read `patheya-express-platform`'s Releases (for `sdk-update.yml`) and open the `openapi-updated` `repository_dispatch` (for `backend-release.yml`) |
| `SLACK_WEBHOOK_URL` | secret | platform, frontend | Optional — the `notify` composite action no-ops if unset (Section 12's "placeholder") |
| `PAGERDUTY_ROUTING_KEY` | secret | platform, frontend | Optional — same placeholder behavior |

### GitOps PR token

A single GitHub App, installed on `patheya-express-gitops` only, with `contents:write` +
`pull-requests:write` repository permissions, is the recommended source for `GITOPS_PR_TOKEN` — an
installation token is minted fresh per workflow run (via `actions/create-github-app-token` or
equivalent) and expires within the hour, unlike a personal access token sitting in secrets
indefinitely. A fine-grained PAT scoped to just that one repository is an acceptable fallback if
standing up a GitHub App isn't practical yet, at the cost of a manual rotation burden this phase
didn't build tooling for.

## Deliberately not built in this phase

- **No `terraform apply` workflow.** Section 4's own instruction stops at "plan artifact
  generation... no automatic apply" — an apply path (even one gated behind `workflow_dispatch`) is
  a meaningfully bigger risk surface than a plan, and wasn't asked for by name.
- **No automated ArgoCD sync.** Every `Application` in the gitops repo stays on manual sync
  (unchanged from the prior ArgoCD phase) — flipping that to `automated` is "Application
  deployment," which this phase's own DO NOT IMPLEMENT list reserves for Phase 9.
- **No real branch-protection API calls.** `branch-protection.md` documents exactly what to
  configure; nothing in this session has network access to a real GitHub org to configure it via
  `gh`/the API, and Section 11 itself asks for "documentation," not enforcement.
