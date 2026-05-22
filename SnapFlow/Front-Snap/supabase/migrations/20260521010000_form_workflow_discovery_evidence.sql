-- Add discovery/evidence state for Obscura-assisted Form Tester workflows.
-- Existing data is preserved; this only widens status vocabularies and adds
-- JSON evidence columns used by Edge Functions and the UI.

ALTER TABLE public.form_workflows
  ADD COLUMN IF NOT EXISTS detection_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS confidence TEXT NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
  ADD COLUMN IF NOT EXISTS detection_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.workflow_results
  ADD COLUMN IF NOT EXISTS step_trace JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS final_url TEXT,
  ADD COLUMN IF NOT EXISTS network_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS execution_source TEXT NOT NULL DEFAULT 'chromium';

ALTER TABLE public.form_workflows
  DROP CONSTRAINT IF EXISTS form_workflows_status_check,
  DROP CONSTRAINT IF EXISTS form_workflows_confidence_check;

ALTER TABLE public.form_workflows
  ADD CONSTRAINT form_workflows_status_check
    CHECK (status IN ('draft', 'needs_review', 'pending', 'approved', 'executed', 'blocked')),
  ADD CONSTRAINT form_workflows_confidence_check
    CHECK (confidence IN ('high', 'medium', 'low'));

ALTER TABLE public.workflow_results
  DROP CONSTRAINT IF EXISTS workflow_results_status_check,
  DROP CONSTRAINT IF EXISTS workflow_results_execution_source_check;

ALTER TABLE public.workflow_results
  ADD CONSTRAINT workflow_results_status_check
    CHECK (status IN ('pass', 'fail', 'error', 'blocked', 'needs_review')),
  ADD CONSTRAINT workflow_results_execution_source_check
    CHECK (execution_source = 'chromium');

COMMENT ON COLUMN public.form_workflows.detection_sources IS
  'Discovery sources used to generate the workflow: static, obscura_rendered, chromium_confirmed.';
COMMENT ON COLUMN public.form_workflows.detection_evidence IS
  'Client-safe detection summary: fields, forms, route hints, candidate messages, and confirmation notes.';
COMMENT ON COLUMN public.workflow_results.step_trace IS
  'Ordered execution trace. Live evidence must come from Chromium execution, never discovery extraction.';
