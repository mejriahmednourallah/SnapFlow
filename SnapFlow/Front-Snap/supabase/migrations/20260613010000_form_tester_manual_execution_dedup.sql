-- Prevent duplicate manual Form Tester executions for the same scenario.

WITH ranked_active AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY scenario_id
      ORDER BY
        CASE status WHEN 'running' THEN 0 WHEN 'stopping' THEN 1 ELSE 2 END,
        COALESCE(started_at, queued_at, executed_at),
        id
    ) AS position
  FROM public.workflow_results
  WHERE scenario_id IS NOT NULL
    AND schedule_id IS NULL
    AND status IN ('queued', 'running', 'stopping')
)
UPDATE public.workflow_results result
SET
  status = 'cancelled',
  failure_reason = COALESCE(result.failure_reason, 'duplicate_manual_execution_superseded'),
  completed_at = COALESCE(result.completed_at, now())
FROM ranked_active duplicate
WHERE result.id = duplicate.id
  AND duplicate.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_results_one_active_manual_scenario
  ON public.workflow_results(scenario_id)
  WHERE schedule_id IS NULL
    AND status IN ('queued', 'running', 'stopping');

CREATE OR REPLACE FUNCTION public.form_test_enqueue_manual_execution(
  p_workflow_id UUID,
  p_scenario_id UUID,
  p_scenario_version_id UUID,
  p_requested_by UUID,
  p_execution_mode TEXT DEFAULT 'full',
  p_start_node_id UUID DEFAULT NULL,
  p_environment TEXT DEFAULT 'default',
  p_audit_run_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  scenario_row public.form_test_scenarios;
  workflow_row public.form_workflows;
  version_row public.form_scenario_versions;
  existing_execution public.workflow_results;
  created_execution public.workflow_results;
  snapshot_payload JSONB;
  snapshot_checksum TEXT;
  next_version INTEGER;
  step_count INTEGER;
  queued_at_value TIMESTAMPTZ := now();
BEGIN
  IF p_execution_mode NOT IN ('full', 'step', 'from_step') THEN
    RAISE EXCEPTION 'Unsupported manual execution mode: %', p_execution_mode;
  END IF;
  IF p_execution_mode IN ('step', 'from_step') AND p_start_node_id IS NULL THEN
    RAISE EXCEPTION 'start_node_id is required for execution mode %', p_execution_mode;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_scenario_id::text, 0));

  SELECT *
  INTO scenario_row
  FROM public.form_test_scenarios
  WHERE id = p_scenario_id
    AND workflow_id = p_workflow_id;
  IF scenario_row.id IS NULL THEN
    RAISE EXCEPTION 'Scenario not found for workflow';
  END IF;

  SELECT *
  INTO workflow_row
  FROM public.form_workflows
  WHERE id = p_workflow_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow not found';
  END IF;

  SELECT *
  INTO existing_execution
  FROM public.workflow_results
  WHERE scenario_id = p_scenario_id
    AND schedule_id IS NULL
    AND status IN ('queued', 'running', 'stopping')
  ORDER BY COALESCE(started_at, queued_at, executed_at), id
  LIMIT 1;

  IF FOUND THEN
    SELECT *
    INTO version_row
    FROM public.form_scenario_versions
    WHERE id = existing_execution.scenario_version_id;

    RETURN jsonb_build_object(
      'deduplicated', true,
      'execution', to_jsonb(existing_execution),
      'scenario_version', to_jsonb(version_row)
    );
  END IF;

  IF p_scenario_version_id IS NOT NULL THEN
    SELECT *
    INTO version_row
    FROM public.form_scenario_versions
    WHERE id = p_scenario_version_id
      AND scenario_id = p_scenario_id
      AND status = 'approved';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Approved scenario version not found';
    END IF;
  ELSE
    snapshot_payload := public.form_test_build_scenario_snapshot(p_scenario_id);
    IF snapshot_payload IS NULL THEN
      RAISE EXCEPTION 'Scenario snapshot could not be built';
    END IF;

    step_count := jsonb_array_length(COALESCE(snapshot_payload -> 'nodes', '[]'::jsonb));
    IF step_count = 0 THEN
      RAISE EXCEPTION 'Scenario has no executable nodes';
    END IF;

    snapshot_checksum := public.form_test_snapshot_checksum(snapshot_payload);
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
      snapshot_checksum,
      snapshot_payload,
      p_requested_by,
      p_requested_by,
      p_requested_by,
      'Runtime snapshot for direct Form Tester execution',
      'Auto-approved for direct execution',
      queued_at_value,
      queued_at_value
    )
    RETURNING * INTO version_row;
  END IF;

  step_count := jsonb_array_length(COALESCE(version_row.snapshot -> 'nodes', '[]'::jsonb));
  IF step_count = 0 THEN
    RAISE EXCEPTION 'Approved scenario version has no executable nodes';
  END IF;

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
    start_node_id,
    current_node_id,
    duration_ms,
    assertions,
    step_trace,
    final_url,
    network_summary,
    progress_completed,
    progress_total,
    summary,
    audit_run_id
  )
  VALUES (
    p_workflow_id,
    p_scenario_id,
    version_row.id,
    p_requested_by,
    p_requested_by,
    queued_at_value,
    queued_at_value,
    'queued',
    p_execution_mode,
    'chromium',
    'pending_executor',
    COALESCE(NULLIF(trim(p_environment), ''), 'default'),
    p_start_node_id,
    NULL,
    NULL,
    '[]'::jsonb,
    '[]'::jsonb,
    NULL,
    '{}'::jsonb,
    0,
    step_count,
    jsonb_build_object(
      'target_url', workflow_row.target_url,
      'scenario_version_number', version_row.version_number,
      'scenario_checksum', version_row.checksum,
      'runtime_snapshot', p_scenario_version_id IS NULL
    ),
    p_audit_run_id
  )
  RETURNING * INTO created_execution;

  RETURN jsonb_build_object(
    'deduplicated', false,
    'execution', to_jsonb(created_execution),
    'scenario_version', to_jsonb(version_row)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.form_test_enqueue_manual_execution(
  UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, UUID
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_test_enqueue_manual_execution(
  UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, UUID
) TO service_role;

COMMENT ON FUNCTION public.form_test_enqueue_manual_execution(
  UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, UUID
) IS 'Atomically reuses an active manual scenario execution or creates its immutable runtime snapshot and queue row.';
