import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, SquareArrowOutUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { StatusBadge } from '@/components/form-tester/StatusBadge';
import { formatDateTime } from '@/lib/dateFormat';

interface ProjectWorkflowSummaryProps {
  projectId: string;
}

interface WorkflowSummaryRow {
  id: string;
  name: string;
  status: string;
  updated_at: string;
  latest_result: {
    status: string;
    executed_at: string | null;
  } | null;
}

export function ProjectWorkflowSummary({ projectId }: ProjectWorkflowSummaryProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummaryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setIsLoading(true);
      const { data } = await supabase
        .from('form_workflows')
        .select('id, name, status, updated_at')
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false });

      const rows = (data as Array<{ id: string; name: string; status: string; updated_at: string }> | null) ?? [];
      const ids = rows.map((row) => row.id);
      let latestByWorkflow = new Map<string, { status: string; executed_at: string | null }>();

      if (ids.length > 0) {
        const { data: results } = await (supabase.from('workflow_results' as never) as any)
          .select('workflow_id, status, executed_at')
          .in('workflow_id', ids)
          .order('executed_at', { ascending: false });
        latestByWorkflow = new Map();
        for (const result of results ?? []) {
          if (!latestByWorkflow.has(result.workflow_id)) {
            latestByWorkflow.set(result.workflow_id, { status: result.status, executed_at: result.executed_at });
          }
        }
      }

      if (!mounted) return;
      setWorkflows(rows.map((row) => ({ ...row, latest_result: latestByWorkflow.get(row.id) ?? null })));
      setIsLoading(false);
    };
    void load();
    return () => { mounted = false; };
  }, [projectId]);

  return (
    <section className="glass-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            Workflows lies au projet
          </h3>
          <p className="text-xs text-muted-foreground">Tests fonctionnels rattaches a ce projet.</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/app/workflows/form-tester">Voir tout</Link>
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement...</p>
      ) : workflows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          Aucun workflow lie a ce projet.
        </p>
      ) : (
        <div className="space-y-2">
          {workflows.map((workflow) => (
            <article key={workflow.id} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{workflow.name}</p>
                  <StatusBadge status={workflow.status as any} size="sm" />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {workflow.latest_result
                    ? `Derniere execution: ${workflow.latest_result.status}${workflow.latest_result.executed_at ? ` - ${formatDateTime(workflow.latest_result.executed_at)}` : ''}`
                    : `Modifie le ${formatDateTime(workflow.updated_at)}`}
                </p>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to={`/app/workflows/form-tester/${workflow.id}`}>
                  <SquareArrowOutUpRight className="mr-1 h-4 w-4" />
                  Ouvrir
                </Link>
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
