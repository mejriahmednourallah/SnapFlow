# SnapFlow V3 Kubernetes Handoff

This file is the handoff entrypoint for any agent or engineer working on `k8s/`.
If you change any Kubernetes-related file, update this README in the same change.

## Scope
- Target: single-node k3s pre-prod on Ubuntu.
- Current mode: deploy-ready with existing V3 code.
- Image strategy: build locally and import into k3s containerd.
- Ingress/TLS: prepared manifests exist, but no-ingress test flow is supported first.

## Source of truth in this repo
- Action plan: `docs/V3_PREPROD_SINGLE_NODE_K3S_ACTION_PLAN.md`
- Kubernetes manifests: `k8s/`
- Runtime scripts: `k8s/scripts/`

## Current layout
- `00-bootstrap/`: namespaces, quota, limits
- `01-infra/`: postgres, redis, pgbouncer
- `02-services/`: scanner, aggregator, nlp-worker, visual-regression, browserless, frontend
- `03-autoscaling/`: HPA and KEDA objects
- `04-networking/`: ingress, cluster-issuer, network policies
- `05-resilience/`: PDBs
- `06-monitoring/`: ServiceMonitors, Prometheus rules
- `07-secrets/`: secret templates (`.gitignore` prevents yaml commits)
- `scripts/`: bootstrap/install/apply/migrate/smoke/build-import helpers
- `scripts/00-first-deploy.sh`: first-run check/execute helper for full flow

## Deployment assumptions (important)
1. Scanner/aggregator/nlp-worker currently use DB host/port env vars, not queue workers.
2. Redis queue-based scaling is not wired in current V3 code path.
3. KEDA files are CPU-trigger based for now to stay deployable today.
4. `imagePullPolicy` is `IfNotPresent` for local imported images.
5. DB bootstrap uses SQL init file `V3-Microservices/db/init.sql` via `k8s/scripts/05-run-migrations.sh`.

## First run order (quick)
0. `k8s/scripts/00-first-deploy.sh --check-only`
1. `k8s/scripts/01-bootstrap-node.sh`
2. `k8s/scripts/02-install-k3s-server.sh`
3. `k8s/scripts/03-install-operators.sh`
4. Fill placeholders in secret files (see next section)
5. `k8s/scripts/07-build-and-import-images.sh`
6. `k8s/scripts/04-apply-manifests.sh`
7. `k8s/scripts/05-run-migrations.sh`
8. `k8s/scripts/06-smoke-test.sh`

## Files requiring manual substitution before apply
- `k8s/07-secrets/snapflow-secrets.yaml`
- `k8s/07-secrets/snapflow-secrets.yaml.example` (template source)
- `k8s/01-infra/postgres/secret.yaml`
- `k8s/01-infra/pgbouncer/configmap.yaml` (userlist password)
- `k8s/04-networking/cluster-issuer.yaml` (email)
- `k8s/04-networking/ingress.yaml` (hostnames)

## Change protocol (mandatory)
When editing any file under `k8s/`:
1. Update this README in the same commit.
2. Record what changed in the changelog table below.
3. If behavior changed, update run order or assumptions.
4. If new placeholders were added, list them under substitution section.
5. If scaling mode changed (CPU <-> Redis queue), document exact reason.

## Validation checklist after edits
- `kubectl apply --dry-run=client -f <changed-file>.yaml`
- `kubectl diff -f <changed-file>.yaml` (when cluster access exists)
- Confirm no secret values are committed in tracked files.
- Re-run `k8s/scripts/06-smoke-test.sh` after infra/service changes.

## Known gaps / next improvements
- Add queue-worker code path if strict Redis-trigger KEDA is required.
- Add explicit metrics endpoints for scanner/aggregator/nlp-worker if deeper monitoring is needed.
- Add `k8s/scripts/08-rollback.sh` for fast rollback operations.

## Changelog (update every k8s change)
| Date (UTC) | Author/Agent | Files changed | Summary | Follow-up |
|---|---|---|---|---|
| 2026-03-27 | Copilot (GPT-5.3-Codex) | Initial `k8s/` scaffold + scripts + this README | Created deploy-ready single-node pre-prod manifests aligned to current V3 code | Revisit KEDA Redis triggers after queue-worker implementation |
| 2026-03-27 | Copilot (GPT-5.3-Codex) | `k8s/07-secrets/snapflow-secrets.yaml`, `k8s/scripts/05-run-migrations.sh`, `k8s/scripts/06-smoke-test.sh`, `k8s/README.md` | Added missing app secret template, switched DB init to SQL-job flow, aligned smoke test to HTTP+DB path | Replace placeholders before apply; keep no-ingress validation first |
| 2026-03-27 | Copilot (GPT-5.3-Codex) | `k8s/scripts/00-first-deploy.sh`, `k8s/scripts/04-apply-manifests.sh`, `k8s/07-secrets/snapflow-secrets.yaml.example`, `docs/K8S_V3_PREDEPLOY_CHECKLIST.md`, `k8s/README.md` | Added first-run orchestrator/check script, secret template flow, and apply-time guardrails for missing secret files | Replace placeholders then run `00-first-deploy.sh --execute` |
| 2026-03-27 | Copilot (GPT-5.3-Codex) | `k8s/scripts/02-install-k3s-server.sh`, `k8s/README.md` | Hardened k3s install script for first-time machines (sudo install + IPv4/IPv6 public IP fallback) | Re-run k3s install script then verify node readiness |
| 2026-03-27 | Copilot (GPT-5.3-Codex) | `k8s/scripts/02-install-k3s-server.sh`, `k8s/README.md` | Corrected k3s node-ip selection to local interface IP; public IP now optional TLS SAN only | If cluster was installed with wrong node-ip, run uninstall and reinstall |
