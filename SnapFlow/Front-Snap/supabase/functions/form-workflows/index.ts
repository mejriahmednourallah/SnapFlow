// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  createServiceClient,
  ensureDefaultScenario,
  getScenarioForWorkflow,
  getAuthUserId,
  HttpError,
  isWorkflowStatus,
  normalizeTargetUrl,
  readJsonBody,
  toJson,
} from '../_shared/formTester.ts';

interface FieldUpdate {
  field_id: string;
  user_value: string | null;
}

interface NodePositionUpdate {
  node_id: string;
  position_x: number;
  position_y: number;
}

interface TestCaseInput {
  name: string;
  description?: string;
  expected_outcome: 'success' | 'validation_error' | 'business_rejection' | 'server_error' | 'blocked';
  field_mutations?: Array<{
    field_id: string;
    field_name?: string;
    value: string;
    reason?: string;
  }>;
  expected_signals?: Array<Record<string, unknown>>;
  validation_scope?: 'field' | 'form';
  target_field_id?: string;
  target_field_name?: string;
  oracle?: Record<string, unknown>;
  route_steps?: Array<Record<string, unknown>>;
  form_type?: string;
  side_effects?: string[];
  purpose?: string;
  reasoning?: string;
}

interface FormWorkflowsBody {
  action?:
    | 'list'
    | 'get'
    | 'create'
    | 'create_scenario'
    | 'update_scenario_behavior'
    | 'create_test_cases'
    | 'add_node'
    | 'update_node'
    | 'delete_node'
    | 'upsert_edge'
    | 'delete_edge'
    | 'update'
    | 'submit'
    | 'results';
  workflow_id?: string;
  scenario_id?: string;
  scenario_name?: string;
  scenario_description?: string;
  expected_behavior?: 'accept' | 'reject' | 'explore';
  expectation_confidence?: number;
  suggested_severity?: 'critical' | 'high' | 'medium' | 'low';
  suggested_severity_reason?: string;
  baseline_dependent?: boolean;
  scenario_field_mutations?: Array<{
    field_id: string;
    field_name?: string;
    value: string;
    reason?: string;
  }>;
  scenario_purpose?: string;
  scenario_reasoning?: string;
  name?: string;
  target_url?: string;
  project_id?: string | null;
  status?: string;
  view?: 'mine' | 'review_queue' | 'all';
  operator_view?: boolean;
  include_results?: boolean;
  field_updates?: FieldUpdate[];
  node_position_updates?: NodePositionUpdate[];
  test_cases?: TestCaseInput[];
  node_id?: string;
  node_type?: string;
  node_config?: Record<string, unknown>;
  position_x?: number;
  position_y?: number;
  edge_id?: string;
  source_node_id?: string;
  target_node_id?: string;
  branch_key?: 'default' | 'success' | 'failure' | 'true' | 'false';
}

interface WorkflowRow {
  id: string;
  org_id: string;
  created_by: string;
  name?: string;
  project_id?: string | null;
  status: string;
  updated_at: string;
}

async function isAssignedToProject(
  serviceClient: ReturnType<typeof createServiceClient>,
  projectId: string | null | undefined,
  userId: string,
): Promise<boolean> {
  if (!projectId) return false;
  const { data, error } = await serviceClient
    .from('project_assignments')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .limit(1);
  if (error) throw new HttpError(500, error.message);
  return Boolean(data?.length);
}

async function canAccessWorkflow(
  serviceClient: ReturnType<typeof createServiceClient>,
  workflow: WorkflowRow,
  userId: string,
  isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) return true;
  return workflow.created_by === userId || workflow.org_id === userId || await isAssignedToProject(serviceClient, workflow.project_id, userId);
}

async function getIsAdmin(serviceClient: ReturnType<typeof createServiceClient>, userId: string): Promise<boolean> {
  const { data: isAdmin, error } = await serviceClient.rpc('has_role', {
    _user_id: userId,
    _role: 'admin',
  });

  if (error) {
    throw new HttpError(500, `Erreur de vérification de rôle: ${error.message}`);
  }

  return Boolean(isAdmin);
}

const EDITABLE_NODE_TYPES = new Set([
  'navigate',
  'fill',
  'select',
  'check',
  'upload',
  'click',
  'submit',
  'wait',
  'condition',
  'assert',
  'screenshot',
  'inspect_response',
]);

const ALLOWED_ORACLE_SIGNALS = new Set([
  'form_invalid',
  'validation_message_present',
  'element_present',
  'element_absent',
  'response_status',
  'response_status_range',
  'url_contains',
  'url_changed',
  'dom_changed',
  'form_disappeared',
  'network_request_matching',
  'field_value_equals',
  'success_message_present',
  'text_present',
  'text_absent',
]);

function clampOracleThreshold(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 1)) : fallback;
}

function compileOracleSignals(
  signals: unknown,
  sourceFieldIds: Set<string>,
): Array<Record<string, unknown>> {
  if (!Array.isArray(signals)) return [];
  return signals
    .filter((signal) => signal && typeof signal === 'object')
    .map((signal) => {
      const type = String(signal.type ?? '');
      if (!ALLOWED_ORACLE_SIGNALS.has(type)) {
        throw new HttpError(400, `Signal d oracle non autorise: ${type || 'vide'}`);
      }
      const fieldId = typeof signal.field_id === 'string' ? signal.field_id : undefined;
      if (fieldId && !sourceFieldIds.has(fieldId)) {
        throw new HttpError(400, 'Le signal d oracle reference un champ inconnu');
      }
      return {
        type,
        value: typeof signal.value === 'string' ? signal.value.slice(0, 1000) : undefined,
        field_id: fieldId,
        weight: Math.max(0, Math.min(Number.isFinite(Number(signal.weight)) ? Number(signal.weight) : 0.25, 10)),
        enabled: signal.enabled !== false,
      };
    })
    .slice(0, 20);
}

