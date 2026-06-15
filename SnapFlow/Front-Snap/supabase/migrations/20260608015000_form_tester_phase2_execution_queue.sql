-- Form Tester V1 - Phase 2: queued executions, progressive results and controls.
-- Legacy workflow_results rows remain readable while new executions use the
-- queued/running/passed vocabulary.

ALTER TABLE public.workflow_results
  DROP CONSTRAINT IF EXISTS workflow_results_status_check,
  DROP CONSTRAINT IF EXISTS workflow_results_execution_source_check;

ALTER TABLE public.workflow_results
  ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS execution_engine TEXT NOT NULL DEFAULT 'chromium',
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS start_node_id UUID,
  ADD COLUMN IF NOT EXISTS current_node_id UUID,
  ADD COLUMN IF NOT EXISTS schedule_id UUID,
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS progress_completed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_total INTEGER NOT NULL DEFAULT 0;

UPDATE public.workflow_results
SET
  queued_at = COALESCE(queued_at, executed_at),
  started_at = COALESCE(started_at, executed_at),
  completed_at = COALESCE(completed_at, executed_at),
  requested_by = COALESCE(requested_by, executed_by),
  execution_engine = CASE
    WHEN execution_source = 'obscura' THEN 'obscura'
    WHEN execution_source = 'simulated_legacy' THEN 'simulated_legacy'
    ELSE 'chromium'
  END
WHERE queued_at IS NULL
   OR started_at IS NULL
   OR completed_at IS NULL
   OR requested_by IS NULL;

ALTER TABLE public.workflow_results
  ALTER COLUMN queued_at SET DEFAULT now();

ALTER TABLE public.workflow_results
  ADD CONSTRAINT workflow_results_status_check
    CHECK (
      status IN (
        'queued', 'running', 'stopping', 'passed', 'failed', 'error',
        'blocked', 'cancelled', 'pass', 'fail', 'needs_review'
      )
    ),
  ADD CONSTRAINT workflow_results_execution_source_check
    CHECK (
      execution_source IN (
        'pending_executor', 'chromium', 'obscura',
        'simulated_legacy', 'executor_unavailable'
      )
    ),
  ADD CONSTRAINT workflow_results_execution_mode_check
    CHECK (execution_mode IN ('full', 'step', 'from_step', 'scheduled')),
  ADD CONSTRAINT workflow_results_execution_engine_check
    CHECK (execution_engine IN ('chromium', 'obscura', 'simulated_legacy')),
  ADD CONSTRAINT workflow_results_progress_check
    CHECK (
      progress_completed >= 0
      AND progress_total >= 0
      AND progress_completed <= progress_total
    );

CREATE TABLE IF NOT EXISTS public.workflow_step_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES public.workflow_results(id) ON DELETE CASCADE,
  node_id UUID,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 0),
  step_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'passed', 'failed', 'error', 'blocked', 'cancelled', 'skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  input_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
  assertions JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (execution_id, sequence_number, retry_count)
);

CREATE TABLE IF NOT EXISTS public.workflow_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES public.workflow_results(id) ON DELETE CASCADE,
  step_result_id UUID REFERENCES public.workflow_step_results(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info'
    CHECK (level IN ('debug', 'info', 'warning', 'error')),
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workflow_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES public.workflow_results(id) ON DELETE CASCADE,
  step_result_id UUID REFERENCES public.workflow_step_results(id) ON DELETE SET NULL,
  artifact_type TEXT NOT NULL
    CHECK (
      artifact_type IN (
        'screenshot', 'html_snapshot', 'network_response',
        'uploaded_fixture', 'downloaded_file'
      )
    ),
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  redaction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (redaction_status IN ('pending', 'redacted', 'not_required', 'failed')),
  metadata_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workflow_execution_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES public.workflow_results(id) ON DELETE CASCADE,
  command TEXT NOT NULL CHECK (command IN ('stop', 'retry', 'run_step', 'run_from')),
  node_id UUID,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'rejected', 'failed')),
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_workflow_results_queue
  ON public.workflow_results(status, queued_at)
  WHERE status IN ('queued', 'running', 'stopping');
CREATE INDEX IF NOT EXISTS idx_workflow_step_results_execution
  ON public.workflow_step_results(execution_id, sequence_number, retry_count);
