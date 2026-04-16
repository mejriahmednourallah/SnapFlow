import { useCallback, useEffect, useState } from 'react';
import { formTesterApi } from '@/lib/form-tester/api';
import type { WorkflowResult, WorkflowWithDetails } from '@/lib/form-tester/types';

interface UseFormWorkflowBuilderReturn {
  workflow: WorkflowWithDetails | null;
  results: WorkflowResult[];
  isLoading: boolean;
  isDetecting: boolean;
  isSuggesting: boolean;
  isSaving: boolean;
  isSubmitting: boolean;
  isApproving: boolean;
  isExecuting: boolean;
  error: string | null;
  reload: () => Promise<void>;
  loadResults: () => Promise<void>;
  detect: () => Promise<void>;
  suggestAll: () => Promise<void>;
  suggestOne: (fieldId: string) => Promise<void>;
  updateFieldValue: (fieldId: string, value: string) => Promise<void>;
  submitForApproval: () => Promise<void>;
  approve: (note?: string) => Promise<void>;
  reject: (note: string) => Promise<void>;
  execute: () => Promise<void>;
}

export function useFormWorkflowBuilder(workflowId: string): UseFormWorkflowBuilderReturn {
  const [workflow, setWorkflow] = useState<WorkflowWithDetails | null>(null);
  const [results, setResults] = useState<WorkflowResult[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await formTesterApi.getWorkflow(workflowId);
      setWorkflow(data);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Impossible de charger le workflow';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [workflowId]);

  const loadResults = useCallback(async (): Promise<void> => {
    try {
      const data = await formTesterApi.listResults(workflowId);
      setResults(data);
    } catch (resultsError) {
      const message = resultsError instanceof Error ? resultsError.message : 'Impossible de charger les résultats';
      setError(message);
    }
  }, [workflowId]);

  const detect = useCallback(async (): Promise<void> => {
    setIsDetecting(true);
    setError(null);
    try {
      await formTesterApi.detectForms(workflowId);
      await reload();
    } catch (detectError) {
      const message = detectError instanceof Error ? detectError.message : 'Échec de la détection';
      setError(message);
    } finally {
      setIsDetecting(false);
    }
  }, [reload, workflowId]);

  const suggestAll = useCallback(async (): Promise<void> => {
    setIsSuggesting(true);
    setError(null);
    try {
      await formTesterApi.getSuggestions(workflowId);
      await reload();
    } catch (suggestError) {
      const message = suggestError instanceof Error ? suggestError.message : 'Échec des suggestions IA';
      setError(message);
    } finally {
      setIsSuggesting(false);
    }
  }, [reload, workflowId]);

  const suggestOne = useCallback(async (fieldId: string): Promise<void> => {
    setIsSuggesting(true);
    setError(null);
    try {
      await formTesterApi.getSuggestions(workflowId, [fieldId]);
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
  }, [reload, workflowId]);

  const submitForApproval = useCallback(async (): Promise<void> => {
    setIsSubmitting(true);
    setError(null);
    try {
      await formTesterApi.submitForApproval(workflowId);
      await reload();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Échec de soumission';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [reload, workflowId]);

  const approve = useCallback(async (note?: string): Promise<void> => {
    setIsApproving(true);
    setError(null);
    try {
      await formTesterApi.approveWorkflow(workflowId, { action: 'approve', note });
      await reload();
    } catch (approveError) {
      const message = approveError instanceof Error ? approveError.message : 'Échec d approbation';
      setError(message);
    } finally {
      setIsApproving(false);
    }
  }, [reload, workflowId]);

  const reject = useCallback(async (note: string): Promise<void> => {
    setIsApproving(true);
    setError(null);
    try {
      await formTesterApi.approveWorkflow(workflowId, { action: 'reject', note });
      await reload();
    } catch (rejectError) {
      const message = rejectError instanceof Error ? rejectError.message : 'Échec du rejet';
      setError(message);
    } finally {
      setIsApproving(false);
    }
  }, [reload, workflowId]);

  const execute = useCallback(async (): Promise<void> => {
    setIsExecuting(true);
    setError(null);
    try {
      await formTesterApi.executeWorkflow(workflowId);
      await Promise.all([reload(), loadResults()]);
    } catch (executeError) {
      const message = executeError instanceof Error ? executeError.message : 'Échec de l exécution';
      setError(message);
    } finally {
      setIsExecuting(false);
    }
  }, [loadResults, reload, workflowId]);

  useEffect(() => {
    void reload();
    void loadResults();
  }, [loadResults, reload]);

  return {
    workflow,
    results,
    isLoading,
    isDetecting,
    isSuggesting,
    isSaving,
    isSubmitting,
    isApproving,
    isExecuting,
    error,
    reload,
    loadResults,
    detect,
    suggestAll,
    suggestOne,
    updateFieldValue,
    submitForApproval,
    approve,
    reject,
    execute,
  };
}