function inferValidationTarget(
  testCase: TestCaseInput,
  requestedMutations: NonNullable<TestCaseInput['field_mutations']>,
  sourceFieldIds: Set<string>,
  nominalValues: Map<string, string>,
): string | undefined {
  if (testCase.target_field_id && sourceFieldIds.has(testCase.target_field_id)) {
    return testCase.target_field_id;
  }

  const signaledFields = new Set(
    (testCase.expected_signals ?? [])
      .map((signal) => typeof signal.field_id === 'string' ? signal.field_id : '')
      .filter((fieldId) => sourceFieldIds.has(fieldId)),
  );
  if (signaledFields.size === 1) return [...signaledFields][0];

  const intentionallyInvalid = requestedMutations.filter((mutation) => {
    if (!sourceFieldIds.has(mutation.field_id)) return false;
    const reason = String(mutation.reason ?? '').toLowerCase();
    return mutation.value.trim() === '' ||
      /invalide|invalid|volontaire|refus|decoche|incompatible|vide|volumineu|requis|validation/.test(reason);
  });
  if (intentionallyInvalid.length === 1) return intentionallyInvalid[0].field_id;

  const changedFields = requestedMutations.filter((mutation) =>
    sourceFieldIds.has(mutation.field_id) &&
    nominalValues.has(mutation.field_id) &&
    nominalValues.get(mutation.field_id) !== mutation.value
  );
  return changedFields.length === 1 ? changedFields[0].field_id : undefined;
}

function scopeValidationSignals(
  signals: Array<Record<string, unknown>>,
  validationScope: 'field' | 'form',
  targetFieldId?: string,
): Array<Record<string, unknown>> {
  if (validationScope !== 'field' || !targetFieldId) return signals;
  return signals.map((signal) =>
    ['form_invalid', 'validation_message_present'].includes(String(signal.type))
      ? { ...signal, field_id: targetFieldId }
      : signal
  );
}

const BRANCH_KEYS = new Set(['default', 'success', 'failure', 'true', 'false']);

function cleanScenarioName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 120);
}

function deterministicFieldValue(field: Record<string, unknown>): string {
  const type = String(field.field_type ?? 'text').toLowerCase();
  const name = String(field.field_name ?? '').toLowerCase();
  if (type === 'checkbox') return 'true';
  if (type === 'radio' || type === 'select') return '';
  if (type === 'email') return 'snapflow.test@example.com';
  if (type === 'tel') return '+21620000000';
  if (type === 'number') return '1';
  if (type === 'date') return '2026-06-15';
  if (type === 'time') return '12:00';
  if (type === 'url') return 'https://example.com';
  if (type === 'password') return 'SnapFlow-Test-2026!';
  if (type === 'search') return 'test SnapFlow';
  if (type === 'file') return 'snapflow-empty.txt';
  if (/prenom|first/.test(name)) return 'Ahmed';
  if (/nom|last/.test(name)) return 'Ben Salah';
  if (/message|comment|description|objet|subject/.test(name)) {
    return 'Demande de test fonctionnel SnapFlow.';
  }
  return 'Valeur de test SnapFlow';
}

function detectedFieldFor(
  profileFields: Array<Record<string, unknown>>,
  sourceField: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return profileFields.find((field) =>
    String(field.name ?? '') === String(sourceField.field_name ?? '') ||
    String(field.selector ?? '') === String(sourceField.field_selector ?? '')
  );
}

function firstDetectedOption(
  profileFields: Array<Record<string, unknown>>,
  sourceField: Record<string, unknown>,
): string {
  const detected = detectedFieldFor(profileFields, sourceField);
  const options = Array.isArray(detected?.options) ? detected.options : [];
  const option = options.find(
    (item) => item && typeof item === 'object' && item.disabled !== true && String(item.value ?? ''),
  );
  return option && typeof option === 'object' ? String(option.value ?? '') : '';
}

function createsGraphCycle(
  edges: Array<{ source_node_id: string; target_node_id: string; branch_key: string }>,
  sourceNodeId: string,
  targetNodeId: string,
  branchKey: string,
): boolean {
  const targetsBySource = new Map<string, string[]>();
  edges
    .filter((edge) => !(edge.source_node_id === sourceNodeId && edge.branch_key === branchKey))
    .forEach((edge) => {
      targetsBySource.set(edge.source_node_id, [
        ...(targetsBySource.get(edge.source_node_id) ?? []),
        edge.target_node_id,
      ]);
    });
  targetsBySource.set(sourceNodeId, [...(targetsBySource.get(sourceNodeId) ?? []), targetNodeId]);

  const pending = [targetNodeId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    if (nodeId === sourceNodeId) return true;
    visited.add(nodeId);
    pending.push(...(targetsBySource.get(nodeId) ?? []));
  }
  return false;
}

