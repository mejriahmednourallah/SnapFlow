"""Production routing/order/failure checks; no Docker daemon or network used."""
import argparse
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('vps', HERE / 'vps.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class VPSPhases(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='snapflow-vps-phase-')
        self.addCleanup(directory.cleanup)
        self.runtime = Path(directory.name)
        self.options = argparse.Namespace(runtime=self.runtime, action='build', rebuild_base=False,
                                          no_cache=False, force_recreate=False, skip_smtp=True,
                                          public_origin='https://snapflow.medianet.space')
        self.launcher = module.VPSLauncher(self.options)
        self.descriptor = dict(profile='vps', project='snapflow-production',
                               network='snapflow-production-bridge', public_origin=self.options.public_origin)
        (self.runtime / 'deployment.json').write_text(json.dumps(self.descriptor))
        self.calls = []
        self.running_db = False
        self.active = 0
        self.failed_service = None
        self.failed_start = None
        self.workflow_active = 0
        self.network_owner = 'snapflow-production'
        self.mounts = [{'Destination': '/b', 'Source': '/private/b'},
                       {'Destination': '/a', 'Source': '/private/a'}]
        self.import_marker = dict(assertions='passed', counts={'users':12, 'public_tables':31}, verified_tables=63)
        self.destination_users = 0
        self.public_tables = 0
        self.data_volume_owner = 'snapflow-production-supabase'
        self.data_consumers = b'owned-db\n'

        def run(args, **kwargs):
            args = [str(a) for a in args]
            self.calls.append((args, kwargs))
            stdout = b''
            if args[:3] == ['docker', 'inspect', 'wetty_wetty_1']:
                stdout = json.dumps(dict(id='protected', image='wetty', running=True, started='original',
                                         restarts=0, oom=False, mode='wetty_default', mounts=self.mounts,
                                         networks={'wetty_default': {'EndpointID': 'unchanged'}})).encode()
            elif args[:3] == ['docker', 'image', 'inspect']:
                stdout = ('owned-' + args[3]).encode()
            elif args[:2] == ['docker', 'inspect'] and args[2].endswith('-frontend-1'):
                stdout = json.dumps(dict(image='sha256:previous', reference='snapflow/frontend:candidate',
                    labels={'com.docker.compose.project':'snapflow-production-snapflow',
                            'com.docker.compose.service':'frontend'})).encode()
            elif args[:2] == ['docker', 'inspect']:
                stdout = json.dumps(dict(id='owned-db', labels={'com.docker.compose.project':'snapflow-production-supabase',
                    'com.docker.compose.service':'supabase-db'}, mounts=[{'Destination':'/var/lib/postgresql/data',
                    'Type':'volume','Name':'snapflow-production-supabase_supabase-data'}])).encode()
            elif args[:3] == ['docker', 'volume', 'inspect']:
                stdout = self.data_volume_owner.encode()
            elif args[:2] == ['docker', 'ps']:
                stdout = self.data_consumers
            elif args[:3] == ['docker', 'network', 'inspect']:
                stdout = self.network_owner.encode()
            elif len(args) > 2 and args[1].endswith('rehearse.py') and args[2] == 'restore':
                (self.runtime / 'import-complete.json').write_text(json.dumps(self.import_marker))
            elif 'compose' in args and '--' in args:
                tail = args[args.index('--') + 1:]
                if tail[:1] == ['build'] and tail[-1] == self.failed_service:
                    raise subprocess.CalledProcessError(17, args)
                if tail[:1] == ['up'] and tail[-1] == self.failed_start:
                    self.failed_start = None
                    raise subprocess.CalledProcessError(18, args)
                if tail[:1] == ['ps'] and tail[-1] == 'db' and self.running_db:
                    stdout = b'running-db'
                if 'auth.users' in ' '.join(tail):
                    stdout = b't\n' if 'to_regclass' in ' '.join(tail) else str(self.destination_users).encode()
                if 'information_schema.tables' in ' '.join(tail):
                    stdout = str(self.public_tables).encode()
                if 'to_regclass' in kwargs.get('input', b'').decode():
                    stdout = b't\n'
                if 'COUNT(*)' in kwargs.get('input', b'').decode():
                    stdout = str(self.active).encode()
                if 'workflow_results' in ' '.join(tail):
                    stdout = str(self.workflow_active).encode()
            return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr=b'')

        self.run_patch = patch.object(self.launcher, 'run', side_effect=run)
        self.run_patch.start()
        self.addCleanup(self.run_patch.stop)

    def compose_calls(self):
        return [(args[args.index('--')+1:], kwargs) for args, kwargs in self.calls if 'compose' in args and '--' in args]

    def test_build_has_no_start_or_restore_and_is_serial(self):
        self.launcher.execute()
        calls = self.compose_calls()
        self.assertEqual([args[-1] for args, _ in calls if args[0] == 'build'], list(module.SERVICES))
        self.assertFalse(any(args[0] in ('up', 'stop', 'down') for args, _ in calls))
        self.assertFalse(any('restore' in args for args, _ in self.calls))
        self.assertTrue(any('configure' in args and '--profile' in args and 'vps' in args for args, _ in self.calls))
        self.assertTrue(any('--rebuild-base' in args for args, _ in self.calls))
        self.assertEqual(self.calls[-3][0], ['docker', 'builder', 'prune', '--all', '--force'])
        self.assertEqual(self.calls[-2][0], ['docker', 'image', 'prune', '--force'])

    def test_failed_build_preserves_exit_and_still_cleans(self):
        self.failed_service = 'nlp-worker'
        with self.assertRaises(subprocess.CalledProcessError) as failure:
            self.launcher.execute()
        self.assertEqual(failure.exception.returncode, 17)
        self.assertFalse(any(args[-1] == 'frontend' for args, _ in self.compose_calls()))
        self.assertEqual(self.calls[-3][0], ['docker', 'builder', 'prune', '--all', '--force'])
        self.assertEqual(self.calls[-2][0], ['docker', 'image', 'prune', '--force'])

    def test_bases_reused_only_with_matching_inputs_and_ids(self):
        self.launcher.rebuild_bases()
        self.calls.clear()
        self.launcher.rebuild_bases()
        self.assertFalse(any(args[0] == 'bash' for args, _ in self.calls))
        marker = self.runtime / 'base-build-inputs.json'
        value = json.loads(marker.read_text())
        value['images']['heavy'] = 'unexpected-old-image'
        marker.write_text(json.dumps(value))
        self.launcher.rebuild_bases()
        self.assertTrue(any(args[0] == 'bash' for args, _ in self.calls))

    def test_missing_import_never_starts_workers(self):
        self.options.action = 'start'
        with self.assertRaisesRegex(ValueError, 'restore must pass'):
            self.launcher.execute()
        self.assertEqual(self.compose_calls(), [])

    def test_active_audit_prevents_any_recreation(self):
        self.options.action = 'start'
        (self.runtime / 'import-complete.json').write_text(json.dumps(self.import_marker))
        self.running_db = True
        self.active = 1
        with self.assertRaisesRegex(ValueError, 'audit is running'):
            self.launcher.execute()
        self.assertFalse(any(args[0] in ('up', 'stop') for args, _ in self.compose_calls()))

    def test_prepare_and_transactional_migration_before_workers(self):
        self.options.action = 'start'
        (self.runtime / 'import-complete.json').write_text(json.dumps(self.import_marker))
        self.launcher.execute()
        prepare = next(i for i, (args, _) in enumerate(self.calls) if 'prepare' in args)
        migration = next(i for i, (args, _) in enumerate(self.calls) if '--single-transaction' in ' '.join(args))
        startup = next(i for i, (args, _) in enumerate(self.calls) if 'compose' in args and
                       args[args.index('--')+1:][:2] == ['up', '-d'] and args[-1] == '300' and '--stack' in args and
                       args[args.index('--stack')+1] == 'snapflow')
        self.assertLess(prepare, migration)
        self.assertLess(migration, startup)
        self.assertFalse(any('apache' in ' '.join(args) or args[0] == 'sudo' for args, _ in self.calls))

    def test_first_import_reuses_keys_then_restores_and_prepares(self):
        self.options.action = 'import'
        (self.runtime / 'import').mkdir()
        (self.runtime / 'import/database-export-validation.json').write_text('{}')
        self.launcher.execute()
        actions = [args[2] for args, _ in self.calls if len(args) > 2 and args[1].endswith('rehearse.py')]
        self.assertLess(actions.index('configure'), actions.index('restore'))
        self.assertLess(actions.index('restore'), actions.index('prepare'))
        self.assertNotIn('decrypt', actions)

    def test_verified_import_is_not_replayed(self):
        self.options.action = 'import'
        (self.runtime / 'import-complete.json').write_text(json.dumps(self.import_marker))
        self.launcher.execute()
        self.assertFalse(any('restore' in args or 'decrypt' in args for args, _ in self.calls))

    def test_decryption_key_uses_hidden_prompt_and_stdin_only(self):
        self.options.action = 'import'
        fixture_key = 'only-a-test-key'
        with patch('builtins.open', return_value=io.StringIO()), patch.object(module.getpass, 'getpass', return_value=fixture_key):
            self.launcher.execute()
        decrypt = [(args, kwargs) for args, kwargs in self.calls if 'decrypt' in args]
        self.assertEqual(len(decrypt), 1)
        self.assertEqual(decrypt[0][1]['input'], fixture_key.encode())
        self.assertFalse(any(fixture_key in ' '.join(args) for args, _ in self.calls))

    def test_foreign_network_is_never_joined(self):
        self.options.action = 'supabase'
        self.network_owner = 'unrelated'
        with self.assertRaisesRegex(ValueError, 'ownership label'):
            self.launcher.execute()
        self.assertFalse(any(args[0] == 'up' for args, _ in self.compose_calls()))

    def test_invalid_import_marker_cannot_start_workers(self):
        self.options.action = 'start'
        (self.runtime / 'import-complete.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'Import marker'):
            self.launcher.execute()
        self.assertEqual(self.compose_calls(), [])

    def test_bootstrap_repair_resets_only_empty_owned_database(self):
        self.options.action = 'repair-bootstrap'
        self.launcher.execute()
        removals = [args for args, _ in self.calls if args[:2] == ['docker', 'rm'] or args[:3] == ['docker', 'volume', 'rm']]
        self.assertEqual(removals, [['docker', 'rm', 'owned-db'],
                                   ['docker', 'volume', 'rm', 'snapflow-production-supabase_supabase-data']])
        configure = next(i for i, (args, _) in enumerate(self.calls) if 'configure' in args)
        reset = next(i for i, (args, _) in enumerate(self.calls) if args[:3] == ['docker', 'volume', 'rm'])
        self.assertLess(configure, reset)
        self.assertFalse(any('down' in args or 'prune' in args for args, _ in self.calls))

    def test_bootstrap_repair_refuses_imported_or_populated_database(self):
        self.options.action = 'repair-bootstrap'
        cases = ('marker', 'users', 'tables', 'owner', 'consumers')
        for case in cases:
            with self.subTest(case=case):
                self.calls.clear()
                marker = self.runtime / 'import-complete.json'
                marker.unlink(missing_ok=True)
                self.destination_users = 0
                self.public_tables = 0
                self.data_volume_owner = 'snapflow-production-supabase'
                self.data_consumers = b'owned-db\n'
                if case == 'marker': marker.write_text(json.dumps(self.import_marker))
                if case == 'users': self.destination_users = 1
                if case == 'tables': self.public_tables = 1
                if case == 'owner': self.data_volume_owner = 'wetty'
                if case == 'consumers': self.data_consumers = b'owned-db\nunrelated\n'
                with self.assertRaises(ValueError):
                    self.launcher.execute()
                self.assertFalse(any(args[:2] == ['docker', 'rm'] or args[:3] == ['docker', 'volume', 'rm']
                                     or 'configure' in args or 'stop' in args for args, _ in self.calls))

    def test_mount_order_ignored_but_network_change_detected(self):
        before = self.launcher.wetty_snapshot()
        self.mounts.reverse()
        self.launcher.check_wetty(before)
        before['networks']['wetty_default']['EndpointID'] = 'changed'
        with self.assertRaisesRegex(ValueError, 'networks'):
            self.launcher.check_wetty(before)

    def test_rehearsal_runtime_refused_before_configuration(self):
        (self.runtime / 'deployment.json').write_text(json.dumps(dict(profile='rehearsal')))
        with self.assertRaisesRegex(ValueError, 'separate VPS runtime'):
            self.launcher.execute()
        self.assertFalse(any('configure' in args or 'fetch' in args for args, _ in self.calls))

    def prepare_app_update(self):
        self.options.action = 'app-update'
        (self.runtime / 'import-complete.json').write_text(json.dumps(self.import_marker))
        path = self.runtime / 'upstream/volumes/functions/fetch-redmine/index.ts'
        path.parent.mkdir(parents=True)
        path.write_text('previous Redmine function')
        return path

    def test_app_update_builds_only_frontend_and_migrates_before_activation(self):
        self.prepare_app_update()
        self.launcher.execute()
        calls = self.compose_calls()
        self.assertEqual([args for args, _ in calls if args[0] == 'build'], [['build','frontend']])
        self.assertEqual([args[-1] for args, _ in calls if args[0] == 'up'], ['functions','frontend'])
        migration = next(i for i, (args, _) in enumerate(calls) if '--single-transaction' in args)
        startup = next(i for i, (args, _) in enumerate(calls) if args[0] == 'up')
        self.assertLess(migration, startup)
        self.assertFalse(any(args[0] in ('stop','down') for args, _ in calls))
        self.assertFalse(any('prepare' in args or 'configure' in args for args, _ in self.calls))
        self.assertTrue(any(args[:3] == ['docker','builder','prune'] for args, _ in self.calls))

    def test_app_update_rolls_back_code_and_image_after_activation_failure(self):
        path = self.prepare_app_update()
        self.failed_start = 'frontend'
        with self.assertRaises(subprocess.CalledProcessError):
            self.launcher.execute()
        self.assertEqual(path.read_text(), 'previous Redmine function')
        self.assertFalse((path.parents[1] / '_shared/redmineProjectRequests.ts').exists())
        self.assertIn(['docker','tag','sha256:previous','snapflow/frontend:candidate'], [args for args, _ in self.calls])
        self.assertTrue(any(args[:3] == ['docker','builder','prune'] for args, _ in self.calls))

    def test_app_update_refuses_active_work_before_building(self):
        self.prepare_app_update()
        self.workflow_active = 1
        with self.assertRaisesRegex(ValueError, 'workflows'):
            self.launcher.execute()
        self.assertFalse(any(args[0] in ('build','up') for args, _ in self.compose_calls()))

    def test_app_update_build_failure_keeps_runtime_code(self):
        path = self.prepare_app_update()
        self.failed_service = 'frontend'
        with self.assertRaises(subprocess.CalledProcessError):
            self.launcher.execute()
        self.assertEqual(path.read_text(), 'previous Redmine function')
        self.assertFalse(any(args[0] == 'up' for args, _ in self.compose_calls()))

    def test_app_update_rechecks_audits_after_the_build(self):
        path = self.prepare_app_update()
        original = self.launcher.compose
        def compose(stack, *args, **kwargs):
            result = original(stack, *args, **kwargs)
            if args[0] == 'build':
                self.active = 1
            return result
        with patch.object(self.launcher, 'compose', side_effect=compose):
            with self.assertRaisesRegex(ValueError, 'audit is running'):
                self.launcher.execute()
        self.assertEqual(path.read_text(), 'previous Redmine function')
        self.assertFalse(any(args[0] == 'up' for args, _ in self.compose_calls()))


if __name__ == '__main__':
    unittest.main()
