# Combined SnapFlow and Supabase deployment acceptance

Added to the active broader-scan goal on 2026-10-04 at the user's request.
Completion now requires testing the existing preproduction deployment workflow
locally with Supabase and documenting the same reproducible commands for the
Linux VPS. This requirement supplements the scan/NLP/browser acceptance; it
does not replace measured 150/300/500-page capacity.

User clarification: existing SnapFlow/Supabase preproduction data does not
need to be preserved. Fresh/reset test deployment is authorized. The reset
must target this environment, not unrelated projects/volumes. Save benchmark
artifacts before resetting; results must still support the comparisons.

## Current result — 2026-10-06

The local **production-style import and full deployment now pass**. See
[PRODUCTION_REHEARSAL_RESULTS.md](PRODUCTION_REHEARSAL_RESULTS.md): all 63 source
table counts, 12 preserved user hashes, real frontend/Edge audits, current
six-page evidence, Auth/RLS, Realtime/Storage/local mail, owned scheduled/form
jobs and ordered restart. Docker 20.10 representative builds require Buildx
v0.17.1. Cache was cleaned to zero (5.971 GB reclaimed). VPS/TLS/capacity,
real SMTP/cron and missing Groq/Cloud 2Captcha credentials remain open.

Final platform checks now include clicking the public email-confirmation link
and signing in afterwards. Cold/warm Realtime repeats distinguish socket join
from PostgreSQL readiness. The frontend now refreshes notifications at database
readiness/reconnect and rejects older snapshot responses; three regression
checks pass. This completes the local check, not the VPS acceptance gates.

### Production rehearsal and verified VPS discovery

The next workflow is defined in [PRODUCTION_REHEARSAL_PLAN.md](PRODUCTION_REHEARSAL_PLAN.md):
rehearse the production Compose stack locally first, then build on the VPS as
the user selected. Frontend and Supabase share `https://snapflow.medianet.space`
through native Supabase API paths. Apache owns VPS ports 80/443; the expired
certificate is also expired on disk, and webroot renewals repeatedly fail ACME
challenges. Additional output establishes the configured build-directory webroot
and Location-based frontend proxy. A public read-only probe confirms a nonexistent
challenge returns HTTP 200 with frontend HTML: challenge routing is wrong.
Retain both certificate SANs (`snapflow.medianet.space` and
`snapflow-api.medianet.space`) and use renewal commands supported by Certbot 2.1.0.
Reproduce effective vhost/Wetty ordering before the live patch.

Supplied discovery identifies the SnapFlow/ticketing volumes and Wetty's protected
network/bind mounts. Docker reports 4.131 GB build cache and large estimated image
reclaimability; measure actual free space after scoped cleanup, without adding
overlapping estimates. No VPS cleanup, TLS repair or VPS build has run. The
production-style restore and isolated Docker-20 representative builds are now
tested locally, without upgrading/restarting VPS Docker.
Earlier CLI deployment acceptance below remains historical local
functional evidence, not acceptance of this new production configuration.

### Cloud migration decisions and actual export

The user confirmed that SnapFlow keeps its separate audit PostgreSQL database.
The next VPS rebuild may remove SnapFlow/Supabase data and the four ticketing
services/data, but **Wetty must remain running and untouched**. Preserve its
container, image, volumes, networks, proxy configuration, OS/SSH and certificates.
Use exact project/resource ownership checks, not global container/volume/network
pruning or a Docker daemon restart.

For Supabase Cloud, preserve the database and users and restore working external
credentials. Old Storage files are excluded; recreate buckets/permissions for new
uploads. These are migration requirements, not authorization to reset Cloud.
The CLI stack tested below is local development/preprod evidence. The production
VPS requires a production self-hosted Compose deployment; do not publish the CLI
development stack as the final production deployment.

Actual CLI login already existed in Windows native credential storage. Read-only
project lookup confirms **Snapflow**, reference `wagctsvpmnleqzqjhqjq`, healthy.
The existing server-mode connection was verified with a read-only query:
Cloud PostgreSQL **17.6**, **12 Auth users**, **31 public tables**, **zero Vault
secrets**. No Cloud schema, data, functions or settings were changed.

