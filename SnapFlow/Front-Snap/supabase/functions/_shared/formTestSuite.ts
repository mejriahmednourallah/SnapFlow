export type ExpectedOutcome =
  | 'success'
  | 'validation_error'
  | 'business_rejection'
  | 'server_error'
  | 'blocked';

export type FormProfileType =
  | 'contact'
  | 'login'
  | 'search'
  | 'newsletter'
  | 'registration'
  | 'password_recovery'
  | 'upload'
  | 'appointment'
  | 'checkout_payment'
  | 'quote_request'
  | 'feedback_survey'
  | 'generic';

export interface SuiteField {
  id: string;
  field_name: string;
  field_type: string;
  field_label: string | null;
  placeholder: string | null;
  required: boolean;
  user_value?: string | null;
  ai_suggestion?: string | null;
  field_selector?: string | null;
  nominal_value: string;
}

export interface EvidenceSignal {
  type: string;
  value?: string;
  field_id?: string;
  weight?: number;
  enabled?: boolean;
}

export interface FormProfile {
  version: 2;
  form_type: FormProfileType;
  confidence: number;
  alternative_types: FormProfileType[];
  action_url: string;
  method: string;
  submit_selector: string;
  fields: Array<Record<string, unknown>>;
  steps: Array<Record<string, unknown>>;
  conditional_rules: Array<Record<string, unknown>>;
  success_candidates: EvidenceSignal[];
  failure_candidates: EvidenceSignal[];
  possible_side_effects: string[];
  route_compiled?: boolean;
}

export interface GeneratedCase {
  id: string;
  name: string;
  description: string;
  purpose: string;
  expected_outcome: ExpectedOutcome;
  expected_behavior: 'accept' | 'reject' | 'explore';
  expectation_confidence: number;
  suggested_severity: 'critical' | 'high' | 'medium' | 'low';
  suggested_severity_reason: string;
  baseline_dependent: boolean;
  field_mutations: Array<{
    field_id: string;
    field_name?: string;
    value: string;
    reason?: string;
  }>;
  expected_signals: EvidenceSignal[];
  validation_scope?: 'field' | 'form';
  target_field_id?: string;
  target_field_name?: string;
  route_steps: Array<Record<string, unknown>>;
  oracle: {
    expected_outcome: ExpectedOutcome;
    pass_threshold: number;
    inconclusive_threshold: number;
    signals: EvidenceSignal[];
  };
  side_effects: string[];
  plan_version: 2;
  form_type: FormProfileType;
  reasoning: string;
}

const FORM_TYPES = new Set<FormProfileType>([
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asSignals(value: unknown): EvidenceSignal[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          type: String(item.type ?? ''),
          value: typeof item.value === 'string' ? item.value : undefined,
          field_id: typeof item.field_id === 'string' ? item.field_id : undefined,
          weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : undefined,
          enabled: item.enabled !== false,
        }))
        .filter((item) => item.type)
    : [];
}

function classifyFallback(fields: SuiteField[], targetUrl: string): FormProfileType {
  const blob = `${targetUrl} ${fields.map((field) =>
    `${field.field_type} ${field.field_name} ${field.field_label ?? ''} ${field.placeholder ?? ''}`
  ).join(' ')}`.toLowerCase();
  if (/checkout|payment|paiement|commande|panier|card/.test(blob)) return 'checkout_payment';
  if (/appointment|booking|reservation|rendez-vous|rdv/.test(blob)) return 'appointment';
  if (/register|signup|inscription|creer.*compte/.test(blob)) return 'registration';
  if (/forgot|reset|mot de passe oublie/.test(blob)) return 'password_recovery';
  if (fields.some((field) => field.field_type === 'password') || /login|connexion|signin/.test(blob)) return 'login';
  if (fields.some((field) => field.field_type === 'search') || /search|recherche/.test(blob)) return 'search';
  if (/newsletter|subscribe|abonn/.test(blob)) return 'newsletter';
  if (fields.some((field) => field.field_type === 'file')) return 'upload';
  if (/devis|quote|estimation/.test(blob)) return 'quote_request';
  if (/feedback|survey|sondage|questionnaire/.test(blob)) return 'feedback_survey';
  if (/contact|message|subject|objet/.test(blob)) return 'contact';
  return 'generic';
}

