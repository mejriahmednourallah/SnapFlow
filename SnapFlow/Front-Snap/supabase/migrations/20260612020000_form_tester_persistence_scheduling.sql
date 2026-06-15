-- Form Tester: atomic workflow creation and pinned-version scheduling.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.form_test_create_workflow(
  p_org_id UUID,
  p_created_by UUID,
  p_name TEXT,
  p_target_url TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created_workflow public.form_workflows;
  created_scenario public.form_test_scenarios;
BEGIN
  IF NULLIF(BTRIM(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Workflow name is required';
  END IF;
  IF NULLIF(BTRIM(p_target_url), '') IS NULL THEN
    RAISE EXCEPTION 'Workflow target URL is required';
  END IF;

  INSERT INTO public.form_workflows (
    org_id, created_by, name, target_url, status
  )
  VALUES (
    p_org_id, p_created_by, BTRIM(p_name), BTRIM(p_target_url), 'draft'
  )
  RETURNING * INTO created_workflow;

  INSERT INTO public.form_test_scenarios (
    workflow_id,
    org_id,
    created_by,
    name,
    description,
    status,
    is_default
  )
  VALUES (
    created_workflow.id,
    created_workflow.org_id,
    created_workflow.created_by,
    'Scenario principal',
    'Scenario principal pour ' || created_workflow.name,
    'draft',
    true
  )
  RETURNING * INTO created_scenario;

  RETURN jsonb_build_object(
    'workflow', to_jsonb(created_workflow),
    'scenario', to_jsonb(created_scenario)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.form_test_create_workflow(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_test_create_workflow(UUID, UUID, TEXT, TEXT) TO service_role;

CREATE TABLE IF NOT EXISTS public.workflow_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.form_workflows(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES public.form_test_scenarios(id) ON DELETE CASCADE,
  scenario_version_id UUID NOT NULL REFERENCES public.form_scenario_versions(id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  frequency TEXT NOT NULL
    CHECK (frequency IN ('once', 'daily', 'weekly', 'monthly')),
  timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
  start_at TIMESTAMPTZ NOT NULL,
  local_time TIME NOT NULL,
  day_of_week INTEGER CHECK (day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
  day_of_month INTEGER CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28),
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  environment TEXT NOT NULL DEFAULT 'default',
  overlap_policy TEXT NOT NULL DEFAULT 'queue'
    CHECK (overlap_policy = 'queue'),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at IS NULL OR end_at >= start_at),
  CHECK (frequency <> 'weekly' OR day_of_week IS NOT NULL),
  CHECK (frequency <> 'monthly' OR day_of_month IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.workflow_schedule_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES public.workflow_schedules(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  execution_id UUID REFERENCES public.workflow_results(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'dispatched', 'completed', 'error', 'skipped')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (schedule_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_workflow_schedules_due
  ON public.workflow_schedules(next_run_at)
  WHERE is_active AND next_run_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_schedules_workflow
  ON public.workflow_schedules(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_schedule_runs_schedule
  ON public.workflow_schedule_runs(schedule_id, scheduled_for DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workflow_results_schedule_id_fkey'
  ) THEN
    ALTER TABLE public.workflow_results
      ADD CONSTRAINT workflow_results_schedule_id_fkey
      FOREIGN KEY (schedule_id)
      REFERENCES public.workflow_schedules(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

ALTER TABLE public.workflow_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_schedule_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_schedules_select_owner_or_admin" ON public.workflow_schedules;
CREATE POLICY "workflow_schedules_select_owner_or_admin"
  ON public.workflow_schedules FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR org_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "workflow_schedules_insert_owner_or_admin" ON public.workflow_schedules;
CREATE POLICY "workflow_schedules_insert_owner_or_admin"
  ON public.workflow_schedules FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "workflow_schedules_update_owner_or_admin" ON public.workflow_schedules;
CREATE POLICY "workflow_schedules_update_owner_or_admin"
  ON public.workflow_schedules FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "workflow_schedules_delete_owner_or_admin" ON public.workflow_schedules;
CREATE POLICY "workflow_schedules_delete_owner_or_admin"
  ON public.workflow_schedules FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "workflow_schedule_runs_select_owner_or_admin" ON public.workflow_schedule_runs;
CREATE POLICY "workflow_schedule_runs_select_owner_or_admin"
  ON public.workflow_schedule_runs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workflow_schedules schedule
      WHERE schedule.id = workflow_schedule_runs.schedule_id
        AND (
          schedule.created_by = auth.uid()
          OR schedule.org_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

CREATE OR REPLACE FUNCTION public.form_test_schedule_next_run(
  p_frequency TEXT,
  p_timezone TEXT,
  p_start_at TIMESTAMPTZ,
  p_local_time TIME,
  p_day_of_week INTEGER,
  p_day_of_month INTEGER,
  p_after TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  after_local TIMESTAMP;
  start_local TIMESTAMP;
  candidate_local TIMESTAMP;
  candidate_date DATE;
  target_day INTEGER;
  attempts INTEGER := 0;
BEGIN
  IF p_frequency = 'once' THEN
    RETURN CASE WHEN p_start_at > p_after THEN p_start_at ELSE NULL END;
  END IF;

  after_local := p_after AT TIME ZONE p_timezone;
  start_local := p_start_at AT TIME ZONE p_timezone;
  candidate_date := GREATEST(after_local::date, start_local::date);

  IF p_frequency = 'daily' THEN
    candidate_local := candidate_date + p_local_time;
    IF candidate_local <= after_local OR candidate_local < start_local THEN
      candidate_local := (candidate_date + 1) + p_local_time;
    END IF;
  ELSIF p_frequency = 'weekly' THEN
    target_day := p_day_of_week;
    LOOP
      candidate_local := candidate_date + p_local_time;
      EXIT WHEN EXTRACT(DOW FROM candidate_date)::INTEGER = target_day
        AND candidate_local > after_local
        AND candidate_local >= start_local;
      candidate_date := candidate_date + 1;
      attempts := attempts + 1;
      IF attempts > 14 THEN
        RAISE EXCEPTION 'Unable to calculate weekly schedule';
      END IF;
    END LOOP;
  ELSIF p_frequency = 'monthly' THEN
    candidate_date := make_date(
      EXTRACT(YEAR FROM candidate_date)::INTEGER,
      EXTRACT(MONTH FROM candidate_date)::INTEGER,
      p_day_of_month
    );
    candidate_local := candidate_date + p_local_time;
    IF candidate_local <= after_local OR candidate_local < start_local THEN
      candidate_date := (
        date_trunc('month', candidate_date::timestamp) + interval '1 month'
      )::date;
      candidate_date := make_date(
        EXTRACT(YEAR FROM candidate_date)::INTEGER,
        EXTRACT(MONTH FROM candidate_date)::INTEGER,
        p_day_of_month
      );
      candidate_local := candidate_date + p_local_time;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported schedule frequency: %', p_frequency;
  END IF;

  RETURN candidate_local AT TIME ZONE p_timezone;
END;
$$;

CREATE OR REPLACE FUNCTION public.form_test_create_schedule(
  p_workflow_id UUID,
  p_scenario_id UUID,
  p_created_by UUID,
  p_name TEXT,
  p_frequency TEXT,
  p_timezone TEXT,
  p_start_at TIMESTAMPTZ,
  p_day_of_week INTEGER DEFAULT NULL,
  p_day_of_month INTEGER DEFAULT NULL,
  p_end_at TIMESTAMPTZ DEFAULT NULL,
  p_environment TEXT DEFAULT 'default'
)
RETURNS public.workflow_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  scenario_row public.form_test_scenarios;
  snapshot_payload JSONB;
  created_version public.form_scenario_versions;
  created_schedule public.workflow_schedules;
  next_version INTEGER;
  calculated_next_run TIMESTAMPTZ;
  safe_timezone TEXT;
BEGIN
  IF p_frequency NOT IN ('once', 'daily', 'weekly', 'monthly') THEN
    RAISE EXCEPTION 'Unsupported schedule frequency';
  END IF;
  IF p_frequency = 'weekly' AND (p_day_of_week IS NULL OR p_day_of_week NOT BETWEEN 0 AND 6) THEN
    RAISE EXCEPTION 'day_of_week is required for weekly schedules';
  END IF;
  IF p_frequency = 'monthly' AND (p_day_of_month IS NULL OR p_day_of_month NOT BETWEEN 1 AND 28) THEN
    RAISE EXCEPTION 'day_of_month is required for monthly schedules';
  END IF;

  safe_timezone := COALESCE(NULLIF(BTRIM(p_timezone), ''), 'Europe/Paris');
  PERFORM 1 FROM pg_timezone_names WHERE name = safe_timezone;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown timezone: %', safe_timezone;
  END IF;

  SELECT *
  INTO scenario_row
  FROM public.form_test_scenarios
  WHERE id = p_scenario_id
    AND workflow_id = p_workflow_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scenario not found for workflow';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_scenario_id::text, 0));
  snapshot_payload := public.form_test_build_scenario_snapshot(p_scenario_id);
  IF jsonb_array_length(COALESCE(snapshot_payload -> 'nodes', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Scenario has no executable nodes';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO next_version
  FROM public.form_scenario_versions
  WHERE scenario_id = p_scenario_id;

  INSERT INTO public.form_scenario_versions (
    scenario_id,
    workflow_id,
    version_number,
    status,
    checksum,
    snapshot,
    created_by,
    submitted_by,
    approved_by,
    submission_note,
    approval_note,
    submitted_at,
    approved_at
  )
  VALUES (
    p_scenario_id,
    p_workflow_id,
    next_version,
    'approved',
    public.form_test_snapshot_checksum(snapshot_payload),
    snapshot_payload,
    p_created_by,
    p_created_by,
    p_created_by,
    'Snapshot cree pour une planification Form Tester',
    'Snapshot epingle automatiquement pour la planification',
    now(),
    now()
  )
  RETURNING * INTO created_version;

  calculated_next_run := public.form_test_schedule_next_run(
    p_frequency,
    safe_timezone,
    p_start_at,
    (p_start_at AT TIME ZONE safe_timezone)::time,
    p_day_of_week,
    p_day_of_month,
    now() - interval '1 second'
  );
  IF calculated_next_run IS NULL THEN
    RAISE EXCEPTION 'The one-time schedule must be in the future';
  END IF;
  IF p_end_at IS NOT NULL AND calculated_next_run > p_end_at THEN
    RAISE EXCEPTION 'The next run is after the schedule end date';
  END IF;

  INSERT INTO public.workflow_schedules (
    workflow_id,
    scenario_id,
    scenario_version_id,
    org_id,
    created_by,
    name,
    frequency,
    timezone,
    start_at,
    local_time,
    day_of_week,
    day_of_month,
    next_run_at,
    end_at,
    environment
  )
  VALUES (
    p_workflow_id,
    p_scenario_id,
    created_version.id,
    scenario_row.org_id,
    p_created_by,
    COALESCE(NULLIF(BTRIM(p_name), ''), scenario_row.name),
    p_frequency,
    safe_timezone,
    p_start_at,
    (p_start_at AT TIME ZONE safe_timezone)::time,
    CASE WHEN p_frequency = 'weekly' THEN p_day_of_week ELSE NULL END,
    CASE WHEN p_frequency = 'monthly' THEN p_day_of_month ELSE NULL END,
    calculated_next_run,
    p_end_at,
    COALESCE(NULLIF(BTRIM(p_environment), ''), 'default')
  )
  RETURNING * INTO created_schedule;

  RETURN created_schedule;
END;
$$;

CREATE OR REPLACE FUNCTION public.form_test_enqueue_schedule_run(
  p_schedule_id UUID,
  p_scheduled_for TIMESTAMPTZ,
  p_requested_by UUID
)
RETURNS TABLE(run_id UUID, execution_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  schedule_row public.workflow_schedules;
  version_row public.form_scenario_versions;
  created_run public.workflow_schedule_runs;
  created_execution public.workflow_results;
  step_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_schedule_id::text, 0));

  SELECT *
  INTO schedule_row
  FROM public.workflow_schedules
  WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule not found';
  END IF;

  SELECT *
  INTO version_row
  FROM public.form_scenario_versions
  WHERE id = schedule_row.scenario_version_id
    AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pinned approved scenario version not found';
  END IF;

  INSERT INTO public.workflow_schedule_runs (
    schedule_id, scheduled_for, status
  )
  VALUES (
    schedule_row.id, p_scheduled_for, 'queued'
  )
  ON CONFLICT (schedule_id, scheduled_for) DO NOTHING
  RETURNING * INTO created_run;

  IF created_run.id IS NULL THEN
    SELECT schedule_run.id, schedule_run.execution_id
    INTO run_id, execution_id
    FROM public.workflow_schedule_runs schedule_run
    WHERE schedule_run.schedule_id = p_schedule_id
      AND schedule_run.scheduled_for = p_scheduled_for;
    RETURN NEXT;
    RETURN;
  END IF;

  step_count := jsonb_array_length(COALESCE(version_row.snapshot -> 'nodes', '[]'::jsonb));

  INSERT INTO public.workflow_results (
    workflow_id,
    scenario_id,
    scenario_version_id,
    executed_by,
    requested_by,
    executed_at,
    queued_at,
    status,
    execution_mode,
    execution_engine,
    execution_source,
    environment,
    duration_ms,
    assertions,
    step_trace,
    final_url,
    network_summary,
    progress_completed,
    progress_total,
    schedule_id,
    summary
  )
  VALUES (
    schedule_row.workflow_id,
    schedule_row.scenario_id,
    schedule_row.scenario_version_id,
    schedule_row.created_by,
    COALESCE(p_requested_by, schedule_row.created_by),
    now(),
    now(),
    'queued',
    'scheduled',
    'chromium',
    'pending_executor',
    schedule_row.environment,
    NULL,
    '[]'::jsonb,
    '[]'::jsonb,
    NULL,
    '{}'::jsonb,
    0,
    step_count,
    schedule_row.id,
    jsonb_build_object(
      'scheduled_for', p_scheduled_for,
      'schedule_name', schedule_row.name,
      'scenario_version_id', schedule_row.scenario_version_id,
      'pinned_snapshot', true
    )
  )
  RETURNING * INTO created_execution;

  UPDATE public.workflow_schedule_runs
  SET
    status = 'dispatched',
    execution_id = created_execution.id,
    dispatched_at = now()
  WHERE id = created_run.id;

  INSERT INTO public.workflow_logs (
    execution_id,
    level,
    event_type,
    message,
    details_redacted
  )
  VALUES (
    created_execution.id,
    'info',
    'scheduled_execution_queued',
    'Execution planifiee ajoutee a la file d attente.',
    jsonb_build_object(
      'schedule_id', schedule_row.id,
      'scheduled_for', p_scheduled_for,
      'scenario_version_id', schedule_row.scenario_version_id
    )
  );

  run_id := created_run.id;
  execution_id := created_execution.id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.form_test_refresh_schedule_snapshot(
  p_schedule_id UUID,
  p_updated_by UUID
)
RETURNS public.workflow_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  schedule_row public.workflow_schedules;
  snapshot_payload JSONB;
  created_version public.form_scenario_versions;
  next_version INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_schedule_id::text, 0));

  SELECT *
  INTO schedule_row
  FROM public.workflow_schedules
  WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule not found';
  END IF;

  snapshot_payload := public.form_test_build_scenario_snapshot(schedule_row.scenario_id);
  IF jsonb_array_length(COALESCE(snapshot_payload -> 'nodes', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Scenario has no executable nodes';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO next_version
  FROM public.form_scenario_versions
  WHERE scenario_id = schedule_row.scenario_id;

  INSERT INTO public.form_scenario_versions (
    scenario_id,
    workflow_id,
    version_number,
    status,
    checksum,
    snapshot,
    created_by,
    submitted_by,
    approved_by,
    submission_note,
    approval_note,
    submitted_at,
    approved_at
  )
  VALUES (
    schedule_row.scenario_id,
    schedule_row.workflow_id,
    next_version,
    'approved',
    public.form_test_snapshot_checksum(snapshot_payload),
    snapshot_payload,
    p_updated_by,
    p_updated_by,
    p_updated_by,
    'Snapshot actualise pour une planification Form Tester',
    'Snapshot epingle automatiquement pour la planification',
    now(),
    now()
  )
  RETURNING * INTO created_version;

  UPDATE public.workflow_schedules
  SET
    scenario_version_id = created_version.id,
    updated_at = now()
  WHERE id = schedule_row.id
  RETURNING * INTO schedule_row;

  RETURN schedule_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.form_test_dispatch_due_schedules(
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE(schedule_id UUID, run_id UUID, execution_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  schedule_row public.workflow_schedules;
  queued RECORD;
  following_run TIMESTAMPTZ;
BEGIN
  FOR schedule_row IN
    SELECT schedule.*
    FROM public.workflow_schedules schedule
    WHERE schedule.is_active
      AND schedule.next_run_at IS NOT NULL
      AND schedule.next_run_at <= now()
      AND (schedule.end_at IS NULL OR schedule.next_run_at <= schedule.end_at)
    ORDER BY schedule.next_run_at
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  LOOP
    SELECT *
    INTO queued
    FROM public.form_test_enqueue_schedule_run(
      schedule_row.id,
      schedule_row.next_run_at,
      schedule_row.created_by
    );

    following_run := public.form_test_schedule_next_run(
      schedule_row.frequency,
      schedule_row.timezone,
      schedule_row.start_at,
      schedule_row.local_time,
      schedule_row.day_of_week,
      schedule_row.day_of_month,
      schedule_row.next_run_at + interval '1 second'
    );

    IF schedule_row.end_at IS NOT NULL AND following_run > schedule_row.end_at THEN
      following_run := NULL;
    END IF;

    UPDATE public.workflow_schedules
    SET
      last_run_at = schedule_row.next_run_at,
      next_run_at = following_run,
      is_active = following_run IS NOT NULL,
      last_error = NULL,
      updated_at = now()
    WHERE id = schedule_row.id;

    schedule_id := schedule_row.id;
    run_id := queued.run_id;
    execution_id := queued.execution_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.form_test_schedule_result_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  schedule_row public.workflow_schedules;
BEGIN
  IF NEW.schedule_id IS NULL
     OR NEW.status NOT IN ('passed', 'failed', 'error', 'blocked', 'inconclusive', 'cancelled') THEN
    RETURN NEW;
  END IF;

  UPDATE public.workflow_schedule_runs
  SET
    status = CASE WHEN NEW.status = 'error' THEN 'error' ELSE 'completed' END,
    error_message = COALESCE(NEW.failure_reason, NEW.error_message),
    completed_at = COALESCE(NEW.completed_at, now())
  WHERE execution_id = NEW.id;

  SELECT *
  INTO schedule_row
  FROM public.workflow_schedules
  WHERE id = NEW.schedule_id;

  IF schedule_row.id IS NOT NULL
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      category,
      reference_id,
      reference_type
    )
    VALUES (
      schedule_row.created_by,
      'Execution Form Tester planifiee',
      'La planification "' || schedule_row.name || '" est terminee avec le statut ' || NEW.status || '.',
      CASE
        WHEN NEW.status = 'passed' THEN 'success'
        WHEN NEW.status IN ('error', 'failed') THEN 'error'
        ELSE 'warning'
      END,
      'schedule',
      NEW.id,
      'form_execution'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_form_test_schedule_result_sync ON public.workflow_results;
CREATE TRIGGER trg_form_test_schedule_result_sync
  AFTER UPDATE OF status ON public.workflow_results
  FOR EACH ROW
  EXECUTE FUNCTION public.form_test_schedule_result_sync();

REVOKE ALL ON FUNCTION public.form_test_schedule_next_run(TEXT, TEXT, TIMESTAMPTZ, TIME, INTEGER, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.form_test_create_schedule(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, INTEGER, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.form_test_enqueue_schedule_run(UUID, TIMESTAMPTZ, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.form_test_refresh_schedule_snapshot(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.form_test_dispatch_due_schedules(INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.form_test_schedule_next_run(TEXT, TEXT, TIMESTAMPTZ, TIME, INTEGER, INTEGER, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.form_test_create_schedule(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, INTEGER, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.form_test_enqueue_schedule_run(UUID, TIMESTAMPTZ, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.form_test_refresh_schedule_snapshot(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.form_test_dispatch_due_schedules(INTEGER) TO service_role;

DO $$
DECLARE
  existing_job BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid
    INTO existing_job
    FROM cron.job
    WHERE jobname = 'form-tester-schedule-dispatch'
    LIMIT 1;

    IF existing_job IS NOT NULL THEN
      PERFORM cron.unschedule(existing_job);
    END IF;

    PERFORM cron.schedule(
      'form-tester-schedule-dispatch',
      '* * * * *',
      'SELECT public.form_test_dispatch_due_schedules(50);'
    );
  END IF;
END;
$$;
