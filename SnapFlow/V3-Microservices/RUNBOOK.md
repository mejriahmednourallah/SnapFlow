# SnapFlow V3 Runbook

This runbook covers the Docker Compose launcher used for both the preprod server and local preprod development.

## Important Build Rule

`--no-cache` does not rebuild the shared Python base images.

The shared base images are expensive to build:

| Base image | Consumers | Included dependencies |
| --- | --- | --- |
| `snapflow/v3-python-fastapi-base:latest` | Aggregator and all service bases | API, PostgreSQL client |
| `snapflow/v3-python-nlp-base:latest` | NLP worker | Text analysis, French spaCy model, Java for LanguageTool |
| `snapflow/v3-python-browser-base:latest` | Browser pool, form executor | Playwright Chromium and Pillow |
| `snapflow/v3-python-heavy-base:latest` | Visual regression only | Chromium, image comparison, PyTorch/CUDA/LPIPS |

NLP and browser services do not inherit the visual/GPU base. Optional semantic
installation in NLP uses CPU PyTorch; its install and runtime flags remain off
by default. Model names, KPI logic and browser selection are unchanged by this split.

For CPU-service development, build just the common, NLP and browser bases:

```powershell
.\BUILD_V3_BASE_IMAGES.ps1 -CpuOnly
docker compose build nlp-worker v3-browser-pool v3-form-executor aggregator
```

```bash
./BUILD_V3_BASE_IMAGES.sh --cpu-only
docker compose build nlp-worker v3-browser-pool v3-form-executor aggregator
```

The normal full-stack launcher still builds the visual/GPU base, because visual
regression needs it. On the first build after this split, use `-RebuildBase`
or `--rebuild-base` to refresh an existing heavy base and remove its old NLP packages.

They are rebuilt only when:

- you pass `--rebuild-base`, or
- the required base image is missing locally.

Use `--rebuild-base` only after changing files under `docker/python-base/`, changing base requirements, or intentionally pruning the base images.

## NLP validation settings

The CPU NLP base packages NLTK resources, French spaCy and LanguageTool 6.8
with headless Java. Preprod starts one shared LanguageTool 6.8 server;
workers use fixed FR/EN/AR remote clients and do not start local JVMs. It does not need a runtime
download or external spelling API. First-language dictionary/entity warm-up
still needs to be included in startup/scan measurements.

Optional semantic installation and enrichment remain off by default.
`INSTALL_SEMANTIC=true` is a **build** setting; `NLP_SEMANTIC_ENABLED=true` is
the worker runtime setting. The optional CPU semantic image now builds and
passes controlled offline passage inference; matched site replay and full
worker/scan acceptance remain open.

`NLP_PASSAGE_RETRIEVAL_ENABLED=true` additionally enables token-bounded passages
from the complete extracted body. `NLP_PASSAGE_MAX_WINDOWS` defaults to 32.
It requires semantic enrichment and the model tokenizer. It adds exact
extracted-text spans and token completion metadata under
`semantic_enrichment.passage_retrieval`; existing cosine fields and KPI verdicts
retain their meaning. Matches indicate topic relevance, not factual support.
The cap can leave a long page partially analyzed; inspect completion rather
than assuming the whole page reached inference.

The NLI candidates in `benchmarks/` are local evaluation tools. They are not
installed in the worker and do not alter production verdicts. See
`../docs/audits/2026-10-02-kpi-evidence/NLP_ACCURACY_REVIEW.md` for independent
labels, errors and the remaining site-level acceptance work.

Keep test storage bounded: remove dangling test images and disposable build
cache after completed comparisons, retain current required image tags, and
avoid volume pruning. Check host free space before major builds/downloads;
Docker cache reclamation does not imply equivalent Windows free space until
WSL storage returns it.

## Server Preprod Run

From the server repository:

```bash
cd V3-Microservices
```

Normal preprod start/rebuild. Chromium is the default; Obscura is opt-in:

```bash
./run-all.sh
```

Disable Obscura and use only the local Chromium pool:

```bash
./run-all.sh --no-obscura
```

Explicitly enable the Obscura profile and recovery router:

```bash
./run-all.sh --obscura
```

Startup now waits for the database, applies the transactional evidence migration
to the selected Compose project before workers start, then waits for service
health. Finish any running audit before redeploying.

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

Check browser-pool capacity:

```bash
docker exec v3-browser-pool curl -s http://localhost:8084/health
```

In the aggressive OVH preprod profile, `pool_size` is `64`, `active_sessions` is the number of render/screenshot jobs currently running, and `ignore_https_errors` should be `true`. `pool_size` does not mean 64 Chrome processes are preloaded; the pool keeps one shared Chromium runtime and opens concurrent contexts/pages on demand, so RAM usage stays modest until scans are actively rendering many pages.

Default scans now request `headless_concurrency=24` and clamp request overrides to `1..48`, so a single scan can use more of the browser pool without one request consuming the whole server.

## Local Preprod Run

### Form Tester Gemini configuration

Form Tester reads Gemini configuration only from server-side environment
variables. Never expose these values through a `VITE_*` variable.

```powershell
$env:GEMINI_API_KEY="<new-key>"
$env:FORM_TESTER_GEMINI_MODEL="gemini-2.0-flash"
```

Then launch local Supabase:

```bash
cd Front-Snap
./scripts/local-supabase-preprod.sh
```

The bootstrap copies these variables into `supabase/.env.local`. If Gemini is
missing or unavailable, Form Tester uses its deterministic heuristic generator.
The authenticated `form-tester-ai-status` function reports provider, model and
availability without returning the secret.

The local launcher uses `.env.local` and the `snapflow-local-preprod` compose project.
For Form Tester browser execution, `.env.local` must also contain:
`FORM_EXECUTOR_DATABASE_URL`, `FORM_EXECUTOR_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `FORM_EXECUTOR_ARTIFACT_BUCKET`.
`./run-all.sh --local` backfills the safe local defaults when the local
Supabase env file already exists.

The local launcher joins this configured Supabase project's Kong, database and
Edge Runtime to the private Compose network. Internal defaults are
`http://supabase-kong:8000`, the `supabase-db` PostgreSQL alias and
`http://aggregator:8080`. Set `SUPABASE_PUBLIC_URL` on bootstrap for the actual
browser-facing Supabase origin when running this workflow on the VPS.
The user authorized fresh preproduction resets. Cleanup stops only this
Supabase project; a failed reset/migration stops setup. Full combined-deployment
acceptance is tracked in `../docs/audits/2026-10-02-kpi-evidence/PREPROD_DEPLOYMENT_PLAN.md`.

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

Disable Obscura locally and use only the local Chromium pool:

```bash
./run-all.sh --local --no-obscura
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
--------------------------------------------------------------------
cd ~/snapflowv2.medianet.tn/SnapFlow

git status --short
git diff -- SnapFlow/V3-Microservices/run-all.sh

# optional safety backup
cp SnapFlow/V3-Microservices/run-all.sh /tmp/run-all.sh.server-backup

# restore only that file from git
git checkout -- SnapFlow/V3-Microservices/run-all.sh

# pull latest
git pull --ff-only
If you want to keep the server edit for later, use stash instead:

bash

cd ~/snapflowv2.medianet.tn/SnapFlow

git stash push -m "server local run-all.sh before preprod pull" -- SnapFlow/V3-Microservices/run-all.sh
git pull --ff-only

# only if you want to reapply the server edit after pulling:
git stash pop
For your case, I’d use the first path if run-all.sh should now match the repo. Then continue with:

bash

cd SnapFlow/V3-Microservices
./run-all.sh --no-cache
