-- Form Tester business campaigns.
-- Groups immutable scenario executions around a fresh nominal baseline.

CREATE TABLE IF NOT EXISTS public.form_test_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.form_workflows(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  baseline_scenario_id UUID NOT NULL REFERENCES public.form_test_scenarios(id) ON DELETE RESTRICT,
  baseline_execution_id UUID,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'error')),
  selected_scenario_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  summary JSONB NOT NULL DEFAULT jsonb_build_object(
    'conform', 0,
    'anomaly', 0,
    'needs_confirmation', 0,
    'interrupted', 0,
    'observation', 0
  ),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.workflow_results
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.form_test_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_role TEXT,
  ADD COLUMN IF NOT EXISTS depends_on_execution_id UUID REFERENCES public.workflow_results(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evaluation_mode TEXT;

ALTER TABLE public.workflow_results
  DROP CONSTRAINT IF EXISTS workflow_results_campaign_role_check,
  DROP CONSTRAINT IF EXISTS workflow_results_evaluation_mode_check;

ALTER TABLE public.workflow_results
  ADD CONSTRAINT workflow_results_campaign_role_check
    CHECK (campaign_role IS NULL OR campaign_role IN ('baseline', 'case')),
  ADD CONSTRAINT workflow_results_evaluation_mode_check
    CHECK (
      evaluation_mode IS NULL
      OR evaluation_mode IN ('baseline_comparison', 'explicit_oracle', 'exploratory')
    );

ALTER TABLE public.form_test_campaigns
  DROP CONSTRAINT IF EXISTS form_test_campaigns_baseline_execution_id_fkey;

ALTER TABLE public.form_test_campaigns
  ADD CONSTRAINT form_test_campaigns_baseline_execution_id_fkey
    FOREIGN KEY (baseline_execution_id)
    REFERENCES public.workflow_results(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_form_test_campaigns_workflow_created
  ON public.form_test_campaigns(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_results_campaign
  ON public.workflow_results(campaign_id, queued_at, executed_at);
CREATE INDEX IF NOT EXISTS idx_workflow_results_dependency
  ON public.workflow_results(depends_on_execution_id)
  WHERE depends_on_execution_id IS NOT NULL;

ALTER TABLE public.form_test_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "form_test_campaigns_select_owner_or_admin" ON public.form_test_campaigns;
CREATE POLICY "form_test_campaigns_select_owner_or_admin"
  ON public.form_test_campaigns FOR SELECT
  USING (
    created_by = auth.uid()
    OR org_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE OR REPLACE FUNCTION public.form_test_expected_behavior(
  p_expected_outcome TEXT,
  p_case_definition JSONB
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_case_definition ->> 'expected_behavior', '') IN ('accept', 'reject', 'explore')
      THEN p_case_definition ->> 'expected_behavior'
    WHEN p_expected_outcome = 'success' THEN 'accept'
    WHEN p_expected_outcome IN ('validation_error', 'business_rejection') THEN 'reject'
    ELSE 'explore'
  END;
$$;

CREATE OR REPLACE FUNCTION public.form_test_launch_campaign(
  p_workflow_id UUID,
  p_baseline_scenario_id UUID,
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
  v_baseline_execution_id UUID;
  selected_ids UUID[];
  expected_behavior TEXT;
  evaluation_mode_value TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('form-campaign:' || p_workflow_id::text, 0));

  SELECT * INTO workflow_row
  FROM public.form_workflows
  WHERE id = p_workflow_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow not found';
  END IF;

  selected_ids := ARRAY(
    SELECT DISTINCT value
    FROM unnest(COALESCE(p_scenario_ids, '{}'::uuid[]) || ARRAY[p_baseline_scenario_id]) value
    WHERE value IS NOT NULL
  );
  IF cardinality(selected_ids) = 0 THEN
    RAISE EXCEPTION 'At least one scenario is required';
  END IF;

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
    name,
    selected_scenario_ids
  )
  VALUES (
    p_workflow_id,
    workflow_row.org_id,
    p_requested_by,
    p_baseline_scenario_id,
    COALESCE(NULLIF(trim(p_name), ''), 'Campagne du ' || to_char(now(), 'DD/MM/YYYY HH24:MI')),
    selected_ids
  )
  RETURNING * INTO campaign_row;

  enqueue_payload := public.form_test_enqueue_manual_execution(
    p_workflow_id,
    p_baseline_scenario_id,
    NULL,
    p_requested_by,
    'full',
    NULL,
    COALESCE(NULLIF(trim(p_environment), ''), 'default'),
    NULL
  );
  IF COALESCE((enqueue_payload ->> 'deduplicated')::boolean, false) THEN
    RAISE EXCEPTION 'Baseline execution was unexpectedly deduplicated';
  END IF;
  execution_payload := enqueue_payload -> 'execution';
  v_baseline_execution_id := (execution_payload ->> 'id')::uuid;

  UPDATE public.workflow_results
  SET
    campaign_id = campaign_row.id,
    campaign_role = 'baseline',
    evaluation_mode = 'baseline_comparison',
    summary = COALESCE(summary, '{}'::jsonb) || jsonb_build_object(
      'campaign_id', campaign_row.id,
      'campaign_role', 'baseline',
      'expected_behavior', 'accept'
    )
  WHERE id = v_baseline_execution_id;

  UPDATE public.form_test_campaigns
  SET baseline_execution_id = v_baseline_execution_id, updated_at = now()
  WHERE id = campaign_row.id;

  FOR scenario_row IN
    SELECT *
    FROM public.form_test_scenarios
    WHERE id = ANY(selected_ids)
      AND id <> p_baseline_scenario_id
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
    execution_id := (execution_payload ->> 'id')::uuid;
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
      depends_on_execution_id = v_baseline_execution_id,
      evaluation_mode = evaluation_mode_value,
      summary = COALESCE(summary, '{}'::jsonb) || jsonb_build_object(
        'campaign_id', campaign_row.id,
        'campaign_role', 'case',
        'expected_behavior', expected_behavior,
        'baseline_execution_id', v_baseline_execution_id
      )
    WHERE id = execution_id;
  END LOOP;

  SELECT * INTO campaign_row
  FROM public.form_test_campaigns
  WHERE id = campaign_row.id;

  RETURN jsonb_build_object(
    'campaign', to_jsonb(campaign_row),
    'baseline_execution_id', v_baseline_execution_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.form_test_launch_campaign(
  UUID, UUID, UUID[], UUID, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_test_launch_campaign(
  UUID, UUID, UUID[], UUID, TEXT, TEXT
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
