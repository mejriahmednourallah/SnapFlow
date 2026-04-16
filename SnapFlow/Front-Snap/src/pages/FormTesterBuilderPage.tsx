import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { WorkflowBuilder } from '@/components/form-tester/WorkflowBuilder';

const FormTesterBuilderPage = () => {
  const { id } = useParams<{ id: string }>();
  const { isAdmin } = useAuth();

  if (!id) {
    return <Navigate to="/app/workflows/form-tester" replace />;
  }

  return (
    <div className="space-y-4 fade-in">
      <WorkflowBuilder workflowId={id} isOperator={isAdmin} />
    </div>
  );
};

export default FormTesterBuilderPage;
