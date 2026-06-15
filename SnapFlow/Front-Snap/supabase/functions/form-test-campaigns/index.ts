// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  createServiceClient,
  getAuthUserId,
  HttpError,
  toJson,
} from '../_shared/formTester.ts';

interface CampaignBody {
  action?: 'launch' | 'list' | 'get' | 'review' | 'interpret';
  workflow_id?: string;
  campaign_id?: string;
  baseline_scenario_id?: string;
  baseline_scenario_ids?: string[];
  scenario_ids?: string[];
  name?: string;
  environment?: string;
  execution_id?: string;
  verdict?: 'conform' | 'unexpected_acceptance' | 'unexpected_rejection';
  justification?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
}

function parseJsonObject(value: string): Record<string, unknown> {
  const cleaned = value.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid_ai_interpretation');
  }
  return parsed as Record<string, unknown>;
}

async function interpretExecution(summary: Record<string, unknown>) {
  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
  if (!apiKey) throw new HttpError(503, 'GEMINI_API_KEY non configuree');
  const model = Deno.env.get('FORM_TESTER_GEMINI_MODEL') || 'gemini-2.0-flash';
  const observation = summary.submission_observation ?? {};
  const prompt = `Tu assistes un operateur de test de formulaire.
Tu ne rends pas le verdict officiel et tu ne crees jamais une anomalie.
Classe uniquement les preuves expurgees fournies.
Reponds en JSON strict:
{"category":"accepted|validation_rejected|business_rejected|inconclusive","confidence":0.0,"explanation":"","evidence":[]}

Preuves:
${JSON.stringify({
    expected_behavior: summary.expected_behavior,
    observed_behavior: summary.observed_behavior,
    baseline_comparison: summary.baseline_comparison,
    submission_observation: observation,
  }).slice(0, 12000)}`;
  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw new HttpError(502, `Gemini indisponible (${response.status})`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new HttpError(502, 'Reponse Gemini invalide');
  const parsed = parseJsonObject(content);
  const allowed = ['accepted', 'validation_rejected', 'business_rejected', 'inconclusive'];
  return {
    category: allowed.includes(String(parsed.category)) ? parsed.category : 'inconclusive',
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    explanation: String(parsed.explanation ?? '').slice(0, 1000),
    evidence: Array.isArray(parsed.evidence)
      ? parsed.evidence.map((item) => String(item).slice(0, 300)).slice(0, 8)
      : [],
    provider: 'gemini',
    model,
    informational_only: true,
    generated_at: new Date().toISOString(),
  };
}

async function isAdmin(client: ReturnType<typeof createServiceClient>, userId: string) {
  const { data, error } = await client.rpc('has_role', {
    _user_id: userId,
    _role: 'admin',
  });
  if (error) throw new HttpError(500, error.message);
  return Boolean(data);
}

async function requireWorkflowAccess(
  client: ReturnType<typeof createServiceClient>,
  workflowId: string,
  userId: string,
  admin: boolean,
) {
  const { data, error } = await client
    .from('form_workflows')
    .select('id, created_by, org_id')
    .eq('id', workflowId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, 'Workflow non trouve');
  if (!admin && data.created_by !== userId && data.org_id !== userId) {
    throw new HttpError(403, 'Acces refuse');
  }
  return data;
}

async function campaignExecutions(
  client: ReturnType<typeof createServiceClient>,
  campaignId: string,
) {
  const { data, error } = await client
    .from('workflow_results')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('queued_at', { ascending: true });
  if (error) throw new HttpError(500, error.message);
  const scenarioIds = [...new Set((data ?? []).map((item) => item.scenario_id).filter(Boolean))];
  const { data: scenarios, error: scenarioError } = scenarioIds.length
    ? await client
        .from('form_test_scenarios')
        .select('id, name, description, expected_outcome, case_definition')
        .in('id', scenarioIds)
    : { data: [], error: null };
  if (scenarioError) throw new HttpError(500, scenarioError.message);
  return (data ?? []).map((execution) => ({
    ...execution,
    scenario: (scenarios ?? []).find((scenario) => scenario.id === execution.scenario_id) ?? null,
  }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const client = createServiceClient();
    const userId = await getAuthUserId(req);
    const admin = await isAdmin(client, userId);
    const body = (await req.json()) as CampaignBody;
    const action = body.action ?? 'list';

    if (action === 'launch') {
      const baselineIds = [...new Set(
        body.baseline_scenario_ids?.length
          ? body.baseline_scenario_ids
          : body.baseline_scenario_id ? [body.baseline_scenario_id] : [],
      )].filter(Boolean).slice(0, 2);
      if (!body.workflow_id || baselineIds.length === 0) {
        throw new HttpError(400, 'workflow_id et baseline_scenario_ids requis');
      }
      await requireWorkflowAccess(client, body.workflow_id, userId, admin);
      const scenarioIds = [...new Set(body.scenario_ids ?? [])].filter(Boolean);
      const { data, error } = await client.rpc('form_test_launch_campaign_v2', {
        p_workflow_id: body.workflow_id,
        p_baseline_scenario_ids: baselineIds,
        p_scenario_ids: scenarioIds,
        p_requested_by: userId,
        p_name: body.name?.trim() || null,
        p_environment: body.environment?.trim() || 'default',
      });
      if (error) throw new HttpError(409, error.message);
      return toJson({ success: true, ...data }, 202);
    }

    if (action === 'interpret') {
      if (!body.execution_id) throw new HttpError(400, 'execution_id requis');
      const { data: execution, error } = await client
        .from('workflow_results')
        .select('id, workflow_id, summary')
        .eq('id', body.execution_id)
        .maybeSingle();
      if (error) throw new HttpError(500, error.message);
      if (!execution) throw new HttpError(404, 'Execution non trouvee');
      await requireWorkflowAccess(client, execution.workflow_id, userId, admin);
      const currentSummary = execution.summary ?? {};
      if (currentSummary.ai_interpretation) {
        return toJson({ interpretation: currentSummary.ai_interpretation });
      }
      const interpretation = await interpretExecution(currentSummary);
      const { error: updateError } = await client
        .from('workflow_results')
        .update({
          summary: {
            ...currentSummary,
            ai_interpretation: interpretation,
          },
        })
        .eq('id', execution.id);
      if (updateError) throw new HttpError(500, updateError.message);
      return toJson({ interpretation });
    }

    if (action === 'list') {
      if (!body.workflow_id) throw new HttpError(400, 'workflow_id requis');
      await requireWorkflowAccess(client, body.workflow_id, userId, admin);
      const { data, error } = await client
        .from('form_test_campaigns')
        .select('*')
        .eq('workflow_id', body.workflow_id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw new HttpError(500, error.message);
      return toJson({ campaigns: data ?? [] });
    }

    if (!body.campaign_id && action !== 'review') {
      throw new HttpError(400, 'campaign_id requis');
    }

    if (action === 'get') {
      const { data: campaign, error } = await client
        .from('form_test_campaigns')
        .select('*')
        .eq('id', body.campaign_id)
        .maybeSingle();
      if (error) throw new HttpError(500, error.message);
      if (!campaign) throw new HttpError(404, 'Campagne non trouvee');
      await requireWorkflowAccess(client, campaign.workflow_id, userId, admin);
      return toJson({
        campaign,
        executions: await campaignExecutions(client, campaign.id),
      });
    }

    if (action === 'review') {
      if (!body.execution_id || !body.verdict || !body.justification?.trim()) {
        throw new HttpError(400, 'execution_id, verdict et justification requis');
      }
      const { data: execution, error } = await client
        .from('workflow_results')
        .select('id, workflow_id, campaign_id, summary')
        .eq('id', body.execution_id)
        .maybeSingle();
      if (error) throw new HttpError(500, error.message);
      if (!execution) throw new HttpError(404, 'Execution non trouvee');
      await requireWorkflowAccess(client, execution.workflow_id, userId, admin);
      const manualReview = {
        verdict: body.verdict,
        justification: body.justification.trim(),
        severity: body.severity ?? null,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      };
      const { error: updateError } = await client
        .from('workflow_results')
        .update({
          summary: {
            ...(execution.summary ?? {}),
            manual_review: manualReview,
            effective_business_verdict: body.verdict,
          },
        })
        .eq('id', execution.id);
      if (updateError) throw new HttpError(500, updateError.message);
      if (execution.campaign_id) {
        await client.rpc('form_test_refresh_campaign', {
          p_campaign_id: execution.campaign_id,
        });
      }
      return toJson({ success: true, manual_review: manualReview });
    }

    throw new HttpError(400, 'Action non supportee');
  } catch (error) {
    if (error instanceof HttpError) return toJson({ error: error.message }, error.status);
    return toJson({ error: error instanceof Error ? error.message : 'Erreur serveur' }, 500);
  }
});
