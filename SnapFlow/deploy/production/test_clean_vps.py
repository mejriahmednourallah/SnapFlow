"""Exercise destructive-command scope using a fake Docker CLI; no real deletions."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

FAKE_DOCKER = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root=Path(os.environ['FAKE_ROOT']); state=json.loads((root/'state.json').read_text())
a=sys.argv[1:]
with (root/'calls.jsonl').open('a') as out: out.write(json.dumps(a)+'\n')
def container(identity): return next(c for c in state['containers'] if identity in (c['id'], c['name']))
if a[0]=='ps':
 cs=state['containers']
 if '--filter' in a:
  f=a[a.index('--filter')+1]
  if f.startswith('label='): cs=[c for c in cs if c['project']==f.split('=',2)[2]]
  elif f.startswith('volume='): cs=[c for c in cs if f[7:] in c.get('volumes',[])]
 print('\n'.join(c['id'] for c in cs))
elif a[0]=='inspect':
 fmt=a[a.index('--format')+1]; ids=a[1:a.index('--format')]
 for identity in ids:
  c=container(identity)
  if fmt=='{{.Name}}': print('/'+c['name'])
  elif fmt=='{{.Id}}': print(c['id'])
  elif fmt=='{{.Image}}': print(c['image'])
  elif fmt=='{{.State.Running}}': print('true')
  else: print('protected wetty signature')
elif a[:2]==['volume','ls']: print('\n'.join(state['volumes']))
elif a[:2]==['volume','inspect']: print(state['volumes'][a[2]])
elif a[:2]==['volume','rm']: del state['volumes'][a[2]]
elif a[0]=='stop': pass
elif a[0]=='rm': state['containers']=[c for c in state['containers'] if c['id'] not in a[1:]]
elif a[:2]==['network','inspect']: sys.exit(1)
elif a[:2] in (['image','rm'],['image','prune'],['builder','prune'],['system','df']): pass
else: raise RuntimeError('Unrecognized fake Docker command')
(root/'state.json').write_text(json.dumps(state))
'''


class CleanupScope(unittest.TestCase):
    def run_case(self, extra=None, volume_owner='v3-microservices'):
        with tempfile.TemporaryDirectory(prefix='snapflow-cleanup-scope-') as directory:
            root = Path(directory)
            state = {'containers': [
                {'id':'owned','name':'v3-microservices-db-1','project':'v3-microservices',
                 'image':'old-db','volumes':['v3-microservices_pgdata']},
                {'id':'protected','name':'wetty_wetty_1','project':'wetty','image':'wetty-image'},
                {'id':'unknown','name':'wonderful_goldwasser','project':'','image':'unknown-image'},
            ], 'volumes': {'v3-microservices_pgdata':volume_owner}}
            if extra: state['containers'].append(extra)
            (root/'state.json').write_text(json.dumps(state))
            executable = root/'docker'; executable.write_text(FAKE_DOCKER); executable.chmod(0o700)
            environment = dict(os.environ, FAKE_ROOT=str(root), PATH=str(root)+os.pathsep+os.environ['PATH'])
            result = subprocess.run(['bash', str(Path(__file__).with_name('clean-vps.sh'))],
                                    env=environment, capture_output=True, text=True)
            calls = [json.loads(line) for line in (root/'calls.jsonl').read_text().splitlines()]
            return result, calls

    def assert_no_mutation(self, calls):
        mutations = [a for a in calls if a[0] in ('stop','rm') or a[:2] in
                     (['volume','rm'],['image','rm'],['image','prune'],['builder','prune'])]
        self.assertEqual(mutations, [])

    def test_only_approved_resources_removed(self):
        result, calls = self.run_case()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(['stop','--time','30','owned'], calls)
        self.assertIn(['rm','owned'], calls)
        self.assertIn(['volume','rm','v3-microservices_pgdata'], calls)
        self.assertIn(['image','rm','--no-prune','old-db'], calls)
        self.assertFalse(any(a[0] in ('stop','rm') and ('protected' in a or 'unknown' in a) for a in calls))
        self.assertFalse(any(a[:2] in (['container','prune'],['volume','prune'],['network','prune']) for a in calls))

    def test_unexpected_project_container_stops_before_removal(self):
        result, calls = self.run_case({'id':'unexpected','name':'not-approved',
                                      'project':'v3-microservices','image':'other'})
        self.assertNotEqual(result.returncode, 0)
        self.assert_no_mutation(calls)

    def test_shared_volume_stops_before_removal(self):
        result, calls = self.run_case({'id':'consumer','name':'outside', 'project':'other',
                                      'image':'other','volumes':['v3-microservices_pgdata']})
        self.assertNotEqual(result.returncode, 0)
        self.assert_no_mutation(calls)

    def test_mismatched_volume_owner_stops_before_removal(self):
        result, calls = self.run_case(volume_owner='other')
        self.assertNotEqual(result.returncode, 0)
        self.assert_no_mutation(calls)


if __name__ == '__main__':
    unittest.main()
