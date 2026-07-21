# SnapFlow Validation Metrics Results

Generated: 2026-07-19T12:40:26

Source policy: command output, local Supabase SQL, optional benchmark API polling. Values that cannot be measured are reported as unavailable.

## Environment

| Item | Value |
|---|---|
| Repository | C:\Users\DELL\OneDrive - Ministere de l'Enseignement Superieur et de la Recherche Scientifique\Desktop\New folder (8)\SnapFlow |
| GitHub CLI | not available on PATH |
| Docker | available |

## Supabase Historical Audit Evidence

This query uses product-level audit timestamps. It does not prove internal scanner/NLP/KPI phase durations unless those fields exist in the report payload or audit evidence database.

```text
id                  |  status   |      job_id       |      scan_id      |           url           | site_name |                                                       summary                                                        | audit_elapsed_seconds |          created_at           |         updated_at         
--------------------------------------+-----------+-------------------+-------------------+-------------------------+-----------+----------------------------------------------------------------------------------------------------------------------+-----------------------+-------------------------------+----------------------------
 02685031-0e8c-4b84-87e3-f4e775b2cc48 | completed | scan_f9c9d1fc895f | scan_f9c9d1fc895f | https://www.cb-umoa.org | SGCB-UMOA | {"low": 10, "bugs": 8, "high": 11, "total": 64, "medium": 12, "critical": 1, "compliance": 8, "recommendations": 18} |                  1083 | 2026-06-15 13:32:04.497559+00 | 2026-06-15 13:50:07.518+00
(1 row)
```

## Frontend Test Output

Exit code: 1, elapsed seconds: 69.13

