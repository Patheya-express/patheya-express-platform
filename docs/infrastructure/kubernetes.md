# Kubernetes

`k8s/` — Kustomize (no Helm chart exists anywhere in this repo, and building one from scratch
wasn't necessary to reach a K8s-ready state). See [`k8s/README.md`](../../k8s/README.md) for the
directory layout.

## Why Kustomize, not Helm

No existing Helm infrastructure to extend, and the manifest set here (one Deployment pair + their
Services/HPA/PDB/NetworkPolicy, patched per environment) fits Kustomize's model — a plain base plus
small, readable per-environment patches — without needing a templating engine.

## Topology

Two Deployments share one container image (`patheya-express-api-gateway`):

- **api-gateway** (`k8s/base/api-gateway/`) — serves HTTP + WebSocket traffic. Has a `Service`
  (ClusterIP) and is the only workload attached to the `Ingress`.
- **worker** (`k8s/base/workers/`) — same image, same env contract, **no** `Service`/`Ingress`
  attachment, so it never receives external traffic. Processes BullMQ jobs. See
  [`workers.md`](./workers.md) for why this — not a separate binary — is the worker model here.

Every container: `startupProbe`/`readinessProbe` against `/api/v1/health/ready`,
`livenessProbe` against `/api/v1/health/live` (see [`health-checks.md`](./health-checks.md)),
`readOnlyRootFilesystem: true` with `emptyDir` volumes at `/app/logs`, `/app/uploads`, `/tmp`,
`runAsNonRoot: true` + `fsGroup` (not a hardcoded `runAsUser` — Alpine's `adduser -S` doesn't
guarantee a specific UID, so this relies on the image's own `USER app` plus Kubernetes' `fsGroup`
mechanism, which grants volume write access via a dynamically-added supplemental group regardless
of the image's exact UID), `allowPrivilegeEscalation: false`, all Linux capabilities dropped,
`seccompProfile: RuntimeDefault`. Pod anti-affinity + topology spread keep replicas off the same
node where the cluster allows it. `RollingUpdate` with `maxUnavailable: 0`.

**ServiceAccounts**: one each for `api-gateway`/`worker`, `automountServiceAccountToken: false`,
no `Role`/`RoleBinding`. Neither workload ever calls the Kubernetes API, so the least-privilege
answer is zero grants rather than fabricated permissions — this is the RBAC posture for Step 10.

**PriorityClasses**: `patheya-express-critical` (api-gateway, value 2000) outranks
`patheya-express-standard` (worker, value 1000) under scheduling pressure — background job
processing can tolerate a brief delay; live traffic shouldn't.

**NetworkPolicy** (`k8s/base/networkpolicy.yaml`): default-deny ingress+egress, explicit DNS
egress allow, explicit external egress allow (Postgres/Redis/Cloudinary/Razorpay/SMTP are external
managed services with per-environment addressing — tighten once real endpoints are known), and
ingress to `api-gateway` restricted to port 3000 only. **Caveat**: some CNI implementations route
kubelet probe traffic through the same enforcement path as pod-to-pod traffic; most managed CNIs
(GKE, EKS+Calico, AKS) exempt node-originated probes by default, but verify in your cluster before
relying on this — if probes start failing after applying, that's why.

## Environment config

`ConfigMap` (`api-gateway-config`, via `configMapGenerator` — content-hash-suffixed, so a config
change automatically triggers a rolling restart) holds everything non-secret: `NODE_ENV`, `PORT`,
`LOG_LEVEL`, `LOG_TO_FILE` (`false` in every overlay — pods log to stdout only, collected by the
cluster's logging agent, not to local ephemeral disk), `STORAGE_DRIVER` (`cloudinary` in
staging/production — `LocalStorageProvider`'s disk writes don't survive across pods, so `local` is
development-only), `REDIS_HOST`/`REDIS_PORT`, `KAFKA_BROKER` (placeholder — required by
`env.validation.ts`, unused by any code), frontend origin URLs.

`Secret` (`api-gateway-secrets`, via `secretGenerator` from `k8s/base/secret.env.example`) holds
`DATABASE_URL`, JWT secrets, Cloudinary/Razorpay/SMTP credentials, the bank-account encryption key.
**The checked-in file is placeholders only** (`CHANGE_ME`) — present so `kubectl kustomize`/
`kubectl apply -k` work out of the box for review. Before any real deployment: replace it with a
gitignored per-overlay `secret.env` + a `secretGenerator` override, or better, your cluster's
actual secret manager (sealed-secrets, external-secrets, Vault) instead of a plain Kustomize
secret entirely.

## Overlays

| Overlay | Namespace | Replicas (api-gateway / worker) | Storage driver | Image tag |
| --- | --- | --- | --- | --- |
| `development` | `patheya-express-dev` | 1 / 1 | `local` | `dev` |
| `staging` | `patheya-express-staging` | 2 / 2 | `cloudinary` | `staging` |
| `production` | `patheya-express` | 3+ / 3+ | `cloudinary` | pin a real release tag — `v1.0.0-placeholder` must be replaced |

Each overlay renames the base `Namespace` object (via a JSON6902 patch) to match its own
`namespace:` field, and patches `Ingress.spec.rules[0].host` to an environment subdomain.
Development also relaxes `PodDisruptionBudget.minAvailable` to `0` (blocking every voluntary
disruption at 1 replica isn't useful in dev) and trims resource requests/limits; production
tightens `PodDisruptionBudget.minAvailable` to `2` and raises requests/limits and HPA ceilings.

## Usage

```bash
kubectl kustomize k8s/overlays/development          # render only — no cluster needed
kubectl apply -k k8s/overlays/development            # apply to the current context
```

## Socket.IO / Ingress

`k8s/base/ingress.yaml` uses generic nginx-ingress annotations (no ALB/GKE-specific annotations,
per this phase's "no AWS provisioning" constraint) with cookie-based session affinity — a stopgap
for Socket.IO's lack of a Redis adapter. See [`socketio.md`](./socketio.md).

## Validation performed

- `kubectl kustomize` (v5.7.1, bundled with Docker Desktop's `kubectl` v1.34.1) against `base` and
  all three overlays — all four render without error (verified after this doc was written; see the
  audit report for exact output/counts).
- Manual review of every rendered resource: correct namespace propagation, ConfigMap/Secret
  hash-suffix references resolve, `images:` transformer rewrites tags, JSON6902 Namespace-rename
  patches apply cleanly, cluster-scoped `PriorityClass` objects correctly get no `.metadata.namespace`.
- **Not performed** (no cluster available in this environment): `kubectl apply --dry-run=server`
  against a real API server, `kubectl apply` end-to-end, HPA/PDB behavior under load, NetworkPolicy
  enforcement on a real CNI. Do these before trusting this in a real cluster — rendering cleanly
  proves the YAML is well-formed, not that it behaves correctly at runtime.
