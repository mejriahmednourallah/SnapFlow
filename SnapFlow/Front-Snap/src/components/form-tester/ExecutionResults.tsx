import { useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  CornerDownRight,
  Download,
  Image as ImageIcon,
  PlayCircle,
  RotateCcw,
  Square,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getExecutionSourceDisplay } from '@/lib/form-tester/executionSource';
import type { WorkflowExecutionDetail } from '@/lib/form-tester/types';
import { StatusBadge } from './StatusBadge';

interface ExecutionResultsProps {
  results: WorkflowExecutionDetail[];
  isLoading?: boolean;
  onStop?: (executionId: string) => Promise<void>;
  onRetry?: (executionId: string) => Promise<void>;
  onRunStep?: (executionId: string, nodeId: string) => Promise<void>;
  onRunFromStep?: (executionId: string, nodeId: string) => Promise<void>;
  onRefreshExecution?: (executionId: string) => Promise<void>;
}

function sourceToneClasses(tone: ReturnType<typeof getExecutionSourceDisplay>['tone']): string {
  if (tone === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200';
  }
  if (tone === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200';
  }
  if (tone === 'danger') {
    return 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200';
  }
  return 'border-border bg-muted/40 text-muted-foreground';
}

function compactValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatDuration(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Non mesure';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)} s`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function oracleFor(result: WorkflowExecutionDetail): Record<string, unknown> | null {
  for (const step of [...result.steps].reverse()) {
    const oracle = asRecord(step.output_redacted?.oracle);
    if (Object.keys(oracle).length > 0) return oracle;
  }
  return null;
}

function signalLabel(type: string): string {
  const labels: Record<string, string> = {
    success_message_present: 'Message de confirmation',
    response_status_range: 'Statut HTTP attendu',
    response_status: 'Statut HTTP',
    dom_changed: 'Contenu de page modifie',
    url_changed: 'URL modifiee',
    form_disappeared: 'Formulaire masque ou retire',
    form_invalid: 'Champs invalides',
    validation_message_present: 'Message de validation',
    text_present: 'Texte attendu',
    text_absent: 'Texte absent',
    network_request_matching: 'Requete de soumission',
  };
  return labels[type] ?? type.replaceAll('_', ' ');
}

function expectedOutcomeLabel(outcome: string | null | undefined): string {
  const labels: Record<string, string> = {
    success: 'Soumission acceptee',
    validation_error: 'Blocage des donnees invalides',
    business_rejection: 'Refus metier controle',
    server_error: 'Erreur serveur attendue',
    blocked: 'Parcours bloque attendu',
  };
  return labels[outcome ?? ''] ?? 'Comportement attendu a verifier';
}

function businessStatusLabel(result: WorkflowExecutionDetail): string {
  const outcome = result.scenario?.expected_outcome;
  if (result.status === 'passed' || result.status === 'pass') {
    if (outcome === 'validation_error') return 'Conforme';
    if (outcome === 'business_rejection') return 'Refus attendu confirme';
    if (outcome === 'server_error') return 'Erreur attendue confirmee';
    if (outcome === 'blocked') return 'Blocage attendu confirme';
    return 'Soumission confirmee';
  }
  if (result.status === 'inconclusive' || result.status === 'needs_review') {
    return 'A confirmer';
  }
  if (result.status === 'failed' || result.status === 'fail') {
    return outcome === 'validation_error'
      ? 'Acceptation inattendue'
      : 'Comportement attendu non confirme';
  }
  if (result.status === 'error') return 'Test interrompu';
  return '';
}

function businessOutcomeExplanation(result: WorkflowExecutionDetail): string | null {
  if (result.scenario?.expected_outcome !== 'validation_error') return null;

  const definition = result.scenario.case_definition ?? {};
  const validationScope = definition.validation_scope ?? 'form';
  const targetField = definition.target_field_name ?? definition.target_field_id;
  const passed = result.status === 'passed' || result.status === 'pass';
  const failed = result.status === 'failed' || result.status === 'fail';

  if (passed && validationScope === 'field' && targetField) {
    return `Le formulaire a correctement bloque la soumission car le champ « ${targetField} » est invalide.`;
  }
  if (passed) {
    return 'La soumission a ete bloquee par la validation du formulaire. Ce scenario autorise une validation globale.';
  }
  if (failed) {
    return targetField
      ? `Le formulaire a accepte la soumission alors que le champ « ${targetField} » devait etre refuse.`
      : 'Le formulaire a accepte des donnees que ce scenario attendait de voir bloquees.';
  }
  return 'Les preuves disponibles ne permettent pas encore de confirmer que les donnees invalides ont ete bloquees.';
}

