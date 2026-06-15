-- Form Tester V1: scenarios, immutable versions and execution provenance.
-- This migration is additive and backfills every existing workflow.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.form_test_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.form_workflows(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_form_test_scenarios_default
  ON public.form_test_scenarios(workflow_id)
  WHERE is_default;

CREATE TABLE IF NOT EXISTS public.form_scenario_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES public.form_test_scenarios(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES public.form_workflows(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  checksum TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  submission_note TEXT,
  approval_note TEXT,
  rejection_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  UNIQUE (scenario_id, version_number)
);

ALTER TABLE public.workflow_nodes
  ADD COLUMN IF NOT EXISTS scenario_id UUID REFERENCES public.form_test_scenarios(id) ON DELETE CASCADE;

ALTER TABLE public.workflow_edges
  ADD COLUMN IF NOT EXISTS scenario_id UUID REFERENCES public.form_test_scenarios(id) ON DELETE CASCADE;

ALTER TABLE public.workflow_form_fields
  ADD COLUMN IF NOT EXISTS scenario_id UUID REFERENCES public.form_test_scenarios(id) ON DELETE CASCADE;

ALTER TABLE public.workflow_results
  ADD COLUMN IF NOT EXISTS scenario_id UUID REFERENCES public.form_test_scenarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scenario_version_id UUID REFERENCES public.form_scenario_versions(id) ON DELETE SET NULL;

INSERT INTO public.form_test_scenarios (
  workflow_id,
  org_id,
  created_by,
  name,
  description,
  status,
  is_default,
  created_at,
  updated_at
)
SELECT
  fw.id,
  fw.org_id,
  fw.created_by,
  'Scenario principal',
  'Scenario cree automatiquement depuis le workflow historique.',
  CASE
    WHEN fw.status IN ('approved', 'executed') THEN 'approved'
    WHEN fw.status IN ('pending', 'needs_review') THEN 'pending'
    ELSE 'draft'
  END,
  true,
  fw.created_at,
  fw.updated_at
FROM public.form_workflows fw
WHERE NOT EXISTS (
  SELECT 1
  FROM public.form_test_scenarios scenario
  WHERE scenario.workflow_id = fw.id
);

UPDATE public.workflow_nodes node
SET scenario_id = scenario.id
FROM public.form_test_scenarios scenario
WHERE node.workflow_id = scenario.workflow_id
  AND scenario.is_default
  AND node.scenario_id IS NULL;

UPDATE public.workflow_edges edge
SET scenario_id = scenario.id
FROM public.form_test_scenarios scenario
WHERE edge.workflow_id = scenario.workflow_id
  AND scenario.is_default
  AND edge.scenario_id IS NULL;

UPDATE public.workflow_form_fields field
SET scenario_id = scenario.id
FROM public.form_test_scenarios scenario
WHERE field.workflow_id = scenario.workflow_id
  AND scenario.is_default
  AND field.scenario_id IS NULL;

ALTER TABLE public.workflow_nodes ALTER COLUMN scenario_id SET NOT NULL;
ALTER TABLE public.workflow_edges ALTER COLUMN scenario_id SET NOT NULL;
ALTER TABLE public.workflow_form_fields ALTER COLUMN scenario_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.form_test_build_scenario_snapshot(p_scenario_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'schema_version', 1,
    'scenario', jsonb_build_object(
      'id', scenario.id,
      'workflow_id', scenario.workflow_id,
      'name', scenario.name,
      'description', scenario.description
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
          'target_node_id', edge.target_node_id
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

CREATE OR REPLACE FUNCTION public.form_test_snapshot_checksum(p_snapshot JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT encode(extensions.digest(convert_to(p_snapshot::text, 'UTF8'), 'sha256'), 'hex');
$$;

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
  created_at,
  submitted_at,
  approved_at
)
SELECT
  scenario.id,
  scenario.workflow_id,
  1,
  CASE
    WHEN workflow.status IN ('approved', 'executed') THEN 'approved'
    WHEN workflow.status IN ('pending', 'needs_review') THEN 'pending'
    ELSE 'draft'
  END,
  public.form_test_snapshot_checksum(snapshot.payload),
  snapshot.payload,
  workflow.created_by,
  CASE WHEN workflow.status IN ('pending', 'needs_review', 'approved', 'executed') THEN workflow.created_by ELSE NULL END,
  CASE WHEN workflow.status IN ('approved', 'executed') THEN workflow.approved_by ELSE NULL END,
  workflow.created_at,
  CASE WHEN workflow.status IN ('pending', 'needs_review', 'approved', 'executed') THEN workflow.updated_at ELSE NULL END,
  CASE WHEN workflow.status IN ('approved', 'executed') THEN workflow.approved_at ELSE NULL END
FROM public.form_test_scenarios scenario
JOIN public.form_workflows workflow ON workflow.id = scenario.workflow_id
CROSS JOIN LATERAL (
  SELECT public.form_test_build_scenario_snapshot(scenario.id) AS payload
) snapshot
WHERE NOT EXISTS (
  SELECT 1
  FROM public.form_scenario_versions version
  WHERE version.scenario_id = scenario.id
);

UPDATE public.workflow_results result
SET
  scenario_id = scenario.id,
  scenario_version_id = version.id
FROM public.form_test_scenarios scenario
JOIN public.form_scenario_versions version
  ON version.scenario_id = scenario.id
 AND version.version_number = 1
WHERE result.workflow_id = scenario.workflow_id
  AND result.scenario_id IS NULL;

CREATE OR REPLACE FUNCTION public.form_test_create_scenario_version(
  p_scenario_id UUID,
  p_created_by UUID,
  p_status TEXT DEFAULT 'draft',
  p_note TEXT DEFAULT NULL
)
RETURNS public.form_scenario_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  scenario_row public.form_test_scenarios;
  snapshot_payload JSONB;
  next_version INTEGER;
  created_version public.form_scenario_versions;
BEGIN
  IF p_status NOT IN ('draft', 'pending') THEN
    RAISE EXCEPTION 'A new scenario version must be draft or pending';
  END IF;

  SELECT *
  INTO scenario_row
  FROM public.form_test_scenarios
  WHERE id = p_scenario_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scenario not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_scenario_id::text, 0));

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO next_version
  FROM public.form_scenario_versions
  WHERE scenario_id = p_scenario_id;

  snapshot_payload := public.form_test_build_scenario_snapshot(p_scenario_id);

  INSERT INTO public.form_scenario_versions (
    scenario_id,
    workflow_id,
    version_number,
    status,
    checksum,
    snapshot,
    created_by,
    submitted_by,
    submission_note,
    submitted_at
  )
  VALUES (
    p_scenario_id,
    scenario_row.workflow_id,
    next_version,
    p_status,
    public.form_test_snapshot_checksum(snapshot_payload),
    snapshot_payload,
    p_created_by,
    CASE WHEN p_status = 'pending' THEN p_created_by ELSE NULL END,
    CASE WHEN p_status = 'pending' THEN p_note ELSE NULL END,
    CASE WHEN p_status = 'pending' THEN now() ELSE NULL END
  )
  RETURNING * INTO created_version;

  UPDATE public.form_test_scenarios
  SET status = p_status, updated_at = now()
  WHERE id = p_scenario_id;

  RETURN created_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.form_test_guard_scenario_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'approved' THEN
    RAISE EXCEPTION 'Approved scenario versions are immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Approved scenario versions are immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' THEN
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'approved_by is required';
    END IF;

    IF NEW.approved_by = NEW.created_by
       AND NOT public.has_role(NEW.approved_by, 'admin') THEN
      RAISE EXCEPTION 'A client cannot approve their own scenario version';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_form_scenario_versions_guard ON public.form_scenario_versions;
CREATE TRIGGER trg_form_scenario_versions_guard
  BEFORE UPDATE OR DELETE ON public.form_scenario_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.form_test_guard_scenario_version();

REVOKE ALL ON FUNCTION public.form_test_build_scenario_snapshot(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.form_test_create_scenario_version(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_test_build_scenario_snapshot(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.form_test_create_scenario_version(UUID, UUID, TEXT, TEXT) TO service_role;

CREATE INDEX IF NOT EXISTS idx_form_test_scenarios_workflow
  ON public.form_test_scenarios(workflow_id);
CREATE INDEX IF NOT EXISTS idx_form_scenario_versions_scenario
  ON public.form_scenario_versions(scenario_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_form_scenario_versions_status
  ON public.form_scenario_versions(status);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_scenario
  ON public.workflow_nodes(scenario_id, order_index);
CREATE INDEX IF NOT EXISTS idx_workflow_edges_scenario
  ON public.workflow_edges(scenario_id);
CREATE INDEX IF NOT EXISTS idx_workflow_fields_scenario
  ON public.workflow_form_fields(scenario_id);
CREATE INDEX IF NOT EXISTS idx_workflow_results_scenario_version
  ON public.workflow_results(scenario_version_id, executed_at DESC);

ALTER TABLE public.form_test_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_scenario_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_test_scenarios_select_accessible"
  ON public.form_test_scenarios FOR SELECT
  USING (
    created_by = auth.uid()
    OR org_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "form_test_scenarios_insert_owner"
  ON public.form_test_scenarios FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND org_id = auth.uid()
  );

CREATE POLICY "form_test_scenarios_update_draft_owner_or_admin"
  ON public.form_test_scenarios FOR UPDATE
  USING (
    (created_by = auth.uid() AND status IN ('draft', 'rejected'))
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    (
      created_by = auth.uid()
      AND org_id = auth.uid()
      AND status IN ('draft', 'pending', 'rejected')
    )
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "form_test_scenarios_delete_draft_owner_or_admin"
  ON public.form_test_scenarios FOR DELETE
  USING (
    (created_by = auth.uid() AND status IN ('draft', 'rejected'))
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "form_scenario_versions_select_accessible"
  ON public.form_scenario_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.form_test_scenarios scenario
      WHERE scenario.id = form_scenario_versions.scenario_id
        AND (
          scenario.created_by = auth.uid()
          OR scenario.org_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

CREATE POLICY "form_scenario_versions_insert_owner"
  ON public.form_scenario_versions FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND status IN ('draft', 'pending')
    AND EXISTS (
      SELECT 1
      FROM public.form_test_scenarios scenario
      WHERE scenario.id = form_scenario_versions.scenario_id
        AND scenario.created_by = auth.uid()
    )
  );

CREATE POLICY "form_scenario_versions_update_owner_or_admin"
  ON public.form_scenario_versions FOR UPDATE
  USING (
    (
      created_by = auth.uid()
      AND status IN ('draft', 'pending', 'rejected')
    )
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    (
      created_by = auth.uid()
      AND status IN ('draft', 'pending', 'rejected')
      AND approved_by IS NULL
    )
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "form_scenario_versions_delete_draft_owner_or_admin"
  ON public.form_scenario_versions FOR DELETE
  USING (
    (created_by = auth.uid() AND status IN ('draft', 'rejected'))
    OR public.has_role(auth.uid(), 'admin')
  );

COMMENT ON TABLE public.form_test_scenarios IS
  'Reusable form-testing scenarios owned by a workflow.';
COMMENT ON TABLE public.form_scenario_versions IS
  'Immutable execution snapshots. Approved rows cannot be modified or deleted.';
COMMENT ON COLUMN public.form_scenario_versions.checksum IS
  'SHA-256 checksum of the canonical JSONB snapshot.';
COMMENT ON COLUMN public.workflow_results.scenario_version_id IS
  'Exact immutable scenario version used for this execution.';