Actual exports now completed: `roles.sql` (297 bytes), `schema.sql` (173,326
bytes), `data.sql` (38,856,199 bytes), function/secret inventories, API-key
snapshot and all **27 deployed Edge Function sources**. Data includes 63 table
COPY sections; the exported Auth-user count matches 12. Old `storage.objects`
rows and `vault.secrets` were excluded explicitly. Source/file hashes were
verified; the later local production restore also verifies all 63 table counts.

Cloud secret listing exposes digests. Saved **Gemini and Redmine** credentials
match their Cloud digests and are preserved privately. The Cloud **Groq** value
is not saved locally; the Cloud **2Captcha** digest differs from saved local
credentials. Those two original values still need provider-side recovery or an
explicit provider/configuration replacement decision before claiming complete
secret migration. Supabase-injected API/signing credentials must be regenerated
consistently for the destination. Auxiliary AI defaults were repaired after real
provider probes: Gemini 3.5 Flash-Lite responds through the destination Edge
handler. Packaged NLP defaults remain unchanged.

The 47-file export was compressed/encrypted into a verified 4,490,764-byte
Fernet archive in this access-restricted, non-OneDrive/non-Git directory:

`C:\Users\DELL\AppData\Local\SnapFlow\cloud-exports\20261005-082109-wagctsvpmnleqzqjhqjq`

Only `migration-bundle.tar.gz.fernet`, public `migration-summary.json` and
`migration-key.dpapi` remain as files. The key is protected by Windows DPAPI
for the DELL account; recover it on that account for subsequent secure VPS
transfer. An encrypted archive alone is not recoverable on another machine
without its key. All plaintext SQL/key/source staging files were removed after
successful final key recovery, decryption and SQL-checksum verification. No
secret values or user records were placed in chat or repository artifacts.

Export-only PostgreSQL client image `17.11.0.002` was removed after the CLI
finished. Build cache remains zero; the running Supabase `17.6.1.063` image,
current candidates, rollback images and data volumes remain.

The local production rehearsal is completed with the corrections in its results
document. Next: prepare the VPS release/cleanup/Apache patch, real SMTP and
destination cron/Vault settings, then repeat acceptance and capacity tests on
the actual server. Do not run `db reset` after importing users/data. Preserve
Cloud as the migration source; local success is not complete VPS acceptance.

### Completed local deployment test

The actual fresh Supabase bootstrap and the full SnapFlow launcher now pass on
Docker Desktop. The launcher also passes on repeat invocation. Supabase Auth,
PostgREST, storage, realtime, database and real Edge Runtime remain running
alongside all nine SnapFlow services, including shared LanguageTool 6.8 and
the CUDA-capable visual service. This is local functional acceptance, not
4-core/8-GB VPS capacity acceptance.

Corrections found through actual deployment and report inspection:

- New Supabase tables had RLS policies but no API-role table grants. Migration
  `20261005010000_explicit_application_api_grants.sql` grants the explicitly
  listed application tables according to their existing RLS use; anonymous
  access remains restricted to the existing trial contract. Service-only RPC
  permissions are unchanged. This matches Supabase's
  [explicit-grant change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).
- The random admin seeder now creates the required client before its demo
  project. A failed seed terminates bootstrap with its real exit status.
  Credentials stay in ignored local files and are excluded from Docker build
  context.
- URLs with explicit ports were incorrectly passed as domain hostnames.
  Aggregator, scanner and browser scope normalization now use hostnames. The
  initial one-page audit was insufficient acceptance; corrected scans reach
  all six known routes without weakening private-address discovery protection.
- The known target deliberately does not implement HEAD. Admin/file probes
  now use GET on 405/501, rather than treating unsupported HEAD as exposure.
  Actual final admin-exposure verdicts change from failing/high to passing
  with null severity and 24 GET-confirmed 404 routes. Regression tests also
  retain detection of genuinely exposed admin pages and sensitive files.

