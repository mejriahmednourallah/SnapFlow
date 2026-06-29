import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Edge, Node, NodeTypes } from '@xyflow/react';
import { CheckCheck, FlaskConical, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFormWorkflowBuilder } from '@/hooks/useFormWorkflowBuilder';
import type {
  NodePositionUpdate,
  NodeType,
  WorkflowBranchKey,
  WorkflowBuilderProps,
  WorkflowExecutionDetail,
  WorkflowNodeWithFields,
} from '@/lib/form-tester/types';
import { ApprovalView } from './ApprovalView';
import { StatusBadge } from './StatusBadge';
import { NodeInspectorPanel } from './builder/NodeInspectorPanel';
import { ScenarioSidebar } from './builder/ScenarioSidebar';
import { WorkflowBuilderShell } from './builder/WorkflowBuilderShell';
import { WorkflowCanvas } from './builder/WorkflowCanvas';
import { ProjectSearchSelect } from './ProjectSearchSelect';
import { WorkflowRedmineDraftDialog } from './WorkflowRedmineDraftDialog';
import { AssertNode } from './nodes/AssertNode';
import { ConditionNode } from './nodes/ConditionNode';
import { FormFillNode } from './nodes/FormFillNode';
import { GenericActionNode } from './nodes/GenericActionNode';
import { SubmitNode } from './nodes/SubmitNode';
import { TriggerNode } from './nodes/TriggerNode';

const NODE_TYPES: NodeTypes = {
  trigger: TriggerNode,
  navigate: GenericActionNode,
  form_fill: FormFillNode,
  fill: GenericActionNode,
  select: GenericActionNode,
  check: GenericActionNode,
  upload: GenericActionNode,
  click: GenericActionNode,
  submit: SubmitNode,
  wait: GenericActionNode,
  condition: ConditionNode,
  assert: AssertNode,
  screenshot: GenericActionNode,
  inspect_response: GenericActionNode,
};

function nodeLabel(node: WorkflowNodeWithFields): string {
  if (node.field) return node.field.field_label ?? node.field.field_name;
  const config = node.config as Record<string, unknown>;
  if (typeof config.label === 'string') return config.label;
  if (typeof config.selector === 'string') return config.selector;
  if (typeof config.url === 'string') return config.url;
  return node.type;
}

function nodeDetail(node: WorkflowNodeWithFields): string {
  const config = node.config as Record<string, unknown>;
  if (node.field) {
    const valueState = node.field.user_value ? 'valeur definie' : node.field.ai_suggestion ? 'suggestion disponible' : 'valeur manquante';
    return `${node.field.field_type} - ${valueState}`;
  }
  if (typeof config.value === 'string') return config.value;
  if (typeof config.wait_for === 'string') return `Attend: ${config.wait_for}`;
  if (typeof config.url === 'string') return config.url;
  return `Etape ${node.order_index + 1}`;
}

function stepStatusForNode(execution: WorkflowExecutionDetail | null, nodeId: string): string | undefined {
  const step = execution?.steps
    .filter((item) => item.node_id === nodeId)
    .sort((a, b) => b.sequence_number - a.sequence_number)[0];
  if (!step) return undefined;
  if (step.status === 'passed') return 'passed';
  if (['failed', 'error', 'blocked', 'cancelled'].includes(step.status)) return 'failed';
  if (step.status === 'running') return 'running';
  if (step.status === 'skipped') return 'skipped';
  return undefined;
}

function buildNodeData(
  node: WorkflowNodeWithFields,
  selectedNodeId: string | null,
  activeExecutionDetail: WorkflowExecutionDetail | null,
): Record<string, unknown> {
  const status = stepStatusForNode(activeExecutionDetail, node.id);

  if (node.type === 'trigger') {
    const config = node.config as { url?: string };
    return {
      url: config.url ?? '',
      kind: node.type,
      label: 'Ouvrir la cible',
      detail: config.url ?? '',
      status,
      isSelected: node.id === selectedNodeId,
    };
  }

  if (node.type === 'form_fill') {
    return {
      fieldLabel: node.field?.field_label ?? node.field?.field_name ?? 'Champ',
      fieldType: node.field?.field_type ?? 'text',
      userValue: node.field?.user_value ?? null,
      aiSuggestion: node.field?.ai_suggestion ?? null,
      isSelected: node.id === selectedNodeId,
      isSensitive: node.field?.is_sensitive ?? false,
      status,
    };
  }

  if (node.type === 'submit') {
    const config = node.config as { selector?: string };
    return {
      selector: config.selector ?? '',
      kind: node.type,
      label: 'Soumettre',
      detail: config.selector ?? '',
      status,
      isSelected: node.id === selectedNodeId,
    };
  }

  if (node.type === 'assert') {
    const config = node.config as { type?: string; value?: string; label?: string };
    return {
      type: config.type ?? 'text_present',
      value: config.value ?? '',
      label: config.label ?? 'Assertion',
      kind: node.type,
      detail: config.value ?? '',
      status,
      isSelected: node.id === selectedNodeId,
    };
  }

  if (node.type === 'condition') {
    const config = node.config as { type?: string; value?: string; label?: string };
    return {
      kind: node.type,
      label: config.label ?? 'Condition',
      detail: [config.type, config.value].filter(Boolean).join(': '),
      status: status ?? (config.type ? 'configured' : 'missing'),
      isSelected: node.id === selectedNodeId,
    };
  }

  return {
    kind: node.type as NodeType,
    label: nodeLabel(node),
    detail: nodeDetail(node),
    status: status ?? (node.field?.user_value || node.type !== 'fill' ? 'configured' : 'missing'),
    isSelected: node.id === selectedNodeId,
  };
}

