#!/usr/bin/env bash
# Existing populated volumes do not rerun docker-entrypoint-initdb.d/init.sql.
set -euo pipefail
cd "$(dirname "$0")/.."
compose=(docker compose)
if [ -n "${SNAPFLOW_COMPOSE_PROJECT:-}" ]; then
  compose+=(-p "$SNAPFLOW_COMPOSE_PROJECT")
fi
compose+=(--env-file "${SNAPFLOW_ENV_FILE:-.env.preprod}" -f docker-compose.preprod.yml)

"${compose[@]}" exec -T db sh -c \
  'psql --single-transaction --file=- -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < v3-scanner-go/db/evidence_schema.sql
