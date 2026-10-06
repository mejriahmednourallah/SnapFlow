"""Matched live discovery through packaged pool code, without hidden recovery.

Content acquisition only: no form exploration/submission or CWV measurements.
Both engines have the same discovery budget. The outer guard also bounds SDK
cleanup; total elapsed includes extraction and cleanup, not just navigation.
"""
import argparse
import asyncio
from dataclasses import asdict
import importlib.metadata
import json
import os
from pathlib import Path
import sys
from threading import Event, Thread
import time
from urllib.parse import urlparse

TARGETS = ['https://example.com/', 'https://www.medianet-group.com/fr/', 'https://www.biat.com.tn/']


async def client(args):
    sys.path.insert(0, '/app')
    import pool
    assert Path(pool.__file__).parent == Path('/app'), pool.__file__
    browser_pool = pool.BrowserPool()
    await browser_pool.start()
    rows = []
    try:
        for url in TARGETS:
            engines = ['chromium', 'obscura'] if args.round % 2 == 0 else ['obscura', 'chromium']
            for engine in engines:
                started = time.perf_counter()
                row = {'url': url, 'requested_engine': engine, 'round': args.round,
                       'budget_ms': args.budget_ms, 'outer_ms': args.budget_ms + 8000}
                try:
                    result = await asyncio.wait_for(browser_pool._discover_rendered_once(
                        url, allowed_domains=[urlparse(url).hostname], max_links=100,
                        extract_forms=False, capture_projection=True,
                        wait_ms=args.budget_ms, force_chromium=engine == 'chromium',
                        connection_fallback=False), (args.budget_ms + 8000) / 1000)
                    row['result'] = asdict(result)
                except Exception as exc:
                    row['outer_error'] = type(exc).__name__ + ': ' + str(exc)[:1000]
                row['elapsed_ms'] = (time.perf_counter() - started) * 1000
                rows.append(row)
                Path('/results/observations.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
                result = row.get('result', {})
                print(json.dumps({'url': url, 'requested_engine': engine,
                    'actual_engine': result.get('engine'), 'status': result.get('status'),
                    'elapsed_ms': row['elapsed_ms'], 'error': row.get('outer_error', result.get('error')),
                    'text_chars': len(result.get('visible_text') or ''),
                    'html_chars': len(result.get('rendered_html') or ''),
                    'projection_available': (result.get('text_projection') or {}).get('available')}), flush=True)
    finally:
        try:
            await asyncio.wait_for(browser_pool.stop(), 5)
        except Exception:
            pass
    Path('/results/runtime.json').write_text(json.dumps({
        'playwright': importlib.metadata.version('playwright'), 'module': pool.__file__,
        'methodology': 'Actual packaged content-discovery code; no connection fallback, no forms; two alternating rounds; total elapsed includes cleanup; not a full scan.'}, indent=2), encoding='utf-8')


def host(args):
    from run_obscura_study import HERE, ROOT, NETWORK, docker, owned_remove
    output = ROOT / args.output
    output.mkdir(parents=True, exist_ok=True)
    engine, caller = 'snapflow-production-probe-engine', 'snapflow-production-probe-client'
    metadata = {'engine_image': args.image, 'client_image': args.client_image,
                'budget_ms': args.budget_ms, 'script_deadline_ms': 4000,
                'targets': TARGETS, 'rounds': args.rounds,
                'engine_limits': '2 CPUs / 2 GiB', 'client_limits': '2 CPUs / 2 GiB',
                'memory_caveat': 'Client includes Python, Playwright and Chromium even during Obscura visits; sampled Docker working-set counters are not engine-only RSS or full-scan resource use.'}
    metadata['local_fixture'] = args.local_fixture
    metadata['recovery_fixture'] = args.recovery_fixture
    for key, tag in [('engine_image_id', args.image), ('client_image_id', args.client_image)]:
        metadata[key] = docker('image', 'inspect', '--format', '{{.Id}}', tag, capture=True).stdout.strip()
    (output / 'environment.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    for round_id in range(args.rounds):
        destination = output / f'round-{round_id}'
        destination.mkdir(exist_ok=True)
        stop = Event()
        samples = []
        def sample():
            while not stop.is_set():
                result = docker('stats', '--no-stream', '--format', '{{json .}}', engine, caller, check=False, capture=True)
                for line in result.stdout.splitlines():
                    try:
                        samples.append({'wall_time': time.time(), **json.loads(line)})
                    except ValueError:
                        pass
                stop.wait(.5)
        sampler = None
        try:
            owned_remove(engine)
            owned_remove(caller)
            docker('run', '-d', '--name', engine, '--label', 'snapflow.study=obscura-memory',
                '--network', NETWORK, '--cpus', '2', '--memory', '2g', '--env-file', str(HERE/'obscura.env'),
                '-e', 'OBSCURA_BLOCK_TRACKERS=0', '-e', 'OBSCURA_SCRIPT_DEADLINE_MS=4000',
                '-e', f'OBSCURA_ALLOW_PRIVATE_NETWORK={1 if args.local_fixture or args.recovery_fixture else 0}',
                '-e', 'RUST_LOG=obscura_browser=info,obscura_net=warn,obscura_js=warn',
                args.image, 'serve', '--port', '9222', '--host', '0.0.0.0', '--stealth', capture=True)
            docker('run', '-d', '--name', caller, '--label', 'snapflow.study=obscura-memory',
                '--network', NETWORK, '--cpus', '2', '--memory', '2g', '--shm-size', '256m',
                '--env-file', str(HERE/'obscura.env'), '-e', 'ENABLE_OBSCURA_DISCOVERY=true',
                '-e', f'OBSCURA_CDP_URL=http://{engine}:9222', '-e', 'CHROME_NO_SANDBOX=true',
                '-e', 'BROWSER_POOL_IGNORE_HTTPS_ERRORS=true',
                '--mount', f'type=bind,src={HERE},dst=/benchmarks,readonly',
                '--mount', f'type=bind,src={destination},dst=/results',
                args.client_image, 'python', '-c', 'import time; time.sleep(3600)', capture=True)
            time.sleep(1)
            sampler = Thread(target=sample, daemon=True)
            sampler.start()
            if args.recovery_fixture:
                docker('exec', '-e', f'RECOVERY_FIXTURE_URL=http://{caller}:18997/',
                      caller, 'python', '/benchmarks/probe_production_recovery.py')
            elif args.local_fixture:
                for selected_engine in ['chromium', 'obscura']:
                    docker('exec', '-e', f'DISCOVERY_FORCE_CHROMIUM={str(selected_engine == "chromium").lower()}',
                        '-e', f'DISCOVERY_FIXTURE_URL=http://{caller}:18996/',
                        '-e', f'DISCOVERY_TEST_OUTPUT=/results/{selected_engine}-discovery.json',
                        caller, 'python', '/benchmarks/probe_production_discovery.py')
            else:
                docker('exec', caller, 'python', '/benchmarks/probe_production_engines.py', '--client',
                    '--round', str(round_id), '--budget-ms', str(args.budget_ms))
        finally:
            stop.set()
            if sampler:
                sampler.join(5)
            (destination/'resource-samples.json').write_text(json.dumps(samples, indent=2), encoding='utf-8')
            log = docker('logs', '--tail', '500', engine, check=False, capture=True)
            content = log.stdout + log.stderr
            for line in (HERE/'obscura.env').read_text().splitlines():
                if line.startswith('OBSCURA_CDP_TOKEN='):
                    content = content.replace(line.split('=', 1)[1], '<redacted>')
            (destination/'engine.log').write_text(content, encoding='utf-8')
            owned_remove(engine)
            owned_remove(caller)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--client', action='store_true')
    parser.add_argument('--image', default='snapflow/obscura-fixed:v0.2.3')
    parser.add_argument('--client-image', default='snapflow/v3-browser-pool:acquisition-study')
    parser.add_argument('--output', type=Path, default=Path('output/playwright/obscura-study/production-fixed-live'))
    parser.add_argument('--rounds', type=int, default=2)
    parser.add_argument('--round', type=int, default=0)
    parser.add_argument('--budget-ms', type=int, default=10000)
    parser.add_argument('--local-fixture', action='store_true')
    parser.add_argument('--recovery-fixture', action='store_true')
    args = parser.parse_args()
    asyncio.run(client(args)) if args.client else host(args)
