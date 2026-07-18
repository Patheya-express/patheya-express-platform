# Pipeline troubleshooting guide

## `backend-release.yml` / `frontend-release.yml` never started

These trigger via `workflow_run` (backend) or a direct `push` filter on app/infra paths (frontend).
Check: did `backend-ci.yml` actually conclude `success` on the exact commit pushed to `main`? A
`workflow_run` trigger fires on completion regardless of outcome — the `if:
github.event.workflow_run.conclusion == 'success'` guard on the `version` job is what actually gates
it, so a look at that job's own `if` evaluation (visible in the Actions UI) tells you immediately
whether the gate, not the trigger, is what's blocking a run.

## `cosign sign` fails with an OIDC error

Almost always a missing `permissions: id-token: write` somewhere in the call chain — this must be
set on the *job* that ultimately invokes `cosign-sign`, and reusable workflows only receive
permissions the calling job explicitly grants (GitHub does not let a called workflow escalate
beyond what its caller has). `reusable-docker-publish.yml` already declares
`permissions: id-token: write` at its own top level, which is sufficient when it's invoked via
`uses:` from a caller job — but if you're adding a new workflow that calls the `cosign-sign`
composite action directly (not through the reusable workflow), that new workflow's own job needs
the same permission, or Sigstore has no OIDC token to exchange for a certificate.

## `verify-image-signatures` still rejects a CI-signed image in-cluster

1. Confirm the signature actually exists: `cosign verify` by hand
   (`docs/ci-cd/signing-guide.md`'s command). If this fails, the problem is upstream (CI never
   signed it, or signed the wrong digest) — not the Kyverno policy.
2. If `cosign verify` succeeds by hand but Kyverno still rejects it, the near-certain cause is
   `cosign_certificate_identity_regexp` (Terraform repo) not matching the real identity — check
   the org/repo case and name exactly (`docs/ci-cd/signing-guide.md` documents the one bug already
   found and fixed here; a *second* mismatch would mean the workflow file moved to a different
   repo/path than the regexp expects).
3. Check `image_verification_policy_mode` hasn't been left at `Audit` somewhere it shouldn't be
   (`policy-guide.md`, Terraform repo) — Audit mode logs a `PolicyReport` violation but still
   admits the pod, which looks like "it worked" for the wrong reason.

## A GitOps PR never appears

- Check `GITOPS_PR_TOKEN` is actually set and has write access to `patheya-express-gitops` — a
  silently-expired or missing token makes `peter-evans/create-pull-request` fail the step, not the
  whole job in a way that's always obvious from the job summary; check the step's own log.
- Check the `app-path` input actually exists in the gitops repo at the ref being checked out —
  a typo here fails the `kustomize edit set image` step with a clear "no such file" before the PR
  step even runs.

## `kustomize edit set image` silently does nothing on a later promotion

`image-name-old` must always be the **same, stable string** across every call for a given
app/overlay (it's a match key against the literal `image:` field kustomize's base manifest — never
changed by `kustomize edit set image` itself, only `newName`/`newTag` are). If a workflow was ever
edited to pass a *different* `image-name-old` than prior runs used, the new entry won't match the
existing one and either silently fails to update it or creates a second, conflicting `images:`
entry. Check `kubectl kustomize` output for duplicate `images:` entries against the same base name
if a promotion "succeeds" (PR merges cleanly) but the running image doesn't actually change.

## `gitops-ci.yml` fails on `kubeconform` for a CRD-backed resource (e.g. `PolicyException`)

`-ignore-missing-schemas` is already set — if this still fails, the CRD's schema likely isn't
published at the `datreeio/CRDs-catalog` location the workflow points at. Add
`-skip <Kind>` for that specific kind rather than disabling schema validation more broadly, and
note the gap in this doc so the next person doesn't have to rediscover it.

## Terraform plan job fails at `terraform init` with a backend error

`reusable-terraform-plan.yml`'s `needs-plan: true` path assumes the calling workflow already
configured AWS credentials for that specific account/role — check `terraform-ci.yml`'s per-account
job actually points at the right `vars.TF_ROLE_ARN_<ACCOUNT>` and that variable is actually set at
the repository (not just documented in `ci-cd-guide.md`).

## `frontend-release.yml`'s per-app jobs report the wrong image name/digest for a different app

This would mean the matrixed job's steps got merged/refactored in a way that lost per-leg
isolation — every build/scan/sign/gitops-update step for one app must stay in the *same* job leg,
never split into a separate job that reads `needs.<matrixed-job>.outputs` (GitHub only exposes one
arbitrary leg's outputs to a downstream job when the upstream job is a matrix). See
`frontend-release.yml`'s own header comment.
