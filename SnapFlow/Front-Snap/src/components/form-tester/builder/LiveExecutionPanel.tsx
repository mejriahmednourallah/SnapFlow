import { Loader2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { WorkflowExecutionDetail } from '@/lib/form-tester/types';

interface LiveExecutionPanelProps {
  execution: WorkflowExecutionDetail | null;
  onStop?: (executionId: string) => void;
}

function latestScreenshotUrl(execution: WorkflowExecutionDetail | null): string | null {
  if (!execution) return null;
  const screenshots = execution.artifacts
    .filter((artifact) => artifact.artifact_type === 'screenshot' && artifact.signed_url)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return screenshots[0]?.signed_url ?? null;
}

export function LiveExecutionPanel({ execution, onStop }: LiveExecutionPanelProps) {
  const progressTotal = execution?.progress_total ?? execution?.steps.length ?? 0;
  const progressCompleted = execution?.progress_completed ?? execution?.steps.filter((step) => step.status !== 'queued').length ?? 0;
  const progress = progressTotal > 0 ? Math.round((progressCompleted / progressTotal) * 100) : 0;
  const screenshotUrl = latestScreenshotUrl(execution);
  const recentLogs = execution?.logs.slice(-5).reverse() ?? [];
  const isActive = execution ? ['queued', 'running', 'stopping'].includes(execution.status) : false;

  if (!execution) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        Aucune execution active. Lancez le workflow pour voir la progression, les logs et la derniere capture ici.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Execution live</p>
            <div className="mt-1 flex items-center gap-2">
              {isActive ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : null}
              <span className="text-sm font-semibold text-foreground">{execution.status}</span>
            </div>
          </div>
          {isActive && onStop ? (
            <Button variant="outline" size="sm" onClick={() => onStop(execution.id)}>
              <Square className="mr-1 h-3.5 w-3.5" />
              Arreter
            </Button>
          ) : null}
        </div>
        <div className="mt-4 space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progression</span>
            <span>
              {progressCompleted}/{progressTotal || '?'} etapes
            </span>
          </div>
          <Progress value={progress} />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-background">
        <div className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Derniere capture
        </div>
        {screenshotUrl ? (
          <img src={screenshotUrl} alt="Derniere capture d execution" className="max-h-52 w-full object-cover object-top" />
        ) : (
          <div className="p-4 text-xs text-muted-foreground">Aucune capture signee disponible pour cette execution.</div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-background">
        <div className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Logs recents
        </div>
        <div className="space-y-2 p-3">
          {recentLogs.length > 0 ? (
            recentLogs.map((log) => (
              <div key={log.id} className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span>{new Date(log.created_at).toLocaleTimeString()}</span>
                  <span>{log.level}</span>
                </div>
                <p className="mt-1 text-foreground">{log.message}</p>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Aucun log recent.</p>
          )}
        </div>
      </div>
    </div>
  );
}
