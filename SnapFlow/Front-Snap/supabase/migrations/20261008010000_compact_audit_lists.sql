-- Read-time summaries: preserve reports and use the caller's existing RLS.
ALTER TABLE public.audits ADD COLUMN IF NOT EXISTS job_id text;
CREATE OR REPLACE FUNCTION public.audit_list_summary(report jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
DECLARE
  passed integer := 0;
  failed integer := 0;
  item jsonb;
  axis jsonb;
  finding_status text;
  score numeric;
BEGIN
  IF report IS NULL OR jsonb_typeof(report) = 'null' THEN
    RETURN jsonb_build_object('score', NULL, 'axis_count', NULL, 'requires_report', false);
  END IF;
  -- Exactly the mapped-report predicate used by normalizeAuditReportData.
  IF jsonb_typeof(report->'siteName') IS DISTINCT FROM 'string'
     OR jsonb_typeof(report->'globalScore') IS DISTINCT FROM 'number'
     OR jsonb_typeof(report->'axes') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('score', NULL, 'axis_count', NULL, 'requires_report', true);
  END IF;
  FOR axis IN SELECT value FROM jsonb_array_elements(report->'axes') LOOP
    IF jsonb_typeof(axis) IS DISTINCT FROM 'object'
       OR jsonb_typeof(axis->'findings') IS DISTINCT FROM 'array' THEN
      RETURN jsonb_build_object('score', NULL, 'axis_count', NULL, 'requires_report', true);
    END IF;
  END LOOP;
  IF jsonb_typeof(report->'passingKpis') = 'array' THEN
    passed := jsonb_array_length(report->'passingKpis');
  END IF;
  FOREACH finding_status IN ARRAY ARRAY['bugs', 'recommendations', 'compliance'] LOOP
    IF jsonb_typeof(report->finding_status) = 'array' THEN
      failed := failed + jsonb_array_length(report->finding_status);
    END IF;
  END LOOP;
  IF passed + failed = 0 THEN
    FOR axis IN SELECT value FROM jsonb_array_elements(report->'axes') LOOP
      FOR item IN SELECT value FROM jsonb_array_elements(axis->'findings') LOOP
        finding_status := COALESCE(item->>'status',
          CASE item->>'type' WHEN 'pass' THEN 'pass' WHEN 'bug' THEN 'fail' ELSE 'not_measured' END);
        IF finding_status = 'pass' THEN passed := passed + 1;
        ELSIF finding_status = 'fail' THEN failed := failed + 1;
        END IF;
      END LOOP;
    END LOOP;
  END IF;
  score := CASE WHEN passed + failed > 0 THEN round(100.0 * passed / (passed + failed))
                ELSE (report->>'globalScore')::numeric END;
  RETURN jsonb_build_object('score', score, 'axis_count', jsonb_array_length(report->'axes'), 'requires_report', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_audit_list(
  p_project_id uuid DEFAULT NULL,
  p_latest_per_project boolean DEFAULT false,
  p_completed_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid, project_id uuid, job_id text, status text,
  created_at timestamptz, updated_at timestamptz, archived_at timestamptz,
  error_message text, site_name text, url text,
  score numeric, axis_count integer, has_report boolean, requires_report boolean
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  WITH ranked AS (
    SELECT a.id, row_number() OVER (
      PARTITION BY a.project_id
      ORDER BY (a.status = 'completed') DESC, a.created_at DESC, a.id DESC
    ) AS position
    FROM public.audits a
    WHERE (p_project_id IS NULL OR a.project_id = p_project_id)
      AND (NOT p_completed_only OR a.status = 'completed')
  ), summaries AS MATERIALIZED (
    SELECT a.id, a.project_id, a.job_id::text, a.status::text,
           a.created_at, a.updated_at, a.archived_at, a.error_message,
           p.site_name, p.url, a.report_data IS NOT NULL AND a.report_data <> 'null'::jsonb AS has_report,
           public.audit_list_summary(a.report_data) AS summary
    FROM ranked r
    JOIN public.audits a ON a.id = r.id
    JOIN public.projects p ON p.id = a.project_id
    WHERE NOT p_latest_per_project OR r.position = 1
  )
  SELECT s.id, s.project_id, s.job_id, s.status, s.created_at, s.updated_at,
         s.archived_at, s.error_message, s.site_name, s.url,
         (s.summary->>'score')::numeric, (s.summary->>'axis_count')::integer,
         s.has_report, (s.summary->>'requires_report')::boolean
  FROM summaries s ORDER BY s.created_at DESC, s.id DESC;
$$;

CREATE INDEX IF NOT EXISTS idx_audits_project_latest ON public.audits(project_id, created_at DESC, id DESC);
REVOKE ALL ON FUNCTION public.audit_list_summary(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_audit_list(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_list_summary(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_audit_list(uuid, boolean, boolean) TO authenticated, service_role;
-- Imported projects did not publish change events. Only publish small tables;
-- audit report bodies must not be streamed to list screens for invalidation.
DO $$
DECLARE target text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH target IN ARRAY ARRAY['projects','project_assignments','clients','profiles',
                                  'redmine_user_identities','report_schedules','user_roles'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=target) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target);
      END IF;
    END LOOP;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
