"""Verify actual filtering with a controlled fixture, not only an env value."""
import json
import argparse
import time
from run_obscura_study import HERE, ROOT, NETWORK, IMAGE, docker, owned_remove
from run_obscura_stealth_study import FULL_STEALTH

parser = argparse.ArgumentParser()
parser.add_argument('--image', default=FULL_STEALTH)
parser.add_argument('--client-image', default=IMAGE)
parser.add_argument('--output', default='output/playwright/obscura-study/stealth-clean/tracker-probe')
options = parser.parse_args()
OUT = ROOT/options.output
OUT.mkdir(parents=True, exist_ok=True)
CLIENT = 'snapflow-stealth-tracker-client'
ENGINE = 'snapflow-stealth-tracker-engine'
try:
    owned_remove(CLIENT)
    docker('run', '-d', '--name', CLIENT, '--label', 'snapflow.study=obscura-memory', '--network', NETWORK,
        '--env-file', str(HERE/'obscura.env'), '--mount', f'type=bind,src={HERE/"obscura-study"},dst=/study,readonly',
        '--mount', f'type=bind,src={OUT},dst=/results', options.client_image, 'python', '/study/stealth_tracker_probe.py', '--serve', capture=True)
    address = json.loads(docker('inspect', CLIENT, capture=True).stdout)[0]['NetworkSettings']['Networks'][NETWORK]['IPAddress']
    for mode in ['normal', 'stealth', 'stealth-unfiltered']:
        owned_remove(ENGINE)
        args = ['run', '-d', '--name', ENGINE, '--label', 'snapflow.study=obscura-memory', '--network', NETWORK,
                '--add-host', f'www.google-analytics.com:{address}', '--env-file', str(HERE/'obscura.env'),
                '-e', 'OBSCURA_ALLOW_PRIVATE_NETWORK=1']
        if mode.endswith('unfiltered'):
            args += ['-e', 'OBSCURA_BLOCK_TRACKERS=0']
        args += [options.image, 'serve', '--port', '9222', '--host', '0.0.0.0']
        if mode != 'normal':
            args.append('--stealth')
        docker(*args, capture=True)
        time.sleep(1)
        docker('exec', CLIENT, 'python', '/study/stealth_tracker_probe.py', '--cdp-url', f'http://{ENGINE}:9222',
               '--output', f'/results/{mode}.json')
        result = json.loads((OUT/f'{mode}.json').read_text())
        active = mode != 'stealth'
        assert result['classic_script_requests'] == int(active), (mode, result)
        assert result['scripted_fetch_requests'] == int(active), (mode, result)
        assert result['marker'] == ('TRACKER_EXECUTED' if active else 'NOT_EXECUTED'), (mode, result)
        assert result['fetch_marker'] == ('FETCH_EXECUTED' if active else 'NOT_EXECUTED'), (mode, result)
        owned_remove(ENGINE)
finally:
    owned_remove(ENGINE)
    owned_remove(CLIENT)
