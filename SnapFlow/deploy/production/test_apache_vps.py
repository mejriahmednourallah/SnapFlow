"""Scoped edit/rollback checks; no real Apache or Docker commands are run."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch as mock

spec = importlib.util.spec_from_file_location('apache_vps', Path(__file__).with_name('apache-vps.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def vhosts(host):
    return ''.join(f'<VirtualHost *:{port}>\nServerName {host}\n# EXISTING APPLICATION\n</VirtualHost>\n' for port in ('80','443'))


class ApacheScope(unittest.TestCase):
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


if __name__=='__main__':
    unittest.main()
