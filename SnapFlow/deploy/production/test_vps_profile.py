"""Configuration checks using pinned upstream files, without starting services."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
import yaml

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('rehearse', HERE/'rehearse.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class VPSProfile(unittest.TestCase):
    def setUp(self):
        upstream = Path(os.environ['SNAPFLOW_PINNED_UPSTREAM'])
        self.temporary = tempfile.TemporaryDirectory(prefix='snapflow-vps-profile-')
        self.addCleanup(self.temporary.cleanup)
        self.runtime = Path(self.temporary.name)
        for relative in ('docker-compose.yml','.env.example','volumes/functions/main/index.ts'):
            target = self.runtime/'upstream'/relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(upstream/relative, target)
        for name in ('db', 'api', 'pooler'):
            shutil.copytree(upstream / 'volumes' / name, self.runtime / 'upstream/volumes' / name)

    @unittest.skipUnless(os.name == 'posix', 'Linux file mode contract')
    def test_restrictive_umask_allows_container_inputs_but_keeps_secrets_private(self):
        upstream = self.runtime / 'upstream'
        for path in (upstream / 'volumes').rglob('*'):
            path.chmod(0o700 if path.is_dir() else 0o600)
        import_dir = self.runtime / 'import'
        import_dir.mkdir(mode=0o700)
        secret_sql = import_dir / 'data.sql'
        secret_sql.write_text('private export fixture')
        secret_sql.chmod(0o600)
        old_umask = os.umask(0o077)
        try:
            module.configure(self.runtime, 'vps', 'https://snapflow.medianet.space', True)
        finally:
            os.umask(old_umask)
        self.assertEqual(self.runtime.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.runtime / 'runtime.env').stat().st_mode & 0o777, 0o600)
        self.assertEqual(secret_sql.stat().st_mode & 0o777, 0o600)
        self.assertEqual((upstream / 'volumes/db/roles.sql').stat().st_mode & 0o777, 0o644)
        self.assertEqual((upstream / 'volumes/functions/main').stat().st_mode & 0o777, 0o755)
        self.assertEqual((upstream / 'volumes/functions/main/index.ts').stat().st_mode & 0o777, 0o644)
        self.assertEqual((upstream / 'volumes/api/envoy/docker-entrypoint.sh').stat().st_mode & 0o777, 0o755)

    def test_missing_bootstrap_file_refused_instead_of_directory_mount(self):
        path = self.runtime / 'upstream/volumes/db/roles.sql'
        path.unlink()
        with self.assertRaisesRegex(ValueError, 'container input missing'):
            module.configure(self.runtime, 'vps', 'https://snapflow.medianet.space', True)
        self.assertFalse(path.exists())

    def test_vps_routes_and_repeat_keys(self):
        module.configure(self.runtime, 'vps', 'https://snapflow.medianet.space', True)
        before = module.env_file(self.runtime/'runtime.env')
        sb = yaml.safe_load((self.runtime/'supabase.compose.yml').read_text())
        snap = yaml.safe_load((self.runtime/'snapflow.compose.yml').read_text())
        self.assertNotIn('apache',snap['services'])
        self.assertNotIn('mail',sb['services'])
        self.assertNotIn('ports',snap['services']['aggregator'])
        self.assertEqual(snap['services']['frontend']['ports'],['127.0.0.1:13000:3000'])
        self.assertEqual(sb['services']['api-gw']['ports'],['127.0.0.1:18000:8000'])
        self.assertEqual(sb['services']['functions']['environment']['SCANNER_BASE_URL'],'http://aggregator:8080')
        self.assertEqual(before['API_EXTERNAL_URL'],'https://snapflow.medianet.space/auth/v1')
        self.assertEqual(before['VITE_SUPABASE_URL'],'https://snapflow.medianet.space')
        self.assertEqual(before['SMTP_HOST'],'')
        self.assertEqual(before['ENABLE_EMAIL_AUTOCONFIRM'],'false')
        self.assertEqual(json.loads((self.runtime/'deployment.json').read_text())['project'],'snapflow-production')
        if os.environ.get('SNAPFLOW_COMPOSE_CHECK')=='1':
            for stack in ('supabase','snapflow'):
                module.compose(self.runtime,stack,['config','--quiet'])
        module.configure(self.runtime, 'vps', 'https://snapflow.medianet.space', True)
        after = module.env_file(self.runtime/'runtime.env')
        for key in ('POSTGRES_PASSWORD','JWT_SECRET','ANON_KEY','SERVICE_ROLE_KEY','DB_PASS'):
            self.assertEqual(before[key],after[key])
        with self.assertRaises(ValueError):
            module.configure(self.runtime)

    def test_require_explicit_https_and_email_choice(self):
        for origin, skip in ((None,True),('http://snapflow.medianet.space',True),('https://snapflow.medianet.space/path',True),('https://snapflow.medianet.space',False)):
            with self.subTest(origin=origin,skip=skip), self.assertRaises(ValueError):
                module.configure(self.runtime,'vps',origin,skip)
        self.assertFalse((self.runtime/'runtime.env').exists())

    def test_rehearsal_still_has_local_services(self):
        module.configure(self.runtime)
        snap = yaml.safe_load((self.runtime/'snapflow.compose.yml').read_text())
        sb = yaml.safe_load((self.runtime/'supabase.compose.yml').read_text())
        self.assertIn('apache',snap['services'])
        self.assertIn('mail',sb['services'])
        self.assertEqual(module.env_file(self.runtime/'runtime.env')['VITE_SUPABASE_URL'],'http://127.0.0.1:18080')
        with self.assertRaises(ValueError):
            module.configure(self.runtime,'vps','https://snapflow.medianet.space',True)


if __name__=='__main__':
    unittest.main()
