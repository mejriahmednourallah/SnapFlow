CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE RESTRICT;

INSERT INTO public.clients (name)
SELECT DISTINCT COALESCE(NULLIF(trim(site_name), ''), 'Client ' || id::text)
FROM public.projects p
WHERE p.client_id IS NULL
ON CONFLICT (name) DO NOTHING;

UPDATE public.projects p
SET client_id = c.id
FROM public.clients c
WHERE p.client_id IS NULL
  AND c.name = COALESCE(NULLIF(trim(p.site_name), ''), 'Client ' || p.id::text);

ALTER TABLE public.projects
  ALTER COLUMN client_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_client_id ON public.projects(client_id);

DROP POLICY IF EXISTS "Admins can manage clients" ON public.clients;
CREATE POLICY "Admins can manage clients"
  ON public.clients FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Assigned users can view project clients" ON public.clients;
CREATE POLICY "Assigned users can view project clients"
  ON public.clients FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.project_assignments pa ON pa.project_id = p.id
      WHERE p.client_id = clients.id
        AND pa.user_id = auth.uid()
    )
  );