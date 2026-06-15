// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  createServiceClient,
  ensureAdmin,
  getScenarioForWorkflow,
  getAuthUserId,
  HttpError,
  toJson,
} from '../_shared/formTester.ts';

interface ApproveBody {
  workflow_id?: string;
  scenario_id?: string;
  scenario_version_id?: string;
  action?: 'approve' | 'reject';
  note?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const serviceClient = createServiceClient();
    const userId = await getAuthUserId(req);
    await ensureAdmin(serviceClient, userId);

    const body = (await req.json()) as ApproveBody;
    const workflowId = body.workflow_id;
    const action = body.action;
    const note = body.note?.trim();

    if (!workflowId || (action !== 'approve' && action !== 'reject')) {
      throw new HttpError(400, 'workflow_id et action (approve|reject) requis');
    }

    if (action === 'reject' && !note) {
      throw new HttpError(400, 'Une note est obligatoire pour rejeter le workflow');
    }

    const { data: currentWorkflow, error: workflowLoadError } = await serviceClient
      .from('form_workflows')
      .select('*')
      .eq('id', workflowId)
      .maybeSingle();

    if (workflowLoadError) throw new HttpError(500, workflowLoadError.message);
    if (!currentWorkflow) throw new HttpError(404, 'Workflow introuvable');

    const scenario = await getScenarioForWorkflow(serviceClient, currentWorkflow, body.scenario_id);

    let versionQuery = serviceClient
      .from('form_scenario_versions')
      .select('*')
      .eq('scenario_id', scenario.id)
      .eq('status', 'pending');

    if (body.scenario_version_id) {
      versionQuery = versionQuery.eq('id', body.scenario_version_id);
    } else {
      versionQuery = versionQuery.order('version_number', { ascending: false }).limit(1);
    }

    const { data: versionRows, error: versionLoadError } = await versionQuery;
    if (versionLoadError) throw new HttpError(500, versionLoadError.message);

    const scenarioVersion = Array.isArray(versionRows) ? versionRows[0] : versionRows;
    if (!scenarioVersion) {
      throw new HttpError(400, 'Aucune version en attente pour ce scenario');
    }

    const versionUpdate =
      action === 'approve'
        ? {
            status: 'approved',
            approved_by: userId,
            approved_at: new Date().toISOString(),
            approval_note: note ?? null,
            rejection_note: null,
            rejected_at: null,
          }
        : {
            status: 'rejected',
            approved_by: null,
            approved_at: null,
            approval_note: null,
            rejection_note: note,
            rejected_at: new Date().toISOString(),
          };

    const { data: approvedVersion, error: versionUpdateError } = await serviceClient
      .from('form_scenario_versions')
      .update(versionUpdate)
      .eq('id', scenarioVersion.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();

    if (versionUpdateError) throw new HttpError(500, versionUpdateError.message);
    if (!approvedVersion) throw new HttpError(400, 'Version deja traitee ou introuvable');

    const { error: scenarioUpdateError } = await serviceClient
      .from('form_test_scenarios')
      .update({
        status: action === 'approve' ? 'approved' : 'rejected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', scenario.id);

    if (scenarioUpdateError) throw new HttpError(500, scenarioUpdateError.message);

    const updatePayload =
      action === 'approve'
        ? {
            status: 'approved',
            approved_by: userId,
            approved_at: new Date().toISOString(),
            approval_note: note ?? null,
            rejection_note: null,
          }
        : {
            status: 'draft',
            approved_by: null,
            approved_at: null,
            approval_note: null,
            rejection_note: note,
          };

    const { data: workflow, error } = await serviceClient
      .from('form_workflows')
      .update(updatePayload)
      .eq('id', workflowId)
      .in('status', ['pending', 'needs_review'])
      .select('*')
      .maybeSingle();

    if (error) {
      throw new HttpError(500, error.message);
    }

    if (!workflow) {
      throw new HttpError(400, 'Workflow introuvable ou non soumis');
    }

    return toJson({
      success: true,
      workflow,
      scenario,
      scenario_version: approvedVersion,
      action,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return toJson({ error: error.message }, error.status);
    }

    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return toJson({ error: message }, 500);
  }
});
