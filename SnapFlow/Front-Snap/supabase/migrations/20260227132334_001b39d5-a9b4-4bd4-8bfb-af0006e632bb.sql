
-- Create audits table to store generated audit reports per project
CREATE TABLE public.audits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'completed', 'error')),
  report_data JSONB,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;

-- Admins can manage all audits
CREATE POLICY "Admins can manage all audits"
  ON public.audits FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Chargés can view audits for their assigned projects
CREATE POLICY "Chargés can view assigned project audits"
  ON public.audits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = audits.project_id AND pa.user_id = auth.uid()
    )
  );

-- Chargés can insert audits for their assigned projects
CREATE POLICY "Chargés can create audits for assigned projects"
  ON public.audits FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = audits.project_id AND pa.user_id = auth.uid()
    )
  );

-- Chargés can update audits for their assigned projects
CREATE POLICY "Chargés can update assigned project audits"
  ON public.audits FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = audits.project_id AND pa.user_id = auth.uid()
    )
  );

-- Index for fast lookup
CREATE INDEX idx_audits_project_id ON public.audits(project_id);
CREATE INDEX idx_audits_status ON public.audits(status);
