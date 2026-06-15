-- Dual nominal baselines and atomic semantic reference selection.

ALTER TABLE public.form_test_campaigns
  ADD COLUMN IF NOT EXISTS baseline_scenario_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS baseline_execution_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS reference_execution_id UUID REFERENCES public.workflow_results(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference_selection JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reference_conclusive BOOLEAN NOT NULL DEFAULT false;

UPDATE public.form_test_campaigns
SET
  baseline_scenario_ids = CASE
    WHEN cardinality(baseline_scenario_ids) = 0 THEN ARRAY[baseline_scenario_id]
    ELSE baseline_scenario_ids
  END,
  baseline_execution_ids = CASE
    WHEN cardinality(baseline_execution_ids) = 0 AND baseline_execution_id IS NOT NULL
      THEN ARRAY[baseline_execution_id]
    ELSE baseline_execution_ids
  END,
  reference_execution_id = COALESCE(reference_execution_id, baseline_execution_id)
WHERE cardinality(baseline_scenario_ids) = 0
   OR (cardinality(baseline_execution_ids) = 0 AND baseline_execution_id IS NOT NULL)
   OR reference_execution_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_form_test_campaigns_reference
  ON public.form_test_campaigns(reference_execution_id)
  WHERE reference_execution_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.form_test_select_campaign_reference(
  p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  campaign_row public.form_test_campaigns;
  winner public.workflow_results;
  candidate_rows JSONB;
  terminal_count INTEGER;
  expected_count INTEGER;
  winner_score NUMERIC := 0;
  winner_conclusive BOOLEAN := false;
BEGIN
  SELECT * INTO campaign_row
  FROM public.form_test_campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;
  IF campaign_row.reference_execution_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'selected', true,
      'reference_execution_id', campaign_row.reference_execution_id,
      'reference_conclusive', campaign_row.reference_conclusive
    );
  END IF;

  expected_count := cardinality(campaign_row.baseline_execution_ids);
  IF expected_count = 0 THEN
    RETURN jsonb_build_object('selected', false, 'reason', 'no_baseline_candidates');
  END IF;

  SELECT count(*) INTO terminal_count
  FROM public.workflow_results result
  WHERE result.id = ANY(campaign_row.baseline_execution_ids)
    AND result.status IN (
      'passed', 'failed', 'error', 'blocked', 'cancelled',
      'pass', 'fail', 'needs_review', 'inconclusive'
    );

  IF terminal_count <> expected_count THEN
    RETURN jsonb_build_object('selected', false, 'reason', 'baseline_candidates_running');
  END IF;

  SELECT result.* INTO winner
  FROM public.workflow_results result
  WHERE result.id = ANY(campaign_row.baseline_execution_ids)
  ORDER BY
    COALESCE(NULLIF(result.summary #>> '{reference_quality,score}', '')::numeric, 0) DESC,
    CASE WHEN result.status IN ('passed', 'pass') THEN 1 ELSE 0 END DESC,
    result.completed_at NULLS LAST,
    result.id
  LIMIT 1;

  winner_score := COALESCE(
    NULLIF(winner.summary #>> '{reference_quality,score}', '')::numeric,
    0
  );
  winner_conclusive := COALESCE(
    (winner.summary #>> '{reference_quality,conclusive}')::boolean,
    false
  );

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'execution_id', result.id,
        'scenario_id', result.scenario_id,
        'status', result.status,
        'score', COALESCE(
          NULLIF(result.summary #>> '{reference_quality,score}', '')::numeric,
          0
        ),
        'conclusive', COALESCE(
          (result.summary #>> '{reference_quality,conclusive}')::boolean,
          false
        ),
        'reasons', COALESCE(result.summary #> '{reference_quality,reasons}', '[]'::jsonb),
        'conflicts', COALESCE(result.summary #> '{reference_quality,conflicts}', '[]'::jsonb)
      )
      ORDER BY
        COALESCE(NULLIF(result.summary #>> '{reference_quality,score}', '')::numeric, 0) DESC,
        result.id
    ),
    '[]'::jsonb
  )
  INTO candidate_rows
  FROM public.workflow_results result
  WHERE result.id = ANY(campaign_row.baseline_execution_ids);

  UPDATE public.form_test_campaigns
  SET
    reference_execution_id = winner.id,
    reference_conclusive = winner_conclusive,
    reference_selection = jsonb_build_object(
      'selected_at', now(),
      'threshold', 0.65,
      'winner_execution_id', winner.id,
      'winner_score', winner_score,
      'winner_conclusive', winner_conclusive,
      'candidates', candidate_rows
    ),
    baseline_scenario_id = winner.scenario_id,
    baseline_execution_id = winner.id,
    updated_at = now()
  WHERE id = campaign_row.id
    AND reference_execution_id IS NULL;

  UPDATE public.workflow_results
  SET depends_on_execution_id = winner.id
  WHERE campaign_id = campaign_row.id
    AND campaign_role = 'case';

  RETURN jsonb_build_object(
    'selected', true,
    'reference_execution_id', winner.id,
    'reference_conclusive', winner_conclusive,
    'score', winner_score,
    'candidates', candidate_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.form_test_select_campaign_reference(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_test_select_campaign_reference(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.form_test_launch_campaign_v2(
  p_workflow_id UUID,
  p_baseline_scenario_ids UUID[],
  p_scenario_ids UUID[],
  p_requested_by UUID,
  p_name TEXT DEFAULT NULL,
  p_environment TEXT DEFAULT 'default'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  workflow_row public.form_workflows;
  scenario_row public.form_test_scenarios;
  campaign_row public.form_test_campaigns;
  enqueue_payload JSONB;
  execution_payload JSONB;
  execution_id UUID;
  v_baseline_execution_ids UUID[] := '{}'::uuid[];
  baseline_ids UUID[];
  selected_ids UUID[];
  expected_behavior TEXT;
  evaluation_mode_value TEXT;
  baseline_index INTEGER := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('form-campaign:' || p_workflow_id::text, 0));

  SELECT * INTO workflow_row
  FROM public.form_workflows
  WHERE id = p_workflow_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow not found';
  END IF;

  baseline_ids := ARRAY(
    SELECT DISTINCT value
    FROM unnest(COALESCE(p_baseline_scenario_ids, '{}'::uuid[])) value
    WHERE value IS NOT NULL
    LIMIT 2
  );
  IF cardinality(baseline_ids) = 0 THEN
    RAISE EXCEPTION 'At least one nominal scenario is required';
  END IF;

  selected_ids := ARRAY(
    SELECT DISTINCT value
    FROM unnest(COALESCE(p_scenario_ids, '{}'::uuid[]) || baseline_ids) value
    WHERE value IS NOT NULL
  );

  IF EXISTS (
    SELECT 1
    FROM public.form_test_scenarios scenario
    WHERE scenario.id = ANY(selected_ids)
      AND scenario.workflow_id <> p_workflow_id
  ) OR (
    SELECT count(*)
    FROM public.form_test_scenarios scenario
    WHERE scenario.id = ANY(selected_ids)
      AND scenario.workflow_id = p_workflow_id
  ) <> cardinality(selected_ids) THEN
    RAISE EXCEPTION 'Campaign contains an invalid scenario';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.form_test_scenarios scenario
    WHERE scenario.id = ANY(baseline_ids)
      AND public.form_test_expected_behavior(
        scenario.expected_outcome,
        scenario.case_definition
      ) <> 'accept'
  ) THEN
    RAISE EXCEPTION 'Nominal scenarios must expect acceptance';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.workflow_results result
    WHERE result.scenario_id = ANY(selected_ids)
      AND result.status IN ('queued', 'running', 'stopping')
  ) THEN
    RAISE EXCEPTION 'A selected scenario already has an active execution';
  END IF;

  INSERT INTO public.form_test_campaigns (
    workflow_id,
    org_id,
    created_by,
    baseline_scenario_id,
    baseline_scenario_ids,
    name,
    selected_scenario_ids
  )
  VALUES (
    p_workflow_id,
    workflow_row.org_id,
    p_requested_by,
    baseline_ids[1],
    baseline_ids,
    COALESCE(NULLIF(trim(p_name), ''), 'Campagne du ' || to_char(now(), 'DD/MM/YYYY HH24:MI')),
    selected_ids
  )
  RETURNING * INTO campaign_row;

  FOREACH execution_id IN ARRAY baseline_ids
  LOOP
    baseline_index := baseline_index + 1;
    enqueue_payload := public.form_test_enqueue_manual_execution(
      p_workflow_id,
      execution_id,
      NULL,
      p_requested_by,
      'full',
      NULL,
      COALESCE(NULLIF(trim(p_environment), ''), 'default'),
      NULL
    );
    IF COALESCE((enqueue_payload ->> 'deduplicated')::boolean, false) THEN
      RAISE EXCEPTION 'Nominal execution was unexpectedly deduplicated';
    END IF;
    execution_payload := enqueue_payload -> 'execution';
    v_baseline_execution_ids := array_append(
      v_baseline_execution_ids,
      (execution_payload ->> 'id')::uuid
    );

    UPDATE public.workflow_results
    SET
      campaign_id = campaign_row.id,
      campaign_role = 'baseline',
      evaluation_mode = 'baseline_comparison',
      summary = COALESCE(summary, '{}'::jsonb) || jsonb_build_object(
        'campaign_id', campaign_row.id,
        'campaign_role', 'baseline',
        'baseline_candidate_index', baseline_index,
        'expected_behavior', 'accept'
      )
    WHERE id = (execution_payload ->> 'id')::uuid;
  END LOOP;

  UPDATE public.form_test_campaigns
  SET
    baseline_execution_ids = v_baseline_execution_ids,
    baseline_execution_id = v_baseline_execution_ids[1],
    updated_at = now()
  WHERE id = campaign_row.id;

  FOR scenario_row IN
    SELECT *
    FROM public.form_test_scenarios
    WHERE id = ANY(selected_ids)
      AND NOT (id = ANY(baseline_ids))
    ORDER BY created_at, id
  LOOP
    enqueue_payload := public.form_test_enqueue_manual_execution(
      p_workflow_id,
      scenario_row.id,
      NULL,
      p_requested_by,
      'full',
      NULL,
      COALESCE(NULLIF(trim(p_environment), ''), 'default'),
      NULL
    );
    IF COALESCE((enqueue_payload ->> 'deduplicated')::boolean, false) THEN
      RAISE EXCEPTION 'Scenario execution was unexpectedly deduplicated: %', scenario_row.id;
    END IF;

    execution_payload := enqueue_payload -> 'execution';
    expected_behavior := public.form_test_expected_behavior(
      scenario_row.expected_outcome,
      scenario_row.case_definition
    );
    evaluation_mode_value := CASE
      WHEN expected_behavior = 'explore' THEN 'exploratory'
      WHEN expected_behavior = 'reject' THEN 'explicit_oracle'
      ELSE 'baseline_comparison'
    END;

    UPDATE public.workflow_results
    SET
      campaign_id = campaign_row.id,
      campaign_role = 'case',
      depends_on_execution_id = v_baseline_execution_ids[1],
      evaluation_mode = evaluation_mode_value,
      summary = COALESCE(summary, '{}'::jsonb) || jsonb_build_object(
        'campaign_id', campaign_row.id,
        'campaign_role', 'case',
        'expected_behavior', expected_behavior
      )
    WHERE id = (execution_payload ->> 'id')::uuid;
  END LOOP;

  SELECT * INTO campaign_row
  FROM public.form_test_campaigns
  WHERE id = campaign_row.id;

  RETURN jsonb_build_object(
    'campaign', to_jsonb(campaign_row),
    'baseline_execution_id', v_baseline_execution_ids[1],
    'baseline_execution_ids', v_baseline_execution_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.form_test_launch_campaign_v2(
  UUID, UUID[], UUID[], UUID, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_test_launch_campaign_v2(
  UUID, UUID[], UUID[], UUID, TEXT, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION public.form_test_refresh_campaign(p_campaign_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active_count INTEGER;
  total_count INTEGER;
  terminal_count INTEGER;
  summary_value JSONB;
BEGIN
  PERFORM public.form_test_select_campaign_reference(p_campaign_id);

  SELECT
    count(*),
    count(*) FILTER (WHERE status IN ('queued', 'running', 'stopping')),
    count(*) FILTER (
      WHERE status IN (
        'passed', 'failed', 'error', 'blocked', 'cancelled',
        'pass', 'fail', 'needs_review', 'inconclusive'
      )
    )
  INTO total_count, active_count, terminal_count
  FROM public.workflow_results
  WHERE campaign_id = p_campaign_id;

  SELECT jsonb_build_object(
    'conform', count(*) FILTER (
      WHERE COALESCE(summary ->> 'effective_business_verdict', summary ->> 'business_verdict') = 'conform'
    ),
    'anomaly', count(*) FILTER (
      WHERE COALESCE(summary ->> 'effective_business_verdict', summary ->> 'business_verdict')
        IN ('unexpected_acceptance', 'unexpected_rejection')
    ),
    'needs_confirmation', count(*) FILTER (
      WHERE COALESCE(summary ->> 'effective_business_verdict', summary ->> 'business_verdict')
        = 'needs_confirmation'
    ),
    'interrupted', count(*) FILTER (
      WHERE COALESCE(summary ->> 'effective_business_verdict', summary ->> 'business_verdict') = 'interrupted'
    ),
    'observation', count(*) FILTER (
      WHERE COALESCE(summary ->> 'effective_business_verdict', summary ->> 'business_verdict') = 'observation'
    ),
    'total', count(*)
  )
  INTO summary_value
  FROM public.workflow_results
  WHERE campaign_id = p_campaign_id;

  UPDATE public.form_test_campaigns
  SET
    summary = COALESCE(summary_value, '{}'::jsonb),
    status = CASE
      WHEN total_count > 0 AND terminal_count = total_count THEN 'completed'
      WHEN active_count > 0 THEN 'running'
      ELSE status
    END,
    started_at = CASE
      WHEN active_count > 0 THEN COALESCE(started_at, now())
      ELSE started_at
    END,
    completed_at = CASE
      WHEN total_count > 0 AND terminal_count = total_count THEN COALESCE(completed_at, now())
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = p_campaign_id;
END;
$$;

REVOKE ALL ON FUNCTION public.form_test_refresh_campaign(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_test_refresh_campaign(UUID) TO service_role;
