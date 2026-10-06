# Production Supabase rehearsal and VPS rebuild

Updated 2026-10-05. Local production-style restore/deployment now tested; see
[PRODUCTION_REHEARSAL_RESULTS.md](PRODUCTION_REHEARSAL_RESULTS.md). Public Apache
TLS repair, VPS cleanup and VPS rebuild have not run. The earlier CLI-managed
local stack remains functional evidence for a different deployment workflow.

## Agreed decisions

- Rehearse the entire production deployment on the local Windows/Docker Desktop
  machine first. Then build on the VPS, as the user explicitly selected.
- Target: Debian amd64, four cores, about 8 GB RAM, one audit at a time.
- Keep separate Supabase application PostgreSQL and SnapFlow audit PostgreSQL.
- Keep one public origin: `https://snapflow.medianet.space` for both frontend
  and Supabase. No additional DNS record or `/supabase` URL prefix.
- Use production self-hosted Supabase Compose, with PostgreSQL 17 to match the
  Cloud source. Freeze a compatible official configuration and image versions
  into the tested release; do not pull floating upstream configuration on deploy.
- Import Cloud application data/users once. Old Storage files are excluded.
  Keep Cloud untouched. Existing Cloud sessions must be replaced by destination
  login sessions. Do not run the reset/bootstrap script after import.
- Remove the old SnapFlow and four ticketing services/data only after local
  acceptance and verified ownership. Preserve Wetty and all its dependencies.
- Chromium and existing model/default page budgets remain unchanged until
  their separate scan-capacity and accuracy acceptance passes.

## Verified VPS findings

Apache owns TCP 80 and 443. Container Nginx processes do not own public TLS.
The certificate on disk and served certificate both expire on 2026-08-06.
Certbot 2.1.0 uses the webroot authenticator; repeated October 2-5 renewals fail
ACME challenges. Its configured webroots are
`/var/www/snapflow.medianet.space/build` and
`/var/www/snapflow-api.medianet.space`. Apache's SnapFlow vhost forwards the
root to the frontend container. An independent read-only public probe confirms
that a nonexistent ACME challenge path returns HTTP 200 with 1,331 bytes of
frontend HTML, rather than a missing-file response. This confirms incorrect
challenge routing. The earlier ACME error is "reader size limit exceeded";
the current small probe does not explain the earlier response size itself.

The served certificate's SANs are `snapflow.medianet.space` and
`snapflow-api.medianet.space`; both must remain on the renewed certificate.
The API hostname currently returns 404 for a nonexistent challenge, which is
appropriate but does not yet prove that a real challenge file will be served.
The certificate is used by both vhosts, not just the frontend vhost.

Runtime versions supplied by the user: Docker client/server
`20.10.24+dfsg1`, Compose `v5.1.3`, Certbot `2.1.0`. Local Docker is 29.1.2.
Engine/build compatibility must be tested, not inferred from local success.

The recorded root filesystem has 7.5 GB free. Docker reports 418 images,
33.62 GB total image size, 31.63 GB reclaimable, 4.131 GB build cache and
6.121 GB reclaimable container size. These are estimates with shared-layer
overlap, not an additive guaranteed space gain. Measure free disk after cleanup.

| Resource | Handling |
|---|---|
| `v3-microservices` project | Old deployment can be replaced. Its recorded volumes are `v3-microservices_pgdata` and `v3-microservices_form_test_artifacts`. |
| `ticketing-cloud-min` project | Remove its four verified containers and owned resources. Recorded data volume: `ticketing-cloud-min_duckdb_warehouse`. |
| `wetty_wetty_1` | Preserve exact container ID, image, running state, bind mounts and network. |
| `/root/wetty/conf/id_rsa_snapflowhosting`, `/root/wetty/conf/wetty-config.json` | Protected paths. Do not read their secret contents, delete, move or change them. |
| `wetty_default`, host Docker network | Protected. Removing the ticketing UI must not remove its shared host network. |
| `/etc/apache2/sites-enabled/990-wetty.conf` | Protected global proxy route; preserve effective routing when adding a SnapFlow catch-all. Do not publish its terminal path in release manifests. |
| `wonderful_goldwasser` | Created 2026-07-21, no Compose project label, no mounts, image `83f5f77d7f1b...`. Ownership/content remain unknown; exclude from automatic cleanup. No mounts does not establish disposable writable-layer data. |
| Apache, SSH, certificate directories, other vhosts | Preserve; change only the identified SnapFlow routing/certificate configuration. Use graceful Apache reload. |