```text
> vite_react_shadcn_ts@0.0.0 test
> vitest run


[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mC:/Users/DELL/OneDrive - Ministere de l'Enseignement Superieur et de la Recherche Scientifique/Desktop/New folder (8)/SnapFlow/Front-Snap[39m

 [32mÔ£ô[39m src/test/perimeterTerminology.test.ts [2m([22m[2m2 tests[22m[2m)[22m[33m 861[2mms[22m[39m
   [33m[2mÔ£ô[22m[39m ticket 6 perimeter terminology[2m > [22mdoes not expose legacy sous-domaines wording in frontend source [33m 852[2mms[22m[39m
[90mstdout[2m | src/test/auditMapper.axis.test.ts[2m > [22m[2mAxis Mapping[2m > [22m[2mStructured payload dedupe[2m > [22m[2mdoes not inject duplicate legacy rows for a KPI already present in structured kpis
[22m[39m[auditMapper] KPI "SSL" mapped: "Security" ÔåÆ SECURITY

 [32mÔ£ô[39m src/test/auditMapper.axis.test.ts [2m([22m[2m22 tests[22m[2m)[22m[32m 298[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterLiveExecutionPanel.test.tsx [2m([22m[2m1 test[22m[2m)[22m[33m 340[2mms[22m[39m
   [33m[2mÔ£ô[22m[39m LiveExecutionPanel[2m > [22mshows progress, latest signed screenshot and recent logs [33m 333[2mms[22m[39m
 [32mÔ£ô[39m src/test/clientLogoSidebar.test.tsx [2m([22m[2m2 tests[22m[2m)[22m[33m 1485[2mms[22m[39m
   [33m[2mÔ£ô[22m[39m ClientLogoSidebar[2m > [22msaves a manual logo URL and updates the parent after persistence [33m 769[2mms[22m[39m
   [33m[2mÔ£ô[22m[39m ClientLogoSidebar[2m > [22mshows a detected logo as a suggestion without overwriting the saved field [33m 711[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterFieldConfigPanel.test.tsx [2m([22m[2m2 tests[22m[2m)[22m[33m 872[2mms[22m[39m
   [33m[2mÔ£ô[22m[39m FieldConfigPanel[2m > [22mdoes not block manual entry for fields masked in logs [33m 523[2mms[22m[39m
   [33m[2mÔ£ô[22m[39m FieldConfigPanel[2m > [22mrenders checkbox fields as controllable checklist values [33m 339[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterExecutionResults.test.tsx [2m([22m[2m10 tests[22m[2m)[22m[33m 1299[2mms[22m[39m
   [33m[2mÔ£ô[22m[39m ExecutionResults[2m > [22mshows simulated legacy executions as non-real browser runs [33m 403[2mms[22m[39m
 [32mÔ£ô[39m src/test/auditDetailsCsvEvidenceCleanup.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 12[2mms[22m[39m
 [32mÔ£ô[39m src/test/projectSync.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 58[2mms[22m[39m
 [32mÔ£ô[39m src/test/activityPdfContract.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 20[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterBuilderContract.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 33[2mms[22m[39m
 [32mÔ£ô[39m src/test/auditPdfData.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 42[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterExecutionSourceContract.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 17[2mms[22m[39m
 [32mÔ£ô[39m src/test/siteLogoResolver.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 33[2mms[22m[39m
 [31mÔØ»[39m src/test/activityPdfRender.test.tsx [2m([22m[2m1 test[22m[2m | [22m[31m1 failed[39m[2m)[22m[33m 15062[2mms[22m[39m
[31m   [31m├ù[31m activity PDF render smoke test[2m > [22mrenders a PDF blob when optional contact fields are empty[39m[33m 15058[2mms[22m[39m
[31m     ÔåÆ Test timed out in 15000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".[39m
 [32mÔ£ô[39m src/test/formTesterCampaignContract.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 22[2mms[22m[39m
 [32mÔ£ô[39m src/test/ecoWording.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 39[2mms[22m[39m
 [32mÔ£ô[39m src/test/activityMeeting.test.ts [2m([22m[2m15 tests[22m[2m)[22m[32m 28[2mms[22m[39m
 [32mÔ£ô[39m src/test/remainingTicketsImplementation.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 25[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterPhase2Contract.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 15[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterSchedulingPersistenceContract.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 17[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTestSuite.unit.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 22[2mms[22m[39m
 [32mÔ£ô[39m src/test/projectUrls.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 22[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterExecutionNormalization.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 23[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterBranchingContract.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 15[2mms[22m[39m
 [32mÔ£ô[39m src/test/dateFormat.test.ts [2m([22m[2m15 tests[22m[2m)[22m[32m 34[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterScenarioVersionContract.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 33[2mms[22m[39m
 [32mÔ£ô[39m src/test/clientsProjectGrouping.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 18[2mms[22m[39m
 [32mÔ£ô[39m src/test/rgpdWording.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 12[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterTechnicalFieldContract.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 25[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterStatusLabels.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 9[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterAiBranchingV2.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 15[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterArtifactContract.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 19[2mms[22m[39m
 [32mÔ£ô[39m src/test/siteLogoPdfContract.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 15[2mms[22m[39m
 [32mÔ£ô[39m src/test/activityReportScoreRemoval.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 15[2mms[22m[39m
 [32mÔ£ô[39m src/test/remainingTicketsCleanup.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 13[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterBusinessCampaign.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 14[2mms[22m[39m
 [32mÔ£ô[39m src/test/workflowProjectLink.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 12[2mms[22m[39m
 [32mÔ£ô[39m src/test/activityPdfBrandingSettings.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 15[2mms[22m[39m
 [32mÔ£ô[39m src/test/formTesterSuggestionContract.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 16[2mms[22m[39m
 [32mÔ£ô[39m src/test/example.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 9[2mms[22m[39m
 [2m[90mÔåô[39m[22m src/test/projectSync.live.test.ts [2m([22m[2m1 test[22m[2m | [22m[33m1 skipped[39m[2m)[22m
npm.cmd : 
At C:\Users\DELL\OneDrive - Ministere de l'Enseignement Superieur et de la Recherche Scientifique\Desktop\New folder 
(8)\SnapFlow\scripts\collect-validation-metrics.ps1:65 char:15
+     $output = & $FilePath @Arguments 2>&1
+               ~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
[31mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[39m[1m[41m Failed Tests 1 [49m[22m[31mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[39m

[41m[1m FAIL [22m[49m src/test/activityPdfRender.test.tsx[2m > [22mactivity PDF render smoke test[2m > 
[22mrenders a PDF blob when optional contact fields are empty
[31m[1mError[22m: Test timed out in 15000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with 
"testTimeout".[39m
[36m [2mÔØ»[22m src/test/activityPdfRender.test.tsx:[2m111:3[22m[39m
    [90m109| [39m
    [90m110| [39m[34mdescribe[39m([32m'activity PDF render smoke test'[39m[33m,[39m () [33m=>[39m {
    [90m111| [39m  it('renders a PDF blob when optional contact fields are empty', asynÔÇª
    [90m   | [39m  [31m^[39m
    [90m112| [39m    [35mconst[39m issues [33m=[39m [
    [90m113| [39m      [34missue[39m([34m1[39m[33m,[39m [32m'Cloture'[39m[33m,[39m 
[32m'Webmastering'[39m[33m,[39m [32m'Normale'[39m)[33m,[39m

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[1/1]ÔÄ»[22m[39m


[2m Test Files [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m39 passed[39m[22m[2m | [22m[33m1 skipped[39m[90m (41)[39m
[2m      Tests [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m221 passed[39m[22m[2m | [22m[33m1 skipped[39m[90m (223)[39m
[2m   Start at [22m 12:40:32
[2m   Duration [22m 64.65s[2m (transform 5.38s, setup 37.89s, collect 46.82s, tests 20.93s, environment 197.37s, prepare 66.17s)[22m

npm notice
npm notice New major version of npm available! 10.8.2 -> 12.0.1
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.0.1
npm notice To update run: npm install -g npm@12.0.1
npm notice
```

