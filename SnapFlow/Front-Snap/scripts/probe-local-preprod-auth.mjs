// Real local API/auth/RLS proof. Credentials stay in ignored local files.
import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const login = JSON.parse(await readFile(process.env.SNAPFLOW_LOGIN_FILE || new URL('../supabase/.local-login.json', import.meta.url), 'utf8'));
const env = Object.fromEntries((await readFile(process.env.SNAPFLOW_ENV_FILE || new URL('../supabase/.env.local', import.meta.url), 'utf8'))
  .split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
  }));
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const client = () => createClient(login.supabase_url, env.SUPABASE_ANON_KEY || env.ANON_KEY, options);
const service = createClient(login.supabase_url, env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY, options);
const admin = client(), anon = client();
const ok = result => { assert.equal(result.error, null, result.error?.message); return result.data; };
const checked = [], users = [];
const check = name => checked.push(name);
try {
  ok(await admin.auth.signInWithPassword({ email: login.email, password: login.password }));
  assert.equal(ok(await admin.from('user_roles').select('role').eq('user_id', login.user_id).single()).role, 'admin');
  const project = ok(await admin.from('projects').select('id,client_id').eq('id', login.demo_project.id).single());
  assert.ok(project.client_id); check('seeded admin login, role and client-linked project');
  const anonymousProjects = await anon.from('projects').select('id');
  assert.ok(anonymousProjects.error?.code === '42501' ||
    (anonymousProjects.error === null && anonymousProjects.data?.length === 0),
    'Anonymous requests must never disclose project rows (RLS may return an empty set).');
  check('anonymous project access denied');
  const sessions = [];
  for (let index = 0; index < 2; index++) {
    const email = `rls-${randomUUID()}@snapflow.local`, password = `${randomUUID()}!Aa9`;
    const created = ok(await service.auth.admin.createUser({ email, password, email_confirm: true }));
    users.push(created.user.id);
    ok(await service.from('user_roles').insert({ user_id: created.user.id, role: 'charge_de_projet' }));
    const session = client(); ok(await session.auth.signInWithPassword({ email, password }));
    sessions.push(session);
  }
  ok(await service.from('project_assignments').insert({ project_id: project.id, user_id: users[0] }));
  assert.equal(ok(await sessions[0].from('projects').select('id').eq('id', project.id)).length, 1);
  assert.equal(ok(await sessions[1].from('projects').select('id').eq('id', project.id)).length, 0);
  check('assigned user sees project; unassigned user cannot see it');
  assert.equal(ok(await sessions[0].from('profiles').select('id')).length, 1);
  assert.equal(ok(await sessions[0].from('user_roles').select('user_id')).length, 1);
  check('ordinary user sees only own profile and role');
  const elevated = await sessions[0].from('user_roles').insert({ user_id: users[0], role: 'admin' });
  assert.equal(elevated.error?.code, '42501'); check('self-promotion to admin denied by RLS');
  const rpc = await sessions[0].rpc('form_test_build_scenario_snapshot', { p_scenario_id: randomUUID() });
  assert.equal(rpc.error?.code, '42501'); check('service-only form RPC remains inaccessible to users');
  if (process.env.SNAPFLOW_PRODUCTION_AUTH === '1') {
    const impersonation = await sessions[1].functions.invoke('ai-assistant', {
      body: { userId: login.user_id, messages: [{ role:'user', content:'Owned authorization probe' }] },
    });
    assert.equal(impersonation.error?.context?.status,403);
    check('assistant refuses a different body user identity before fetching context or calling AI');
  }
  const artifact = { assertions: 'passed', checks: checked, scope: 'Real local Supabase Auth/PostgREST and application RLS; not audit or VPS capacity acceptance.' };
  await writeFile(process.env.SNAPFLOW_AUTH_ARTIFACT || new URL('../../output/capacity-study/preprod-auth.json', import.meta.url), JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify(artifact));
} finally {
  for (const id of users) {
    ok(await service.from('project_assignments').delete().eq('user_id', id));
    ok(await service.auth.admin.deleteUser(id));
  }
}
