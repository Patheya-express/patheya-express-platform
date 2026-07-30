# On-call guide and escalation matrix

Companion to [`runbook.md`](runbook.md) (what to actually do per alert) — this document is who
gets paged and when, per `cloud-architecture-blueprint.md`'s Operational Strategy ("On-call
rotation covers platform + backend together at launch scale; frontend... escalates through
platform on-call rather than carrying its own rotation until traffic justifies it").

## Severity levels

| Severity | Definition | Response time | Notification |
| --- | --- | --- | --- |
| SEV-1 | Customer-facing outage or order-creation path down (`Critical-ApiGateway-SLOBurnRateFast`, order-creation 99.95% SLO breach) | Page immediately | PagerDuty (placeholder wiring, Phase 8's `notify` action — real routing key not yet configured) |
| SEV-2 | Degraded but functional (realtime down, elevated error rate below burn-rate threshold, queue backlog) | Page within business hours, Slack outside | Slack + PagerDuty (Warning-tier alerts) |
| SEV-3 | Informational — dashboard-only, no customer impact yet | No page | Grafana/dashboard only |

Matches `platform-standards.md` Section 12's three-tier severity convention exactly
(`Critical`/`Warning`/`Info`) — this table is the on-call-facing restatement of that same
convention, not a new one.

## Escalation matrix

| Layer | Who | When |
| --- | --- | --- |
| Primary on-call (platform + backend, combined rotation) | Platform engineering | Every SEV-1/SEV-2 alert, first responder |
| Secondary (data layer: Aurora/ElastiCache) | Whoever owns `patheya-express-terraform`'s infrastructure | Escalate when `runbook.md`'s "Escalation" section applies — a data-layer health/failover question, not an application bug |
| Secondary (supply-chain/runtime security) | Platform security | Kyverno/Trivy/Falco alerts — `patheya-express-terraform`'s `docs/incident-response.md` |
| Frontend | No dedicated rotation | Escalates through platform on-call (blueprint's explicit design, revisit only once frontend traffic/incident volume justifies its own rotation) |
| Business/Product | Whoever owns customer communication | SEV-1 only, once confirmed real (not a false alarm) — customer-facing status update |

## What on-call needs before their first real shift

1. Read `runbook.md` in full — it's the actual per-alert playbook.
2. Confirm access: `kubectl` context for the environment on-call covers, Grafana/Prometheus/Loki
   read access, `argocd` CLI access, AWS console read access (CloudWatch/Aurora/ElastiCache).
3. Confirm the escalation contacts in this table are real people/channels, not placeholders — this
   document names *roles*, not individuals, since no real org chart exists in this session to
   populate it with.
4. Confirm PagerDuty/Slack webhook secrets are actually configured (`docs/ci-cd/ci-cd-guide.md`) —
   until they are, `notify`'s placeholder behavior means a SEV-1 alert produces a workflow summary
   and nothing else.

## Known gap

**No on-call rotation has ever been exercised against this platform for real** — this guide is a
structure, not a drilled procedure. The first real SEV-1 will be the first real test of whether
this escalation path actually works end to end.
