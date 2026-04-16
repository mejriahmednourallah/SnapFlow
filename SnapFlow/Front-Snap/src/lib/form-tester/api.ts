import { supabase } from '@/integrations/supabase/client';
import type {
  ApprovalPayload,
  DetectionResponse,
  ExecutionResponse,
  FormWorkflow,
  SuggestionResponse,
  WorkflowListItem,
  WorkflowResult,
  WorkflowStatus,
  WorkflowWithDetails,
} from './types';

interface ErrorPayload {
  error?: string;
  details?: string;
}

async function invokeFormTester<TResponse>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<TResponse> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });

  if (error) {
    let message = error.message;
    const possibleContext = error as { context?: Response };
    if (possibleContext.context) {
      try {
        const payload = (await possibleContext.context.json()) as ErrorPayload;
        message = payload.error ?? payload.details ?? message;
      } catch {
        // ignore JSON parsing issues and keep original error message
      }
    }
    throw new Error(message);
  }

  const response = (data ?? {}) as TResponse & ErrorPayload;
  if (typeof response === 'object' && response !== null && response.error) {
    throw new Error(response.error);
  }

  return response as TResponse;
}

export const formTesterApi = {
  async listWorkflows(params?: { status?: WorkflowStatus; operatorView?: boolean }): Promise<WorkflowListItem[]> {
    const response = await invokeFormTester<{ workflows: WorkflowListItem[] }>('form-workflows', {
      action: 'list',
      status: params?.status,
      operator_view: params?.operatorView ?? false,
    });
    return response.workflows ?? [];
  },

  async getWorkflow(workflowId: string, includeResults = false): Promise<WorkflowWithDetails> {
    const response = await invokeFormTester<{
      workflow: Omit<WorkflowWithDetails, 'nodes' | 'edges' | 'latest_result'>;
      nodes: WorkflowWithDetails['nodes'];
      edges: WorkflowWithDetails['edges'];
      latest_result: WorkflowWithDetails['latest_result'];
    }>('form-workflows', {
      action: 'get',
      workflow_id: workflowId,
      include_results: includeResults,
    });

    return {
      ...response.workflow,
      nodes: response.nodes ?? [],
      edges: response.edges ?? [],
      latest_result: response.latest_result ?? null,
    };
  },

  async createWorkflow(name: string, targetUrl: string): Promise<FormWorkflow> {
    const response = await invokeFormTester<{ workflow: FormWorkflow }>('form-workflows', {
      action: 'create',
      name,
      target_url: targetUrl,
    });
    return response.workflow;
  },

  async updateWorkflow(payload: {
    workflowId: string;
    name?: string;
    targetUrl?: string;
    fieldUpdates?: Array<{ field_id: string; user_value: string | null }>;
  }): Promise<void> {
    await invokeFormTester<{ success: boolean }>('form-workflows', {
      action: 'update',
      workflow_id: payload.workflowId,
      name: payload.name,
      target_url: payload.targetUrl,
      field_updates: payload.fieldUpdates ?? [],
    });
  },

  async submitForApproval(workflowId: string): Promise<FormWorkflow> {
    const response = await invokeFormTester<{ workflow: FormWorkflow }>('form-workflows', {
      action: 'submit',
      workflow_id: workflowId,
    });
    return response.workflow;
  },

  async detectForms(workflowId: string): Promise<DetectionResponse> {
    return invokeFormTester<DetectionResponse>('form-workflows-detect', {
      workflow_id: workflowId,
    });
  },

  async getSuggestions(workflowId: string, fieldIds?: string[]): Promise<SuggestionResponse> {
    return invokeFormTester<SuggestionResponse>('form-workflows-suggest', {
      workflow_id: workflowId,
      field_ids: fieldIds,
    });
  },

  async approveWorkflow(workflowId: string, payload: ApprovalPayload): Promise<FormWorkflow> {
    const response = await invokeFormTester<{ workflow: FormWorkflow }>('form-workflows-approve', {
      workflow_id: workflowId,
      action: payload.action,
      note: payload.note,
    });
    return response.workflow;
  },

  async executeWorkflow(workflowId: string, auditRunId?: string): Promise<ExecutionResponse> {
    return invokeFormTester<ExecutionResponse>('form-workflows-execute', {
      workflow_id: workflowId,
      audit_run_id: auditRunId,
    });
  },

  async listResults(workflowId: string): Promise<WorkflowResult[]> {
    const response = await invokeFormTester<{ results: WorkflowResult[] }>('form-workflows', {
      action: 'results',
      workflow_id: workflowId,
    });
    return response.results ?? [];
  },
};
