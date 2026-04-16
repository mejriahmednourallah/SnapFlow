import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExecutionResults } from '@/components/form-tester/ExecutionResults';
import { useFormWorkflowBuilder } from '@/hooks/useFormWorkflowBuilder';

interface FormTesterResultsContentProps {
  workflowId: string;
}

function FormTesterResultsContent({ workflowId }: FormTesterResultsContentProps) {
  const navigate = useNavigate();
  const { workflow, results, isLoading, error } = useFormWorkflowBuilder(workflowId);

  return (
    <div className="space-y-5 fade-in">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <History className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Résultats Form Tester</h1>
            <p className="text-sm text-muted-foreground">
              {workflow ? `Workflow: ${workflow.name}` : 'Historique des exécutions'}
            </p>
          </div>
        </div>

        <Button variant="outline" onClick={() => navigate(`/app/workflows/form-tester/${workflowId}`)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour au builder
        </Button>
      </header>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <ExecutionResults results={results} isLoading={isLoading} />
    </div>
  );
}

const FormTesterResultsPage = () => {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return <Navigate to="/app/workflows/form-tester" replace />;
  }

  return <FormTesterResultsContent workflowId={id} />;
};

export default FormTesterResultsPage;
