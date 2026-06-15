import { describe, expect, it } from 'vitest';
import { normalizeWorkflowExecution } from '@/lib/form-tester/normalizeExecution';

describe('normalizeWorkflowExecution', () => {
  it('classifies an empty historical error without claiming a real browser source', () => {
    const result = normalizeWorkflowExecution({
      id: 'legacy-error',
      workflow_id: 'workflow-1',
      status: 'error',
      executed_at: '2026-06-08T04:42:02Z',
      duration_ms: 0,
      assertions: [],
    });

    expect(result.execution_source).toBe('legacy_unknown');
    expect(result.failure_reason).toBe('legacy_execution_without_provenance');
    expect(result.duration_ms).toBe(0);
    expect(result.steps).toEqual([]);
    expect(result.logs).toEqual([]);
  });

  it('recognizes legacy simulations from their evidence even when source is missing', () => {
    const result = normalizeWorkflowExecution({
      id: 'legacy-simulation',
      workflow_id: 'workflow-1',
      status: 'needs_review',
      executed_at: '2026-06-08T04:17:35Z',
      step_trace: [{ type: 'submit', source: 'simulated', status: 'skipped' }],
      network_summary: { mode: 'simulated', requests: 0 },
    });

    expect(result.execution_source).toBe('simulated_legacy');
    expect(result.execution_engine).toBe('simulated_legacy');
  });

  it('recognizes queued Phase 2 rows without a serialized source', () => {
    const result = normalizeWorkflowExecution({
      id: 'queued',
      workflow_id: 'workflow-1',
      status: 'queued',
      executed_at: '2026-06-08T04:45:00Z',
      progress_total: 12,
    });

    expect(result.execution_source).toBe('pending_executor');
    expect(result.progress_total).toBe(12);
  });

  it('does not trust malformed source labels from older API responses', () => {
    const result = normalizeWorkflowExecution({
      id: 'bad-source',
      workflow_id: 'workflow-1',
      status: 'error',
      execution_source: 'Source inconnue',
      executed_at: '2026-06-08T07:52:52Z',
      duration_ms: 0,
      assertions: [],
    });

    expect(result.execution_source).toBe('legacy_unknown');
    expect(result.failure_reason).toBe('legacy_execution_without_provenance');
  });
});
