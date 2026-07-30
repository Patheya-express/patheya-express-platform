# Release guide

How a version number, a Git tag, a GitHub Release, and an ECR image tag all relate — Section 9
(Release Management) + `platform-standards.md` Section 3 (Semantic Versioning).

## Versioning

`paulhatch/semantic-version` computes the next `major.minor.patch` from Conventional Commits since
the last `v*` tag, on every push to `main`:

- A commit subject matching `!:` or containing a `BREAKING CHANGE:` footer → major bump.
- A commit subject matching `feat(...)?:` → minor bump.
- Anything else (`fix:`, `chore:`, `docs:`, `ci:`, `refactor:`, `test:`) → patch bump.

One counter per repository (not per app) — the frontend repo's four apps share a single version and
a single GitHub Release per push to `main`, matching `platform-standards.md` Section 3's "internal-
only changes... don't bump the application version at all" together with the reality that all four
apps live in one repo and release together.

## Image tag vs. release tag

Two different strings, both derived from the same computed version, per
`platform-standards.md` Section 4:

- **ECR image tag**: `<semver>-<git-sha-short>` (e.g. `1.4.2-a1b2c3d`) — immutable, traceable back
  to the exact commit and CI run that produced it.
- **Git/Release tag**: `v<semver>` (e.g. `v1.4.2`) — the human-facing release marker.

## GitHub Releases

Created by `backend-release.yml`/`frontend-release.yml` via `gh release create --generate-notes` —
GitHub's own auto-generated notes (grouped by PR labels/Conventional Commit type) are the release
notes; nothing hand-written. The backend's release additionally attaches `openapi.json` as a
release asset (consumed by `sdk-update.yml` in the frontend repo).

## Artifact retention

- **ECR**: `modules/ecr`'s lifecycle policy (Phase 2) — untagged images expire after 7 days, the 30
  most recent tagged images per repository are kept indefinitely.
- **SBOMs**: uploaded as a workflow artifact, 90-day retention (`actions/upload-artifact`), in
  addition to living permanently as a Cosign attestation OCI artifact in ECR itself (the artifact
  upload is for convenient human/CI download; the OCI attestation is the durable, verifiable copy).
- **Terraform plans**: 14-day retention — long enough to review a PR, short enough not to
  accumulate stale plans nobody will ever apply.

## What is never rebuilt

Per `platform-standards.md` Section 10: the exact digest built and signed by `backend-release.yml`/
`frontend-release.yml` is the only artifact `backend-promote.yml`/`frontend-promote.yml` ever
reference — promotion opens a GitOps PR pointing `staging`/`production` at an existing tag, never
triggers a new build.
