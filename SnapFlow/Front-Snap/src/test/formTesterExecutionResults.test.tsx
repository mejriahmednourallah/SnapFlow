import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionResults } from '@/components/form-tester/ExecutionResults';
import type { WorkflowExecutionDetail } from '@/lib/form-tester/types';

function makeResult(overrides: Partial<WorkflowExecutionDetail> = {}): WorkflowExecutionDetail {
  return {
    id: 'result-1',
    workflow_id: 'workflow-1',
    scenario_id: 'scenario-1',
    scenario_version_id: 'version-1',
    executed_by: 'user-1',
    executed_at: '2026-06-08T10:00:00Z',
    status: 'pass',
    duration_ms: 1200,
    assertions: [],
    screenshot_url: null,
    error_message: null,
    audit_run_id: null,
    step_trace: [],
    final_url: null,
    network_summary: { mode: 'simulated', requests: 0, failures: 0 },
    execution_source: 'simulated_legacy',
    execution_mode: 'full',
    execution_engine: 'simulated_legacy',
    environment: 'test',
    start_node_id: null,
    current_node_id: null,
    queued_at: '2026-06-08T10:00:00Z',
    started_at: '2026-06-08T10:00:00Z',
    completed_at: '2026-06-08T10:00:01Z',
    stopped_at: null,
    heartbeat_at: null,
    requested_by: 'user-1',
    failure_reason: null,
    summary: {},
    progress_completed: 2,
    progress_total: 2,
    steps: [],
    logs: [],
    artifacts: [],
    commands: [],
    ...overrides,
  };
}

