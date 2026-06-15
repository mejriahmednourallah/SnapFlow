import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));

const workflowBuilderSource = readFileSync(resolve(currentDir, '../components/form-tester/WorkflowBuilder.tsx'), 'utf8');
const workflowBuilderShellSource = readFileSync(resolve(currentDir, '../components/form-tester/builder/WorkflowBuilderShell.tsx'), 'utf8');
const workflowCanvasSource = readFileSync(resolve(currentDir, '../components/form-tester/builder/WorkflowCanvas.tsx'), 'utf8');
const nodeInspectorSource = readFileSync(resolve(currentDir, '../components/form-tester/builder/NodeInspectorPanel.tsx'), 'utf8');
const scenarioSidebarSource = readFileSync(resolve(currentDir, '../components/form-tester/builder/ScenarioSidebar.tsx'), 'utf8');
const workflowHookSource = readFileSync(resolve(currentDir, '../hooks/useFormWorkflowBuilder.ts'), 'utf8');
const apiSource = readFileSync(resolve(currentDir, '../lib/form-tester/api.ts'), 'utf8');
const workflowFunctionSource = readFileSync(resolve(currentDir, '../../supabase/functions/form-workflows/index.ts'), 'utf8');
const formFillNodeSource = readFileSync(resolve(currentDir, '../components/form-tester/nodes/FormFillNode.tsx'), 'utf8');
const genericNodeSource = readFileSync(resolve(currentDir, '../components/form-tester/nodes/GenericActionNode.tsx'), 'utf8');
const submitNodeSource = readFileSync(resolve(currentDir, '../components/form-tester/nodes/SubmitNode.tsx'), 'utf8');
const assertNodeSource = readFileSync(resolve(currentDir, '../components/form-tester/nodes/AssertNode.tsx'), 'utf8');
const conditionNodeSource = readFileSync(resolve(currentDir, '../components/form-tester/nodes/ConditionNode.tsx'), 'utf8');
const aiAssistantSource = readFileSync(resolve(currentDir, '../components/form-tester/builder/AIAssistantPanel.tsx'), 'utf8');
const campaignPlanSource = readFileSync(resolve(currentDir, '../components/form-tester/CampaignPlanWorkspace.tsx'), 'utf8');
const campaignResultsSource = readFileSync(resolve(currentDir, '../components/form-tester/CampaignResultsDashboard.tsx'), 'utf8');
const fieldConfigSource = readFileSync(resolve(currentDir, '../components/form-tester/FieldConfigPanel.tsx'), 'utf8');
const appLayoutSource = readFileSync(resolve(currentDir, '../components/layout/AppLayout.tsx'), 'utf8');

