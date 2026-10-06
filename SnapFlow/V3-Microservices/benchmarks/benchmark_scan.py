"""Collect actual API scan duration and Linux-host/container resources.

Run ON the target VPS with required services present. Does not restart services,
alter configuration, reset databases or promote defaults. Reports remain local.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
from threading import Event, Thread
import time
from urllib.request import Request, urlopen

SETTINGS = {'SCANNER_TIMEOUT','SCANNER_PARALLELISM','SCANNER_HTTP_TIMEOUT_SEC',
            'HEADLESS_SAMPLE_RATIO','RENDERED_DISCOVERY_MAX_PAGES','DEFAULT_SCAN_MAX_PAGES',
            'BROWSER_POOL_WORKERS','BROWSER_POOL_CONCURRENCY','BROWSER_POOL_RECYCLE_AFTER',
            'ENABLE_OBSCURA_DISCOVERY','ENABLE_OBSCURA_PARALLEL_DISCOVERY','OBSCURA_RENDER_ENABLED',
            'OBSCURA_ACQUISITION_ROUTER_ENABLED','SCAN_ADMISSION_ENABLED','LANGUAGETOOL_SERVER_URL'}

def container_snapshot():
    ids = subprocess.run(['docker','ps','-q'], capture_output=True, text=True, timeout=10, check=True).stdout.split()
    if not ids:
        return []
    result = subprocess.run(['docker','inspect',*ids], capture_output=True, text=True, timeout=15, check=True)
    rows = []
    for item in json.loads(result.stdout):
        settings = {}
        for entry in item['Config'].get('Env', []):
            key, _, value = entry.partition('=')
            if key in SETTINGS:
                settings[key] = value
        rows.append(dict(name=item['Name'].lstrip('/'), id=item['Id'], image_id=item['Image'],
                         configured_image=item['Config']['Image'], restarts=item['RestartCount'],
                         oom_killed=item['State'].get('OOMKilled'), settings=settings))
    return rows


def percentile(values, proportion):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered)-1, int((len(ordered)-1)*proportion))]


def collect_evidence(scan_id, env_file, compose_file):
    # psql quotes the variable as a SQL literal; never interpolate it into SQL
    # or a shell command. This query reads the existing volume only.
    sql = """SELECT jsonb_build_object(
      'pages', COUNT(*), 'distinct_urls', COUNT(DISTINCT url),
      'held_pages', COUNT(*) FILTER(WHERE NOT nlp_ready),
      'current_nlp_pages', COUNT(*) FILTER(WHERE nlp_results IS NOT NULL AND nlp_revision=content_revision),
      'stale_nlp_pages', COUNT(*) FILTER(WHERE nlp_results IS NOT NULL AND nlp_revision IS DISTINCT FROM content_revision),
      'supported_spelling_pending_pages', COUNT(*) FILTER(WHERE COALESCE(nlp_results#>'{spelling_scope,provider_failures}' ?| ARRAY['fr','en','ar'],FALSE)),
      'observations', COALESCE(jsonb_agg(jsonb_build_object(
        'url',url,'content_revision',content_revision,'nlp_revision',nlp_revision,
        'nlp_ready',nlp_ready,'nlp_status',nlp_results->>'status',
        'word_count',nlp_results->'word_count','spelling_scope',nlp_results->'spelling_scope',
        'rendered_html_present',rendered_html IS NOT NULL,
        'raw_html_present',raw_html IS NOT NULL,
        'acquisition',metrics->'acquisition',
        'markdown_present',metrics->'rendered_discovery'->'text_projection'->>'markdown' IS NOT NULL
      ) ORDER BY url),'[]'::jsonb)
    ) FROM scan_pages WHERE scan_id=:'scan_id';"""
    command = ['docker','compose','--env-file',env_file,'-f',compose_file,'exec','-T','db','sh','-c',
        'psql -X -A -t -v ON_ERROR_STOP=1 -v scan_id="$1" -U "$POSTGRES_USER" -d "$POSTGRES_DB"', 'sh', scan_id]
    result = subprocess.run(command, input=sql, capture_output=True, text=True, timeout=30, check=True)
    return json.loads(result.stdout)

def request(api, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    with urlopen(Request(api.rstrip('/')+path, data=data, headers={'Content-Type':'application/json'}), timeout=30) as response:
        return json.load(response)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--api', default='http://127.0.0.1:8080')
    parser.add_argument('--url', required=True)
    parser.add_argument('--pages', required=True, type=int)
    parser.add_argument('--label', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--headless', type=int, default=8)
    parser.add_argument('--max-wait', type=int, default=2400)
    parser.add_argument('--probe-url', action='append', default=[], help='Additional frontend/Supabase health URL; no credentials are saved')
    parser.add_argument('--collect-db-evidence', action='store_true', help='Read final page revisions from the existing Compose database')
    parser.add_argument('--env-file', default='.env.preprod')
    parser.add_argument('--compose-file', default='docker-compose.preprod.yml')
    args = parser.parse_args()
    if args.pages < 1 or args.headless < 1: parser.error('pages and headless concurrency must be positive')
    baseline = container_snapshot()
    stopped, samples = Event(), []
    def sample():
        while not stopped.is_set():
            row = dict(elapsed=time.monotonic()-started)
            try:
                row['host_memory_available_bytes'] = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024
            except (OSError, StopIteration):
                row['host_memory_available_bytes'] = None
            try:
                stats = subprocess.run(['docker','stats','--no-stream','--format','{{json .}}'], capture_output=True, text=True, timeout=10, check=True)
                row['containers'] = [json.loads(line) for line in stats.stdout.splitlines()]
            except Exception as exc:
                row['resource_error'] = str(exc)
            samples.append(row)
            stopped.wait(2)
    started = time.monotonic()
    sampler = Thread(target=sample, daemon=True)
    sampler.start()
    output = dict(label=args.label, target=args.url, requested_pages=args.pages, cpu_count=os.cpu_count(),
                  headless_concurrency=args.headless, containers_before=baseline, status_observations=[], application_probes=[],
                  platform=platform.platform(), methodology='Actual API scan on this host; no accuracy promotion without independently reviewed final evidence')
    health_latencies, state, running_at = [], {}, None
    try:
        created = request(args.api, '/scan', dict(url=args.url,max_pages=args.pages,headless_concurrency=args.headless))
        scan_id = created['scan_id']
        output['scan_id'] = scan_id
        while time.monotonic()-started < args.max_wait:
            state = request(args.api, '/scan/'+scan_id+'/status')
            observed_at = time.monotonic()-started
            output['status_observations'].append(dict(elapsed=observed_at, **state))
            if state.get('status') != 'pending' and running_at is None:
                running_at = observed_at
            probe_start = time.monotonic()
            request(args.api, '/health')
            health_latencies.append(time.monotonic()-probe_start)
            for probe_url in args.probe_url:
                probe_start = time.monotonic()
                observation = dict(elapsed=observed_at, url=probe_url)
                try:
                    with urlopen(probe_url, timeout=5) as response:
                        observation['http_status'] = response.status
                except Exception as exc:
                    observation['error'] = str(exc)
                observation['seconds'] = time.monotonic()-probe_start
                output['application_probes'].append(observation)
            if state['status'] in ('complete','failed'): break
            time.sleep(2)
        output.update(final_state=state, total_duration_seconds=time.monotonic()-started,
                      observed_queue_seconds=running_at,
                      observed_active_seconds=time.monotonic()-started-running_at if running_at is not None else None,
                      health_latency_max_seconds=max(health_latencies, default=None), health_latency_p95_seconds=percentile(health_latencies,.95))
        if state.get('status') == 'complete':
            output['report'] = request(args.api, '/scan/'+scan_id+'/kpis')
            output['persisted_reload_matches'] = output['report'] == request(args.api, '/scan/'+scan_id+'/kpis')
            raw = request(args.api, '/scan/'+scan_id+'/result')
            output['pages_scanned'] = raw.get('pages_scanned')
            output['scan_telemetry'] = raw.get('scan_telemetry')
            output['final_current_nlp_pages'] = state.get('pages_nlp_done')
            if args.collect_db_evidence:
                evidence = collect_evidence(scan_id, args.env_file, args.compose_file)
                output['page_evidence'] = evidence
                output['evidence_revisions_passed'] = (
                    evidence['pages'] > 0 and evidence['held_pages'] == 0 and evidence['stale_nlp_pages'] == 0
                    and evidence['supported_spelling_pending_pages'] == 0
                    and evidence['current_nlp_pages'] == evidence['pages'])
            output['acceptance'] = 'requires_independent_evidence_review'
        else:
            output['acceptance'] = 'not_completed'
    except Exception as exc:
        output['error'] = str(exc)
        raise
    finally:
        stopped.set()
        sampler.join(timeout=12)
        try:
            after = container_snapshot()
            output['containers_after'] = after
            previous = {row['id']:row for row in baseline}
            output['container_stability_passed'] = all(
                row['id'] in previous and not row['oom_killed'] and row['restarts'] == previous[row['id']]['restarts'] for row in after
            ) and {row['id'] for row in after} == set(previous)
        except Exception as exc:
            output['container_inspection_error'] = str(exc)
        output['resource_samples'] = samples
        memory = [row['host_memory_available_bytes'] for row in samples if row['host_memory_available_bytes'] is not None]
        output['minimum_host_memory_available_bytes'] = min(memory) if memory else None
        output['headroom_passed'] = min(memory)>=1024**3 if memory else None
        destination = Path(args.output)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({key:output.get(key) for key in ('label','scan_id','total_duration_seconds','minimum_host_memory_available_bytes','headroom_passed','error')}))

if __name__ == '__main__':
    main()
