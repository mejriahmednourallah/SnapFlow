-- Supabase installs pgcrypto functions in the extensions schema.

CREATE OR REPLACE FUNCTION public.form_test_snapshot_checksum(p_snapshot JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT encode(extensions.digest(convert_to(p_snapshot::text, 'UTF8'), 'sha256'), 'hex');
$$;