SnapFlow vhost: `/etc/apache2/sites-enabled/010-snapflow.medianet.space.conf`.
Shared-certificate API vhost: `020-snapflow-api.medianet.space.conf`.
Do not alter the legacy API application while fixing its certificate challenge.
Ticketing-owned vhosts are `ticketing.medianet.space.conf`,
`ticketing-ip-port.conf` and `ticketing-duckdb-ui.conf`; disable these only
after confirming they contain no protected/shared routes. Leave other vhosts,
the unrelated certificates and Apache's shared listening configuration intact.

## 1. Prepare the reusable deployment workflow

Implement a production workflow separate from the existing CLI-development
bootstrap. Keep its non-secret configuration in `deploy/production/` and use
private environment/staging directories outside Git and OneDrive. The local
rehearsal and VPS installation use the same scripts, source release and pinned
dependencies; only public origins, private runtime paths and port bindings vary.

Expose explicit commands for discovery, serial build, first-install/import,
ordinary update, verification and scoped cleanup. First-install requires an
empty owned destination and a verified export manifest. Record an import marker
with the export checksum only after success. Repeat/update operations must
retain users, data, signing keys and passwords, and never replay the data import.
Migration or build failure terminates the phase with a nonzero status.

Supabase includes Auth, REST, Realtime, Storage, Edge Runtime, database, gateway
and their required dependencies, with Studio available privately. Keep optional
log analytics outside the baseline; preserve required functional services.
SnapFlow includes audit DB, scanner, aggregator, NLP, LanguageTool 6.8, browser,
Form Executor, visual service and frontend. Preserve CPU image separation and
the existing separate visual image. Obscura stays an optional profile.

Use explicit Compose project identities. Remove fixed container-name collisions
from the rehearsal configuration. Stop the owned current development services
before the rehearsal to avoid running two full stacks and reusing their aliases.
Keep unrelated containers, volumes and the verified Cloud export intact.

Run an isolated compatibility rehearsal against Docker 20.10.24 and the
reported Compose 5.1.3 client, separate from the host daemon. Validate serial
Dockerfile builds and required Compose startup/health/network features. This
test is scoped to engine compatibility, not VPS peak capacity. Do not upgrade
or restart VPS Docker automatically. An incompatibility that requires an engine
replacement is an architectural blocker because Wetty must remain running.

## 2. Restore and connect locally

Recover the export key through the DELL Windows account, verify archive hashes,
and decrypt only into restricted private staging. Start production Supabase
database/service migrations, inspect required extensions and Auth/Storage table
compatibility, then restore roles/schema/data transactionally with error-stop.
Do not discard Auth/user columns to hide an incompatible version. Import the
12 users and compare exported table counts and user IDs before test-user seeding.

Compare the imported schema/migration history with local changes. Apply only
missing corrections; do not rerun the entire application migration history over
the imported schema. Preserve RLS, API grants, role assignments, triggers and
service-only RPC permissions. Apply SnapFlow evidence migration to the separate
audit DB and verify it twice.

Generate coherent destination signing/API credentials once. Initially retain
legacy JWT anon/service-role compatibility used by the current handlers and
schedulers; do not combine this migration with an unrelated API-key redesign.
Rebuild the frontend with the destination URL/public key. Server keys stay out
of frontend bundles and build context. Reconcile the 27 exported function
sources with the locally tested corrections rather than overwriting fixes.

Browser paths on the shared public origin:

