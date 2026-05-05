#!/bin/bash
# SnapFlow V3 — Pre-Production Stack Launcher
#   chmod +x run-all.sh && ./run-all.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "=== 1/3 Building Python base images ==="
docker build -t snapflow/v3-python-fastapi-base:latest \
  -f docker/python-base/Dockerfile.fastapi docker/python-base/

docker build -t snapflow/v3-python-heavy-base:latest \
  -f docker/python-base/Dockerfile.heavy docker/python-base/

echo "=== 2/3 Building & starting all services ==="
docker compose -f docker-compose.preprod.yml up -d --build

echo "=== 3/3 Status ==="
docker compose -f docker-compose.preprod.yml ps
echo ""
echo "Frontend : http://$(hostname -I | awk '{print $1}'):3000"
echo "API      : http://$(hostname -I | awk '{print $1}'):8080/health"
echo ""
echo "Logs: docker compose -f docker-compose.preprod.yml logs -f"
