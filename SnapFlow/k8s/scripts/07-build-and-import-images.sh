#!/usr/bin/env bash
set -euo pipefail

# Optional helper for local single-node pre-prod workflow.
TAG="${TAG:-latest}"

echo "=== Building images with tag: ${TAG} ==="
docker build -t "snapflow/v3-scanner-go:${TAG}" ./V3-Microservices/v3-scanner-go
docker build -t "snapflow/v3-aggregator:${TAG}" ./V3-Microservices/v3-aggregator
docker build -t "snapflow/v3-nlp-worker:${TAG}" ./V3-Microservices/v3-nlp-worker
docker build -t "snapflow/v3-visual-regression:${TAG}" ./V3-Microservices/v3-visual-regression
docker build -t "snapflow/v3-frontend:${TAG}" -f ./Dockerfile.frontend .

echo "=== Importing into k3s containerd ==="
docker save "snapflow/v3-scanner-go:${TAG}" | sudo k3s ctr images import -
docker save "snapflow/v3-aggregator:${TAG}" | sudo k3s ctr images import -
docker save "snapflow/v3-nlp-worker:${TAG}" | sudo k3s ctr images import -
docker save "snapflow/v3-visual-regression:${TAG}" | sudo k3s ctr images import -
docker save "snapflow/v3-frontend:${TAG}" | sudo k3s ctr images import -

echo "=== Imported images ==="
sudo k3s ctr images ls | grep snapflow/