| Actual check | Result and scope |
|---|---|
| Fresh bootstrap and first/repeat full launch | Exit 0; migrations, real seeded admin, project/client/assignment and required services ready. CUDA visual retained; no CPU-only visual decision implied. |
| Real Auth/PostgREST/RLS | Six checks pass, including assigned versus unassigned project access, self-promotion rejection and service-only RPC rejection. Temporary probe users removed. Not exhaustive RLS coverage. |
| Actual frontend + Edge + admission + pipeline | Browser submits first audit; actual Edge submits second with explicit six-page budget. Second observed pending while first active; never more than one active audit. Both finish with all six rendered, current-NLP pages. |
| Independent capture judge | Authored EN/FR/AR markers, 280–325 NLP words per route, delayed hydration, fetched prose, nested open shadow content and both meaningful query routes preserved in both audits. Not general semantic/KPI accuracy acceptance. |
| Independent final KPI judge | Known absent admin routes produce passing exposure verdicts in both corrected audits; original false alarm retained as before-fix evidence. |
| Report persistence and browser | Canonical reports reload identically; actual `/audit/<audit-id>/view` renders the stored report. Completed reports and current unclaimed rows survive idle aggregator/NLP restart. Mid-scan crash recovery is not tested here. |

Final corrected scan IDs: `scan_3ccc50f01cd8` and `scan_8e445c724130`.
The admission probe took 56.337 seconds from second submission until both
completed; this is not a per-scan duration, speed comparison or VPS result.
Docker has eight CPUs/about 11.6 GiB on this host. A roughly 4-GiB combined
container snapshot is not a peak-memory measurement or host-headroom proof.

Artifacts in `output/capacity-study`: `preprod-auth.json`, `preprod-audit.json`,
`preprod-evidence.json`, `preprod-security.json`, `preprod-restart.json`, saved
canonical reports and private bootstrap/build logs. The fixture is an owned
six-route HTTP server, not a public site. Its private Docker hostname means
this test does not certify public rendered late discovery or Obscura recovery.

## Reproduce the combined workflow

From the SnapFlow checkout, terminal 1 (fresh/reset preprod only):

```bash
cd Front-Snap
npm ci
bash ./scripts/local-supabase-preprod.sh --seed-random-admin
```

This script resets this CLI project's database even without `--clean`.
Keep the terminal open to serve Edge Functions. The user's reset authorization
applies to preprod; do not use this bootstrap to benchmark an existing production
database. For a remotely viewed VPS, set `SUPABASE_PUBLIC_URL` to its configured
HTTPS public origin before bootstrap; internal routes retain private aliases.
Alternatively forward localhost ports with SSH for a private local-style test.

Terminal 2, from the same checkout:

```bash
cd V3-Microservices
bash ./run-all.sh --local
docker compose -p snapflow-local-preprod --env-file .env.local -f docker-compose.preprod.yml ps
cd ../Front-Snap
node ./scripts/probe-local-preprod-auth.mjs
```

`--local` deliberately uses generated `.env.local` and the named project on
either platform. Server mode without that flag uses `.env.preprod`; do not
mix its project/environment with these local-style commands. Docker, Compose,
Node/npm and Supabase CLI must be installed. Tested locally: Node 20.19.2,
Supabase CLI 2.109.1, Docker 29.1.2 via Git Bash/Windows Docker CLI. The Linux
VPS invocation still needs its own actual runtime verification.

To repeat the known-content test, start the owned fixture from V3-Microservices:

```bash
docker run -d --name snapflow-preprod-fixture --label snapflow.test=preprod \
  --network snapflow-local-preprod_default --network-alias preprod-fixture \
  --mount "type=bind,src=$PWD/benchmarks/preprod_fixture.py,dst=/fixture.py,readonly" \
  snapflow/v3-python-fastapi-base python /fixture.py
```

Using the seeded admin from ignored `supabase/.local-login.json`, set only its
generated demo project's URL to `http://preprod-fixture:18991/` in the frontend.
Click **Nouveau rapport**, then immediately run the admission probe while that
first audit is active (not after it completes):

```bash
node Front-Snap/scripts/probe-local-preprod-audit.mjs
python V3-Microservices/benchmarks/probe_preprod_evidence.py
python V3-Microservices/benchmarks/probe_preprod_security.py
```

From the checkout root, after both audits finish, an idle restart can be tested:

```bash
docker restart snapflow-local-preprod-aggregator-1 snapflow-local-preprod-nlp-worker-1
# Wait for aggregator /health before the report probe.
python V3-Microservices/benchmarks/probe_preprod_restart.py
```

A repeat `run-all.sh --local` was tested while idle. Finish active audits first;
do not use `--down` during an audit. After tests restore the generated demo URL
and remove only the owned fixture. Every test phase ends with cache cleanup:

