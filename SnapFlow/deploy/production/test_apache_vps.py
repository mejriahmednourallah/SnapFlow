"""Scoped edit/rollback checks; no real Apache or Docker commands are run."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch as mock
from contextlib import redirect_stdout

spec = importlib.util.spec_from_file_location('apache_vps', Path(__file__).with_name('apache-vps.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def vhosts(host):
    return ''.join(f'<VirtualHost *:{port}>\nServerName {host}\n# EXISTING APPLICATION\n</VirtualHost>\n' for port in ('80','443'))


class ApacheScope(unittest.TestCase):
    @staticmethod
    def runtime():
        return {'id': 'owned-container', 'image': 'owned-image', 'running': True,
                'started': '2026-07-08', 'restarts': 0, 'oom': False,
                'mode': 'owned-network',
                'mounts': [{'Destination': '/b', 'Source': '/fixture/b', 'RW': False},
                           {'Destination': '/a', 'Source': '/fixture/a', 'RW': True}],
                'networks': {'owned-network': {'NetworkID': 'owned-network-id',
                                             'EndpointID': 'owned-endpoint', 'IPAddress': '172.19.0.2'}}}

    def test_runtime_order_changes_preserve_identity(self):
        first = self.runtime()
        second = json.loads(json.dumps(first))
        second['mounts'].reverse()
        # JSON object member order, including nested metadata, is insignificant.
        second['networks']['owned-network'] = dict(reversed(list(second['networks']['owned-network'].items())))
        replies = [subprocess.CompletedProcess([], 0, json.dumps(first).encode()),
                   subprocess.CompletedProcess([], 0, json.dumps(second).encode())]
        with mock.object(module.subprocess, 'run', side_effect=replies):
            self.assertEqual(module.wetty_identity(), module.wetty_identity())

    def test_runtime_real_changes_are_detected(self):
        first = self.runtime()
        cases = {'id': 'other-container', 'image': 'other-image', 'started': 'later',
                 'restarts': 1, 'oom': True, 'mode': 'other-network',
                 'mounts': [], 'networks': {}}
        for field, replacement in cases.items():
            with self.subTest(field=field):
                second = json.loads(json.dumps(first))
                second[field] = replacement
                replies = [subprocess.CompletedProcess([], 0, json.dumps(first).encode()),
                           subprocess.CompletedProcess([], 0, json.dumps(second).encode())]
                with mock.object(module.subprocess, 'run', side_effect=replies):
                    self.assertEqual(module.changed_fields(module.wetty_identity(), module.wetty_identity()), [field])
        second = json.loads(json.dumps(first))
        second['mounts'][0]['RW'] = True
        self.assertEqual(module.changed_fields(first, second), ['mounts'])
        second = json.loads(json.dumps(first))
        second['networks']['owned-network']['EndpointID'] = 'other-endpoint'
        self.assertEqual(module.changed_fields(first, second), ['networks'])

    def test_stopped_wetty_is_refused(self):
        value = self.runtime()
        value['running'] = False
        with mock.object(module.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(value).encode())):
            with self.assertRaisesRegex(RuntimeError, 'Wetty is not running'):
                module.wetty_identity()

    def test_read_only_probe_distinguishes_serialization_without_values(self):
        value = self.runtime()
        replies = [(value, b'first-order')] + [(value, b'second-order')] * 4
        output = io.StringIO()
        with mock.object(module, 'wetty_snapshot', side_effect=replies), mock.object(module, 'protected', return_value={'private-auth-path': 'unchanged'}), mock.object(module.time, 'sleep'), redirect_stdout(output):
            module.check_wetty(Path('/fixture'))
        result = json.loads(output.getvalue())
        self.assertEqual(result['serialization_only_changes'], 4)
        self.assertEqual(result['runtime_changed_fields'], [])
        self.assertEqual(result['protected_files_changed'], [])
        self.assertNotIn('owned-container', output.getvalue())
        self.assertNotIn('/fixture/b', output.getvalue())
        self.assertNotIn('private-auth-path', output.getvalue())

    def test_read_only_probe_refuses_actual_runtime_or_file_changes(self):
        before = self.runtime()
        after = json.loads(json.dumps(before))
        after['restarts'] = 1
        output = io.StringIO()
        files = {'/fixture/wetty.htdigest': 'original'}
        changed = {'/fixture/wetty.htdigest': 'modified'}
        with mock.object(module, 'wetty_snapshot', side_effect=[(before, b'before')] + [(after, b'after')] * 4), mock.object(module, 'protected', side_effect=[files] + [changed] * 4), mock.object(module.time, 'sleep'), redirect_stdout(output):
            with self.assertRaisesRegex(RuntimeError, 'Wetty protection check detected changes'):
                module.check_wetty(Path('/fixture'))
        result = json.loads(output.getvalue())
        self.assertEqual(result['runtime_changed_fields'], ['restarts'])
        self.assertEqual(result['protected_files_changed'], ['wetty.htdigest'])
        self.assertEqual(result['serialization_only_changes'], 0)
        self.assertNotIn('modified', output.getvalue())

    def test_repeated_acme_and_preserved_application(self):
        original = vhosts('snapflow-api.medianet.space')
        candidate = module.patch(original,'snapflow-api.medianet.space','/var/www/api',wetty_routes=['/owned-terminal/'])
        self.assertEqual(module.patch(candidate,'snapflow-api.medianet.space','/var/www/api',wetty_routes=['/owned-terminal/']), candidate)
        self.assertEqual(candidate.count('# EXISTING APPLICATION'),2)
        self.assertEqual(candidate.count('Require all granted'),2)
        self.assertNotIn('Require valid-user',candidate)  # inherited, not replaced

    def test_unknown_vhosts_abort(self):
        for source in (vhosts('other.example'),vhosts('snapflow.medianet.space')+'<VirtualHost *:8080>\nServerName snapflow.medianet.space\n</VirtualHost>'):
            with self.assertRaises(ValueError):
                module.patch(source,'snapflow.medianet.space','/var/www/front')

    def test_specific_alias_precedes_existing_broad_alias(self):
        source = vhosts('snapflow-api.medianet.space').replace('# EXISTING APPLICATION',
                'Alias /.well-known /var/www/api/.well-known/\n# EXISTING APPLICATION')
        candidate = module.patch(source,'snapflow-api.medianet.space','/var/www/api')
        for block in module.VHOST.finditer(candidate):
            self.assertLess(block.group(0).index('Alias /.well-known/acme-challenge/'),
                            block.group(0).index('Alias /.well-known '))
        self.assertEqual(module.patch(candidate,'snapflow-api.medianet.space','/var/www/api'),candidate)

    @unittest.skipUnless(os.name=='posix','Linux permission behavior')
    def test_restrictive_umask_and_preexisting_root_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent_mode = root.stat().st_mode
            previous = os.umask(0o077)
            try:
                directory = module.challenge_directory(root)
                self.assertEqual(directory.stat().st_mode & 0o777,0o755)
                self.assertEqual(directory.parent.stat().st_mode & 0o777,0o755)
                self.assertEqual(root.stat().st_mode,parent_mode)
                directory.chmod(0o700)
                directory.parent.chmod(0o700)
                module.challenge_directory(root)
                self.assertEqual(directory.stat().st_mode & 0o777,0o755)
                self.assertEqual(directory.parent.stat().st_mode & 0o777,0o755)
            finally:
                os.umask(previous)

    @unittest.skipUnless(os.name=='posix','Atomic POSIX owner/mode check runs in the disposable Linux container')
    def test_syntax_failure_restores_both_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'sites-enabled').mkdir()
            originals = {}
            for name, (host, _) in module.HOSTS.items():
                target = root/'sites-enabled'/name
                target.write_text(vhosts(host))
                originals[name] = target.read_bytes()
            (root/'sites-enabled/990-wetty.conf').write_text('ProxyPass /owned-terminal/ http://localhost:3030/owned-terminal/\n')
            (root/'wetty.htdigest').write_text('owned-digest-fixture')
            commands = []
            def command(*args):
                commands.append(args)
                if len(commands)==2:
                    raise subprocess.CalledProcessError(1,args)
            with mock.object(module,'run',side_effect=command), mock.object(module,'terminal_check'), mock.object(module,'wetty_identity',return_value='owned-identity'):
                with self.assertRaises(subprocess.CalledProcessError):
                    module.apply(root)
            for name, original in originals.items():
                self.assertEqual((root/'sites-enabled'/name).read_bytes(),original)
            self.assertEqual(commands,[('apache2ctl','-t'),('apache2ctl','-t'),('apache2ctl','-t'),('systemctl','reload','apache2')])
            self.assertEqual((root/'wetty.htdigest').read_text(),'owned-digest-fixture')

    @unittest.skipUnless(os.name=='posix', 'Atomic POSIX owner/mode check')
    def test_runtime_change_reports_field_and_rolls_back(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'sites-enabled').mkdir()
            originals = {}
            for name, (host, _) in module.HOSTS.items():
                target = root/'sites-enabled'/name
                target.write_text(vhosts(host))
                originals[name] = target.read_bytes()
            (root/'sites-enabled/990-wetty.conf').write_text('ProxyPass /owned-terminal/ http://localhost:3030/owned-terminal/\n')
            (root/'wetty.htdigest').write_text('owned-digest-fixture')
            before = self.runtime()
            after = json.loads(json.dumps(before))
            after['restarts'] = 1
            with mock.object(module, 'run') as command, mock.object(module, 'terminal_check'), mock.object(module, 'wetty_identity', side_effect=[before, after]):
                with self.assertRaisesRegex(RuntimeError, 'Wetty runtime changed: restarts'):
                    module.apply(root)
            for name, original in originals.items():
                self.assertEqual((root/'sites-enabled'/name).read_bytes(), original)
            self.assertEqual(command.call_args_list[-2:],
                             [unittest.mock.call('apache2ctl', '-t'), unittest.mock.call('systemctl', 'reload', 'apache2')])
            self.assertEqual((root/'wetty.htdigest').read_text(), 'owned-digest-fixture')


if __name__=='__main__':
    unittest.main()
