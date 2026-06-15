import { createClient } from '@supabase/supabase-js';

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`${name} is required`);
  }
}

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const service = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = 'Phase1-Test@1234';
const users = {
  owner: `form-owner-${suffix}@example.com`,
  admin: `form-admin-${suffix}@example.com`,
  outsider: `form-outsider-${suffix}@example.com`,
};
const createdUserIds = [];
let workflowId = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createUser(email) {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error(`Could not create ${email}`);
  createdUserIds.push(data.user.id);
  return data.user;
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
  if (workflowId) {
    await service.from('form_workflows').delete().eq('id', workflowId);
  }
  for (const userId of createdUserIds.reverse()) {
    await service.auth.admin.deleteUser(userId);
  }
}

try {
  const owner = await createUser(users.owner);
  const admin = await createUser(users.admin);
  await createUser(users.outsider);

  const { error: roleError } = await service
    .from('user_roles')
    .insert({ user_id: admin.id, role: 'admin' });
  if (roleError) throw roleError;

  const { data: workflow, error: workflowError } = await service
    .from('form_workflows')
    .insert({
      org_id: owner.id,
      created_by: owner.id,
      name: `Phase 1 RLS ${suffix}`,
      target_url: 'https://httpbin.org/forms/post',
      status: 'draft',
    })
    .select('*')
    .single();
  if (workflowError) throw workflowError;
  workflowId = workflow.id;

  const { data: scenario, error: scenarioError } = await service
    .from('form_test_scenarios')
    .insert({
      workflow_id: workflow.id,
      org_id: owner.id,
      created_by: owner.id,
      name: 'Scenario principal',
      status: 'draft',
      is_default: true,
    })
    .select('*')
    .single();
  if (scenarioError) throw scenarioError;

  const { data: fixtureNodes, error: fixtureNodesError } = await service
    .from('workflow_nodes')
    .insert([
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
    ])
    .select('id,order_index');
  if (fixtureNodesError) throw fixtureNodesError;

  const sortedFixtureNodes = [...fixtureNodes].sort((a, b) => a.order_index - b.order_index);
  const { error: fixtureEdgeError } = await service.from('workflow_edges').insert({
    workflow_id: workflow.id,
    scenario_id: scenario.id,
    source_node_id: sortedFixtureNodes[0].id,
    target_node_id: sortedFixtureNodes[1].id,
  });
  if (fixtureEdgeError) throw fixtureEdgeError;

  const { data: version, error: versionError } = await service.rpc(
    'form_test_create_scenario_version',
    {
      p_scenario_id: scenario.id,
      p_created_by: owner.id,
      p_status: 'pending',
      p_note: 'Phase 1 integration test',
    },
  );
  if (versionError) throw versionError;

  const ownerClient = await authenticatedClient(users.owner);
  const adminClient = await authenticatedClient(users.admin);
  const outsiderClient = await authenticatedClient(users.outsider);

  const { data: ownerRows, error: ownerReadError } = await ownerClient
    .from('form_test_scenarios')
    .select('id')
    .eq('id', scenario.id);
  if (ownerReadError) throw ownerReadError;
  assert(ownerRows.length === 1, 'Owner must see their scenario');

  const { data: outsiderRows, error: outsiderReadError } = await outsiderClient
    .from('form_test_scenarios')
    .select('id')
    .eq('id', scenario.id);
  if (outsiderReadError) throw outsiderReadError;
  assert(outsiderRows.length === 0, 'Outsider must not see another user scenario');

  const { data: secondScenario, error: secondScenarioError } = await ownerClient
    .from('form_test_scenarios')
    .insert({
      workflow_id: workflow.id,
      org_id: owner.id,
      created_by: owner.id,
      name: 'Scenario alternatif',
      status: 'draft',
      is_default: false,
    })
    .select('id')
    .single();
  if (secondScenarioError) throw secondScenarioError;
  assert(Boolean(secondScenario.id), 'Owner must be able to create a second scenario');

  const { data: scenarioRows, error: scenarioRowsError } = await ownerClient
    .from('form_test_scenarios')
    .select('id')
    .eq('workflow_id', workflow.id);
  if (scenarioRowsError) throw scenarioRowsError;
  assert(scenarioRows.length === 2, 'Workflow must support multiple scenarios');

  const { error: selfApprovalError } = await ownerClient
    .from('form_scenario_versions')
    .update({
      status: 'approved',
      approved_by: owner.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', version.id);
  assert(Boolean(selfApprovalError), 'Owner self-approval must be rejected');

  const { data: approvedVersion, error: adminApprovalError } = await adminClient
    .from('form_scenario_versions')
    .update({
      status: 'approved',
      approved_by: admin.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', version.id)
    .select('id,status')
    .single();
  if (adminApprovalError) throw adminApprovalError;
  assert(approvedVersion.status === 'approved', 'Admin must be able to approve a pending version');

  const { error: scenarioApprovalError } = await service
    .from('form_test_scenarios')
    .update({ status: 'approved' })
    .eq('id', scenario.id);
  if (scenarioApprovalError) throw scenarioApprovalError;

  const { error: workflowApprovalError } = await service
    .from('form_workflows')
    .update({ status: 'approved', approved_by: admin.id, approved_at: new Date().toISOString() })
    .eq('id', workflow.id);
  if (workflowApprovalError) throw workflowApprovalError;

  const { data: executionData, error: approvedExecutionError } = await ownerClient.functions.invoke(
    'form-workflows-execute',
    {
      body: {
        workflow_id: workflow.id,
        scenario_id: scenario.id,
        scenario_version_id: version.id,
      },
    },
  );
  if (approvedExecutionError) throw approvedExecutionError;
  assert(
    executionData.scenario_version_id === version.id,
    'Execution must return the exact approved scenario version',
  );

  const { data: savedExecution, error: savedExecutionError } = await service
    .from('workflow_results')
    .select('scenario_id,scenario_version_id')
    .eq('id', executionData.result_id)
    .single();
  if (savedExecutionError) throw savedExecutionError;
  assert(savedExecution.scenario_id === scenario.id, 'Saved execution must reference its scenario');
  assert(
    savedExecution.scenario_version_id === version.id,
    'Saved execution must reference its approved version',
  );

  const { error: immutableError } = await service
    .from('form_scenario_versions')
    .update({ approval_note: 'must fail' })
    .eq('id', version.id);
  assert(Boolean(immutableError), 'Approved version must be immutable');

  const { data: blockedWorkflow, error: blockedWorkflowError } = await service
    .from('form_workflows')
    .insert({
      org_id: owner.id,
      created_by: owner.id,
      name: `Phase 1 blocked execution ${suffix}`,
      target_url: 'https://httpbin.org/forms/post',
      status: 'draft',
    })
    .select('id')
    .single();
  if (blockedWorkflowError) throw blockedWorkflowError;

  const { error: executionError } = await ownerClient.functions.invoke('form-workflows-execute', {
    body: { workflow_id: blockedWorkflow.id },
  });
  assert(Boolean(executionError), 'Execution must be refused while the workflow is not approved');
  await service.from('form_workflows').delete().eq('id', blockedWorkflow.id);

  console.log(JSON.stringify({
    ok: true,
    owner_can_read: true,
    outsider_isolated: true,
    multiple_scenarios_supported: true,
    self_approval_rejected: true,
    admin_approval_allowed: true,
    approved_version_immutable: true,
    execution_pinned_to_approved_version: true,
    unapproved_workflow_execution_rejected: true,
  }));
} finally {
  await cleanup();
}
