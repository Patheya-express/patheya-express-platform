# Branch protection

Section 11 asks for branch-protection *documentation* specifically — nothing in this session has
network access to a real GitHub organization to configure this via the API/`gh`, and introducing a
new Terraform provider (`integrations/github`) to manage it declaratively is a real architecture
decision this phase didn't make unprompted. Configure the following by hand, once, per repository
(Settings → Branches → Branch protection rules → `main`), matching
`platform-standards.md` Section 3 exactly.

## Every repository (`patheya-express-platform`, `frontend`, `patheya-express-terraform`,
`patheya-express-gitops`)

- Require a pull request before merging — no direct pushes to `main`, no exceptions, including
  admins.
- Require approvals: **1** minimum.
- Require review from Code Owners (depends on a real `CODEOWNERS` file — see below).
- Require branches to be up to date before merging.
- Require conversation resolution before merging.
- Do not allow force pushes. Do not allow deletions.

## Two-approver paths (`platform-standards.md` Section 3: "2 for anything touching `k8s/`,
`modules/` in the Terraform repo, or `Dockerfile`")

GitHub's branch protection UI doesn't support a path-conditional approval count natively — the
closest native mechanism is `CODEOWNERS`-driven review plus a second, path-scoped rule via a
merge-queue/ruleset (GitHub Rulesets support path-conditional rules; classic branch protection
does not). Until Rulesets are configured, treat this as a **process** requirement enforced by
`CODEOWNERS` + reviewer discipline: a PR touching `k8s/`, `modules/`, or `Dockerfile` should not be
approved by only one reviewer, even though the platform doesn't yet block it mechanically.

## Required status checks, per repository

| Repository | Required checks |
| --- | --- |
| `patheya-express-platform` | `backend-ci.yml` → `quality`, `prisma-validate`, `openapi`, `docker-build-check`; `codeql.yml` → `analyze` |
| `frontend` | `ci.yml` → `lint`, `test`, `build`; `docker-build.yml` → `build`; `security-scan.yml` → `dependency-audit`, `filesystem-scan`; `codeql.yml` → `analyze` |
| `patheya-express-terraform` | `terraform-ci.yml` → every `validate-modules`/`plan-*` job |
| `patheya-express-gitops` | `gitops-ci.yml` → `validate` |

## `CODEOWNERS`

`patheya-express-platform/CODEOWNERS` was added this phase with placeholder team slugs
(`@Patheya-express/backend-team`, `@Patheya-express/platform-team`) — replace with this
organization's real team slugs before turning on "Require review from Code Owners." The frontend,
Terraform, and gitops repos still need their own `CODEOWNERS` files — not added this phase (no
equivalent gap was found/flagged for those repos during this phase's audit the way it was for the
backend repo), but the same pattern applies.

## Auto-merge

`gitops-image-update`'s `auto-merge: "true"` path (used only for `development`) calls
`gh pr merge --auto --squash` — this requires the repository setting **Settings → General → Pull
Requests → Allow auto-merge** to be enabled on `patheya-express-gitops`, or that call fails
silently-ish (the PR stays open, unmerged, and a human has to notice and merge it manually).