function businessFailureMessage(reason: string | null | undefined): string | null {
  const messages: Record<string, string> = {
    submission_outcome_inconclusive:
      'La soumission a produit une reponse, mais aucune confirmation suffisamment fiable n a ete detectee.',
    submission_outcome_not_observed:
      'Le comportement attendu n a pas ete observe apres la soumission.',
    required_value_missing:
      'Une donnee obligatoire du scenario est manquante. Completez-la avant de relancer le test.',
    expected_validation_error_not_observed:
      'Le formulaire semble avoir accepte une donnee qui devait etre refusee.',
    form_validation_blocked:
      'Le navigateur a bloque la soumission a cause d un champ invalide.',
  };
  return reason ? messages[reason] ?? null : null;
}

function stepLabel(type: string): string {
  const labels: Record<string, string> = {
    trigger: 'Ouvrir la page',
    navigate: 'Acceder au formulaire',
    fill: 'Renseigner un champ',
    form_fill: 'Renseigner un champ',
    select: 'Choisir une option',
    check: 'Cocher une option',
    upload: 'Ajouter un fichier',
    click: 'Cliquer',
    submit: 'Envoyer le formulaire',
    wait: 'Attendre la reponse',
    inspect_response: 'Analyser la reponse',
    condition: 'Interpreter le resultat',
    assert: 'Verifier le resultat attendu',
    screenshot: 'Conserver une preuve visuelle',
  };
  return labels[type] ?? type.replaceAll('_', ' ');
}

function stepStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    passed: 'Termine',
    failed: 'Non conforme',
    error: 'Interrompu',
    blocked: 'Bloque',
    inconclusive: 'A confirmer',
    skipped: 'Non applicable',
    running: 'En cours',
    queued: 'En attente',
    cancelled: 'Annule',
  };
  return labels[status] ?? status;
}

const ACTIVE_STATUSES = new Set(['queued', 'running', 'stopping']);
const TERMINAL_BROWSER_STATUSES = new Set(['passed', 'failed', 'error', 'blocked', 'cancelled', 'pass', 'fail', 'needs_review', 'inconclusive']);

