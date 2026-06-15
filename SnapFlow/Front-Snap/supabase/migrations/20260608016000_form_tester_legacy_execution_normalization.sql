-- Normalize historical Form Tester rows that predate execution provenance.

ALTER TABLE public.workflow_results
  DROP CONSTRAINT IF EXISTS workflow_results_execution_source_check;

UPDATE public.workflow_results
SET execution_source = 'simulated_legacy'
WHERE (
    execution_source IS NULL
    OR btrim(execution_source) = ''
    OR execution_source = 'chromium'
  )
  AND (
    network_summary @> '{"mode":"simulated"}'::jsonb
    OR step_trace::text LIKE '%"source":"simulated"%'
    OR step_trace::text LIKE '%"source": "simulated"%'
  );

UPDATE public.workflow_results
SET
  execution_source = 'executor_unavailable',
  failure_reason = COALESCE(failure_reason, 'legacy_executor_failure')
WHERE (
    execution_source IS NULL
    OR btrim(execution_source) = ''
    OR execution_source = 'chromium'
  )
  AND status = 'error'
  AND (
    network_summary @> '{"mode":"unavailable"}'::jsonb
    OR COALESCE(error_message, '') ~* '(executor|moteur|browser|chromium|obscura).*(indisponible|unavailable|failed|error)'
  );

UPDATE public.workflow_results
SET
  execution_source = 'legacy_unknown',
  failure_reason = COALESCE(failure_reason, 'legacy_execution_without_provenance'),
  summary = COALESCE(summary, '{}'::jsonb) || jsonb_build_object(
    'legacy_normalization',
    'Execution historique sans preuve permettant d identifier le moteur.'
  )
WHERE (
    execution_source IS NULL
    OR btrim(execution_source) = ''
    OR (
      execution_source = 'chromium'
      AND status = 'error'
      AND final_url IS NULL
      AND screenshot_url IS NULL
      AND COALESCE(jsonb_array_length(assertions), 0) = 0
      AND COALESCE(jsonb_array_length(step_trace), 0) = 0
      AND COALESCE(network_summary, '{}'::jsonb) = '{}'::jsonb
    )
  );

ALTER TABLE public.workflow_results
  ALTER COLUMN execution_source SET DEFAULT 'pending_executor',
  ALTER COLUMN execution_source SET NOT NULL;

ALTER TABLE public.workflow_results
  ADD CONSTRAINT workflow_results_execution_source_check
    CHECK (
      execution_source IN (
        'pending_executor', 'chromium', 'obscura', 'simulated_legacy',
        'executor_unavailable', 'legacy_unknown'
      )
    );

COMMENT ON COLUMN public.workflow_results.execution_source IS
  'Execution provenance. legacy_unknown is reserved for historical rows that contain no trustworthy engine evidence.';
