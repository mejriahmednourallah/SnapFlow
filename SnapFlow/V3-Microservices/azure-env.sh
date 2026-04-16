#!/bin/bash
# Generated deployment environment
# Source this before running azure-deploy.sh

export REDIS_URL="rediss://default:gQAAAAAAAR-YAAIncDFhYjUzNWY4ZDlkNDE0YzIyOWQzMzJiYmYzNWIxOWU3YXAxNzM2MjQ@cheerful-boa-73624.upstash.io:6379"
export RG_NAME="snapflow-rg"
export REGISTRY_NAME="snapflowregistry"
export DB_ADMIN="snapflow"
export DB_PASSWORD="YKpOrebL60K/I4INgZ2JoA=="
export LOCATION="francecentral"

# Extract Upstash host/port from REDIS_URL
UPSTASH_CREDS="$(echo "rediss://default:gQAAAAAAAR-YAAIncDFhYjUzNWY4ZDlkNDE0YzIyOWQzMzJiYmYzNWIxOWU3YXAxNzM2MjQ@cheerful-boa-73624.upstash.io:6379" | sed -n 's/.*default:\([^@]*\)@\([^:]*\):\([0-9]*\).*/\1:\2:\3/p')"
export UPSTASH_PASSWORD="$(echo $UPSTASH_CREDS | cut -d: -f1)"
export UPSTASH_HOST="$(echo $UPSTASH_CREDS | cut -d: -f2)"
export UPSTASH_PORT="$(echo $UPSTASH_CREDS | cut -d: -f3)"

echo "✓ Environment loaded. Ready to deploy!"
