// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }
  return value;
}

export function createServiceClient() {
  return createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getAuthUserId(req: Request): Promise<string> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'Non autorisé');
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    throw new HttpError(401, 'Non autorisé');
  }

  const anonClient = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
    error,
  } = await anonClient.auth.getUser(token);

  if (error || !user) {
    throw new HttpError(401, 'Non autorisé');
  }

  return user.id;
}

export async function ensureAdmin(serviceClient: ReturnType<typeof createServiceClient>, userId: string): Promise<void> {
  const { data: isAdmin, error } = await serviceClient.rpc('has_role', {
    _user_id: userId,
    _role: 'admin',
  });

  if (error) {
    throw new HttpError(500, `Erreur de vérification de rôle: ${error.message}`);
  }

  if (!isAdmin) {
    throw new HttpError(403, 'Accès refusé');
  }
}

export async function readJsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Corps JSON invalide');
  }
}

export function toJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function normalizeTargetUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

export type WorkflowStatus = 'draft' | 'needs_review' | 'pending' | 'approved' | 'executed' | 'blocked';

export function isWorkflowStatus(value: string): value is WorkflowStatus {
  return (
    value === 'draft' ||
    value === 'needs_review' ||
    value === 'pending' ||
    value === 'approved' ||
    value === 'executed' ||
    value === 'blocked'
  );
}

export type ScenarioVersionStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export interface FormTestScenarioRow {
  id: string;
  workflow_id: string;
  org_id: string;
  created_by: string;
  name: string;
  status: ScenarioVersionStatus;
  is_default: boolean;
}

export async function ensureDefaultScenario(
  serviceClient: ReturnType<typeof createServiceClient>,
  workflow: {
    id: string;
    org_id: string;
    created_by: string;
    name?: string;
  },
): Promise<FormTestScenarioRow> {
  const { data: existing, error: existingError } = await serviceClient
    .from('form_test_scenarios')
    .select('*')
    .eq('workflow_id', workflow.id)
    .eq('is_default', true)
    .maybeSingle();

  if (existingError) {
    throw new HttpError(500, `Erreur chargement scenario: ${existingError.message}`);
  }

  if (existing) return existing as FormTestScenarioRow;

  const { data: created, error: createError } = await serviceClient
    .from('form_test_scenarios')
    .insert({
      workflow_id: workflow.id,
      org_id: workflow.org_id,
      created_by: workflow.created_by,
      name: 'Scenario principal',
      description: `Scenario principal pour ${workflow.name ?? 'le workflow'}`,
      status: 'draft',
      is_default: true,
    })
    .select('*')
    .single();

  if (createError) {
    const { data: racedScenario, error: racedError } = await serviceClient
      .from('form_test_scenarios')
      .select('*')
      .eq('workflow_id', workflow.id)
      .eq('is_default', true)
      .maybeSingle();

    if (racedError || !racedScenario) {
      throw new HttpError(500, `Erreur creation scenario: ${createError.message}`);
    }
    return racedScenario as FormTestScenarioRow;
  }

  return created as FormTestScenarioRow;
}

export async function getScenarioForWorkflow(
  serviceClient: ReturnType<typeof createServiceClient>,
  workflow: {
    id: string;
    org_id: string;
    created_by: string;
    name?: string;
  },
  scenarioId?: string | null,
): Promise<FormTestScenarioRow> {
  if (!scenarioId) return ensureDefaultScenario(serviceClient, workflow);

  const { data: scenario, error } = await serviceClient
    .from('form_test_scenarios')
    .select('*')
    .eq('id', scenarioId)
    .eq('workflow_id', workflow.id)
    .maybeSingle();

  if (error) throw new HttpError(500, `Erreur chargement scenario: ${error.message}`);
  if (!scenario) throw new HttpError(404, 'Scenario introuvable pour ce workflow');
  return scenario as FormTestScenarioRow;
}
