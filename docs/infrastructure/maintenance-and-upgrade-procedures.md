# Maintenance and upgrade procedures

## Routine maintenance (no customer-visible downtime expected)

- **Rolling application deploys**: already zero-downtime by construction (`maxUnavailable: 0`,
  `readinessProbe`-gated) — no special maintenance window needed for a normal release.
- **Node replacement (Karpenter consolidation/drift)**: PodDisruptionBudgets (every Deployment)
  make this safe by design — Karpenter won't drain a node past what the PDB allows. No manual
  action needed under normal operation.
- **Certificate renewal**: ACM auto-renews (DNS-validated) — no manual action.

## Planned maintenance requiring a window

- **Aurora major version upgrade**: the one case `cloud-architecture-blueprint.md`'s Availability
  Goals explicitly calls out as needing a scheduled maintenance window (not zero-downtime by AWS's
  own engine-upgrade mechanics). Schedule during the lowest-traffic window, communicate in advance,
  confirm the DR runbook's restore procedure still matches the new engine version afterward.
- **EKS control plane upgrade**: N-1 policy (`cloud-architecture-blueprint.md` Section 3) — never
  bleeding-edge, never more than one minor version behind. Upgrade cluster control plane first,
  then node groups (Karpenter NodePools' AMI reference), one environment at a time
  (development → staging → production), confirming application health between each.
- **Kyverno/Trivy/Falco/ArgoCD/observability-stack Helm chart upgrades**: `terraform plan` first —
  a chart version bump in any `modules/*` Terraform file shows exactly what changes before
  `apply`. Never upgrade via `helm upgrade` by hand against a Terraform-managed release (creates
  drift Terraform's next `plan` will flag).

## Upgrade procedure (general pattern, any component)

1. `terraform plan` against development first — confirm the diff is exactly the expected version
   bump, nothing else drifted.
2. Apply to development, verify (readiness probes, `docs/infrastructure/runbook.md`'s health
   checks, relevant Grafana dashboard).
3. Repeat against staging, same verification.
4. Repeat against production, during a planned window if the component is in the "requires a
   window" list above, during normal operation otherwise.
5. Update `.terraform-version`/chart version pins in the same PR as the upgrade — never leave a
   pin stale after manually upgrading (defeats the entire purpose of pinning).

## What this phase could not validate

No upgrade in this list has actually been performed against a real cluster — this procedure is
reasoned from the platform's documented design (N-1 policy, PDB-safe node replacement, Terraform's
own plan-before-apply discipline), not drilled. Treat the first real upgrade of each component as
also validating this procedure, not just the component.
