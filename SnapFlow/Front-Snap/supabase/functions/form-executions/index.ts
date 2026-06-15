// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  createServiceClient,
  getAuthUserId,
  HttpError,
  toJson,
} from '../_shared/formTester.ts';

interface ExecutionBody {
  action?: 'get' | 'list';
  execution_id?: string;
  workflow_id?: string;
  limit?: number;
}

const ARTIFACT_BUCKET = Deno.env.get('FORM_EXECUTOR_ARTIFACT_BUCKET') || 'form-test-artifacts';
const SIGNED_URL_TTL_SECONDS = 15 * 60;
const INTERNAL_STORAGE_HOSTS = new Set(['kong', 'host.docker.internal', 'supabase_kong_snapflow']);

const EXECUTION_SOURCES = new Set([
  'pending_executor',
  'chromium',
  'obscura',
  'simulated_legacy',
  'executor_unavailable',
  'legacy_unknown',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function inferExecutionSource(execution: Record<string, unknown>): string {
  const source = typeof execution.execution_source === 'string' ? execution.execution_source.trim() : '';
  if (EXECUTION_SOURCES.has(source)) return source;

  const status = typeof execution.status === 'string' ? execution.status : '';
  if (['queued', 'running', 'stopping'].includes(status)) return 'pending_executor';

  const network = asRecord(execution.network_summary);
  const trace = asList(execution.step_trace).filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  );
  if (network.mode === 'simulated' || trace.some((step) => step.source === 'simulated')) {
    return 'simulated_legacy';
  }

  const errorMessage = typeof execution.error_message === 'string' ? execution.error_message : '';
  if (
    network.mode === 'unavailable' ||
    /(executor|moteur|browser|chromium|obscura).*(indisponible|unavailable|failed|error)/i.test(errorMessage)
  ) {
    return 'executor_unavailable';
  }

  const hasBrowserEvidence =
    typeof execution.final_url === 'string' ||
    typeof execution.screenshot_url === 'string' ||
    typeof network.requests === 'number' ||
    asList(execution.steps).length > 0;
  return hasBrowserEvidence ? 'chromium' : 'legacy_unknown';
}

function normalizeExecution(execution: Record<string, unknown>) {
  const source = inferExecutionSource(execution);
  const executedAt =
    typeof execution.executed_at === 'string' ? execution.executed_at : new Date(0).toISOString();
  const queuedAt = typeof execution.queued_at === 'string' ? execution.queued_at : executedAt;
  const startedAt = typeof execution.started_at === 'string' ? execution.started_at : null;
  const completedAt = typeof execution.completed_at === 'string' ? execution.completed_at : null;
  const queueWaitMs = startedAt
    ? Math.max(0, new Date(startedAt).getTime() - new Date(queuedAt).getTime())
    : null;
  const executionDurationMs =
    startedAt && completedAt
      ? Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime())
      : typeof execution.duration_ms === 'number'
      ? execution.duration_ms
      : null;
  const totalElapsedMs = completedAt
    ? Math.max(0, new Date(completedAt).getTime() - new Date(queuedAt).getTime())
    : null;
  return {
    ...execution,
    execution_source: source,
    execution_mode: execution.execution_mode ?? 'full',
    execution_engine:
      execution.execution_engine ??
      (source === 'obscura' ? 'obscura' : source === 'simulated_legacy' ? 'simulated_legacy' : 'chromium'),
    environment: execution.environment ?? 'legacy',
    queued_at: queuedAt,
    requested_by: execution.requested_by ?? execution.executed_by ?? null,
    failure_reason:
      execution.failure_reason ??
      (source === 'legacy_unknown' ? 'legacy_execution_without_provenance' : null),
    summary: asRecord(execution.summary),
    assertions: asList(execution.assertions),
    step_trace: asList(execution.step_trace),
    network_summary: asRecord(execution.network_summary),
    progress_completed:
      typeof execution.progress_completed === 'number' ? execution.progress_completed : 0,
    progress_total:
      typeof execution.progress_total === 'number' ? execution.progress_total : 0,
    queue_wait_ms: queueWaitMs,
    execution_duration_ms: executionDurationMs,
    total_elapsed_ms: totalElapsedMs,
  };
}

