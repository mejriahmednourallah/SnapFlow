"""Matched stealth trials; all engines isolated from the production stack."""
import argparse
import json
import time
from run_obscura_study import HERE, ROOT, IMAGE, NETWORK, OBSCURA, docker, owned_remove

FULL_STEALTH = 'snapflow/obscura-stealth:v0.2.3-study'
CLIENT = 'snapflow-study-client'
VARIANTS = ['chromium', 'obscura-normal', 'obscura-image-stealth',
            'obscura-full-stealth', 'obscura-full-stealth-unfiltered']


def redact_log(value):
    for line in (HERE/'obscura.env').read_text(encoding='utf-8').splitlines():
        if line.startswith('OBSCURA_CDP_TOKEN='):
            token = line.split('=', 1)[1].strip()
            if token:
                value = value.replace(token, '[REDACTED_CDP_TOKEN]')
    return value


def main(args):
    output = ROOT / 'output/playwright/obscura-study' / args.output_folder
    output.mkdir(parents=True, exist_ok=True)
    if docker('network', 'inspect', NETWORK, check=False, capture=True).returncode:
        docker('network', 'create', '--label', 'snapflow.study=obscura-memory', NETWORK, capture=True)
    owned_remove(CLIENT)
    docker('run', '-d', '--name', CLIENT, '--label', 'snapflow.study=obscura-memory', '--network', NETWORK,
           '--env-file', str(HERE/'obscura.env'), '--mount', f'type=bind,src={output},dst=/results',
           '--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly', IMAGE, capture=True)
    inventory = {name:json.loads(docker('image', 'inspect', name, capture=True).stdout)[0]['Id']
                 for name in [IMAGE, OBSCURA, FULL_STEALTH]}
    (output/'images.json').write_text(json.dumps(inventory, indent=2), encoding='utf-8')
    try:
        for round_id in range(args.rounds):
            variants = args.variants if round_id % 2 == 0 else list(reversed(args.variants))
            for variant in variants:
                saved = output/f'round-{round_id}-{variant}'/'study.json'
                if args.resume and saved.exists() and json.loads(saved.read_text(encoding='utf-8')).get('completed_at'):
                    continue
                name = f'snapflow-stealth-{variant}'
                owned_remove(name)
                start = ['run', '-d', '--name', name, '--label', 'snapflow.study=obscura-memory', '--network', NETWORK,
                         '--cpus', '2', '--memory', '2g', '--shm-size', '256m']
                if variant == 'chromium':
                    start += [IMAGE, 'python', 'chromium_endpoint.py']
                    cdp = f'http://{name}:9333'
                    engine = 'chromium'
                else:
                    start += ['--env-file', str(HERE/'obscura.env')]
                    if variant.endswith('unfiltered'):
                        start += ['-e', 'OBSCURA_BLOCK_TRACKERS=0']
                    start += [FULL_STEALTH if 'full' in variant else OBSCURA,
                              'serve', '--port', '9222', '--host', '0.0.0.0']
                    if args.verbose:
                        start.append('--verbose')
                    if 'stealth' in variant:
                        start.append('--stealth')
                    cdp = f'http://{name}:9222'
                    engine = 'obscura'
                docker(*start, capture=True)
                time.sleep(2)
                folder = output/f'round-{round_id}-{variant}'
                folder.mkdir(exist_ok=True)
                print('Starting stealth comparison', round_id, variant, flush=True)
                result = docker('exec', CLIENT, 'python', 'study.py', '--engine', engine, '--engine-container', name,
                    '--cdp-url', cdp, '--output', f'/results/round-{round_id}-{variant}',
                    '--repeats', '1', '--concurrency', '4', '--live', check=False)
                logs = docker('logs', name, check=False, capture=True)
                (folder/'engine.log').write_text(redact_log(logs.stdout+logs.stderr), encoding='utf-8')
                if result.returncode:
                    raise RuntimeError(f'Stealth comparison failed: {variant}')
                owned_remove(name)
    finally:
        for name in [CLIENT, *[f'snapflow-stealth-{v}' for v in VARIANTS]]:
            owned_remove(name)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--rounds', type=int, default=2)
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--output-folder', default='stealth')
    parser.add_argument('--variants', nargs='+', choices=VARIANTS, default=VARIANTS)
    parser.add_argument('--verbose', action='store_true')
    main(parser.parse_args())
