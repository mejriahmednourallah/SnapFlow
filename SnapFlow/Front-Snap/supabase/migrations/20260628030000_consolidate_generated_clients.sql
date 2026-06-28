DO $$
DECLARE
  holding_client_id uuid;
BEGIN
  INSERT INTO public.clients (name)
  VALUES ('A classer')
  ON CONFLICT (name) DO NOTHING;

  SELECT id INTO holding_client_id
  FROM public.clients
  WHERE name = 'A classer';

  WITH generated_clients AS (
    SELECT c.id
    FROM public.clients c
    JOIN public.projects p ON p.client_id = c.id
    WHERE c.name = p.site_name
    GROUP BY c.id, c.name
    HAVING count(p.id) = 1
  )
  UPDATE public.projects p
  SET client_id = holding_client_id
  WHERE p.client_id IN (SELECT id FROM generated_clients);

  DELETE FROM public.clients c
  WHERE c.name <> 'A classer'
    AND NOT EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.client_id = c.id
    );
END $$;