function artifactMetadata(artifact: Record<string, unknown>): Record<string, unknown> {
  return asRecord(artifact.metadata_redacted);
}

function isPreviewableArtifact(artifact: Record<string, unknown>): boolean {
  const metadata = artifactMetadata(artifact);
  return (
    metadata.storage_backend === 'supabase' &&
    metadata.upload_status === 'available'
  );
}

function normalizeArtifact(artifact: Record<string, unknown>, signedUrl: string | null = null) {
  const metadata = artifactMetadata(artifact);
  const storageBackend = metadata.storage_backend === 'supabase' ? 'supabase' : 'local';
  const uploadStatus =
    metadata.upload_status === 'available'
      ? 'available'
      : metadata.upload_status === 'failed'
      ? 'failed'
      : 'local_only';
  let signedPath: string | null = null;
  if (signedUrl) {
    try {
      const parsed = new URL(signedUrl);
      signedPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      signedPath = signedUrl.startsWith('/') ? signedUrl : null;
    }
  }
  return {
    ...artifact,
    storage_backend: storageBackend,
    upload_status: uploadStatus,
    previewable: Boolean(signedUrl) && uploadStatus === 'available',
    signed_url: signedUrl,
    signed_path: signedPath,
  };
}

function publicSupabaseOrigin(req: Request): string | null {
  const configured = Deno.env.get('FORM_TESTER_PUBLIC_STORAGE_ORIGIN')?.trim();
  if (configured) return new URL(configured).origin;

  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedHost) {
    const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http';
    return `${forwardedProto}://${forwardedHost}`;
  }

  const requestUrl = new URL(req.url);
  if (!INTERNAL_STORAGE_HOSTS.has(requestUrl.hostname)) return requestUrl.origin;

  const serviceUrl = Deno.env.get('SUPABASE_URL')?.trim();
  if (serviceUrl) {
    const parsed = new URL(serviceUrl);
    if (!INTERNAL_STORAGE_HOSTS.has(parsed.hostname)) return parsed.origin;
  }
  return null;
}

