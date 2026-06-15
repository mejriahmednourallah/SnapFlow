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

interface DetectBody {
  workflow_id?: string;
  scenario_id?: string;
  force_reset?: boolean;
  selected_form_selector?: string;
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
  value?: string;
  min?: string | null;
  max?: string | null;
  step?: string | null;
  pattern?: string | null;
  minlength?: number | null;
  maxlength?: number | null;
  autocomplete?: string | null;
  group_name?: string | null;
  checked?: boolean;
  form_selector?: string;
  options?: Array<{ label: string; value: string; selected?: boolean; disabled?: boolean }>;
  step_index?: number;
}

interface RejectedCandidate {
  name: string;
  type: string;
  selector: string;
  reason: string;
  source: string;
}

type FormProfileType =
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

interface FormProfile {
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
  success_candidates: Array<Record<string, unknown>>;
  failure_candidates: Array<Record<string, unknown>>;
  possible_side_effects: string[];
  route_compiled?: boolean;
  form_identity?: FormIdentity;
}

interface FormIdentity {
  selector: string;
  action_url: string;
  method: string;
  form_index: number;
  field_fingerprint: string[];
  confidence: number;
}

interface FormCandidate {
  form: Record<string, unknown>;
  fields: DetectedField[];
  identity: FormIdentity;
  form_type: FormProfileType;
  score: number;
  reasons: string[];
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
  formProfile: FormProfile;
  formCandidates: FormCandidate[];
  selectedFormIdentity: FormIdentity | null;
  selectionRequired: boolean;
}

interface WorkflowRow {
  id: string;
  created_by: string;
  org_id: string;
  status: string;
  target_url: string;
}

const REVIEW_RISK_FLAGS = new Set(['captcha', 'login', 'upload', 'appointment', 'external_provider', 'account_creation', 'medical', 'legal']);
const BROWSER_MANAGED_FIELD_NAMES = new Set([
  'form_build_id',
  'form_token',
  'form_id',
  'captcha_sid',
  'captcha_token',
  'captcha_cacheable',
  'g-recaptcha-response',
  'h-captcha-response',
  'cf-turnstile-response',
]);

function normalizedFieldName(value: string): string {
  return value.trim().toLowerCase().replace(/\[\]$/, '');
}

function browserManagedFieldReason(name: string, rawType: string): string | null {
  const normalizedName = normalizedFieldName(name);
  if (rawType === 'hidden') return 'hidden_field';
  if (BROWSER_MANAGED_FIELD_NAMES.has(normalizedName)) return 'browser_managed_field';
  if (/(^|[_-])(csrf|xsrf)([_-]|$)/.test(normalizedName)) return 'csrf_token';
  return null;
}

function stableFieldSelector(tag: string, name: string, id: string, type: string, value: string): string {
  if (id) return `#${id.replace(/"/g, '\\"')}`;
  if (name) {
    const valueSelector = ['checkbox', 'radio'].includes(type) && value
      ? `[value="${value.replace(/"/g, '\\"')}"]`
      : '';
    return `${tag}[name="${name.replace(/"/g, '\\"')}"]${valueSelector}`;
  }
  return `${tag}[type="${type}"]`;
}


