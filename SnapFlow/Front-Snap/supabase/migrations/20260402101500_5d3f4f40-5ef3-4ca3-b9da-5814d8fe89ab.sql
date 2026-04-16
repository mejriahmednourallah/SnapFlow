-- ============================================================
-- MIGRATION : SnapFlow Form Tester (Vite + Supabase)
-- Date : 2026-04-02
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- TABLE PRINCIPALE : form_workflows
-- ------------------------------------------------------------
CREATE TABLE public.form_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'approved', 'executed')),
  approved_by UUID REFERENCES auth.users(id),
  approval_note TEXT,
  rejection_note TEXT,
  detected_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.form_workflows IS
  'Workflows de test de formulaires autonomes et reutilisables.';

COMMENT ON COLUMN public.form_workflows.status IS
  'draft=en configuration | pending=en attente approbation | approved=approuve | executed=execute';

-- ------------------------------------------------------------
-- TABLE : workflow_nodes
-- ------------------------------------------------------------
CREATE TABLE public.workflow_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.form_workflows(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('trigger', 'form_fill', 'submit', 'assert')),
  order_index INTEGER NOT NULL DEFAULT 0,
  position_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  position_y DOUBLE PRECISION NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.workflow_nodes.config IS
  'trigger:{url} | form_fill:{field_id} | submit:{selector,wait_for} | assert:{type,value,label}';

-- ------------------------------------------------------------
-- TABLE : workflow_form_fields
-- ------------------------------------------------------------
CREATE TABLE public.workflow_form_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES public.form_workflows(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL,
  field_label TEXT,
  field_selector TEXT NOT NULL,
  placeholder TEXT,
  required BOOLEAN NOT NULL DEFAULT false,
  ai_suggestion TEXT,
  user_value TEXT,
  is_sensitive BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.workflow_form_fields.user_value IS
  'Priorite absolue a l execution. Si NULL, la suggestion IA est utilisee.';

COMMENT ON COLUMN public.workflow_form_fields.is_sensitive IS
  'Champ sensible : ne pas proposer de valeur auto.';

-- ------------------------------------------------------------
-- TABLE : workflow_edges
-- ------------------------------------------------------------
CREATE TABLE public.workflow_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.form_workflows(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_node_id, target_node_id)
);

-- ------------------------------------------------------------
-- TABLE : workflow_results
-- ------------------------------------------------------------
CREATE TABLE public.workflow_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.form_workflows(id) ON DELETE CASCADE,
  executed_by UUID REFERENCES auth.users(id),
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'error')),
  duration_ms INTEGER,
  assertions JSONB NOT NULL DEFAULT '[]'::jsonb,
  screenshot_url TEXT,
  error_message TEXT,
  audit_run_id UUID
);

COMMENT ON COLUMN public.workflow_results.assertions IS
  'Tableau JSON: [{label, expected, actual, passed}]';

-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------
CREATE INDEX idx_form_workflows_org_id ON public.form_workflows(org_id);
CREATE INDEX idx_form_workflows_created_by ON public.form_workflows(created_by);
CREATE INDEX idx_form_workflows_status ON public.form_workflows(status);
CREATE INDEX idx_form_workflows_updated_at ON public.form_workflows(updated_at DESC);

CREATE INDEX idx_workflow_nodes_workflow_id ON public.workflow_nodes(workflow_id);
CREATE INDEX idx_workflow_nodes_order ON public.workflow_nodes(workflow_id, order_index);

CREATE INDEX idx_workflow_form_fields_node_id ON public.workflow_form_fields(node_id);
CREATE INDEX idx_workflow_form_fields_workflow_id ON public.workflow_form_fields(workflow_id);

CREATE INDEX idx_workflow_edges_workflow_id ON public.workflow_edges(workflow_id);
CREATE INDEX idx_workflow_edges_source ON public.workflow_edges(source_node_id);
CREATE INDEX idx_workflow_edges_target ON public.workflow_edges(target_node_id);

