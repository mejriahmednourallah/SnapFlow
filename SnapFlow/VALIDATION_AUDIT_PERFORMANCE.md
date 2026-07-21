# SnapFlow Audit Performance Benchmark

This file is generated from real API calls against `http://127.0.0.1:8080` and project URLs from `Supabase`.

Important: `nlp_processing_proxy_seconds` is measured from the first observed `nlp_processing` status until terminal status. It is a polling-based proxy, not a database-internal per-page NLP timer. Internal scanner phase timings are exported in the CSV when `scan_telemetry.phase_timings_ms` is present.

PDF timing is included only when `-PdfCommand` is provided. Otherwise the column is intentionally empty.

## Summary

| Metric | Value |
|---|---:|
| generated_at | 2026-07-19T18:58:13 |
| source | Supabase |
| target_count | 19 |
| completed_count | 19 |
| failed_or_timeout_count | 0 |
| max_pages | 10 |
| health_probe_ok | 5/5 |
| avg_health_response_ms | 6.28 |
| avg_audit_duration_seconds | 23.56 |
| avg_pages_scanned | 3.16 |
| avg_pages_per_second | 0.16 |
| avg_nlp_processing_proxy_seconds | 7.6 |
| avg_result_fetch_ms | 10644.22 |
| avg_kpis_top_ms | 359.47 |
| avg_pdf_generation_seconds |  |

## Per-Project Results

| Site | URL | Status | Pages | Duration (s) | Pages/s | NLP proxy (s) | Result API (ms) | KPI API (ms) | PDF (s) | Scan ID |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| BCEAO Snapflow | https://maintenance.medianet.tn/projects/bceao-snapflow | complete | 3 | 15.34 | 0.1956 | 3.03 | 10799.74 | 275.51 |  | scan_96b1143b5e22 |
| Carzmen | https://maintenance.medianet.tn/projects/carzmen | complete | 3 | 15.46 | 0.194 | 6.22 | 9730.29 | 774.86 |  | scan_d7e0eba6f01a |
| Maklada | https://maintenance.medianet.tn/projects/maklada | complete | 3 | 18.97 | 0.1581 | 6.24 | 8250.52 | 329.42 |  | scan_130d23dd41e8 |
| ANGED | https://maintenance.medianet.tn/projects/anged | complete | 3 | 21.79 | 0.1377 | 9.24 | 7762.91 | 298.8 |  | scan_49c2bc0deb83 |
| GéranceInformatique | https://maintenance.medianet.tn/projects/geranceinformatique | complete | 3 | 15.55 | 0.1929 | 6.1 | 8855.13 | 339.5 |  | scan_123144444424 |
| Cawtar | https://www.cawtar.org/ar | complete | 10 | 63.41 | 0.1577 | 25.46 | 22099.24 | 499.17 |  | scan_e6261d0b6a63 |
| Assurance HAYETT | https://www.hayett.tn/ | complete | 1 | 78.21 | 0.0128 | 15.58 | 17039.89 | 455.62 |  | scan_1b4059f98f1b |
| Lilas Protect | https://maintenance.medianet.tn/projects/lilas-protect | complete | 3 | 15.72 | 0.1908 | 3.2 | 11714.75 | 442.39 |  | scan_1d6667a65312 |
| Ecowapp | https://www.ecowapp.org/fr | complete | 1 | 16.11 | 0.0621 |  | 9448.09 | 415.73 |  | scan_93fbe0062ec3 |
| Infogérance USGC | https://maintenance.medianet.tn/projects/infogerance-usgc | complete | 3 | 25.07 | 0.1197 | 9.31 | 9445.19 | 526.67 |  | scan_dc8e66f01f24 |
| Transformation Digital Solution | https://maintenance.medianet.tn/projects/transformation-digital-solution | complete | 3 | 22.2 | 0.1351 | 6.2 | 11100.34 | 278.7 |  | scan_031b32f9862a |
| BIAT FONDATION | https://maintenance.medianet.tn/projects/biat-fondation | complete | 3 | 21.82 | 0.1375 | 9.25 | 21883.45 | 293.19 |  | scan_3332f50f90f4 |
| BIAT Corporate | https://maintenance.medianet.tn/projects/biat-corporate | complete | 3 | 18.47 | 0.1624 | 6.09 | 5831.14 | 163.43 |  | scan_71481601bbe7 |
| Discovery Informatique | https://maintenance.medianet.tn/projects/discovery-informatique | complete | 3 | 15.55 | 0.1929 | 3.07 | 8742.75 | 272.39 |  | scan_363da5861529 |
| Medinahotelsandresorts | https://maintenance.medianet.tn/projects/medinahotelsandresorts | complete | 3 | 15.58 | 0.1926 | 6.24 | 9255.67 | 336.76 |  | scan_5e19176364b5 |
| Espace client Attijari Leasing | https://maintenance.medianet.tn/projects/espace-client-attijari-leasing | complete | 3 | 22.04 | 0.1361 | 6.26 | 9958.6 | 273.02 |  | scan_66e7fdf4d465 |
| Attijari Leasing | https://maintenance.medianet.tn/projects/attijari-leasing | complete | 3 | 15.49 | 0.1937 | 6.12 | 7028.75 | 194.29 |  | scan_0a606d0998b7 |
| MAGIC HOTELS & RESORTS | https://maintenance.medianet.tn/projects/magic-hotels-resorts | complete | 3 | 15.27 | 0.1965 | 6.09 | 6357.95 | 373.15 |  | scan_26753bd91a2b |
| Miss Lilas | https://maintenance.medianet.tn/projects/miss-lilas | complete | 3 | 15.5 | 0.1935 | 3.07 | 6935.76 | 287.32 |  | scan_48853e7d202c |

CSV export: `VALIDATION_AUDIT_PERFORMANCE.csv`
