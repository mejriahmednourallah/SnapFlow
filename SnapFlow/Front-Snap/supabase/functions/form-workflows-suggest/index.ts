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
import {
  buildHeuristicSuite,
  defaultSignals,
  dynamicCaseBudget,
  normalizeFormProfile,
  type FormProfile,
  type GeneratedCase,
  type SuiteField,
} from '../_shared/formTestSuite.ts';

interface SuggestBody {
  workflow_id?: string;
  field_ids?: string[];
  scenario_id?: string;
  mode?: 'field_values' | 'test_cases' | 'test_suite_plan';
  max_cases?: number;
  form_type?: string;
}

interface WorkflowRow {
  id: string;
  created_by: string;
  org_id: string;
  target_url: string;
  name: string;
  detection_evidence?: Record<string, unknown>;
  risk_flags?: string[];
}

interface FieldRow {
  id: string;
  scenario_id?: string;
  field_name: string;
  field_type: string;
  field_label: string | null;
  placeholder: string | null;
  required: boolean;
  is_sensitive: boolean;
  user_value?: string | null;
  ai_suggestion?: string | null;
  field_selector?: string | null;
}

function getAiClientConfig() {
  const provider = Deno.env.get('FORM_TESTER_AI_PROVIDER') === 'openai_compatible'
    ? 'openai_compatible'
    : 'gemini';
  if (provider === 'openai_compatible') {
    return {
      provider,
      apiUrl: Deno.env.get('FORM_TESTER_AI_BASE_URL') || 'https://api.deepseek.com/v1/chat/completions',
      apiKey: Deno.env.get('FORM_TESTER_AI_API_KEY') ?? '',
      modelName: Deno.env.get('FORM_TESTER_AI_MODEL') || 'flash-v4',
      missingMessage: 'FORM_TESTER_AI_API_KEY non configuree',
    };
  }
  return {
    provider,
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    apiKey: Deno.env.get('GEMINI_API_KEY') ?? '',
    modelName: Deno.env.get('FORM_TESTER_GEMINI_MODEL') || 'gemini-2.0-flash',
    missingMessage: 'GEMINI_API_KEY non configuree',
  };
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

  if (type === 'checkbox') {
    return {
      field_id: field.id,
      value: 'true',
      reasoning: 'Case cochee pour valider le parcours de test',
      is_sensitive: false,
    };
  }

  if (type === 'file') {
    return {
      field_id: field.id,
      value: 'sample.txt',
      reasoning: 'Fixture upload valide embarquee dans l executor',
      is_sensitive: false,
    };
  }

  if (type === 'radio') {
    return {
      field_id: field.id,
      value: 'true',
      reasoning: 'Option de test activee',
      is_sensitive: false,
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

  if (type === 'time') {
    return {
      field_id: field.id,
      value: '12:00',
      reasoning: 'Heure de test valide pour un champ horaire',
      is_sensitive: false,
    };
  }

  if (type === 'url') {
    return {
      field_id: field.id,
      value: 'https://example.com',
      reasoning: 'URL de test valide',
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

interface TestCaseMutation {
  field_id: string;
  field_name?: string;
  value: string;
  reason?: string;
}

interface TestCaseSuggestion {
  id: string;
  name: string;
  description: string;
  expected_outcome: 'success' | 'validation_error' | 'business_rejection' | 'server_error' | 'blocked';
  expected_behavior?: 'accept' | 'reject' | 'explore';
  expectation_confidence?: number;
  suggested_severity?: 'critical' | 'high' | 'medium' | 'low';
  suggested_severity_reason?: string;
  baseline_dependent?: boolean;
  field_mutations: TestCaseMutation[];
  expected_signals: Array<{
    type: string;
    value?: string;
    field_id?: string;
    weight?: number;
    enabled?: boolean;
  }>;
  validation_scope?: 'field' | 'form';
  target_field_id?: string;
  target_field_name?: string;
  purpose?: string;
  form_type?: string;
  route_steps?: Array<Record<string, unknown>>;
  oracle?: Record<string, unknown>;
  side_effects?: string[];
  plan_version?: number;
  reasoning: string;
}

const FORM_PROFILE_TYPES = new Set([
  'contact',
  'login',
  'search',
  'newsletter',
  'registration',
  'password_recovery',
  'upload',
  'appointment',
  'checkout_payment',
  'quote_request',
  'feedback_survey',
  'generic',
]);

function normalizeSuggestionValue(field: FieldRow, value: string): string {
  const type = field.field_type.toLowerCase();
  const trimmed = value.trim();
  if (type === 'time' && !/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return '12:00';
  if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return '2026-04-02';
  if (type === 'number' && !/^-?\d+(\.\d+)?$/.test(trimmed)) return '123';
  if (type === 'url' && !/^https?:\/\//i.test(trimmed)) return 'https://example.com';
  if (type === 'email' && !trimmed.includes('@')) return 'contact@example.com';
  return value;
}

function suiteFields(fields: FieldRow[]): SuiteField[] {
  return fields.map((field) => ({
    ...field,
    nominal_value: field.user_value ?? field.ai_suggestion ?? inferValue(field).value,
  }));
}

function applyDetectedFieldValues(fields: SuiteField[], profile: FormProfile): SuiteField[] {
  return fields.map((field) => {
    if (field.user_value !== null && field.user_value !== undefined) return field;
    const detected = profile.fields.find((item) =>
      String(item.selector ?? '') === String(field.field_selector ?? '') ||
      String(item.name ?? '') === field.field_name
    );
    if (!detected) return field;
    if (field.field_type === 'file') return { ...field, nominal_value: 'sample.txt' };
    if (field.field_type === 'select') {
      const options = Array.isArray(detected.options) ? detected.options : [];
      const option = options.find((item) =>
        item && typeof item === 'object' && item.disabled !== true && String(item.value ?? '') !== ''
      );
      if (option && typeof option === 'object') {
        return { ...field, nominal_value: String(option.value ?? '') };
      }
    }
    if (field.field_type === 'radio') {
      const value = String(detected.value ?? '');
      if (value) return { ...field, nominal_value: 'true' };
    }
    return field;
  });
}

function enrichGeneratedCase(
  testCase: TestCaseSuggestion,
  profile: FormProfile,
  fields: FieldRow[],
): GeneratedCase {
  const allowedRouteSelectors = new Set<string>();
  profile.steps.forEach((step) => {
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
  });
  const safeRouteSteps = (testCase.route_steps ?? [])
    .filter((step) => {
      const type = String(step.type ?? '');
      if (type === 'wait') return true;
      return type === 'click' && allowedRouteSelectors.has(String(step.selector ?? ''));
    })
    .map((step) => {
      if (String(step.type ?? '') !== 'wait') return step;
      const duration = Number(step.duration_ms ?? step.value ?? 500);
      return {
        ...step,
        duration_ms: Math.max(0, Math.min(Number.isFinite(duration) ? duration : 500, 10_000)),
      };
    })
    .slice(0, 24);
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const signaledTargets = new Set(
    testCase.expected_signals
      .map((signal) => signal.field_id ?? '')
      .filter((fieldId) => fieldsById.has(fieldId)),
  );
  const intentionalMutations = testCase.field_mutations.filter((mutation) => {
    const reason = String(mutation.reason ?? '').toLowerCase();
    return mutation.value.trim() === '' ||
      /invalide|invalid|volontaire|refus|decoche|incompatible|vide|volumineu|requis|validation/.test(reason);
  });
  const inferredTargetId =
    testCase.target_field_id && fieldsById.has(testCase.target_field_id)
      ? testCase.target_field_id
      : signaledTargets.size === 1
        ? [...signaledTargets][0]
        : intentionalMutations.length === 1
          ? intentionalMutations[0].field_id
          : undefined;
  const validationScope =
    testCase.expected_outcome === 'validation_error'
      ? testCase.validation_scope === 'form'
        ? 'form'
        : inferredTargetId
          ? 'field'
          : 'form'
      : undefined;
  const sourceSignals = testCase.expected_signals.length > 0
    ? testCase.expected_signals
    : defaultSignals(testCase.expected_outcome, profile);
  const expectedSignals = sourceSignals.map((signal) => ({
    ...signal,
    field_id:
      validationScope === 'field' &&
      inferredTargetId &&
      ['form_invalid', 'validation_message_present'].includes(signal.type)
        ? inferredTargetId
        : signal.field_id,
    weight: Number.isFinite(Number(signal.weight)) ? Number(signal.weight) : 0.25,
    enabled: signal.enabled !== false,
  }));
  return {
    ...testCase,
    purpose: testCase.purpose ?? testCase.description,
    validation_scope: validationScope,
    target_field_id: inferredTargetId,
    target_field_name:
      inferredTargetId
        ? fieldsById.get(inferredTargetId)?.field_label ?? fieldsById.get(inferredTargetId)?.field_name
        : undefined,
    form_type: profile.form_type,
    expected_behavior:
      testCase.expected_behavior ??
      (testCase.expected_outcome === 'success'
        ? 'accept'
        : ['validation_error', 'business_rejection'].includes(testCase.expected_outcome)
          ? 'reject'
          : 'explore'),
    expectation_confidence: Math.max(
      0,
      Math.min(Number(testCase.expectation_confidence ?? 0.8), 1),
    ),
    suggested_severity: testCase.suggested_severity ?? (
      profile.form_type === 'checkout_payment' || profile.form_type === 'login'
        ? 'high'
        : testCase.expected_outcome === 'validation_error'
          ? 'medium'
          : 'low'
    ),
    suggested_severity_reason:
      testCase.suggested_severity_reason ??
      'Niveau propose selon le type de formulaire et le comportement attendu.',
    baseline_dependent: testCase.baseline_dependent ?? testCase.expected_outcome === 'success',
    route_steps: safeRouteSteps,
    oracle: {
      expected_outcome: testCase.expected_outcome,
      pass_threshold: 0.65,
      inconclusive_threshold: 0.4,
      signals: expectedSignals,
    },
    side_effects: profile.possible_side_effects,
    plan_version: 2,
  };
}

function mergeGeneratedCases(
  baseCases: GeneratedCase[],
  llmCases: GeneratedCase[],
  maxCases: number,
): GeneratedCase[] {
  const seen = new Set<string>();
  return [...baseCases, ...llmCases]
    .filter((testCase) => {
      const fingerprint = JSON.stringify({
        outcome: testCase.expected_outcome,
        mutations: testCase.field_mutations.map((mutation) => [mutation.field_id, mutation.value]),
        route: testCase.route_steps,
      });
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    })
    .slice(0, maxCases);
}

function heuristicTestCases(fields: FieldRow[], maxCases: number): TestCaseSuggestion[] {
  const cases: TestCaseSuggestion[] = [];
  const nominalMutations = fields.map((field) => {
    const suggestion = inferValue(field);
    return {
      field_id: field.id,
      field_name: field.field_name,
      value: suggestion.value,
      reason: suggestion.reasoning,
    };
  });

  cases.push({
    id: crypto.randomUUID(),
    name: 'Parcours nominal',
    description: 'Soumet le formulaire avec des donnees valides et completes.',
    expected_outcome: 'success',
    field_mutations: nominalMutations,
    expected_signals: [],
    reasoning: 'Etablit la reference fonctionnelle du formulaire.',
  });

  const requiredField = fields.find((field) => field.required && !['checkbox', 'radio'].includes(field.field_type));
  if (requiredField) {
    cases.push({
      id: crypto.randomUUID(),
      name: `Champ requis vide - ${requiredField.field_label ?? requiredField.field_name}`,
      description: 'Verifie que la soumission est bloquee lorsque ce champ requis est vide.',
      expected_outcome: 'validation_error',
      field_mutations: [
        ...nominalMutations.filter((mutation) => mutation.field_id !== requiredField.id),
        {
          field_id: requiredField.id,
          field_name: requiredField.field_name,
          value: '',
          reason: 'Champ requis volontairement vide',
        },
      ],
      expected_signals: [{ type: 'form_invalid', field_id: requiredField.id }],
      reasoning: 'Controle la contrainte required et le message de validation associe.',
    });
  }

  const emailField = fields.find(
    (field) => field.field_type === 'email' || `${field.field_name} ${field.field_label ?? ''}`.toLowerCase().includes('mail'),
  );
  if (emailField) {
    cases.push({
      id: crypto.randomUUID(),
      name: 'Format email invalide',
      description: 'Utilise une adresse sans arobase afin de verifier la validation du format.',
      expected_outcome: 'validation_error',
      field_mutations: nominalMutations.map((mutation) =>
        mutation.field_id === emailField.id
          ? { ...mutation, value: 'adresse-invalide', reason: 'Format email volontairement invalide' }
          : mutation
      ),
      expected_signals: [{ type: 'form_invalid', field_id: emailField.id }],
      reasoning: 'Controle la validation HTML ou applicative du champ email.',
    });
  }

  const requiredConsent = fields.find(
    (field) => field.required && field.field_type === 'checkbox',
  );
  if (requiredConsent) {
    cases.push({
      id: crypto.randomUUID(),
      name: 'Consentement non accepte',
      description: 'Laisse la case obligatoire decochee pour verifier le blocage de la soumission.',
      expected_outcome: 'validation_error',
      field_mutations: nominalMutations.map((mutation) =>
        mutation.field_id === requiredConsent.id
          ? { ...mutation, value: 'false', reason: 'Consentement volontairement refuse' }
          : mutation
      ),
      expected_signals: [{ type: 'form_invalid', field_id: requiredConsent.id }],
      reasoning: 'Verifie que le consentement obligatoire est effectivement applique.',
    });
  }

  const textField = fields.find((field) => ['text', 'textarea'].includes(field.field_type));
  if (textField) {
    cases.push({
      id: crypto.randomUUID(),
      name: `Valeur longue - ${textField.field_label ?? textField.field_name}`,
      description: 'Teste une valeur longue mais non dangereuse afin de verifier la robustesse du champ.',
      expected_outcome: 'success',
      field_mutations: nominalMutations.map((mutation) =>
        mutation.field_id === textField.id
          ? {
              ...mutation,
              value: 'Test SnapFlow '.repeat(20).trim(),
              reason: 'Valeur limite longue et non offensive',
            }
          : mutation
      ),
      expected_signals: [],
      reasoning: 'Teste une limite de longueur sans fuzzing de securite.',
    });
  }

  return cases.slice(0, Math.max(1, Math.min(maxCases, 5)));
}

function normalizeTestCases(
  rawCases: unknown,
  fields: FieldRow[],
  maxCases: number,
): TestCaseSuggestion[] {
  if (!Array.isArray(rawCases)) return [];
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const allowedOutcomes = new Set(['success', 'validation_error', 'business_rejection', 'server_error', 'blocked']);
  const allowedSignals = new Set([
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

  return rawCases
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const expectedOutcome = String(item.expected_outcome ?? 'success');
      const mutations = Array.isArray(item.field_mutations)
        ? item.field_mutations
            .filter((mutation): mutation is Record<string, unknown> => Boolean(mutation && typeof mutation === 'object'))
            .filter((mutation) => fieldsById.has(String(mutation.field_id ?? '')) && typeof mutation.value === 'string')
            .map((mutation) => {
              const field = fieldsById.get(String(mutation.field_id))!;
              return {
                field_id: field.id,
                field_name: field.field_name,
                value:
                  expectedOutcome === 'success'
                    ? normalizeSuggestionValue(field, String(mutation.value))
                    : String(mutation.value),
                reason: String(mutation.reason ?? 'Valeur proposee par IA'),
              };
            })
        : [];
      const signals = Array.isArray(item.expected_signals)
        ? item.expected_signals
            .filter((signal): signal is Record<string, unknown> => Boolean(signal && typeof signal === 'object'))
            .filter((signal) => allowedSignals.has(String(signal.type ?? '')))
            .map((signal) => ({
              type: String(signal.type),
              value: typeof signal.value === 'string' ? signal.value : undefined,
              field_id:
                typeof signal.field_id === 'string' && fieldsById.has(signal.field_id)
                  ? signal.field_id
                  : undefined,
              weight: Number.isFinite(Number(signal.weight)) ? Number(signal.weight) : undefined,
              enabled: signal.enabled !== false,
            }))
        : [];

      return {
        id: crypto.randomUUID(),
        name: String(item.name ?? 'Cas de test IA').slice(0, 120),
        description: String(item.description ?? '').slice(0, 500),
        expected_outcome: (
          allowedOutcomes.has(expectedOutcome) ? expectedOutcome : 'success'
        ) as TestCaseSuggestion['expected_outcome'],
        expected_behavior:
          item.expected_behavior === 'accept' ||
          item.expected_behavior === 'reject' ||
          item.expected_behavior === 'explore'
            ? item.expected_behavior
            : allowedOutcomes.has(expectedOutcome) && expectedOutcome === 'success'
              ? 'accept'
              : ['validation_error', 'business_rejection'].includes(expectedOutcome)
                ? 'reject'
                : 'explore',
        expectation_confidence: Math.max(
          0,
          Math.min(Number(item.expectation_confidence ?? 0.7), 1),
        ),
        suggested_severity:
          item.suggested_severity === 'critical' ||
          item.suggested_severity === 'high' ||
          item.suggested_severity === 'medium' ||
          item.suggested_severity === 'low'
            ? item.suggested_severity
            : 'low',
        suggested_severity_reason: String(
          item.suggested_severity_reason ?? 'Niveau propose par l assistant.',
        ).slice(0, 300),
        baseline_dependent:
          typeof item.baseline_dependent === 'boolean'
            ? item.baseline_dependent
            : expectedOutcome === 'success',
        field_mutations: mutations,
        expected_signals: signals,
        validation_scope:
          item.validation_scope === 'field' || item.validation_scope === 'form'
            ? item.validation_scope
            : undefined,
        target_field_id:
          typeof item.target_field_id === 'string' && fieldsById.has(item.target_field_id)
            ? item.target_field_id
            : undefined,
        target_field_name:
          typeof item.target_field_name === 'string'
            ? item.target_field_name.slice(0, 200)
            : undefined,
        purpose: String(item.purpose ?? item.description ?? '').slice(0, 300),
        route_steps: Array.isArray(item.route_steps)
          ? item.route_steps
              .filter((step): step is Record<string, unknown> => Boolean(step && typeof step === 'object'))
              .slice(0, 24)
          : [],
        reasoning: String(item.reasoning ?? 'Cas propose par IA').slice(0, 500),
      };
    })
    .filter((item) => item.name.trim().length > 0)
    .slice(0, Math.max(1, Math.min(maxCases, 12)));
}

async function inferTestCasesWithLLM(
  workflow: WorkflowRow,
  fields: FieldRow[],
  profile: FormProfile,
  maxCases: number,
): Promise<{ cases: TestCaseSuggestion[]; formType?: string }> {
  const fieldsDescription = fields
    .map(
      (field) =>
        `- ID:${field.id} | Nom:${field.field_name} | Type:${field.field_type} | ` +
        `Label:${field.field_label ?? 'non defini'} | Requis:${field.required ? 'oui' : 'non'}`,
    )
    .join('\n');

  const { apiUrl, apiKey, modelName, missingMessage } = getAiClientConfig();
  if (!apiKey) throw new Error(missingMessage);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelName,
      temperature: 0.2,
      max_tokens: 3200,
      messages: [
        {
          role: 'system',
          content:
            'Tu generes des plans de test fonctionnels pour des formulaires web. ' +
            'Tu n inventes jamais de champ, selecteur, option ou etape. ' +
            'Utilise uniquement les identifiants et interactions fournis. Reponds uniquement en JSON.',
        },
        {
          role: 'user',
          content: `Workflow: ${workflow.name}
URL: ${workflow.target_url}
Type detecte: ${profile.form_type}
Profil:
${JSON.stringify(profile)}
Champs:
${fieldsDescription}

Propose au maximum ${maxCases} cas complementaires adaptes au type du formulaire.
Les cas doivent couvrir le nominal, les validations, les refus metier et les branches conditionnelles utiles.
Utilise uniquement les field_id fournis.
Si la confiance du profil est faible, choisis form_type parmi les types fournis. Sinon conserve le type detecte.
Format:
{"form_type":"contact|login|search|newsletter|registration|password_recovery|upload|appointment|checkout_payment|quote_request|feedback_survey|generic","cases":[{"name":"","description":"","purpose":"","expected_outcome":"success|validation_error|business_rejection|server_error|blocked","expected_behavior":"accept|reject|explore","expectation_confidence":0.8,"suggested_severity":"critical|high|medium|low","suggested_severity_reason":"","baseline_dependent":true,"validation_scope":"field|form","target_field_id":"","field_mutations":[{"field_id":"","value":"","reason":""}],"route_steps":[{"type":"click|wait","selector":"","value":"","label":""}],"expected_signals":[{"type":"form_invalid|validation_message_present|element_present|element_absent|response_status_range|url_contains|url_changed|dom_changed|form_disappeared|network_request_matching|text_present|text_absent","value":"","field_id":"","weight":0.25}],"reasoning":""}]}`,
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Erreur IA ${response.status}`);
  const data = await response.json();
  const raw = String(data.choices?.[0]?.message?.content ?? '');
  const parsed = JSON.parse(extractJsonPayload(raw)) as { cases?: unknown[]; form_type?: unknown };
  const formType = typeof parsed.form_type === 'string' && FORM_PROFILE_TYPES.has(parsed.form_type)
    ? parsed.form_type
    : undefined;
  return {
    cases: normalizeTestCases(parsed.cases, fields, maxCases),
    formType,
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

  const { apiUrl, apiKey, modelName, missingMessage } = getAiClientConfig();
  if (!apiKey) {
    throw new Error(missingMessage);
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

    const fieldsById = new Map(fields.map((field) => [field.id, field]));

    return parsed.suggestions
      .filter((item) => Boolean(item?.field_id && fieldsById.has(item.field_id) && typeof item.value === 'string'))
      .map((item) => ({
        field_id: item.field_id,
        value: normalizeSuggestionValue(fieldsById.get(item.field_id)!, item.value),
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
      .select('id, created_by, org_id, target_url, name, detection_evidence, risk_flags')
      .eq('id', workflowId)
      .maybeSingle();

    if (workflowError) throw new HttpError(500, workflowError.message);
    if (!workflow) throw new HttpError(404, 'Workflow non trouvé');

    const workflowRow = workflow as WorkflowRow;
    if (!canAccessWorkflow(workflowRow, userId, isAdmin)) {
      throw new HttpError(403, 'Accès refusé');
    }

    const scenario = await getScenarioForWorkflow(serviceClient, workflowRow, body.scenario_id);
    let fieldQuery = serviceClient
      .from('workflow_form_fields')
      .select('id, field_name, field_type, field_label, placeholder, required, is_sensitive, user_value, ai_suggestion, field_selector')
      .eq('workflow_id', workflowId)
      .eq('scenario_id', scenario.id);

    if (Array.isArray(body.field_ids) && body.field_ids.length > 0) {
      fieldQuery = fieldQuery.in('id', body.field_ids);
    }

    const { data: fields, error: fieldsError } = await fieldQuery;
    if (fieldsError) throw new HttpError(500, fieldsError.message);

    const fieldRows = (fields ?? []) as FieldRow[];
    if (fieldRows.length === 0) {
      return toJson({ success: true, suggestions: [], cases: [], provider: 'heuristic' });
    }

    if (body.mode === 'test_cases' || body.mode === 'test_suite_plan') {
      const initialFields = suiteFields(fieldRows);
      let profile = normalizeFormProfile(
        workflowRow.detection_evidence,
        initialFields,
        workflowRow.target_url,
        body.form_type,
      );
      const normalizedFields = applyDetectedFieldValues(initialFields, profile);
      const dynamicBudget = dynamicCaseBudget(profile, normalizedFields);
      const maxCases = Math.max(4, Math.min(Number(body.max_cases ?? dynamicBudget), 12));
      let baseCases = buildHeuristicSuite(normalizedFields, profile, maxCases);
      let cases: GeneratedCase[] = baseCases;
      let provider: 'llm' | 'heuristic' = 'llm';
      try {
        const llmPlan = await inferTestCasesWithLLM(workflowRow, fieldRows, profile, maxCases);
        if (!body.form_type && profile.confidence < 0.7 && llmPlan.formType) {
          profile = { ...profile, form_type: llmPlan.formType as FormProfile['form_type'] };
          baseCases = buildHeuristicSuite(normalizedFields, profile, maxCases);
        }
        const llmCases = llmPlan.cases.map((testCase) => enrichGeneratedCase(testCase, profile, fieldRows));
        cases = mergeGeneratedCases(baseCases, llmCases, maxCases);
      } catch (error) {
        console.error('Erreur generation cas IA, fallback heuristique:', error);
        provider = 'heuristic';
        cases = baseCases;
      }
      if (cases.length === 0) {
        provider = 'heuristic';
        cases = baseCases;
      }
      return toJson({
        success: true,
        plan_version: 2,
        form_profile: profile,
        case_count: cases.length,
        cases,
        provider,
        warnings: profile.possible_side_effects,
      });
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