| Path | Destination |
|---|---|
| `/` and SPA routes | Frontend |
| `/auth/v1/`, `/rest/v1/`, `/functions/v1/`, `/storage/v1/`, `/realtime/v1/`, `/graphql/v1/` | Supabase gateway, preserving path and query |
| Existing Wetty routes | Preserve their exact current upstream/routing before adding any catch-all |
| Studio and raw aggregator API | Private access; do not route their roots publicly |

Use private Docker aliases for Edge-to-aggregator and Form-Executor-to-Supabase
and DB traffic. Restrict cross-stack networking to services that need it; avoid
ambiguous `db` aliases. Set the public storage origin and Auth redirects to the
shared public origin. Support websocket upgrade/forwarded headers in Apache.
The local rehearsal uses a loopback origin and isolated Apache proxy; local
routing/TLS tests do not certify the VPS public certificate or ACME reachability.

Imported schedules and pending execution queues must not trigger live work
during restore. Keep dispatch/workers disabled until inspected and tested with
owned jobs. Rebind destination Vault scheduling values and install the required
cron jobs explicitly; source Vault contained no secrets. Use a local mail sink
for rehearsal. Production signup/email acceptance requires real SMTP credentials
and a delivery test, not local-mail evidence.

Gemini and Redmine credentials are verified against Cloud. Groq and original
Cloud 2Captcha values remain unresolved: recover/configure them privately before
claiming those integrations work. Test a supported Gemini model, because the
existing retired model default cannot be repaired by importing its key alone.
Audit public function authorization, including scan/poll and scheduled handlers;
never expose the development `seed-users` operation as a public seeding route.

## 3. Local acceptance before VPS cleanup

- All required services ready; first-install succeeds, ordinary second launch
  retains imported user IDs/data/keys and does not reset or repeat the import.
- Real frontend login, project/role access and RLS checks; rejected anonymous
  privileged calls and non-admin role changes. Use temporary test identities
  without resetting imported users' passwords. Verify an existing user login
  interactively with the user when credentials are available.
- Frontend/Edge/private aggregator scan; all six known fixture pages rendered
  and current NLP revisions; FR/EN/AR, delayed hydration, nested shadow content
  and meaningful query routes. Persisted report reload and queued second audit.
- New Storage upload/download and signed URLs; Realtime notifications and
  websocket routing; test scheduled audit and Form Executor jobs using owned
  fixtures. Confirm destination URLs, not Cloud or old localhost URLs.
- Graceful service restart and repeat deployment; imported users and completed
  reports remain. Test active worker interruption separately from idle restart.
- Record build time/peak disk, runtime memory, image identities, settings and
  logs without secrets. Local eight-CPU/about-11.6-GiB Docker evidence cannot
  establish four-core/eight-GB VPS capacity or the provisional 1-GiB headroom.
- End every test phase by removing owned disposable fixtures, obsolete test
  images and build cache while retaining the candidate and rollback resources.

## 4. VPS build, certificate repair and rollout

Oct 6: the user authorized VPS cleanup. Standalone `deploy/production/clean-vps.sh`
targets the recorded legacy container names **and** Compose project labels.
It verifies the exact three volume owners and excludes volumes shared with
unapproved containers before stopping anything. Wetty's identity, image,
running state, start time, mounts and network are hashed and checked throughout.
Source/env files, Apache, certificates, host services and unknown containers are
untouched. Old target images are removed without force only when no retained
container uses them; only exact unused project networks are removed. Cache and
dangling-image cleanup follow. Bash syntax and four fake-Docker scope/abort
tests pass locally; no VPS cleanup result has been received yet. Upload the
standalone script, run it from the existing SSH session and retain its before/
after output. The old application will be down pending the new deployment.

Release distribution: commit/push the implementation to `origin/main` first.
On the VPS, fetch and extract `SnapFlow/deploy/production/clean-vps.sh` from the
fetched revision into the user's home directory before cleanup. After the
script succeeds and verifies Wetty, update the existing checkout with
`git pull --ff-only origin main`. No force/reset/stash deletion is part of this
workflow. Source/settings files remain in place; imported destination settings
and the encrypted Cloud bundle are transferred separately and never through Git.

