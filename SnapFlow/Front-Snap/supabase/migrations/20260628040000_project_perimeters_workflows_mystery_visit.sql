-- Remaining product tickets:
-- - editable project activity perimeters
-- - optional project-linked form workflows
-- - one-time randomized mystery visit schedules

CREATE TABLE IF NOT EXISTS public.project_perimeter_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subtitle TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_perimeter_blocks_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT project_perimeter_blocks_items_array CHECK (jsonb_typeof(items) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_project_perimeter_blocks_project_order
  ON public.project_perimeter_blocks(project_id, display_order, created_at);

ALTER TABLE public.project_perimeter_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_perimeter_blocks_admin_all" ON public.project_perimeter_blocks;
CREATE POLICY "project_perimeter_blocks_admin_all"
  ON public.project_perimeter_blocks FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "project_perimeter_blocks_assigned_select" ON public.project_perimeter_blocks;
CREATE POLICY "project_perimeter_blocks_assigned_select"
  ON public.project_perimeter_blocks FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_assignments pa
      WHERE pa.project_id = project_perimeter_blocks.project_id
        AND pa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "project_perimeter_blocks_charge_manage" ON public.project_perimeter_blocks;
CREATE POLICY "project_perimeter_blocks_charge_manage"
  ON public.project_perimeter_blocks FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_assignments pa
      JOIN public.user_roles ur ON ur.user_id = pa.user_id
      WHERE pa.project_id = project_perimeter_blocks.project_id
        AND pa.user_id = auth.uid()
        AND ur.role = 'charge_de_projet'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.project_assignments pa
      JOIN public.user_roles ur ON ur.user_id = pa.user_id
      WHERE pa.project_id = project_perimeter_blocks.project_id
        AND pa.user_id = auth.uid()
        AND ur.role = 'charge_de_projet'
    )
  );

DROP TRIGGER IF EXISTS trg_project_perimeter_blocks_updated_at ON public.project_perimeter_blocks;
CREATE TRIGGER trg_project_perimeter_blocks_updated_at
  BEFORE UPDATE ON public.project_perimeter_blocks
  FOR EACH ROW EXECUTE FUNCTION public.form_tester_set_updated_at();

ALTER TABLE public.form_workflows
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_form_workflows_project_id
  ON public.form_workflows(project_id);

DROP POLICY IF EXISTS "form_workflows_project_linked_select" ON public.form_workflows;
CREATE POLICY "form_workflows_project_linked_select"
  ON public.form_workflows FOR SELECT
  USING (
    project_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.project_assignments pa
      WHERE pa.project_id = form_workflows.project_id
        AND pa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "form_workflows_project_linked_manage" ON public.form_workflows;
CREATE POLICY "form_workflows_project_linked_manage"
  ON public.form_workflows FOR ALL
  USING (
    project_id IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1
        FROM public.project_assignments pa
        JOIN public.user_roles ur ON ur.user_id = pa.user_id
        WHERE pa.project_id = form_workflows.project_id
          AND pa.user_id = auth.uid()
          AND ur.role = 'charge_de_projet'
      )
    )
  )
  WITH CHECK (
    project_id IS NULL
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.project_assignments pa
      JOIN public.user_roles ur ON ur.user_id = pa.user_id
      WHERE pa.project_id = form_workflows.project_id
        AND pa.user_id = auth.uid()
        AND ur.role = 'charge_de_projet'
    )
  );

ALTER TABLE public.report_schedules
  ADD COLUMN IF NOT EXISTS mystery_window_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mystery_window_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mystery_allowed_start_hour INTEGER,
  ADD COLUMN IF NOT EXISTS mystery_allowed_end_hour INTEGER,
  ADD COLUMN IF NOT EXISTS mystery_randomized_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.report_schedules'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%report_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.report_schedules DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;

  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.report_schedules'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%frequency%'
  LOOP
    EXECUTE format('ALTER TABLE public.report_schedules DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.report_schedules
  ADD CONSTRAINT report_schedules_report_type_check
  CHECK (report_type IN ('audit', 'activity', 'mystery_visit')),
  ADD CONSTRAINT report_schedules_frequency_check
  CHECK (frequency IN ('once', 'daily', 'weekly', 'biweekly', 'monthly')),
  ADD CONSTRAINT report_schedules_mystery_hours_check
  CHECK (
    report_type <> 'mystery_visit'
    OR (
      mystery_window_start IS NOT NULL
      AND mystery_window_end IS NOT NULL
      AND mystery_randomized_run_at IS NOT NULL
      AND mystery_allowed_start_hour BETWEEN 0 AND 23
      AND mystery_allowed_end_hour BETWEEN 1 AND 24
      AND mystery_allowed_start_hour < mystery_allowed_end_hour
      AND mystery_window_start <= mystery_randomized_run_at
      AND mystery_randomized_run_at <= mystery_window_end
    )
  );

CREATE INDEX IF NOT EXISTS idx_report_schedules_mystery_visit
  ON public.report_schedules(project_id, mystery_randomized_run_at)
  WHERE report_type = 'mystery_visit';
