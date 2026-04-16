
-- Fix the broken RLS policy on projects
DROP POLICY IF EXISTS "Chargés can view assigned projects" ON public.projects;

CREATE POLICY "Chargés can view assigned projects"
ON public.projects
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.project_assignments pa
    WHERE pa.project_id = projects.id
      AND pa.user_id = auth.uid()
  )
);