function isSensitiveField(field: DetectedField): boolean {
  const blob = `${field.type} ${field.name} ${field.label ?? ''} ${field.placeholder ?? ''}`.toLowerCase();
  return field.type === 'password' || /password|passwd|mot.?de.?passe|token|secret|api.?key/.test(blob);
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

function normalizeFieldType(value: string, fallback = 'text'): string {
  const raw = value.trim().toLowerCase();
  if (!raw || raw === 'true' || raw === 'input') return fallback;
  if (raw === 'textarea' || raw === 'select') return raw;
  const supported = new Set(['text', 'email', 'tel', 'password', 'checkbox', 'radio', 'number', 'date', 'time', 'url', 'search', 'file']);
  return supported.has(raw) ? raw : fallback;
}

function normalizeDetectedFields(
  rawFields: unknown,
  rejectedCandidates: RejectedCandidate[] = [],
  source = 'rendered',
): DetectedField[] {
  if (!Array.isArray(rawFields)) return [];

  return rawFields
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;

      const rawType = typeof row.type === 'string' ? row.type.trim().toLowerCase() : 'text';
      const type = normalizeFieldType(rawType);
      const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : type;
      const rejectionReason = browserManagedFieldReason(name, rawType);
      if (rejectionReason) {
        rejectedCandidates.push({
          name,
          type: rawType || type,
          selector: typeof row.selector === 'string' ? row.selector : '',
          reason: rejectionReason,
          source,
        });
        return null;
      }
      const selector =
        typeof row.selector === 'string' && row.selector.trim()
          ? row.selector.trim()
          : typeof row.id === 'string' && row.id.trim()
            ? `#${row.id.trim()}`
            : stableFieldSelector(
                type === 'textarea' || type === 'select' ? type : 'input',
                name,
                '',
                type,
                typeof row.value === 'string' ? row.value : '',
              );

      return {
        name,
        type,
        label: typeof row.label === 'string' && row.label.trim() ? row.label.trim() : null,
        selector,
        placeholder: typeof row.placeholder === 'string' && row.placeholder.trim() ? row.placeholder.trim() : null,
        required: Boolean(row.required),
        visible: row.visible === undefined ? undefined : Boolean(row.visible),
        enabled: row.enabled === undefined ? undefined : Boolean(row.enabled),
        value: typeof row.value === 'string' ? row.value : '',
        min: typeof row.min === 'string' && row.min ? row.min : null,
        max: typeof row.max === 'string' && row.max ? row.max : null,
        step: typeof row.step === 'string' && row.step ? row.step : null,
        pattern: typeof row.pattern === 'string' && row.pattern ? row.pattern : null,
        minlength: Number.isFinite(Number(row.minlength)) ? Number(row.minlength) : null,
        maxlength: Number.isFinite(Number(row.maxlength)) ? Number(row.maxlength) : null,
        autocomplete: typeof row.autocomplete === 'string' && row.autocomplete ? row.autocomplete : null,
        group_name: typeof row.group_name === 'string' && row.group_name ? row.group_name : name,
        checked: Boolean(row.checked),
        form_selector: typeof row.form_selector === 'string' ? row.form_selector : undefined,
        options: Array.isArray(row.options)
          ? row.options
              .filter((option): option is Record<string, unknown> => Boolean(option && typeof option === 'object'))
              .map((option) => ({
                label: String(option.label ?? option.value ?? ''),
                value: String(option.value ?? ''),
                selected: Boolean(option.selected),
                disabled: Boolean(option.disabled),
              }))
          : [],
        step_index: Number.isFinite(Number(row.step_index)) ? Number(row.step_index) : 0,
      } as DetectedField;
    })
    .filter((field): field is DetectedField => Boolean(field));
}

