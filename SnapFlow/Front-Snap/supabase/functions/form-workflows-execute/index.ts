// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  createServiceClient,
  getScenarioForWorkflow,
  getAuthUserId,
  HttpError,
  toJson,
} from '../_shared/formTester.ts';

interface ExecuteBody {
  workflow_id?: string;
  scenario_id?: string;
  scenario_version_id?: string;
  audit_run_id?: string;
  execution_mode?: 'full' | 'step' | 'from_step' | 'scheduled';
  start_node_id?: string;
  environment?: string;
}

interface WorkflowRow {
  id: string;
  created_by: string;
  org_id: string;
  status: string;
  target_url: string;
}

interface ScenarioVersionRow {
  id: string;
  version_number: number;
  checksum: string;
  snapshot: Record<string, unknown>;
}

function canAccessWorkflow(workflow: WorkflowRow, userId: string, isAdmin: boolean): boolean {
  return isAdmin || workflow.created_by === userId || workflow.org_id === userId;
}

async function getIsAdmin(serviceClient: ReturnType<typeof createServiceClient>, userId: string): Promise<boolean> {
  const { data: isAdmin, error } = await serviceClient.rpc('has_role', {
    _user_id: userId,
    _role: 'admin',
  });
  if (error) throw new HttpError(500, `Erreur de verification de role: ${error.message}`);
  return Boolean(isAdmin);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const serviceClient = createServiceClient();
    const userId = await getAuthUserId(req);
    const isAdmin = await getIsAdmin(serviceClient, userId);
    const body = (await req.json()) as ExecuteBody;
    const workflowId = body.workflow_id;

    if (!workflowId) throw new HttpError(400, 'workflow_id requis');

    const { data: workflow, error: workflowError } = await serviceClient
      .from('form_workflows')
      .select('*')
      .eq('id', workflowId)
      .maybeSingle();

    if (workflowError) throw new HttpError(500, workflowError.message);
    if (!workflow) throw new HttpError(404, 'Workflow non trouve');

    const workflowRow = workflow as WorkflowRow;
    if (!canAccessWorkflow(workflowRow, userId, isAdmin)) {
      throw new HttpError(403, 'Acces refuse');
    }
    const scenario = await getScenarioForWorkflow(serviceClient, workflowRow, body.scenario_id);
    const executionMode = body.execution_mode ?? 'full';
    if ((executionMode === 'step' || executionMode === 'from_step') && !body.start_node_id) {
      throw new HttpError(400, 'start_node_id requis pour ce mode d execution');
    }

    const { data: enqueuePayload, error: enqueueError } = await serviceClient.rpc(
      'form_test_enqueue_manual_execution',
      {
        p_workflow_id: workflowId,
        p_scenario_id: scenario.id,
        p_scenario_version_id: body.scenario_version_id ?? null,
        p_requested_by: userId,
        p_execution_mode: executionMode,
        p_start_node_id: body.start_node_id ?? null,
        p_environment: body.environment?.trim() || 'default',
        p_audit_run_id: body.audit_run_id ?? null,
      },
    );
    if (enqueueError) throw new HttpError(500, `Erreur mise en file: ${enqueueError.message}`);

    const enqueue =
      enqueuePayload && typeof enqueuePayload === 'object'
        ? (enqueuePayload as Record<string, unknown>)
        : {};
    const savedResult =
      enqueue.execution && typeof enqueue.execution === 'object'
        ? (enqueue.execution as Record<string, unknown>)
        : null;
    const scenarioVersion =
      enqueue.scenario_version && typeof enqueue.scenario_version === 'object'
        ? (enqueue.scenario_version as unknown as ScenarioVersionRow)
        : null;
    const deduplicated = Boolean(enqueue.deduplicated);
    if (!savedResult || !scenarioVersion) {
      throw new HttpError(500, 'La mise en file n a retourne aucune execution exploitable');
    }

    if (!deduplicated) {
      const { error: logError } = await serviceClient.from('workflow_logs').insert({
        execution_id: savedResult.id,
        level: 'info',
        event_type: 'execution_queued',
        message: 'Execution ajoutee a la file d attente.',
        details_redacted: {
          execution_mode: executionMode,
          environment: body.environment?.trim() || 'default',
          step_count: savedResult.progress_total,
          scenario_version_id: scenarioVersion.id,
          runtime_snapshot: !body.scenario_version_id,
        },
      });
      if (logError) throw new HttpError(500, logError.message);

      await serviceClient.from('notifications').insert({
        user_id: workflowRow.created_by,
        title: 'Test de formulaire mis en file',
        message: `Le scenario ${scenarioVersion.version_number} attend un moteur d execution disponible.`,
        type: 'info',
        category: 'system',
        reference_id: savedResult.id,
        reference_type: 'form_execution',
      });
    }

    return toJson(
      {
        success: true,
        result_id: savedResult.id,
        execution_id: savedResult.id,
        deduplicated,
        execution: savedResult,
        status: savedResult.status,
        duration_ms: 0,
        assertions: [],
        screenshot_url: null,
        step_trace: [],
        final_url: null,
        network_summary: {},
        execution_source: savedResult.execution_source,
        scenario_id: scenario.id,
        scenario_version_id: scenarioVersion.id,
        scenario_version_number: scenarioVersion.version_number,
        scenario_checksum: scenarioVersion.checksum,
      },
      202,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      return toJson({ error: error.message }, error.status);
    }
    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return toJson({ error: message }, 500);
  }
});
