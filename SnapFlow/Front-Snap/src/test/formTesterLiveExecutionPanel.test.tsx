import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LiveExecutionPanel } from '@/components/form-tester/builder/LiveExecutionPanel';
import type { WorkflowExecutionDetail } from '@/lib/form-tester/types';

function makeExecution(): WorkflowExecutionDetail {
  return {
    id: 'execution-1',
    workflow_id: 'workflow-1',
    scenario_id: 'scenario-1',
    scenario_version_id: 'version-1',
    executed_by: 'user-1',
    executed_at: '2026-06-08T10:00:00Z',
    status: 'running',
    duration_ms: 1200,
    assertions: [],
    screenshot_url: null,
    error_message: null,
    audit_run_id: null,
    step_trace: [],
    final_url: null,
    network_summary: {},
    execution_source: 'chromium',
    execution_mode: 'full',
    execution_engine: 'chromium',
    environment: 'local',
    start_node_id: null,
    current_node_id: 'node-2',
    queued_at: '2026-06-08T10:00:00Z',
    started_at: '2026-06-08T10:00:01Z',
    completed_at: null,
    stopped_at: null,
    heartbeat_at: '2026-06-08T10:00:03Z',
    requested_by: 'user-1',
    failure_reason: null,
    summary: {},
    progress_completed: 2,
    progress_total: 4,
    steps: [],
    logs: [
      {
        id: 'log-1',
        execution_id: 'execution-1',
        step_result_id: null,
        level: 'info',
        event_type: 'step',
        message: 'Etape fill terminee avec le statut passed.',
        details_redacted: {},
        created_at: '2026-06-08T10:00:02Z',
      },
    ],
    artifacts: [
      {
        id: 'artifact-1',
        execution_id: 'execution-1',
        step_result_id: null,
        artifact_type: 'screenshot',
        storage_path: 'screenshots/execution-1.png',
        mime_type: 'image/png',
        size_bytes: 1234,
        redaction_status: 'not_required',
        metadata_redacted: {},
        signed_url: 'https://signed.example/screenshot.png',
        created_at: '2026-06-08T10:00:03Z',
      },
    ],
    commands: [],
  };
}

describe('LiveExecutionPanel', () => {
  it('shows progress, latest signed screenshot and recent logs', () => {
    render(<LiveExecutionPanel execution={makeExecution()} onStop={vi.fn()} />);

    expect(screen.getByText('2/4 etapes')).toBeInTheDocument();
    expect(screen.getByAltText('Derniere capture d execution')).toHaveAttribute(
      'src',
      'https://signed.example/screenshot.png',
    );
    expect(screen.getByText(/Etape fill terminee/i)).toBeInTheDocument();
  });
});