export function WorkflowBuilder({ workflowId, isOperator }: WorkflowBuilderProps) {
  const navigate = useNavigate();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const {
    workflow,
    results,
    activeExecutionDetail,
    testCaseSuggestions,
    testSuiteProfile,
    isLoading,
    isDetecting,
    isSuggesting,
    isSaving,
    saveState,
    isSubmitting,
    isApproving,
    isExecuting,
    error,
    detect,
    updateWorkflowProject,
    updateFieldValue,
    updateNodePositions,
    addNode,
    updateNodeConfig,
    deleteNode,
    connectNodes,
    deleteEdge,
    generateTestCases,
    updateTestCaseSuggestion,
    createSuggestedTestCases,
    executeAllCases,
    switchScenario,
    submitForApproval,
    approve,
    reject,
    execute,
    stopExecution,
  } = useFormWorkflowBuilder(workflowId);

  const rfNodes = useMemo<Node[]>(() => {
    if (!workflow) return [];
    return workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: { x: node.position_x, y: node.position_y },
      draggable: true,
      selected: node.id === selectedNodeId,
      data: buildNodeData(node, selectedNodeId, activeExecutionDetail),
    }));
  }, [activeExecutionDetail, selectedNodeId, workflow]);

  const rfEdges = useMemo<Edge[]>(() => {
    if (!workflow) return [];

    if (workflow.edges.length > 0) {
      const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
      return workflow.edges.map((edge, index) => {
        const sourceType = nodeById.get(edge.source_node_id)?.type;
        const branchKey: WorkflowBranchKey =
          edge.branch_key === 'default' && sourceType === 'submit'
            ? 'success'
            : edge.branch_key;
        const stroke =
          branchKey === 'true' || branchKey === 'success'
            ? '#10B981'
            : branchKey === 'false' || branchKey === 'failure'
              ? '#EF4444'
              : '#94A3B8';
        return {
          id: edge.id || `edge-${index}`,
          source: edge.source_node_id,
          target: edge.target_node_id,
          sourceHandle: branchKey,
          targetHandle: 'default',
          type: 'smoothstep',
          label: branchKey === 'default' ? undefined : branchKey,
          labelStyle: { fill: stroke, fontSize: 10, fontWeight: 700 },
          style: { stroke, strokeWidth: 2 },
        };
      });
    }

    const sorted = [...workflow.nodes].sort((a, b) => a.order_index - b.order_index);
    return sorted.slice(0, -1).map((node, index) => ({
      id: `edge-fallback-${node.id}`,
      source: node.id,
      target: sorted[index + 1].id,
      sourceHandle: node.type === 'submit' ? 'success' : 'default',
      targetHandle: 'default',
      type: 'smoothstep',
      style: { stroke: '#94A3B8', strokeWidth: 2 },
    }));
  }, [workflow]);

  const selectedNode = workflow?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const latestScenarioVersion = workflow?.scenario_versions?.[0] ?? null;
  const pendingScenarioVersion = workflow?.scenario_versions.find((version) => version.status === 'pending') ?? null;

  const isDraft = workflow?.status === 'draft';
  const isNeedsReview = workflow?.status === 'needs_review';
  const isEditable = workflow?.status !== 'executed';
  const isPending = Boolean(pendingScenarioVersion && (workflow?.status === 'pending' || isNeedsReview));
  const canExecute = Boolean(workflow?.nodes.length);
  const detectedSignals = workflow?.risk_flags?.length
    ? workflow.risk_flags
    : workflow?.blocked_reason?.startsWith('needs_review:')
      ? workflow.blocked_reason.replace(/^needs_review:/, '').split(',').filter(Boolean)
      : workflow?.blocked_reason?.startsWith('signal:')
        ? workflow.blocked_reason.replace(/^signal:/, '').split(',').filter(Boolean)
        : [];
  const activeExecution =
    results.find((result) => ['queued', 'running', 'stopping'].includes(result.status)) ??
    (workflow?.latest_result && ['queued', 'running', 'stopping'].includes(workflow.latest_result.status)
      ? workflow.latest_result
      : null);

  const handleNodePositionChange = useCallback((updates: NodePositionUpdate[]) => {
    void updateNodePositions(updates);
  }, [updateNodePositions]);

  const handleConnectNodes = useCallback((
    sourceNodeId: string,
    targetNodeId: string,
    branchKey: WorkflowBranchKey,
  ) => {
    void connectNodes(sourceNodeId, targetNodeId, branchKey);
  }, [connectNodes]);

  const handleDeleteEdges = useCallback((edgeIds: string[]) => {
    void Promise.all(edgeIds.map((edgeId) => deleteEdge(edgeId)));
  }, [deleteEdge]);

  if (isLoading || !workflow) {
    return <div className="glass-card p-6 text-sm text-muted-foreground">Chargement du workflow...</div>;
  }

  const header = (
    <header className="border-b border-border bg-background px-5 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="truncate text-base font-semibold">{workflow.name}</h2>
            <StatusBadge status={workflow.status} size="sm" />
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{workflow.target_url}</p>
          <div className="mt-2 max-w-sm">
            <ProjectSearchSelect
              value={workflow.project_id}
              onChange={(projectId) => void updateWorkflowProject(projectId)}
              emptyLabel="Workflow global"
              placeholder="Rechercher un projet..."
              disabled={!isEditable || isSaving}
              className="w-full"
            />
          </div>
          {workflow.active_scenario ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              Scenario: {workflow.active_scenario.name}
              {latestScenarioVersion
                ? ` - version ${latestScenarioVersion.version_number} (${latestScenarioVersion.status})`
                : ' - non versionne'}
            </p>
          ) : null}
          <p className="mt-1 text-[11px] font-medium text-muted-foreground">
            {saveState === 'saving'
              ? 'Enregistrement...'
              : saveState === 'error'
                ? 'Erreur de sauvegarde'
                : saveState === 'saved'
                  ? 'Sauvegarde'
                  : 'Modifications enregistrees'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isDraft ? (
            <Button size="sm" onClick={() => void submitForApproval()} disabled={isSubmitting}>
              <CheckCheck className="mr-1 h-4 w-4" />
              Soumettre a validation
            </Button>
          ) : null}

          {canExecute ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`/app/workflows/form-tester/${workflow.id}/plan`)}
              >
                <FlaskConical className="mr-1 h-4 w-4" />
                Préparer une campagne
              </Button>
              <Button size="sm" variant="default" onClick={() => void execute()} disabled={isExecuting || Boolean(activeExecution)}>
                <Play className="mr-1 h-4 w-4" />
                {activeExecution ? 'Execution en cours' : 'Exécuter ce scénario'}
              </Button>
            </>
          ) : null}

          {workflow.latest_result ? (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/app/workflows/form-tester/${workflow.id}/results`)}>
              Voir les resultats
            </Button>
          ) : null}
          <WorkflowRedmineDraftDialog workflow={workflow} />
        </div>
      </div>
    </header>
  );

  const notices = (
    <>
      {isOperator && isPending ? (
        <ApprovalView
          onApprove={async (note) => {
            await approve(note);
          }}
          onReject={async (note) => {
            await reject(note);
          }}
          isLoading={isApproving}
        />
      ) : null}

      {error ? <p className="border-b border-border px-5 py-2 text-xs text-destructive">{error}</p> : null}
      {detectedSignals.length > 0 ? (
        <p className="border-b border-sky-200 bg-sky-50 px-5 py-2 text-xs text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300">
          Signal detecte: {detectedSignals.join(', ')}. Le workflow reste editable et executable.
        </p>
      ) : null}
    </>
  );

  return (
    <WorkflowBuilderShell
      header={header}
      notices={notices}
      sidebar={
        <ScenarioSidebar
          workflow={workflow}
          selectedNodeId={selectedNodeId}
          onNodeSelect={setSelectedNodeId}
          onScenarioSelect={(scenarioId) => {
            setSelectedNodeId(null);
            void switchScenario(scenarioId);
          }}
          onDetect={detect}
          onAddNode={(type) => void addNode(type)}
          disabled={!isEditable}
          isDetecting={isDetecting}
          isSaving={isSaving}
        />
      }
      canvas={
        <WorkflowCanvas
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          selectedNodeId={selectedNodeId}
          isEditable={isEditable}
          activeExecutionDetail={activeExecutionDetail}
          onNodeSelect={setSelectedNodeId}
          onNodePositionChange={handleNodePositionChange}
          onConnectNodes={handleConnectNodes}
          onDeleteEdges={handleDeleteEdges}
        />
      }
      inspector={
        <NodeInspectorPanel
          selectedNode={selectedNode}
          workflowId={workflow.id}
          workflowName={workflow.name}
          scenarioId={workflow.active_scenario.id}
          activeExecutionDetail={activeExecutionDetail}
          scenarios={workflow.scenarios}
          results={results}
          testCaseSuggestions={testCaseSuggestions}
          testSuiteProfile={testSuiteProfile}
          isEditable={isEditable}
          isLoading={isSuggesting || isSaving}
          isExecuting={isExecuting || Boolean(activeExecution)}
          onUpdateField={updateFieldValue}
          onUpdateNodeConfig={updateNodeConfig}
          onDeleteNode={async (nodeId) => {
            await deleteNode(nodeId);
            setSelectedNodeId(null);
          }}
          onGenerateTestCases={generateTestCases}
          onUpdateTestCase={updateTestCaseSuggestion}
          onCreateTestCases={createSuggestedTestCases}
          onExecuteAllCases={executeAllCases}
          onStopExecution={stopExecution}
        />
      }
    />
  );
}
