#!/usr/bin/env bash
# Join only this configured Supabase project to SnapFlow's private network.
set -euo pipefail
network="${1:?Compose network is required}"
project="${2:?Supabase project id is required}"

for component in kong db edge_runtime; do
  container="supabase_${component}_${project}"
  if ! docker inspect "$container" >/dev/null 2>&1; then
    echo "Missing $container. Start this project's Supabase bootstrap first." >&2
    exit 1
  fi
  if docker inspect --format '{{range $name, $data := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$container" | grep -Fxq "$network"; then
    continue
  fi
  case "$component" in
    kong) alias=supabase-kong ;;
    db) alias=supabase-db ;;
    edge_runtime) alias=supabase-edge ;;
  esac
  docker network connect --alias "$alias" "$network" "$container"
done
