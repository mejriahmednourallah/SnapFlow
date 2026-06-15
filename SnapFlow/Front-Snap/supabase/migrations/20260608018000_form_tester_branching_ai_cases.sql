-- Form Tester: typed branches and AI-generated test case scenarios.

ALTER TABLE public.workflow_edges
  ADD COLUMN IF NOT EXISTS branch_key TEXT NOT NULL DEFAULT 'default';

ALTER TABLE public.workflow_edges
  DROP CONSTRAINT IF EXISTS workflow_edges_branch_key_check;

ALTER TABLE public.workflow_edges
  ADD CONSTRAINT workflow_edges_branch_key_check
  CHECK (branch_key IN ('default', 'success', 'failure', 'true', 'false'));

CREATE INDEX IF NOT EXISTS idx_workflow_edges_scenario_source_branch
  ON public.workflow_edges(scenario_id, source_node_id, branch_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_edges_scenario_source_branch
  ON public.workflow_edges(scenario_id, source_node_id, branch_key);

ALTER TABLE public.form_test_scenarios
  ADD COLUMN IF NOT EXISTS expected_outcome TEXT NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS source_scenario_id UUID
    REFERENCES public.form_test_scenarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS generation_source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS case_definition JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.form_test_scenarios
  DROP CONSTRAINT IF EXISTS form_test_scenarios_expected_outcome_check;

ALTER TABLE public.form_test_scenarios
  ADD CONSTRAINT form_test_scenarios_expected_outcome_check
  CHECK (
    expected_outcome IN (
      'success',
      'validation_error',
      'server_error',
      'blocked'
    )
  );

ALTER TABLE public.form_test_scenarios
  DROP CONSTRAINT IF EXISTS form_test_scenarios_generation_source_check;

ALTER TABLE public.form_test_scenarios
  ADD CONSTRAINT form_test_scenarios_generation_source_check
  CHECK (generation_source IN ('manual', 'detected', 'ai', 'clone'));

CREATE OR REPLACE FUNCTION public.form_test_build_scenario_snapshot(p_scenario_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'schema_version', 2,
    'scenario', jsonb_build_object(
      'id', scenario.id,
      'workflow_id', scenario.workflow_id,
      'name', scenario.name,
      'description', scenario.description,
      'expected_outcome', scenario.expected_outcome,
      'source_scenario_id', scenario.source_scenario_id,
      'generation_source', scenario.generation_source,
      'case_definition', scenario.case_definition
    ),
    'workflow', jsonb_build_object(
      'id', workflow.id,
      'name', workflow.name,
      'target_url', workflow.target_url
    ),
    'nodes', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', node.id,
          'type', node.type,
          'order_index', node.order_index,
          'position_x', node.position_x,
          'position_y', node.position_y,
          'config', node.config
        )
        ORDER BY node.order_index, node.id
      )
      FROM public.workflow_nodes node
      WHERE node.scenario_id = scenario.id
    ), '[]'::jsonb),
    'fields', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', field.id,
          'node_id', field.node_id,
          'field_name', field.field_name,
          'field_type', field.field_type,
          'field_label', field.field_label,
          'field_selector', field.field_selector,
          'placeholder', field.placeholder,
          'required', field.required,
          'ai_suggestion', field.ai_suggestion,
          'user_value', field.user_value,
          'is_sensitive', field.is_sensitive
        )
        ORDER BY field.created_at, field.id
      )
      FROM public.workflow_form_fields field
      WHERE field.scenario_id = scenario.id
    ), '[]'::jsonb),
    'edges', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', edge.id,
          'source_node_id', edge.source_node_id,
          'target_node_id', edge.target_node_id,
          'branch_key', edge.branch_key
        )
        ORDER BY edge.created_at, edge.id
      )
      FROM public.workflow_edges edge
      WHERE edge.scenario_id = scenario.id
    ), '[]'::jsonb)
  )
  FROM public.form_test_scenarios scenario
  JOIN public.form_workflows workflow ON workflow.id = scenario.workflow_id
  WHERE scenario.id = p_scenario_id;
$$;

CREATE OR REPLACE FUNCTION public.form_test_clone_scenario_case(
  p_source_scenario_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_expected_outcome TEXT,
  p_generation_source TEXT,
  p_case_definition JSONB,
  p_created_by UUID
)
RETURNS public.form_test_scenarios
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source_scenario public.form_test_scenarios;
  created_scenario public.form_test_scenarios;
  source_node RECORD;
  source_field RECORD;
  source_edge RECORD;
  new_node_id UUID;
  node_map JSONB := '{}'::jsonb;
  mutation_value TEXT;
  mapped_true_id TEXT;
  mapped_false_id TEXT;
