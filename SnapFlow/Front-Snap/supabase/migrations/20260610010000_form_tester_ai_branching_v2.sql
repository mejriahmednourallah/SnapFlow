-- Form Tester AI branching V2: richer outcomes, inconclusive execution states,
-- and atomic compilation of generated cases into executable scenario graphs.

ALTER TABLE public.form_test_scenarios
  DROP CONSTRAINT IF EXISTS form_test_scenarios_expected_outcome_check;

ALTER TABLE public.form_test_scenarios
  ADD CONSTRAINT form_test_scenarios_expected_outcome_check
  CHECK (
    expected_outcome IN (
      'success',
      'validation_error',
      'business_rejection',
      'server_error',
      'blocked'
    )
  );

ALTER TABLE public.workflow_results
  DROP CONSTRAINT IF EXISTS workflow_results_status_check;

ALTER TABLE public.workflow_results
  ADD CONSTRAINT workflow_results_status_check
  CHECK (
    status IN (
      'queued', 'running', 'stopping', 'passed', 'failed', 'error',
      'blocked', 'inconclusive', 'cancelled', 'pass', 'fail', 'needs_review'
    )
  );

ALTER TABLE public.workflow_step_results
  DROP CONSTRAINT IF EXISTS workflow_step_results_status_check;

ALTER TABLE public.workflow_step_results
  ADD CONSTRAINT workflow_step_results_status_check
  CHECK (
    status IN (
      'queued', 'running', 'passed', 'failed', 'error',
      'blocked', 'inconclusive', 'cancelled', 'skipped'
    )
  );

