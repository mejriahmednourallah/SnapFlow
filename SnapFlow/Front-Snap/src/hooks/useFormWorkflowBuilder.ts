import { useCallback, useEffect, useRef, useState } from 'react';
import { formTesterApi } from '@/lib/form-tester/api';
import type {
  NodePositionUpdate,
  NodeType,
  FormProfile,
  FormProfileType,
  TestCaseSuggestion,
  WorkflowAiEditPatch,
  WorkflowBranchKey,
  WorkflowExecutionDetail,
  WorkflowFormField,
  WorkflowWithDetails,
} from '@/lib/form-tester/types';

interface UseFormWorkflowBuilderReturn {
  workflow: WorkflowWithDetails | null;
  results: WorkflowExecutionDetail[];
  activeExecutionDetail: WorkflowExecutionDetail | null;
  testCaseSuggestions: TestCaseSuggestion[];
  testCaseSuggestionProvider: 'llm' | 'heuristic' | null;
  testSuiteProfile: FormProfile | null;
  testSuiteWarnings: string[];
  isLoading: boolean;
  isDetecting: boolean;
  isSuggesting: boolean;
  isSaving: boolean;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  isSubmitting: boolean;
  isApproving: boolean;
  isExecuting: boolean;
  isAiEditing: boolean;
  error: string | null;
  aiEditPatch: WorkflowAiEditPatch | null;
  reload: () => Promise<void>;
  switchScenario: (scenarioId: string) => Promise<void>;
  loadResults: () => Promise<void>;
  refreshExecution: (executionId: string) => Promise<void>;
  detect: (selectedFormSelector?: string) => Promise<void>;
  suggestAll: () => Promise<void>;
  suggestAndApplyAll: () => Promise<void>;
  suggestOne: (fieldId: string) => Promise<void>;
  updateFieldValue: (fieldId: string, value: string) => Promise<void>;
  updateWorkflowProject: (projectId: string | null) => Promise<void>;
  updateNodePositions: (updates: NodePositionUpdate[]) => Promise<void>;
  addNode: (type: NodeType, position?: { x: number; y: number }) => Promise<void>;
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => Promise<void>;
  deleteNode: (nodeId: string) => Promise<void>;
  connectNodes: (
    sourceNodeId: string,
    targetNodeId: string,
    branchKey: WorkflowBranchKey,
  ) => Promise<void>;
  deleteEdge: (edgeId: string) => Promise<void>;
  proposeWorkflowEdit: (instruction: string) => Promise<void>;
  applyWorkflowEditPatch: (patch?: WorkflowAiEditPatch) => Promise<void>;
  clearWorkflowEditPatch: () => void;
  generateTestCases: (formType?: FormProfileType) => Promise<void>;
  updateTestCaseSuggestion: (suggestion: TestCaseSuggestion) => void;
  createSuggestedTestCases: (suggestionIds: string[]) => Promise<void>;
  executeAllCases: (scenarioIds: string[]) => Promise<void>;
  submitForApproval: () => Promise<void>;
  approve: (note?: string) => Promise<void>;
  reject: (note: string) => Promise<void>;
  execute: () => Promise<void>;
  stopExecution: (executionId: string) => Promise<void>;
  retryExecution: (executionId: string) => Promise<void>;
  runStep: (executionId: string, nodeId: string) => Promise<void>;
  runFromStep: (executionId: string, nodeId: string) => Promise<void>;
}