export function normalizeFormProfile(
  detectionEvidence: unknown,
  fields: SuiteField[],
  targetUrl: string,
  overrideType?: string,
): FormProfile {
  const evidence = asRecord(detectionEvidence);
  const raw = asRecord(evidence.form_profile);
  const requestedType = overrideType && FORM_TYPES.has(overrideType as FormProfileType)
    ? overrideType as FormProfileType
    : null;
  const detectedType = FORM_TYPES.has(String(raw.form_type) as FormProfileType)
    ? String(raw.form_type) as FormProfileType
    : classifyFallback(fields, targetUrl);
  return {
    version: 2,
    form_type: requestedType ?? detectedType,
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0.5,
    alternative_types: Array.isArray(raw.alternative_types)
      ? raw.alternative_types.filter((item): item is FormProfileType => FORM_TYPES.has(String(item) as FormProfileType))
      : [],
    action_url: String(raw.action_url ?? ''),
    method: String(raw.method ?? 'GET').toUpperCase(),
    submit_selector: String(raw.submit_selector ?? 'button[type="submit"], input[type="submit"]'),
    fields: Array.isArray(raw.fields) ? raw.fields.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>> : [],
    steps: Array.isArray(raw.steps) ? raw.steps.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>> : [],
    conditional_rules: Array.isArray(raw.conditional_rules)
      ? raw.conditional_rules.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>
      : [],
    success_candidates: asSignals(raw.success_candidates),
    failure_candidates: asSignals(raw.failure_candidates),
    possible_side_effects: Array.isArray(raw.possible_side_effects)
      ? raw.possible_side_effects.map(String).filter(Boolean)
      : [],
    route_compiled: raw.route_compiled === true,
  };
}

export function dynamicCaseBudget(profile: FormProfile, fields: SuiteField[]): number {
  let budget = 4;
  const capabilities = new Set<string>();
  if (fields.some((field) => field.field_type === 'file')) capabilities.add('upload');
  if (fields.some((field) => field.field_type === 'password')) capabilities.add('login');
  if (fields.some((field) => field.field_type === 'checkbox' && field.required)) capabilities.add('consent');
  if (profile.steps.some((step) => Boolean(step.inferred_multi_step))) capabilities.add('multi_step');
  if (profile.conditional_rules.length > 0) capabilities.add('conditional');
  if (profile.form_type === 'checkout_payment') capabilities.add('payment');
  budget += capabilities.size;
  if (fields.length >= 10) budget += 1;
  if (fields.length >= 20) budget += 1;
  return Math.max(4, Math.min(12, budget));
}

export function defaultSignals(outcome: ExpectedOutcome, profile: FormProfile): EvidenceSignal[] {
  if (outcome === 'validation_error') {
    return [
      { type: 'form_invalid', weight: 0.5 },
      { type: 'validation_message_present', weight: 0.3 },
      ...profile.failure_candidates.slice(0, 2),
    ];
  }
  if (outcome === 'business_rejection') {
    return [
      ...profile.failure_candidates.slice(0, 3),
      { type: 'response_status_range', value: '200-499', weight: 0.2 },
      { type: 'dom_changed', weight: 0.15 },
    ];
  }
  if (outcome === 'server_error') {
    return [
      { type: 'response_status_range', value: '500-599', weight: 0.75 },
      { type: 'network_request_matching', value: profile.action_url, weight: 0.25 },
    ];
  }
  if (outcome === 'blocked') {
    return [{ type: 'text_present', value: 'captcha', weight: 1 }];
  }
  const successCandidates = profile.success_candidates.slice(0, 3);
  return [
    ...(successCandidates.length > 0
      ? successCandidates
      : [{ type: 'success_message_present', weight: 0.45 }]),
    { type: 'response_status_range', value: '200-399', weight: 0.2 },
    { type: 'dom_changed', weight: 0.15 },
    { type: 'url_changed', weight: 0.1 },
    { type: 'form_disappeared', value: profile.submit_selector, weight: 0.1 },
  ];
}

function validationSignalsForField(fieldId: string): EvidenceSignal[] {
  return [
    { type: 'form_invalid', field_id: fieldId, weight: 0.5 },
    { type: 'validation_message_present', field_id: fieldId, weight: 0.3 },
  ];
}

