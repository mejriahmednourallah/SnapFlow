-- Phase 0 Form Tester hardening:
-- Do not label simulated legacy executions as real Chromium browser runs.

ALTER TABLE public.workflow_results
  DROP CONSTRAINT IF EXISTS workflow_results_execution_source_check;

UPDATE public.workflow_results
SET execution_source = 'simulated_legacy'
WHERE execution_source = 'chromium'
  AND (
    network_summary @> '{"mode":"simulated"}'::jsonb
    OR step_trace::text LIKE '%"source":"simulated"%'
    OR step_trace::text LIKE '%"source": "simulated"%'
  );

UPDATE public.workflow_results
SET execution_source = 'executor_unavailable'
WHERE execution_source = 'chromium'
  AND network_summary @> '{"mode":"unavailable"}'::jsonb;

ALTER TABLE public.workflow_results
  ALTER COLUMN execution_source SET DEFAULT 'simulated_legacy';

ALTER TABLE public.workflow_results
  ADD CONSTRAINT workflow_results_execution_source_check
    CHECK (execution_source IN ('chromium', 'obscura', 'simulated_legacy', 'executor_unavailable'));

COMMENT ON COLUMN public.workflow_results.execution_source IS
  'chromium/obscura are real browser executions. simulated_legacy is historical simulation. executor_unavailable means the real engine could not run.';