export function useFormWorkflowBuilder(workflowId: string): UseFormWorkflowBuilderReturn {
  const [workflow, setWorkflow] = useState<WorkflowWithDetails | null>(null);
  const [results, setResults] = useState<WorkflowExecutionDetail[]>([]);
  const [activeExecutionDetail, setActiveExecutionDetail] = useState<WorkflowExecutionDetail | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [testCaseSuggestions, setTestCaseSuggestions] = useState<TestCaseSuggestion[]>([]);
  const [testCaseSuggestionProvider, setTestCaseSuggestionProvider] = useState<'llm' | 'heuristic' | null>(null);
  const [testSuiteProfile, setTestSuiteProfile] = useState<FormProfile | null>(null);
  const [testSuiteWarnings, setTestSuiteWarnings] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isAiEditing, setIsAiEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiEditPatch, setAiEditPatch] = useState<WorkflowAiEditPatch | null>(null);
  const executionRequestRef = useRef(false);

  useEffect(() => {
    if (isSaving) {
      setSaveState('saving');
      return;
    }
    if (saveState === 'saving') {
      setSaveState(error ? 'error' : 'saved');
    }
  }, [error, isSaving, saveState]);

  const reload = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await formTesterApi.getWorkflow(workflowId, false, activeScenarioId ?? undefined);
      setWorkflow(data);
      setActiveScenarioId(data.active_scenario.id);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Impossible de charger le workflow';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [activeScenarioId, workflowId]);

  const switchScenario = useCallback(async (scenarioId: string): Promise<void> => {
    if (!scenarioId || scenarioId === activeScenarioId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await formTesterApi.getWorkflow(workflowId, false, scenarioId);
      setActiveScenarioId(scenarioId);
      setWorkflow(data);
      setTestCaseSuggestions([]);
      setTestCaseSuggestionProvider(null);
      setTestSuiteProfile(null);
      setTestSuiteWarnings([]);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Impossible de charger le scenario';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [activeScenarioId, workflowId]);

  const loadResults = useCallback(async (): Promise<void> => {
    try {
      const data = await formTesterApi.listResults(workflowId);
      setResults(data);
    } catch (resultsError) {
      const message = resultsError instanceof Error ? resultsError.message : 'Impossible de charger les résultats';
      setError(message);
    }
  }, [workflowId]);

  const detect = useCallback(async (selectedFormSelector?: string): Promise<void> => {
    setIsDetecting(true);
    setError(null);
    try {
      await formTesterApi.detectForms(
        workflowId,
        workflow?.active_scenario?.id,
        selectedFormSelector,
      );
      await reload();
    } catch (detectError) {
      const message = detectError instanceof Error ? detectError.message : 'Échec de la détection';
      setError(message);
    } finally {
      setIsDetecting(false);
    }
  }, [reload, workflow?.active_scenario?.id, workflowId]);

  const suggestAll = useCallback(async (): Promise<void> => {
    setIsSuggesting(true);
    setError(null);
    try {
      await formTesterApi.getSuggestions(workflowId, undefined, workflow?.active_scenario?.id);
      await reload();
    } catch (suggestError) {
      const message = suggestError instanceof Error ? suggestError.message : 'Échec des suggestions IA';
      setError(message);
    } finally {
      setIsSuggesting(false);
    }
  }, [reload, workflow, workflowId]);

  const suggestAndApplyAll = useCallback(async (): Promise<void> => {
    setIsSuggesting(true);
    setError(null);
    try {
      const response = await formTesterApi.getSuggestions(workflowId, undefined, workflow?.active_scenario?.id);
      const fieldsById = new Map(
        (workflow?.nodes ?? [])
          .map((node) => node.field)
          .filter((field): field is WorkflowFormField => field !== null)
          .map((field) => [field.id, field]),
      );
      const selectedRadioGroups = new Set<string>();
      const fieldUpdates = response.suggestions
        .filter((suggestion) => suggestion.field_id && suggestion.value !== undefined)
        .map((suggestion) => {
          const field = fieldsById.get(suggestion.field_id);
          if (field?.field_type !== 'radio') {
            return { field_id: suggestion.field_id, user_value: suggestion.value };
          }

          const groupName = field.field_name || field.field_selector;
          const shouldSelect = !selectedRadioGroups.has(groupName);
          selectedRadioGroups.add(groupName);
          return { field_id: suggestion.field_id, user_value: shouldSelect ? 'true' : 'false' };
        });

      if (fieldUpdates.length > 0) {
        await formTesterApi.updateWorkflow({ workflowId, fieldUpdates });
      }

      await reload();
    } catch (suggestError) {
      const message = suggestError instanceof Error ? suggestError.message : 'Echec de l application des suggestions IA';
      setError(message);
    } finally {
      setIsSuggesting(false);
    }
  }, [reload, workflow, workflowId]);

  const suggestOne = useCallback(async (fieldId: string): Promise<void> => {
    setIsSuggesting(true);
    setError(null);
    try {
      await formTesterApi.getSuggestions(workflowId, [fieldId], workflow?.active_scenario?.id);
      await reload();
    } catch (suggestError) {
      const message = suggestError instanceof Error ? suggestError.message : 'Échec de la suggestion IA';
      setError(message);
    } finally {
      setIsSuggesting(false);
    }
  }, [reload, workflowId]);

  const updateFieldValue = useCallback(async (fieldId: string, value: string): Promise<void> => {
    setIsSaving(true);
    setError(null);
    try {
      await formTesterApi.updateWorkflow({
        workflowId,
        fieldUpdates: [{ field_id: fieldId, user_value: value }],
      });
      await reload();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Échec de sauvegarde du champ';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }, [reload, workflow, workflowId]);

  const updateWorkflowProject = useCallback(async (projectId: string | null): Promise<void> => {
    setIsSaving(true);
    setError(null);
    try {
      await formTesterApi.updateWorkflow({ workflowId, projectId });
      await reload();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Impossible de modifier le projet du workflow';
      setError(message);
      throw new Error(message);
    } finally {
      setIsSaving(false);
    }
  }, [reload, workflowId]);

  const updateNodePositions = useCallback(async (updates: NodePositionUpdate[]): Promise<void> => {
    if (updates.length === 0) return;
    setIsSaving(true);
    setError(null);
    try {
      await formTesterApi.updateWorkflow({
        workflowId,
        nodePositionUpdates: updates,
      });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Echec de sauvegarde de la position';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }, [workflowId]);

  const refreshExecution = useCallback(async (executionId: string): Promise<void> => {
    try {
      const execution = await formTesterApi.getExecution(executionId);
      setResults((current) => {
        const exists = current.some((item) => item.id === execution.id);
        return exists
          ? current.map((item) => (item.id === execution.id ? execution : item))
          : [execution, ...current];
      });
      if (activeExecutionDetail?.id === execution.id) {
        setActiveExecutionDetail(execution);
      }
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : 'Impossible de rafraichir les preuves',
      );
    }
  }, [activeExecutionDetail?.id]);

  const addNode = useCallback(async (
    type: NodeType,
    position = { x: 480, y: 320 },
  ): Promise<void> => {
    if (!workflow?.active_scenario?.id) return;
    const defaultConfigs: Partial<Record<NodeType, Record<string, unknown>>> = {
      condition: {
        label: 'Verifier le resultat',
        type: 'text_present',
        value: '',
      },
      assert: {
        label: 'Verifier le resultat',
        type: 'text_present',
        value: '',
      },
      wait: { milliseconds: 500 },
      screenshot: { full_page: false, label: 'Capturer la page' },
      inspect_response: { label: 'Inspecter la reponse' },
      click: { selector: '', label: 'Cliquer' },
      navigate: { url: workflow.target_url, label: 'Ouvrir une page' },
      submit: {
        selector: 'button[type="submit"], input[type="submit"], button:not([type])',
        label: 'Soumettre',
      },
    };
    setIsSaving(true);
    setError(null);
    try {
      await formTesterApi.addNode({
        workflowId,
        scenarioId: workflow.active_scenario.id,
        type,
        config: defaultConfigs[type] ?? { label: type },
        positionX: position.x,
        positionY: position.y,
      });
      await reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Echec de creation du noeud');
    } finally {
      setIsSaving(false);
    }
  }, [reload, workflow, workflowId]);

  const updateNodeConfig = useCallback(async (
    nodeId: string,
    config: Record<string, unknown>,
  ): Promise<void> => {
    if (!workflow?.active_scenario?.id) return;
    setIsSaving(true);
    setError(null);
    try {
      await formTesterApi.updateNode({
        workflowId,
        scenarioId: workflow.active_scenario.id,
        nodeId,
        config,
      });
      setWorkflow((current) =>
        current
          ? {
              ...current,
              nodes: current.nodes.map((node) =>
                node.id === nodeId ? { ...node, config } : node
              ),
            }
          : current
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Echec de configuration du noeud');
    } finally {
      setIsSaving(false);
    }
  }, [workflow, workflowId]);

  const deleteNode = useCallback(async (nodeId: string): Promise<void> => {
    if (!workflow?.active_scenario?.id) return;
    setIsSaving(true);
    setError(null);
    try {
      await formTesterApi.deleteNode(workflowId, workflow.active_scenario.id, nodeId);
      setWorkflow((current) =>
        current
          ? {
              ...current,
              nodes: current.nodes.filter((node) => node.id !== nodeId),
              edges: current.edges.filter(
                (edge) => edge.source_node_id !== nodeId && edge.target_node_id !== nodeId
              ),
            }
          : current
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Echec de suppression du noeud');
    } finally {
      setIsSaving(false);
    }
  }, [workflow, workflowId]);

  const connectNodes = useCallback(async (
    sourceNodeId: string,
    targetNodeId: string,
    branchKey: WorkflowBranchKey,
  ): Promise<void> => {
    if (!workflow?.active_scenario?.id) return;
    setIsSaving(true);
    setError(null);
    try {
      const edge = await formTesterApi.upsertEdge({
        workflowId,
        scenarioId: workflow.active_scenario.id,
        sourceNodeId,
        targetNodeId,
        branchKey,
      });
      setWorkflow((current) => {
        if (!current) return current;
        const retained = current.edges.filter(
          (item) => !(item.source_node_id === sourceNodeId && item.branch_key === branchKey)
        );
        return { ...current, edges: [...retained, edge] };
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Echec de connexion des noeuds');
    } finally {
      setIsSaving(false);
    }
  }, [workflow, workflowId]);

  const deleteEdge = useCallback(async (edgeId: string): Promise<void> => {
    if (!workflow?.active_scenario?.id) return;
    setIsSaving(true);
    setError(null);
    try {
      await formTesterApi.deleteEdge(workflowId, workflow.active_scenario.id, edgeId);
      setWorkflow((current) =>
        current ? { ...current, edges: current.edges.filter((edge) => edge.id !== edgeId) } : current
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Echec de suppression de la connexion');
    } finally {
      setIsSaving(false);
    }
  }, [workflow, workflowId]);

  const proposeWorkflowEdit = useCallback(async (instruction: string): Promise<void> => {
    if (!workflow?.active_scenario?.id || !instruction.trim()) return;
    setIsAiEditing(true);
    setError(null);
    try {
      const patch = await formTesterApi.proposeWorkflowEdit({
        workflowId,
        scenarioId: workflow.active_scenario.id,
        instruction: instruction.trim(),
      });
      setAiEditPatch(patch);
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : 'Echec de preparation de la modification IA');
    } finally {
      setIsAiEditing(false);
    }
  }, [workflow?.active_scenario?.id, workflowId]);

  const applyWorkflowEditPatch = useCallback(async (patch = aiEditPatch ?? undefined): Promise<void> => {
    if (!workflow?.active_scenario?.id || !patch || patch.operations.length === 0) return;
    const scenarioId = workflow.active_scenario.id;
    const tempNodeIds = new Map<string, string>();
    const resolveNodeId = (nodeId: string): string => tempNodeIds.get(nodeId) ?? nodeId;

    setIsSaving(true);
    setError(null);
    try {
      for (const operation of patch.operations) {
        if (operation.op === 'add_node') {
          const node = await formTesterApi.addNode({
            workflowId,
            scenarioId,
            type: operation.type,
            config: operation.config ?? (operation.label ? { label: operation.label } : {}),
            positionX: operation.position_x,
            positionY: operation.position_y,
          });
          if (operation.temp_id) tempNodeIds.set(operation.temp_id, node.id);
          continue;
        }

        if (operation.op === 'update_node') {
          await formTesterApi.updateNode({
            workflowId,
            scenarioId,
            nodeId: resolveNodeId(operation.node_id),
            config: operation.config,
            positionX: operation.position_x,
            positionY: operation.position_y,
          });
          continue;
        }

        if (operation.op === 'delete_node') {
          await formTesterApi.deleteNode(workflowId, scenarioId, resolveNodeId(operation.node_id));
          continue;
        }

        if (operation.op === 'upsert_edge') {
          await formTesterApi.upsertEdge({
            workflowId,
            scenarioId,
            sourceNodeId: resolveNodeId(operation.source_node_id),
            targetNodeId: resolveNodeId(operation.target_node_id),
            branchKey: operation.branch_key,
          });
          continue;
        }

        if (operation.op === 'delete_edge') {
          await formTesterApi.deleteEdge(workflowId, scenarioId, operation.edge_id);
          continue;
        }

        if (operation.op === 'update_scenario') {
          await formTesterApi.updateScenario({
            workflowId,
            scenarioId,
            name: operation.name,
            description: operation.description,
            status: operation.status,
          });
        }
      }

      setAiEditPatch(null);
      await reload();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Echec d application de la modification IA');
    } finally {
      setIsSaving(false);
    }
  }, [aiEditPatch, reload, workflow?.active_scenario?.id, workflowId]);

  const clearWorkflowEditPatch = useCallback(() => {
    setAiEditPatch(null);
  }, []);

  const generateTestCases = useCallback(async (formType?: FormProfileType): Promise<void> => {
    if (!workflow?.active_scenario?.id) return;
    setIsSuggesting(true);
    setError(null);
    try {
      const response = await formTesterApi.suggestTestCases(
        workflowId,
        workflow.active_scenario.id,
        formType,
      );
      setTestCaseSuggestions(response.cases ?? []);
      setTestCaseSuggestionProvider(response.provider);
      setTestSuiteProfile(response.form_profile ?? null);
      setTestSuiteWarnings(response.warnings ?? []);
    } catch (suggestError) {
      setError(suggestError instanceof Error ? suggestError.message : 'Echec de generation des cas de test');
    } finally {
      setIsSuggesting(false);
    }
  }, [workflow, workflowId]);

  const updateTestCaseSuggestion = useCallback((suggestion: TestCaseSuggestion): void => {
    setTestCaseSuggestions((current) =>
      current.map((item) =>
        item.id === suggestion.id ? { ...suggestion, compilation_error: undefined } : item
      )
    );
  }, []);

  const createSuggestedTestCases = useCallback(async (suggestionIds: string[]): Promise<void> => {
    if (!workflow?.active_scenario?.id || suggestionIds.length === 0) return;
    const selected = testCaseSuggestions.filter((item) => suggestionIds.includes(item.id));
    if (selected.length === 0) return;
    setIsSaving(true);
    setError(null);
    try {
      await formTesterApi.createTestCases(
        workflowId,
        workflow.active_scenario.id,
        selected,
      );
      setTestCaseSuggestions((current) =>
        current.filter((item) => !suggestionIds.includes(item.id))
      );
      await reload();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Echec de creation des cas de test';
      const affectedCase = selected.find((item) => message.includes(item.name));
      if (affectedCase) {
        setTestCaseSuggestions((current) =>
          current.map((item) =>
            item.id === affectedCase.id ? { ...item, compilation_error: message } : item
          )
        );
      } else {
        setError(message);
      }
    } finally {
      setIsSaving(false);
    }
  }, [reload, testCaseSuggestions, workflow, workflowId]);

  const executeAllCases = useCallback(async (scenarioIds: string[]): Promise<void> => {
    const uniqueScenarioIds = [...new Set(scenarioIds)].filter(Boolean);
    if (uniqueScenarioIds.length === 0 || executionRequestRef.current) return;
    executionRequestRef.current = true;
    setIsExecuting(true);
    setError(null);
    try {
      for (const scenarioId of uniqueScenarioIds) {
        await formTesterApi.executeWorkflow(workflowId, undefined, scenarioId, undefined);
      }
      await loadResults();
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : 'Echec de l execution groupee');
    } finally {
      executionRequestRef.current = false;
      setIsExecuting(false);
    }
  }, [loadResults, workflowId]);

  const submitForApproval = useCallback(async (): Promise<void> => {
    setIsSubmitting(true);
    setError(null);
    try {
      await formTesterApi.submitForApproval(workflowId, workflow?.active_scenario?.id);
      await reload();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Échec de soumission';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [reload, workflow, workflowId]);

  const approve = useCallback(async (note?: string): Promise<void> => {
    setIsApproving(true);
    setError(null);
    try {
      const pendingVersion = workflow?.scenario_versions.find((version) => version.status === 'pending');
      await formTesterApi.approveWorkflow(workflowId, {
        action: 'approve',
        note,
        scenarioId: workflow?.active_scenario?.id,
        scenarioVersionId: pendingVersion?.id,
      });
      await reload();
    } catch (approveError) {
      const message = approveError instanceof Error ? approveError.message : 'Échec d approbation';
      setError(message);
    } finally {
      setIsApproving(false);
    }
  }, [reload, workflow, workflowId]);

  const reject = useCallback(async (note: string): Promise<void> => {
    setIsApproving(true);
    setError(null);
    try {
      const pendingVersion = workflow?.scenario_versions.find((version) => version.status === 'pending');
      await formTesterApi.approveWorkflow(workflowId, {
        action: 'reject',
        note,
        scenarioId: workflow?.active_scenario?.id,
        scenarioVersionId: pendingVersion?.id,
      });
      await reload();
    } catch (rejectError) {
      const message = rejectError instanceof Error ? rejectError.message : 'Échec du rejet';
      setError(message);
    } finally {
      setIsApproving(false);
    }
  }, [reload, workflow, workflowId]);

  const execute = useCallback(async (): Promise<void> => {
    if (executionRequestRef.current) return;
    executionRequestRef.current = true;
    setIsExecuting(true);
    setError(null);
    try {
      await formTesterApi.executeWorkflow(
        workflowId,
        undefined,
        workflow?.active_scenario?.id,
        undefined,
      );
      await Promise.all([reload(), loadResults()]);
    } catch (executeError) {
      const message = executeError instanceof Error ? executeError.message : 'Échec de l exécution';
      setError(message);
    } finally {
      executionRequestRef.current = false;
      setIsExecuting(false);
    }
  }, [loadResults, reload, workflow, workflowId]);

  const stopExecution = useCallback(async (executionId: string): Promise<void> => {
    setError(null);
    try {
      await formTesterApi.controlExecution(executionId, 'stop');
      await loadResults();
    } catch (controlError) {
      const message = controlError instanceof Error ? controlError.message : 'Echec de la demande d arret';
      setError(message);
    }
  }, [loadResults]);

  const retryExecution = useCallback(async (executionId: string): Promise<void> => {
    setError(null);
    try {
      await formTesterApi.controlExecution(executionId, 'retry');
      await loadResults();
    } catch (controlError) {
      const message = controlError instanceof Error ? controlError.message : 'Echec de la relance';
      setError(message);
    }
  }, [loadResults]);

  const runStep = useCallback(async (executionId: string, nodeId: string): Promise<void> => {
    setError(null);
    try {
      await formTesterApi.controlExecution(executionId, 'run_step', nodeId);
      await loadResults();
    } catch (controlError) {
      const message = controlError instanceof Error ? controlError.message : 'Echec de l execution de l etape';
      setError(message);
    }
  }, [loadResults]);

  const runFromStep = useCallback(async (executionId: string, nodeId: string): Promise<void> => {
    setError(null);
    try {
      await formTesterApi.controlExecution(executionId, 'run_from', nodeId);
      await loadResults();
    } catch (controlError) {
      const message = controlError instanceof Error ? controlError.message : 'Echec de l execution depuis l etape';
      setError(message);
    }
  }, [loadResults]);

  useEffect(() => {
    void reload();
    void loadResults();
  }, [loadResults, reload]);

  const activeExecutionId =
    results.find((result) => ['queued', 'running', 'stopping'].includes(result.status))?.id ??
    (workflow?.latest_result && ['queued', 'running', 'stopping'].includes(workflow.latest_result.status)
      ? workflow.latest_result.id
      : null);

  useEffect(() => {
    const hasActiveExecution = results.some((result) =>
      ['queued', 'running', 'stopping'].includes(result.status),
    );
    if (!hasActiveExecution) return undefined;

    const timer = window.setInterval(() => {
      void loadResults();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loadResults, results]);

  useEffect(() => {
    if (!activeExecutionId) {
      setActiveExecutionDetail(null);
      return undefined;
    }

    const loadActiveExecution = async (): Promise<void> => {
      try {
        const execution = await formTesterApi.getExecution(activeExecutionId);
        setActiveExecutionDetail(execution);
      } catch (executionError) {
        const message = executionError instanceof Error ? executionError.message : 'Impossible de charger l execution active';
        setError(message);
      }
    };

    void loadActiveExecution();
    const timer = window.setInterval(() => {
      void loadActiveExecution();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeExecutionId]);

  return {
    workflow,
    results,
    activeExecutionDetail,
    testCaseSuggestions,
    testCaseSuggestionProvider,
    testSuiteProfile,
    testSuiteWarnings,
    isLoading,
    isDetecting,
    isSuggesting,
    isSaving,
    saveState,
    isSubmitting,
    isApproving,
    isExecuting,
    isAiEditing,
    error,
    aiEditPatch,
    reload,
    switchScenario,
    loadResults,
    refreshExecution,
    detect,
    suggestAll,
    suggestAndApplyAll,
    suggestOne,
    updateFieldValue,
    updateWorkflowProject,
    updateNodePositions,
    addNode,
    updateNodeConfig,
    deleteNode,
    connectNodes,
    deleteEdge,
    proposeWorkflowEdit,
    applyWorkflowEditPatch,
    clearWorkflowEditPatch,
    generateTestCases,
    updateTestCaseSuggestion,
    createSuggestedTestCases,
    executeAllCases,
    submitForApproval,
    approve,
    reject,
    execute,
    stopExecution,
    retryExecution,
    runStep,
    runFromStep,
  };
}