```bash
docker rm -f snapflow-preprod-fixture
docker builder prune --all --force
docker image prune --force
docker system df
```

Retain current candidate/base/rollback images, running services and data volumes.
Do not substitute `image prune -a` or a volume prune. Final cleanup results are
recorded in `preprod-final-cleanup.json`.

Final cleanup on 2026-10-05 removed the owned fixture and obsolete
`provider-recovery-study` NLP image, reclaimed another **1.336 GB** of build
cache after the correction rebuilds, and verified **zero remaining build
cache**. An earlier cleanup in this phase reclaimed 11.43 GB. Current candidates,
base/rollback images and data volumes remain; 21 required SnapFlow/Supabase
containers remain running. None reports OOM-killed at this final snapshot;
this is not repeated peak-load acceptance. The demo project URL was restored
to its original `https://example.com`, and saved fixture reports remain
reviewable. C-drive free space is 82.10 GiB; Docker layer reclamation does not
necessarily shrink its VHD immediately.

The corrected browser report was reloaded and its details view visually
reviewed: `output/playwright/.playwright-cli/page-2026-10-05T06-18-36-429Z.png`.
This establishes rendering of the existing report fields, not correctness of
every displayed finding.

Remaining: repeated 150/300/500-page VPS peaks with required Supabase services,
one/two NLP-worker comparisons, independently labelled final content KPIs,
public late discovery, Obscura/Chromium recovery and active worker-crash cases.
No 500-page, browser-engine or model default is promoted.

## Historical workflow and source findings (superseded by current result)

The current workflow uses `Front-Snap/scripts/local-supabase-preprod.sh` to
start CLI-managed Supabase, generate environment files and serve Edge Functions
in one terminal. A second terminal runs
`V3-Microservices/run-all.sh --local` to build/start SnapFlow Compose. Server
mode uses `.env.preprod`. Preserve this workflow initially; switching Supabase
to a different deployment architecture is not implied by this work.

Inspected problems:

- Supabase bootstrap calls `reset_local_database` unconditionally, even without
  `--clean`. A reset is acceptable under the user's clarification, but its
  behavior and migration failures must be explicit in the tested commands.
- `--clean` removes SnapFlow volumes and all Supabase instances/volume prefixes.
  Narrow cleanup to this project's resources before using it for reset testing.
- Generated `.env.local` files are overwritten. Preserve configured credentials,
  scan budgets and capacity settings on repeat launch rather than silently
  replacing them with local defaults.
- Browser-facing Supabase URLs are derived from local CLI status. Separate the
  public/browser origin from container-to-container addresses for the VPS.
- `host.docker.internal` is used for Edge Function calls to the aggregator and
  Form Executor calls to Supabase. The latter has Compose host-gateway mapping;
  verify the actual CLI Edge Runtime network on Linux as well. A working host
  curl is not proof that either container can reach its dependency.
- `run-all.sh` builds and starts services but does not apply the new idempotent
  evidence migration to an existing SnapFlow volume. Its `--local` project and
  environment must also be passed to the migration helper; applying to the
  default Compose project would modify the wrong database.
- The launcher does not wait for all required services or prove the frontend /
  Edge Functions / audit path. A container list alone is insufficient.

Initial corrections now implemented: project-scoped Supabase stop replaces
`stop --all` and the global volume-prefix deletion loop. A failed database
reset retains its nonzero exit status; healthy HTTP status cannot mask failed
migrations. Linux Bash syntax and function control-flow checks pass. These
checks use recording CLI adapters, not a real combined deployment; artifact
`output/capacity-study/preprod-controlflow.json` states that limit explicitly.
The current host reports Node 20.19.2 and installed Supabase CLI 2.109.1;
Linux CLI/dependency reproducibility remains part of the deployment test.

## Initial implementation checkpoint (before full launch)

- Six production CPU service images now build through the actual preprod
  Compose file: scanner, NLP, aggregator, browser pool, shared LanguageTool and
  Form Executor. An inaccessible `.pytest_tmp_form_executor_firstfail` directory
  initially blocked build-context upload; service ignore rules now exclude test
  scratch directories. No ACL changes or recursive file deletion were used.
