import { useCallback, useEffect, useState } from 'react';
import { formTesterApi } from '@/lib/form-tester/api';
import type { FormWorkflow, WorkflowListItem, WorkflowStatus } from '@/lib/form-tester/types';

interface UseFormTesterReturn {
  workflows: WorkflowListItem[];
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
  reload: (status?: WorkflowStatus) => Promise<void>;
  createWorkflow: (name: string, targetUrl: string) => Promise<FormWorkflow>;
}

export function useFormTester(isOperator: boolean): UseFormTesterReturn {
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (status?: WorkflowStatus): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await formTesterApi.listWorkflows({
        status,
        operatorView: isOperator,
      });
      setWorkflows(data);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Impossible de charger les workflows';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [isOperator]);

  const createWorkflow = useCallback(async (name: string, targetUrl: string): Promise<FormWorkflow> => {
    setIsCreating(true);
    setError(null);
    try {
      const workflow = await formTesterApi.createWorkflow(name, targetUrl);
      return workflow;
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Impossible de créer le workflow';
      setError(message);
      throw new Error(message);
    } finally {
      setIsCreating(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    workflows,
    isLoading,
    isCreating,
    error,
    reload,
    createWorkflow,
  };
}
