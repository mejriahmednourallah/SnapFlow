"""Transaction-only compatibility/RLS checks against the local rehearsal DB.

Only synthetic fixture records are inserted; all changes (including migration)
are rolled back. No credentials or existing report/user contents are printed.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'Front-Snap/supabase/migrations/20261008010000_compact_audit_lists.sql'


def sql_literal(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--container', default='snapflow-rehearsal-supabase-supabase-db-1')
    options = parser.parse_args()
    owner = subprocess.run(['docker', 'inspect', options.container, '--format',
        '{{index .Config.Labels "com.docker.compose.project"}}'], check=True, capture_output=True, text=True).stdout.strip()
    if owner != 'snapflow-rehearsal-supabase':
        raise ValueError('Tests require the separate local rehearsal database')
    fixtures = json.loads((ROOT / 'Front-Snap/src/test/fixtures/audit-list-scores.json').read_text())
    parts = ['BEGIN;', MIGRATION.read_text(), MIGRATION.read_text()]
    for fixture in fixtures:
        report = sql_literal(json.dumps(fixture['report'])) + '::jsonb'
        expected = dict(score=fixture['score'], axis_count=fixture['axes'], requires_report=fixture['legacy'])
        parts.append(f"DO $$ BEGIN ASSERT public.audit_list_summary({report}) = {sql_literal(json.dumps(expected))}::jsonb, {sql_literal(fixture['name'])}; END $$;")
    parts.append("""
DO $$ BEGIN
  ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.get_audit_list(uuid,boolean,boolean)'::regprocedure);
  ASSERT NOT has_function_privilege('anon','public.get_audit_list(uuid,boolean,boolean)','EXECUTE');
  ASSERT (SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public'
    AND tablename IN ('projects','project_assignments','clients','profiles','redmine_user_identities','report_schedules','user_roles'))=7;
END $$;
INSERT INTO auth.users(id,email) VALUES
 ('11111111-0801-4000-8000-000000000001','audit-list-fixture-one@example.invalid'),
 ('11111111-0801-4000-8000-000000000002','audit-list-fixture-two@example.invalid');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('11111111-0801-4000-8000-000000000001','charge_de_projet'),
 ('11111111-0801-4000-8000-000000000002','charge_de_projet');
INSERT INTO public.clients(id,name) VALUES ('11111111-0802-4000-8000-000000000001','Audit list rollback fixture');
INSERT INTO public.projects(id,site_name,url,client_id) VALUES
 ('11111111-0803-4000-8000-000000000001','Visible','https://visible.invalid','11111111-0802-4000-8000-000000000001'),
 ('11111111-0803-4000-8000-000000000002','Hidden','https://hidden.invalid','11111111-0802-4000-8000-000000000001');
INSERT INTO public.project_assignments(project_id,user_id) VALUES
 ('11111111-0803-4000-8000-000000000001','11111111-0801-4000-8000-000000000001');
INSERT INTO public.audits(id,project_id,status,created_at,archived_at,report_data) VALUES
 ('11111111-0804-4000-8000-000000000001','11111111-0803-4000-8000-000000000001','completed','2026-01-01',NULL,'{"siteName":"Site","globalScore":70,"axes":[]}'),
 ('11111111-0804-4000-8000-000000000002','11111111-0803-4000-8000-000000000001','completed','2026-01-02','2026-01-03','{"siteName":"Site","globalScore":80,"axes":[]}'),
 ('11111111-0804-4000-8000-000000000003','11111111-0803-4000-8000-000000000001','pending','2026-01-04',NULL,NULL),
 ('11111111-0804-4000-8000-000000000004','11111111-0803-4000-8000-000000000002','completed','2026-01-01',NULL,NULL);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-0801-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.get_audit_list('11111111-0803-4000-8000-000000000001'))=3;
  ASSERT (SELECT id FROM public.get_audit_list('11111111-0803-4000-8000-000000000001',true))='11111111-0804-4000-8000-000000000002';
  ASSERT (SELECT count(*) FROM public.get_audit_list('11111111-0803-4000-8000-000000000001',false,true))=2;
  ASSERT (SELECT count(*) FROM public.get_audit_list('11111111-0803-4000-8000-000000000002'))=0;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"11111111-0801-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.get_audit_list('11111111-0803-4000-8000-000000000001'))=0;
END $$;
RESET ROLE;
UPDATE public.user_roles SET role='admin' WHERE user_id='11111111-0801-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.get_audit_list('11111111-0803-4000-8000-000000000001'))=3;
  ASSERT (SELECT count(*) FROM public.get_audit_list('11111111-0803-4000-8000-000000000002'))=1;
END $$;
RESET ROLE;
-- Known synthetic payload measures wire-size reduction, not VPS latency.
UPDATE public.audits SET report_data=report_data || jsonb_build_object('detail',repeat('evidence ',12000))
 WHERE id IN ('11111111-0804-4000-8000-000000000001','11111111-0804-4000-8000-000000000002');
SELECT json_build_object('full_bytes',octet_length(jsonb_agg(a)::text))
 FROM public.audits a WHERE project_id='11111111-0803-4000-8000-000000000001';
SELECT json_build_object('compact_bytes',octet_length(jsonb_agg(a)::text))
 FROM public.get_audit_list('11111111-0803-4000-8000-000000000001') a;
ROLLBACK;
""")
    started = time.perf_counter()
    result = subprocess.run(['docker', 'exec', '-i', options.container, 'psql', '-X', '-qAt',
        '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'],
        input='\n'.join(parts), capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Transaction tests failed: ' + result.stderr)
    measures = {}
    for line in result.stdout.splitlines():
        if line.startswith('{"full_bytes"') or line.startswith('{"compact_bytes"'):
            measures.update(json.loads(line))
    print(json.dumps(dict(passed=True, score_cases=len(fixtures), migration_runs=2,
        rls='assigned/unassigned/admin/anon checked', rolled_back=True,
        duration_s=round(time.perf_counter()-started,3), **measures)))


if __name__ == '__main__':
    main()
