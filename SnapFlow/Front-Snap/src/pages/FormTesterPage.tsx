import { FlaskConical } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { WorkflowList } from '@/components/form-tester/WorkflowList';

const FormTesterPage = () => {
  const { isAdmin } = useAuth();

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center gap-3">
        <FlaskConical className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Form Tester</h1>
          <p className="text-sm text-muted-foreground">
            Creez, validez et executez des workflows de test de formulaires.
          </p>
        </div>
      </div>

      <WorkflowList isOperator={isAdmin} />
    </div>
  );
};

export default FormTesterPage;