- The launcher now starts/waits for PostgreSQL, joins local Supabase routing,
  checks recorded active audits, stops acquisition workers, applies evidence
  migration with the same environment/project, then starts with `--wait`.
  Scanner/aggregator/visual/frontend health checks are included.
- Actual project-aware migration ran twice on
  `snapflow-local-preprod`'s `snapflow_v3` database as `snapflow`. All five
  revision/readiness/claim columns and the revision trigger are present.
  Artifact: `preprod-migration.json`. The previous populated-legacy SQL test
  remains separate evidence; this new database is fresh.
- Generated internal routes use private Docker aliases: Edge Functions to
  `aggregator:8080`, Form Executor to `supabase-kong:8000` and `supabase-db:5432`.
  `SUPABASE_PUBLIC_URL` separately controls browser/public-storage origins.
  The connection helper attaches only the configured CLI project and can be
  repeated. Actual Docker DNS, HTTP and PostgreSQL tests pass using owned
  provider/client stand-ins, then those resources are removed. This is routing
  proof, not a real Supabase API/auth test: `private-routing.json`.
- Three actual Bash launcher-flow cases pass with a recording Docker adapter:
  default/local project selection and failed migration preventing worker start.
  `launcher-controlflow.json` records its limited scope. Bootstrap reset-error
  and explicitly project-scoped cleanup checks also pass.
- Windows Docker Desktop and native WSL use different engines. The tested
  image/routing/database work above uses Docker Desktop engine
  `67598802-9ee7-43b0-948c-5360ddd6758d` (29.1.2). Native WSL's unrelated images
  and containers were not repurposed or cleaned. This host advertises eight
  CPUs/about 11.6 GiB to Docker; these checks do not establish VPS capacity.

Artifacts above are in `output/capacity-study`; six built image identities are
in `preprod-cpu-images.json` and the actual build log is `preprod-cpu-build.log`.
Only the preprod database is started so far, alongside earlier isolated study
containers. No frontend/Supabase/full-stack audit acceptance is claimed.
The CPU-versus-CUDA visual-image architecture question is pending; no visual
default has been changed. After resolving it, finish the actual combined
startup, first/repeat launch, authenticated audit/report path and capacity tests.

## Implementation and test order

1. Test a fresh/reset Supabase deployment and apply all migrations. Data
   retention is not an acceptance gate. Restrict cleanup to this project and
   verify that a failed reset/migration cannot be mistaken for successful setup.
2. Preserve existing environment settings; obtain Supabase keys without
   printing secrets. Verify supported Node/CLI versions from the lockfile.
3. Make public origins and internal endpoints explicit. Test actual Edge Runtime
   to aggregator and Form Executor to Supabase/database connectivity on Linux.
4. Wire the transactional evidence migration into the correct Compose project
   after database readiness and before acquisition/NLP/admission workers start.
   Finish an active audit before any service recreation/migration.
5. Add startup readiness checks for PostgreSQL, shared LanguageTool, browser
   pool, scanner, aggregator, Form Executor, visual regression, frontend and the
   required Supabase API/auth/storage/Edge Functions. Preserve optional Obscura
   profile behavior. Avoid rebuilding unchanged heavy dependencies.
6. Run first launch and repeat launch in the owned resettable test environment.
   Verify expected reset behavior, valid credentials and successful migrations. Run a small
   known-content audit through the actual frontend/Edge Function bridge, reload
   its report, then test queued second-audit admission and worker restart.
7. Record exact commands, versions, images, effective settings, failure messages,
   startup time, disk use and peak memory. Use the same tested Bash commands on
   the VPS, with explicit environment/public-origin values rather than hidden
   Windows-only routing assumptions.
8. Repeat the capacity matrix with the combined required services still running.
   Compare 150/300/500 pages, application responsiveness, current evidence and
   host headroom. Record ticketing presence/removal separately.

## Required acceptance evidence