CREATE INDEX idx_workflow_results_workflow_id ON public.workflow_results(workflow_id);
CREATE INDEX idx_workflow_results_executed_at ON public.workflow_results(executed_at DESC);

-- ------------------------------------------------------------
-- TRIGGER : auto-update updated_at sur form_workflows
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.form_tester_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_form_workflows_set_updated_at
  BEFORE UPDATE ON public.form_workflows
  FOR EACH ROW
  EXECUTE FUNCTION public.form_tester_set_updated_at();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.form_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_results ENABLE ROW LEVEL SECURITY;

-- form_workflows
CREATE POLICY "form_workflows_select_owner_or_admin"
  ON public.form_workflows FOR SELECT
  USING (
    created_by = auth.uid()
    OR org_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "form_workflows_insert_owner"
  ON public.form_workflows FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND org_id = auth.uid()
  );

CREATE POLICY "form_workflows_update_draft_owner_or_admin"
  ON public.form_workflows FOR UPDATE
  USING (
    (
      created_by = auth.uid()
      AND status = 'draft'
    )
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    (
      created_by = auth.uid()
      AND org_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "form_workflows_delete_draft_owner_or_admin"
  ON public.form_workflows FOR DELETE
  USING (
    (
      created_by = auth.uid()
      AND status = 'draft'
    )
    OR public.has_role(auth.uid(), 'admin')
  );

-- workflow_nodes
CREATE POLICY "workflow_nodes_select_owner_or_admin"
  ON public.workflow_nodes FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.form_workflows fw
      WHERE fw.id = workflow_nodes.workflow_id
        AND (
          fw.created_by = auth.uid()
          OR fw.org_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

CREATE POLICY "workflow_nodes_mutate_draft_owner_or_admin"
  ON public.workflow_nodes FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.form_workflows fw
      WHERE fw.id = workflow_nodes.workflow_id
        AND (
          (fw.created_by = auth.uid() AND fw.status = 'draft')
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.form_workflows fw
      WHERE fw.id = workflow_nodes.workflow_id
        AND (
          (fw.created_by = auth.uid() AND fw.status = 'draft')
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

-- workflow_form_fields
CREATE POLICY "workflow_form_fields_select_owner_or_admin"
  ON public.workflow_form_fields FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.form_workflows fw
      WHERE fw.id = workflow_form_fields.workflow_id
        AND (
          fw.created_by = auth.uid()
          OR fw.org_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

CREATE POLICY "workflow_form_fields_mutate_draft_owner_or_admin"
  ON public.workflow_form_fields FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.form_workflows fw
      WHERE fw.id = workflow_form_fields.workflow_id
        AND (
          (fw.created_by = auth.uid() AND fw.status = 'draft')
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.form_workflows fw
      WHERE fw.id = workflow_form_fields.workflow_id
        AND (
          (fw.created_by = auth.uid() AND fw.status = 'draft')
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

-- workflow_edges
CREATE POLICY "workflow_edges_select_owner_or_admin"
  ON public.workflow_edges FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.form_workflows fw
      WHERE fw.id = workflow_edges.workflow_id
        AND (
          fw.created_by = auth.uid()
          OR fw.org_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

CREATE POLICY "workflow_edges_mutate_draft_owner_or_admin"
  ON public.workflow_edges FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.form_workflows fw
      WHERE fw.id = workflow_edges.workflow_id
        AND (
          (fw.created_by = auth.uid() AND fw.status = 'draft')
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.form_workflows fw
      WHERE fw.id = workflow_edges.workflow_id
        AND (
          (fw.created_by = auth.uid() AND fw.status = 'draft')
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

-- workflow_results
CREATE POLICY "workflow_results_select_owner_or_admin"
  ON public.workflow_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.form_workflows fw
      WHERE fw.id = workflow_results.workflow_id
        AND (
          fw.created_by = auth.uid()
          OR fw.org_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

CREATE POLICY "workflow_results_insert_admin_only"
  ON public.workflow_results FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
