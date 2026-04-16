#!/bin/bash
# Build the shared Python base image for all microservices
# This MUST be built before any microservice images

set -e

echo "Building snapflow/python-micro-base..."

# Step 1: Copy shared module to build context
echo "Copying shared module to build context..."
SHARED_SOURCE="Microservices/shared"
SHARED_DEST="docker/python-base/shared"

rm -rf "$SHARED_DEST"
cp -r "$SHARED_SOURCE" "$SHARED_DEST"

# Step 2: Build the image
echo "Building Docker image..."
docker build -t snapflow/python-micro-base:latest ./docker/python-base
BUILD_RESULT=$?

# Step 3: Clean up (always, even if build fails)
echo "Cleaning up build context..."
rm -rf "$SHARED_DEST"

if [ $BUILD_RESULT -eq 0 ]; then
    echo "✅ Base image built successfully!"
    echo "All microservices can now inherit from snapflow/python-micro-base"
    echo ""
    echo "The shared module is now available at /app/shared in all containers."
    echo "Services can use: from shared.db_client import store_audit_result"
    echo "Services can use: from shared.memory_middleware import MemoryProfilingMiddleware"
else
    echo "❌ Build failed with exit code $BUILD_RESULT"
    exit 1
fi