CREATE OR REPLACE FUNCTION public.form_test_apply_generated_suite(
  p_source_scenario_id UUID,
  p_cases JSONB,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  test_case JSONB;
  created_scenario public.form_test_scenarios;
  submit_node public.workflow_nodes;
  inspect_node_id UUID;
  condition_node_id UUID;
  success_assert_id UUID;
  failure_capture_id UUID;
  failure_assert_id UUID;
  route_step JSONB;
  route_node_id UUID;
  previous_node_id UUID;
  incoming_source_id UUID;
  route_index INTEGER;
  route_count INTEGER;
  max_order INTEGER;
  v_expected_outcome TEXT;
  created JSONB := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_cases) <> 'array' OR jsonb_array_length(p_cases) = 0 THEN
    RAISE EXCEPTION 'Generated suite must contain at least one case';
  END IF;

  IF jsonb_array_length(p_cases) > 12 THEN
    RAISE EXCEPTION 'Generated suite exceeds the 12 case limit';
  END IF;

  FOR test_case IN SELECT value FROM jsonb_array_elements(p_cases)
  LOOP
    v_expected_outcome := COALESCE(test_case ->> 'expected_outcome', 'success');
    IF v_expected_outcome NOT IN (
      'success', 'validation_error', 'business_rejection', 'server_error', 'blocked'
    ) THEN
      RAISE EXCEPTION 'Invalid expected outcome: %', v_expected_outcome;
    END IF;

    created_scenario := public.form_test_clone_scenario_case(
      p_source_scenario_id,
      COALESCE(NULLIF(BTRIM(test_case ->> 'name'), ''), 'Cas de test IA'),
      NULLIF(BTRIM(COALESCE(test_case ->> 'description', '')), ''),
      CASE WHEN v_expected_outcome = 'business_rejection' THEN 'success' ELSE v_expected_outcome END,
      'ai',
      COALESCE(test_case -> 'case_definition', '{}'::jsonb),
      p_created_by
    );

    UPDATE public.form_test_scenarios
    SET
      expected_outcome = v_expected_outcome,
      case_definition = COALESCE(test_case -> 'case_definition', '{}'::jsonb)
        || jsonb_build_object(
          'plan_version', 2,
          'generated_at', COALESCE(test_case ->> 'generated_at', now()::text)
        )
    WHERE id = created_scenario.id
    RETURNING * INTO created_scenario;

    SELECT *
    INTO submit_node
    FROM public.workflow_nodes
    WHERE scenario_id = created_scenario.id
      AND type = 'submit'
    ORDER BY order_index DESC
    LIMIT 1;

    IF submit_node.id IS NULL THEN
      RAISE EXCEPTION 'Generated scenario has no submit node';
    END IF;

    SELECT source_node_id
    INTO incoming_source_id
    FROM public.workflow_edges
    WHERE scenario_id = created_scenario.id
      AND target_node_id = submit_node.id
    ORDER BY created_at DESC
    LIMIT 1;

    route_count := jsonb_array_length(
      COALESCE(test_case #> '{case_definition,route_steps}', '[]'::jsonb)
    );
    IF route_count > 0 AND incoming_source_id IS NOT NULL THEN
      DELETE FROM public.workflow_edges
      WHERE scenario_id = created_scenario.id
        AND target_node_id = submit_node.id;

      previous_node_id := incoming_source_id;
      route_index := 0;
      FOR route_step IN
        SELECT value
        FROM jsonb_array_elements(
          COALESCE(test_case #> '{case_definition,route_steps}', '[]'::jsonb)
        )
      LOOP
        IF route_step ->> 'type' NOT IN ('click', 'wait') THEN
          RAISE EXCEPTION 'Unsupported generated route step: %', route_step ->> 'type';
        END IF;
        route_node_id := gen_random_uuid();
        route_index := route_index + 1;

        INSERT INTO public.workflow_nodes (
          id, workflow_id, scenario_id, type, order_index, position_x, position_y, config
        ) VALUES (
          route_node_id,
          created_scenario.workflow_id,
          created_scenario.id,
          route_step ->> 'type',
          submit_node.order_index + route_index - 1,
          submit_node.position_x,
          submit_node.position_y - ((route_count - route_index + 1) * 100),
          (route_step - 'type')
        );

        INSERT INTO public.workflow_edges (
          workflow_id, scenario_id, source_node_id, target_node_id, branch_key
        ) VALUES (
          created_scenario.workflow_id,
          created_scenario.id,
          previous_node_id,
          route_node_id,
          'default'
        );
        previous_node_id := route_node_id;
      END LOOP;

      UPDATE public.workflow_nodes
      SET order_index = submit_node.order_index + route_count
      WHERE id = submit_node.id;

      INSERT INTO public.workflow_edges (
        workflow_id, scenario_id, source_node_id, target_node_id, branch_key
      ) VALUES (
        created_scenario.workflow_id,
        created_scenario.id,
        previous_node_id,
        submit_node.id,
        'default'
      );

      SELECT *
      INTO submit_node
      FROM public.workflow_nodes
      WHERE id = submit_node.id;
    END IF;

    SELECT COALESCE(MAX(order_index), 0)
    INTO max_order
    FROM public.workflow_nodes
    WHERE scenario_id = created_scenario.id;

    DELETE FROM public.workflow_edges
    WHERE scenario_id = created_scenario.id
      AND source_node_id = submit_node.id;

    inspect_node_id := gen_random_uuid();
    condition_node_id := gen_random_uuid();
    success_assert_id := gen_random_uuid();
    failure_capture_id := gen_random_uuid();
    failure_assert_id := gen_random_uuid();

    INSERT INTO public.workflow_nodes (
      id, workflow_id, scenario_id, type, order_index, position_x, position_y, config
    ) VALUES
      (
        inspect_node_id,
        created_scenario.workflow_id,
        created_scenario.id,
        'inspect_response',
        max_order + 1,
        submit_node.position_x,
        submit_node.position_y + 120,
        jsonb_build_object('label', 'Observer la soumission')
      ),
      (
        condition_node_id,
        created_scenario.workflow_id,
        created_scenario.id,
        'condition',
        max_order + 2,
        submit_node.position_x,
        submit_node.position_y + 240,
        jsonb_build_object(
          'label', 'Resultat attendu observe',
          'type', 'submission_outcome',
          'expected_outcome', v_expected_outcome,
          'oracle', COALESCE(test_case #> '{case_definition,oracle}', '{}'::jsonb)
        )
      ),
      (
        success_assert_id,
        created_scenario.workflow_id,
        created_scenario.id,
        'assert',
        max_order + 3,
        submit_node.position_x - 170,
        submit_node.position_y + 370,
        jsonb_build_object(
          'label', 'Confirmer le resultat attendu',
          'type', 'submission_outcome',
          'expected_outcome', v_expected_outcome,
          'oracle', COALESCE(test_case #> '{case_definition,oracle}', '{}'::jsonb)
        )
      ),
      (
        failure_capture_id,
        created_scenario.workflow_id,
        created_scenario.id,
        'screenshot',
        max_order + 3,
        submit_node.position_x + 170,
        submit_node.position_y + 370,
        jsonb_build_object('label', 'Capturer le resultat inattendu', 'full_page', true)
      ),
      (
        failure_assert_id,
        created_scenario.workflow_id,
        created_scenario.id,
        'assert',
        max_order + 4,
        submit_node.position_x + 170,
        submit_node.position_y + 490,
        jsonb_build_object(
          'label', 'Diagnostiquer le resultat inattendu',
          'type', 'submission_outcome',
          'expected_outcome', v_expected_outcome,
          'oracle', COALESCE(test_case #> '{case_definition,oracle}', '{}'::jsonb)
        )
      );

    INSERT INTO public.workflow_edges (
      workflow_id, scenario_id, source_node_id, target_node_id, branch_key
    ) VALUES
      (created_scenario.workflow_id, created_scenario.id, submit_node.id, inspect_node_id, 'success'),
      (created_scenario.workflow_id, created_scenario.id, inspect_node_id, condition_node_id, 'default'),
      (created_scenario.workflow_id, created_scenario.id, condition_node_id, success_assert_id, 'true'),
      (created_scenario.workflow_id, created_scenario.id, condition_node_id, failure_capture_id, 'false'),
      (created_scenario.workflow_id, created_scenario.id, failure_capture_id, failure_assert_id, 'default');

    created := created || to_jsonb(created_scenario);
  END LOOP;

  RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.form_test_apply_generated_suite(UUID, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_test_apply_generated_suite(UUID, JSONB, UUID) TO service_role;