async function getAccessibleWorkflow(
  serviceClient: ReturnType<typeof createServiceClient>,
  workflowId: string,
  userId: string,
  isAdmin: boolean,
): Promise<WorkflowRow> {
  const { data: workflow, error } = await serviceClient
    .from('form_workflows')
    .select('*')
    .eq('id', workflowId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!workflow) throw new HttpError(404, 'Workflow non trouve');
  if (!(await canAccessWorkflow(serviceClient, workflow as WorkflowRow, userId, isAdmin))) {
    throw new HttpError(403, 'Acces refuse');
  }
  return workflow as WorkflowRow;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const serviceClient = createServiceClient();
    const userId = await getAuthUserId(req);
    const isAdmin = await getIsAdmin(serviceClient, userId);

    const body = await readJsonBody<FormWorkflowsBody>(req);
    const action = body.action ?? 'list';

    if (action === 'list') {
      const status = body.status;
      if (status && !isWorkflowStatus(status)) {
        throw new HttpError(400, 'Filtre de statut invalide');
      }

      const requestedView = body.view ?? (body.operator_view ? 'review_queue' : 'mine');
      if (!['mine', 'review_queue', 'all'].includes(requestedView)) {
        throw new HttpError(400, 'Vue de workflows invalide');
      }
      if ((requestedView === 'review_queue' || requestedView === 'all') && !isAdmin) {
        throw new HttpError(403, 'Vue reservee aux administrateurs');
      }

      const projectId = typeof body.project_id === 'string' && body.project_id.trim() ? body.project_id.trim() : null;
      const { data: assignments, error: assignmentError } = await serviceClient
        .from('project_assignments')
        .select('project_id')
        .eq('user_id', userId);
      if (assignmentError) throw new HttpError(500, assignmentError.message);
      const assignedProjectIds = (assignments ?? []).map((assignment) => assignment.project_id).filter(Boolean);
      if (projectId && !isAdmin && !assignedProjectIds.includes(projectId)) {
        throw new HttpError(403, 'Projet non assigne');
      }

      let query = serviceClient.from('form_workflows').select('*').order('updated_at', { ascending: false });
      if (projectId) {
        query = query.eq('project_id', projectId);
      }

      if (requestedView === 'review_queue') {
        if (status) {
          query = query.eq('status', status);
        } else {
          query = query.in('status', ['pending', 'needs_review']);
        }
      } else if (requestedView === 'mine') {
        const accessClauses = [`created_by.eq.${userId}`, `org_id.eq.${userId}`];
        if (assignedProjectIds.length > 0) {
          accessClauses.push(`project_id.in.(${assignedProjectIds.join(',')})`);
        }
        query = query.or(accessClauses.join(','));
        if (status) query = query.eq('status', status);
      } else if (status) {
        query = query.eq('status', status);
      }

      const { data: workflows, error } = await query;
      if (error) {
        throw new HttpError(500, error.message);
      }

      const workflowList = workflows ?? [];
      const workflowIds = workflowList.map((item) => item.id);
      const projectIds = [...new Set(workflowList.map((item) => item.project_id).filter(Boolean))];
      const projectNamesById = new Map<string, string>();
      if (projectIds.length > 0) {
        const { data: projects, error: projectsError } = await serviceClient
          .from('projects')
          .select('id, site_name')
          .in('id', projectIds);
        if (projectsError) throw new HttpError(500, projectsError.message);
        for (const project of projects ?? []) {
          projectNamesById.set(project.id, project.site_name);
        }
      }

      if (workflowIds.length === 0) {
        return toJson({ workflows: [] });
      }

      const { data: results, error: resultsError } = await serviceClient
        .from('workflow_results')
        .select('id, workflow_id, status, executed_at')
        .in('workflow_id', workflowIds)
        .order('executed_at', { ascending: false });

      if (resultsError) {
        throw new HttpError(500, resultsError.message);
      }

      const latestResultsByWorkflow = new Map<string, Record<string, unknown>>();
      for (const result of results ?? []) {
        if (!latestResultsByWorkflow.has(result.workflow_id)) {
          latestResultsByWorkflow.set(result.workflow_id, result as Record<string, unknown>);
        }
      }

      return toJson({
        workflows: workflowList.map((workflow) => ({
          ...workflow,
          project_name: workflow.project_id ? projectNamesById.get(workflow.project_id) ?? null : null,
          latest_result: latestResultsByWorkflow.get(workflow.id) ?? null,
        })),
      });
    }

    if (action === 'get') {
      const workflowId = body.workflow_id;
      if (!workflowId) {
        throw new HttpError(400, 'workflow_id requis');
      }

      const { data: workflow, error: workflowError } = await serviceClient
        .from('form_workflows')
        .select('*')
        .eq('id', workflowId)
        .maybeSingle();

      if (workflowError) {
        throw new HttpError(500, workflowError.message);
      }

      if (!workflow) {
        throw new HttpError(404, 'Workflow non trouvé');
      }

      if (!(await canAccessWorkflow(serviceClient, workflow as WorkflowRow, userId, isAdmin))) {
        throw new HttpError(403, 'Accès refusé');
      }

      const scenario = await getScenarioForWorkflow(serviceClient, workflow as WorkflowRow, body.scenario_id);

      const [{ data: nodes, error: nodesError }, { data: fields, error: fieldsError }, { data: edges, error: edgesError }, { data: latestResult, error: latestResultError }] =
        await Promise.all([
          serviceClient.from('workflow_nodes').select('*').eq('scenario_id', scenario.id).order('order_index', { ascending: true }),
          serviceClient.from('workflow_form_fields').select('*').eq('scenario_id', scenario.id),
          serviceClient.from('workflow_edges').select('*').eq('scenario_id', scenario.id),
          serviceClient
            .from('workflow_results')
            .select('*')
            .eq('scenario_id', scenario.id)
            .order('executed_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

      if (nodesError) throw new HttpError(500, nodesError.message);
      if (fieldsError) throw new HttpError(500, fieldsError.message);
      if (edgesError) throw new HttpError(500, edgesError.message);
      if (latestResultError) throw new HttpError(500, latestResultError.message);

      const nodesWithFields = (nodes ?? []).map((node) => ({
        ...node,
        field: (fields ?? []).find((field) => field.node_id === node.id) ?? null,
      }));

      let results: Record<string, unknown>[] | null = null;
      if (body.include_results) {
        const { data: allResults, error: allResultsError } = await serviceClient
          .from('workflow_results')
          .select('*')
          .eq('scenario_id', scenario.id)
          .order('executed_at', { ascending: false });
        if (allResultsError) throw new HttpError(500, allResultsError.message);
        results = (allResults ?? []) as Record<string, unknown>[];
      }

      const [{ data: scenarios, error: scenariosError }, { data: versions, error: versionsError }] = await Promise.all([
        serviceClient
          .from('form_test_scenarios')
          .select('*')
          .eq('workflow_id', workflowId)
          .order('created_at', { ascending: true }),
        serviceClient
          .from('form_scenario_versions')
          .select('*')
          .eq('scenario_id', scenario.id)
          .order('version_number', { ascending: false }),
      ]);

      if (scenariosError) throw new HttpError(500, scenariosError.message);
      if (versionsError) throw new HttpError(500, versionsError.message);

      return toJson({
        workflow,
        active_scenario: scenario,
        scenarios: scenarios ?? [],
        scenario_versions: versions ?? [],
        nodes: nodesWithFields,
        edges: edges ?? [],
        latest_result: latestResult ?? null,
        results,
      });
    }

    if (action === 'create') {
      const name = body.name?.trim();
      const targetUrl = body.target_url?.trim();

      if (!name || !targetUrl) {
        throw new HttpError(400, 'name et target_url sont requis');
      }

      const { data: created, error } = await serviceClient.rpc('form_test_create_workflow', {
        p_org_id: userId,
        p_created_by: userId,
        p_name: name,
        p_target_url: normalizeTargetUrl(targetUrl),
      });

      if (error) throw new HttpError(500, `Erreur creation workflow: ${error.message}`);
      const payload = created && typeof created === 'object' ? created : {};
      if (!payload.workflow || !payload.scenario) {
        throw new HttpError(500, 'Creation workflow incomplete');
      }
      const projectId = typeof body.project_id === 'string' && body.project_id.trim() ? body.project_id.trim() : null;
      if (projectId) {
        if (!isAdmin && !(await isAssignedToProject(serviceClient, projectId, userId))) {
          throw new HttpError(403, 'Projet non assigne');
        }
        const { data: linkedWorkflow, error: linkError } = await serviceClient
          .from('form_workflows')
          .update({ project_id: projectId })
          .eq('id', payload.workflow.id)
          .select('*')
          .single();
        if (linkError) throw new HttpError(500, linkError.message);
        payload.workflow = linkedWorkflow;
      }
      return toJson(payload, 201);
    }

    if (action === 'create_scenario') {
      const workflowId = body.workflow_id;
      const scenarioName = body.scenario_name?.trim();
      if (!workflowId || !scenarioName) {
        throw new HttpError(400, 'workflow_id et scenario_name sont requis');
      }

      const { data: workflow, error: workflowError } = await serviceClient
        .from('form_workflows')
        .select('*')
        .eq('id', workflowId)
        .maybeSingle();

      if (workflowError) throw new HttpError(500, workflowError.message);
      if (!workflow) throw new HttpError(404, 'Workflow non trouve');
      if (!(await canAccessWorkflow(serviceClient, workflow as WorkflowRow, userId, isAdmin))) {
        throw new HttpError(403, 'Acces refuse');
      }

      const { data: scenario, error: scenarioError } = await serviceClient
        .from('form_test_scenarios')
        .insert({
          workflow_id: workflowId,
          org_id: workflow.org_id,
          created_by: userId,
          name: scenarioName,
          description: body.scenario_description?.trim() || null,
          status: 'draft',
          is_default: false,
        })
        .select('*')
        .single();

      if (scenarioError) throw new HttpError(500, scenarioError.message);
      return toJson({ scenario }, 201);
    }

    if (action === 'create_test_cases') {
      const workflowId = body.workflow_id;
      const sourceScenarioId = body.scenario_id;
      const cases = Array.isArray(body.test_cases) ? body.test_cases.slice(0, 12) : [];
      if (!workflowId || !sourceScenarioId || cases.length === 0) {
        throw new HttpError(400, 'workflow_id, scenario_id et test_cases sont requis');
      }

      const workflow = await getAccessibleWorkflow(serviceClient, workflowId, userId, isAdmin);
      const sourceScenario = await getScenarioForWorkflow(serviceClient, workflow, sourceScenarioId);
      const { data: sourceFields, error: fieldsError } = await serviceClient
        .from('workflow_form_fields')
        .select(
          'id, field_name, field_label, field_type, field_selector, required, user_value, ai_suggestion',
        )
        .eq('scenario_id', sourceScenario.id);
      if (fieldsError) throw new HttpError(500, fieldsError.message);
      const sourceFieldIds = new Set((sourceFields ?? []).map((field) => field.id));
      const sourceFieldById = new Map((sourceFields ?? []).map((field) => [field.id, field]));
      const profile = workflow.detection_evidence?.form_profile &&
        typeof workflow.detection_evidence.form_profile === 'object'
        ? workflow.detection_evidence.form_profile
        : {};
      const profileFields = Array.isArray(profile.fields)
        ? profile.fields.filter(
            (field): field is Record<string, unknown> =>
              Boolean(field && typeof field === 'object'),
          )
        : [];
      const profileSteps = Array.isArray(profile.steps) ? profile.steps : [];
      const allowedRouteSelectors = new Set<string>();
      for (const step of profileSteps) {
        if (!step || typeof step !== 'object') continue;
        for (const key of ['next_selectors', 'back_selectors']) {
          const selectors = Array.isArray(step[key]) ? step[key] : [];
          selectors.map(String).filter(Boolean).forEach((selector) => allowedRouteSelectors.add(selector));
        }
        const routeSteps = Array.isArray(step.route_steps) ? step.route_steps : [];
        routeSteps.forEach((routeStep) => {
          if (routeStep && typeof routeStep === 'object' && routeStep.kind === 'click') {
            const selector = String(routeStep.selector ?? '');
            if (selector) allowedRouteSelectors.add(selector);
          }
        });
      }

      const { data: existingScenarios, error: scenariosError } = await serviceClient
        .from('form_test_scenarios')
        .select('name')
        .eq('workflow_id', workflowId);
      if (scenariosError) throw new HttpError(500, scenariosError.message);
      const usedNames = new Set((existingScenarios ?? []).map((scenario) => scenario.name.toLowerCase()));
      const createdScenarios: Record<string, unknown>[] = [];
      const branchingV2Enabled = Deno.env.get('FORM_TESTER_AI_BRANCHING_V2') !== 'false';

      if (branchingV2Enabled && cases.some((testCase) => Number(testCase?.plan_version ?? 0) >= 2)) {
        const compiledCases: Record<string, unknown>[] = [];
        for (const testCase of cases) {
          if (!testCase || typeof testCase !== 'object') continue;
          if (!['success', 'validation_error', 'business_rejection', 'server_error', 'blocked'].includes(testCase.expected_outcome)) {
            throw new HttpError(400, 'Resultat attendu invalide');
          }

          const baseName = cleanScenarioName(testCase.name || 'Cas de test');
          if (!baseName) throw new HttpError(400, 'Nom de cas de test requis');
          let uniqueName = baseName;
          let suffix = 2;
          while (usedNames.has(uniqueName.toLowerCase())) {
            uniqueName = `${baseName} (${suffix})`;
            suffix += 1;
          }
          usedNames.add(uniqueName.toLowerCase());

          const requestedMutations = (testCase.field_mutations ?? []).filter(
            (mutation) =>
              mutation &&
              typeof mutation.value === 'string' &&
              sourceFieldIds.has(mutation.field_id),
          );
          if (requestedMutations.length === 0) {
            throw new HttpError(400, `Le cas ${uniqueName} ne contient aucune valeur de champ valide`);
          }
          const requestedByField = new Map(
            requestedMutations.map((mutation) => [mutation.field_id, mutation]),
          );
          const fieldMutations = (sourceFields ?? []).map((sourceField) => {
            const requested = requestedByField.get(sourceField.id);
            if (requested) return requested;
            const configured = typeof sourceField.user_value === 'string'
              ? sourceField.user_value
              : '';
            const suggested = typeof sourceField.ai_suggestion === 'string'
              ? sourceField.ai_suggestion
              : '';
            const optionValue = ['select', 'radio'].includes(String(sourceField.field_type).toLowerCase())
              ? firstDetectedOption(profileFields, sourceField)
              : '';
            return {
              field_id: sourceField.id,
              field_name: sourceField.field_name,
              value: configured || suggested || optionValue || deterministicFieldValue(sourceField),
              reason: configured
                ? 'Valeur configuree par l utilisateur'
                : suggested
                ? 'Suggestion IA approuvee'
                : 'Valeur nominale deterministe',
            };
          });

          const intentionallyEmptyRequired = new Set(
            requestedMutations
              .filter((mutation) => mutation.value.trim() === '')
              .map((mutation) => mutation.field_id),
          );
          for (const sourceField of sourceFields ?? []) {
            const mutation = fieldMutations.find((item) => item.field_id === sourceField.id);
            const missingRequired = sourceField.required && !String(mutation?.value ?? '').trim();
            const allowedValidationGap =
              testCase.expected_outcome === 'validation_error' &&
              intentionallyEmptyRequired.has(sourceField.id);
            if (missingRequired && !allowedValidationGap) {
              throw new HttpError(
                400,
                `Le cas ${uniqueName} ne peut pas etre compile: valeur requise manquante pour ${sourceField.field_name}`,
              );
            }
          }
          for (const mutation of fieldMutations) {
            const sourceField = sourceFieldById.get(mutation.field_id);
            if (!sourceField || !['select', 'radio'].includes(String(sourceField.field_type).toLowerCase())) {
              continue;
            }
            const detectedField = detectedFieldFor(profileFields, sourceField);
            const allowedValues = Array.isArray(detectedField?.options)
              ? detectedField.options
                  .filter((option) => option && typeof option === 'object' && option.disabled !== true)
                  .map((option) => String(option.value ?? ''))
              : [];
            if (allowedValues.length > 0 && !allowedValues.includes(mutation.value)) {
              throw new HttpError(400, `Le cas ${uniqueName} utilise une option non detectee pour ${sourceField.field_name}`);
            }
          }

          const targetFieldId = testCase.expected_outcome === 'validation_error'
            ? inferValidationTarget(
                testCase,
                requestedMutations,
                sourceFieldIds,
                new Map(
                  (sourceFields ?? []).map((sourceField) => {
                    const configured = typeof sourceField.user_value === 'string' ? sourceField.user_value : '';
                    const suggested = typeof sourceField.ai_suggestion === 'string' ? sourceField.ai_suggestion : '';
                    const optionValue = ['select', 'radio'].includes(String(sourceField.field_type).toLowerCase())
                      ? firstDetectedOption(profileFields, sourceField)
                      : '';
                    return [
                      sourceField.id,
                      configured || suggested || optionValue || deterministicFieldValue(sourceField),
                    ];
                  }),
                ),
              )
            : undefined;
          const validationScope: 'field' | 'form' | undefined =
            testCase.expected_outcome === 'validation_error'
              ? testCase.validation_scope === 'form'
                ? 'form'
                : targetFieldId
                  ? 'field'
                  : 'form'
              : undefined;
          const expectedSignals = scopeValidationSignals(
            compileOracleSignals(testCase.expected_signals, sourceFieldIds),
            validationScope ?? 'form',
            targetFieldId,
          );
          const rawOracle = testCase.oracle && typeof testCase.oracle === 'object'
            ? testCase.oracle
            : {};
          const oracleSignals = scopeValidationSignals(
            compileOracleSignals(
              Array.isArray(rawOracle.signals) ? rawOracle.signals : expectedSignals,
              sourceFieldIds,
            ),
            validationScope ?? 'form',
            targetFieldId,
          );
          const targetField = targetFieldId ? sourceFieldById.get(targetFieldId) : undefined;
          const passThreshold = clampOracleThreshold(rawOracle.pass_threshold, 0.65);
          const inconclusiveThreshold = Math.min(
            clampOracleThreshold(rawOracle.inconclusive_threshold, 0.4),
            passThreshold,
          );
          const oracle = {
            expected_outcome: testCase.expected_outcome,
            pass_threshold: passThreshold,
            inconclusive_threshold: inconclusiveThreshold,
            signals: oracleSignals,
          };
          const routeSteps = (Array.isArray(testCase.route_steps) ? testCase.route_steps : [])
            .map((step) => {
              if (!step || typeof step !== 'object') {
                throw new HttpError(400, `Le cas ${uniqueName} contient une etape de parcours invalide`);
              }
              const type = String(step.type ?? '');
              if (type === 'click') {
                const selector = String(step.selector ?? '');
                if (!selector || !allowedRouteSelectors.has(selector)) {
                  throw new HttpError(400, `Le cas ${uniqueName} utilise un selecteur de parcours non detecte`);
                }
                return { ...step, type, selector };
              }
              if (type === 'wait') {
                const duration = Number(step.duration_ms ?? step.value ?? 500);
                return {
                  ...step,
                  type,
                  duration_ms: Math.max(0, Math.min(Number.isFinite(duration) ? duration : 500, 10_000)),
                };
              }
              throw new HttpError(400, `Le cas ${uniqueName} contient un type de parcours non autorise`);
            })
            .slice(0, 24);
          compiledCases.push({
            name: uniqueName,
            description: testCase.description?.trim() || null,
            expected_outcome: testCase.expected_outcome,
            generated_at: new Date().toISOString(),
            case_definition: {
              plan_version: 2,
              form_type: testCase.form_type ?? 'generic',
              field_mutations: fieldMutations,
              expected_signals: expectedSignals,
              validation_scope: validationScope,
              target_field_id: targetFieldId,
              target_field_name:
                targetField?.field_label ||
                targetField?.field_name ||
                testCase.target_field_name,
              route_steps: routeSteps,
              oracle,
              side_effects: Array.isArray(testCase.side_effects) ? testCase.side_effects.slice(0, 20) : [],
              purpose: testCase.purpose?.trim() || '',
              reasoning: testCase.reasoning?.trim() || '',
              expected_behavior:
                testCase.expected_behavior === 'accept' ||
                testCase.expected_behavior === 'reject' ||
                testCase.expected_behavior === 'explore'
                  ? testCase.expected_behavior
                  : testCase.expected_outcome === 'success'
                    ? 'accept'
                    : ['validation_error', 'business_rejection'].includes(testCase.expected_outcome)
                      ? 'reject'
                      : 'explore',
              expectation_confidence: Math.max(
                0,
                Math.min(Number(testCase.expectation_confidence ?? 0.8), 1),
              ),
              suggested_severity: ['critical', 'high', 'medium', 'low'].includes(testCase.suggested_severity)
                ? testCase.suggested_severity
                : 'low',
              suggested_severity_reason: testCase.suggested_severity_reason?.trim() || '',
              baseline_dependent: testCase.baseline_dependent ?? testCase.expected_outcome === 'success',
              generated_at: new Date().toISOString(),
            },
          });
        }

        const { data: compiled, error: compileError } = await serviceClient.rpc(
          'form_test_apply_generated_suite',
          {
            p_source_scenario_id: sourceScenario.id,
            p_cases: compiledCases,
            p_created_by: userId,
          },
        );
        if (compileError) throw new HttpError(500, `Erreur compilation suite IA: ${compileError.message}`);
        return toJson({
          success: true,
          plan_version: 2,
          scenarios: Array.isArray(compiled) ? compiled : [],
        }, 201);
      }

      for (const testCase of cases) {
        if (!testCase || typeof testCase !== 'object') continue;
        if (!['success', 'validation_error', 'business_rejection', 'server_error', 'blocked'].includes(testCase.expected_outcome)) {
          throw new HttpError(400, 'Resultat attendu invalide');
        }

        const baseName = cleanScenarioName(testCase.name || 'Cas de test');
        if (!baseName) throw new HttpError(400, 'Nom de cas de test requis');
        let uniqueName = baseName;
        let suffix = 2;
        while (usedNames.has(uniqueName.toLowerCase())) {
          uniqueName = `${baseName} (${suffix})`;
          suffix += 1;
        }
        usedNames.add(uniqueName.toLowerCase());

        const fieldMutations = (testCase.field_mutations ?? []).filter(
          (mutation) =>
            mutation &&
            typeof mutation.value === 'string' &&
            sourceFieldIds.has(mutation.field_id),
        );
        const caseDefinition = {
          field_mutations: fieldMutations,
          expected_signals: Array.isArray(testCase.expected_signals)
            ? testCase.expected_signals
            : [],
          reasoning: testCase.reasoning?.trim() || '',
        };

        const { data: clonedScenario, error: cloneError } = await serviceClient.rpc(
          'form_test_clone_scenario_case',
          {
            p_source_scenario_id: sourceScenario.id,
            p_name: uniqueName,
            p_description: testCase.description?.trim() || null,
            p_expected_outcome: testCase.expected_outcome,
            p_generation_source: 'ai',
            p_case_definition: caseDefinition,
            p_created_by: userId,
          },
        );
        if (cloneError) throw new HttpError(500, `Erreur clonage scenario: ${cloneError.message}`);
        createdScenarios.push(clonedScenario as Record<string, unknown>);
      }

      return toJson({ success: true, scenarios: createdScenarios }, 201);
    }

    if (action === 'update_scenario_behavior') {
      if (!body.workflow_id || !body.scenario_id) {
        throw new HttpError(400, 'workflow_id et scenario_id requis');
      }
      const workflow = await getAccessibleWorkflow(
        serviceClient,
        body.workflow_id,
        userId,
        isAdmin,
      );
      const scenario = await getScenarioForWorkflow(
        serviceClient,
        workflow,
        body.scenario_id,
      );
      const currentDefinition =
        scenario.case_definition && typeof scenario.case_definition === 'object'
          ? scenario.case_definition
          : {};
      const behavior = body.expected_behavior;
      if (!behavior || !['accept', 'reject', 'explore'].includes(behavior)) {
        throw new HttpError(400, 'expected_behavior invalide');
      }
      const nextDefinition = {
        ...currentDefinition,
        expected_behavior: behavior,
        expectation_confidence: Math.max(
          0,
          Math.min(Number(body.expectation_confidence ?? currentDefinition.expectation_confidence ?? 0.8), 1),
        ),
        suggested_severity: ['critical', 'high', 'medium', 'low'].includes(String(body.suggested_severity))
          ? body.suggested_severity
          : currentDefinition.suggested_severity ?? 'low',
        suggested_severity_reason:
          body.suggested_severity_reason?.trim() ??
          currentDefinition.suggested_severity_reason ??
          '',
        baseline_dependent:
          typeof body.baseline_dependent === 'boolean'
            ? body.baseline_dependent
            : behavior === 'accept',
        purpose: body.scenario_purpose?.trim() ?? currentDefinition.purpose ?? '',
        reasoning: body.scenario_reasoning?.trim() ?? currentDefinition.reasoning ?? '',
        field_mutations: Array.isArray(body.scenario_field_mutations)
          ? body.scenario_field_mutations.slice(0, 100)
          : currentDefinition.field_mutations ?? [],
      };
      if (Array.isArray(body.scenario_field_mutations)) {
        for (const mutation of body.scenario_field_mutations) {
          if (!mutation.field_id) continue;
          const { data: updatedFields, error: fieldError } = await serviceClient
            .from('workflow_form_fields')
            .update({ user_value: String(mutation.value ?? '') })
            .eq('id', mutation.field_id)
            .eq('workflow_id', body.workflow_id)
            .eq('scenario_id', scenario.id)
            .select('id');
          if (fieldError) throw new HttpError(500, fieldError.message);
          if (!updatedFields || updatedFields.length === 0) {
            throw new HttpError(400, `Champ inconnu dans le scenario: ${mutation.field_id}`);
          }
        }
      }
      const { data: updated, error } = await serviceClient
        .from('form_test_scenarios')
        .update({
          case_definition: nextDefinition,
          updated_at: new Date().toISOString(),
        })
        .eq('id', scenario.id)
        .eq('workflow_id', body.workflow_id)
        .select('*')
        .single();
      if (error) throw new HttpError(500, error.message);
      return toJson({ scenario: updated });
    }

    if (['add_node', 'update_node', 'delete_node', 'upsert_edge', 'delete_edge'].includes(action)) {
      const workflowId = body.workflow_id;
      const scenarioId = body.scenario_id;
      if (!workflowId || !scenarioId) {
        throw new HttpError(400, 'workflow_id et scenario_id sont requis');
      }
      const workflow = await getAccessibleWorkflow(serviceClient, workflowId, userId, isAdmin);
      if (workflow.status === 'executed' && !isAdmin) {
        throw new HttpError(400, 'Le workflow execute doit etre duplique avant modification');
      }
      const scenario = await getScenarioForWorkflow(serviceClient, workflow, scenarioId);

      if (action === 'add_node') {
        const nodeType = String(body.node_type ?? '');
        if (!EDITABLE_NODE_TYPES.has(nodeType)) {
          throw new HttpError(400, 'Type de noeud non modifiable ou invalide');
        }
        const { data: maxOrderRow, error: orderError } = await serviceClient
          .from('workflow_nodes')
          .select('order_index')
          .eq('scenario_id', scenario.id)
          .order('order_index', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (orderError) throw new HttpError(500, orderError.message);
        const { data: node, error: nodeError } = await serviceClient
          .from('workflow_nodes')
          .insert({
            workflow_id: workflowId,
            scenario_id: scenario.id,
            type: nodeType,
            order_index: Number(maxOrderRow?.order_index ?? -1) + 1,
            position_x: Number.isFinite(body.position_x) ? body.position_x : 420,
            position_y: Number.isFinite(body.position_y) ? body.position_y : 320,
            config: body.node_config ?? {},
          })
          .select('*')
          .single();
        if (nodeError) throw new HttpError(500, nodeError.message);
        return toJson({ success: true, node }, 201);
      }

      if (action === 'update_node') {
        if (!body.node_id) throw new HttpError(400, 'node_id requis');
        const updates: Record<string, unknown> = {};
        if (body.node_config && typeof body.node_config === 'object') updates.config = body.node_config;
        if (Number.isFinite(body.position_x)) updates.position_x = body.position_x;
        if (Number.isFinite(body.position_y)) updates.position_y = body.position_y;
        const { data: node, error: nodeError } = await serviceClient
          .from('workflow_nodes')
          .update(updates)
          .eq('id', body.node_id)
          .eq('scenario_id', scenario.id)
          .select('*')
          .maybeSingle();
        if (nodeError) throw new HttpError(500, nodeError.message);
        if (!node) throw new HttpError(404, 'Noeud introuvable');
        return toJson({ success: true, node });
      }

      if (action === 'delete_node') {
        if (!body.node_id) throw new HttpError(400, 'node_id requis');
        const { data: node, error: lookupError } = await serviceClient
          .from('workflow_nodes')
          .select('id, type')
          .eq('id', body.node_id)
          .eq('scenario_id', scenario.id)
          .maybeSingle();
        if (lookupError) throw new HttpError(500, lookupError.message);
        if (!node) throw new HttpError(404, 'Noeud introuvable');
        if (node.type === 'trigger') throw new HttpError(400, 'Le noeud de depart ne peut pas etre supprime');
        const { error: deleteError } = await serviceClient
          .from('workflow_nodes')
          .delete()
          .eq('id', body.node_id)
          .eq('scenario_id', scenario.id);
        if (deleteError) throw new HttpError(500, deleteError.message);
        return toJson({ success: true });
      }

      if (action === 'upsert_edge') {
        const sourceNodeId = body.source_node_id;
        const targetNodeId = body.target_node_id;
        const branchKey = body.branch_key ?? 'default';
        if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) {
          throw new HttpError(400, 'Arete source/cible invalide');
        }
        if (!BRANCH_KEYS.has(branchKey)) throw new HttpError(400, 'Type de branche invalide');
        const { data: edgeNodes, error: edgeNodesError } = await serviceClient
          .from('workflow_nodes')
          .select('id, type')
          .eq('scenario_id', scenario.id)
          .in('id', [sourceNodeId, targetNodeId]);
        if (edgeNodesError) throw new HttpError(500, edgeNodesError.message);
        if ((edgeNodes ?? []).length !== 2) throw new HttpError(400, 'Noeud source ou cible hors scenario');
        const sourceNode = edgeNodes?.find((node) => node.id === sourceNodeId);
        const allowedKeys =
          sourceNode?.type === 'condition'
            ? new Set(['true', 'false'])
            : new Set(['default', 'success', 'failure']);
        if (!allowedKeys.has(branchKey)) throw new HttpError(400, 'Branche incompatible avec le noeud source');

        if (sourceNode?.type !== 'condition' && branchKey === 'failure') {
          const { data: currentBranches, error: currentBranchesError } = await serviceClient
            .from('workflow_edges')
            .select('id, branch_key')
            .eq('scenario_id', scenario.id)
            .eq('source_node_id', sourceNodeId)
            .in('branch_key', ['default', 'success']);
          if (currentBranchesError) throw new HttpError(500, currentBranchesError.message);
          const defaultEdge = currentBranches?.find((edge) => edge.branch_key === 'default');
          const successEdge = currentBranches?.find((edge) => edge.branch_key === 'success');
          if (defaultEdge && successEdge) {
            const { error: removeLegacyDefaultError } = await serviceClient
              .from('workflow_edges')
              .delete()
              .eq('id', defaultEdge.id);
            if (removeLegacyDefaultError) throw new HttpError(500, removeLegacyDefaultError.message);
          } else if (defaultEdge) {
            const { error: promoteDefaultError } = await serviceClient
              .from('workflow_edges')
              .update({ branch_key: 'success' })
              .eq('id', defaultEdge.id);
            if (promoteDefaultError) throw new HttpError(500, promoteDefaultError.message);
          }
        }

        const { data: scenarioEdges, error: scenarioEdgesError } = await serviceClient
          .from('workflow_edges')
          .select('source_node_id, target_node_id, branch_key')
          .eq('scenario_id', scenario.id);
        if (scenarioEdgesError) throw new HttpError(500, scenarioEdgesError.message);
        if (createsGraphCycle(
          (scenarioEdges ?? []) as Array<{ source_node_id: string; target_node_id: string; branch_key: string }>,
          sourceNodeId,
          targetNodeId,
          branchKey,
        )) {
          throw new HttpError(400, 'Cette connexion creerait une boucle dans le scenario');
        }

        let replaceEdgeQuery = serviceClient
          .from('workflow_edges')
          .delete()
          .eq('scenario_id', scenario.id)
          .eq('source_node_id', sourceNodeId);
        replaceEdgeQuery =
          sourceNode?.type !== 'condition' && branchKey === 'success'
            ? replaceEdgeQuery.in('branch_key', ['default', 'success'])
            : replaceEdgeQuery.eq('branch_key', branchKey);
        const { error: replaceEdgeError } = await replaceEdgeQuery;
        if (replaceEdgeError) throw new HttpError(500, replaceEdgeError.message);

        const { data: existingEdge, error: existingEdgeError } = await serviceClient
          .from('workflow_edges')
          .select('id, branch_key')
          .eq('scenario_id', scenario.id)
          .eq('source_node_id', sourceNodeId)
          .eq('target_node_id', targetNodeId)
          .maybeSingle();
        if (existingEdgeError) throw new HttpError(500, existingEdgeError.message);
        if (existingEdge) {
          throw new HttpError(
            400,
            `La cible utilise deja la branche ${existingEdge.branch_key}. Choisissez une cible distincte.`,
          );
        }

        const { data: edge, error: edgeError } = await serviceClient
          .from('workflow_edges')
          .insert({
            workflow_id: workflowId,
            scenario_id: scenario.id,
            source_node_id: sourceNodeId,
            target_node_id: targetNodeId,
            branch_key: branchKey,
          })
          .select('*')
          .single();
        if (edgeError) throw new HttpError(500, edgeError.message);
        return toJson({ success: true, edge }, 201);
      }

      if (action === 'delete_edge') {
        if (!body.edge_id) throw new HttpError(400, 'edge_id requis');
        const { error: edgeError } = await serviceClient
          .from('workflow_edges')
          .delete()
          .eq('id', body.edge_id)
          .eq('scenario_id', scenario.id);
        if (edgeError) throw new HttpError(500, edgeError.message);
        return toJson({ success: true });
      }
    }

    if (action === 'update') {
      const workflowId = body.workflow_id;
      if (!workflowId) {
        throw new HttpError(400, 'workflow_id requis');
      }

      const { data: workflow, error: workflowError } = await serviceClient
        .from('form_workflows')
        .select('*')
        .eq('id', workflowId)
        .maybeSingle();

      if (workflowError) throw new HttpError(500, workflowError.message);
      if (!workflow) throw new HttpError(404, 'Workflow non trouvé');

      const isOwner = workflow.created_by === userId;
      if (!isOwner && !isAdmin) throw new HttpError(403, 'Accès refusé');
      if (workflow.status === 'executed' && !isAdmin) {
        throw new HttpError(400, 'Dupliquez ou re-detectez le workflow execute avant modification');
      }

      const updates: Record<string, unknown> = {};
      if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();
      if (typeof body.target_url === 'string' && body.target_url.trim()) {
        updates.target_url = normalizeTargetUrl(body.target_url);
      }
      if ('project_id' in body) {
        const nextProjectId = typeof body.project_id === 'string' && body.project_id.trim() ? body.project_id.trim() : null;
        if (nextProjectId && !isAdmin && !(await isAssignedToProject(serviceClient, nextProjectId, userId))) {
          throw new HttpError(403, 'Projet non assigne');
        }
        updates.project_id = nextProjectId;
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await serviceClient.from('form_workflows').update(updates).eq('id', workflowId);
        if (updateError) throw new HttpError(500, updateError.message);
      }

      if (Array.isArray(body.field_updates) && body.field_updates.length > 0) {
        for (const update of body.field_updates) {
          if (!update.field_id) continue;
          const { error: fieldError } = await serviceClient
            .from('workflow_form_fields')
            .update({ user_value: update.user_value })
            .eq('id', update.field_id)
            .eq('workflow_id', workflowId);
          if (fieldError) throw new HttpError(500, fieldError.message);
        }
      }

      if (Array.isArray(body.node_position_updates) && body.node_position_updates.length > 0) {
        for (const update of body.node_position_updates) {
          if (!update.node_id) continue;
          if (!Number.isFinite(update.position_x) || !Number.isFinite(update.position_y)) {
            throw new HttpError(400, 'Position de noeud invalide');
          }

          const { data: updatedNodes, error: nodeError } = await serviceClient
            .from('workflow_nodes')
            .update({
              position_x: Math.round(update.position_x),
              position_y: Math.round(update.position_y),
            })
            .eq('id', update.node_id)
            .eq('workflow_id', workflowId)
            .select('id');

          if (nodeError) throw new HttpError(500, nodeError.message);
          if (!updatedNodes || updatedNodes.length === 0) {
            throw new HttpError(404, 'Noeud non trouve pour ce workflow');
          }
        }
      }

      return toJson({ success: true });
    }

    if (action === 'submit') {
      const workflowId = body.workflow_id;
      if (!workflowId) {
        throw new HttpError(400, 'workflow_id requis');
      }

      const { data: existingWorkflow, error: existingWorkflowError } = await serviceClient
        .from('form_workflows')
        .select('*')
        .eq('id', workflowId)
        .maybeSingle();

      if (existingWorkflowError) throw new HttpError(500, existingWorkflowError.message);
      if (!existingWorkflow) throw new HttpError(404, 'Workflow non trouve');
      if (existingWorkflow.created_by !== userId && !isAdmin) throw new HttpError(403, 'Acces refuse');
      if (existingWorkflow.status !== 'draft') throw new HttpError(400, 'Seuls les workflows en brouillon peuvent etre soumis');

      const scenario = await getScenarioForWorkflow(serviceClient, existingWorkflow as WorkflowRow, body.scenario_id);
      const { data: scenarioVersion, error: versionError } = await serviceClient.rpc(
        'form_test_create_scenario_version',
        {
          p_scenario_id: scenario.id,
          p_created_by: userId,
          p_status: 'pending',
          p_note: null,
        },
      );

      if (versionError) throw new HttpError(500, `Erreur creation version: ${versionError.message}`);

      const { data: workflow, error } = await serviceClient
        .from('form_workflows')
        .update({ status: 'pending' })
        .eq('id', workflowId)
        .eq('status', 'draft')
        .select('*')
        .maybeSingle();

      if (error) throw new HttpError(500, error.message);
      if (!workflow) throw new HttpError(400, 'Impossible de soumettre ce workflow');

      return toJson({ workflow, scenario, scenario_version: scenarioVersion });
    }

    if (action === 'results') {
      const workflowId = body.workflow_id;
      if (!workflowId) {
        throw new HttpError(400, 'workflow_id requis');
      }

      const { data: workflow, error: workflowError } = await serviceClient
        .from('form_workflows')
        .select('id, org_id, created_by, status, updated_at')
        .eq('id', workflowId)
        .maybeSingle();

      if (workflowError) throw new HttpError(500, workflowError.message);
      if (!workflow) throw new HttpError(404, 'Workflow non trouvé');
      if (!(await canAccessWorkflow(serviceClient, workflow as WorkflowRow, userId, isAdmin))) {
        throw new HttpError(403, 'Accès refusé');
      }

      const { data: results, error: resultsError } = await serviceClient
        .from('workflow_results')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('executed_at', { ascending: false });

      if (resultsError) throw new HttpError(500, resultsError.message);

      return toJson({ results: results ?? [] });
    }

    throw new HttpError(400, 'Action non supportée');
  } catch (error) {
    if (error instanceof HttpError) {
      return toJson({ error: error.message }, error.status);
    }

    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return toJson({ error: message }, 500);
  }
});
