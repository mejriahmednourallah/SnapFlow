import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExecutionResults } from '@/components/form-tester/ExecutionResults';
import { useFormWorkflowBuilder } from '@/hooks/useFormWorkflowBuilder';
import { CampaignResultsDashboard } from '@/components/form-tester/CampaignResultsDashboard';

interface FormTesterResultsContentProps {
  workflowId: string;
}

function LegacyResultsContent({ workflowId }: FormTesterResultsContentProps) {
  const navigate = useNavigate();
  const {
    workflow,
    results,
    isLoading,
    error,
    stopExecution,
    retryExecution,
    runStep,
    runFromStep,
    refreshExecution,
  } = useFormWorkflowBuilder(workflowId);

  return (
    <div className="space-y-5 fade-in">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <History className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Exécutions historiques</h1>
            <p className="text-sm text-muted-foreground">
              {workflow ? `Workflow: ${workflow.name}` : 'Historique des executions'}
            </p>
          </div>
        </div>

        <Button variant="outline" onClick={() => navigate(`/app/workflows/form-tester/${workflowId}`)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour au builder
        </Button>
      </header>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <ExecutionResults
        results={results}
        isLoading={isLoading}
        onStop={stopExecution}
        onRetry={retryExecution}
        onRunStep={runStep}
        onRunFromStep={runFromStep}
        onRefreshExecution={refreshExecution}
      />
    </div>
  );
}

function FormTesterResultsContent({ workflowId }: FormTesterResultsContentProps) {
  const [searchParams] = useSearchParams();
  return searchParams.get('view') === 'legacy'
    ? <LegacyResultsContent workflowId={workflowId} />
    : <CampaignResultsDashboard workflowId={workflowId} />;
}

const FormTesterResultsPage = () => {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return <Navigate to="/app/workflows/form-tester" replace />;
  }

  return <FormTesterResultsContent workflowId={id} />;
};

export default FormTesterResultsPage;
