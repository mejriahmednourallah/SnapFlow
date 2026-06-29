import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type {
  FormTestScenario,
  FormProfile,
  FormProfileType,
  TestCaseSuggestion,
  WorkflowAiEditPatch,
  WorkflowExecutionDetail,
  WorkflowNodeWithFields,
} from '@/lib/form-tester/types';
import { cn } from '@/lib/utils';
import { FieldConfigPanel } from '../FieldConfigPanel';
import { AIAssistantPanel } from './AIAssistantPanel';
import { LiveExecutionPanel } from './LiveExecutionPanel';
import { NodeConfigEditor } from './NodeConfigEditor';
import { SchedulePanel } from './SchedulePanel';

type InspectorTab = 'configuration' | 'assistant' | 'execution' | 'planning';

interface NodeInspectorPanelProps {
  selectedNode: WorkflowNodeWithFields | null;
  workflowId: string;
  workflowName: string;
  scenarioId: string;
  activeExecutionDetail: WorkflowExecutionDetail | null;
  scenarios: FormTestScenario[];
  results: WorkflowExecutionDetail[];
  testCaseSuggestions: TestCaseSuggestion[];
  testSuiteProfile: FormProfile | null;
  isEditable: boolean;
  isLoading: boolean;
  isExecuting: boolean;
  isAiEditing: boolean;
  aiEditPatch: WorkflowAiEditPatch | null;
  onUpdateField: (fieldId: string, value: string) => Promise<void>;
  onUpdateNodeConfig: (nodeId: string, config: Record<string, unknown>) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onGenerateTestCases: (formType?: FormProfileType) => Promise<void>;
  onUpdateTestCase: (suggestion: TestCaseSuggestion) => void;
  onCreateTestCases: (suggestionIds: string[]) => Promise<void>;
  onExecuteAllCases: (scenarioIds: string[]) => Promise<void>;
  onProposeWorkflowEdit: (instruction: string) => Promise<void>;
  onApplyWorkflowEditPatch: (patch?: WorkflowAiEditPatch) => Promise<void>;
  onClearWorkflowEditPatch: () => void;
  onStopExecution: (executionId: string) => Promise<void>;
}

const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'configuration', label: 'Configuration' },
  { id: 'assistant', label: 'Scénarios de test' },
  { id: 'execution', label: 'Execution' },
  { id: 'planning', label: 'Planning' },
];

export function NodeInspectorPanel({
  selectedNode,
  workflowId,
  workflowName,
  scenarioId,
  activeExecutionDetail,
  scenarios,
  results,
  testCaseSuggestions,
  testSuiteProfile,
  isEditable,
  isLoading,
  isExecuting,
  isAiEditing,
  aiEditPatch,
  onUpdateField,
  onUpdateNodeConfig,
  onDeleteNode,
  onGenerateTestCases,
  onUpdateTestCase,
  onCreateTestCases,
  onExecuteAllCases,
  onProposeWorkflowEdit,
  onApplyWorkflowEditPatch,
  onClearWorkflowEditPatch,
  onStopExecution,
}: NodeInspectorPanelProps) {
  const [tab, setTab] = useState<InspectorTab>('configuration');

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <div className="grid grid-cols-4 rounded-xl bg-muted p-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                'rounded-lg px-2 py-1.5 text-xs font-semibold transition',
                tab === item.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {tab === 'configuration' ? (
            selectedNode ? (
              selectedNode.field ? (
                <FieldConfigPanel
                  field={selectedNode.field}
                  onUpdate={onUpdateField}
                  isLoading={isLoading}
                  isDisabled={!isEditable}
                  embedded
                />
              ) : (
                <NodeConfigEditor
                  node={selectedNode}
                  isEditable={isEditable}
                  isLoading={isLoading}
                  onSave={onUpdateNodeConfig}
                  onDelete={onDeleteNode}
                />
              )
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Selectionnez un noeud dans le canvas pour inspecter sa configuration.
              </div>
            )
          ) : null}

          {tab === 'assistant' ? (
            <AIAssistantPanel
              scenarios={scenarios}
              results={results}
              testCaseSuggestions={testCaseSuggestions}
              formProfile={testSuiteProfile}
              onGenerateTestCases={(formType) => void onGenerateTestCases(formType)}
              onUpdateTestCase={onUpdateTestCase}
              onCreateTestCases={(suggestionIds) => void onCreateTestCases(suggestionIds)}
              onExecuteAllCases={(scenarioIds) => void onExecuteAllCases(scenarioIds)}
              onProposeWorkflowEdit={(instruction) => void onProposeWorkflowEdit(instruction)}
              onApplyWorkflowEditPatch={(patch) => void onApplyWorkflowEditPatch(patch)}
              onClearWorkflowEditPatch={onClearWorkflowEditPatch}
              aiEditPatch={aiEditPatch}
              isLoading={isLoading}
              isExecuting={isExecuting}
              isAiEditing={isAiEditing}
              isEditable={isEditable}
            />
          ) : null}

          {tab === 'execution' ? (
            <LiveExecutionPanel
              execution={activeExecutionDetail}
              onStop={(executionId) => {
                void onStopExecution(executionId);
              }}
            />
          ) : null}

          {tab === 'planning' ? (
            <SchedulePanel
              workflowId={workflowId}
              scenarioId={scenarioId}
              workflowName={workflowName}
              isEditable={isEditable}
            />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
