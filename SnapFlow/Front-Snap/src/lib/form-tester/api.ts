import { supabase } from '@/integrations/supabase/client';
import { normalizeWorkflowExecution } from './normalizeExecution';
import type {
  ApprovalPayload,
  DetectionResponse,
  ExecutionResponse,
  WorkflowExecutionCommand,
  WorkflowExecutionDetail,
  FormTestScenario,
  FormProfileType,
  FormWorkflow,
  NodePositionUpdate,
  NodeType,
  SuggestionResponse,
  TestCaseSuggestion,
  TestCaseSuggestionResponse,
  WorkflowBranchKey,
  WorkflowEdge,
  WorkflowNodeWithFields,
  WorkflowListItem,
  WorkflowListView,
  WorkflowSchedule,
  WorkflowScheduleFrequency,
  WorkflowScheduleRun,
  FormTesterAiStatus,
  FormTestCampaign,
  FormTestCampaignDetail,
  BusinessVerdict,
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
  async listWorkflows(params?: { status?: WorkflowStatus; view?: WorkflowListView; projectId?: string | null }): Promise<WorkflowListItem[]> {
    const response = await invokeFormTester<{ workflows: WorkflowListItem[] }>('form-workflows', {
      action: 'list',
      status: params?.status,
      view: params?.view ?? 'mine',
      project_id: params?.projectId ?? undefined,
    });
    return response.workflows ?? [];
  },

  async getWorkflow(workflowId: string, includeResults = false, scenarioId?: string): Promise<WorkflowWithDetails> {
    const response = await invokeFormTester<{
      workflow: FormWorkflow;
      active_scenario: WorkflowWithDetails['active_scenario'];
      scenarios: WorkflowWithDetails['scenarios'];
      scenario_versions: WorkflowWithDetails['scenario_versions'];
      nodes: WorkflowWithDetails['nodes'];
      edges: WorkflowWithDetails['edges'];
      latest_result: WorkflowWithDetails['latest_result'];
    }>('form-workflows', {
      action: 'get',
      workflow_id: workflowId,
      scenario_id: scenarioId,
      include_results: includeResults,
    });

    if (!response.workflow) {
      throw new Error('Workflow introuvable ou reponse incomplete');
    }

    return {
      ...response.workflow,
      active_scenario: response.active_scenario,
      scenarios: response.scenarios ?? [],
      scenario_versions: response.scenario_versions ?? [],
      nodes: response.nodes ?? [],
      edges: response.edges ?? [],
      latest_result: response.latest_result ?? null,
    };
  },

  async createWorkflow(name: string, targetUrl: string, projectId?: string | null): Promise<FormWorkflow> {
    const response = await invokeFormTester<{ workflow: FormWorkflow }>('form-workflows', {
      action: 'create',
      name,
      target_url: targetUrl,
      project_id: projectId ?? null,
    });
    return response.workflow;
  },

  async createScenario(
    workflowId: string,
    name: string,
    description?: string,
  ): Promise<FormTestScenario> {
    const response = await invokeFormTester<{ scenario: FormTestScenario }>('form-workflows', {
      action: 'create_scenario',
      workflow_id: workflowId,
      scenario_name: name,
      scenario_description: description,
    });
    return response.scenario;
  },

  async updateWorkflow(payload: {
    workflowId: string;
    name?: string;
    targetUrl?: string;
    projectId?: string | null;
    fieldUpdates?: Array<{ field_id: string; user_value: string | null }>;
    nodePositionUpdates?: NodePositionUpdate[];
  }): Promise<void> {
    await invokeFormTester<{ success: boolean }>('form-workflows', {
      action: 'update',
      workflow_id: payload.workflowId,
      name: payload.name,
      target_url: payload.targetUrl,
      project_id: payload.projectId,
      field_updates: payload.fieldUpdates ?? [],
      node_position_updates: payload.nodePositionUpdates ?? [],
    });
  },

  async submitForApproval(workflowId: string, scenarioId?: string): Promise<FormWorkflow> {
    const response = await invokeFormTester<{ workflow: FormWorkflow }>('form-workflows', {
      action: 'submit',
      workflow_id: workflowId,
      scenario_id: scenarioId,
    });
    return response.workflow;
  },

  async detectForms(
    workflowId: string,
    scenarioId?: string,
    selectedFormSelector?: string,
  ): Promise<DetectionResponse> {
    return invokeFormTester<DetectionResponse>('form-workflows-detect', {
      workflow_id: workflowId,
      scenario_id: scenarioId,
      selected_form_selector: selectedFormSelector,
    });
  },

  async getSuggestions(workflowId: string, fieldIds?: string[], scenarioId?: string): Promise<SuggestionResponse> {
    return invokeFormTester<SuggestionResponse>('form-workflows-suggest', {
      workflow_id: workflowId,
      scenario_id: scenarioId,
      field_ids: fieldIds,
    });
  },

  async suggestTestCases(
    workflowId: string,
    scenarioId: string,
    formType?: FormProfileType,
  ): Promise<TestCaseSuggestionResponse> {
    return invokeFormTester<TestCaseSuggestionResponse>('form-workflows-suggest', {
      workflow_id: workflowId,
      scenario_id: scenarioId,
      mode: 'test_suite_plan',
      form_type: formType,
    });
  },

  async createTestCases(
    workflowId: string,
    scenarioId: string,
    cases: TestCaseSuggestion[],
  ): Promise<FormTestScenario[]> {
    const response = await invokeFormTester<{ success: boolean; scenarios: FormTestScenario[] }>('form-workflows', {
      action: 'create_test_cases',
      workflow_id: workflowId,
      scenario_id: scenarioId,
      test_cases: cases,
    });
    return response.scenarios ?? [];
  },

  async updateScenarioBehavior(payload: {
    workflowId: string;
    scenarioId: string;
    expectedBehavior: 'accept' | 'reject' | 'explore';
    expectationConfidence: number;
    suggestedSeverity: 'critical' | 'high' | 'medium' | 'low';
    suggestedSeverityReason: string;
    baselineDependent: boolean;
    fieldMutations?: TestCaseSuggestion['field_mutations'];
    purpose?: string;
    reasoning?: string;
  }): Promise<FormTestScenario> {
    const response = await invokeFormTester<{ scenario: FormTestScenario }>('form-workflows', {
      action: 'update_scenario_behavior',
      workflow_id: payload.workflowId,
      scenario_id: payload.scenarioId,
      expected_behavior: payload.expectedBehavior,
      expectation_confidence: payload.expectationConfidence,
      suggested_severity: payload.suggestedSeverity,
      suggested_severity_reason: payload.suggestedSeverityReason,
      baseline_dependent: payload.baselineDependent,
      scenario_field_mutations: payload.fieldMutations,
      scenario_purpose: payload.purpose,
      scenario_reasoning: payload.reasoning,
    });
    return response.scenario;
  },

  async addNode(payload: {
    workflowId: string;
    scenarioId: string;
    type: NodeType;
    config?: Record<string, unknown>;
    positionX?: number;
    positionY?: number;
  }): Promise<WorkflowNodeWithFields> {
    const response = await invokeFormTester<{ node: WorkflowNodeWithFields }>('form-workflows', {
      action: 'add_node',
      workflow_id: payload.workflowId,
      scenario_id: payload.scenarioId,
      node_type: payload.type,
      node_config: payload.config ?? {},
      position_x: payload.positionX,
      position_y: payload.positionY,
    });
    return { ...response.node, field: response.node.field ?? null };
  },

  async updateNode(payload: {
    workflowId: string;
    scenarioId: string;
    nodeId: string;
    config?: Record<string, unknown>;
    positionX?: number;
    positionY?: number;
  }): Promise<WorkflowNodeWithFields> {
    const response = await invokeFormTester<{ node: WorkflowNodeWithFields }>('form-workflows', {
      action: 'update_node',
      workflow_id: payload.workflowId,
      scenario_id: payload.scenarioId,
      node_id: payload.nodeId,
      node_config: payload.config,
      position_x: payload.positionX,
      position_y: payload.positionY,
    });
    return { ...response.node, field: response.node.field ?? null };
  },

  async deleteNode(workflowId: string, scenarioId: string, nodeId: string): Promise<void> {
    await invokeFormTester<{ success: boolean }>('form-workflows', {
      action: 'delete_node',
      workflow_id: workflowId,
      scenario_id: scenarioId,
      node_id: nodeId,
    });
  },

  async upsertEdge(payload: {
    workflowId: string;
    scenarioId: string;
    sourceNodeId: string;
    targetNodeId: string;
    branchKey: WorkflowBranchKey;
  }): Promise<WorkflowEdge> {
    const response = await invokeFormTester<{ edge: WorkflowEdge }>('form-workflows', {
      action: 'upsert_edge',
      workflow_id: payload.workflowId,
      scenario_id: payload.scenarioId,
      source_node_id: payload.sourceNodeId,
      target_node_id: payload.targetNodeId,
      branch_key: payload.branchKey,
    });
    return response.edge;
  },

  async deleteEdge(workflowId: string, scenarioId: string, edgeId: string): Promise<void> {
    await invokeFormTester<{ success: boolean }>('form-workflows', {
      action: 'delete_edge',
      workflow_id: workflowId,
      scenario_id: scenarioId,
      edge_id: edgeId,
    });
  },

  async approveWorkflow(workflowId: string, payload: ApprovalPayload): Promise<FormWorkflow> {
    const response = await invokeFormTester<{ workflow: FormWorkflow }>('form-workflows-approve', {
      workflow_id: workflowId,
      action: payload.action,
      note: payload.note,
      scenario_id: payload.scenarioId,
      scenario_version_id: payload.scenarioVersionId,
    });
    return response.workflow;
  },

  async executeWorkflow(
    workflowId: string,
    auditRunId?: string,
    scenarioId?: string,
    scenarioVersionId?: string,
  ): Promise<ExecutionResponse> {
    return invokeFormTester<ExecutionResponse>('form-workflows-execute', {
      workflow_id: workflowId,
      audit_run_id: auditRunId,
      scenario_id: scenarioId,
      scenario_version_id: scenarioVersionId,
    });
  },

  async listExecutions(workflowId: string, limit = 50): Promise<WorkflowExecutionDetail[]> {
    const response = await invokeFormTester<{ executions: WorkflowExecutionDetail[] }>('form-executions', {
      action: 'list',
      workflow_id: workflowId,
      limit,
    });
    return (response.executions ?? []).map(normalizeWorkflowExecution);
  },

  async getExecution(executionId: string): Promise<WorkflowExecutionDetail> {
    const response = await invokeFormTester<WorkflowExecutionDetail>('form-executions', {
      action: 'get',
      execution_id: executionId,
    });
    return normalizeWorkflowExecution(response);
  },

  async controlExecution(
    executionId: string,
    command: WorkflowExecutionCommand['command'],
    nodeId?: string,
  ): Promise<WorkflowExecutionCommand> {
    const response = await invokeFormTester<{ command: WorkflowExecutionCommand }>('form-execution-control', {
      execution_id: executionId,
      command,
      node_id: nodeId,
    });
    return response.command;
  },

  async listResults(workflowId: string): Promise<WorkflowExecutionDetail[]> {
    const response = await invokeFormTester<{ executions: WorkflowExecutionDetail[] }>('form-executions', {
      action: 'list',
      workflow_id: workflowId,
      limit: 50,
    });
    return (response.executions ?? []).map(normalizeWorkflowExecution);
  },

  async listSchedules(workflowId?: string): Promise<{
    schedules: WorkflowSchedule[];
    runs: WorkflowScheduleRun[];
  }> {
    return invokeFormTester('form-workflow-schedules', {
      action: 'list',
      workflow_id: workflowId,
    });
  },

  async createSchedule(payload: {
    workflowId: string;
    scenarioId: string;
    name: string;
    frequency: WorkflowScheduleFrequency;
    timezone: string;
    startAt: string;
    dayOfWeek?: number | null;
    dayOfMonth?: number | null;
    endAt?: string | null;
    environment?: string;
  }): Promise<WorkflowSchedule> {
    const response = await invokeFormTester<{ schedule: WorkflowSchedule }>('form-workflow-schedules', {
      action: 'create',
      workflow_id: payload.workflowId,
      scenario_id: payload.scenarioId,
      name: payload.name,
      frequency: payload.frequency,
      timezone: payload.timezone,
      start_at: payload.startAt,
      day_of_week: payload.dayOfWeek ?? null,
      day_of_month: payload.dayOfMonth ?? null,
      end_at: payload.endAt ?? null,
      environment: payload.environment ?? 'default',
    });
    return response.schedule;
  },

  async updateSchedule(
    scheduleId: string,
    updates: Partial<{
      name: string;
      frequency: WorkflowScheduleFrequency;
      timezone: string;
      start_at: string;
      day_of_week: number | null;
      day_of_month: number | null;
      end_at: string | null;
      environment: string;
      is_active: boolean;
    }>,
  ): Promise<WorkflowSchedule> {
    const response = await invokeFormTester<{ schedule: WorkflowSchedule }>('form-workflow-schedules', {
      action: 'update',
      schedule_id: scheduleId,
      ...updates,
    });
    return response.schedule;
  },

  async deleteSchedule(scheduleId: string): Promise<void> {
    await invokeFormTester('form-workflow-schedules', {
      action: 'delete',
      schedule_id: scheduleId,
    });
  },

  async runScheduleNow(scheduleId: string): Promise<void> {
    await invokeFormTester('form-workflow-schedules', {
      action: 'run_now',
      schedule_id: scheduleId,
    });
  },

  async refreshScheduleSnapshot(scheduleId: string): Promise<WorkflowSchedule> {
    const response = await invokeFormTester<{ schedule: WorkflowSchedule }>('form-workflow-schedules', {
      action: 'refresh_snapshot',
      schedule_id: scheduleId,
    });
    return response.schedule;
  },

  async getAiStatus(): Promise<FormTesterAiStatus> {
    return invokeFormTester<FormTesterAiStatus>('form-tester-ai-status', {});
  },

  async launchCampaign(payload: {
    workflowId: string;
    baselineScenarioIds: string[];
    scenarioIds: string[];
    name?: string;
    environment?: string;
  }): Promise<{
    campaign: FormTestCampaign;
    baseline_execution_id: string;
    baseline_execution_ids: string[];
  }> {
    return invokeFormTester('form-test-campaigns', {
      action: 'launch',
      workflow_id: payload.workflowId,
      baseline_scenario_ids: payload.baselineScenarioIds,
      scenario_ids: payload.scenarioIds,
      name: payload.name,
      environment: payload.environment ?? 'default',
    });
  },

  async interpretExecution(executionId: string): Promise<Record<string, unknown>> {
    const response = await invokeFormTester<{ interpretation: Record<string, unknown> }>(
      'form-test-campaigns',
      {
        action: 'interpret',
        execution_id: executionId,
      },
    );
    return response.interpretation;
  },

  async listCampaigns(workflowId: string): Promise<FormTestCampaign[]> {
    const response = await invokeFormTester<{ campaigns: FormTestCampaign[] }>('form-test-campaigns', {
      action: 'list',
      workflow_id: workflowId,
    });
    return response.campaigns ?? [];
  },

  async getCampaign(campaignId: string): Promise<FormTestCampaignDetail> {
    const response = await invokeFormTester<FormTestCampaignDetail>('form-test-campaigns', {
      action: 'get',
      campaign_id: campaignId,
    });
    return {
      campaign: response.campaign,
      executions: (response.executions ?? []).map(normalizeWorkflowExecution),
    };
  },

  async reviewExecution(payload: {
    executionId: string;
    verdict: Extract<BusinessVerdict, 'conform' | 'unexpected_acceptance' | 'unexpected_rejection'>;
    justification: string;
    severity?: 'critical' | 'high' | 'medium' | 'low';
  }): Promise<void> {
    await invokeFormTester('form-test-campaigns', {
      action: 'review',
      execution_id: payload.executionId,
      verdict: payload.verdict,
      justification: payload.justification,
      severity: payload.severity,
    });
  },
};
