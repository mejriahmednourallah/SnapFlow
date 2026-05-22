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
  visible?: boolean;
  enabled?: boolean;
}

interface DetectionSummary {
  fields: DetectedField[];
  formsFound: number;
  sources: string[];
  confidence: 'high' | 'medium' | 'low';
  riskFlags: string[];
  blockedReason: string | null;
  method: string;
  evidence: Record<string, unknown>;
}

interface WorkflowRow {
  id: string;
  created_by: string;
  org_id: string;
  status: string;
  target_url: string;
}

const HIGH_RISK_FLAGS = new Set(['payment', 'delete', 'password_reset']);
const REVIEW_RISK_FLAGS = new Set(['captcha', 'login', 'upload', 'appointment', 'external_provider', 'account_creation', 'medical', 'legal']);

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
    throw new HttpError(500, `Erreur de verification de role: ${error.message}`);
  }

  return Boolean(isAdmin);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function targetDomains(targetUrl: string): string[] {
  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    if (!host) return [];
    const withoutWww = host.replace(/^www\./, '');
    return unique([host, withoutWww, `www.${withoutWww}`]);
  } catch {
    return [];
  }
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
        visible: row.visible === undefined ? undefined : Boolean(row.visible),
        enabled: row.enabled === undefined ? undefined : Boolean(row.enabled),
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
    const attrRegex = /([\w:-]+)(?:=['"]([^'"]*)['"])?/g;
    let match: RegExpExecArray | null;

    while ((match = attrRegex.exec(attrs)) !== null) {
      map[match[1].toLowerCase()] = match[2] ?? 'true';
    }

    return map;
  };

  const appendField = (attrs: string, defaultTag: string) => {
    const attrMap = parseAttributes(attrs);
    const fieldType = (attrMap.type ?? defaultTag).toLowerCase();
    if (['submit', 'button', 'hidden', 'image', 'reset'].includes(fieldType)) return;

    const fieldName = attrMap.name ?? attrMap.id ?? fieldType;
    const fieldId = attrMap.id;

    const selector = fieldId
      ? `#${fieldId}`
      : attrMap.name
        ? `${defaultTag}[name="${attrMap.name}"]`
        : `${defaultTag}[type="${fieldType}"]`;

    fields.push({
      name: fieldName,
      type: fieldType,
      label: null,
      selector,
      placeholder: attrMap.placeholder ?? null,
      required: attrs.toLowerCase().includes('required'),
    });
  };

  let inputMatch: RegExpExecArray | null;
  while ((inputMatch = inputRegex.exec(html)) !== null) appendField(inputMatch[1], 'input');

  let textareaMatch: RegExpExecArray | null;
  while ((textareaMatch = textareaRegex.exec(html)) !== null) appendField(textareaMatch[1], 'textarea');

  let selectMatch: RegExpExecArray | null;
  while ((selectMatch = selectRegex.exec(html)) !== null) appendField(selectMatch[1], 'select');

  return fields;
}

function isWeakStaticHtml(html: string, fields: DetectedField[]): boolean {
  const lower = html.toLowerCase();
  const bodyText = lower.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
  const shellSignals = ['id="root"', "id='root'", 'id="app"', "id='app'", '__next_data__', 'type="module"', "type='module'"];
  return fields.length === 0 || bodyText.trim().length < 180 || shellSignals.some((signal) => lower.includes(signal));
}

function flagsFromFields(fields: DetectedField[]): string[] {
  const flags: string[] = [];
  for (const field of fields) {
    const blob = `${field.type} ${field.name} ${field.label ?? ''} ${field.placeholder ?? ''}`.toLowerCase();
    if (field.type === 'password' || /login|connexion|signin|compte/.test(blob)) flags.push('login');
    if (field.type === 'file' || /upload|fichier|piece|document/.test(blob)) flags.push('upload');
    if (/card|payment|paiement|stripe|checkout/.test(blob)) flags.push('payment');
  }
  return unique(flags);
}

