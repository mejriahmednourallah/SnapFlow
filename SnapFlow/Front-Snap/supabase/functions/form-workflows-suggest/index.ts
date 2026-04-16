// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  createServiceClient,
  getAuthUserId,
  HttpError,
  toJson,
} from '../_shared/formTester.ts';

interface SuggestBody {
  workflow_id?: string;
  field_ids?: string[];
}

interface WorkflowRow {
  id: string;
  created_by: string;
  org_id: string;
  target_url: string;
  name: string;
}

interface FieldRow {
  id: string;
  field_name: string;
  field_type: string;
  field_label: string | null;
  placeholder: string | null;
  required: boolean;
  is_sensitive: boolean;
}

interface FieldSuggestion {
  field_id: string;
  value: string;
  reasoning: string;
  is_sensitive: boolean;
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

function extractJsonPayload(raw: string): string {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return cleaned;
  }
  return cleaned.slice(firstBrace, lastBrace + 1);
}

function inferValue(field: FieldRow): FieldSuggestion {
  const name = `${field.field_name} ${field.field_label ?? ''}`.toLowerCase();
  const type = field.field_type.toLowerCase();

  if (type === 'email' || name.includes('mail')) {
    return {
      field_id: field.id,
      value: 'contact@example.com',
      reasoning: 'Format email de test',
      is_sensitive: false,
    };
  }

  if (type === 'tel' || name.includes('tel') || name.includes('phone')) {
    return {
      field_id: field.id,
      value: '+216 20 123 456',
      reasoning: 'Numéro de test tunisien',
      is_sensitive: false,
    };
  }

  if (type === 'password' || name.includes('mot de passe') || name.includes('password')) {
    return {
      field_id: field.id,
      value: 'Test@1234',
      reasoning: 'Mot de passe de test',
      is_sensitive: true,
    };
  }

  if (type === 'number') {
    return {
      field_id: field.id,
      value: '123',
      reasoning: 'Valeur numérique simple',
      is_sensitive: false,
    };
  }

  if (type === 'date') {
    return {
      field_id: field.id,
      value: '2026-04-02',
      reasoning: 'Date de test valide',
      is_sensitive: false,
    };
  }

  if (name.includes('prenom') || name.includes('first')) {
    return {
      field_id: field.id,
      value: 'Ahmed',
      reasoning: 'Prénom de test',
      is_sensitive: false,
    };
  }

  if (name.includes('nom') || name.includes('last')) {
    return {
      field_id: field.id,
      value: 'Ben Salah',
      reasoning: 'Nom de test',
      is_sensitive: false,
    };
  }

  return {
    field_id: field.id,
    value: 'Valeur de test Snapflow',
    reasoning: 'Valeur générique non sensible',
    is_sensitive: false,
  };
}

