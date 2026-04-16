
-- Table for scheduled reports
CREATE TABLE public.report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('audit', 'activity')),
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly')),
  day_of_week integer, -- 0=Sunday..6=Saturday for weekly
  day_of_month integer, -- 1-28 for monthly
  next_run_at timestamp with time zone NOT NULL,
  last_run_at timestamp with time zone,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;

-- Admin can do everything
CREATE POLICY "Admins can manage all schedules"
ON public.report_schedules FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- Chargés can manage schedules for their assigned projects
CREATE POLICY "Chargés can view own schedules"
ON public.report_schedules FOR SELECT
USING (
  created_by = auth.uid() OR
  EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.project_id = report_schedules.project_id AND pa.user_id = auth.uid())
);

CREATE POLICY "Chargés can create schedules for assigned projects"
ON public.report_schedules FOR INSERT
WITH CHECK (
  created_by = auth.uid() AND
  EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.project_id = report_schedules.project_id AND pa.user_id = auth.uid())
);

CREATE POLICY "Chargés can update own schedules"
ON public.report_schedules FOR UPDATE
USING (
  created_by = auth.uid() AND
  EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.project_id = report_schedules.project_id AND pa.user_id = auth.uid())
);

CREATE POLICY "Chargés can delete own schedules"
ON public.report_schedules FOR DELETE
USING (
  created_by = auth.uid() AND
  EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.project_id = report_schedules.project_id AND pa.user_id = auth.uid())
);