CREATE INDEX IF NOT EXISTS idx_workflow_logs_execution
  ON public.workflow_logs(execution_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_execution
  ON public.workflow_artifacts(execution_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_execution_commands_pending
  ON public.workflow_execution_commands(status, requested_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.form_test_redact_jsonb(value JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result JSONB;
BEGIN
  IF value IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(value) = 'object' THEN
    SELECT COALESCE(
      jsonb_object_agg(
        key,
        CASE
          WHEN key ~* '(password|passwd|secret|token|authorization|cookie|session|api[_-]?key|credential)'
            THEN to_jsonb('[REDACTED]'::TEXT)
          ELSE public.form_test_redact_jsonb(item_value)
        END
      ),
      '{}'::jsonb
    )
    INTO result
    FROM jsonb_each(value) AS item(key, item_value);
    RETURN result;
  END IF;

  IF jsonb_typeof(value) = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(public.form_test_redact_jsonb(item_value)),
      '[]'::jsonb
    )
    INTO result
    FROM jsonb_array_elements(value) AS item(item_value);
    RETURN result;
  END IF;

  RETURN value;
END;
$$;

CREATE OR REPLACE FUNCTION public.form_test_redact_text(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN value IS NULL THEN NULL
    ELSE regexp_replace(
      value,
      '(password|passwd|secret|token|authorization|cookie|session|api[_-]?key|credential)([[:space:]]*[:=][[:space:]]*)([^[:space:],;]+)',
      '\1\2[REDACTED]',
      'gi'
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.form_test_redact_execution_data()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'workflow_step_results' THEN
    NEW.input_redacted = public.form_test_redact_jsonb(NEW.input_redacted);
    NEW.output_redacted = public.form_test_redact_jsonb(NEW.output_redacted);
    NEW.assertions = public.form_test_redact_jsonb(NEW.assertions);
    NEW.error_message = public.form_test_redact_text(NEW.error_message);
  ELSIF TG_TABLE_NAME = 'workflow_logs' THEN
    NEW.message = public.form_test_redact_text(NEW.message);
    NEW.details_redacted = public.form_test_redact_jsonb(NEW.details_redacted);
  ELSIF TG_TABLE_NAME = 'workflow_artifacts' THEN
    NEW.metadata_redacted = public.form_test_redact_jsonb(NEW.metadata_redacted);
  ELSIF TG_TABLE_NAME = 'workflow_execution_commands' THEN
    NEW.payload_redacted = public.form_test_redact_jsonb(NEW.payload_redacted);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workflow_step_results_redact ON public.workflow_step_results;
CREATE TRIGGER trg_workflow_step_results_redact
  BEFORE INSERT OR UPDATE ON public.workflow_step_results
  FOR EACH ROW EXECUTE FUNCTION public.form_test_redact_execution_data();

DROP TRIGGER IF EXISTS trg_workflow_logs_redact ON public.workflow_logs;
CREATE TRIGGER trg_workflow_logs_redact
  BEFORE INSERT OR UPDATE ON public.workflow_logs
  FOR EACH ROW EXECUTE FUNCTION public.form_test_redact_execution_data();

DROP TRIGGER IF EXISTS trg_workflow_artifacts_redact ON public.workflow_artifacts;
CREATE TRIGGER trg_workflow_artifacts_redact
  BEFORE INSERT OR UPDATE ON public.workflow_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.form_test_redact_execution_data();

DROP TRIGGER IF EXISTS trg_workflow_execution_commands_redact ON public.workflow_execution_commands;
CREATE TRIGGER trg_workflow_execution_commands_redact
  BEFORE INSERT OR UPDATE ON public.workflow_execution_commands
  FOR EACH ROW EXECUTE FUNCTION public.form_test_redact_execution_data();

ALTER TABLE public.workflow_step_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_execution_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_step_results_select_accessible"
  ON public.workflow_step_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workflow_results result
      JOIN public.form_workflows workflow ON workflow.id = result.workflow_id
      WHERE result.id = workflow_step_results.execution_id
        AND (
          workflow.created_by = auth.uid()
          OR workflow.org_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

CREATE POLICY "workflow_logs_select_accessible"
  ON public.workflow_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workflow_results result
      JOIN public.form_workflows workflow ON workflow.id = result.workflow_id
      WHERE result.id = workflow_logs.execution_id
        AND (
          workflow.created_by = auth.uid()
          OR workflow.org_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

CREATE POLICY "workflow_artifacts_select_accessible"
  ON public.workflow_artifacts FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workflow_results result
      JOIN public.form_workflows workflow ON workflow.id = result.workflow_id
      WHERE result.id = workflow_artifacts.execution_id
        AND (
          workflow.created_by = auth.uid()
          OR workflow.org_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

CREATE POLICY "workflow_execution_commands_select_accessible"
  ON public.workflow_execution_commands FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workflow_results result
      JOIN public.form_workflows workflow ON workflow.id = result.workflow_id
      WHERE result.id = workflow_execution_commands.execution_id
        AND (
          workflow.created_by = auth.uid()
          OR workflow.org_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

DO $$
DECLARE
  requested_table TEXT;
BEGIN
  FOREACH requested_table IN ARRAY ARRAY[
    'workflow_results',
    'workflow_step_results',
    'workflow_logs',
    'workflow_artifacts',
    'workflow_execution_commands'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = requested_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', requested_table);
    END IF;
  END LOOP;
END;
$$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('form-test-artifacts', 'form-test-artifacts', false)
ON CONFLICT (id) DO UPDATE SET public = false;

COMMENT ON TABLE public.workflow_step_results IS
  'Progressive, redacted result for each node of a form-test execution.';
COMMENT ON TABLE public.workflow_logs IS
  'Redacted execution event stream exposed through Realtime and Edge APIs.';
COMMENT ON TABLE public.workflow_artifacts IS
  'Private execution artifacts. Clients receive short-lived signed URLs only.';
COMMENT ON TABLE public.workflow_execution_commands IS
  'User control commands consumed by the form executor in a later phase.';
