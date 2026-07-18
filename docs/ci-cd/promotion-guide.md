# Promotion guide

How an image moves `development` → `staging` → `production` — Section 7 (Promotion Strategy).

## The flow

```mermaid
flowchart LR
    Merge[Merge to main] --> Release[backend-release.yml /\nfrontend-release.yml]
    Release --> ECR[(ECR: signed, scanned,\nSBOM-attested image)]
    Release --> DevPR[GitOps PR: development overlay]
    DevPR -->|auto-merge| DevSync[ArgoCD: development\n(manual sync, still human-triggered)]
    ECR -.same digest, no rebuild.-> PromoteStaging[backend-promote.yml /\nfrontend-promote.yml\nenvironment=staging]
    PromoteStaging --> StagingPR[GitOps PR: staging overlay]
    StagingPR -->|human review + merge| StagingSync[ArgoCD: staging]
    ECR -.same digest, no rebuild.-> PromoteProd[*-promote.yml\nenvironment=production]
    PromoteProd --> ProdPR[GitOps PR: production overlay]
    ProdPR -->|2-approver review + merge| ProdSync[ArgoCD: production]
```

## Development: continuous

Every merge to `main` that passes `backend-ci.yml`/`ci.yml`+`docker-build.yml` triggers
`backend-release.yml`/`frontend-release.yml`, which opens **and auto-merges** a GitOps PR against
`applications/*/overlays/development`. This is the one place in the whole pipeline where a PR
merges without a human — deliberate, matching `platform-standards.md` Section 6 ("Development:
Continuous deploy on every merge to main"), and low-risk because the PR is bot-authored, mechanical
(a single `images:` field), and already passed `gitops-ci.yml`'s validation before merge.

ArgoCD's `development` `Application`s remain on **manual sync** even after this phase — the GitOps
PR lands the intended state in Git; a human (or a future Phase 9 change) still triggers the actual
`argocd app sync`. This phase's DO NOT IMPLEMENT list reserves "Application deployment" for Phase 9.

## Staging and production: manual promotion

Run `backend-promote.yml`/`frontend-promote.yml` (`workflow_dispatch`) with the target environment
and the exact `<semver>-<git-sha-short>` tag to promote — a tag that must already exist in ECR
(i.e. already built, scanned, signed, and attested by a prior release run). This workflow:

1. Never rebuilds anything.
2. Opens a GitOps PR against `applications/*/overlays/staging` or `.../production`.
3. Never sets `auto-merge` — the PR sits until a human reviews and merges it, per
   `platform-standards.md` Section 3's two-approver bar for anything touching `k8s/`-shaped paths,
   and Section 7's "no direct pushes to production."

Production additionally has ArgoCD's own sync-window deny block
(`modules/argocd/projects.tf`, `00:00–08:00`/`20:00–23:59` UTC) — even a manual sync is blocked
outside that window, on top of the GitOps PR's own review requirement.

## Branch protection ties this together

See [`branch-protection.md`](branch-protection.md) — required status checks on
`patheya-express-gitops`'s `main` branch include `gitops-ci.yml`'s validation job, so a malformed
promotion PR can never merge regardless of how many humans approve it.
