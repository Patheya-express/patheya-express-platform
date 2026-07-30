# Signing guide (CI side)

What CI actually runs to produce the signatures, SBOM attestations, and provenance that
`patheya-express-terraform`'s `docs/verification-guide.md`/`docs/sbom-guide.md` describe Kyverno
verifying at admission time. That repo's docs describe the *check*; this doc describes the
*producer* — read both together.

## The exact identity Kyverno now expects

`modules/supply-chain-security/variables.tf`'s `cosign_certificate_identity_regexp` (Terraform
repo), corrected during this phase:

```
^https://github.com/Patheya-express/(patheya-express-platform|frontend)/\.github/workflows/.+@refs/heads/main$
```

Two real bugs fixed here, both verified against the GitHub API: the org segment was previously
all-lowercase (`patheya-express`) — the real, case-preserved login is `Patheya-express` — and the
frontend segment was `patheya-express-frontend`, which is only the pnpm workspace's package name
(`@patheya-express-frontend/source`); the actual GitHub repository is named `frontend`.

Every signature this phase's workflows produce comes from a workflow file under
`.github/workflows/` in one of those two repos, run on `refs/heads/main` — matching this regexp by
construction, not by coincidence:

- `patheya-express-platform/.github/workflows/backend-release.yml` (via
  `reusable-docker-publish.yml`'s `cosign-sign` step)
- `frontend/.github/workflows/frontend-release.yml`

## What each workflow run actually produces, per image

1. **Cosign signature** (`cosign sign --yes <digest>`, keyless) — Fulcio issues a short-lived cert
   from the run's OIDC token, Rekor logs the signature publicly. This is what
   `verify-image-signatures` checks.
2. **CycloneDX SBOM attestation** (`cosign attest --yes --predicate sbom.cdx.json --type cyclonedx
   <digest>`) — same OIDC identity, a different claim (a signed statement *about* the image, not
   just a signature over it). This is what `verify-sbom-attestation` checks (Audit-only, per that
   policy's own reasoning in `policy-guide.md`).
3. **SLSA provenance** (`actions/attest-build-provenance`) — GitHub's own attestation store, a
   third, independent claim (how the image was built: which repo, which workflow, which commit).
   Not checked by Kyverno today; verifiable via `gh attestation verify` or
   `cosign verify-attestation --type slsaprovenance`.

## Manually verifying what CI produced

```bash
cosign verify \
  --certificate-identity-regexp '^https://github.com/Patheya-express/patheya-express-platform/\.github/workflows/.+@refs/heads/main$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  <ecr-registry>/patheya-express/api-gateway@sha256:<digest>

gh attestation verify oci://<ecr-registry>/patheya-express/api-gateway@sha256:<digest> \
  --owner Patheya-express
```

## Why signing happens before, not after, Trivy's blocking gate

`reusable-docker-publish.yml` runs the blocking Trivy scan *before* `cosign-sign` — an image this
platform is about to cryptographically vouch for should never be one Trivy already flagged
HIGH/CRITICAL against. A scan failure means no signature, no SBOM attestation, and no GitOps PR
are ever produced for that digest.

## What is not automated by this phase

Narrowing `cosign_certificate_identity_regexp` from "any workflow file in either repo" to the two
specific filenames named above is a Terraform change (`modules/supply-chain-security`), not a CI
change — deliberately left one notch broader for now (see that variable's own description) so a
future workflow-file rename doesn't require a lock-step Terraform PR.
