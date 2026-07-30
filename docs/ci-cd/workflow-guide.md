# Workflow guide

Every workflow and composite action this phase built, what triggers it, and what it does. See
[`ci-cd-guide.md`](ci-cd-guide.md) for the overall architecture.

## Composite actions (`patheya-express-platform/.github/actions/`)

| Action | Purpose | Key inputs |
| --- | --- | --- |
| `setup-pnpm-node` | Pinned pnpm + Node + frozen-lockfile install | `pnpm-version` (required, no shared default — backend/frontend pin different versions) |
| `docker-build-push-ecr` | OIDC login + Buildx build + push to ECR | `ecr-repository`, `image-tag`, `role-to-assume` |
| `generate-sbom` | Syft CycloneDX SBOM against a digest-pinned image | `image-ref` |
| `cosign-sign` | Keyless sign + optional SBOM attest | `image-ref`, `sbom-path` |
| `trivy-scan` | SARIF upload (always) + blocking gate (`exit-code`) | `image-ref`, `severity`, `trivyignore-path` |
| `gitops-image-update` | Opens (or updates) a PR bumping an `images:` entry in the gitops repo | `app-path`, `image-name-old`, `image-name-new`, `image-tag`, `auto-merge` |
| `notify` | Workflow summary + optional Slack/PagerDuty | `status`, `title`, `slack-webhook-url` |

## Reusable workflows (`patheya-express-platform/.github/workflows/reusable-*.yml`)

| Workflow | Purpose | Called by |
| --- | --- | --- |
| `reusable-node-quality.yml` | lint + typecheck + test, with Postgres/Redis service containers always available | (available to any repo; not currently called directly — backend/frontend each run their own lint/test steps since their invocation patterns differ enough — `pnpm --filter` vs `nx affected` — to not share one generic wrapper cleanly. Kept as a ready-made option for a future repo that needs a plain lint/test/service-container job.) |
| `reusable-docker-publish.yml` | build → Trivy gate → SBOM → cosign sign+attest → SLSA provenance | `backend-release.yml` |
| `reusable-terraform-plan.yml` | fmt → validate → tflint → tfsec → Checkov → (optional) plan | `terraform-ci.yml`, once per module and once per environment stage |
| `reusable-gitops-validate.yml` | kustomize build → kubeconform → conftest | `gitops-ci.yml`, once per overlay |

## Per-repo pipelines

### `patheya-express-platform` (backend)

- **`backend-ci.yml`** — PR + push-to-main: lint/typecheck/test (via `reusable-node-quality.yml`),
  Prisma validation, OpenAPI export + Swagger lint, a no-push Docker build check. Never touches AWS.
- **`backend-release.yml`** — triggered by `workflow_run` once `backend-ci.yml` succeeds on `main`:
  computes the next semver, calls `reusable-docker-publish.yml`, tags + creates a GitHub Release
  (with `openapi.json` attached), dispatches `openapi-updated` to the frontend repo, opens a
  `development`-overlay GitOps PR (auto-merge), notifies.
- **`backend-promote.yml`** — `workflow_dispatch`: opens a `staging`/`production`-overlay GitOps PR
  for an already-published tag. Never builds anything.
- **`codeql.yml`** — weekly + PR/push CodeQL analysis.

### `frontend`

- **`ci.yml`** (pre-existing, unchanged) — Nx-affected lint/test/build.
- **`docker-build.yml`** (trimmed) — PR-only build+smoke-test, no push, no AWS.
- **`frontend-release.yml`** (new) — push-to-main: one shared semver across all four apps, a
  matrixed job per app doing build→scan→sign→SBOM→provenance→GitOps PR (development, auto-merge)
  in a single linear sequence (see the workflow's own header comment for why this couldn't be split
  across two matrixed jobs), then one combined GitHub Release.
- **`frontend-promote.yml`** (new) — `workflow_dispatch`, one or all four apps, staging/production.
- **`sdk-update.yml`** (new) — `repository_dispatch` (`openapi-updated`) or manual: downloads the
  backend's published `openapi.json`, regenerates `libs/shared/api-sdk`, opens a PR.
- **`security-scan.yml`** (trimmed) — dependency audit + filesystem scan + CodeQL-SARIF upload only;
  its old `image-scan` job was removed as redundant with `frontend-release.yml`'s blocking Trivy gate.
- **`codeql.yml`** (new).

### `patheya-express-terraform`

- **`terraform-ci.yml`** — module validation (dynamically discovered via `find modules -maxdepth 1`)
  plus six explicit per-account plan jobs (development/staging/production each with
  cluster/data/platform/root sub-stages, plus shared-services/security/management). Never applies.

### `patheya-express-gitops`

- **`gitops-ci.yml`** — every overlay (backend ×3, frontend ×3, infrastructure ×3) rendered and
  schema-validated, plus the small conftest policy set in `policy/*.rego`.

## Naming

Every workflow file name follows `platform-standards.md` Section 10
(`<repo-purpose>-<trigger>.yml`); every job name is verb-first. Reusable workflows are the one
deliberate exception (`reusable-<subject>.yml`), since "trigger" doesn't apply to a
`workflow_call`-only file.