BEGIN
  SELECT *
  INTO source_scenario
  FROM public.form_test_scenarios
  WHERE id = p_source_scenario_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source scenario not found';
  END IF;

  IF p_expected_outcome NOT IN ('success', 'validation_error', 'server_error', 'blocked') THEN
    RAISE EXCEPTION 'Invalid expected outcome';
  END IF;

  IF p_generation_source NOT IN ('manual', 'detected', 'ai', 'clone') THEN
    RAISE EXCEPTION 'Invalid generation source';
  END IF;

  INSERT INTO public.form_test_scenarios (
    workflow_id,
    org_id,
    created_by,
    name,
    description,
    status,
    is_default,
    expected_outcome,
    source_scenario_id,
    generation_source,
    case_definition
  ) VALUES (
    source_scenario.workflow_id,
    source_scenario.org_id,
    p_created_by,
    trim(p_name),
    NULLIF(trim(COALESCE(p_description, '')), ''),
    'draft',
    false,
    p_expected_outcome,
    source_scenario.id,
    p_generation_source,
    COALESCE(p_case_definition, '{}'::jsonb)
  )
  RETURNING * INTO created_scenario;

  FOR source_node IN
    SELECT *
    FROM public.workflow_nodes
    WHERE scenario_id = source_scenario.id
    ORDER BY order_index, id
  LOOP
    new_node_id := gen_random_uuid();
    node_map := node_map || jsonb_build_object(source_node.id::text, new_node_id::text);

    INSERT INTO public.workflow_nodes (
      id,
      workflow_id,
      scenario_id,
      type,
      order_index,
      position_x,
      position_y,
      config
    ) VALUES (
      new_node_id,
      source_node.workflow_id,
      created_scenario.id,
      source_node.type,
      source_node.order_index,
      source_node.position_x,
      source_node.position_y,
      source_node.config
    );
  END LOOP;

  FOR source_node IN
    SELECT *
    FROM public.workflow_nodes
    WHERE scenario_id = source_scenario.id
      AND type = 'condition'
  LOOP
    mapped_true_id := node_map ->> (source_node.config ->> 'true_node_id');
    mapped_false_id := node_map ->> (source_node.config ->> 'false_node_id');

    UPDATE public.workflow_nodes
    SET config = config
      || CASE
        WHEN mapped_true_id IS NOT NULL
          THEN jsonb_build_object('true_node_id', mapped_true_id)
        ELSE '{}'::jsonb
      END
      || CASE
        WHEN mapped_false_id IS NOT NULL
          THEN jsonb_build_object('false_node_id', mapped_false_id)
        ELSE '{}'::jsonb
      END
    WHERE id = (node_map ->> source_node.id::text)::uuid;
  END LOOP;

  FOR source_field IN
    SELECT *
    FROM public.workflow_form_fields
    WHERE scenario_id = source_scenario.id
    ORDER BY created_at, id
  LOOP
    mutation_value := NULL;

    SELECT mutation ->> 'value'
    INTO mutation_value
    FROM jsonb_array_elements(
      COALESCE(p_case_definition -> 'field_mutations', '[]'::jsonb)
    ) AS mutation
    WHERE mutation ->> 'field_id' = source_field.id::text
       OR (
         COALESCE(mutation ->> 'field_id', '') = ''
         AND mutation ->> 'field_name' = source_field.field_name
       )
    LIMIT 1;

    INSERT INTO public.workflow_form_fields (
      node_id,
      workflow_id,
      scenario_id,
      field_name,
      field_type,
      field_label,
      field_selector,
      placeholder,
      required,
      ai_suggestion,
      user_value,
      is_sensitive
    ) VALUES (
      (node_map ->> source_field.node_id::text)::uuid,
      source_field.workflow_id,
      created_scenario.id,
      source_field.field_name,
      source_field.field_type,
      source_field.field_label,
      source_field.field_selector,
      source_field.placeholder,
      source_field.required,
      source_field.ai_suggestion,
      CASE
        WHEN mutation_value IS NOT NULL THEN mutation_value
        ELSE source_field.user_value
      END,
      source_field.is_sensitive
    );
  END LOOP;

  FOR source_edge IN
    SELECT *
    FROM public.workflow_edges
    WHERE scenario_id = source_scenario.id
    ORDER BY created_at, id
  LOOP
    INSERT INTO public.workflow_edges (
      workflow_id,
      scenario_id,
      source_node_id,
      target_node_id,
      branch_key
    ) VALUES (
      source_edge.workflow_id,
      created_scenario.id,
      (node_map ->> source_edge.source_node_id::text)::uuid,
      (node_map ->> source_edge.target_node_id::text)::uuid,
      source_edge.branch_key
    );
  END LOOP;

  RETURN created_scenario;
END;
$$;

REVOKE ALL ON FUNCTION public.form_test_clone_scenario_case(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.form_test_clone_scenario_case(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID
) TO service_role;
