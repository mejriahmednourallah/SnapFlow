# SnapFlow V3 Runbook

This runbook covers the Docker Compose launcher used for both the preprod server and local preprod development.

## Important Build Rule

`--no-cache` does not rebuild the shared Python base images.

The shared base images are expensive to build:

- `snapflow/v3-python-fastapi-base:latest`
- `snapflow/v3-python-heavy-base:latest`

They are rebuilt only when:

- you pass `--rebuild-base`, or
- the required base image is missing locally.

Use `--rebuild-base` only after changing files under `docker/python-base/`, changing base requirements, or intentionally pruning the base images.

## Server Preprod Run

From the server repository:

```bash
cd V3-Microservices
```

Normal preprod start/rebuild:

```bash
./run-all.sh
```

Rebuild service images without Docker cache, but reuse existing base images:

```bash
./run-all.sh --no-cache
```

Stop containers first, then rebuild services without cache:

```bash
./run-all.sh --down --no-cache
```

Force the expensive shared base rebuild only when explicitly needed:

```bash
./run-all.sh --rebuild-base --no-cache
```

Follow logs:

```bash
docker compose --env-file .env.preprod -f docker-compose.preprod.yml logs -f
```

## Local Preprod Run

The local launcher uses `.env.local` and the `snapflow-local-preprod` compose project.

If `.env.local` is missing, create/start the local Supabase preprod environment first:

```bash
cd Front-Snap
./scripts/local-supabase-preprod.sh
```

Then run the local microservices:

```bash
cd ../V3-Microservices
./run-all.sh --local
```

Rebuild local service images without Docker cache, while reusing base images:

```bash
./run-all.sh --local --no-cache
```

Stop local containers first, then rebuild services without cache:

```bash
./run-all.sh --local --down --no-cache
```

Force local base rebuild only when explicitly needed:

```bash
./run-all.sh --local --rebuild-base --no-cache
```

Follow local logs:

```bash
docker compose -p snapflow-local-preprod --env-file .env.local -f docker-compose.preprod.yml logs -f
```

## Docker Disk Cleanup

Check usage:

```bash
docker system df
```

Clean unused BuildKit cache:

```bash
docker builder prune -a -f
```

Keep a small amount of BuildKit cache:

```bash
docker builder prune -a -f --reserved-space 2GB
```

Clean unused images, without touching running containers or volumes:

```bash
docker image prune -a -f
```

Avoid `docker system prune --volumes` unless you intentionally want to delete database/storage volumes.

## Troubleshooting BuildKit Snapshot Errors

If a build fails with an error like:

```text
failed to prepare extraction snapshot
parent snapshot ... does not exist
```

that is Docker BuildKit cache/snapshot corruption, usually after heavy pruning or an interrupted build. The services that show `CANCELED` are normally not the root cause; Compose cancels them after the first failing target.

Repair sequence:

```bash
docker builder prune -a -f
docker buildx prune -a -f
docker system prune -f
```

Then restart Docker Desktop. If Docker is running through WSL, also run:

```bash
wsl --shutdown
```

After Docker starts again, rebuild:

```bash
cd V3-Microservices
./run-all.sh --local --no-cache
```

When disk space is tight, building one target first can make the failure easier to isolate:

```bash
docker compose -p snapflow-local-preprod --env-file .env.local -f docker-compose.preprod.yml build --progress=plain --no-cache aggregator
docker compose -p snapflow-local-preprod --env-file .env.local -f docker-compose.preprod.yml build --progress=plain --no-cache frontend
```
