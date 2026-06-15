import type {
  AssertionResult,
  ExecutionEngine,
  ExecutionMode,
  ExecutionSource,
  ExecutionStatus,
  WorkflowExecutionDetail,
} from './types';

const EXECUTION_STATUSES = new Set<ExecutionStatus>([
  'queued',
  'running',
  'stopping',
  'passed',
  'failed',
  'error',
  'blocked',
  'cancelled',
  'pass',
  'fail',
  'needs_review',
  'inconclusive',
]);

const EXECUTION_SOURCES = new Set<ExecutionSource>([
  'pending_executor',
  'chromium',
  'obscura',
  'simulated_legacy',
  'executor_unavailable',
  'legacy_unknown',
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function publicArtifactUrl(value: unknown, signedPath?: unknown): string | null {
  const signedUrl = text(value);
  const relativePath = text(signedPath);
  const publicSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!signedUrl && relativePath && publicSupabaseUrl) {
    return `${new URL(publicSupabaseUrl).origin}${relativePath.startsWith('/') ? '' : '/'}${relativePath}`;
  }
  if (!signedUrl) return null;
  try {
    const parsed = new URL(signedUrl);
    if (!['kong', 'host.docker.internal', 'supabase_kong_snapflow'].includes(parsed.hostname)) {
      return signedUrl;
    }
    if (!publicSupabaseUrl) return signedUrl;
    const publicOrigin = new URL(publicSupabaseUrl).origin;
    return `${publicOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return signedUrl;
  }
}

function elapsedMs(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const value = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function inferSource(row: Record<string, unknown>): ExecutionSource {
  const source = text(row.execution_source);
  if (source && EXECUTION_SOURCES.has(source as ExecutionSource)) return source as ExecutionSource;

  const status = text(row.status);
  if (status && ['queued', 'running', 'stopping'].includes(status)) return 'pending_executor';

  const network = record(row.network_summary);
  const trace = list<Record<string, unknown>>(row.step_trace);
  if (
    network.mode === 'simulated' ||
    trace.some((step) => step.source === 'simulated')
  ) {
    return 'simulated_legacy';
  }

  const errorMessage = text(row.error_message) ?? '';
  if (
    network.mode === 'unavailable' ||
    /(executor|moteur|browser|chromium|obscura).*(indisponible|unavailable|failed|error)/i.test(errorMessage)
  ) {
    return 'executor_unavailable';
  }

  const hasBrowserEvidence =
    Boolean(text(row.final_url)) ||
    Boolean(text(row.screenshot_url)) ||
    typeof network.requests === 'number' ||
    list(row.steps).length > 0;
  return hasBrowserEvidence ? 'chromium' : 'legacy_unknown';
}

function inferEngine(source: ExecutionSource, value: unknown): ExecutionEngine {
  if (value === 'chromium' || value === 'obscura' || value === 'simulated_legacy') return value;
  if (source === 'obscura') return 'obscura';
  if (source === 'simulated_legacy') return 'simulated_legacy';
  return 'chromium';
}

export function normalizeWorkflowExecution(value: unknown): WorkflowExecutionDetail {
  const row = record(value);
  const source = inferSource(row);
  const executedAt = text(row.executed_at) ?? new Date(0).toISOString();
  const steps = list<WorkflowExecutionDetail['steps'][number]>(row.steps);
  const trace = list<Record<string, unknown>>(row.step_trace);
  const progressTotal =
    numberOrNull(row.progress_total) ??
    (steps.length > 0 ? steps.length : trace.length);
  const statusValue = text(row.status);
  const status: ExecutionStatus =
    statusValue && EXECUTION_STATUSES.has(statusValue as ExecutionStatus)
      ? (statusValue as ExecutionStatus)
      : 'error';
  const queuedAt = text(row.queued_at) ?? executedAt;
  const startedAt = text(row.started_at);
  const completedAt = text(row.completed_at);
  const artifacts = list<WorkflowExecutionDetail['artifacts'][number]>(row.artifacts).map(
    (artifact) => ({
      ...artifact,
      signed_url: publicArtifactUrl(artifact.signed_url, artifact.signed_path),
    }),
  );

  return {
    id: text(row.id) ?? 'unknown-execution',
    workflow_id: text(row.workflow_id) ?? '',
    scenario_id: text(row.scenario_id),
    scenario_version_id: text(row.scenario_version_id),
    executed_by: text(row.executed_by),
    executed_at: executedAt,
    status,
    duration_ms: numberOrNull(row.duration_ms),
    assertions: list<AssertionResult>(row.assertions),
    screenshot_url: text(row.screenshot_url),
    error_message: text(row.error_message),
    audit_run_id: text(row.audit_run_id),
    step_trace: trace,
    final_url: text(row.final_url),
    network_summary: record(row.network_summary),
    execution_source: source,
    execution_mode: (text(row.execution_mode) as ExecutionMode | null) ?? 'full',
    execution_engine: inferEngine(source, row.execution_engine),
    environment: text(row.environment) ?? 'legacy',
    start_node_id: text(row.start_node_id),
    current_node_id: text(row.current_node_id),
    queued_at: queuedAt,
    started_at: startedAt,
    completed_at: completedAt,
    stopped_at: text(row.stopped_at),
    heartbeat_at: text(row.heartbeat_at),
    requested_by: text(row.requested_by) ?? text(row.executed_by),
    failure_reason:
      text(row.failure_reason) ??
      (source === 'legacy_unknown' ? 'legacy_execution_without_provenance' : null),
    summary: record(row.summary),
    progress_completed: numberOrNull(row.progress_completed) ?? 0,
    progress_total: Math.max(0, progressTotal),
    queue_wait_ms: numberOrNull(row.queue_wait_ms) ?? elapsedMs(queuedAt, startedAt),
    execution_duration_ms:
      numberOrNull(row.execution_duration_ms) ??
      elapsedMs(startedAt, completedAt) ??
      numberOrNull(row.duration_ms),
    total_elapsed_ms: numberOrNull(row.total_elapsed_ms) ?? elapsedMs(queuedAt, completedAt),
    campaign_id: text(row.campaign_id),
    campaign_role:
      row.campaign_role === 'baseline' || row.campaign_role === 'case'
        ? row.campaign_role
        : null,
    depends_on_execution_id: text(row.depends_on_execution_id),
    evaluation_mode:
      row.evaluation_mode === 'baseline_comparison' ||
      row.evaluation_mode === 'explicit_oracle' ||
      row.evaluation_mode === 'exploratory'
        ? row.evaluation_mode
        : null,
    scenario: record(row.scenario).id
      ? (record(row.scenario) as WorkflowExecutionDetail['scenario'])
      : null,
    steps,
    logs: list(row.logs),
    artifacts,
    commands: list(row.commands),
  };
}