function routeSteps(profile: FormProfile): Array<Record<string, unknown>> {
  if (profile.route_compiled) return [];
  const exploredPath = profile.steps
    .map((step) => Array.isArray(step.route_steps) ? step.route_steps : [])
    .sort((left, right) => right.length - left.length)[0] ?? [];
  if (exploredPath.length > 0) {
    const steps: Array<Record<string, unknown>> = [];
    exploredPath.slice(0, 6).forEach((interaction) => {
      if (!interaction || typeof interaction !== 'object' || interaction.kind !== 'click') return;
      const selector = String(interaction.selector ?? '');
      if (!selector) return;
      steps.push({
        type: 'click',
        selector,
        label: String(interaction.label ?? 'Continuer vers l etape suivante'),
      });
      steps.push({ type: 'wait', duration_ms: 500, label: 'Attendre l etape suivante' });
    });
    if (steps.length > 0) return steps.slice(0, 12);
  }
  const steps: Array<Record<string, unknown>> = [];
  profile.steps.slice(0, 6).forEach((step) => {
    const selectors = Array.isArray(step.next_selectors) ? step.next_selectors.map(String).filter(Boolean) : [];
    selectors.slice(0, 1).forEach((selector) => {
      steps.push({ type: 'click', selector, label: 'Continuer vers l etape suivante' });
      steps.push({ type: 'wait', duration_ms: 500, label: 'Attendre l etape suivante' });
    });
  });
  return steps.slice(0, 12);
}

function caseFrom(
  profile: FormProfile,
  nominal: GeneratedCase['field_mutations'],
  input: {
    name: string;
    description: string;
    purpose: string;
    outcome: ExpectedOutcome;
    mutations?: GeneratedCase['field_mutations'];
    signals?: EvidenceSignal[];
    validationScope?: 'field' | 'form';
    targetField?: Pick<SuiteField, 'id' | 'field_name' | 'field_label'>;
    reasoning: string;
  },
): GeneratedCase {
  const expectedBehavior =
    input.outcome === 'success'
      ? 'accept'
      : input.outcome === 'validation_error' || input.outcome === 'business_rejection'
        ? 'reject'
        : 'explore';
  const validationScope = input.outcome === 'validation_error'
    ? input.validationScope ?? (input.targetField ? 'field' : 'form')
    : undefined;
  const signals = input.signals?.length
    ? input.signals
    : input.outcome === 'validation_error' && input.targetField
      ? validationSignalsForField(input.targetField.id)
      : defaultSignals(input.outcome, profile);
  return {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    purpose: input.purpose,
    expected_outcome: input.outcome,
    expected_behavior: expectedBehavior,
    expectation_confidence: expectedBehavior === 'explore' ? 0.45 : 0.85,
    suggested_severity:
      profile.form_type === 'checkout_payment' || profile.form_type === 'login'
        ? 'high'
        : input.outcome === 'validation_error'
          ? 'medium'
          : 'low',
    suggested_severity_reason:
      input.outcome === 'validation_error'
        ? 'Une validation absente peut degrader la qualite des donnees ou la conformite du parcours.'
        : 'Le niveau sera confirme uniquement si le comportement observe contredit cette attente.',
    baseline_dependent: expectedBehavior === 'accept',
    field_mutations: input.mutations ?? nominal,
    expected_signals: signals,
    validation_scope: validationScope,
    target_field_id: input.targetField?.id,
    target_field_name: input.targetField?.field_label ?? input.targetField?.field_name,
    route_steps: routeSteps(profile),
    oracle: {
      expected_outcome: input.outcome,
      pass_threshold: 0.65,
      inconclusive_threshold: 0.4,
      signals,
    },
    side_effects: profile.possible_side_effects,
    plan_version: 2,
    form_type: profile.form_type,
    reasoning: input.reasoning,
  };
}

