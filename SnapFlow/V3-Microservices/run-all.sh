#!/bin/bash
# SnapFlow V3 - Pre-Production Stack Launcher
#   chmod +x run-all.sh && ./run-all.sh [--local] [--no-cache]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOCAL=false
ENV_FILE=".env.preprod"
COMPOSE_PROJECT=""
NO_CACHE=false
REBUILD_BASE=false
FORCE_RECREATE=false
DOWN=false
OBSCURA=true

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

usage() {
  cat <<'EOF'
Usage: ./run-all.sh [--local] [--no-cache] [--rebuild-base] [--force-recreate] [--down] [--no-obscura]

Options:
  --local                  Use .env.local and the snapflow-local-preprod compose project.
  --no-cache, --no-cache-build
                           Rebuild service images without Docker cache. Does not rebuild base images.
  --rebuild-base           Rebuild shared Python base images even when they already exist.
  --force-recreate         Recreate containers after build.
  --down                   Stop and remove containers before rebuilding. Keeps named volumes unless combined manually.
  --obscura                Start the Obscura profile and enable rendered discovery through Obscura.
  --no-obscura             Disable Obscura and use the local Chromium pool only.
  -h, --help               Show this help.

Examples:
  Server preprod normal run:
    ./run-all.sh
  Server preprod service rebuild without cache:
    ./run-all.sh --no-cache
  Local preprod service rebuild without cache:
    ./run-all.sh --local --no-cache
  Expensive base rebuild, only when explicitly needed:
    ./run-all.sh --rebuild-base --no-cache

Base image rule:
  --no-cache applies to service images only.
  Shared Python base images are rebuilt only with --rebuild-base, or when missing.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --local)
      LOCAL=true
      ENV_FILE=".env.local"
      COMPOSE_PROJECT="snapflow-local-preprod"
      ;;
    --no-cache|--no-cache-build|-nocache|-nocachebuild)
      NO_CACHE=true
      FORCE_RECREATE=true
      ;;
    --rebuild-base|--rebuildbase|-rebuildbase)
      REBUILD_BASE=true
      ;;
    --force-recreate)
      FORCE_RECREATE=true
      ;;
    --down)
      DOWN=true
      ;;
    --obscura)
      OBSCURA=true
      ;;
    --no-obscura)
      OBSCURA=false
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$OBSCURA" = true ]; then
  export ENABLE_OBSCURA_DISCOVERY=true
fi

read_env_value() {
  local key="$1"
  local file="$2"
  local line value
  if [ ! -f "$file" ]; then
    return 0
  fi
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" | tail -n 1 || true)"
  value="${line#*=}"
  printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

append_env_if_missing() {
  local file="$1"
  local key="$2"
  local value="$3"

  if [ -n "$(read_env_value "$key" "$file")" ] || [ -z "$value" ]; then
    return 0
  fi

  printf '%s=%s\n' "$key" "$value" >> "$file"
}

ensure_local_form_executor_env() {
  local file="$1"
  local supabase_env="../Front-Snap/supabase/.env.local"
  local service_role_key

  if [ "$LOCAL" != true ]; then
    return 0
  fi

  service_role_key="$(read_env_value "SUPABASE_SERVICE_ROLE_KEY" "$supabase_env")"

  append_env_if_missing "$file" "FORM_EXECUTOR_DATABASE_URL" "postgresql://postgres:postgres@host.docker.internal:54322/postgres"
  append_env_if_missing "$file" "FORM_EXECUTOR_SUPABASE_URL" "http://host.docker.internal:54321"
  append_env_if_missing "$file" "SUPABASE_SERVICE_ROLE_KEY" "$service_role_key"
  append_env_if_missing "$file" "FORM_EXECUTOR_ARTIFACT_BUCKET" "form-test-artifacts"
}

require_env_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "Missing env file: $file" >&2
    if [ "$LOCAL" = true ]; then
      echo "Create it with: cd ../Front-Snap && ./scripts/local-supabase-preprod.sh" >&2
    fi
    exit 1
  fi
}

