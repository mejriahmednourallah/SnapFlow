import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const readSource = (relativePath: string) => readFileSync(resolve(root, relativePath), 'utf8');

describe('workflow project link UI contract', () => {
  const projectSearchSelect = readSource('components/form-tester/ProjectSearchSelect.tsx');
  const createWorkflowModal = readSource('components/form-tester/CreateWorkflowModal.tsx');
  const workflowList = readSource('components/form-tester/WorkflowList.tsx');
  const workflowBuilder = readSource('components/form-tester/WorkflowBuilder.tsx');
  const builderHook = readSource('hooks/useFormWorkflowBuilder.ts');
  const api = readSource('lib/form-tester/api.ts');

  it('provides a searchable optional project selector when creating and filtering workflows', () => {
    expect(projectSearchSelect).toContain('CommandInput');
    expect(projectSearchSelect).toContain('Rechercher un projet...');
    expect(projectSearchSelect).toContain("from('projects')");
    expect(projectSearchSelect).toContain('Workflow global');
    expect(createWorkflowModal).toContain('Projet lié');
    expect(createWorkflowModal).toContain('ProjectSearchSelect');
    expect(createWorkflowModal).toContain('formData.project_id');
    expect(workflowList).toContain('ProjectSearchSelect');
    expect(workflowList).toContain('Tous les projets');
    expect(workflowList).toContain('newProjectId');
  });

  it('allows editing the workflow project link from the builder', () => {
    expect(workflowBuilder).toContain('ProjectSearchSelect');
    expect(workflowBuilder).toContain('updateWorkflowProject');
    expect(builderHook).toContain('updateWorkflowProject');
    expect(builderHook).toContain('formTesterApi.updateWorkflow({ workflowId, projectId })');
    expect(api).toContain('project_id: payload.projectId');
  });
});