function parseFormsFromHtml(html: string): { fields: DetectedField[]; rejectedCandidates: RejectedCandidate[] } {
  const fields: DetectedField[] = [];
  const rejectedCandidates: RejectedCandidate[] = [];

  const inputRegex = /<input([^>]*?)>/gi;
  const textareaRegex = /<textarea([^>]*?)>/gi;
  const selectRegex = /<select([^>]*?)>/gi;

  const parseAttributes = (attrs: string): Record<string, string> => {
    const map: Record<string, string> = {};
    const attrRegex = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let match: RegExpExecArray | null;

    while ((match = attrRegex.exec(attrs)) !== null) {
      map[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? 'true';
    }

    return map;
  };

  const appendField = (attrs: string, defaultTag: string) => {
    const attrMap = parseAttributes(attrs);
    const rawType = (attrMap.type ?? defaultTag).trim().toLowerCase();
    if (['submit', 'button', 'image', 'reset'].includes(rawType)) return;
    const fieldType = normalizeFieldType(rawType, defaultTag === 'input' ? 'text' : defaultTag);
    const fieldName = attrMap.name ?? attrMap.id ?? fieldType;
    const fieldId = attrMap.id;
    const selector = stableFieldSelector(defaultTag, attrMap.name ?? '', fieldId ?? '', fieldType, attrMap.value ?? '');
    const rejectionReason = browserManagedFieldReason(fieldName, rawType);
    if (rejectionReason) {
      rejectedCandidates.push({
        name: fieldName,
        type: rawType || fieldType,
        selector,
        reason: rejectionReason,
        source: 'static_html',
      });
      return;
    }

    fields.push({
      name: fieldName,
      type: fieldType,
      label: attrMap.value ?? null,
      selector,
      placeholder: attrMap.placeholder ?? null,
      required: attrs.toLowerCase().includes('required'),
      value: attrMap.value ?? '',
      min: attrMap.min ?? null,
      max: attrMap.max ?? null,
      step: attrMap.step ?? null,
      pattern: attrMap.pattern ?? null,
      minlength: attrMap.minlength ? Number(attrMap.minlength) : null,
      maxlength: attrMap.maxlength ? Number(attrMap.maxlength) : null,
      autocomplete: attrMap.autocomplete ?? null,
      group_name: attrMap.name ?? fieldName,
      checked: Object.prototype.hasOwnProperty.call(attrMap, 'checked'),
      options: [],
    });
  };

  let inputMatch: RegExpExecArray | null;
  while ((inputMatch = inputRegex.exec(html)) !== null) appendField(inputMatch[1], 'input');

  let textareaMatch: RegExpExecArray | null;
  while ((textareaMatch = textareaRegex.exec(html)) !== null) appendField(textareaMatch[1], 'textarea');

  let selectMatch: RegExpExecArray | null;
  while ((selectMatch = selectRegex.exec(html)) !== null) appendField(selectMatch[1], 'select');

  return { fields, rejectedCandidates };
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

function nodeTypeForField(field: DetectedField): 'fill' | 'select' | 'check' | 'upload' {
  if (field.type === 'select') return 'select';
  if (field.type === 'checkbox' || field.type === 'radio') return 'check';
  if (field.type === 'file') return 'upload';
  return 'fill';
}

function nodeLabelForField(field: DetectedField): string {
  const label = field.label || field.name || field.type;
  if (field.type === 'select') return `Selectionner ${label}`;
  if (field.type === 'checkbox') return `Cocher ${label}`;
  if (field.type === 'radio') return `Choisir ${label}`;
  if (field.type === 'file') return `Uploader ${label}`;
  return `Remplir ${label}`;
}

function countStaticForms(html: string): number {
  return html.match(/<form\b/gi)?.length ?? 0;
}

async function runStaticDetection(
  targetUrl: string,
): Promise<{ fields: DetectedField[]; rejectedCandidates: RejectedCandidate[]; html: string; error: string | null }> {
  try {
    const pageResponse = await fetch(targetUrl, { signal: AbortSignal.timeout(12000) });
    const html = await pageResponse.text();
    const parsed = parseFormsFromHtml(html);
    return { fields: parsed.fields, rejectedCandidates: parsed.rejectedCandidates, html, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'static_fetch_failed';
    return { fields: [], rejectedCandidates: [], html: '', error: message };
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

function discoveryForms(payload: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!payload) return [];
  return (Array.isArray(payload.forms) ? payload.forms : [])
    .filter((form): form is Record<string, unknown> => Boolean(form && typeof form === 'object'));
}

function fieldFingerprint(fields: DetectedField[]): string[] {
  return unique(fields.map((field) => [
    normalizedFieldName(field.name),
    field.type,
    field.type === 'radio' || field.type === 'checkbox' ? field.value ?? '' : '',
  ].join(':'))).sort();
}

function buildFormIdentity(
  form: Record<string, unknown>,
  fields: DetectedField[],
  formIndex: number,
  confidence: number,
): FormIdentity {
  return {
    selector: String(form.selector ?? `form:nth-of-type(${formIndex + 1})`),
    action_url: String(form.action ?? ''),
    method: String(form.method ?? 'GET').toUpperCase(),
    form_index: formIndex,
    field_fingerprint: fieldFingerprint(fields),
    confidence,
  };
}

function rankFormCandidates(
  targetUrl: string,
  payload: Record<string, unknown> | null,
  rejectedCandidates: RejectedCandidate[],
  source: string,
  selectedSelector?: string,
): FormCandidate[] {
  return discoveryForms(payload)
    .map((form, formIndex) => {
      const fields = normalizeDetectedFields(form.fields, rejectedCandidates, `${source}:form:${formIndex}`);
      const classification = classifyFormType(targetUrl, fields, form);
      const visibleFields = fields.filter((field) => field.visible !== false && field.enabled !== false);
      const submitSelector = String(form.submit_selector ?? '');
      const blob = `${form.text ?? ''} ${form.action ?? ''} ${visibleFields.map((field) =>
        `${field.name} ${field.label ?? ''} ${field.placeholder ?? ''}`
      ).join(' ')}`.toLowerCase();
      const reasons: string[] = [];
      let score = Math.min(18, visibleFields.length * 1.8) + classification.confidence * 10;
      if (visibleFields.some((field) => field.type === 'textarea')) {
        score += 4;
        reasons.push('contains_long_text_field');
      }
      if (visibleFields.some((field) => field.required)) {
        score += 2;
        reasons.push('contains_required_fields');
      }
      if (submitSelector) {
        score += 2;
        reasons.push('explicit_submit_control');
      }
      if (classification.formType === 'newsletter' && visibleFields.length <= 2) {
        score -= 8;
        reasons.push('compact_newsletter_form');
      }
      if (classification.formType === 'search' && visibleFields.length <= 2) {
        score -= 6;
        reasons.push('compact_search_form');
      }
      if (/footer|newsletter|subscribe|abonn/.test(blob) && visibleFields.length <= 3) {
        score -= 4;
        reasons.push('utility_or_footer_form');
      }
      const selector = String(form.selector ?? '');
      if (selectedSelector && selector === selectedSelector) {
        score += 1000;
        reasons.push('operator_selected');
      }
      const confidence = Math.max(0.35, Math.min(0.99, classification.confidence + Math.min(0.2, visibleFields.length / 50)));
      return {
        form,
        fields,
        identity: buildFormIdentity(form, fields, formIndex, confidence),
        form_type: classification.formType,
        score,
        reasons,
      };
    })
    .filter((candidate) => candidate.fields.length > 0)
    .sort((left, right) => right.score - left.score);
}

function classifyFormType(
  targetUrl: string,
  fields: DetectedField[],
  form: Record<string, unknown> | null,
): { formType: FormProfileType; confidence: number; alternatives: FormProfileType[] } {
  const fieldText = fields
    .map((field) => `${field.type} ${field.name} ${field.label ?? ''} ${field.placeholder ?? ''}`)
    .join(' ');
  const blob = `${targetUrl} ${form?.action ?? ''} ${form?.text ?? ''} ${fieldText}`.toLowerCase();
  const scores = new Map<FormProfileType, number>();
  const add = (type: FormProfileType, value: number) => scores.set(type, (scores.get(type) ?? 0) + value);
  const hasType = (type: string) => fields.some((field) => field.type === type);

  if (hasType('password')) add('login', 6);
  if (/login|signin|connexion|authent|se connecter/.test(blob)) add('login', 4);
  if (/register|signup|inscription|creer.*compte|create.*account/.test(blob)) add('registration', 6);
  if (/forgot|reset|mot de passe oublie|recuperation/.test(blob)) add('password_recovery', 7);
  if (hasType('search') || /search|recherche|chercher/.test(blob)) add('search', 7);
  if (/newsletter|subscribe|abonn/.test(blob)) add('newsletter', 7);
  if (hasType('file') || /upload|piece jointe|document|fichier/.test(blob)) add('upload', 6);
  if (/appointment|booking|reservation|rendez-vous|rdv|creneau/.test(blob)) add('appointment', 7);
  if (/checkout|payment|paiement|commande|panier|card|carte bancaire/.test(blob)) add('checkout_payment', 8);
  if (/devis|quote|estimation|tarif/.test(blob)) add('quote_request', 7);
  if (/feedback|survey|sondage|avis|questionnaire/.test(blob)) add('feedback_survey', 7);
  if (/contact|message|objet|subject/.test(blob)) add('contact', 5);
  if (fields.some((field) => field.type === 'email') && fields.some((field) => field.type === 'textarea')) {
    add('contact', 3);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const winner = ranked[0] ?? ['generic', 1] as [FormProfileType, number];
  return {
    formType: winner[0],
    confidence: Math.max(0.35, Math.min(0.98, winner[1] / 10)),
    alternatives: ranked.slice(1, 4).map(([type]) => type),
  };
}

function buildFormProfile(
  targetUrl: string,
  fields: DetectedField[],
  rendered: Record<string, unknown> | null,
  form: Record<string, unknown> | null,
  formIdentity: FormIdentity | null,
  candidateMessages: string[],
  riskFlags: string[],
): FormProfile {
  const classification = classifyFormType(targetUrl, fields, form);
  const buttons = Array.isArray(form?.buttons)
    ? form.buttons.filter((button): button is Record<string, unknown> => Boolean(button && typeof button === 'object'))
    : [];
  const nextButtons = buttons.filter((button) =>
    /suivant|next|continuer|continue|etape suivante/i.test(String(button.text ?? ''))
  );
  const backButtons = buttons.filter((button) =>
    /retour|precedent|previous|back/i.test(String(button.text ?? ''))
  );
  const exploration = rendered?.form_exploration && typeof rendered.form_exploration === 'object'
    ? rendered.form_exploration as Record<string, unknown>
    : {};
  const exploredSteps = Array.isArray(exploration.steps)
    ? exploration.steps.filter((step): step is Record<string, unknown> => Boolean(step && typeof step === 'object'))
    : [];
  const observedFields = new Map<string, Record<string, unknown>>();
  fields.forEach((field, index) => observedFields.set(field.selector || `${field.name}:${index}`, {
    ...field,
    field_index: index,
    step_index: 0,
  }));
  exploredSteps.forEach((step, stepIndex) => {
    const stepFields = Array.isArray(step.fields) ? step.fields : [];
    stepFields.forEach((field) => {
      if (!field || typeof field !== 'object') return;
      const fieldFormSelector = String(field.form_selector ?? '');
      if (formIdentity?.selector && fieldFormSelector !== formIdentity.selector) {
        return;
      }
      const key = String(field.selector ?? `${field.name ?? 'field'}:${stepIndex + 1}`);
      if (!observedFields.has(key)) {
        const path = Array.isArray(step.path) ? step.path : [];
        observedFields.set(key, { ...field, field_index: observedFields.size, step_index: path.length });
      }
    });
  });
  const profileSteps = exploredSteps.length > 0
    ? exploredSteps.map((step, index) => {
        const path = Array.isArray(step.path) ? step.path : [];
        const nextInteractions = Array.isArray(step.next_interactions) ? step.next_interactions : [];
        return {
          index,
          label: index === 0 ? 'Formulaire principal' : `Etape exploree ${index + 1}`,
          field_names: Array.isArray(step.fields)
            ? step.fields.map((field) => String(field?.name ?? '')).filter(Boolean)
            : [],
          route_steps: path,
          next_selectors: nextInteractions
            .filter((item) => item?.kind === 'click')
            .map((item) => String(item.selector ?? ''))
            .filter(Boolean),
          back_selectors: nextInteractions
            .filter((item) => /retour|back|previous|precedent/i.test(String(item?.label ?? '')))
            .map((item) => String(item.selector ?? ''))
            .filter(Boolean),
          submit_selector: String(form?.submit_selector ?? ''),
          inferred_multi_step: path.length > 0 || nextInteractions.length > 0,
        };
      })
    : [{
        index: 0,
        label: 'Formulaire principal',
        field_names: fields.map((field) => field.name),
        next_selectors: nextButtons.map((button) => button.selector).filter(Boolean),
        back_selectors: backButtons.map((button) => button.selector).filter(Boolean),
        submit_selector: String(form?.submit_selector ?? ''),
        inferred_multi_step: nextButtons.length > 0,
      }];

  return {
    version: 2,
    form_type: classification.formType,
    confidence: classification.confidence,
    alternative_types: classification.alternatives,
    action_url: String(form?.action ?? ''),
    method: String(form?.method ?? 'GET').toUpperCase(),
    submit_selector: String(form?.submit_selector ?? 'button[type="submit"], input[type="submit"]'),
    fields: [...observedFields.values()],
    steps: profileSteps,
    conditional_rules: fields
      .filter((field) => ['select', 'radio', 'checkbox'].includes(field.type))
      .map((field) => ({
        controller_field: field.name,
        options: field.options ?? [],
        discovery_required: true,
      })),
    success_candidates: candidateMessages
      .filter((message) => /merci|envoy|success|confirme|enregistre/i.test(message))
      .map((message) => ({ type: 'text_present', value: message, weight: 0.35 })),
    failure_candidates: candidateMessages
      .filter((message) => /erreur|invalid|obligatoire|required|refus|echec/i.test(message))
      .map((message) => ({ type: 'text_present', value: message, weight: 0.35 })),
    possible_side_effects: unique([
      ...riskFlags,
      classification.formType === 'checkout_payment' ? 'transaction_financiere_possible' : '',
      classification.formType === 'registration' ? 'creation_compte_possible' : '',
      classification.formType === 'appointment' ? 'reservation_possible' : '',
      classification.formType === 'contact' ? 'message_reel_possible' : '',
    ]),
    route_compiled: true,
    form_identity: formIdentity ?? undefined,
  };
}

function summarizeDetection(
  targetUrl: string,
  staticFields: DetectedField[],
  staticRejectedCandidates: RejectedCandidate[],
  staticHtml: string,
  rendered: Record<string, unknown> | null,
  selectedFormSelector?: string,
): DetectionSummary {
  const confirmation = rendered && typeof rendered.chromium_confirmation === 'object'
    ? (rendered.chromium_confirmation as Record<string, unknown>)
    : null;
  const rejectedCandidates = [...staticRejectedCandidates];
  const renderedCandidates = rankFormCandidates(
    targetUrl,
    rendered,
    rejectedCandidates,
    'rendered',
    selectedFormSelector,
  );
  const confirmedCandidates = rankFormCandidates(
    targetUrl,
    confirmation,
    rejectedCandidates,
    'chromium_confirmed',
    selectedFormSelector,
  );
  const formCandidates = confirmedCandidates.length > 0 ? confirmedCandidates : renderedCandidates;
  const selectedCandidate = formCandidates[0] ?? null;
  const fields = selectedCandidate?.fields ?? staticFields;
  const selectedForm = selectedCandidate?.form ?? null;
  const selectedFormIdentity = selectedCandidate?.identity ?? null;
  const selectionRequired = Boolean(
    !selectedFormSelector &&
    formCandidates.length > 1 &&
    Math.abs(formCandidates[0].score - formCandidates[1].score) <= 2.5
  );
  const sources = ['static'];
  if (rendered) {
    const discoverySources = Array.isArray(rendered.detection_sources) ? rendered.detection_sources.map(String) : [];
    sources.push(...discoverySources);
  }
  if (confirmation) sources.push('chromium_confirmed');

  const renderedFlags = Array.isArray(rendered?.risk_flags) ? rendered.risk_flags.map(String) : [];
  const confirmationFlags = Array.isArray(confirmation?.risk_flags) ? confirmation.risk_flags.map(String) : [];
  const initialRiskFlags = unique([...flagsFromFields(fields), ...renderedFlags, ...confirmationFlags]);

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
  const preliminaryProfile = buildFormProfile(
    targetUrl,
    fields,
    rendered,
    selectedForm,
    selectedFormIdentity,
    candidateMessages,
    initialRiskFlags,
  );
  const exploredFields = normalizeDetectedFields(preliminaryProfile.fields, rejectedCandidates, 'form_exploration');
  const allFieldsByIdentity = new Map<string, DetectedField>();
  [...exploredFields, ...fields].forEach((field, index) => {
    const key = `${normalizedFieldName(field.name)}:${field.type}:${field.type === 'radio' || field.type === 'checkbox' ? field.value ?? '' : ''}` ||
      field.selector ||
      `${field.name}:${index}`;
    const existing = allFieldsByIdentity.get(key);
    if (!existing || (field.visible === true && existing.visible !== true)) {
      allFieldsByIdentity.set(key, field);
    }
  });
  const allFields = [...allFieldsByIdentity.values()];
  const riskFlags = unique([...initialRiskFlags, ...flagsFromFields(allFields)]);
  const blockedReason = riskFlags.some((flag) => REVIEW_RISK_FLAGS.has(flag))
    ? `signal:${riskFlags.filter((flag) => REVIEW_RISK_FLAGS.has(flag)).join(',')}`
    : null;
  const formProfile = buildFormProfile(
    targetUrl,
    allFields,
    rendered,
    selectedForm,
    selectedFormIdentity,
    candidateMessages,
    riskFlags,
  );

  return {
    fields: allFields,
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
      selected_form_identity: selectedFormIdentity,
      selection_required: selectionRequired,
      form_candidates: formCandidates.map((candidate) => ({
        identity: candidate.identity,
        form_type: candidate.form_type,
        score: Math.round(candidate.score * 100) / 100,
        reasons: candidate.reasons,
        fields_count: candidate.fields.length,
        submit_selector: String(candidate.form.submit_selector ?? ''),
      })),
      rejected_candidates: unique(
        [
          ...rejectedCandidates,
          ...(Array.isArray(rendered?.rejected_candidates) ? rendered.rejected_candidates : []),
          ...(Array.isArray(confirmation?.rejected_candidates) ? confirmation.rejected_candidates : []),
        ].map((candidate) => JSON.stringify(candidate)),
      ).map((candidate) => JSON.parse(candidate)),
      form_profile: formProfile,
    },
    formProfile,
    formCandidates,
    selectedFormIdentity,
    selectionRequired,
  };
}

function workflowStatusFor(_summary: DetectionSummary): 'draft' {
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

    const scenario = await getScenarioForWorkflow(serviceClient, workflowRow, body.scenario_id);

    if (!['draft', 'needs_review', 'blocked'].includes(workflowRow.status) && !isAdmin) {
      throw new HttpError(400, 'Seuls les workflows en brouillon ou a valider peuvent etre detectes');
    }

    const staticDetection = await runStaticDetection(workflowRow.target_url);
    const weakStatic = isWeakStaticHtml(staticDetection.html, staticDetection.fields);
    const hasMultipleStaticForms = countStaticForms(staticDetection.html) > 1;
    const rendered = weakStatic || hasMultipleStaticForms
      ? await runRenderedDetection(workflowRow.target_url, true)
      : null;
    const summary = summarizeDetection(
      workflowRow.target_url,
      staticDetection.fields,
      staticDetection.rejectedCandidates,
      staticDetection.html,
      rendered,
      body.selected_form_selector,
    );

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
          status: 'draft',
        })
        .eq('id', workflowId);
      return toJson({ success: false, error: 'Aucun champ de formulaire detecte sur cette URL', ...summary }, 422);
    }

    const [{ data: existingCustomNodes, error: customNodesError }, { data: existingCustomEdges, error: customEdgesError }] =
      await Promise.all([
        serviceClient
          .from('workflow_nodes')
          .select('id')
          .eq('scenario_id', scenario.id)
          .eq('type', 'condition')
          .limit(1),
        serviceClient
          .from('workflow_edges')
          .select('id')
          .eq('scenario_id', scenario.id)
          .neq('branch_key', 'default')
          .limit(1),
      ]);
    if (customNodesError) throw new HttpError(500, customNodesError.message);
    if (customEdgesError) throw new HttpError(500, customEdgesError.message);
    if (!body.force_reset && ((existingCustomNodes?.length ?? 0) > 0 || (existingCustomEdges?.length ?? 0) > 0)) {
      throw new HttpError(
        409,
        'Ce scenario contient des branches personnalisees. Dupliquez-le ou confirmez une reinitialisation explicite.',
      );
    }

    await serviceClient.from('workflow_edges').delete().eq('scenario_id', scenario.id);
    await serviceClient.from('workflow_nodes').delete().eq('scenario_id', scenario.id);

    const profileFieldSteps = new Map(
      summary.formProfile.fields.map((field) => [
        String(field.selector ?? ''),
        Number.isFinite(Number(field.step_index)) ? Number(field.step_index) : 0,
      ]),
    );
    const orderedFields = summary.fields
      .map((field, originalIndex) => ({
        field: {
          ...field,
          step_index: profileFieldSteps.get(field.selector) ?? field.step_index ?? 0,
        },
        originalIndex,
      }))
      .sort((left, right) =>
        Number(left.field.step_index ?? 0) - Number(right.field.step_index ?? 0) ||
        left.originalIndex - right.originalIndex
      )
      .map((item) => item.field);
    summary.fields = orderedFields;

    const deepestRoute = summary.formProfile.steps
      .map((step) => Array.isArray(step.route_steps) ? step.route_steps : [])
      .sort((left, right) => right.length - left.length)[0] ?? [];
    const sequenceNodes: Array<Record<string, unknown>> = [];
    let nextOrder = 1;
    const maxStepIndex = Math.max(
      0,
      ...orderedFields.map((field) => Number(field.step_index ?? 0)),
      deepestRoute.length,
    );
    for (let stepIndex = 0; stepIndex <= maxStepIndex; stepIndex += 1) {
      orderedFields.forEach((field, fieldIndex) => {
        if (Number(field.step_index ?? 0) !== stepIndex) return;
        sequenceNodes.push({
          workflow_id: workflowId,
          scenario_id: scenario.id,
          type: nodeTypeForField(field),
          order_index: nextOrder,
          position_x: 360,
          position_y: 40 + nextOrder * 100,
          config: {
            label: nodeLabelForField(field),
            detected_field_index: fieldIndex,
            step_index: stepIndex,
          },
        });
        nextOrder += 1;
      });

      const interaction = deepestRoute[stepIndex];
      if (!interaction || typeof interaction !== 'object' || interaction.kind !== 'click') continue;
      const selector = String(interaction.selector ?? '');
      if (!selector) continue;
      sequenceNodes.push({
        workflow_id: workflowId,
        scenario_id: scenario.id,
        type: 'click',
        order_index: nextOrder,
        position_x: 360,
        position_y: 40 + nextOrder * 100,
        config: {
          selector,
          label: String(interaction.label ?? 'Continuer'),
          discovery_route: true,
        },
      });
      nextOrder += 1;
      sequenceNodes.push({
        workflow_id: workflowId,
        scenario_id: scenario.id,
        type: 'wait',
        order_index: nextOrder,
        position_x: 360,
        position_y: 40 + nextOrder * 100,
        config: {
          duration_ms: 500,
          label: 'Attendre l etape suivante',
          discovery_route: true,
        },
      });
      nextOrder += 1;
    }

    const nodesToInsert = [
      {
        workflow_id: workflowId,
        scenario_id: scenario.id,
        type: 'trigger',
        order_index: 0,
        position_x: 360,
        position_y: 40,
        config: { url: workflowRow.target_url, label: 'Ouvrir la page' },
      },
      ...sequenceNodes,
      {
        workflow_id: workflowId,
        scenario_id: scenario.id,
        type: 'submit',
        order_index: nextOrder,
        position_x: 360,
        position_y: 40 + nextOrder * 100,
        config: {
          selector: summary.formProfile.submit_selector || 'button[type="submit"], input[type="submit"], button:not([type])',
          form_selector: summary.selectedFormIdentity?.selector ?? '',
          form_action: summary.selectedFormIdentity?.action_url ?? summary.formProfile.action_url,
          form_method: summary.selectedFormIdentity?.method ?? summary.formProfile.method,
          field_fingerprint: summary.selectedFormIdentity?.field_fingerprint ?? [],
          wait_for: '',
          label: 'Soumettre',
        },
      },
    ];

    const { data: insertedNodes, error: nodesError } = await serviceClient
      .from('workflow_nodes')
      .insert(nodesToInsert)
      .select('*');

    if (nodesError) {
      throw new HttpError(500, `Erreur insertion noeuds: ${nodesError.message}`);
    }

    const fieldNodes = (insertedNodes ?? [])
      .filter((node) => Number.isInteger(Number(node.config?.detected_field_index)))
      .sort((a, b) => Number(a.config.detected_field_index) - Number(b.config.detected_field_index));

    const fieldsToInsert = summary.fields.map((field, index) => ({
      node_id: fieldNodes[index].id,
      workflow_id: workflowId,
      scenario_id: scenario.id,
      field_name: field.name,
      field_type: field.type,
      field_label: field.label,
      field_selector: field.selector,
      placeholder: field.placeholder,
      required: field.required,
      is_sensitive: isSensitiveField(field),
    }));

    const { data: insertedFields, error: fieldsError } = await serviceClient
      .from('workflow_form_fields')
      .insert(fieldsToInsert)
      .select('*');

    if (fieldsError) {
      throw new HttpError(500, `Erreur insertion champs: ${fieldsError.message}`);
    }

    for (let index = 0; index < fieldNodes.length; index += 1) {
      const field = insertedFields?.[index];
      if (!field) continue;

      const { error: updateNodeError } = await serviceClient
        .from('workflow_nodes')
        .update({
          config: {
            field_id: field.id,
            selector: field.field_selector,
            label: nodeLabelForField(summary.fields[index]),
            step_index: summary.fields[index].step_index ?? 0,
          },
        })
        .eq('id', fieldNodes[index].id);

      if (updateNodeError) {
        throw new HttpError(500, `Erreur liaison noeud/champ: ${updateNodeError.message}`);
      }
    }

    const allNodes = (insertedNodes ?? []).sort((a, b) => a.order_index - b.order_index);
    const edgesToInsert = allNodes.slice(0, -1).map((node, index) => ({
      workflow_id: workflowId,
      scenario_id: scenario.id,
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

    const { error: updateScenarioError } = await serviceClient
      .from('form_test_scenarios')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', scenario.id);

    if (updateScenarioError) {
      throw new HttpError(500, `Erreur mise a jour scenario: ${updateScenarioError.message}`);
    }

    if (summary.blockedReason) {
      await serviceClient.from('notifications').insert({
        user_id: workflowRow.created_by,
        title: 'Signal detecte sur le formulaire',
        message: `Le workflow reste executable. Signal detecte: ${summary.blockedReason.replace(/^signal:/, '')}.`,
        type: 'info',
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
      form_profile: summary.formProfile,
      form_candidates: summary.formCandidates.map((candidate) => ({
        identity: candidate.identity,
        form_type: candidate.form_type,
        score: candidate.score,
        reasons: candidate.reasons,
        fields_count: candidate.fields.length,
      })),
      selected_form_identity: summary.selectedFormIdentity,
      selection_required: summary.selectionRequired,
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
