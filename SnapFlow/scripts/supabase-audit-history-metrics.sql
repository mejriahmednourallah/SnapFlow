-- SnapFlow validation metrics: historical audit extraction.
--
-- Run against the Supabase product database, preferably cloud/preprod.
-- The elapsed value is product-level audit record duration
-- (updated_at - created_at). It is not an internal scanner/NLP/KPI phase
-- duration unless those phase timings are also present in report_data.

SELECT
  id,
  status,
  job_id,
  report_data->>'scanId' AS scan_id,
  report_data->>'url' AS url,
  report_data->>'siteName' AS site_name,
  report_data->'summary' AS summary,
  report_data->>'globalScore' AS global_score,
  EXTRACT(EPOCH FROM (updated_at - created_at))::int AS audit_elapsed_seconds,
  created_at,
  updated_at
FROM audits
WHERE status = 'completed'
  AND report_data IS NOT NULL
ORDER BY updated_at DESC;
