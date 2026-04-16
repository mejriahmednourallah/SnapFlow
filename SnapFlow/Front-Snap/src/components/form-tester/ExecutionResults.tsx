import { Clock3, Image as ImageIcon } from 'lucide-react';
import type { WorkflowResult } from '@/lib/form-tester/types';
import { StatusBadge } from './StatusBadge';

interface ExecutionResultsProps {
  results: WorkflowResult[];
  isLoading?: boolean;
}

export function ExecutionResults({ results, isLoading = false }: ExecutionResultsProps) {
  if (isLoading) {
    return <div className="glass-card p-6 text-sm text-muted-foreground">Chargement des résultats...</div>;
  }

  if (results.length === 0) {
    return <div className="glass-card p-6 text-sm text-muted-foreground">Aucune exécution disponible pour ce workflow.</div>;
  }

  return (
    <div className="space-y-4">
      {results.map((result) => (
        <article key={result.id} className="glass-card p-5 space-y-3">
          <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2">
              <StatusBadge status={result.status} size="sm" />
              <span className="text-xs text-muted-foreground">
                {new Date(result.executed_at).toLocaleString('fr-FR')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" />
              {result.duration_ms ?? 0} ms
            </div>
          </header>

          {result.error_message ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {result.error_message}
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assertions</p>
            {result.assertions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune assertion enregistrée.</p>
            ) : (
              <div className="space-y-1.5">
                {result.assertions.map((assertion, index) => (
                  <div key={`${result.id}-${index}`} className="rounded-md border border-border p-3 text-sm">
                    <p className="font-medium text-foreground">{assertion.label}</p>
                    <p className="text-xs text-muted-foreground mt-1">Attendu: {assertion.expected}</p>
                    <p className="text-xs text-muted-foreground">Actuel: {assertion.actual}</p>
                    <p className={`text-xs mt-1 ${assertion.passed ? 'text-emerald-600' : 'text-red-600'}`}>
                      {assertion.passed ? 'Validation réussie' : 'Validation échouée'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {result.screenshot_url ? (
            <a
              href={result.screenshot_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ImageIcon className="h-4 w-4" />
              Voir la capture d écran
            </a>
          ) : null}
        </article>
      ))}
    </div>
  );
}
