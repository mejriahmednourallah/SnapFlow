import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CheckCheck, Play, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFormWorkflowBuilder } from '@/hooks/useFormWorkflowBuilder';
import type { WorkflowBuilderProps, WorkflowNodeWithFields } from '@/lib/form-tester/types';
import { ApprovalView } from './ApprovalView';
import { DetectionPanel } from './DetectionPanel';
import { FieldConfigPanel } from './FieldConfigPanel';
import { StatusBadge } from './StatusBadge';
import { AssertNode } from './nodes/AssertNode';
import { FormFillNode } from './nodes/FormFillNode';
import { SubmitNode } from './nodes/SubmitNode';
import { TriggerNode } from './nodes/TriggerNode';

const NODE_TYPES = {
  trigger: TriggerNode,
  form_fill: FormFillNode,
  submit: SubmitNode,
  assert: AssertNode,
};

function buildNodeData(node: WorkflowNodeWithFields, selectedNodeId: string | null): Record<string, unknown> {
  if (node.type === 'trigger') {
    const config = node.config as { url?: string };
    return { url: config.url ?? '' };
  }

  if (node.type === 'form_fill') {
    return {
      fieldLabel: node.field?.field_label ?? node.field?.field_name ?? 'Champ',
      fieldType: node.field?.field_type ?? 'text',
      userValue: node.field?.user_value ?? null,
      aiSuggestion: node.field?.ai_suggestion ?? null,
      isSelected: node.id === selectedNodeId,
      isSensitive: node.field?.is_sensitive ?? false,
    };
  }

  if (node.type === 'submit') {
    const config = node.config as { selector?: string };
    return { selector: config.selector ?? '' };
  }

  if (node.type === 'assert') {
    const config = node.config as { type?: string; value?: string; label?: string };
    return {
      type: (config.type as 'url_contains' | 'element_present' | 'text_present') ?? 'text_present',
      value: config.value ?? '',
      label: config.label ?? 'Assertion',
    };
  }

  return {};
}

export function WorkflowBuilder({ workflowId, isOperator }: WorkflowBuilderProps) {
  const navigate = useNavigate();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const {
    workflow,
    isLoading,
    isDetecting,
    isSuggesting,
    isSaving,
    isSubmitting,
    isApproving,
    isExecuting,
    error,
    detect,
    suggestAll,
    suggestOne,
    updateFieldValue,
    submitForApproval,
    approve,
    reject,
    execute,
  } = useFormWorkflowBuilder(workflowId);

  const rfNodes = useMemo<Node[]>(() => {
    if (!workflow) return [];
    return workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: { x: node.position_x, y: node.position_y },
      draggable: false,
      selected: node.id === selectedNodeId,
      data: buildNodeData(node, selectedNodeId),
    }));
  }, [selectedNodeId, workflow]);

  const rfEdges = useMemo<Edge[]>(() => {
    if (!workflow) return [];

    if (workflow.edges.length > 0) {
      return workflow.edges.map((edge, index) => ({
        id: edge.id || `edge-${index}`,
        source: edge.source_node_id,
        target: edge.target_node_id,
        type: 'smoothstep',
        style: { stroke: '#9CA3AF' },
      }));
    }

    const sorted = [...workflow.nodes].sort((a, b) => a.order_index - b.order_index);
    return sorted.slice(0, -1).map((node, index) => ({
      id: `edge-fallback-${node.id}`,
      source: node.id,
      target: sorted[index + 1].id,
      type: 'smoothstep',
      style: { stroke: '#9CA3AF' },
    }));
  }, [workflow]);

  const selectedNode = workflow?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const formFillCount = workflow?.nodes.filter((node) => node.type === 'form_fill').length ?? 0;

  const isDraft = workflow?.status === 'draft';
  const isPending = workflow?.status === 'pending';
  const isApproved = workflow?.status === 'approved';

  if (isLoading || !workflow) {
    return <div className="glass-card p-6 text-sm text-muted-foreground">Chargement du workflow...</div>;
  }

  return (
    <div className="h-[calc(100vh-8.5rem)] flex flex-col border border-border rounded-xl overflow-hidden bg-background">
      <header className="px-5 py-3 border-b border-border bg-background flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold truncate">{workflow.name}</h2>
          <p className="text-xs text-muted-foreground truncate">{workflow.target_url}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={workflow.status} size="sm" />

          {isDraft && formFillCount > 0 ? (
            <Button variant="outline" size="sm" onClick={() => void suggestAll()} disabled={isSuggesting}>
              <Sparkles className="h-4 w-4 mr-1" />
              Suggérer tous les champs
            </Button>
          ) : null}

          {isDraft ? (
            <Button size="sm" onClick={() => void submitForApproval()} disabled={isSubmitting || isOperator}>
              <CheckCheck className="h-4 w-4 mr-1" />
              Soumettre à validation
            </Button>
          ) : null}

          {isApproved ? (
            <Button size="sm" variant="default" onClick={() => void execute()} disabled={isExecuting}>
              <Play className="h-4 w-4 mr-1" />
              Exécuter
            </Button>
          ) : null}

          {workflow.latest_result ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(`/app/workflows/form-tester/${workflow.id}/results`)}
            >
              Voir les résultats
            </Button>
          ) : null}
        </div>
      </header>

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

      {error ? <p className="px-5 py-2 text-xs text-destructive border-b border-border">{error}</p> : null}

      <div className="flex flex-1 min-h-0">
        <DetectionPanel
          workflow={workflow}
          nodes={workflow.nodes}
          selectedNodeId={selectedNodeId}
          onNodeSelect={setSelectedNodeId}
          onDetect={detect}
          disabled={!isDraft}
          isDetecting={isDetecting}
          errorMessage={error}
        />

        <div className="flex-1 bg-muted/20">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
          >
            <Background color="#CBD5E1" gap={20} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor="#6366F1" />
          </ReactFlow>
        </div>

        {selectedNode?.type === 'form_fill' && selectedNode.field && isDraft ? (
          <FieldConfigPanel
            field={selectedNode.field}
            onUpdate={updateFieldValue}
            onResuggest={suggestOne}
            isLoading={isSuggesting || isSaving}
            isDisabled={!isDraft}
          />
        ) : null}
      </div>
    </div>
  );
}
