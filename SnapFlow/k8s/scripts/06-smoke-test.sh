#!/usr/bin/env bash
set -euo pipefail

KUBECTL="${KUBECTL:-kubectl}"

echo "=== [1] Infra pods ==="
${KUBECTL} get pods -n snapflow-infra

echo "=== [2] App pods ==="
${KUBECTL} get pods -n snapflow-prod

echo "=== [3] HPAs / KEDA ==="
${KUBECTL} get hpa -n snapflow-prod || true
${KUBECTL} get scaledobjects -n snapflow-prod || true

echo "=== [4] Browserless health ==="
${KUBECTL} exec -n snapflow-prod deploy/browserless -- curl -s http://localhost:3000/health || true

echo "=== [5] Aggregator health (in-cluster) ==="
${KUBECTL} run curl-test --image=curlimages/curl:8.10.1 --restart=Never -n snapflow-prod --rm -i -- \
  curl -fsS http://v3-aggregator.snapflow-prod.svc.cluster.local/health || true

echo "=== [6] Aggregator local test hint ==="
echo "kubectl port-forward svc/v3-aggregator -n snapflow-prod 8080:80"
echo "curl -s http://127.0.0.1:8080/health"

echo "=== [7] End-to-end API test hint ==="
echo "curl -s -X POST http://127.0.0.1:8080/scan -H 'content-type: application/json' -d '{\"url\":\"https://example.com\",\"max_pages\":20,\"headless_concurrency\":2}'"
