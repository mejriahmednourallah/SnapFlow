#!/bin/bash

set -euo pipefail

NO_CACHE=false
PULL=false
REBUILD_BASE=false

FASTAPI_TAG="snapflow/v3-python-fastapi-base:latest"
HEAVY_TAG="snapflow/v3-python-heavy-base:latest"

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
    docker image inspect "$1" >/dev/null 2>&1
}

BUILD_FASTAPI=true
BUILD_HEAVY=true

if [ "$REBUILD_BASE" != true ]; then
    if image_exists "$FASTAPI_TAG"; then
        BUILD_FASTAPI=false
    fi
    if image_exists "$HEAVY_TAG"; then
        BUILD_HEAVY=false
    fi

    if [ "$BUILD_FASTAPI" = false ] && [ "$BUILD_HEAVY" = false ]; then
        echo "V3 base images already exist. Reusing cached images."
        echo "Use --rebuildbase to force rebuilding both base images."
        exit 0
    fi
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
    echo "Building $FASTAPI_TAG"
    (
        cd "$BASE_DIR"
        docker build "${FASTAPI_BUILD_ARGS[@]}" -f "Dockerfile.fastapi" -t "$FASTAPI_TAG" .
    )
else
    echo "Reusing existing $FASTAPI_TAG"
fi

if ! image_exists "$FASTAPI_TAG"; then
    echo "Required local base image missing: $FASTAPI_TAG"
    echo "Build the fastapi base first before building heavy base."
    exit 1
fi

if [ "$BUILD_HEAVY" = true ]; then
    echo "Building $HEAVY_TAG"
    (
        cd "$BASE_DIR"
        docker build "${HEAVY_BUILD_ARGS[@]}" -f "Dockerfile.heavy" -t "$HEAVY_TAG" .
    )
else
    echo "Reusing existing $HEAVY_TAG"
fi

echo "V3 Python base images are ready."