function exposeSignedUrl(signedUrl: string, publicOrigin: string | null): string {
  if (!publicOrigin) return signedUrl;
  const parsed = new URL(signedUrl);
  if (!INTERNAL_STORAGE_HOSTS.has(parsed.hostname)) return signedUrl;
  return `${publicOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function signArtifactGroup(
  serviceClient: ReturnType<typeof createServiceClient>,
  artifacts: Array<Record<string, unknown>>,
  download: boolean,
  publicOrigin: string | null,
): Promise<Map<string, string>> {
  const paths = artifacts
    .map((artifact) => artifact.storage_path)
    .filter((path): path is string => typeof path === 'string');
  if (paths.length === 0) return new Map();

  const { data, error } = await serviceClient.storage
    .from(ARTIFACT_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS, { download });
  if (error) return new Map();

  return new Map(
    (data ?? [])
      .filter((item) => typeof item?.path === 'string' && typeof item?.signedUrl === 'string')
      .map((item) => [item.path, exposeSignedUrl(item.signedUrl, publicOrigin)]),
  );
}

async function signArtifacts(
  serviceClient: ReturnType<typeof createServiceClient>,
  artifacts: Array<Record<string, unknown>>,
  publicOrigin: string | null,
) {
  const eligible = artifacts.filter(
    (artifact) => isPreviewableArtifact(artifact) && typeof artifact.storage_path === 'string',
  );
  const downloads = eligible.filter((artifact) => artifact.artifact_type === 'html_snapshot');
  const previews = eligible.filter((artifact) => artifact.artifact_type !== 'html_snapshot');
  const [previewUrls, downloadUrls] = await Promise.all([
    signArtifactGroup(serviceClient, previews, false, publicOrigin),
    signArtifactGroup(serviceClient, downloads, true, publicOrigin),
  ]);

  return artifacts.map((artifact) => {
    const path = typeof artifact.storage_path === 'string' ? artifact.storage_path : '';
    return normalizeArtifact(artifact, previewUrls.get(path) ?? downloadUrls.get(path) ?? null);
  });
}

function previewArtifactIds(
  executions: Array<Record<string, unknown>>,
  steps: Array<Record<string, unknown>>,
  artifacts: Array<Record<string, unknown>>,
): Set<string> {
  const selected = new Set<string>();
  for (const execution of executions) {
    const executionArtifacts = artifacts.filter(
      (artifact) => artifact.execution_id === execution.id && artifact.artifact_type === 'screenshot',
    );
    const latest = executionArtifacts.at(-1);
    if (typeof latest?.id === 'string') selected.add(latest.id);

    const failedStepIds = new Set(
      steps
        .filter(
          (step) =>
            step.execution_id === execution.id &&
            ['failed', 'error', 'blocked', 'inconclusive'].includes(String(step.status)),
        )
        .map((step) => step.id),
    );
    const failureArtifact = executionArtifacts.find((artifact) =>
      failedStepIds.has(artifact.step_result_id),
    );
    if (typeof failureArtifact?.id === 'string') selected.add(failureArtifact.id);
  }
  return selected;
}

async function getIsAdmin(serviceClient: ReturnType<typeof createServiceClient>, userId: string): Promise<boolean> {
  const { data, error } = await serviceClient.rpc('has_role', { _user_id: userId, _role: 'admin' });
  if (error) throw new HttpError(500, error.message);
  return Boolean(data);
}

async function requireWorkflowAccess(
  serviceClient: ReturnType<typeof createServiceClient>,
  workflowId: string,
  userId: string,
  isAdmin: boolean,
) {
  const { data: workflow, error } = await serviceClient
    .from('form_workflows')
    .select('id, created_by, org_id')
    .eq('id', workflowId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!workflow) throw new HttpError(404, 'Workflow non trouve');
  if (!isAdmin && workflow.created_by !== userId && workflow.org_id !== userId) {
    throw new HttpError(403, 'Acces refuse');
  }
  return workflow;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const serviceClient = createServiceClient();
    const storagePublicOrigin = publicSupabaseOrigin(req);
    const userId = await getAuthUserId(req);
    const isAdmin = await getIsAdmin(serviceClient, userId);
    const body = (await req.json()) as ExecutionBody;
    const action = body.action ?? 'get';

    if (action === 'list') {
      if (!body.workflow_id) throw new HttpError(400, 'workflow_id requis');
      await requireWorkflowAccess(serviceClient, body.workflow_id, userId, isAdmin);
      const limit = Math.min(Math.max(body.limit ?? 50, 1), 200);
      const { data: executions, error } = await serviceClient
        .from('workflow_results')
        .select('*')
        .eq('workflow_id', body.workflow_id)
        .order('executed_at', { ascending: false })
        .limit(limit);
      if (error) throw new HttpError(500, error.message);

      const executionIds = (executions ?? []).map((execution) => execution.id);
      if (executionIds.length === 0) return toJson({ executions: [] });

      const [
        { data: steps, error: stepsError },
        { data: logs, error: logsError },
        { data: artifacts, error: artifactsError },
        { data: commands, error: commandsError },
      ] = await Promise.all([
        serviceClient
          .from('workflow_step_results')
          .select('*')
          .in('execution_id', executionIds)
          .order('sequence_number', { ascending: true }),
        serviceClient
          .from('workflow_logs')
          .select('*')
          .in('execution_id', executionIds)
          .order('created_at', { ascending: true }),
        serviceClient
          .from('workflow_artifacts')
          .select('*')
          .in('execution_id', executionIds)
          .order('created_at', { ascending: true }),
        serviceClient
          .from('workflow_execution_commands')
          .select('*')
          .in('execution_id', executionIds)
          .order('requested_at', { ascending: true }),
      ]);
      if (stepsError) throw new HttpError(500, stepsError.message);
      if (logsError) throw new HttpError(500, logsError.message);
      if (artifactsError) throw new HttpError(500, artifactsError.message);
      if (commandsError) throw new HttpError(500, commandsError.message);

      const normalizedExecutions = (executions ?? []) as Array<Record<string, unknown>>;
      const normalizedSteps = (steps ?? []) as Array<Record<string, unknown>>;
      const normalizedArtifacts = (artifacts ?? []) as Array<Record<string, unknown>>;
      const selectedPreviewIds = previewArtifactIds(
        normalizedExecutions,
        normalizedSteps,
        normalizedArtifacts,
      );
      const selectedPreviewArtifacts = normalizedArtifacts.filter((artifact) =>
        selectedPreviewIds.has(String(artifact.id)),
      );
      const signedSelectedArtifacts = await signArtifacts(
        serviceClient,
        selectedPreviewArtifacts,
        storagePublicOrigin,
      );
      const signedById = new Map(
        signedSelectedArtifacts.map((artifact) => [String(artifact.id), artifact]),
      );
      const signedPreviewArtifacts = normalizedArtifacts.map(
        (artifact) => signedById.get(String(artifact.id)) ?? normalizeArtifact(artifact),
      );

      const scenarioIds = [
        ...new Set(normalizedExecutions.map((execution) => execution.scenario_id).filter(Boolean)),
      ];
      const { data: scenarios, error: scenariosError } = scenarioIds.length
        ? await serviceClient
            .from('form_test_scenarios')
            .select('id, name, description, expected_outcome, case_definition')
            .in('id', scenarioIds)
        : { data: [], error: null };
      if (scenariosError) throw new HttpError(500, scenariosError.message);

      return toJson({
        executions: normalizedExecutions.map((execution) => ({
          ...normalizeExecution(execution as Record<string, unknown>),
          scenario: (scenarios ?? []).find((scenario) => scenario.id === execution.scenario_id) ?? null,
          steps: normalizedSteps.filter((step) => step.execution_id === execution.id),
          logs: (logs ?? []).filter((log) => log.execution_id === execution.id),
          artifacts: signedPreviewArtifacts.filter((artifact) => artifact.execution_id === execution.id),
          commands: (commands ?? []).filter((command) => command.execution_id === execution.id),
        })),
      });
    }

    if (!body.execution_id) throw new HttpError(400, 'execution_id requis');
    const { data: execution, error: executionError } = await serviceClient
      .from('workflow_results')
      .select('*')
      .eq('id', body.execution_id)
      .maybeSingle();
    if (executionError) throw new HttpError(500, executionError.message);
    if (!execution) throw new HttpError(404, 'Execution non trouvee');

    await requireWorkflowAccess(serviceClient, execution.workflow_id, userId, isAdmin);

    const [
      { data: steps, error: stepsError },
      { data: logs, error: logsError },
      { data: artifacts, error: artifactsError },
      { data: commands, error: commandsError },
    ] = await Promise.all([
      serviceClient
        .from('workflow_step_results')
        .select('*')
        .eq('execution_id', execution.id)
        .order('sequence_number', { ascending: true })
        .order('retry_count', { ascending: true }),
      serviceClient
        .from('workflow_logs')
        .select('*')
        .eq('execution_id', execution.id)
        .order('created_at', { ascending: true }),
      serviceClient
        .from('workflow_artifacts')
        .select('*')
        .eq('execution_id', execution.id)
        .order('created_at', { ascending: true }),
      serviceClient
        .from('workflow_execution_commands')
        .select('*')
        .eq('execution_id', execution.id)
        .order('requested_at', { ascending: true }),
    ]);

    if (stepsError) throw new HttpError(500, stepsError.message);
    if (logsError) throw new HttpError(500, logsError.message);
    if (artifactsError) throw new HttpError(500, artifactsError.message);
    if (commandsError) throw new HttpError(500, commandsError.message);

    const artifactsWithUrls = await signArtifacts(
      serviceClient,
      (artifacts ?? []) as Array<Record<string, unknown>>,
      storagePublicOrigin,
    );
    const { data: scenario, error: scenarioError } = execution.scenario_id
      ? await serviceClient
          .from('form_test_scenarios')
          .select('id, name, description, expected_outcome, case_definition')
          .eq('id', execution.scenario_id)
          .maybeSingle()
      : { data: null, error: null };
    if (scenarioError) throw new HttpError(500, scenarioError.message);

    return toJson({
      ...normalizeExecution(execution as Record<string, unknown>),
      scenario,
      steps: steps ?? [],
      logs: logs ?? [],
      artifacts: artifactsWithUrls,
      commands: commands ?? [],
    });
  } catch (error) {
    if (error instanceof HttpError) return toJson({ error: error.message }, error.status);
    return toJson({ error: error instanceof Error ? error.message : 'Erreur serveur' }, 500);
  }
});