describe('Form Tester n8n-like builder contract', () => {
  it('renders the new three-panel builder shell', () => {
    expect(workflowBuilderSource).toContain('WorkflowBuilderShell');
    expect(workflowBuilderSource).toContain('ScenarioSidebar');
    expect(workflowBuilderSource).toContain('WorkflowCanvas');
    expect(workflowBuilderSource).toContain('NodeInspectorPanel');
  });

  it('renders all executable backend node kinds', () => {
    for (const nodeKind of [
      'navigate',
      'fill',
      'select',
      'check',
      'upload',
      'click',
      'submit',
      'wait',
      'condition',
      'assert',
      'screenshot',
      'inspect_response',
    ]) {
      expect(workflowBuilderSource).toContain(`${nodeKind}:`);
    }
  });

  it('allows dragging and typed connections without reloading the builder', () => {
    expect(workflowCanvasSource).toContain('nodesDraggable={isEditable}');
    expect(workflowCanvasSource).toContain('nodesConnectable={isEditable}');
    expect(workflowCanvasSource).toContain('onConnect=');
    expect(workflowCanvasSource).toContain('onEdgesDelete=');
    expect(workflowCanvasSource).toContain('wouldCreateCycle');
    expect(workflowCanvasSource).toContain('onNodeDragStop');
    expect(workflowCanvasSource).toContain('window.setTimeout');
  });

  it('persists node positions through the API and edge function', () => {
    expect(workflowHookSource).toContain('updateNodePositions');
    expect(apiSource).toContain('node_position_updates: payload.nodePositionUpdates ?? []');
    expect(workflowFunctionSource).toContain('node_position_updates');
    expect(workflowFunctionSource).toContain(".eq('workflow_id', workflowId)");
    expect(workflowFunctionSource).toContain('Position de noeud invalide');
    const updateNodePositionsBody = workflowHookSource.slice(
      workflowHookSource.indexOf('const updateNodePositions'),
      workflowHookSource.indexOf('const addNode'),
    );
    expect(updateNodePositionsBody).not.toContain('await reload()');
  });

  it('loads active execution details so artifacts can be signed for live preview', () => {
    expect(workflowHookSource).toContain('activeExecutionDetail');
    expect(workflowHookSource).toContain('formTesterApi.getExecution(activeExecutionId)');
    expect(workflowCanvasSource).toContain('Preview live');
  });

  it('uses a full-width responsive workspace with drawers below 1440px', () => {
    expect(workflowBuilderShellSource).toContain('100dvh');
    expect(workflowBuilderShellSource).toContain('min-[1440px]:grid');
    expect(workflowBuilderShellSource).toContain('min-[1440px]:grid-cols-[280px_minmax(0,1fr)_360px]');
    expect(workflowBuilderShellSource).toContain('Champs');
    expect(workflowBuilderShellSource).toContain('Inspecteur');
    expect(workflowBuilderShellSource).toContain('w-[92vw]');
    expect(appLayoutSource).toContain('isFormBuilderRoute');
    expect(appLayoutSource).toContain('max-w-none');
    expect(scenarioSidebarSource).toContain('h-full w-full max-w-full min-w-0 overflow-hidden');
    expect(scenarioSidebarSource).toContain('box-border w-full max-w-full');
    expect(scenarioSidebarSource).toContain('mt-3 space-y-2 text-xs');
    expect(scenarioSidebarSource).not.toContain('grid-cols-2 gap-2 text-xs');
    expect(scenarioSidebarSource).toContain('max-w-full overflow-hidden text-ellipsis whitespace-nowrap');
  });

  it('uses compact logo-style nodes with click inspector details', () => {
    for (const nodeSource of [formFillNodeSource, genericNodeSource, submitNodeSource, assertNodeSource]) {
      expect(nodeSource).toContain('h-16 w-16');
      expect(nodeSource).toContain('rounded-2xl');
    }
    expect(workflowBuilderSource).toContain('onNodeSelect={setSelectedNodeId}');
    expect(workflowBuilderSource).toContain('selectedNode={selectedNode}');
  });

  it('renders true/false and success/failure branch handles', () => {
    expect(conditionNodeSource).toContain('id="true"');
    expect(conditionNodeSource).toContain('id="false"');
    expect(submitNodeSource).toContain('id="success"');
    expect(submitNodeSource).toContain('id="failure"');
    expect(workflowBuilderSource).toContain('sourceHandle: branchKey');
  });

  it('exposes AI case generation and grouped execution in the inspector', () => {
    expect(aiAssistantSource).toContain('Generer le plan');
    expect(aiAssistantSource).toContain('Type de formulaire');
    expect(aiAssistantSource).toContain('Seuil non concluant');
    expect(aiAssistantSource).toContain('Preuves actives');
    expect(aiAssistantSource).toContain('Matrice de validation');
    expect(aiAssistantSource).toContain('Tout executer');
    expect(aiAssistantSource).toContain('Toutes les donnees soumises');
    expect(aiAssistantSource).toContain('expandedCaseId');
    expect(aiAssistantSource).toContain('sticky bottom-0');
    expect(workflowBuilderSource).toContain('onGenerateTestCases={generateTestCases}');
    expect(workflowBuilderSource).toContain('onExecuteAllCases={executeAllCases}');
  });

  it('configures any field-backed executable node, not only legacy form_fill nodes', () => {
    expect(workflowBuilderSource).toContain('selectedNode={selectedNode}');
    expect(workflowBuilderSource).not.toContain("node.type === 'form_fill').length");
    expect(nodeInspectorSource).toContain('selectedNode.field ?');
    expect(nodeInspectorSource).not.toContain("selectedNode.type === 'form_fill' && selectedNode.field");
  });

  it('keeps semantic internals out of the business-facing UI', () => {
    const visibleSources = [
      workflowBuilderSource,
      nodeInspectorSource,
      scenarioSidebarSource,
      aiAssistantSource,
      campaignPlanSource,
      campaignResultsSource,
      fieldConfigSource,
    ].join('\n');

    for (const hiddenLabel of [
      'Fallback heuristique',
      'Suggerer',
      'Suggérer',
      'Remplir avec IA',
      'Confiance',
      'Méthode',
      'Effets possibles',
      'message_reel_possible',
      'Qualification de la référence',
      'Référence retenue',
      'Candidat secondaire',
      'Comparaison au nominal',
      'Assistant IA',
    ]) {
      expect(visibleSources).not.toContain(hiddenLabel);
    }
    expect(aiAssistantSource).toContain('Generer le plan');
    expect(nodeInspectorSource).toContain('Scénarios de test');
  });

  it('does not show approval controls when there is no pending scenario version', () => {
    expect(workflowBuilderSource).toContain('pendingScenarioVersion');
    expect(workflowBuilderSource).toContain('Boolean(pendingScenarioVersion');
    expect(workflowBuilderSource).toContain('Signal detecte:');
  });
});
