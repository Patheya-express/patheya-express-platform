# Cost review (Phase 10)

**This is an estimate, not actual AWS billing data** — no AWS account is connected in this
session (`terraform apply` has never run), so there is no real Cost Explorer/CUR data to review.
What follows is a bottom-up estimate built from the actual instance types/counts/shard counts
configured in `environments/*/data/main.tf` and `modules/*/variables.tf` defaults, cross-checked
against `cloud-architecture-blueprint.md` Section 13's own table — not a substitute for a real
Cost Explorer review once billing data exists.

## Configured sizing (verified by reading the actual `.tf` files, not assumed)

| Component | Development | Staging | Production |
| --- | --- | --- | --- |
| Aurora | Serverless v2 (`serverless = true`) | Serverless v2 (`serverless = true`) | `db.r6g.xlarge` writer + `db.r6g.large` reader, provisioned |
| ElastiCache | `cache.t4g.micro`, 1 shard, 0 replicas | `cache.t4g.small`, 1 shard, 1 replica | `cache.r6g.large`, 3 shards, 1 replica each |
| NAT Gateways | Per `single_nat_gateway` var (1 or 3) | Same | Same |
| EKS node groups | System + application node groups, instance types/sizes via `var.system_node_instance_types`/`var.application_node_instance_types` (Karpenter-adjusted at runtime — Terraform owns min/max, not desired) | | |

## Estimated monthly cost (ap-south-1, on-demand list pricing, order-of-magnitude only)

| Tier | Estimate | Basis |
| --- | --- | --- |
| Development | ~$400-700/mo | Aurora Serverless v2 (scales toward 0.5 ACU idle), single-shard micro Redis, 1-3 NAT gateways, small Karpenter floor |
| Staging | ~$900-1,400/mo | Aurora Serverless v2 (higher baseline ACU), 1-shard+replica small Redis, comparable node footprint to dev but HA-shaped |
| Production | ~$4,000-5,500/mo | Matches `cloud-architecture-blueprint.md` Section 13's own "Launch" tier estimate (`db.r6g.xlarge`+reader, 3-shard `cache.r6g.large`, 3-6 app nodes) — this phase's actual configured values match that table's assumptions closely enough to reuse its estimate rather than re-derive a materially different one |

Total, all three environments: **very roughly $5,500-7,500/month** before Reserved Instance/
Savings Plan/Spot discounts (blueprint Section 14) — directional for planning, not a committed
budget figure, and explicitly **not** validated against a real bill.

## What a real cost review (once billing data exists) should check

1. **Idle resources**: development/staging environments running 24/7 when they're only used
   during business hours is the single largest realistic savings opportunity at this scale —
   nothing in the current Terraform config schedules a scale-to-zero/stop for non-production
   environments. Worth a follow-up decision (out of this phase's scope to implement — "no new
   infrastructure").
2. **NAT Gateway count**: `single_nat_gateway` toggle exists per-environment — confirm
   development/staging actually use the single-NAT option (cheaper, acceptable risk for
   non-production) rather than defaulting to production's 3-NAT-per-AZ pattern.
3. **Aurora Serverless v2 min/max ACU** in dev/staging — confirm the configured floor is genuinely
   near-zero for idle periods, not accidentally provisioned at a fixed higher baseline.
4. **Reserved Instances/Savings Plans** (blueprint Section 14): explicitly deferred until "instance-
   class sizing stabilizes past the launch tier" — correct call to defer, not a gap, but worth
   revisiting once real usage data exists (VPA recommendations, Phase 5's dashboards).
5. **ECR storage**: `keep_last_n_tagged_images = 30` (Phase 2) bounds this already — verify it's
   actually keeping cost in check once real image volume accumulates, not just check the setting
   exists.

## Rightsizing

VPA (`modules/eks-addons`) is deployed in recommendation-only mode (`updateMode: "Off"`) — by
design, per Phase 1A's original decision, carried forward — no `requests`/`limits` change should
happen until real VPA recommendation data exists from actual running workloads, which requires the
live deployment this report's Section on infrastructure/application deployment couldn't execute.
