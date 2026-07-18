# ADR-0011: Replace Jaeger with Grafana Tempo

**Status:** Accepted

**Supersedes:** `cloud-architecture-blueprint.md` Section 10 ("OpenTelemetry SDK (NestJS) →
Jaeger"). That mention predates Phase 5's detailed observability-platform specification, which
explicitly named Tempo without an accompanying ADR — this document is the ADR that instruction
was missing, written per `platform-standards.md` Section 23 ("a proposal that contradicts an
existing ADR needs a new ADR explicitly superseding the old one, not a silent divergence") rather
than leaving the blueprint and the deployed infrastructure permanently disagreeing with each
other.

## Problem

Need a distributed tracing backend for the OpenTelemetry SDK integration
(`cloud-architecture-blueprint.md` Section 10) — storage and query engine for traces the backend
will eventually emit via OTLP, reachable from Grafana alongside the Prometheus and Loki
datasources Phase 5 already installed.

## Options Considered

Jaeger (the blueprint's original Section 10 mention), Grafana Tempo, Zipkin.

Zipkin was not seriously evaluated — it predates OpenTelemetry's OTLP as a native ingestion
format and has materially weaker Grafana integration than either Jaeger or Tempo, with no
distinguishing advantage over both that would justify including it as a real contender.

## Decision

Grafana Tempo.

## Tradeoffs

- **Native Grafana integration.** Tempo is Grafana Labs' own tracing backend, purpose-built to
  pair with Grafana's Explore view and with trace↔log↔metric correlation
  (`docs/observability-guide.md`'s derivedFields/tracesToLogs/tracesToMetrics wiring) — Jaeger's
  own UI would either sit alongside Grafana as a second pane of glass, or require a
  community-maintained Grafana plugin to reach the same level of integration Tempo has by
  default.
- **Lower operational complexity.** Tempo has no dependency on a separate indexing datastore
  (Cassandra/Elasticsearch, Jaeger's two most common backends) — it indexes only trace IDs and
  stores everything else as object-storage blocks, meaning `modules/observability/tempo.tf`
  needed one S3 bucket and one IRSA role, not a second stateful clustered datastore to size,
  patch, and back up independently.
- **Object storage architecture.** Tempo's S3-native design fits this platform's already-
  established pattern (Loki, Aurora backups, and Tempo itself all lean on S3 for durable,
  cheap, lifecycle-managed storage) — Jaeger's Cassandra/Elasticsearch backends would have been
  the one tracing-specific exception to that pattern.
- **Better OpenTelemetry alignment.** Tempo's ingestion path is OTLP-first; Jaeger added OTLP
  support later, on top of its own older native protocol. Since this platform's entire tracing
  story starts from the OpenTelemetry Collector (`docs/otel-guide.md`), not a Jaeger-native
  client, Tempo requires no protocol-translation layer.
- **Lower infrastructure footprint.** No separate query/collector/agent component split to
  provision and IRSA-scope independently — one Helm release, one `tempo` service account, one
  set of resource requests/limits, matching the same "one Helm release per subsystem" shape
  every other Phase 5 component (Loki, kube-prometheus-stack, the OTel Collector) already has.
- **Single observability ecosystem.** Prometheus, Loki, and Tempo are the three legs of Grafana
  Labs' own "LGTM" stack, sharing consistent operational patterns (Helm chart shape, S3-backend
  configuration, Grafana-native datasource support) — adopting Jaeger would have introduced a
  fourth, differently-shaped operational model for exactly one signal type (traces) while every
  other signal (metrics, logs) already follows the Grafana Labs pattern.

**What this ADR does not change:** the OpenTelemetry Collector (`docs/otel-guide.md`) remains the
only ingestion path application code talks to — this decision is entirely about what sits behind
the Collector's traces exporter, invisible to any future NestJS instrumentation code either way.
