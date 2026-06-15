import { Navigate, useParams } from 'react-router-dom';
import { CampaignPlanWorkspace } from '@/components/form-tester/CampaignPlanWorkspace';

const FormTesterCampaignPlanPage = () => {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/app/workflows/form-tester" replace />;
  return <CampaignPlanWorkspace workflowId={id} />;
};

export default FormTesterCampaignPlanPage;