validate_env_file() {
  local file="$1"
  local missing=()
  local key value

  for key in DB_PASS VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY; do
    value="$(read_env_value "$key" "$file")"
    if [ -z "$value" ]; then
      missing+=("$key")
    fi
  done

  for key in FORM_EXECUTOR_DATABASE_URL FORM_EXECUTOR_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
    value="$(read_env_value "$key" "$file")"
    if [ -z "$value" ]; then
      missing+=("$key")
    fi
  done

  if [ "${#missing[@]}" -gt 0 ]; then
    echo "Missing required key(s) in $file: ${missing[*]}" >&2
    if [ "$LOCAL" = true ]; then
      echo "Refresh local env with: cd ../Front-Snap && ./scripts/local-supabase-preprod.sh" >&2
    else
      echo "Set the Form Executor Supabase values in .env.preprod before starting preprod." >&2
    fi
    exit 1
  fi
}

compose_cmd=()
if [ "$LOCAL" = true ]; then
  compose_cmd=(docker compose -p "$COMPOSE_PROJECT")
else
  compose_cmd=(docker compose)
fi
if [ "$OBSCURA" = true ]; then
  compose_cmd+=(--profile obscura)
fi
compose_cmd+=(--env-file "$ENV_FILE" -f docker-compose.preprod.yml)

require_env_file "$ENV_FILE"
ensure_local_form_executor_env "$ENV_FILE"
validate_env_file "$ENV_FILE"

log "Mode     : $([ "$LOCAL" = true ] && echo "local preprod" || echo "preprod")"
log "Env file : $ENV_FILE"
log "No cache : $NO_CACHE"
log "Rebuild base : $REBUILD_BASE"
log "Force recreate : $FORCE_RECREATE"
log "Obscura  : $OBSCURA"
if [ "$LOCAL" = true ]; then
  log "Project  : $COMPOSE_PROJECT"
fi
echo ""

if [ "$DOWN" = true ]; then
  log "=== 0/4 Stopping existing services ==="
  log "Command: ${compose_cmd[*]} down --remove-orphans"
  "${compose_cmd[@]}" down --remove-orphans
fi

log "=== 1/4 Building Python base images ==="
log "Base policy: reuse existing base images; rebuild only if missing or --rebuild-base was passed."
base_args=()
if [ "$REBUILD_BASE" = true ]; then
  base_args+=(--rebuildbase)
  if [ "$NO_CACHE" = true ]; then
    base_args+=(--no-cache --pull)
  fi
fi
log "Command: $SCRIPT_DIR/BUILD_V3_BASE_IMAGES.sh ${base_args[*]:-(no args)}"
"$SCRIPT_DIR/BUILD_V3_BASE_IMAGES.sh" "${base_args[@]}"

log "=== 2/4 Building service images ==="
if [ "$NO_CACHE" = true ]; then
  log "Command: ${compose_cmd[*]} build --progress=plain --no-cache"
  "${compose_cmd[@]}" build --progress=plain --no-cache
else
  log "Command: ${compose_cmd[*]} build --progress=plain"
  "${compose_cmd[@]}" build --progress=plain
fi

log "=== 3/4 Starting all services ==="
up_args=(up -d)
if [ "$FORCE_RECREATE" = true ]; then
  up_args+=(--force-recreate)
fi
log "Command: ${compose_cmd[*]} ${up_args[*]}"
"${compose_cmd[@]}" "${up_args[@]}"

log "=== 4/4 Status ==="
log "Command: ${compose_cmd[*]} ps"
"${compose_cmd[@]}" ps
echo ""
if [ "$LOCAL" = true ]; then
  echo "Frontend           : http://127.0.0.1:3000"
  echo "API                : http://localhost:8080/health"
  echo "Supabase functions : http://127.0.0.1:54321/functions/v1/..."
else
  echo "Frontend : https://snapflowv2.medianet.tn"
  echo "API      : https://snapflowv2.medianet.tn/api/health"
fi
echo ""
if [ "$LOCAL" = true ]; then
  echo "Logs: docker compose -p $COMPOSE_PROJECT --env-file $ENV_FILE -f docker-compose.preprod.yml logs -f"
else
  echo "Logs: docker compose --env-file $ENV_FILE -f docker-compose.preprod.yml logs -f"
fi