export function ExecutionResults({
  results,
  isLoading = false,
  onStop,
  onRetry,
  onRunStep,
  onRunFromStep,
  onRefreshExecution,
}: ExecutionResultsProps) {
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  if (isLoading) {
    return <div className="glass-card p-6 text-sm text-muted-foreground">Chargement des resultats...</div>;
  }

  if (results.length === 0) {
    return <div className="glass-card p-6 text-sm text-muted-foreground">Aucune execution disponible pour ce workflow.</div>;
  }

  return (
    <div className="space-y-4">
      {results.map((result) => {
        const source = getExecutionSourceDisplay(result.execution_source);
        const hasMeasuredDuration = typeof result.duration_ms === 'number' && result.duration_ms > 0;
        const isHistoricalIncomplete = result.execution_source === 'legacy_unknown';
        const emptyTechnicalError =
          result.status === 'error' &&
          !result.error_message &&
          result.steps.length === 0 &&
          result.step_trace.length === 0;
        const failedStep = result.steps.find((step) =>
          ['error', 'failed', 'blocked', 'inconclusive'].includes(step.status),
        );
        const failedStepArtifacts = failedStep
          ? result.artifacts.filter((artifact) => artifact.step_result_id === failedStep.id)
          : [];
        const isActive = ACTIVE_STATUSES.has(result.status);
        const canControlBrowserExecution =
          result.execution_source === 'chromium' &&
          TERMINAL_BROWSER_STATUSES.has(result.status) &&
          !isHistoricalIncomplete;
        const oracle = oracleFor(result);
        const oracleEvidence = Array.isArray(oracle?.evidence)
          ? oracle.evidence.filter(
              (item): item is Record<string, unknown> =>
                Boolean(item && typeof item === 'object'),
            )
          : [];
        const screenshots = result.artifacts.filter(
          (artifact) => artifact.artifact_type === 'screenshot',
        );
        const htmlSnapshots = result.artifacts.filter(
          (artifact) => artifact.artifact_type === 'html_snapshot',
        );
        const scenarioPurpose =
          typeof result.scenario?.case_definition?.purpose === 'string'
            ? result.scenario.case_definition.purpose
            : result.scenario?.description;
        const businessFailure = businessFailureMessage(result.failure_reason);
        const businessExplanation = businessOutcomeExplanation(result);
        const showSourceNotice = !source.isRealBrowser;

        return (
          <article key={result.id} className="glass-card p-5 space-y-3">
            {showSourceNotice ? (
              <div className={`rounded-md border px-3 py-2 text-xs ${sourceToneClasses(source.tone)}`}>
                <span className="font-semibold">{source.label}</span>
                <span className="ml-2">{source.description}</span>
              </div>
            ) : null}

            <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2">
                {isHistoricalIncomplete ? (
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                    Non interpretable
                  </span>
                ) : (
                  <StatusBadge
                    status={result.status}
                    size="sm"
                    label={businessStatusLabel(result) || undefined}
                  />
                )}
                <span className="text-xs text-muted-foreground">
                  {new Date(result.executed_at).toLocaleString('fr-FR')}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                {hasMeasuredDuration ? `${result.duration_ms} ms` : 'Duree non mesuree'}
                {onRetry && canControlBrowserExecution ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => void onRetry(result.id)}
                  >
                    <RotateCcw className="mr-1.5 h-3 w-3" />
                    Relancer
                  </Button>
                ) : null}
                {onStop && isActive ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={result.status === 'stopping'}
                    onClick={() => void onStop(result.id)}
                  >
                    <Square className="mr-1.5 h-3 w-3" />
                    Arreter
                  </Button>
                ) : null}
              </div>
            </header>

            {result.scenario ? (
              <section className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Scenario
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-foreground">{result.scenario.name}</span>
                  <span className="text-xs text-muted-foreground">
                    Objectif: {expectedOutcomeLabel(result.scenario.expected_outcome)}
                  </span>
                </div>
                {scenarioPurpose ? (
                  <p className="mt-1 text-sm text-muted-foreground">{scenarioPurpose}</p>
                ) : null}
              </section>
            ) : null}

            {businessExplanation ? (
              <p className="rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground">
                {businessExplanation}
              </p>
            ) : null}

            <div className="grid gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-md border border-border px-3 py-2">
                <span className="text-muted-foreground">Attente en file</span>
                <p className="mt-1 font-semibold text-foreground">
                  {formatDuration(result.queue_wait_ms)}
                </p>
              </div>
              <div className="rounded-md border border-border px-3 py-2">
                <span className="text-muted-foreground">Duree du test</span>
                <p className="mt-1 font-semibold text-foreground">
                  {formatDuration(result.execution_duration_ms ?? result.duration_ms)}
                </p>
              </div>
              <div className="rounded-md border border-border px-3 py-2">
                <span className="text-muted-foreground">Temps total</span>
                <p className="mt-1 font-semibold text-foreground">
                  {formatDuration(result.total_elapsed_ms)}
                </p>
              </div>
            </div>

            {result.progress_total > 0 ? (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Progression</span>
                  <span>{result.progress_completed}/{result.progress_total} etapes</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width: `${Math.min(100, (result.progress_completed / result.progress_total) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}

            {result.error_message ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {result.error_message}
              </div>
            ) : null}

            {!result.error_message && result.failure_reason && !isHistoricalIncomplete ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                {businessFailure ?? 'Le test n a pas produit une conclusion suffisamment fiable.'}
              </div>
            ) : null}

            {emptyTechnicalError ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                {isHistoricalIncomplete
                  ? 'Cette ancienne tentative est marquee en erreur, mais aucun message, aucune etape et aucune preuve moteur n ont ete enregistres. Aucun verdict fonctionnel ne peut etre tire.'
                  : 'L execution a rencontre une erreur technique sans message detaille. Consultez le journal ou relancez une execution versionnee.'}
              </div>
            ) : null}

            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <div className="rounded-md bg-muted/40 px-3 py-2 truncate">
                Page observee:{' '}
                <span className="font-medium text-foreground">
                  {result.final_url ?? 'non disponible'}
                </span>
              </div>
              <div className="rounded-md bg-muted/40 px-3 py-2">
                Echanges observes:{' '}
                <span className="font-medium text-foreground">
                  {typeof result.network_summary?.requests === 'number'
                    ? `${result.network_summary.requests} requete(s)`
                    : 'non mesure'}
                </span>
              </div>
            </div>

            {failedStep ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
                  Point a verifier
                </p>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <span className="text-muted-foreground">Action: </span>
                    <span className="font-medium text-foreground">{stepLabel(failedStep.step_type)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Resultat: </span>
                    <span className="font-medium text-foreground">{stepStatusLabel(failedStep.status)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Champ: </span>
                    <span className="font-medium text-foreground">{compactValue(failedStep.input_redacted?.field_name)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Preuves: </span>
                    <span className="font-medium text-foreground">
                      {failedStepArtifacts.length > 0
                        ? failedStepArtifacts.map((artifact) => artifact.artifact_type).join(', ')
                        : 'aucune preuve liee a cette etape'}
                    </span>
                  </div>
                </div>
                {failedStep.error_message ? (
                  <p className="mt-2 rounded-md bg-background/70 p-2 text-xs text-destructive">
                    {businessFailure ?? failedStep.error_message}
                  </p>
                ) : null}
              </div>
            ) : null}

            {oracle ? (
              <section className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Criteres de validation
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      Niveau de preuve {Math.round(Number(oracle.score ?? 0) * 100)}% · minimum{' '}
                      {Math.round(Number(oracle.pass_threshold ?? 0.65) * 100)}%
                    </p>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">
                    {oracle.verdict === 'observed'
                      ? 'Confirme'
                      : oracle.verdict === 'inconclusive'
                      ? 'A confirmer'
                      : 'Non confirme'}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {oracleEvidence.map((evidence, index) => {
                    const matched = evidence.matched === true;
                    return (
                      <div
                        key={`${result.id}-oracle-${index}`}
                        className={`rounded-md border p-2 text-xs ${
                          matched
                            ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/20'
                            : 'border-border bg-muted/20'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {matched ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <span className="font-medium text-foreground">
                            {signalLabel(String(evidence.type ?? 'signal'))}
                          </span>
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {matched ? 'Confirme' : 'Non confirme'} · Observation:{' '}
                          {compactValue(evidence.actual)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Verification du comportement attendu
              </p>
              {result.assertions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {result.status === 'queued'
                    ? 'Les assertions seront evaluees par le moteur navigateur pendant l execution.'
                    : isHistoricalIncomplete
                    ? 'Aucune assertion exploitable n a ete conservee pour cette tentative historique.'
                    : result.execution_source === 'simulated_legacy'
                   ? 'Aucune assertion navigateur evaluee. Cette simulation prepare les valeurs sans soumettre le formulaire.'
                    : 'Aucune assertion enregistree.'}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {result.assertions.map((assertion, index) => (
                    <div key={`${result.id}-${index}`} className="rounded-md border border-border p-3 text-sm">
                      <p className="font-medium text-foreground">{assertion.label}</p>
                      <p className="text-xs text-muted-foreground mt-1">Objectif: {assertion.expected}</p>
                      <p className="text-xs text-muted-foreground">Observation: {assertion.actual}</p>
                      <p className={`text-xs mt-1 ${assertion.passed ? 'text-emerald-600' : 'text-red-600'}`}>
                        {assertion.passed ? 'Comportement conforme' : 'Comportement non confirme'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {Array.isArray(result.steps) && result.steps.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Parcours du test
                </p>
                <div className="space-y-1.5">
                  {result.steps.map((step) => (
                    <details key={step.id} className="rounded-md border border-border p-2 text-xs">
                      <summary className="cursor-pointer list-none">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="font-medium text-foreground">
                          {step.sequence_number + 1}. {stepLabel(step.step_type)}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-muted-foreground">{stepStatusLabel(step.status)}</span>
                          {step.node_id && onRunStep && canControlBrowserExecution ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => void onRunStep(result.id, step.node_id!)}
                            >
                              <PlayCircle className="mr-1 h-3 w-3" />
                              Cette etape
                            </Button>
                          ) : null}
                          {step.node_id && onRunFromStep && canControlBrowserExecution ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => void onRunFromStep(result.id, step.node_id!)}
                            >
                              <CornerDownRight className="mr-1 h-3 w-3" />
                              Depuis ici
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      </summary>
                      {step.error_message ? <p className="mt-1 text-destructive">{step.error_message}</p> : null}
                      <div className="mt-2 grid gap-2 border-t border-border pt-2 md:grid-cols-2">
                        <div>
                          <p className="font-semibold text-muted-foreground">Entree</p>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2">
                            {JSON.stringify(step.input_redacted ?? {}, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <p className="font-semibold text-muted-foreground">Sortie</p>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2">
                            {JSON.stringify(step.output_redacted ?? {}, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            ) : null}

            {screenshots.length > 0 || htmlSnapshots.length > 0 ? (
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Captures du parcours
                  </p>
                  {onRefreshExecution ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setFailedImages(new Set());
                        void onRefreshExecution(result.id);
                      }}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      Rafraichir les liens
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {screenshots.map((artifact) => {
                    const reason = compactValue(artifact.metadata_redacted?.capture_reason);
                    return (
                      <div key={artifact.id} className="overflow-hidden rounded-lg border border-border">
                        {artifact.previewable && artifact.signed_url && !failedImages.has(artifact.id) ? (
                          <button
                            type="button"
                            className="block w-full bg-muted/20"
                            onClick={() => setSelectedScreenshot(artifact.signed_url ?? null)}
                          >
                            <img
                              src={artifact.signed_url}
                              alt={`Capture ${reason}`}
                              className="h-40 w-full object-cover object-top"
                              onError={() =>
                                setFailedImages((current) => new Set(current).add(artifact.id))
                              }
                            />
                          </button>
                        ) : (
                          <div className="flex h-40 items-center justify-center bg-muted/30 px-4 text-center text-xs text-muted-foreground">
                            {artifact.upload_status === 'available'
                              ? 'Le lien de cette capture a expire. Actualisez les preuves.'
                              : 'Cette capture n a pas pu etre transferee vers le stockage securise.'}
                          </div>
                        )}
                        <div className="p-2 text-xs">
                          <p className="font-medium text-foreground">{reason}</p>
                          <p className="mt-1 text-muted-foreground">
                            {artifact.size_bytes ? `${Math.round(artifact.size_bytes / 1024)} Ko` : 'Taille inconnue'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {htmlSnapshots.some((artifact) => artifact.signed_url) ? (
                  <div className="flex flex-wrap gap-2">
                    {htmlSnapshots.filter((artifact) => artifact.signed_url).map((artifact) => (
                      <a
                        key={artifact.id}
                        href={artifact.signed_url ?? undefined}
                        download
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-primary hover:bg-muted/40"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Telecharger le snapshot HTML
                      </a>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {Array.isArray(result.logs) && result.logs.length > 0 ? (
              <details className="space-y-2 rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Informations techniques
                </summary>
                <div className="mb-2 grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-md bg-muted/40 px-3 py-2">
                    Mode d execution: <span className="font-medium">{source.label}</span>
                  </div>
                  <div className="rounded-md bg-muted/40 px-3 py-2">
                    Reference technique:{' '}
                    <span className="font-mono">{result.failure_reason ?? 'aucune'}</span>
                  </div>
                </div>
                <div className="max-h-48 space-y-1 overflow-auto rounded-md border border-border p-2">
                  {result.logs.map((log) => (
                    <div key={log.id} className="flex gap-2 text-xs">
                      <span className="shrink-0 text-muted-foreground">
                        {new Date(log.created_at).toLocaleTimeString('fr-FR')}
                      </span>
                      <span className="font-medium uppercase text-muted-foreground">{log.level}</span>
                      <span className="text-foreground">{log.message}</span>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}

            {result.screenshot_url && screenshots.length === 0 ? (
              <a
                href={result.screenshot_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ImageIcon className="h-4 w-4" />
                Voir la capture d ecran
              </a>
            ) : null}

            {Array.isArray(result.step_trace) && result.step_trace.length > 0 ? (
              <details className="space-y-2 rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Trace legacy
                </summary>
                <div className="space-y-1.5">
                  {result.step_trace.slice(0, 25).map((step, index) => (
                    <div key={`${result.id}-trace-${index}`} className="rounded-md border border-border p-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{String(step.type ?? 'step')}</span>
                      {step.selector ? <span className="ml-2">{String(step.selector)}</span> : null}
                      {step.status ? <span className="ml-2">({String(step.status)})</span> : null}
                      {step.reason ? <span className="block mt-1">{String(step.reason)}</span> : null}
                    </div>
                  ))}
                  {result.step_trace.length > 25 ? (
                    <p className="text-xs text-muted-foreground">+ {result.step_trace.length - 25} etapes supplementaires</p>
                  ) : null}
                </div>
              </details>
            ) : null}
          </article>
        );
      })}
      <Dialog open={Boolean(selectedScreenshot)} onOpenChange={(open) => !open && setSelectedScreenshot(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Capture d execution</DialogTitle>
          </DialogHeader>
          {selectedScreenshot ? (
            <img
              src={selectedScreenshot}
              alt="Capture d execution agrandie"
              className="max-h-[75vh] w-full object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
