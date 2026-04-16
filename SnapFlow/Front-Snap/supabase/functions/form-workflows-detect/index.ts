// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  createServiceClient,
  getAuthUserId,
  HttpError,
  toJson,
} from '../_shared/formTester.ts';

interface DetectBody {
  workflow_id?: string;
}

interface DetectedField {
  name: string;
  type: string;
  label: string | null;
  selector: string;
  placeholder: string | null;
  required: boolean;
}

interface WorkflowRow {
  id: string;
  created_by: string;
  org_id: string;
  status: string;
  target_url: string;
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

function normalizeDetectedFields(rawFields: unknown): DetectedField[] {
  if (!Array.isArray(rawFields)) return [];

  return rawFields
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;

      const type = typeof row.type === 'string' && row.type.trim() ? row.type.trim().toLowerCase() : 'text';
      const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : type;
      const selector =
        typeof row.selector === 'string' && row.selector.trim()
          ? row.selector.trim()
          : typeof row.id === 'string' && row.id.trim()
            ? `#${row.id.trim()}`
            : `input[name="${name}"]`;

      return {
        name,
        type,
        label: typeof row.label === 'string' && row.label.trim() ? row.label.trim() : null,
        selector,
        placeholder: typeof row.placeholder === 'string' && row.placeholder.trim() ? row.placeholder.trim() : null,
        required: Boolean(row.required),
      } as DetectedField;
    })
    .filter((field): field is DetectedField => Boolean(field));
}

