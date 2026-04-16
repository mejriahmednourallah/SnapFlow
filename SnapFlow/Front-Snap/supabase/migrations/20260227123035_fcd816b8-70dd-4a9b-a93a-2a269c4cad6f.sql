
-- Projects table
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL,
  site_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Project assignments (link projects to chargés)
CREATE TABLE public.project_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id)
);

ALTER TABLE public.project_assignments ENABLE ROW LEVEL SECURITY;

-- RLS for projects: chargés see only assigned, admins see all
CREATE POLICY "Admins can manage all projects"
  ON public.projects FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Chargés can view assigned projects"
  ON public.projects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_assignments pa
      WHERE pa.project_id = id AND pa.user_id = auth.uid()
    )
  );

-- RLS for project_assignments
CREATE POLICY "Admins can manage assignments"
  ON public.project_assignments FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Chargés can view own assignments"
  ON public.project_assignments FOR SELECT
  USING (auth.uid() = user_id);

-- Admin can view all profiles
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Allow profile insert from trigger
CREATE POLICY "Service can insert profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Admins can delete profiles (for user management)
CREATE POLICY "Admins can delete profiles"
  ON public.profiles FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));
