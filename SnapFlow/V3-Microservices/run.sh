#!/bin/bash
# SnapFlow V3 Backend Launcher for Bash/Linux/macOS

set -e

DOWN=false
NO_CACHE=false
REBUILD_BASE=false

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log() {
    printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

# Parse flags manually
for arg in "$@"; do
    case $(echo "$arg" | tr '[:upper:]' '[:lower:]') in
        -down|--down)
        DOWN=true
        shift
        ;;
        -nocachebuild|--no-cache-build|-nocache|--no-cache)
        NO_CACHE=true
        shift
        ;;
        -rebuildbase|--rebuildbase|--rebuild-base)
        REBUILD_BASE=true
        shift
        ;;
    esac
done

echo ""
echo "=========================================="
echo "   SnapFlow V3 Backend Launcher (Bash)    "
echo "=========================================="
echo "  No-Cache Build:     $NO_CACHE"
echo "  Rebuild Base:       $REBUILD_BASE"
echo "=========================================="
echo ""

TOTAL_STEPS=3
if [ "$DOWN" = true ]; then
    TOTAL_STEPS=4
fi

STEP=1

if [ "$DOWN" = true ]; then
    echo -e "\n[$STEP/$TOTAL_STEPS] Tearing down existing stack..."
    docker compose down --volumes --remove-orphans
    echo "Stack torn down."
    STEP=$((STEP + 1))
fi

echo -e "\n[$STEP/$TOTAL_STEPS] Building V3 Python base images..."
BASE_BUILD_ARGS=()
if [ "$REBUILD_BASE" = true ]; then
    BASE_BUILD_ARGS+=(--rebuildbase)
    if [ "$NO_CACHE" = true ]; then
        BASE_BUILD_ARGS+=(--no-cache --pull)
    fi
fi
log "Command: $SCRIPT_DIR/BUILD_V3_BASE_IMAGES.sh ${BASE_BUILD_ARGS[*]:-(no args)}"
"$SCRIPT_DIR/BUILD_V3_BASE_IMAGES.sh" "${BASE_BUILD_ARGS[@]}"
echo "Base image build complete."
STEP=$((STEP + 1))

echo -e "\n[$STEP/$TOTAL_STEPS] Building Docker images..."
if [ "$NO_CACHE" = true ]; then
    # Do not pass --pull here: service Dockerfiles use local snapflow base images
    # (e.g. snapflow/v3-python-fastapi-base), and --pull forces Docker Hub lookup.
    log "Command: docker compose build --progress=plain --no-cache"
    docker compose build --progress=plain --no-cache
else
    log "Command: docker compose build --progress=plain"
    docker compose build --progress=plain
fi
echo "Build complete."
STEP=$((STEP + 1))

echo -e "\n[$STEP/$TOTAL_STEPS] Starting full backend stack..."
docker compose up -d

echo -e "\nâœ… Backend Stack is running!"
echo "   Aggregator API: http://localhost:8080"
echo ""
echo "To test via Postman:"
echo "1. POST http://localhost:8080/scan/sync"
echo "   { \"url\": \"https://www.auchan.sn\", \"max_pages\": 150 }"
echo "   (This completely blocks until NLP is done and returns the final JSON output)"
echo ""
echo "Or the Async way:"
echo "1. POST http://localhost:8080/scan (returns scan_id)"
echo "2. GET http://localhost:8080/scan/<scan_id>/status (poll for progress)"
echo "3. GET http://localhost:8080/scan/<scan_id>/result (get JSON when complete)"
echo ""
echo "To stop the stack later: docker compose down"
