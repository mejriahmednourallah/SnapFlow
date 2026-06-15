import { describe, expect, it } from 'vitest';
import {
  executionBusinessState,
  expectedBehaviorFromLegacy,
} from '@/lib/form-tester/businessVerdict';
import type { WorkflowExecutionDetail } from '@/lib/form-tester/types';

function execution(
  expectedOutcome: 'success' | 'validation_error',
  summary: Record<string, unknown>,
): WorkflowExecutionDetail {
  return {
    id: 'execution-1',
    workflow_id: 'workflow-1',
    scenario_id: 'scenario-1',
    scenario_version_id: 'version-1',
    executed_by: null,
    executed_at: new Date().toISOString(),
    status: 'passed',
    duration_ms: 100,
    assertions: [],
    screenshot_url: null,
    error_message: null,
    audit_run_id: null,
    step_trace: [],
    final_url: 'https://example.com',
    network_summary: {},
    execution_source: 'chromium',
    execution_mode: 'full',
    execution_engine: 'chromium',
    environment: 'default',
    start_node_id: null,
    current_node_id: null,
    queued_at: null,
    started_at: null,
    completed_at: null,
    stopped_at: null,
    heartbeat_at: null,
    requested_by: null,
    failure_reason: null,
    summary,
    progress_completed: 1,
    progress_total: 1,
    scenario: {
      id: 'scenario-1',
      name: 'Test',
      description: null,
      expected_outcome: expectedOutcome,
      case_definition: {},
    },
    steps: [],
    logs: [],
    artifacts: [],
    commands: [],
  };
}

describe('Form Tester business campaign verdicts', () => {
  it('maps legacy outcomes to business intentions', () => {
    expect(expectedBehaviorFromLegacy('success')).toBe('accept');
    expect(expectedBehaviorFromLegacy('validation_error')).toBe('reject');
  });

  it('shows a correctly rejected invalid form as conform', () => {
    const state = executionBusinessState(execution('validation_error', {
      expected_behavior: 'reject',
      observed_behavior: 'validation_rejected',
      business_verdict: 'conform',
    }));
    expect(state.effectiveVerdict).toBe('conform');
  });

  it('flags accepted invalid data as unexpected acceptance', () => {
    const state = executionBusinessState(execution('validation_error', {
      expected_behavior: 'reject',
      observed_behavior: 'accepted',
      business_verdict: 'unexpected_acceptance',
    }));
    expect(state.effectiveVerdict).toBe('unexpected_acceptance');
  });

  it('keeps exploratory behavior as observation', () => {
    const state = executionBusinessState(execution('success', {
      expected_behavior: 'explore',
      observed_behavior: 'accepted',
      business_verdict: 'observation',
    }));
    expect(state.effectiveVerdict).toBe('observation');
  });

  it('never renders an inconclusive observation as conform', () => {
    const state = executionBusinessState(execution('success', {
      expected_behavior: 'accept',
      observed_behavior: 'inconclusive',
      business_verdict: 'conform',
      effective_business_verdict: 'conform',
    }));
    expect(state.effectiveVerdict).toBe('needs_confirmation');
  });
});