## Scanner Go Test Output

Exit code: 0, elapsed seconds: 60.86

```text
ok  	snapflow/v3-scanner-go	0.437s
ok  	snapflow/v3-scanner-go/analyzers/browserutil	(cached)
?   	snapflow/v3-scanner-go/analyzers/formbrowser	[no test files]
ok  	snapflow/v3-scanner-go/analyzers/formfuzzer	(cached)
ok  	snapflow/v3-scanner-go/analyzers/functional	(cached)
ok  	snapflow/v3-scanner-go/analyzers/performance	(cached)
?   	snapflow/v3-scanner-go/analyzers/privacy	[no test files]
ok  	snapflow/v3-scanner-go/analyzers/security	(cached)
ok  	snapflow/v3-scanner-go/analyzers/seo	1.750s
ok  	snapflow/v3-scanner-go/analyzers/tech	(cached)
ok  	snapflow/v3-scanner-go/analyzers/ux	1.916s
ok  	snapflow/v3-scanner-go/browserpool	(cached)
?   	snapflow/v3-scanner-go/cmd/functest	[no test files]
?   	snapflow/v3-scanner-go/cmd/imgtest	[no test files]
?   	snapflow/v3-scanner-go/cmd/ktest	[no test files]
?   	snapflow/v3-scanner-go/cmd/linktest	[no test files]
?   	snapflow/v3-scanner-go/cmd/mobiletest	[no test files]
?   	snapflow/v3-scanner-go/cmd/perftest	[no test files]
?   	snapflow/v3-scanner-go/cmd/privtest	[no test files]
?   	snapflow/v3-scanner-go/cmd/sectest	[no test files]
?   	snapflow/v3-scanner-go/cmd/seotest	[no test files]
?   	snapflow/v3-scanner-go/cmd/techtest	[no test files]
?   	snapflow/v3-scanner-go/cmd/uxtest	[no test files]
ok  	snapflow/v3-scanner-go/db	(cached)
```

## CLI Test Output

Exit code: 0, elapsed seconds: 170.55

```text
?   	github.com/snapflow/v3-cli	[no test files]
?   	github.com/snapflow/v3-cli/cmd	[no test files]
ok  	github.com/snapflow/v3-cli/internal/api	0.150s
ok  	github.com/snapflow/v3-cli/internal/config	0.111s
ok  	github.com/snapflow/v3-cli/internal/docker	0.139s
?   	github.com/snapflow/v3-cli/internal/pinggy	[no test files]
?   	github.com/snapflow/v3-cli/internal/state	[no test files]
?   	github.com/snapflow/v3-cli/locale	[no test files]
?   	github.com/snapflow/v3-cli/tui	[no test files]
?   	github.com/snapflow/v3-cli/tui/legacy	[no test files]
```

## Test Validation Table

| Service | Command | Tests collected | Passed | Failed | Coverage | Execution time (s) | Source |
|---|---|---:|---:|---:|---|---:|---|
| Frontend | `npm test` | 41 | 39 (1 skipped) | 1 | not measured | 69.13 | local command |
| Aggregator | `python -m pytest tests -q` | 110 | 110 | 0 | not measured | 5.91 | local command |
| NLP worker | `python -m pytest tests -q` | 72 | (1 skipped) | 0 | not measured | 5.74 | local command |
| Visual regression | `python -m pytest tests -q` |  |  | 0 | not measured | 3.49 | local command |
| Form executor | `python -m pytest tests -q` | 66 |  | 0 | not measured | 5.89 | local command |
| Scanner Go | `go test ./...` | 0 | packages passed | 0 | not measured | 60.86 | local command |
| CLI | `go test ./...` | 0 | packages passed | 0 | not measured | 170.55 | local command |

## Coverage Measurement Notes

Coverage was not run in this pass. Use -RunCoverage after adding/ensuring coverage tools are available. Do not report a percentage until generated by coverage output.

## Controlled Scan Benchmark

Benchmark not run in this pass. Start the audit services and rerun with -RunBenchmark to generate the 3-site timing table.

## Quality And Security Metrics

These commands produce the values needed for the quality/security table:

`ash
cd Front-Snap
npx tsc --noEmit
npm run lint
npm audit --audit-level=high
`

`ash
cd V3-Microservices/v3-scanner-go
govulncheck ./...
`

`ash
cd V3-Microservices
docker compose images
`

Use GitHub Actions artifacts for Trivy filesystem/image/config results when gh is available.
