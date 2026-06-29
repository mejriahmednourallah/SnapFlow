// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  createServiceClient,
  getAuthUserId,
  getScenarioForWorkflow,
  HttpError,
  readJsonBody,
  toJson,
} from '../_shared/formTester.ts';

type AiProvider = 'gemini' | 'openai_compatible';
type BranchKey = 'default' | 'success' | 'failure' | 'true' | 'false';

const NODE_TYPES = new Set([
  'navigate',
  'form_fill',
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
const BRANCH_KEYS = new Set(['default', 'success', 'failure', 'true', 'false']);

interface Body {
  workflow_id?: string;
  scenario_id?: string;
  instruction?: string;
}

function aiConfig() {
  const requested = Deno.env.get('FORM_TESTER_AI_PROVIDER')?.trim() as AiProvider | undefined;
  const provider: AiProvider = requested === 'openai_compatible' ? 'openai_compatible' : 'gemini';
  if (provider === 'openai_compatible') {
    return {
      provider,
      apiKey: Deno.env.get('FORM_TESTER_AI_API_KEY') ?? '',
      baseUrl: Deno.env.get('FORM_TESTER_AI_BASE_URL') || 'https://api.deepseek.com/v1/chat/completions',
      model: Deno.env.get('FORM_TESTER_AI_MODEL') || 'flash-v4',
    };
  }
  return {
    provider,
    apiKey: Deno.env.get('GEMINI_API_KEY') ?? '',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: Deno.env.get('FORM_TESTER_GEMINI_MODEL') || 'gemini-2.0-flash',
  };
}

async function isAdmin(serviceClient, userId: string): Promise<boolean> {
  const { data } = await serviceClient.rpc('has_role', { _user_id: userId, _role: 'admin' });
  return Boolean(data);
}

async function canAccessWorkflow(serviceClient, workflow, userId: string, admin: boolean): Promise<boolean> {
  if (admin || workflow.created_by === userId || workflow.org_id === userId) return true;
  if (!workflow.project_id) return false;
  const { data, error } = await serviceClient
    .from('project_assignments')
    .select('project_id')
    .eq('project_id', workflow.project_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

function extractJsonPayload(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const source = fenced || trimmed;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) throw new HttpError(422, 'La reponse IA ne contient pas de JSON');
  return JSON.parse(source.slice(start, end + 1));
}

function normalizePatch(raw: Record<string, unknown>, context: {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}) {
  const operations = Array.isArray(raw.operations) ? raw.operations : [];
  if (operations.length > 25) throw new HttpError(422, 'Patch trop volumineux');

  const tempIds = new Set<string>();
  const normalized = operations.map((item, index) => {
    if (!item || typeof item !== 'object') throw new HttpError(422, `Operation ${index + 1} invalide`);
    const op = String(item.op ?? '');

    if (op === 'add_node') {
      const type = String(item.type ?? '');
      if (!NODE_TYPES.has(type)) throw new HttpError(422, `Type de noeud invalide: ${type}`);
      const tempId = typeof item.temp_id === 'string' && item.temp_id.trim() ? item.temp_id.trim() : `temp_${index + 1}`;
      tempIds.add(tempId);
      return {
        op,
        temp_id: tempId,
        type,
        config: item.config && typeof item.config === 'object' ? item.config : {},
        position_x: Number.isFinite(Number(item.position_x)) ? Number(item.position_x) : undefined,
        position_y: Number.isFinite(Number(item.position_y)) ? Number(item.position_y) : undefined,
        label: typeof item.label === 'string' ? item.label.slice(0, 120) : undefined,
      };
    }

    if (op === 'update_node') {
      const nodeId = String(item.node_id ?? '');
      if (!context.nodeIds.has(nodeId) && !tempIds.has(nodeId)) {
        throw new HttpError(422, `Noeud inconnu: ${nodeId}`);
      }
      return {
        op,
        node_id: nodeId,
        config: item.config && typeof item.config === 'object' ? item.config : undefined,
        position_x: Number.isFinite(Number(item.position_x)) ? Number(item.position_x) : undefined,
        position_y: Number.isFinite(Number(item.position_y)) ? Number(item.position_y) : undefined,
        label: typeof item.label === 'string' ? item.label.slice(0, 120) : undefined,
      };
    }

    if (op === 'delete_node') {
      const nodeId = String(item.node_id ?? '');
      if (!context.nodeIds.has(nodeId)) throw new HttpError(422, `Noeud inconnu: ${nodeId}`);
      return { op, node_id: nodeId };
    }

    if (op === 'upsert_edge') {
      const source = String(item.source_node_id ?? '');
      const target = String(item.target_node_id ?? '');
      const branch = String(item.branch_key ?? 'default') as BranchKey;
      if (!BRANCH_KEYS.has(branch)) throw new HttpError(422, `Branche invalide: ${branch}`);
      if ((!context.nodeIds.has(source) && !tempIds.has(source)) || (!context.nodeIds.has(target) && !tempIds.has(target))) {
        throw new HttpError(422, 'Connexion vers un noeud inconnu');
      }
      if (source === target) throw new HttpError(422, 'Une connexion ne peut pas pointer vers le meme noeud');
      return { op, source_node_id: source, target_node_id: target, branch_key: branch };
    }

    if (op === 'delete_edge') {
      const edgeId = String(item.edge_id ?? '');
      if (!context.edgeIds.has(edgeId)) throw new HttpError(422, `Connexion inconnue: ${edgeId}`);
      return { op, edge_id: edgeId };
    }

    if (op === 'update_scenario') {
      const status = typeof item.status === 'string' && ['draft', 'pending', 'approved', 'rejected'].includes(item.status)
        ? item.status
        : undefined;
      return {
        op,
        name: typeof item.name === 'string' ? item.name.slice(0, 160) : undefined,
        description: typeof item.description === 'string' ? item.description.slice(0, 500) : undefined,
        status,
      };
    }

    throw new HttpError(422, `Operation non supportee: ${op}`);
  });

  return {
    summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 500) : 'Modification proposee',
    operations: normalized,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String).slice(0, 5) : [],
  };
}

function heuristicPatch(instruction: string, model: string, provider: AiProvider) {
  return {
    summary: 'Aucun fournisseur IA configure: aucune mutation automatique proposee.',
    operations: [],
    warnings: [`Configurez une cle IA pour transformer la demande en patch: ${instruction.slice(0, 120)}`],
    provider,
    model,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const userId = await getAuthUserId(req);
    const body = await readJsonBody<Body>(req);
    if (!body.workflow_id || !body.scenario_id || !body.instruction?.trim()) {
      throw new HttpError(400, 'workflow_id, scenario_id et instruction sont requis');
    }

    const serviceClient = createServiceClient();
    const admin = await isAdmin(serviceClient, userId);
    const { data: workflow, error: workflowError } = await serviceClient
      .from('form_workflows')
      .select('*')
      .eq('id', body.workflow_id)
      .maybeSingle();
    if (workflowError) throw new HttpError(500, workflowError.message);
    if (!workflow) throw new HttpError(404, 'Workflow introuvable');
    if (!(await canAccessWorkflow(serviceClient, workflow, userId, admin))) {
      throw new HttpError(403, 'Acces refuse');
    }

    const scenario = await getScenarioForWorkflow(serviceClient, workflow, body.scenario_id);
    const { data: nodes, error: nodesError } = await serviceClient
      .from('workflow_nodes')
      .select('id,type,order_index,position_x,position_y,config')
      .eq('workflow_id', workflow.id)
      .eq('scenario_id', scenario.id)
      .order('order_index');
    if (nodesError) throw new HttpError(500, nodesError.message);
    const { data: edges, error: edgesError } = await serviceClient
      .from('workflow_edges')
      .select('id,source_node_id,target_node_id,branch_key')
      .eq('workflow_id', workflow.id)
      .eq('scenario_id', scenario.id);
    if (edgesError) throw new HttpError(500, edgesError.message);

    const config = aiConfig();
    if (!config.apiKey) return toJson({ patch: heuristicPatch(body.instruction, config.model, config.provider) });

    const prompt = [
      'You edit a form-testing workflow. Return ONLY JSON.',
      'Allowed operations: add_node, update_node, delete_node, upsert_edge, delete_edge, update_scenario.',
      'Allowed node types: navigate, form_fill, fill, select, check, upload, click, submit, wait, condition, assert, screenshot, inspect_response.',
      'Allowed branch_key: default, success, failure, true, false.',
      'Use temp_id for newly added nodes if another operation references them.',
      JSON.stringify({
        instruction: body.instruction,
        workflow: { id: workflow.id, name: workflow.name, target_url: workflow.target_url, status: workflow.status },
        scenario: { id: scenario.id, name: scenario.name, status: scenario.status },
        nodes,
        edges,
      }),
    ].join('\n');

    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Return a workflow edit patch JSON object with summary, operations, and optional warnings.' },
          { role: 'user', content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new HttpError(502, `Fournisseur IA HTTP ${response.status}`);

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content ?? '';
    const rawPatch = extractJsonPayload(content);
    const patch = normalizePatch(rawPatch, {
      nodeIds: new Set((nodes ?? []).map((node) => node.id)),
      edgeIds: new Set((edges ?? []).map((edge) => edge.id)),
    });

    return toJson({ patch: { ...patch, provider: config.provider, model: config.model } });
  } catch (error) {
    if (error instanceof HttpError) return toJson({ error: error.message }, error.status);
    return toJson({ error: error instanceof Error ? error.message : 'Edition IA impossible' }, 500);
  }
});