| Requirement | Evidence needed before claiming completion |
|---|---|
| Full combined deployment | Actual launcher logs and required-service readiness; no excluded Supabase dependency silently omitted |
| Reset is correctly scoped | Only this project's resources affected; expected fresh schema/seed and repeat launch; data retention is waived |
| Correct migrations | Correct project/database identity, applied Supabase versions and SnapFlow revision trigger, idempotent second application |
| Container networking | Successful real Edge Function audit request and actual Form Executor/Supabase health/database connection |
| Functional audit | Browser/frontend to Edge Function to aggregator, current persisted report reload, known fixture evidence |
| Restart behavior | No duplicate acquisition/publication; pending audit retained and one active audit enforced |
| Reproducible VPS commands | Tested Linux Bash workflow and environment mapping; documented first/repeat launch and recovery |
| Combined capacity | Required cohosted services present at repeated peak load, no OOM/restart, provisional 1 GiB host headroom, scan/report accuracy preserved |

At this initial checkpoint no combined-launch acceptance had run. Cleanup was scoped to this
project. Commands in IMPLEMENTATION_VALIDATION.md currently cover the SnapFlow
candidate migration/build; the final combined commands will be supplied after
the actual bootstrap and launcher finish validation.

## Requested cleanup and launch — 2026-10-04

- Removed obsolete `semantic-study` and `accuracy-study` NLP images and the
  `acquisition-study` browser image. Current candidates and the NLP rollback
  image remain. Docker reported 9.388 GB of build cache removed; host C-drive
  free space remained about 7.77 GiB immediately afterward. Docker's virtual
  disk does not necessarily return deleted capacity to the host immediately.
- Started the actual updated `bash ./run-all.sh --local` launcher, using the
  existing CUDA-capable visual image architecture. No CPU-only visual default
  was introduced while that architecture choice remains unanswered.
- Started `bash ./scripts/local-supabase-preprod.sh --seed-random-admin` from
  Front-Snap. Its reset affects this project's preprod database; the user's
  data-retention waiver applies. Credentials remain in ignored local files.
- Both runs are in progress: visual dependencies and Supabase images are being
  downloaded. This records a real launch, not successful combined readiness,
  authenticated report validation or VPS capacity acceptance.

### Storage interruption — 2026-10-05

The C drive filled during CUDA visual-base image export. Docker Desktop was
stopped for the user's requested storage cleanup; the launcher exited 1. No
complete build or combined startup is claimed. Supabase migrations reached
the credential/environment stage, but local admin role seeding failed with
`permission denied for table user_roles`; that also remains an acceptance
blocker rather than successful authenticated setup.

Host pip/npm download caches were cleared, restoring approximately 5.3 GiB
of C-drive headroom. Ubuntu apt/build caches and approximately 1.7 GiB of old
journals were removed, and its filesystem was trimmed. Its VHDX still occupied
82.56 GiB; Docker Desktop's disk occupied 27.84 GiB. Offline compaction requires
Administrator PowerShell, unavailable in the current agent token.

Ubuntu's separate native Docker engine has 33.75 GB of stopped Nexus repository
data mounted at `/nexus-data`. That application data was not deleted: the
preprod data-retention waiver does not establish permission to discard unrelated
Nexus repositories. Desktop failed to become ready after a restart attempt,
so its newly interrupted build cache has not yet been pruned. Resolve host
storage and the CPU/CUDA image choice before relaunching the large build.

### Ubuntu removal and Docker verification — 2026-10-05

The user explicitly requested complete removal of Ubuntu2004, conditional on
preserving Docker Desktop functionality. Before deletion, Ubuntu was stopped
and Docker Desktop restarted successfully with its independent engine
`67598802-9ee7-43b0-948c-5360ddd6758d` (29.1.2). All 15 Desktop containers were
inspected; none had Ubuntu/WSL-dependent bind mounts. The Ubuntu registration
resolved to the specifically authorized `C:\WSL\Ubuntu2004` target, separate
from Desktop's registered distro and data disk.

`wsl --unregister Ubuntu2004` succeeded. Its registration and VHDX are gone;
Docker Desktop's disk and distro remain. C-drive free space increased from
5.24 to 87.81 GiB, a measured recovery of 82.56 GiB. Docker Desktop still
responded after deletion, with the Supabase and preprod database containers
running. `output/capacity-study/ubuntu-removal.json` records the measurements.

The removed distro included its native Docker engine, Nexus repositories and
other Ubuntu data. Future local launcher testing uses Git Bash and the Windows
Docker CLI against Docker Desktop. This storage recovery does not resolve the
previous admin-seeding failure or establish combined deployment acceptance.
