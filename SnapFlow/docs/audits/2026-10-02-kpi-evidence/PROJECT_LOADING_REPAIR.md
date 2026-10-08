# Focused project loading repair

User selected the focused repair first; implementation authorized. Updated 2026-10-08.

## Scope and decisions

- Prioritize `/app/projects`, project details and project audit lists; improve the report list through the same summary query.
- Return compact audit metadata and current calculated scores instead of historical report bodies. Preserve latest-completed preference, archived history, score semantics and report fields.
- Compute summaries on read with an RLS-preserving RPC; no summary table, backfill or report rewrite.
- Retain the existing mapper for legacy/unmapped reports. Fetch only the relevant legacy report on demand to preserve its exact score; document that compatibility cost.
- Reuse user-scoped queries (30-second freshness) and share concurrent Redmine detail requests. Invalidate after mutations and small-table realtime changes; clear caches on account changes. Audit summaries refresh every 30 seconds while visible; do not stream report bodies for cache invalidation.
- Keep live Redmine freshness. Fetch project/membership data concurrently and reuse the project response; available local fields render independently.
- Maintain the existing VPS, separate databases, Wetty and scan settings. This repair changes no NLP/KPI verdicts.

## Validation

Compare compact scores against the current frontend calculation, including null reports, mapped category counts, axis-status fallback, unmeasured findings and legacy reports. Exercise latest-audit selection, RLS isolation, mutation invalidation, concurrent-request sharing, cancellation and lazy comparison loading. Run affected frontend tests/build and deployment helper tests. Measure compact/full payloads and cold/repeat loads separately. Authenticated VPS timings remain pending until a signed-in session is available; no speed percentage is assumed.

## Rollout

Apply the idempotent summary migration before deploying the frontend. Refresh the changed Edge function code without touching Wetty or resetting databases. Retain rollback images; remove unused build cache after builds/tests. Confirm public login, projects, archive/edit/compare/report reload behavior and resource use on the VPS before expanding this pattern to other screens.

## Implemented and measured locally (2026-10-08)

- `AdminProjects`, `ReportsPage` and `ProjectAudits` use the compact, paginated `get_audit_list` RPC. Project lists select the latest completed report when present, otherwise the latest audit; archived completed reports retain their previous selection behavior.
- Full reports are fetched only for a relevant legacy summary, a chosen comparison or the existing report viewer. Comparison fetches match `updated_at`; stale metadata produces a visible error and retry refreshes the revision first.
- Project/client information uses one joined request and renders independently of Redmine. Duplicate session-role requests share a query; tests cover account changes, logout and slow previous-account results.
- Redmine detail reuses its project response and starts membership lookup concurrently (two external requests instead of three serial requests). Frontend callers share overlapping reads within one user; later visits still request live data.
- The imported database published only notifications/workflow events. The idempotent migration adds seven small project-related tables to its existing publication. Audit bodies remain outside the new listener. Reconnect refresh and event batching prevent repeated initial reads.
- The existing admin Redmine import was missing required `client_id`. It now assigns the established holding client, matching manual creation.

| Check | Result |
|---|---|
| Existing local imported reports | 48 total; 47 mapped reports compared against the actual frontend calculator, zero score/axis-count mismatches; one legacy report retains the existing mapper |
| Old projects audit query, serialized JSON | 33,628,123 bytes across all 48 records |
| Compact latest summaries | 7,157 bytes, 16 selected records |
| Selected legacy fallback | One additional report, 222,106 bytes |
| Combined summary/legacy data | Approximately 229 KB rather than 33.6 MB; about 99.3% less serialized data for this local snapshot |
| Synthetic score cases / migration | Ten cases passed; migration executed twice in a rollback transaction |
| Access checks | Assigned user sees only assigned project; unassigned user sees none; admin sees both fixtures; anonymous RPC execution denied; function remains security invoker |
| Deployment orchestration | Twenty mocked tests passed, including frontend-only build, migration-before-activation, active-work refusal, rollback and cache cleanup |
| Final frontend suite | 250 passed, one live test skipped, 47 test files; includes lazy comparison, pending Redmine, cache invalidation, legacy revision retry and account isolation |
| Final production build | Passed; existing CSS import-order, old Browserslist data and bundle-size warnings remain |
| Post-test Docker cleanup | Unused builder cache and dangling-image prune completed; build cache 0 B; tagged images, containers and data volumes retained |

These byte counts are uncompressed PostgreSQL JSON serialization, not measured HTTP transfer or page-load times. The local rehearsal includes earlier test records and differs from the VPS. A fresh visit still loads the existing JS bundle and makes metadata requests. Larger histories, realtime access, Redmine latency and server query cost need production observation; no scan/model/default changes were made.

The full repository TypeScript check still reports errors in unrelated activity/PDF/form-tester code and test Node typings; the modified application files had no diagnostics on the last check. Build success is separate from a clean global typecheck.

## Incremental VPS command

Run from Wetty after fetching this release, while no audits or workflows are active:

```bash
cd "$HOME/snapflowv2.medianet.tn/SnapFlow/SnapFlow"
git pull --ff-only origin main
bash V3-Microservices/run-all.sh --vps --action app-update
bash V3-Microservices/run-all.sh --vps --action status
```

`app-update` reuses the existing private configuration and destination keys. It builds only the frontend, applies the summary/publication migration transactionally and recreates only functions/frontend with `--no-deps`. It retains the previous frontend image and changed function files for rollback, attempts automatic restoration on activation failure, cleans unused build cache in `finally` and verifies Wetty runtime invariance. It does not call the preparation action that disables schedules, rerun import or alter Apache. Docker health is not authenticated acceptance.

After deployment, hard-refresh once to load the new bundle. Check first/repeat visits to projects and a project, score/date filters, logo updates, archive/delete, a two-report comparison and the full report viewer. Compare an admin and an assigned/read-only user, then switch/logout accounts. Measure time until the project list appears separately from optional Redmine completion; capture timings without sharing tokens or request bodies. This public acceptance remains pending.
