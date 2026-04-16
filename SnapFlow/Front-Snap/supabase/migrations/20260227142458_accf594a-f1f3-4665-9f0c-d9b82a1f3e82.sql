
-- Create activity_reports table for storing generated activity reports from Redmine tickets
CREATE TABLE public.activity_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  archived_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  filters JSONB DEFAULT NULL,
  report_data JSONB DEFAULT NULL,
  ticket_count INTEGER DEFAULT 0
);

ALTER TABLE public.activity_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all activity reports"
  ON public.activity_reports FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Chargés can view assigned project activity reports"
  ON public.activity_reports FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_assignments pa
    WHERE pa.project_id = activity_reports.project_id AND pa.user_id = auth.uid()
  ));

CREATE POLICY "Chargés can create activity reports for assigned projects"
  ON public.activity_reports FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM project_assignments pa
    WHERE pa.project_id = activity_reports.project_id AND pa.user_id = auth.uid()
  ));
