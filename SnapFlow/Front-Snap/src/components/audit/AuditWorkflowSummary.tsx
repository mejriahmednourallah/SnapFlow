import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { StatusBadge } from '@/components/form-tester/StatusBadge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/dateFormat';

interface AuditWorkflowSummaryProps {
  projectId?: string | null;
}

interface AuditWorkflowRow {
  id: string;
  name: string;
  status: string;
  latest_result?: { status: string; executed_at: string | null } | null;
}

export function AuditWorkflowSummary({ projectId }: AuditWorkflowSummaryProps) {
  const [workflows, setWorkflows] = useState<AuditWorkflowRow[]>([]);

  useEffect(() => {
    if (!projectId) {
      setWorkflows([]);
      return;
    }
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from('form_workflows')
        .select('id, name, status')
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false });
      const rows = (data as AuditWorkflowRow[] | null) ?? [];
      const ids = rows.map((row) => row.id);
      const latest = new Map<string, { status: string; executed_at: string | null }>();
      if (ids.length > 0) {
        const { data: results } = await (supabase.from('workflow_results' as never) as any)
          .select('workflow_id, status, executed_at')
          .in('workflow_id', ids)
          .order('executed_at', { ascending: false });
        for (const result of results ?? []) {
          if (!latest.has(result.workflow_id)) {
            latest.set(result.workflow_id, { status: result.status, executed_at: result.executed_at });
          }
        }
      }
      if (mounted) {
        setWorkflows(rows.map((row) => ({ ...row, latest_result: latest.get(row.id) ?? null })));
      }
    };
    void load();
    return () => { mounted = false; };
  }, [projectId]);

  if (!projectId || workflows.length === 0) return null;

  return (
    <section className="rounded-md border border-border bg-muted/20 p-3">
      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <ClipboardCheck className="h-4 w-4 text-primary" />
        Workflows fonctionnels lies au projet
      </h4>
      <div className="space-y-2">
        {workflows.map((workflow) => (
          <div key={workflow.id} className="flex flex-col gap-2 rounded-md bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{workflow.name}</p>
                <StatusBadge status={workflow.status as any} size="sm" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {workflow.latest_result
                  ? `Derniere execution: ${workflow.latest_result.status}${workflow.latest_result.executed_at ? ` - ${formatDateTime(workflow.latest_result.executed_at)}` : ''}`
                  : 'Aucune execution enregistree'}
              </p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to={`/app/workflows/form-tester/${workflow.id}`}>Ouvrir</Link>
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
