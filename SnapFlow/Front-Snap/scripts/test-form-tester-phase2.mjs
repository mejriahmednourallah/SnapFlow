import { createClient } from '@supabase/supabase-js';

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const service = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = 'Phase2-Test@1234';
const createdUserIds = [];
let workflowId = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createUser(prefix) {
  const email = `${prefix}-${suffix}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error(`Could not create ${email}`);
  createdUserIds.push(data.user.id);
  return { email, user: data.user };
}

async function authenticatedClient(email) {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function cleanup() {
  if (workflowId) await service.from('form_workflows').delete().eq('id', workflowId);
  for (const userId of createdUserIds.reverse()) {
    await service.auth.admin.deleteUser(userId);
  }
}

try {
  const ownerIdentity = await createUser('form-phase2-owner');
  const adminIdentity = await createUser('form-phase2-admin');
  const outsiderIdentity = await createUser('form-phase2-outsider');
  const { error: roleError } = await service
    .from('user_roles')
    .insert({ user_id: adminIdentity.user.id, role: 'admin' });
  if (roleError) throw roleError;

  const { data: workflow, error: workflowError } = await service
    .from('form_workflows')
    .insert({
      org_id: ownerIdentity.user.id,
      created_by: ownerIdentity.user.id,
      name: `Phase 2 queue ${suffix}`,
      target_url: 'https://httpbin.org/forms/post',
      status: 'approved',
      approved_by: adminIdentity.user.id,
      approved_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (workflowError) throw workflowError;
  workflowId = workflow.id;

  const { data: scenario, error: scenarioError } = await service
    .from('form_test_scenarios')
    .insert({
      workflow_id: workflow.id,
      org_id: ownerIdentity.user.id,
      created_by: ownerIdentity.user.id,
      name: 'Scenario principal',
      status: 'approved',
      is_default: true,
    })
    .select('*')
    .single();
  if (scenarioError) throw scenarioError;

  const { error: nodesError } = await service.from('workflow_nodes').insert([
    {
      workflow_id: workflow.id,
      scenario_id: scenario.id,
      type: 'trigger',
      order_index: 0,
      position_x: 0,
      position_y: 0,
      config: { url: workflow.target_url },
    },
    {
      workflow_id: workflow.id,
      scenario_id: scenario.id,
      type: 'submit',
      order_index: 1,
      position_x: 0,
      position_y: 100,
      config: { selector: 'input[type="submit"]' },
    },
  ]);
  if (nodesError) throw nodesError;

  const { data: version, error: versionError } = await service.rpc(
    'form_test_create_scenario_version',
    {
      p_scenario_id: scenario.id,
      p_created_by: ownerIdentity.user.id,
      p_status: 'pending',
      p_note: 'Phase 2 integration test',
    },
  );
  if (versionError) throw versionError;
  const { error: approvalError } = await service
    .from('form_scenario_versions')
    .update({
      status: 'approved',
      approved_by: adminIdentity.user.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', version.id);
  if (approvalError) throw approvalError;

  const owner = await authenticatedClient(ownerIdentity.email);
  const outsider = await authenticatedClient(outsiderIdentity.email);
  const { data: queued, error: queueError } = await owner.functions.invoke('form-workflows-execute', {
    body: {
      workflow_id: workflow.id,
      scenario_id: scenario.id,
      scenario_version_id: version.id,
    },
  });
  if (queueError) throw queueError;
  assert(queued.status === 'queued', 'Execution must be queued');
  assert(queued.execution_source === 'pending_executor', 'Queued execution must not claim a browser source');

  const { data: ownerDetail, error: ownerDetailError } = await owner.functions.invoke('form-executions', {
    body: { action: 'get', execution_id: queued.result_id },
  });
  if (ownerDetailError) throw ownerDetailError;
  assert(ownerDetail.logs.length === 1, 'Owner must receive the initial queue log');

  const { data: outsiderLogs, error: outsiderLogsError } = await outsider
    .from('workflow_logs')
    .select('id')
    .eq('execution_id', queued.result_id);
  if (outsiderLogsError) throw outsiderLogsError;
  assert(outsiderLogs.length === 0, 'Outsider must not read execution logs');

  const { data: stopData, error: stopError } = await owner.functions.invoke('form-execution-control', {
    body: { execution_id: queued.result_id, command: 'stop' },
  });
  if (stopError) throw stopError;
  assert(stopData.command.status === 'completed', 'Stopping a queued execution must complete immediately');

  const { data: stopped, error: stoppedError } = await service
    .from('workflow_results')
    .select('status,failure_reason')
    .eq('id', queued.result_id)
    .single();
  if (stoppedError) throw stoppedError;
  assert(stopped.status === 'cancelled', 'Queued execution must become cancelled');

  const { data: redactedLog, error: redactionError } = await service
    .from('workflow_logs')
    .insert({
      execution_id: queued.result_id,
      level: 'debug',
      event_type: 'redaction_probe',
      message: 'token=plain-secret',
      details_redacted: { password: 'plain-password', nested: { api_key: 'plain-key' } },
    })
    .select('message,details_redacted')
    .single();
  if (redactionError) throw redactionError;
  assert(!JSON.stringify(redactedLog).includes('plain-'), 'Sensitive log values must be redacted');

  const { data: legacy, error: legacyError } = await service
    .from('workflow_results')
    .insert({
      workflow_id: workflow.id,
      scenario_id: scenario.id,
      scenario_version_id: version.id,
      executed_by: ownerIdentity.user.id,
      requested_by: ownerIdentity.user.id,
      status: 'needs_review',
      execution_source: 'simulated_legacy',
      execution_engine: 'simulated_legacy',
      assertions: [],
      step_trace: [{ type: 'submit', status: 'skipped' }],
    })
    .select('id')
    .single();
  if (legacyError) throw legacyError;

  const { data: listed, error: listError } = await owner.functions.invoke('form-executions', {
    body: { action: 'list', workflow_id: workflow.id },
  });
  if (listError) throw listError;
  assert(
    listed.executions.some((execution) => execution.id === legacy.id && execution.execution_source === 'simulated_legacy'),
    'Legacy execution must remain readable',
  );

  console.log(JSON.stringify({
    ok: true,
    queued_execution_created: true,
    stop_command_completed: true,
    owner_logs_visible: true,
    outsider_logs_hidden: true,
    persistence_redaction_active: true,
    legacy_results_readable: true,
  }));
} finally {
  await cleanup();
}