After local acceptance, create an exact cleanup manifest from current Compose
labels, all container references, volume consumers, mounts and protected Wetty
resources. Save effective settings and release/rollback metadata privately.
Pause SnapFlow during replacement; remove only approved SnapFlow/ticketing
resources. Unknown images and the stopped container remain until identified.
Never restart Docker or run global container/volume/network pruning.

Recheck free disk after actual cache/obsolete-image cleanup. Build bases and
services sequentially, checking disk before and after each stage using the
measured local peak requirement plus operating headroom. Retain rollback image
IDs and match base reuse to tested build-input identity, not just `latest` tag
existence. Abort before filling the filesystem; successful local builds do not
prove the VPS build will fit. Apply bounded Docker log rotation for new services.

Keep host Apache. Capture the full SnapFlow/API vhosts and protected global
Wetty configuration privately immediately before preparing the patch. Scope
changes to the identified vhosts; do not replace the entire Apache directory.
Serve `/.well-known/acme-challenge/` from each existing configured webroot,
with explicit local Alias/directory access and exclusion from proxy/rewrite
processing. Existing Location-based proxy rules require an exclusion that
actually works in that context; a vhost ProxyPass exception must not be assumed
to override a Location catch-all. Verify Apache version/module support for
SetEnvIf/no-proxy before using it. Test both challenge routes and Wetty against
the locally reproduced ordering before the live patch.

Syntax-check and gracefully reload Apache after routing changes. Place a unique
owned plaintext probe in each challenge directory and verify its exact bytes
externally over HTTP, then remove only those probe files. A nonexistent probe
must return 404, not SPA HTML. Retain both certificate SANs and existing webroot
mappings. Certbot 2.1.0 does not support the newer `reconfigure` command.
Use `certbot renew --cert-name snapflow.medianet.space --dry-run`; only after
success run `certbot renew --cert-name snapflow.medianet.space`, then reload
Apache gracefully. Install a successful-renewal deploy hook guarded by Apache
configuration validation, preserve the timer, and verify another dry-run.
Enable HTTP-to-HTTPS redirect except the challenge path. Verify public trust,
both hostnames and new expiry without `curl -k`; recheck Wetty accessibility.

Transfer the encrypted export/key separately, import once with fresh destination
credentials, apply missing migrations, configure SMTP and integrations, and
rebuild the frontend for `https://snapflow.medianet.space`. Re-run the local
acceptance checks on the VPS. Keep Cloud intact as a source/rollback option.
Code rollback does not restore the deliberately deleted old audit database.

Then perform the separate 150/300/500-page capacity matrix with all required
services and Wetty running, recording peaks, responsiveness, evidence and scan
duration. No 500-page/model/engine promotion until its own acceptance passes.

## Discovery and execution status

General VPS discovery has been supplied and is incorporated above. No further
general inventory is required before preparing the local production rehearsal.
At implementation, capture full vhost contents/configuration includes and image
references privately to construct and validate the exact Apache patch and
cleanup manifest. Refresh that snapshot immediately before deployment rather
than relying on old PIDs, container IDs or image reclamation estimates.

The Docker-size command output supplied so far lacks an overlay2/overall total;
do not label it a complete filesystem attribution. Measure actual free disk and
stage peaks in the workflow. This remains the rollout plan. Completed local
build/restore/function/restart/cleanup evidence is recorded separately in
`PRODUCTION_REHEARSAL_RESULTS.md`; public HTTPS and VPS capacity remain open.

References: [Supabase restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform),
[Supabase HTTPS](https://supabase.com/docs/guides/self-hosting/self-hosted-proxy-https),
[Apache reverse proxy](https://httpd.apache.org/docs/2.4/howto/reverse_proxy.html),
[Certbot webroot](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot).