describe('ExecutionResults', () => {
  it('shows simulated legacy executions as non-real browser runs', () => {
    render(<ExecutionResults results={[makeResult()]} />);

    expect(screen.getAllByText('Simulation legacy').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/ce n est pas une execution navigateur reelle/i)).toBeInTheDocument();
    expect(screen.getByText(/aucune assertion navigateur evaluee/i)).toBeInTheDocument();
    expect(screen.queryByText('Test automatise')).not.toBeInTheDocument();
  });

  it('shows unavailable executor separately from failed business assertions', () => {
    render(
      <ExecutionResults
        results={[
          makeResult({
            status: 'error',
            error_message: 'Moteur indisponible',
            execution_source: 'executor_unavailable',
            network_summary: { mode: 'unavailable' },
          }),
        ]}
      />,
    );

    expect(screen.getAllByText('Executor indisponible').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Moteur indisponible')).toBeInTheDocument();
  });

  it('shows queued execution progress and its initial log', () => {
    render(
      <ExecutionResults
        results={[
          makeResult({
            status: 'queued',
            duration_ms: null,
            execution_source: 'pending_executor',
            execution_engine: 'chromium',
            started_at: null,
            completed_at: null,
            progress_completed: 0,
            progress_total: 12,
            logs: [
              {
                id: 'log-1',
                execution_id: 'result-1',
                step_result_id: null,
                level: 'info',
                event_type: 'execution_queued',
                message: 'Execution ajoutee a la file d attente.',
                details_redacted: {},
                created_at: '2026-06-08T10:00:00Z',
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getAllByText('En file d attente').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('0/12 etapes')).toBeInTheDocument();
    expect(screen.getByText('Execution ajoutee a la file d attente.')).toBeInTheDocument();
  });

  it('does not present incomplete historical errors as measured executions', () => {
    render(
      <ExecutionResults
        results={[
          makeResult({
            status: 'error',
            execution_source: 'legacy_unknown',
            execution_engine: 'chromium',
            duration_ms: null,
            error_message: null,
            final_url: null,
            network_summary: {},
            progress_completed: 0,
            progress_total: 0,
          }),
        ]}
      />,
    );

    expect(screen.getAllByText('Resultat historique incomplet').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Non interpretable')).toBeInTheDocument();
    expect(screen.getByText('Duree non mesuree')).toBeInTheDocument();
    expect(screen.getByText(/aucun verdict fonctionnel ne peut etre tire/i)).toBeInTheDocument();
    expect(screen.queryByText('0 ms')).not.toBeInTheDocument();
    expect(screen.queryByText('Erreur')).not.toBeInTheDocument();
  });

  it('surfaces the failed Chromium step instead of only a generic execution error', () => {
    render(
      <ExecutionResults
        results={[
          makeResult({
            status: 'error',
            execution_source: 'chromium',
            execution_engine: 'chromium',
            duration_ms: 10272,
            final_url: 'https://httpbin.org/forms/post',
            network_summary: { requests: 1, failures: 0 },
            failure_reason: 'selector_not_fillable',
            steps: [
              {
                id: 'step-1',
                execution_id: 'result-1',
                node_id: 'node-radio',
                sequence_number: 3,
                step_type: 'fill',
                status: 'error',
                started_at: '2026-06-08T10:00:00Z',
                completed_at: '2026-06-08T10:00:01Z',
                duration_ms: 120,
                input_redacted: {
                  selector: 'input[name="size"][value="small"]',
                  field_name: 'size',
                  field_type: 'true',
                },
                output_redacted: {
                  selector: 'input[name="size"][value="small"]',
                  input_type: 'radio',
                },
                assertions: [],
                error_code: 'selector_not_fillable',
                error_message: 'Selector points to input[radio], not a text-fillable field.',
                retry_count: 0,
                created_at: '2026-06-08T10:00:00Z',
              },
            ],
            artifacts: [
              {
                id: 'artifact-1',
                execution_id: 'result-1',
                step_result_id: 'step-1',
                artifact_type: 'screenshot',
                storage_path: 'result-1/step-1-screenshot.png',
                mime_type: 'image/png',
                size_bytes: 1234,
                redaction_status: 'redacted',
                metadata_redacted: {},
                created_at: '2026-06-08T10:00:01Z',
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByText('Point a verifier')).toBeInTheDocument();
    expect(screen.getByText('Renseigner un champ')).toBeInTheDocument();
    expect(screen.getByText('screenshot')).toBeInTheDocument();
  });

  it('offers retry and targeted step controls for completed Chromium executions', () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const onRunStep = vi.fn().mockResolvedValue(undefined);
    const onRunFromStep = vi.fn().mockResolvedValue(undefined);

    render(
      <ExecutionResults
        results={[
          makeResult({
            status: 'passed',
            execution_source: 'chromium',
            execution_engine: 'chromium',
            steps: [
              {
                id: 'step-1',
                execution_id: 'result-1',
                node_id: 'node-submit',
                sequence_number: 0,
                step_type: 'submit',
                status: 'passed',
                started_at: '2026-06-08T10:00:00Z',
                completed_at: '2026-06-08T10:00:01Z',
                duration_ms: 120,
                input_redacted: {},
                output_redacted: {},
                assertions: [],
                error_code: null,
                error_message: null,
                retry_count: 0,
                created_at: '2026-06-08T10:00:00Z',
              },
            ],
          }),
        ]}
        onRetry={onRetry}
        onRunStep={onRunStep}
        onRunFromStep={onRunFromStep}
      />,
    );

    fireEvent.click(screen.getByText('Relancer'));
    fireEvent.click(screen.getByText('Cette etape'));
    fireEvent.click(screen.getByText('Depuis ici'));

    expect(onRetry).toHaveBeenCalledWith('result-1');
    expect(onRunStep).toHaveBeenCalledWith('result-1', 'node-submit');
    expect(onRunFromStep).toHaveBeenCalledWith('result-1', 'node-submit');
  });

  it('shows oracle evidence, queue timing and signed screenshot previews', () => {
    render(
      <ExecutionResults
        results={[
          makeResult({
            status: 'inconclusive',
            execution_source: 'chromium',
            execution_engine: 'chromium',
            queue_wait_ms: 12_000,
            execution_duration_ms: 3_500,
            total_elapsed_ms: 15_500,
            scenario: {
              id: 'scenario-1',
              name: 'Parcours nominal',
              description: 'Verifier la soumission du formulaire',
              expected_outcome: 'success',
              case_definition: { purpose: 'Valider le contact' },
            },
            steps: [
              {
                id: 'step-assert',
                execution_id: 'result-1',
                node_id: 'node-assert',
                sequence_number: 4,
                step_type: 'assert',
                status: 'inconclusive',
                started_at: '2026-06-08T10:00:03Z',
                completed_at: '2026-06-08T10:00:04Z',
                duration_ms: 1000,
                input_redacted: {},
                output_redacted: {
                  oracle: {
                    verdict: 'inconclusive',
                    score: 0.6,
                    pass_threshold: 0.65,
                    evidence: [
                      {
                        type: 'response_status_range',
                        matched: true,
                        actual: '200',
                        weight: 0.2,
                      },
                      {
                        type: 'success_message_present',
                        matched: false,
                        actual: 'not_found',
                        weight: 0.45,
                      },
                    ],
                  },
                },
                assertions: [],
                error_code: 'submission_outcome_inconclusive',
                error_message: 'Submission outcome evidence was inconclusive.',
                retry_count: 0,
                created_at: '2026-06-08T10:00:03Z',
              },
            ],
            artifacts: [
              {
                id: 'artifact-preview',
                execution_id: 'result-1',
                step_result_id: 'step-assert',
                artifact_type: 'screenshot',
                storage_path: 'executions/result-1/step-assert/capture.png',
                mime_type: 'image/png',
                size_bytes: 2048,
                redaction_status: 'redacted',
                metadata_redacted: { capture_reason: 'step_inconclusive' },
                signed_url: 'https://signed.example/capture.png',
                previewable: true,
                upload_status: 'available',
                storage_backend: 'supabase',
                created_at: '2026-06-08T10:00:04Z',
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByText('Parcours nominal')).toBeInTheDocument();
    expect(screen.getByText('Niveau de preuve 60% · minimum 65%')).toBeInTheDocument();
    expect(screen.getByText('Statut HTTP attendu')).toBeInTheDocument();
    expect(screen.getByText('Message de confirmation')).toBeInTheDocument();
    expect(screen.getByText('12.0 s')).toBeInTheDocument();
    expect(screen.getByAltText('Capture step_inconclusive')).toHaveAttribute(
      'src',
      'https://signed.example/capture.png',
    );
  });

  it('marks local-only screenshots as unavailable', () => {
    render(
      <ExecutionResults
        results={[
          makeResult({
            execution_source: 'chromium',
            artifacts: [
              {
                id: 'artifact-local',
                execution_id: 'result-1',
                step_result_id: null,
                artifact_type: 'screenshot',
                storage_path: 'executions/result-1/execution/capture.png',
                mime_type: 'image/png',
                size_bytes: 500,
                redaction_status: 'redacted',
                metadata_redacted: {},
                signed_url: null,
                previewable: false,
                upload_status: 'local_only',
                storage_backend: 'local',
                created_at: '2026-06-08T10:00:04Z',
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByText(/n a pas pu etre transferee/i)).toBeInTheDocument();
  });

  it('presents an expected validation rejection as a business control', () => {
    render(
      <ExecutionResults
        results={[
          makeResult({
            status: 'passed',
            execution_source: 'chromium',
            scenario: {
              id: 'scenario-1',
              name: 'Format email invalide',
              description: 'Verifier le rejet du format',
              expected_outcome: 'validation_error',
              case_definition: {},
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText('Conforme')).toBeInTheDocument();
    expect(screen.getByText(/validation globale/i)).toBeInTheDocument();
    expect(screen.getByText(/Objectif: Blocage des donnees invalides/)).toBeInTheDocument();
    expect(screen.queryByText('Chromium reel')).not.toBeInTheDocument();
  });

  it('presents an accepted invalid submission as unexpected acceptance', () => {
    render(
      <ExecutionResults
        results={[
          makeResult({
            status: 'failed',
            execution_source: 'chromium',
            scenario: {
              id: 'scenario-1',
              name: 'Champ requis vide - nom',
              description: 'Verifier le champ nom',
              expected_outcome: 'validation_error',
              case_definition: {
                validation_scope: 'field',
                target_field_id: 'field-name',
                target_field_name: 'Nom',
              },
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText('Acceptation inattendue')).toBeInTheDocument();
    expect(screen.getByText(/champ « Nom » devait etre refuse/i)).toBeInTheDocument();
  });
});