export function buildHeuristicSuite(
  fields: SuiteField[],
  profile: FormProfile,
  requestedMax?: number,
): GeneratedCase[] {
  const budget = Math.max(4, Math.min(12, requestedMax ?? dynamicCaseBudget(profile, fields)));
  const nominal = fields.map((field) => ({
    field_id: field.id,
    field_name: field.field_name,
    value: field.user_value ?? field.ai_suggestion ?? field.nominal_value,
    reason: field.user_value !== null && field.user_value !== undefined
      ? 'Valeur configuree par l utilisateur'
      : 'Valeur nominale de test',
  }));
  const cases: GeneratedCase[] = [
    caseFrom(profile, nominal, {
      name: 'Parcours nominal',
      description: 'Execute le parcours complet avec les valeurs configurees et attend une issue fonctionnelle.',
      purpose: 'Etablir la reference du formulaire',
      outcome: 'success',
      reasoning: `Cas nominal adapte au formulaire ${profile.form_type}.`,
    }),
  ];

  const required = fields.find((field) => field.required && !['checkbox', 'radio'].includes(field.field_type));
  if (required) {
    cases.push(caseFrom(profile, nominal, {
      name: `Champ requis vide - ${required.field_label ?? required.field_name}`,
      description: 'Verifie que la progression ou la soumission refuse un champ obligatoire vide.',
      purpose: 'Validation des champs requis',
      outcome: 'validation_error',
      mutations: nominal.map((item) => item.field_id === required.id
        ? { ...item, value: '', reason: 'Champ requis volontairement vide' }
        : item),
      targetField: required,
      reasoning: 'Le navigateur ou l application doit exposer une validation exploitable.',
    }));
  }

  const email = fields.find((field) => field.field_type === 'email' || /mail/i.test(field.field_name));
  if (email) {
    cases.push(caseFrom(profile, nominal, {
      name: 'Format email invalide',
      description: 'Soumet une adresse email syntaxiquement invalide.',
      purpose: 'Validation du format email',
      outcome: 'validation_error',
      mutations: nominal.map((item) => item.field_id === email.id
        ? { ...item, value: 'adresse-invalide', reason: 'Format email invalide' }
        : item),
      targetField: email,
      reasoning: 'Le champ email doit être bloqué avant ou pendant la soumission.',
    }));
  }

  const consent = fields.find((field) => field.required && field.field_type === 'checkbox');
  if (consent) {
    cases.push(caseFrom(profile, nominal, {
      name: 'Consentement obligatoire refuse',
      description: 'Laisse la case obligatoire decochee.',
      purpose: 'Validation du consentement',
      outcome: 'validation_error',
      mutations: nominal.map((item) => item.field_id === consent.id
        ? { ...item, value: 'false', reason: 'Consentement volontairement refuse' }
        : item),
      targetField: consent,
      reasoning: 'Le formulaire doit bloquer la soumission sans consentement requis.',
    }));
  }

  const businessField = fields.find((field) => ['email', 'password', 'search', 'date', 'time'].includes(field.field_type));
  if (['login', 'registration', 'appointment', 'checkout_payment', 'newsletter'].includes(profile.form_type) && businessField) {
    cases.push(caseFrom(profile, nominal, {
      name: 'Refus métier contrôlé',
      description: 'Utilise une valeur plausible mais non reconnue afin de vérifier un refus propre.',
      purpose: 'Distinguer refus métier et panne technique',
      outcome: 'business_rejection',
      mutations: nominal.map((item) => item.field_id === businessField.id
        ? { ...item, value: businessField.field_type === 'email' ? 'inconnu@example.com' : 'Valeur non reconnue', reason: 'Valeur métier inconnue' }
        : item),
      reasoning: 'Un refus métier explicite prouve que le parcours répond sans être un succès utilisateur.',
    }));
  }

  if (profile.form_type === 'search') {
    const search = fields.find((field) => field.field_type === 'search' || /search|recherche/i.test(field.field_name));
    if (search) {
      cases.push(caseFrom(profile, nominal, {
        name: 'Recherche sans résultat',
        description: 'Recherche une valeur improbable et vérifie que le moteur répond proprement.',
        purpose: 'Valider le comportement zéro résultat',
        outcome: 'success',
        mutations: nominal.map((item) => item.field_id === search.id
          ? { ...item, value: 'snapflow-aucun-resultat-938271', reason: 'Requête sans résultat attendue' }
          : item),
        signals: [
          { type: 'dom_changed', weight: 0.35 },
          { type: 'url_changed', weight: 0.2 },
          { type: 'network_request_matching', value: profile.action_url, weight: 0.25 },
          { type: 'response_status_range', value: '200-399', weight: 0.2 },
        ],
        reasoning: 'Une absence de résultat correctement présentée reste un succès fonctionnel.',
      }));
    }
  }

  const upload = fields.find((field) => field.field_type === 'file');
  if (upload) {
    cases.push(caseFrom(profile, nominal, {
      name: 'Fichier refusé',
      description: 'Utilise une fixture incompatible afin de vérifier la validation de fichier.',
      purpose: 'Validation du contrôle upload',
      outcome: 'validation_error',
      mutations: nominal.map((item) => item.field_id === upload.id
        ? { ...item, value: 'invalid-extension.exe', reason: 'Fixture volontairement incompatible' }
        : item),
      targetField: upload,
      reasoning: 'Le contrôle doit refuser une extension ou un contenu non accepté.',
    }));
    cases.push(caseFrom(profile, nominal, {
      name: 'Fichier vide',
      description: 'Charge une fixture vide afin de verifier le controle du contenu.',
      purpose: 'Validation des fichiers vides',
      outcome: 'validation_error',
      mutations: nominal.map((item) => item.field_id === upload.id
        ? { ...item, value: 'snapflow-empty.txt', reason: 'Fixture vide generee par l executor' }
        : item),
      targetField: upload,
      reasoning: 'Un fichier sans contenu doit etre refuse ou explicitement accepte selon le besoin metier.',
    }));
    cases.push(caseFrom(profile, nominal, {
      name: 'Fichier volumineux',
      description: 'Charge une fixture de 6 Mo afin de tester la limite de taille.',
      purpose: 'Validation de la taille maximale',
      outcome: 'validation_error',
      mutations: nominal.map((item) => item.field_id === upload.id
        ? { ...item, value: 'snapflow-6mb.bin', reason: 'Fixture volumineuse generee par l executor' }
        : item),
      targetField: upload,
      reasoning: 'Le formulaire doit exposer un comportement clair lorsque la limite de taille est depassee.',
    }));
  }

  const longText = fields.find((field) => ['text', 'textarea'].includes(field.field_type));
  if (longText) {
    cases.push(caseFrom(profile, nominal, {
      name: `Valeur longue - ${longText.field_label ?? longText.field_name}`,
      description: 'Teste une valeur longue non offensive.',
      purpose: 'Robustesse des limites de longueur',
      outcome: 'success',
      mutations: nominal.map((item) => item.field_id === longText.id
        ? { ...item, value: 'Test SnapFlow '.repeat(30).trim(), reason: 'Valeur longue non offensive' }
        : item),
      reasoning: 'Le formulaire doit gérer proprement une saisie longue ou exposer sa limite.',
    }));
  }

  for (const rule of profile.conditional_rules.slice(0, 3)) {
    const controllerName = String(rule.controller_field ?? '');
    const controller = fields.find((field) => field.field_name === controllerName);
    const options = Array.isArray(rule.options)
      ? rule.options.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      : [];
    if (!controller || options.length < 2) continue;
    const option = options.find((item) => !item.disabled) ?? options[0];
    cases.push(caseFrom(profile, nominal, {
      name: `Branche - ${controller.field_label ?? controller.field_name}`,
      description: `Active l option ${String(option.label ?? option.value ?? '')} et poursuit le parcours.`,
      purpose: 'Couvrir une branche conditionnelle',
      outcome: 'success',
      mutations: nominal.map((item) => item.field_id === controller.id
        ? { ...item, value: String(option.value ?? ''), reason: 'Option de branche conditionnelle' }
        : item),
      reasoning: 'Chaque contrôleur conditionnel significatif doit posséder au moins un parcours dédié.',
    }));
  }

  const fallbackField = fields.find((field) => ['text', 'textarea', 'search'].includes(field.field_type)) ?? fields[0];
  if (fallbackField && cases.length < Math.min(4, budget)) {
    cases.push(caseFrom(profile, nominal, {
      name: `Caracteres usuels - ${fallbackField.field_label ?? fallbackField.field_name}`,
      description: 'Verifie que les accents, apostrophes et ponctuations metier sont traites proprement.',
      purpose: 'Robustesse des saisies utilisateur courantes',
      outcome: 'success',
      mutations: nominal.map((item) => item.field_id === fallbackField.id
        ? { ...item, value: "Test d'utilisateur: reference 2026-01", reason: 'Ponctuation et apostrophe usuelles' }
        : item),
      reasoning: 'Ce cas complete la couverture minimale sans utiliser de charge offensive.',
    }));
  }
  if (fallbackField && cases.length < Math.min(4, budget)) {
    cases.push(caseFrom(profile, nominal, {
      name: `Espaces de saisie - ${fallbackField.field_label ?? fallbackField.field_name}`,
      description: 'Verifie le traitement des espaces de debut et de fin.',
      purpose: 'Normalisation des valeurs saisies',
      outcome: 'success',
      mutations: nominal.map((item) => item.field_id === fallbackField.id
        ? { ...item, value: `  ${item.value || 'Valeur de test'}  `, reason: 'Espaces volontaires autour de la valeur' }
        : item),
      reasoning: 'Le formulaire doit normaliser ou accepter explicitement cette saisie.',
    }));
  }

  const seen = new Set<string>();
  return cases
    .filter((item) => {
      const fingerprint = JSON.stringify({
        outcome: item.expected_outcome,
        mutations: item.field_mutations.map((mutation) => [mutation.field_id, mutation.value]),
        route: item.route_steps,
      });
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    })
    .slice(0, budget);
}