async function runStaticDetection(targetUrl: string): Promise<{ fields: DetectedField[]; html: string; error: string | null }> {
  try {
    const pageResponse = await fetch(targetUrl, { signal: AbortSignal.timeout(12000) });
    const html = await pageResponse.text();
    return { fields: parseFormsFromHtml(html), html, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'static_fetch_failed';
    return { fields: [], html: '', error: message };
  }
}

async function callDiscovery(baseUrl: string, targetUrl: string, forceChromium = false): Promise<Record<string, unknown> | null> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const payload = {
    url: targetUrl,
    allowed_domains: targetDomains(targetUrl),
    max_links: 40,
    extract_forms: true,
    wait_ms: 22000,
    force_chromium: forceChromium,
  };
  for (const path of ['/discover-rendered', '/api/discover-rendered']) {
    try {
      const response = await fetch(`${cleanBase}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) continue;
      return (await response.json()) as Record<string, unknown>;
    } catch {
      // try next path/fallback
    }
  }
  return null;
}

async function runRenderedDetection(targetUrl: string, shouldConfirm: boolean): Promise<Record<string, unknown> | null> {
  const discoveryBase =
    Deno.env.get('DISCOVERY_API_URL') ??
    Deno.env.get('AUDIT_API_URL') ??
    Deno.env.get('SCANNER_BASE_URL') ??
    Deno.env.get('SCANNER_INTERNAL_URL') ??
    '';
  if (!discoveryBase.trim()) return null;

  const discovery = await callDiscovery(discoveryBase, targetUrl, false);
  if (!discovery) return null;

  const engine = typeof discovery.engine === 'string' ? discovery.engine : '';
  if (shouldConfirm && engine !== 'chromium') {
    const confirmed = await callDiscovery(discoveryBase, targetUrl, true);
    if (confirmed) {
      return {
        ...discovery,
        chromium_confirmation: confirmed,
      };
    }
  }
  return discovery;
}

function fieldsFromDiscovery(payload: Record<string, unknown> | null): DetectedField[] {
  if (!payload) return [];
  const forms = Array.isArray(payload.forms) ? payload.forms : [];
  const fields: DetectedField[] = [];
  for (const form of forms) {
    if (!form || typeof form !== 'object') continue;
    const formFields = normalizeDetectedFields((form as Record<string, unknown>).fields);
    fields.push(...formFields);
  }
  return fields;
}

function summarizeDetection(targetUrl: string, staticFields: DetectedField[], staticHtml: string, rendered: Record<string, unknown> | null): DetectionSummary {
  const confirmation = rendered && typeof rendered.chromium_confirmation === 'object'
    ? (rendered.chromium_confirmation as Record<string, unknown>)
    : null;
  const renderedFields = fieldsFromDiscovery(rendered);
  const confirmedFields = fieldsFromDiscovery(confirmation);
  const fields = confirmedFields.length > 0 ? confirmedFields : renderedFields.length > 0 ? renderedFields : staticFields;
  const sources = ['static'];
  if (rendered) {
    const discoverySources = Array.isArray(rendered.detection_sources) ? rendered.detection_sources.map(String) : [];
    sources.push(...discoverySources);
  }
  if (confirmation) sources.push('chromium_confirmed');

  const renderedFlags = Array.isArray(rendered?.risk_flags) ? rendered.risk_flags.map(String) : [];
  const confirmationFlags = Array.isArray(confirmation?.risk_flags) ? confirmation.risk_flags.map(String) : [];
  const riskFlags = unique([...flagsFromFields(fields), ...renderedFlags, ...confirmationFlags]);
  const blockedReason = riskFlags.find((flag) => HIGH_RISK_FLAGS.has(flag))
    ? `blocked:${riskFlags.filter((flag) => HIGH_RISK_FLAGS.has(flag)).join(',')}`
    : riskFlags.some((flag) => REVIEW_RISK_FLAGS.has(flag))
      ? `needs_review:${riskFlags.filter((flag) => REVIEW_RISK_FLAGS.has(flag)).join(',')}`
      : null;

  const formsFound = Math.max(
    fields.length > 0 ? 1 : 0,
    Array.isArray(rendered?.forms) ? rendered.forms.length : 0,
    Array.isArray(confirmation?.forms) ? confirmation.forms.length : 0,
  );
  const confidence: DetectionSummary['confidence'] =
    fields.length > 0 && sources.includes('chromium_confirmed')
      ? 'high'
      : fields.length > 0 && rendered
        ? 'medium'
        : fields.length > 0 && !isWeakStaticHtml(staticHtml, staticFields)
          ? 'medium'
          : 'low';

  const candidateMessages = unique([
    ...(Array.isArray(rendered?.candidate_messages) ? rendered.candidate_messages.map(String) : []),
    ...(Array.isArray(confirmation?.candidate_messages) ? confirmation.candidate_messages.map(String) : []),
  ]).slice(0, 10);

  return {
    fields,
    formsFound,
    sources: unique(sources),
    confidence,
    riskFlags,
    blockedReason,
    method: sources.includes('obscura_rendered') ? 'obscura_rendered' : sources.includes('chromium_rendered') ? 'chromium_rendered' : 'static_html',
    evidence: {
      target_url: targetUrl,
      rendered_engine: rendered?.engine ?? null,
      final_url: confirmation?.final_url ?? rendered?.final_url ?? targetUrl,
      internal_links: Array.isArray(rendered?.internal_links) ? rendered.internal_links.slice(0, 20) : [],
      buttons: Array.isArray(rendered?.buttons) ? rendered.buttons.slice(0, 20) : [],
      candidate_messages: candidateMessages,
      branch_suggestions: [
        'success_message_visible',
        'validation_error_visible',
        'url_changed',
        'request_failed',
        'captcha_detected',
        'form_disappeared_after_submit',
        'modal_opened',
      ],
      chromium_confirmed: Boolean(confirmation),
    },
  };
}

function workflowStatusFor(summary: DetectionSummary): 'draft' | 'needs_review' | 'blocked' {
  if (summary.blockedReason?.startsWith('blocked:')) return 'blocked';
  if (summary.blockedReason?.startsWith('needs_review:')) return 'needs_review';
  return 'draft';
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
    if (!workflow) throw new HttpError(404, 'Workflow non trouve');

    const workflowRow = workflow as WorkflowRow;
    if (!canAccessWorkflow(workflowRow, userId, isAdmin)) {
      throw new HttpError(403, 'Acces refuse');
    }

    if (!['draft', 'needs_review', 'blocked'].includes(workflowRow.status) && !isAdmin) {
      throw new HttpError(400, 'Seuls les workflows en brouillon ou a valider peuvent etre detectes');
    }

    const staticDetection = await runStaticDetection(workflowRow.target_url);
    const weakStatic = isWeakStaticHtml(staticDetection.html, staticDetection.fields);
    const rendered = weakStatic ? await runRenderedDetection(workflowRow.target_url, true) : null;
    const summary = summarizeDetection(workflowRow.target_url, staticDetection.fields, staticDetection.html, rendered);

    if (summary.fields.length === 0) {
      await serviceClient
        .from('form_workflows')
        .update({
          detected_at: new Date().toISOString(),
          detection_sources: summary.sources,
          confidence: 'low',
          risk_flags: summary.riskFlags,
          blocked_reason: 'no_form_fields_detected',
          detection_evidence: summary.evidence,
          status: 'needs_review',
        })
        .eq('id', workflowId);
      return toJson({ success: false, error: 'Aucun champ de formulaire detecte sur cette URL', ...summary }, 422);
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
        config: { url: workflowRow.target_url, label: 'Ouvrir la page' },
      },
      ...summary.fields.map((field, index) => ({
        workflow_id: workflowId,
        type: 'form_fill',
        order_index: index + 1,
        position_x: 360,
        position_y: 140 + index * 100,
        config: { label: 'Remplir les champs' },
      })),
      {
        workflow_id: workflowId,
        type: 'submit',
        order_index: summary.fields.length + 1,
        position_x: 360,
        position_y: 180 + summary.fields.length * 100,
        config: { selector: 'button[type="submit"], input[type="submit"], button:not([type])', wait_for: '', label: 'Soumettre' },
      },
      {
        workflow_id: workflowId,
        type: 'assert',
        order_index: summary.fields.length + 2,
        position_x: 360,
        position_y: 280 + summary.fields.length * 100,
        config: { type: 'text_present', value: '', label: 'Verifier message de succes' },
      },
    ];

    const { data: insertedNodes, error: nodesError } = await serviceClient
      .from('workflow_nodes')
      .insert(nodesToInsert)
      .select('*');

    if (nodesError) {
      throw new HttpError(500, `Erreur insertion noeuds: ${nodesError.message}`);
    }

    const formFillNodes = (insertedNodes ?? [])
      .filter((node) => node.type === 'form_fill')
      .sort((a, b) => a.order_index - b.order_index);

    const fieldsToInsert = summary.fields.map((field, index) => ({
      node_id: formFillNodes[index].id,
      workflow_id: workflowId,
      field_name: field.name,
      field_type: field.type,
      field_label: field.label,
      field_selector: field.selector,
      placeholder: field.placeholder,
      required: field.required,
      is_sensitive: ['password', 'tel', 'email'].includes(field.type),
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
        .update({ config: { field_id: field.id, label: 'Remplir les champs' } })
        .eq('id', formFillNodes[index].id);

      if (updateNodeError) {
        throw new HttpError(500, `Erreur liaison noeud/champ: ${updateNodeError.message}`);
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
      if (edgesError) throw new HttpError(500, `Erreur insertion aretes: ${edgesError.message}`);
    }

    const nextStatus = workflowStatusFor(summary);
    const { error: updateWorkflowError } = await serviceClient
      .from('form_workflows')
      .update({
        detected_at: new Date().toISOString(),
        detection_sources: summary.sources,
        confidence: summary.confidence,
        risk_flags: summary.riskFlags,
        blocked_reason: summary.blockedReason,
        detection_evidence: summary.evidence,
        status: nextStatus,
      })
      .eq('id', workflowId);

    if (updateWorkflowError) {
      throw new HttpError(500, `Erreur mise a jour workflow: ${updateWorkflowError.message}`);
    }

    if (nextStatus !== 'draft') {
      await serviceClient.from('notifications').insert({
        user_id: workflowRow.created_by,
        title: nextStatus === 'blocked' ? 'Workflow bloque' : 'Workflow a valider',
        message:
          nextStatus === 'blocked'
            ? `Le workflow de formulaire contient un risque bloque: ${summary.blockedReason ?? 'controle requis'}.`
            : `Le workflow de formulaire doit etre valide avant execution: ${summary.blockedReason ?? 'controle requis'}.`,
        type: nextStatus === 'blocked' ? 'error' : 'warning',
        category: 'system',
        reference_id: workflowId,
        reference_type: 'form_workflow',
      });
    }

    return toJson({
      success: true,
      detection_method: summary.method,
      detection_sources: summary.sources,
      confidence: summary.confidence,
      risk_flags: summary.riskFlags,
      blocked_reason: summary.blockedReason,
      forms_found: summary.formsFound,
      fields_count: summary.fields.length,
      nodes: insertedNodes ?? [],
      fields: insertedFields ?? [],
      workflow_status: nextStatus,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return toJson({ error: error.message }, error.status);
    }

    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return toJson({ error: message }, 500);
  }
});
