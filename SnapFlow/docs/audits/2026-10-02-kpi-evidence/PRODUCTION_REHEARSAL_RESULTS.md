# Production-style local deployment — updated 2026-10-06

The Cloud export was restored into the pinned production Supabase Compose
stack. SnapFlow uses it through Apache and retains its separate audit database.
Cloud and the VPS were not modified. Earlier CLI containers are stopped, with
rollback volumes retained. Frontend: **http://127.0.0.1:18080**.

Private settings/login/export staging are under
`C:\Users\DELL\AppData\Local\SnapFlow\production-rehearsal`, outside Git/OneDrive.
Imported passwords were not reset; destination signing/API keys are new.

## Actual results

| Check | Result and boundary |
|---|---|
| Import | All **63 exported table counts** match: **12 users / 31 public tables**. SQL hashes verified. |
| Persistence | All 12 imported IDs/password hashes match after restart; keys reused; persisted report unchanged. Interactive login with each imported password was not tested. |
| Full deployment | **23 containers running** with both DBs, production Supabase, frontend/Apache, LanguageTool and browser/NLP/forms/visual services. Supabase PG **17.6**, audit PG **16.15**. |
| Browser/access | Real login, restored dashboard, frontend audit submission/report viewer. Seven Auth/RLS checks passed, including rejected self-promotion, service-only RPC and assistant identity impersonation. |
| Audits | Frontend `scan_48dcaa503461` and Edge `scan_675564eac51b` completed. Second observed pending while first active. **70.355 s** is the probe window after second submission, not each scan's duration. |
| Evidence | All six authored routes in both reports, rendered captures/current NLP; **280–325 words/page**. Hydration, fetch, nested shadow and both query routes passed. Persisted reload identical. Not general KPI accuracy acceptance. |
| Platform API | Cold and warm Realtime tests pass after waiting for PostgreSQL readiness; one INSERT each, without retries. New private Storage upload/signed download passes. Signup mail points to the public Auth route; clicking it enables password login. Anonymous private-Edge denial and seed-users blocking pass. Local Mailpit only. |
| Jobs | Owned scheduled audit completed/persisted/rescheduled; ordinary dispatcher cannot run another owner's due job. Real Chromium Form Executor passed a **two-step** authored assertion. Explicit dispatch tested, not production cron. |
| Worker crash | Real SIGKILL during claim recovered six current pages without saved NLP-partial after repair. Separate PostgreSQL probe proves live renewal and stale-owner publication rejection. |
| Restart | Dependency-ordered full stop/start passed. Restart artifact resumed after the completed interruption phase: **82.13 s** measures resumed checks/restart, not crash recovery. |
| Docker 20 | Actual frontend, CPU aggregator and Go scanner builds passed on isolated **20.10.24 / API 1.41 / Compose 5.1.3**, capped at 4 CPUs/8 GiB. Buildx **v0.17.1** required; bundled v0.10.4 failed. **217.26 s** build phase excludes setup/transfer. Not full old-engine runtime/capacity proof. |
| Providers | Gemini **3.5 Flash-Lite** answered a dummy prompt through Edge. Preserved Redmine key authenticated in read-only HTTP 200; no tickets created or imported context sent to AI for testing. |
| Memory | Final all-service snapshot **2.533 GiB** Docker working set. Local daemon: 8 CPUs/about 11.6 GiB. **Not peak memory or VPS headroom.** |
| Cleanup | **5.971 GB build cache reclaimed, cache 0 B**. Disposable compatibility container/volume/image and three obsolete images removed. Candidates/rollback images/source export/application volumes retained. No Windows VHD shrink claimed. |

Oct 6 final refresh: **23 owned containers running**, all containers with health
checks healthy. Rebuilt frontend login/report viewer checked in a real browser;
snapshot: `output/playwright/production-report-final.png`. After the final build,
**another 1.511 GB cache** was reclaimed; verified cache **0 B**, no dangling
images. These sequential cleanup totals are Docker-reported reclaimed bytes,
not Windows disk/VHD shrink measurements. See `production-final-cleanup.json`.
Credential-bearing browser snapshots remain in the private runtime.

## Corrections driven by tests

1. Auth v2.196.0 lacked four newer Cloud MFA/SCIM tables. First transaction
   rolled back; **v2.197.0** supplies official migrations. No tables skipped;
   all four are empty in this source snapshot.
2. Export omitted the application trigger on managed `auth.users`. The function
   existed, but new users lacked profiles. Migration
   `20261005020000_restore_auth_profile_trigger.sql` reattaches it idempotently.
3. Explicit Cloud API-role RPC grants survived older PUBLIC-only revocations.
   `20261005030000_service_rpc_permissions.sql` restores service-only access
   on the explicitly identified RPCs.
4. Removing fixed names lost Realtime's gateway DNS/tenant name. Project-local
   alias `realtime-dev.supabase-realtime` restores routing.
5. **300-second abandoned NLP claims raced the 300-second aggregation wait**,
   saving a partial report before eventual page recovery. Claims now expire in
   **90 seconds**, renewed every **30 seconds** during live work in a separate
   short transaction. Revision/token guards remain; stale owners cannot renew
   or publish. DB connect timeout is five seconds.
