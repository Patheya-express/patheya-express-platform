# Kubernetes manifests

Kustomize (no Helm — see `docs/infrastructure/kubernetes.md` for why), base + per-environment overlays.

```
k8s/
  base/                    # shared resources (Deployments, Services, HPAs, PDBs, NetworkPolicies, ...)
  overlays/
    development/           # namespace: patheya-backend (dev cluster) — 1 replica, local storage driver
    staging/                # namespace: patheya-backend (staging cluster) — 2 replicas
    production/             # namespace: patheya-backend (prod cluster) — 3+ replicas, stricter PDB
  optional/
    vpa.yaml               # VerticalPodAutoscaler — requires a cluster with the VPA CRD installed, not wired into any overlay by default
```

Quick start:

```bash
kubectl kustomize k8s/overlays/development   # render only, no cluster required
kubectl apply -k k8s/overlays/development     # apply to whatever context is current
```

Full documentation: [`docs/infrastructure/kubernetes.md`](../docs/infrastructure/kubernetes.md).