function parseFormsFromHtml(html: string): DetectedField[] {
  const fields: DetectedField[] = [];

  const inputRegex = /<input([^>]*?)>/gi;
  const textareaRegex = /<textarea([^>]*?)>/gi;
  const selectRegex = /<select([^>]*?)>/gi;

  const parseAttributes = (attrs: string): Record<string, string> => {
    const map: Record<string, string> = {};
    const attrRegex = /(\w+)=['"]([^'"]*)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = attrRegex.exec(attrs)) !== null) {
      map[match[1].toLowerCase()] = match[2];
    }

    return map;
  };

  const appendField = (attrs: string, defaultType: string) => {
    const attrMap = parseAttributes(attrs);
    const fieldType = (attrMap.type ?? defaultType).toLowerCase();
    if (['submit', 'button', 'hidden', 'image', 'reset'].includes(fieldType)) return;

    const fieldName = attrMap.name ?? attrMap.id ?? fieldType;
    const fieldId = attrMap.id;

    const selector = fieldId
      ? `#${fieldId}`
      : attrMap.name
        ? `${defaultType}[name="${attrMap.name}"]`
        : `${defaultType}[type="${fieldType}"]`;

    fields.push({
      name: fieldName,
      type: fieldType,
      label: null,
      selector,
      placeholder: attrMap.placeholder ?? null,
      required: /required/i.test(attrs),
    });
  };

  let inputMatch: RegExpExecArray | null;
  while ((inputMatch = inputRegex.exec(html)) !== null) {
    appendField(inputMatch[1], 'input');
  }

  let textareaMatch: RegExpExecArray | null;
  while ((textareaMatch = textareaRegex.exec(html)) !== null) {
    appendField(textareaMatch[1], 'textarea');
  }

  let selectMatch: RegExpExecArray | null;
  while ((selectMatch = selectRegex.exec(html)) !== null) {
    appendField(selectMatch[1], 'select');
  }

  return fields;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const serviceClient = createServiceClient();
    const userId = await getAuthUserId(req);
    const isAdmin = await getIsAdmin(serviceClient, userId);

    const body = (await req.json()) as DetectBody;
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

    const workflowRow = workflow as WorkflowRow;
    if (!canAccessWorkflow(workflowRow, userId, isAdmin)) {
      throw new HttpError(403, 'Accès refusé');
    }

    if (workflowRow.status !== 'draft' && !isAdmin) {
      throw new HttpError(400, 'Seuls les workflows en brouillon peuvent être détectés');
    }

    const scannerUrl = Deno.env.get('SCANNER_INTERNAL_URL') ?? 'http://scanner-service:8080';

    let detectionMethod = 'html_fallback';
    let detectedFields: DetectedField[] = [];

    try {
      const scannerResponse = await fetch(`${scannerUrl}/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: workflowRow.target_url, use_puppeteer: true }),
        signal: AbortSignal.timeout(15000),
      });

      if (!scannerResponse.ok) {
        throw new Error(`Scanner HTTP ${scannerResponse.status}`);
      }

      const scannerPayload = await scannerResponse.json();
      detectedFields = normalizeDetectedFields((scannerPayload as Record<string, unknown>).fields);
      detectionMethod =
        typeof (scannerPayload as Record<string, unknown>).method === 'string'
          ? String((scannerPayload as Record<string, unknown>).method)
          : 'puppeteer';
    } catch {
      const pageResponse = await fetch(workflowRow.target_url, { signal: AbortSignal.timeout(12000) });
      const html = await pageResponse.text();
      detectedFields = parseFormsFromHtml(html);
      detectionMethod = 'html_fallback';
    }

    if (detectedFields.length === 0) {
      return toJson({ success: false, error: 'Aucun formulaire détecté sur cette URL' }, 422);
    }

    await serviceClient.from('workflow_edges').delete().eq('workflow_id', workflowId);
    await serviceClient.from('workflow_nodes').delete().eq('workflow_id', workflowId);

    const nodesToInsert = [
      {
        workflow_id: workflowId,
        type: 'trigger',
        order_index: 0,
        position_x: 360,
        position_y: 40,
        config: { url: workflowRow.target_url },
      },
      ...detectedFields.map((field, index) => ({
        workflow_id: workflowId,
        type: 'form_fill',
        order_index: index + 1,
        position_x: 360,
        position_y: 140 + index * 100,
        config: {},
      })),
      {
        workflow_id: workflowId,
        type: 'submit',
        order_index: detectedFields.length + 1,
        position_x: 360,
        position_y: 180 + detectedFields.length * 100,
        config: { selector: 'button[type="submit"], input[type="submit"]', wait_for: '' },
      },
      {
        workflow_id: workflowId,
        type: 'assert',
        order_index: detectedFields.length + 2,
        position_x: 360,
        position_y: 280 + detectedFields.length * 100,
        config: { type: 'text_present', value: '', label: 'Message de succès visible' },
      },
    ];

    const { data: insertedNodes, error: nodesError } = await serviceClient
      .from('workflow_nodes')
      .insert(nodesToInsert)
      .select('*');

    if (nodesError) {
      throw new HttpError(500, `Erreur insertion nœuds: ${nodesError.message}`);
    }

    const formFillNodes = (insertedNodes ?? [])
      .filter((node) => node.type === 'form_fill')
      .sort((a, b) => a.order_index - b.order_index);

    const fieldsToInsert = detectedFields.map((field, index) => ({
      node_id: formFillNodes[index].id,
      workflow_id: workflowId,
      field_name: field.name,
      field_type: field.type,
      field_label: field.label,
      field_selector: field.selector,
      placeholder: field.placeholder,
      required: field.required,
      is_sensitive: ['password', 'tel'].includes(field.type),
    }));

    const { data: insertedFields, error: fieldsError } = await serviceClient
      .from('workflow_form_fields')
      .insert(fieldsToInsert)
      .select('*');

    if (fieldsError) {
      throw new HttpError(500, `Erreur insertion champs: ${fieldsError.message}`);
    }

    for (let index = 0; index < formFillNodes.length; index += 1) {
      const field = insertedFields?.[index];
      if (!field) continue;

      const { error: updateNodeError } = await serviceClient
        .from('workflow_nodes')
        .update({ config: { field_id: field.id } })
        .eq('id', formFillNodes[index].id);

      if (updateNodeError) {
        throw new HttpError(500, `Erreur liaison nœud/champ: ${updateNodeError.message}`);
      }
    }

    const allNodes = (insertedNodes ?? []).sort((a, b) => a.order_index - b.order_index);
    const edgesToInsert = allNodes.slice(0, -1).map((node, index) => ({
      workflow_id: workflowId,
      source_node_id: node.id,
      target_node_id: allNodes[index + 1].id,
    }));

    if (edgesToInsert.length > 0) {
      const { error: edgesError } = await serviceClient.from('workflow_edges').insert(edgesToInsert);
      if (edgesError) throw new HttpError(500, `Erreur insertion arêtes: ${edgesError.message}`);
    }

    const { error: updateWorkflowError } = await serviceClient
      .from('form_workflows')
      .update({ detected_at: new Date().toISOString() })
      .eq('id', workflowId);

    if (updateWorkflowError) {
      throw new HttpError(500, `Erreur mise à jour workflow: ${updateWorkflowError.message}`);
    }

    return toJson({
      success: true,
      detection_method: detectionMethod,
      forms_found: 1,
      fields_count: detectedFields.length,
      nodes: insertedNodes ?? [],
      fields: insertedFields ?? [],
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return toJson({ error: error.message }, error.status);
    }

    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return toJson({ error: message }, 500);
  }
});