async function inferWithLLM(workflow: WorkflowRow, fields: FieldRow[]): Promise<FieldSuggestion[]> {
  const fieldsDescription = fields
    .map(
      (field) =>
        `- ID:${field.id} | Nom:${field.field_name} | Type:${field.field_type} | ` +
        `Label:${field.field_label ?? 'non défini'} | Placeholder:${field.placeholder ?? 'aucun'} | Requis:${field.required ? 'oui' : 'non'}`,
    )
    .join('\n');

  const systemPrompt = `Tu es un assistant de test de formulaires web pour une plateforme d'audit.
Génère des données de test réalistes mais fictives et non sensibles.
RÈGLES:
- Jamais de vraies données personnelles
- Emails en @example.com
- Téléphones tunisiens au format +216 XX XXX XXX
- Mot de passe de test: Test@1234
Réponds uniquement en JSON valide.`;

  const userPrompt = `Workflow: ${workflow.name}
URL: ${workflow.target_url}
Champs:
${fieldsDescription}

Génère des suggestions de test pour chaque champ. Réponds au format JSON valide:
{
  "suggestions": [
    {
      "field_id": "...",
      "value": "...",
      "reasoning": "...",
      "is_sensitive": false
    }
  ]
}`;

  // Configure AI providers: Groq (primary) -> Gemini (fallback)
  let apiUrl = '';
  let apiKey = '';
  let modelName = '';

  if (Deno.env.get('GROQ_API_KEY')) {
    apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
    apiKey = Deno.env.get('GROQ_API_KEY')!;
    modelName = 'llama-3.3-70b-versatile';
  } else if (Deno.env.get('GEMINI_API_KEY')) {
    apiUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    apiKey = Deno.env.get('GEMINI_API_KEY')!;
    modelName = 'gemini-2.0-flash';
  } else {
    throw new Error('Aucun fournisseur IA configuré (GROQ_API_KEY ou GEMINI_API_KEY manquant)');
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Erreur API: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';

    if (!raw.trim()) {
      throw new Error('Réponse IA vide');
    }

    const payload = extractJsonPayload(raw);
    const parsed = JSON.parse(payload) as { suggestions?: FieldSuggestion[] };

    if (!Array.isArray(parsed.suggestions)) {
      throw new Error('Réponse IA invalide');
    }

    const allowedIds = new Set(fields.map((field) => field.id));

    return parsed.suggestions
      .filter((item) => Boolean(item?.field_id && allowedIds.has(item.field_id) && typeof item.value === 'string'))
      .map((item) => ({
        field_id: item.field_id,
        value: item.value,
        reasoning: item.reasoning || 'Suggestion IA',
        is_sensitive: Boolean(item.is_sensitive),
      }));
  } catch (error) {
    console.error('Erreur lors de la suggestion IA:', error);
    throw error;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const serviceClient = createServiceClient();
    const userId = await getAuthUserId(req);
    const isAdmin = await getIsAdmin(serviceClient, userId);

    const body = (await req.json()) as SuggestBody;
    const workflowId = body.workflow_id;
    if (!workflowId) {
      throw new HttpError(400, 'workflow_id requis');
    }

    const { data: workflow, error: workflowError } = await serviceClient
      .from('form_workflows')
      .select('id, created_by, org_id, target_url, name')
      .eq('id', workflowId)
      .maybeSingle();

    if (workflowError) throw new HttpError(500, workflowError.message);
    if (!workflow) throw new HttpError(404, 'Workflow non trouvé');

    const workflowRow = workflow as WorkflowRow;
    if (!canAccessWorkflow(workflowRow, userId, isAdmin)) {
      throw new HttpError(403, 'Accès refusé');
    }

    let fieldQuery = serviceClient
      .from('workflow_form_fields')
      .select('id, field_name, field_type, field_label, placeholder, required, is_sensitive')
      .eq('workflow_id', workflowId)
      .eq('is_sensitive', false);

    if (Array.isArray(body.field_ids) && body.field_ids.length > 0) {
      fieldQuery = fieldQuery.in('id', body.field_ids);
    }

    const { data: fields, error: fieldsError } = await fieldQuery;
    if (fieldsError) throw new HttpError(500, fieldsError.message);

    const fieldRows = (fields ?? []) as FieldRow[];
    if (fieldRows.length === 0) {
      return toJson({ success: true, suggestions: [] });
    }

    let suggestions: FieldSuggestion[] = [];

    try {
      suggestions = await inferWithLLM(workflowRow, fieldRows);
    } catch {
      // Fallback to heuristic suggestions if LLM fails
      suggestions = fieldRows.map(inferValue);
    }

    for (const suggestion of suggestions) {
      const { error: updateError } = await serviceClient
        .from('workflow_form_fields')
        .update({ ai_suggestion: suggestion.value, is_sensitive: suggestion.is_sensitive })
        .eq('id', suggestion.field_id)
        .eq('workflow_id', workflowId);

      if (updateError) {
        throw new HttpError(500, updateError.message);
      }
    }

    return toJson({ success: true, suggestions });
  } catch (error) {
    if (error instanceof HttpError) {
      return toJson({ error: error.message }, error.status);
    }

    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return toJson({ error: message }, 500);
  }
});
