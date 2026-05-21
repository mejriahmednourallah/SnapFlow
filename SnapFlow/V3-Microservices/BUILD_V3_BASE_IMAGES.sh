#!/bin/bash

set -euo pipefail

NO_CACHE=false
PULL=false
REBUILD_BASE=false

FASTAPI_TAG="snapflow/v3-python-fastapi-base:latest"
HEAVY_TAG="snapflow/v3-python-heavy-base:latest"

log() {
    printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

for arg in "$@"; do
    case "${arg,,}" in
        -nocachebuild|--no-cache-build|-nocache|--no-cache)
            NO_CACHE=true
            ;;
        -pull|--pull)
            PULL=true
            ;;
        -rebuildbase|--rebuildbase|--rebuild-base)
            REBUILD_BASE=true
            ;;
    esac
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
BASE_DIR="$SCRIPT_DIR/docker/python-base"

if [ ! -d "$BASE_DIR" ]; then
    echo "Missing V3 base directory: $BASE_DIR"
    exit 1
fi

if [ ! -f "$BASE_DIR/Dockerfile.fastapi" ] || [ ! -f "$BASE_DIR/Dockerfile.heavy" ]; then
    echo "Missing V3 base Dockerfiles under $BASE_DIR"
    exit 1
fi

image_exists() {
    local tag="$1"
    log "Inspecting Docker image: $tag"
    if docker image inspect "$tag" >/dev/null 2>&1; then
        log "Image exists: $tag"
        return 0
    fi
    log "Image missing: $tag"
    return 1
}

log "Checking V3 base images..."
log "Flags: rebuild_base=$REBUILD_BASE no_cache=$NO_CACHE pull=$PULL"

BUILD_FASTAPI=true
BUILD_HEAVY=true

if [ "$REBUILD_BASE" != true ]; then
    if image_exists "$FASTAPI_TAG"; then
        BUILD_FASTAPI=false
    else
        log "Plan: build missing $FASTAPI_TAG"
    fi
    if image_exists "$HEAVY_TAG"; then
        BUILD_HEAVY=false
    else
        log "Plan: build missing $HEAVY_TAG"
    fi

    if [ "$BUILD_FASTAPI" = false ] && [ "$BUILD_HEAVY" = false ]; then
        log "V3 base images already exist. Reusing cached images."
        log "Use --rebuildbase to rebuild them; combine with --no-cache for a cacheless base rebuild."
        exit 0
    fi
else
    log "Plan: --rebuildbase was passed, so both base images will be rebuilt."
fi

COMMON_BUILD_ARGS=()
if [ "$NO_CACHE" = true ]; then
    COMMON_BUILD_ARGS+=(--no-cache)
fi

# IMPORTANT:
# - `--pull` is safe/desired for Docker Hub public bases (Dockerfile.fastapi).
# - `--pull` must NOT be applied to Dockerfile.heavy because its parent image
#   is local (`snapflow/v3-python-fastapi-base:latest`) and forcing pull can
#   trigger Docker Hub auth/lookups for a local-only tag.
FASTAPI_BUILD_ARGS=("${COMMON_BUILD_ARGS[@]}")
HEAVY_BUILD_ARGS=("${COMMON_BUILD_ARGS[@]}")
if [ "$PULL" = true ]; then
    FASTAPI_BUILD_ARGS+=(--pull)
fi

if [ "$BUILD_FASTAPI" = true ]; then
    log "Building $FASTAPI_TAG"
    log "Context: $BASE_DIR"
    log "Dockerfile: Dockerfile.fastapi"
    log "Extra build flags: ${FASTAPI_BUILD_ARGS[*]:-(none)}"
    (
        cd "$BASE_DIR"
        docker build --progress=plain "${FASTAPI_BUILD_ARGS[@]}" -f "Dockerfile.fastapi" -t "$FASTAPI_TAG" .
    )
else
    log "Reusing existing $FASTAPI_TAG"
fi

if ! image_exists "$FASTAPI_TAG"; then
    log "Required local base image missing: $FASTAPI_TAG"
    log "Build the fastapi base first before building heavy base."
    exit 1
fi

if [ "$BUILD_HEAVY" = true ]; then
    log "Building $HEAVY_TAG"
    log "Context: $BASE_DIR"
    log "Dockerfile: Dockerfile.heavy"
    log "Extra build flags: ${HEAVY_BUILD_ARGS[*]:-(none)}"
    (
        cd "$BASE_DIR"
        docker build --progress=plain "${HEAVY_BUILD_ARGS[@]}" -f "Dockerfile.heavy" -t "$HEAVY_TAG" .
    )
else
    log "Reusing existing $HEAVY_TAG"
fi

log "V3 Python base images are ready."
