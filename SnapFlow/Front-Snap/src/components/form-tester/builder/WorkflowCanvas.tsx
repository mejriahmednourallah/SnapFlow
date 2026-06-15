import { useEffect, useRef, useState } from 'react';
import {
  Background,
  Connection,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type {
  NodePositionUpdate,
  WorkflowBranchKey,
  WorkflowExecutionDetail,
} from '@/lib/form-tester/types';

interface WorkflowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  selectedNodeId: string | null;
  isEditable: boolean;
  activeExecutionDetail: WorkflowExecutionDetail | null;
  onNodeSelect: (nodeId: string) => void;
  onNodePositionChange: (updates: NodePositionUpdate[]) => void;
  onConnectNodes: (sourceNodeId: string, targetNodeId: string, branchKey: WorkflowBranchKey) => void;
  onDeleteEdges: (edgeIds: string[]) => void;
}

function latestScreenshotUrl(execution: WorkflowExecutionDetail | null): string | null {
  if (!execution) return null;
  const screenshots = execution.artifacts
    .filter((artifact) => artifact.artifact_type === 'screenshot' && artifact.signed_url)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return screenshots[0]?.signed_url ?? null;
}

export function WorkflowCanvas({
  nodes,
  edges,
  nodeTypes,
  selectedNodeId,
  isEditable,
  activeExecutionDetail,
  onNodeSelect,
  onNodePositionChange,
  onConnectNodes,
  onDeleteEdges,
}: WorkflowCanvasProps) {
  const [localNodes, setLocalNodes] = useState<Node[]>(nodes);
  const saveTimerRef = useRef<number | null>(null);
  const progressTotal = activeExecutionDetail?.progress_total ?? activeExecutionDetail?.steps.length ?? 0;
  const progressCompleted =
    activeExecutionDetail?.progress_completed ?? activeExecutionDetail?.steps.filter((step) => step.status !== 'queued').length ?? 0;
  const progress = progressTotal > 0 ? Math.round((progressCompleted / progressTotal) * 100) : 0;
  const screenshotUrl = latestScreenshotUrl(activeExecutionDetail);
  const activeNodeId = activeExecutionDetail?.current_node_id ?? null;
  const layoutSignature = nodes.map((node) => `${node.id}:${node.position.x}:${node.position.y}`).join('|');

  useEffect(() => {
    setLocalNodes(nodes);
  }, [layoutSignature]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const schedulePositionSave = (update: NodePositionUpdate): void => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      onNodePositionChange([update]);
      saveTimerRef.current = null;
    }, 450);
  };

  const wouldCreateCycle = (connection: Connection): boolean => {
    if (!connection.source || !connection.target) return true;
    const targetsBySource = new Map<string, string[]>();
    edges.forEach((edge) => {
      targetsBySource.set(edge.source, [...(targetsBySource.get(edge.source) ?? []), edge.target]);
    });
    targetsBySource.set(connection.source, [
      ...(targetsBySource.get(connection.source) ?? []),
      connection.target,
    ]);

    const pending = [connection.target];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const nodeId = pending.pop();
      if (!nodeId || visited.has(nodeId)) continue;
      if (nodeId === connection.source) return true;
      visited.add(nodeId);
      pending.push(...(targetsBySource.get(nodeId) ?? []));
    }
    return false;
  };

  return (
    <div className="relative h-full bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.10),transparent_30%),linear-gradient(135deg,rgba(15,23,42,0.04),transparent)]">
      <div className="absolute left-4 right-4 top-4 z-10 rounded-2xl border border-border bg-background/90 p-3 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Canvas workflow</p>
            <p className="truncate text-sm text-foreground">
              {activeExecutionDetail ? `Execution ${activeExecutionDetail.status}` : 'Deplacez les noeuds pour organiser le scenario.'}
            </p>
          </div>
          {activeExecutionDetail ? (
            <div className="flex w-72 items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                  <span>Progression</span>
                  <span>
                    {progressCompleted}/{progressTotal || '?'}
                  </span>
                </div>
                <Progress value={progress} />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ReactFlow
        nodes={localNodes.map((node) => {
          const sourceNode = nodes.find((item) => item.id === node.id);
          return {
            ...(sourceNode ?? node),
            position: node.position,
          selected: node.id === selectedNodeId,
          data: {
              ...(sourceNode?.data ?? node.data),
            isSelected: node.id === selectedNodeId,
              status: node.id === activeNodeId ? 'running' : sourceNode?.data?.status ?? node.data?.status,
          },
          };
        })}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_event, node) => onNodeSelect(node.id)}
        onNodesChange={(changes) => {
          setLocalNodes((current) =>
            current.map((node) => {
              const positionChange = changes.find((change) => change.type === 'position' && change.id === node.id);
              if (!positionChange || !('position' in positionChange) || !positionChange.position) return node;
              return { ...node, position: positionChange.position };
            }),
          );
        }}
        onNodeDragStop={(_event, node) => {
          schedulePositionSave({
            node_id: node.id,
            position_x: node.position.x,
            position_y: node.position.y,
          });
        }}
        onConnect={(connection) => {
          if (
            !isEditable ||
            !connection.source ||
            !connection.target ||
            wouldCreateCycle(connection)
          ) {
            return;
          }
          const branchKey = (connection.sourceHandle || 'default') as WorkflowBranchKey;
          onConnectNodes(connection.source, connection.target, branchKey);
        }}
        onEdgesDelete={(deletedEdges) => {
          if (!isEditable || deletedEdges.length === 0) return;
          onDeleteEdges(deletedEdges.map((edge) => edge.id));
        }}
        fitView
        fitViewOptions={{ padding: 0.35 }}
        nodesDraggable={isEditable}
        nodesConnectable={isEditable}
        edgesReconnectable={false}
        deleteKeyCode={['Backspace', 'Delete']}
        elementsSelectable
        className="pt-20"
      >
        <Background color="#94A3B8" gap={22} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="#2563EB" />
      </ReactFlow>

      {screenshotUrl ? (
        <div className="absolute bottom-4 right-4 z-10 w-72 overflow-hidden rounded-2xl border border-border bg-background shadow-lg">
          <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Preview live
          </div>
          <img src={screenshotUrl} alt="Preview live" className="max-h-40 w-full object-cover object-top" />
        </div>
      ) : null}
    </div>
  );
}
