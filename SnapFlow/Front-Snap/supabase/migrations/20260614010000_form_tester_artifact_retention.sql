-- Retain Form Tester evidence for 30 days. The Edge Function removes the
-- physical Storage object before deleting the metadata row.
DO $$
DECLARE
  existing_job BIGINT;
  has_project_url BOOLEAN;
  has_service_role BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url'
  ) INTO has_project_url;
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key'
  ) INTO has_service_role;
  IF NOT has_project_url OR NOT has_service_role THEN
    RETURN;
  END IF;

  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'form-tester-artifact-retention'
  LIMIT 1;
  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;

  PERFORM cron.schedule(
    'form-tester-artifact-retention',
    '17 2 * * *',
    $job$
      SELECT net.http_post(
        url := (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'supabase_url'
          LIMIT 1
        ) || '/functions/v1/cleanup-form-test-artifacts',
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'service_role_key'
            LIMIT 1
          ),
          'Content-Type',
          'application/json'
        ),
        body := '{"limit": 500}'::jsonb
      );
    $job$
  );
END;
$$;