6. Simultaneous `compose restart` reproduced an Auth migration startup race
   while PG restarted. Stop dependent stacks first, then start Supabase and
   SnapFlow with dependency health checks; never reset their data or restart
   host Docker as part of this workflow.
7. Scheduled dispatcher verifies callers and scopes ordinary users to their
   own schedules. Internal activity calls use the service key instead of anon.
8. Assistant identity comes from the verified session; body impersonation is
   rejected. Empty assignments no longer allow unrestricted audit queries;
   ordinary users' schedule context is scoped.
9. Retired Gemini 2.0 defaults and the preserved key's actual **2.5 HTTP 404**
   were repaired with tested **3.5 Flash-Lite** for auxiliary AI. Overrides are
   supported; chat fallback is 3.8 Flash, whose full outputs/accuracy are not
   rated here. **Packaged audit NLP defaults stay unchanged.**

10. Realtime socket acknowledgement is not PostgreSQL subscription readiness.
    On the Oct 6 cold test, socket join was **73 ms**, database readiness
    **2,209 ms**, and the single event arrived at **2,692 ms** from connection
    start. The earlier test inserted during this gap and timed out. The probe
    now waits for the producer's `system` message with
    `extension=postgres_changes, status=ok`, without sleeps or INSERT retries.
    A warm repeat joined at **40 ms**, was ready at **64 ms**, and delivered at
    **613 ms**. These are two local observations, not latency percentiles.
    The frontend reads a new notification snapshot at database readiness,
    including reconnect, so rows written during the handshake are included.
    Older responses cannot overwrite newer snapshots; logout clears old rows.
    Three focused regression tests pass. The corrected frontend image builds.

The notification probe separately matches a preselected marker because events
can precede INSERT responses. Both fixes address observed timing problems;
neither proves that a change stream replays events from before subscription.
See the pinned [Realtime channel implementation](https://github.com/supabase/realtime/blob/v2.134.10/lib/realtime_web/channels/realtime_channel.ex).

## Repeat commands

These assume the accepted private runtime/network/images. A fresh installation
must start Supabase, decrypt/restore once, then run `prepare` **before workers**.
Preparation applies destination migrations, disables local imported schedules
and refuses an uninspected pending executor queue. Do not reset after import.

```powershell
$runtime = 'C:\Users\DELL\AppData\Local\SnapFlow\production-rehearsal'
python deploy/production/rehearse.py configure --runtime $runtime
python deploy/production/rehearse.py restore --runtime $runtime
python deploy/production/rehearse.py prepare --runtime $runtime
python deploy/production/rehearse.py compose --runtime $runtime --stack supabase -- up -d --wait --wait-timeout 240
python deploy/production/rehearse.py compose --runtime $runtime --stack snapflow -- up -d --wait --wait-timeout 240
python deploy/production/rehearse.py compose --runtime $runtime --stack snapflow -- --profile fixture up -d fixture
$env:SNAPFLOW_RUNTIME = $runtime
node Front-Snap/scripts/probe-production-platform.mjs
node Front-Snap/scripts/probe-production-jobs.mjs
```

`probe_production_restart.py $runtime` starts another six-page audit, kills an
active claim and verifies ordered restart. Optional second argument resumes an
already recovered scan; that mode is not a fresh crash test. The engine-20 probe
requires a separately created disposable daemon and verified Compose binary;
never aim it at VPS Docker. That environment was removed after proof.

## Remaining VPS acceptance

- Refresh exact ownership/protected Wetty/vhost configuration before scoped
  cleanup; ensure compatible client Buildx for sequential VPS builds.
- Repair both Apache ACME routes/expired shared certificate; preserve both
  SANs and terminal routing. Local HTTP challenge positive/404 tests are not
  public TLS/renewal proof. Wetty and VPS Docker were untouched.
- Configure real SMTP and verify delivery. Install destination cron/Vault
  deliberately; local imported schedules/cron launch remain disabled. Groq and
  original Cloud 2Captcha credentials remain unresolved. Redmine password
  login/ticket creation were not exercised.
- Test actual **4 cores/8 GB** with both databases/Wetty: 150/300/500-page peaks,
  duration, responsiveness and current evidence; provisional **1 GiB host
  available-memory** gate still applies.
- Finish Obscura/Chromium recovery and independently labeled KPI tests before
  promotions. **No 500-page or semantic NLP promotion** follows from this test.

Evidence: `output/capacity-study/production-*.json`: auth, platform (plus cold/warm), audit,
evidence, jobs, heartbeat, restart, engine20, ai-provider, redmine-provider,
cleanup, rehearsal-manifest, and owned fixture reports. Sensitive logs/SQL/keys
remain private, outside repository artifacts.

Sources: [Supabase restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform),
[Auth v2.197.0](https://github.com/supabase/auth/releases/tag/v2.197.0),
[Gemini models](https://ai.google.dev/gemini-api/docs/models).
