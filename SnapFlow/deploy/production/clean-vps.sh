#!/usr/bin/env bash
# Standalone cleanup of the two explicitly approved legacy Compose projects.
# No repository/env files, Apache settings, certificates or host services change.
set -euo pipefail

die() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
command -v docker >/dev/null || die 'Docker CLI missing'
command -v sha256sum >/dev/null || die 'sha256sum missing'

wetty_signature() {
  docker inspect wetty_wetty_1 --format \
    '{{.Id}} {{.Image}} {{.State.Running}} {{.State.StartedAt}} {{json .Mounts}} {{json .NetworkSettings.Networks}}' |
    sha256sum | cut -d ' ' -f 1
}
[[ $(docker inspect wetty_wetty_1 --format '{{.State.Running}}') == true ]] || die 'Wetty is not running'
wetty_before=$(wetty_signature)
assert_wetty() { [[ $(wetty_signature) == "$wetty_before" ]] || die 'Wetty identity/runtime changed; inspect before continuing'; }

declare -a targets=() images=() volumes=()
declare -A owned=()
for project in v3-microservices ticketing-cloud-min; do
  ids=$(docker ps -aq --filter "label=com.docker.compose.project=$project")
  while read -r id; do
    [[ -n $id ]] || continue
    name=$(docker inspect "$id" --format '{{.Name}}')
    case "$project:$name" in
      v3-microservices:/v3-microservices-scanner-1|\
      v3-microservices:/v3-microservices-nlp-worker-1|\
      v3-microservices:/v3-microservices-aggregator-1|\
      v3-microservices:/v3-microservices-frontend-1|\
      v3-microservices:/v3-microservices-db-1|\
      v3-microservices:/v3-microservices-obscura-1|\
      v3-microservices:/v3-form-executor|\
      v3-microservices:/v3-visual-regression|\
      v3-microservices:/v3-browser-pool|\
      ticketing-cloud-min:/ticketing-cloud-min-analytics-api-1|\
      ticketing-cloud-min:/ticketing-cloud-min-web-1|\
      ticketing-cloud-min:/ticketing-cloud-min-warehouse-refresh-1|\
      ticketing-cloud-min:/ticketing-cloud-min-duckdb-ui-1) ;;
      *) die "Unexpected container in approved project: $name (nothing removed yet)" ;;
    esac
    full_id=$(docker inspect "$id" --format '{{.Id}}')
    targets+=("$full_id"); owned["$full_id"]=1
    images+=("$(docker inspect "$id" --format '{{.Image}}')")
    printf 'Approved container: %s\n' "$name"
  done <<< "$ids"
done

# All volume ownership/consumer checks happen BEFORE any container is stopped.
known_volumes=$(docker volume ls -q)
for volume in v3-microservices_pgdata v3-microservices_form_test_artifacts ticketing-cloud-min_duckdb_warehouse; do
  grep -Fxq "$volume" <<< "$known_volumes" || continue
  project=${volume%%_*}
  owner=$(docker volume inspect "$volume" --format '{{index .Labels "com.docker.compose.project"}}')
  [[ $owner == "$project" ]] || die "Volume ownership differs: $volume (nothing removed yet)"
  consumers=$(docker ps -aq --filter "volume=$volume")
  while read -r id; do
    [[ -n $id ]] || continue
    full_id=$(docker inspect "$id" --format '{{.Id}}')
    [[ ${owned[$full_id]:-0} == 1 ]] || die "Volume shared with excluded container: $volume (nothing removed yet)"
  done <<< "$consumers"
  volumes+=("$volume")
  printf 'Approved data volume: %s\n' "$volume"
done

printf '\nBefore cleanup:\n'
df -h /; docker system df
assert_wetty
if ((${#targets[@]})); then
  docker stop --time 30 "${targets[@]}"
  assert_wetty
  # No -v: anonymous/unknown volumes are not implicitly deleted.
  docker rm "${targets[@]}"
fi
for volume in "${volumes[@]}"; do docker volume rm "$volume"; done
assert_wetty

# Remove only old image IDs from the removed containers, if nobody else uses them.
# No force; images with multiple tags or retained container references stay.
remaining_ids=$(docker ps -aq)
used_images=''
if [[ -n $remaining_ids ]]; then
  readarray -t remaining <<< "$remaining_ids"
  used_images=$(docker inspect "${remaining[@]}" --format '{{.Image}}')
fi
if ((${#images[@]})); then
  while read -r image; do
    grep -Fxq "$image" <<< "$used_images" && continue
    docker image rm --no-prune "$image" || printf 'Retained image: %s\n' "$image"
  done < <(printf '%s\n' "${images[@]}" | sort -u)
fi
for network in v3-microservices_default ticketing-cloud-min_default; do
  docker network inspect "$network" >/dev/null 2>&1 || continue
  owner=$(docker network inspect "$network" --format '{{index .Labels "com.docker.compose.project"}}')
  count=$(docker network inspect "$network" --format '{{len .Containers}}')
  [[ $owner == "${network%_default}" && $count == 0 ]] || continue
  docker network rm "$network"
done
docker builder prune --all --force
# Only dangling unused images; tagged base/rollback images are not globally pruned.
docker image prune --force
assert_wetty
printf '\nAfter cleanup — Wetty unchanged and running:\n'
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
df -h /
if command -v free >/dev/null; then free -h; fi
docker system df
