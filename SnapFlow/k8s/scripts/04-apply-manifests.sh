#!/usr/bin/env bash
set -euo pipefail

KUBECTL="${KUBECTL:-kubectl}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "${ROOT_DIR}/01-infra/postgres/secret.yaml" ]]; then
	echo "ERROR: missing ${ROOT_DIR}/01-infra/postgres/secret.yaml"
	exit 1
fi

if [[ ! -f "${ROOT_DIR}/07-secrets/snapflow-secrets.yaml" ]]; then
	echo "ERROR: missing ${ROOT_DIR}/07-secrets/snapflow-secrets.yaml"
	echo "Hint: copy ${ROOT_DIR}/07-secrets/snapflow-secrets.yaml.example and replace placeholders"
	exit 1
fi

echo "=== Applying bootstrap + secrets ==="
${KUBECTL} apply -f "${ROOT_DIR}/00-bootstrap/namespaces.yaml"
${KUBECTL} apply -f "${ROOT_DIR}/01-infra/postgres/secret.yaml"
${KUBECTL} apply -f "${ROOT_DIR}/07-secrets/snapflow-secrets.yaml"

echo "=== Applying infra ==="
${KUBECTL} apply -f "${ROOT_DIR}/01-infra/postgres/configmap.yaml"
${KUBECTL} apply -f "${ROOT_DIR}/01-infra/postgres/statefulset.yaml"
${KUBECTL} apply -f "${ROOT_DIR}/01-infra/postgres/service.yaml"
${KUBECTL} apply -f "${ROOT_DIR}/01-infra/redis/pvc.yaml"
${KUBECTL} apply -f "${ROOT_DIR}/01-infra/redis/deployment.yaml"
${KUBECTL} apply -f "${ROOT_DIR}/01-infra/redis/service.yaml"
${KUBECTL} apply -f "${ROOT_DIR}/01-infra/pgbouncer/configmap.yaml"
${KUBECTL} apply -f "${ROOT_DIR}/01-infra/pgbouncer/deployment.yaml"
${KUBECTL} apply -f "${ROOT_DIR}/01-infra/pgbouncer/service.yaml"

echo "=== Waiting infra readiness ==="
${KUBECTL} wait --for=condition=ready pod -l app=postgres -n snapflow-infra --timeout=300s
${KUBECTL} wait --for=condition=ready pod -l app=redis -n snapflow-infra --timeout=180s
${KUBECTL} wait --for=condition=ready pod -l app=pgbouncer -n snapflow-infra --timeout=180s

echo "=== Applying app services ==="
${KUBECTL} apply -f "${ROOT_DIR}/02-services/browserless"
${KUBECTL} wait --for=condition=ready pod -l app=browserless -n snapflow-prod --timeout=180s
${KUBECTL} apply -f "${ROOT_DIR}/02-services/scanner"
${KUBECTL} apply -f "${ROOT_DIR}/02-services/aggregator"
${KUBECTL} apply -f "${ROOT_DIR}/02-services/nlp-worker"
${KUBECTL} apply -f "${ROOT_DIR}/02-services/visual-regression"
${KUBECTL} apply -f "${ROOT_DIR}/02-services/frontend"

echo "=== Applying scaling + resilience + monitoring ==="
${KUBECTL} apply -f "${ROOT_DIR}/03-autoscaling"
${KUBECTL} apply -f "${ROOT_DIR}/05-resilience"
${KUBECTL} apply -f "${ROOT_DIR}/06-monitoring"

echo "=== NOTE ==="
echo "Networking manifests were not applied by default (no-ingress mode)."
echo "Apply manually later from ${ROOT_DIR}/04-networking"
