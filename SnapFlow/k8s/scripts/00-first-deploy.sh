#!/usr/bin/env bash
set -euo pipefail

# SnapFlow V3 first-deploy helper for single-node k3s pre-prod.
# Modes:
#   --check-only : validate prerequisites and required files (default)
#   --execute    : run full bootstrap->deploy->migrate->smoke flow

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="${ROOT_DIR}/.."
MODE="check"
TAG="${TAG:-latest}"

for arg in "$@"; do
  case "$arg" in
    --check-only) MODE="check" ;;
    --execute) MODE="execute" ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

info() { echo "[INFO] $*"; }
warn() { echo "[WARN] $*"; }
err() { echo "[ERROR] $*"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Required command not found: $1"
    exit 1
  fi
}

require_file() {
  if [[ ! -f "$1" ]]; then
    err "Required file not found: $1"
    exit 1
  fi
}

check_no_placeholder() {
  local f="$1"
  if grep -q "REPLACE_WITH" "$f"; then
    err "Placeholder values detected in: $f"
    exit 1
  fi
}

ensure_app_secret_file() {
  local actual="${ROOT_DIR}/07-secrets/snapflow-secrets.yaml"
  local example="${ROOT_DIR}/07-secrets/snapflow-secrets.yaml.example"
  if [[ -f "$actual" ]]; then
    return
  fi
  if [[ ! -f "$example" ]]; then
    err "Missing both app secret files: $actual and $example"
    exit 1
  fi
  warn "Missing $actual"
  info "Creating it from template: $example"
  cp "$example" "$actual"
  warn "Edit $actual and replace placeholders before deployment"
}

info "Validating toolchain"
require_cmd bash
require_cmd kubectl
require_cmd docker
require_cmd helm

info "Validating required files"
require_file "${ROOT_DIR}/scripts/01-bootstrap-node.sh"
require_file "${ROOT_DIR}/scripts/02-install-k3s-server.sh"
require_file "${ROOT_DIR}/scripts/03-install-operators.sh"
require_file "${ROOT_DIR}/scripts/04-apply-manifests.sh"
require_file "${ROOT_DIR}/scripts/05-run-migrations.sh"
require_file "${ROOT_DIR}/scripts/06-smoke-test.sh"
require_file "${ROOT_DIR}/scripts/07-build-and-import-images.sh"
require_file "${REPO_DIR}/V3-Microservices/db/init.sql"
require_file "${ROOT_DIR}/01-infra/postgres/secret.yaml"
ensure_app_secret_file

info "Checking script syntax"
bash -n "${ROOT_DIR}/scripts/04-apply-manifests.sh"
bash -n "${ROOT_DIR}/scripts/05-run-migrations.sh"
bash -n "${ROOT_DIR}/scripts/06-smoke-test.sh"
bash -n "${ROOT_DIR}/scripts/07-build-and-import-images.sh"

info "Checking secret placeholders"
check_no_placeholder "${ROOT_DIR}/01-infra/postgres/secret.yaml"
check_no_placeholder "${ROOT_DIR}/07-secrets/snapflow-secrets.yaml"

if ! kubectl config current-context >/dev/null 2>&1; then
  warn "kubectl current-context is not set"
  warn "You can still continue with node bootstrap/install steps"
fi

if [[ "$MODE" == "check" ]]; then
  info "Check-only mode complete"
  echo
  echo "Next command to run full first deployment:"
  echo "  TAG=${TAG} bash ${ROOT_DIR}/scripts/00-first-deploy.sh --execute"
  exit 0
fi

info "Executing first deployment flow"
TAG="${TAG}" bash "${ROOT_DIR}/scripts/01-bootstrap-node.sh"
TAG="${TAG}" bash "${ROOT_DIR}/scripts/02-install-k3s-server.sh"
TAG="${TAG}" bash "${ROOT_DIR}/scripts/03-install-operators.sh"
TAG="${TAG}" bash "${ROOT_DIR}/scripts/07-build-and-import-images.sh"
TAG="${TAG}" bash "${ROOT_DIR}/scripts/04-apply-manifests.sh"
DB_PASS=$(grep -E 'password:' "${ROOT_DIR}/01-infra/postgres/secret.yaml" | head -n1 | awk -F'"' '{print $2}') \
  bash "${ROOT_DIR}/scripts/05-run-migrations.sh"
TAG="${TAG}" bash "${ROOT_DIR}/scripts/06-smoke-test.sh"

info "Deployment flow finished"
