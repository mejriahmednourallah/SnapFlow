// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  createServiceClient,
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

interface FormWorkflowsBody {
  action?: 'list' | 'get' | 'create' | 'update' | 'submit' | 'results';
  workflow_id?: string;
  name?: string;
  target_url?: string;
  status?: string;
  operator_view?: boolean;
  include_results?: boolean;
  field_updates?: FieldUpdate[];
}

interface WorkflowRow {
  id: string;
  org_id: string;
  created_by: string;
  status: string;
  updated_at: string;
}

function canAccessWorkflow(workflow: WorkflowRow, userId: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return workflow.created_by === userId || workflow.org_id === userId;
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

      const operatorView = Boolean(body.operator_view && isAdmin);
      let query = serviceClient.from('form_workflows').select('*').order('updated_at', { ascending: false });

      if (operatorView) {
        if (status) {
          query = query.eq('status', status);
        } else {
          query = query.eq('status', 'pending');
        }
      } else {
        query = query.or(`created_by.eq.${userId},org_id.eq.${userId}`);
        if (status) query = query.eq('status', status);
      }

      const { data: workflows, error } = await query;
      if (error) {
        throw new HttpError(500, error.message);
      }

      const workflowList = workflows ?? [];
      const workflowIds = workflowList.map((item) => item.id);

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

      if (!canAccessWorkflow(workflow as WorkflowRow, userId, isAdmin)) {
        throw new HttpError(403, 'Accès refusé');
      }

      const [{ data: nodes, error: nodesError }, { data: fields, error: fieldsError }, { data: edges, error: edgesError }, { data: latestResult, error: latestResultError }] =
        await Promise.all([
          serviceClient.from('workflow_nodes').select('*').eq('workflow_id', workflowId).order('order_index', { ascending: true }),
          serviceClient.from('workflow_form_fields').select('*').eq('workflow_id', workflowId),
          serviceClient.from('workflow_edges').select('*').eq('workflow_id', workflowId),
          serviceClient
            .from('workflow_results')
            .select('*')
            .eq('workflow_id', workflowId)
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
          .eq('workflow_id', workflowId)
          .order('executed_at', { ascending: false });
        if (allResultsError) throw new HttpError(500, allResultsError.message);
        results = (allResults ?? []) as Record<string, unknown>[];
      }

      return toJson({
        workflow,
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

      const { data: workflow, error } = await serviceClient
        .from('form_workflows')
        .insert({
          org_id: userId,
          created_by: userId,
          name,
          target_url: normalizeTargetUrl(targetUrl),
          status: 'draft',
        })
        .select('*')
        .single();

      if (error) throw new HttpError(500, error.message);
      return toJson({ workflow }, 201);
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
      if (workflow.status !== 'draft' && !isAdmin) {
        throw new HttpError(400, 'Seuls les workflows en brouillon peuvent être modifiés');
      }

      const updates: Record<string, unknown> = {};
      if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();
      if (typeof body.target_url === 'string' && body.target_url.trim()) {
        updates.target_url = normalizeTargetUrl(body.target_url);
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

      return toJson({ success: true });
    }

    if (action === 'submit') {
      const workflowId = body.workflow_id;
      if (!workflowId) {
        throw new HttpError(400, 'workflow_id requis');
      }

      const { data: workflow, error } = await serviceClient
        .from('form_workflows')
        .update({ status: 'pending' })
        .eq('id', workflowId)
        .eq('created_by', userId)
        .eq('status', 'draft')
        .select('*')
        .maybeSingle();

      if (error) throw new HttpError(500, error.message);
      if (!workflow) throw new HttpError(400, 'Impossible de soumettre ce workflow');

      return toJson({ workflow });
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
      if (!canAccessWorkflow(workflow as WorkflowRow, userId, isAdmin)) {
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
