"""Measure local imported reports in memory; never print their contents or keys."""
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
CONTAINER = 'snapflow-rehearsal-supabase-supabase-db-1'


def main():
    owner = subprocess.run(['docker','inspect',CONTAINER,'--format',
        '{{index .Config.Labels "com.docker.compose.project"}}'], check=True,capture_output=True,text=True).stdout.strip()
    if owner != 'snapflow-rehearsal-supabase':
        raise ValueError('Only the separate local rehearsal database may be measured')
    migration = (ROOT/'Front-Snap/supabase/migrations/20261008010000_compact_audit_lists.sql').read_text()
    query = """
SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'site_name',p.site_name,'url',p.url,
 'report_data',a.report_data,'score',s->'score','axis_count',s->'axis_count','requires_report',s->'requires_report')),'[]'::jsonb)
 FROM public.audits a JOIN public.projects p ON p.id=a.project_id
 CROSS JOIN LATERAL public.audit_list_summary(a.report_data) s;
SELECT json_build_object('history_rows',(SELECT count(*) FROM public.audits),
 'original_list_bytes',(SELECT octet_length(coalesce(jsonb_agg(a),'[]'::jsonb)::text) FROM
   (SELECT project_id,report_data,created_at,status FROM public.audits) a),
 'compact_latest_rows',(SELECT count(*) FROM public.get_audit_list(NULL,true)),
 'compact_latest_bytes',(SELECT octet_length(coalesce(jsonb_agg(a),'[]'::jsonb)::text) FROM public.get_audit_list(NULL,true) a),
 'latest_legacy_rows',(SELECT count(*) FROM public.get_audit_list(NULL,true) WHERE requires_report),
 'latest_legacy_report_bytes',(SELECT coalesce(sum(octet_length(a.report_data::text)),0) FROM public.get_audit_list(NULL,true) s JOIN public.audits a ON a.id=s.id WHERE s.requires_report));
"""
    started=time.perf_counter()
    result=subprocess.run(['docker','exec','-i',CONTAINER,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
        '-U','supabase_admin','-d','postgres'],input='BEGIN;\n'+migration+'\n'+query+'\nROLLBACK;',
        capture_output=True,text=True,encoding='utf-8',check=True)
    lines=result.stdout.splitlines()
    parity=subprocess.run(['node','scripts/check-audit-list-parity.mjs'],cwd=ROOT/'Front-Snap',
        input=lines[0],capture_output=True,text=True,encoding='utf-8',check=True)
    # Vite may report tooling notices; select only the aggregate parity result.
    summary=next(json.loads(line) for line in parity.stdout.splitlines() if line.startswith('{"reports"'))
    print(json.dumps(dict(local_imported_snapshot=True,**summary,**json.loads(lines[1]),
        verification_duration_s=round(time.perf_counter()-started,3),vps_latency_measured=False)))


if __name__=='__main__':
    main()
