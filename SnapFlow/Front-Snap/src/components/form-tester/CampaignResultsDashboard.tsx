import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Compass,
  History,
  Image as ImageIcon,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { formTesterApi } from '@/lib/form-tester/api';
import {
  BUSINESS_VERDICT_LABELS,
  EXPECTED_BEHAVIOR_LABELS,
  OBSERVED_BEHAVIOR_LABELS,
  businessConclusion,
  executionBusinessState,
} from '@/lib/form-tester/businessVerdict';
import type {
  BusinessVerdict,
  FormTestCampaign,
  FormTestCampaignDetail,
  WorkflowExecutionDetail,
} from '@/lib/form-tester/types';
import { cn } from '@/lib/utils';

interface CampaignResultsDashboardProps {
  workflowId: string;
}

const VERDICT_ORDER: Record<BusinessVerdict, number> = {
  unexpected_acceptance: 0,
  unexpected_rejection: 0,
  needs_confirmation: 1,
  interrupted: 2,
  conform: 3,
  observation: 4,
};

const VERDICT_CLASSES: Record<BusinessVerdict, string> = {
  conform: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  unexpected_acceptance: 'border-rose-200 bg-rose-50 text-rose-800',
  unexpected_rejection: 'border-rose-200 bg-rose-50 text-rose-800',
  needs_confirmation: 'border-amber-200 bg-amber-50 text-amber-900',
  interrupted: 'border-orange-200 bg-orange-50 text-orange-900',
  observation: 'border-sky-200 bg-sky-50 text-sky-800',
};

function formatDuration(value: number | null | undefined) {
  if (typeof value !== 'number') return '—';
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;
}

function campaignDate(value: string) {
  return new Date(value).toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function displayedVerdictLabel(state: ReturnType<typeof executionBusinessState>) {
  const label = BUSINESS_VERDICT_LABELS[state.effectiveVerdict];
  return state.hasManualReview ? `${label} — validation opérateur` : label;
}

function visibleTechnicalSummary(summary: Record<string, unknown> | null | undefined) {
  if (!summary) return {};
  const {
    reference_quality: _referenceQuality,
    baseline_signature: _baselineSignature,
    baseline_comparison: _baselineComparison,
    baseline_conclusive: _baselineConclusive,
    reference_selection: _referenceSelection,
    reference_execution_id: _referenceExecutionId,
    ...visibleSummary
  } = summary;
  return visibleSummary;
}

export function CampaignResultsDashboard({ workflowId }: CampaignResultsDashboardProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [campaigns, setCampaigns] = useState<FormTestCampaign[]>([]);
  const [detail, setDetail] = useState<FormTestCampaignDetail | null>(null);
  const [previousDetail, setPreviousDetail] = useState<FormTestCampaignDetail | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<WorkflowExecutionDetail | null>(null);
  const [selectedScreenshot, setSelectedScreenshot] = useState('');
  const [reviewVerdict, setReviewVerdict] = useState<
    'conform' | 'unexpected_acceptance' | 'unexpected_rejection'
  >('conform');
  const [reviewJustification, setReviewJustification] = useState('');
  const [reviewSeverity, setReviewSeverity] = useState<'critical' | 'high' | 'medium' | 'low'>('low');
  const [isLoading, setIsLoading] = useState(true);
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const campaignId = searchParams.get('campaign');

  const loadCampaigns = async () => {
    const rows = await formTesterApi.listCampaigns(workflowId);
    setCampaigns(rows);
    if (!campaignId && rows[0]) {
      setSearchParams({ campaign: rows[0].id }, { replace: true });
    }
  };

  const loadDetail = async (id: string) => {
    const next = await formTesterApi.getCampaign(id);
    setDetail(next);
    setCampaigns((current) => current.map((campaign) =>
      campaign.id === next.campaign.id ? next.campaign : campaign
    ));
    if (selectedExecution) {
      const refreshed = next.executions.find((execution) => execution.id === selectedExecution.id);
      if (refreshed) setSelectedExecution(refreshed);
    }
  };

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);
    void loadCampaigns()
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Historique indisponible');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workflowId]);

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    const refresh = async () => {
      try {
        const next = await formTesterApi.getCampaign(campaignId);
        if (active) {
          setDetail(next);
          setCampaigns((current) => current.map((campaign) =>
            campaign.id === next.campaign.id ? next.campaign : campaign
          ));
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Campagne indisponible');
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (detail?.campaign.status !== 'completed') void refresh();
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [campaignId, detail?.campaign.status]);

  useEffect(() => {
    if (!detail || campaigns.length < 2) {
      setPreviousDetail(null);
      return;
    }
    const currentIndex = campaigns.findIndex((campaign) => campaign.id === detail.campaign.id);
    const previous = currentIndex >= 0 ? campaigns[currentIndex + 1] : undefined;
    if (!previous) {
      setPreviousDetail(null);
      return;
    }
    let active = true;
    void formTesterApi.getCampaign(previous.id)
      .then((value) => {
        if (active) setPreviousDetail(value);
      })
      .catch(() => {
        if (active) setPreviousDetail(null);
      });
    return () => {
      active = false;
    };
  }, [campaigns, detail?.campaign.id]);

  const executions = useMemo(
    () => [...(detail?.executions ?? [])].sort((left, right) => {
      const leftActive = ['queued', 'running', 'stopping'].includes(left.status);
      const rightActive = ['queued', 'running', 'stopping'].includes(right.status);
      if (leftActive !== rightActive) return leftActive ? -1 : 1;
      return VERDICT_ORDER[executionBusinessState(left).effectiveVerdict] -
        VERDICT_ORDER[executionBusinessState(right).effectiveVerdict];
    }),
    [detail?.executions],
  );

  const openExecution = async (execution: WorkflowExecutionDetail) => {
    setSelectedExecution(execution);
    setSelectedScreenshot(
      execution.artifacts.find((artifact) => artifact.artifact_type === 'screenshot' && artifact.signed_url)?.signed_url ?? '',
    );
    try {
      let full = await formTesterApi.getExecution(execution.id);
      const state = executionBusinessState(full);
      if (
        state.effectiveVerdict === 'needs_confirmation' &&
        !full.summary?.ai_interpretation
      ) {
        setIsInterpreting(true);
        try {
          await formTesterApi.interpretExecution(full.id);
          full = await formTesterApi.getExecution(full.id);
        } finally {
          setIsInterpreting(false);
        }
      }
      setSelectedExecution(full);
      setSelectedScreenshot(
        full.artifacts.find((artifact) => artifact.artifact_type === 'screenshot' && artifact.signed_url)?.signed_url ?? '',
      );
    } catch {
      // The matrix remains useful even if detailed evidence cannot be refreshed.
    }
  };

  const refreshEvidence = async () => {
    if (!selectedExecution) return;
    const refreshed = await formTesterApi.getExecution(selectedExecution.id);
    setSelectedExecution(refreshed);
    setSelectedScreenshot(
      refreshed.artifacts.find((artifact) => artifact.artifact_type === 'screenshot' && artifact.signed_url)?.signed_url ?? '',
    );
  };

  const submitReview = async () => {
    if (!selectedExecution || !reviewJustification.trim()) return;
    await formTesterApi.reviewExecution({
      executionId: selectedExecution.id,
      verdict: reviewVerdict,
      justification: reviewJustification,
      severity: reviewSeverity,
    });
    await loadDetail(selectedExecution.campaign_id ?? campaignId ?? '');
    setReviewJustification('');
  };

  const summary = detail?.campaign.summary;
  const regression = useMemo(() => {
    const anomalyIds = (executionsToCheck: WorkflowExecutionDetail[]) => new Set(
      executionsToCheck
        .filter((execution) => {
          const verdict = executionBusinessState(execution).effectiveVerdict;
          return verdict === 'unexpected_acceptance' || verdict === 'unexpected_rejection';
        })
        .map((execution) => execution.scenario_id)
        .filter((value): value is string => Boolean(value)),
    );
    const current = anomalyIds(detail?.executions ?? []);
    const previous = anomalyIds(previousDetail?.executions ?? []);
    return {
      newCount: [...current].filter((id) => !previous.has(id)).length,
      persistentCount: [...current].filter((id) => previous.has(id)).length,
      fixedCount: [...previous].filter((id) => !current.has(id)).length,
    };
  }, [detail?.executions, previousDetail?.executions]);

  if (isLoading) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">Chargement des campagnes...</div>;
  }

  return (
    <div className="flex h-[calc(100dvh-5rem)] min-h-0 overflow-hidden rounded-3xl border bg-background shadow-sm">
      <aside className="hidden w-72 shrink-0 overflow-y-auto border-r bg-muted/20 p-4 lg:block">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Historique</h2>
        </div>
        <Button
          className="mt-4 w-full"
          onClick={() => navigate(`/app/workflows/form-tester/${workflowId}/plan`)}
        >
          Nouvelle campagne
        </Button>
        <div className="mt-4 space-y-2">
          {campaigns.map((campaign) => (
            <button
              type="button"
              key={campaign.id}
              onClick={() => setSearchParams({ campaign: campaign.id })}
              className={cn(
                'w-full rounded-2xl border p-3 text-left transition',
                campaign.id === campaignId ? 'border-primary bg-primary/10' : 'bg-background hover:border-primary/40',
              )}
            >
              <p className="truncate text-sm font-semibold">{campaign.name}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{campaignDate(campaign.created_at)}</p>
              <div className="mt-2 flex gap-2 text-[10px]">
                <span className="text-rose-700">{campaign.summary?.anomaly ?? 0} anomalie(s)</span>
                <span className="text-emerald-700">{campaign.summary?.conform ?? 0} conforme(s)</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 border-b bg-background/95 px-5 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => navigate(`/app/workflows/form-tester/${workflowId}`)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold">{detail?.campaign.name ?? 'Résultats Form Tester'}</h1>
                <p className="text-xs text-muted-foreground">
                  {detail ? `${campaignDate(detail.campaign.created_at)} · ${detail.campaign.status}` : 'Aucune campagne sélectionnée'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/app/workflows/form-tester/${workflowId}/results?view=legacy`)}
              >
                Exécutions historiques
              </Button>
              <Button variant="outline" size="sm" onClick={() => campaignId && void loadDetail(campaignId)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Actualiser
              </Button>
              <Button size="sm" onClick={() => navigate(`/app/workflows/form-tester/${workflowId}/plan`)}>
                Nouvelle campagne
              </Button>
            </div>
          </div>
        </header>

        {error ? <div className="mx-5 mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

        {detail ? (
          <div className="space-y-5 p-5">
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Conformes', value: summary?.conform ?? 0, icon: CheckCircle2, classes: 'text-emerald-700 bg-emerald-50' },
                { label: 'Anomalies', value: summary?.anomaly ?? 0, icon: XCircle, classes: 'text-rose-700 bg-rose-50' },
                { label: 'À confirmer', value: summary?.needs_confirmation ?? 0, icon: AlertCircle, classes: 'text-amber-800 bg-amber-50' },
                { label: 'Interrompus', value: summary?.interrupted ?? 0, icon: Clock3, classes: 'text-orange-800 bg-orange-50' },
              ].map((item) => (
                <div key={item.label} className={cn('rounded-2xl border p-4', item.classes)}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide">{item.label}</span>
                    <item.icon className="h-5 w-5" />
                  </div>
                  <p className="mt-3 text-3xl font-bold">{item.value}</p>
                </div>
              ))}
            </section>

            {previousDetail ? (
              <section className="grid gap-3 rounded-2xl border bg-muted/15 p-4 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Nouvelles anomalies</p>
                  <p className="mt-1 text-2xl font-bold text-rose-700">{regression.newCount}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Persistantes</p>
                  <p className="mt-1 text-2xl font-bold text-amber-800">{regression.persistentCount}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Corrigées</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-700">{regression.fixedCount}</p>
                </div>
              </section>
            ) : null}

            <section className="overflow-hidden rounded-2xl border">
              <div className="border-b bg-muted/30 px-4 py-3">
                <h2 className="text-sm font-semibold">Matrice de comportement</h2>
                <p className="text-xs text-muted-foreground">
                  Une anomalie apparaît uniquement lorsque le comportement observé contredit l’attente.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-xs">
                  <thead className="bg-muted/20 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Scénario</th>
                      <th className="px-3 py-3">Intention</th>
                      <th className="px-3 py-3">Progression</th>
                      <th className="px-3 py-3">Observé</th>
                      <th className="px-3 py-3">Verdict</th>
                      <th className="px-3 py-3">Sévérité</th>
                      <th className="px-3 py-3">Durée</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {executions.map((execution) => {
                      const state = executionBusinessState(execution);
                      const active = ['queued', 'running', 'stopping'].includes(execution.status);
                      const progress = execution.progress_total > 0
                        ? Math.round((execution.progress_completed / execution.progress_total) * 100)
                        : 0;
                      return (
                        <tr
                          key={execution.id}
                          onClick={() => void openExecution(execution)}
                          className="cursor-pointer transition hover:bg-muted/30"
                        >
                          <td className="max-w-xs px-4 py-3">
                            <div className="flex items-center gap-2">
                              {execution.campaign_role === 'baseline' ? (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-800">NOMINAL</span>
                              ) : null}
                              <span className="truncate font-semibold">{execution.scenario?.name ?? 'Scénario'}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 font-medium">{EXPECTED_BEHAVIOR_LABELS[state.expected]}</td>
                          <td className="px-3 py-3">
                            {active ? (
                              <div className="w-28">
                                <div className="mb-1 flex justify-between text-[10px]">
                                  <span>{execution.status === 'queued' ? 'En attente' : 'En cours'}</span>
                                  <span>{progress}%</span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                  <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">{execution.progress_completed}/{execution.progress_total}</span>
                            )}
                          </td>
                          <td className="px-3 py-3">{active ? '—' : OBSERVED_BEHAVIOR_LABELS[state.observed]}</td>
                          <td className="px-3 py-3">
                            {active ? (
                              <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">En cours</span>
                            ) : (
                              <span className={cn('inline-flex rounded-full border px-2.5 py-1 font-semibold', VERDICT_CLASSES[state.effectiveVerdict])}>
                                {displayedVerdictLabel(state)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 capitalize">{state.severity ?? '—'}</td>
                          <td className="px-3 py-3">{formatDuration(execution.execution_duration_ms ?? execution.duration_ms)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : (
          <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">
            Lancez une campagne pour afficher la matrice.
          </div>
        )}
      </main>

      <Sheet open={Boolean(selectedExecution)} onOpenChange={(open) => !open && setSelectedExecution(null)}>
        <SheetContent side="right" className="w-[96vw] overflow-y-auto p-0 sm:max-w-3xl">
          {selectedExecution ? (() => {
            const state = executionBusinessState(selectedExecution);
            const observation =
              selectedExecution.summary?.submission_observation &&
              typeof selectedExecution.summary.submission_observation === 'object'
                ? selectedExecution.summary.submission_observation as Record<string, any>
                : {};
            const semantic =
              observation.semantic_dom && typeof observation.semantic_dom === 'object'
                ? observation.semantic_dom as Record<string, any>
                : {};
            const interpretation =
              selectedExecution.summary?.ai_interpretation &&
              typeof selectedExecution.summary.ai_interpretation === 'object'
                ? selectedExecution.summary.ai_interpretation as Record<string, any>
                : null;
            const screenshots = selectedExecution.artifacts.filter(
              (artifact) => artifact.artifact_type === 'screenshot',
            );
            return (
              <div>
                <SheetHeader className="border-b p-5 text-left">
                  <SheetTitle>{selectedExecution.scenario?.name ?? 'Détail du scénario'}</SheetTitle>
                  <span className={cn('w-fit rounded-full border px-3 py-1 text-xs font-semibold', VERDICT_CLASSES[state.effectiveVerdict])}>
                    {displayedVerdictLabel(state)}
                  </span>
                </SheetHeader>

                <div className="space-y-6 p-5">
                  <section className="rounded-2xl border bg-muted/20 p-4">
                    <p className="text-base font-semibold">{businessConclusion(selectedExecution)}</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-background p-3">
                        <p className="text-[10px] uppercase text-muted-foreground">Attendu</p>
                        <p className="mt-1 font-semibold">{EXPECTED_BEHAVIOR_LABELS[state.expected]}</p>
                      </div>
                      <div className="rounded-xl bg-background p-3">
                        <p className="text-[10px] uppercase text-muted-foreground">Observé</p>
                        <p className="mt-1 font-semibold">{OBSERVED_BEHAVIOR_LABELS[state.observed]}</p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-2xl border p-4">
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">Réponse de soumission</p>
                    <p className="mt-2 font-semibold">
                      {observation.submission_response
                        ? `${observation.submission_response.method ?? ''} ${observation.submission_response.status ?? ''}`
                        : 'Aucune réponse métier identifiée'}
                    </p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {observation.submission_response?.url ?? ''}
                    </p>
                  </section>

                  <section className="rounded-2xl border p-4">
                    <h3 className="text-sm font-semibold">Messages déterminants du formulaire</h3>
                    <div className="mt-3 space-y-2">
                      {[
                        ...((semantic.success_messages ?? []).map((item: any) => ({ ...item, kind: 'Confirmation' }))),
                        ...((semantic.validation_messages ?? []).map((item: any) => ({ ...item, kind: 'Validation' }))),
                        ...((semantic.rejection_messages ?? []).map((item: any) => ({ ...item, kind: 'Refus métier' }))),
                      ].slice(0, 8).map((item: any, index: number) => (
                        <div key={`${item.kind}-${index}`} className="rounded-xl bg-muted/30 p-3 text-xs">
                          <span className="font-semibold">{item.kind}</span>
                          <p className="mt-1 leading-5">{item.text}</p>
                        </div>
                      ))}
                      {!(semantic.success_messages?.length || semantic.validation_messages?.length || semantic.rejection_messages?.length) ? (
                        <p className="text-xs text-muted-foreground">Aucun message métier déterminant n’a été reconnu.</p>
                      ) : null}
                    </div>
                  </section>

                  {state.effectiveVerdict === 'needs_confirmation' ? (
                    <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sky-950">
                      <h3 className="text-sm font-semibold">Lecture IA informative</h3>
                      <p className="mt-1 text-xs">
                        Cette lecture aide l’opérateur mais ne change jamais le verdict automatique.
                      </p>
                      {interpretation ? (
                        <div className="mt-3">
                          <p className="font-semibold">
                            {String(interpretation.category ?? 'inconclusive')} · {Math.round(Number(interpretation.confidence ?? 0) * 100)}%
                          </p>
                          <p className="mt-1 text-sm">{String(interpretation.explanation ?? '')}</p>
                        </div>
                      ) : (
                        <p className="mt-3 text-sm">{isInterpreting ? 'Analyse en cours…' : 'Interprétation indisponible.'}</p>
                      )}
                    </section>
                  ) : null}

                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold">Preuves visuelles</h3>
                        <p className="text-xs text-muted-foreground">Capture principale et étapes clés.</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => void refreshEvidence()}>
                        <RefreshCw className="mr-2 h-3.5 w-3.5" /> Rafraîchir
                      </Button>
                    </div>
                    {selectedScreenshot ? (
                      <img
                        src={selectedScreenshot}
                        alt="Preuve visuelle du test"
                        onError={() => void refreshEvidence()}
                        className="max-h-[420px] w-full rounded-2xl border bg-muted object-contain"
                      />
                    ) : screenshots.some((artifact) => artifact.upload_status === 'failed' || artifact.upload_status === 'local_only') ? (
                      <div className="grid min-h-48 place-items-center rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-900">
                        <div>
                          <ImageIcon className="mx-auto mb-2 h-5 w-5" />
                          La capture a été créée, mais elle n’est pas accessible depuis cette interface.
                          <p className="mt-1 text-xs">Statut de stockage : {screenshots[0]?.upload_status ?? 'indisponible'}.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="grid h-48 place-items-center rounded-2xl border border-dashed text-sm text-muted-foreground">
                        <ImageIcon className="mr-2 inline h-4 w-4" /> Aucune capture disponible
                      </div>
                    )}
                    {screenshots.length > 1 ? (
                      <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                        {screenshots.map((artifact) => (
                          <button
                            type="button"
                            key={artifact.id}
                            onClick={() => artifact.signed_url && setSelectedScreenshot(artifact.signed_url)}
                            className="h-20 w-28 shrink-0 overflow-hidden rounded-xl border bg-muted"
                          >
                            {artifact.signed_url ? (
                              <img src={artifact.signed_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <span className="grid h-full place-items-center px-2 text-center text-[10px] text-muted-foreground">
                                {artifact.upload_status === 'failed' ? 'Upload échoué' : 'Capture locale'}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </section>

                  <section>
                    <h3 className="text-sm font-semibold">Chronologie fonctionnelle</h3>
                    <div className="mt-3 space-y-2">
                      {selectedExecution.steps.map((step, index) => (
                        <div key={step.id} className="flex items-center gap-3 rounded-xl border p-3 text-xs">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted font-semibold">{index + 1}</span>
                          <span className="min-w-0 flex-1 truncate font-medium">{step.step_type.replaceAll('_', ' ')}</span>
                          <span className="text-muted-foreground">{formatDuration(step.duration_ms)}</span>
                          <span className={cn(
                            'rounded-full px-2 py-1 font-semibold',
                            step.status === 'passed' ? 'bg-emerald-100 text-emerald-800' :
                              step.status === 'skipped' ? 'bg-muted text-muted-foreground' :
                                'bg-rose-100 text-rose-800',
                          )}>
                            {step.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>

                  {state.effectiveVerdict === 'needs_confirmation' ? (
                    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <h3 className="text-sm font-semibold text-amber-950">Conclusion opérateur</h3>
                      <p className="mt-1 text-xs text-amber-900">
                        Une justification est obligatoire et le verdict automatique reste conservé.
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <select
                          value={reviewVerdict}
                          onChange={(event) => setReviewVerdict(event.target.value as typeof reviewVerdict)}
                          className="h-10 rounded-md border bg-background px-3 text-sm"
                        >
                          <option value="conform">Conforme</option>
                          <option value="unexpected_acceptance">Acceptation inattendue</option>
                          <option value="unexpected_rejection">Rejet inattendu</option>
                        </select>
                        <select
                          value={reviewSeverity}
                          onChange={(event) => setReviewSeverity(event.target.value as typeof reviewSeverity)}
                          className="h-10 rounded-md border bg-background px-3 text-sm"
                        >
                          <option value="critical">Critique</option>
                          <option value="high">Élevée</option>
                          <option value="medium">Moyenne</option>
                          <option value="low">Faible</option>
                        </select>
                      </div>
                      <Textarea
                        value={reviewJustification}
                        onChange={(event) => setReviewJustification(event.target.value)}
                        placeholder="Expliquez la conclusion métier..."
                        className="mt-3 min-h-24 bg-background"
                      />
                      <Button className="mt-3" onClick={() => void submitReview()} disabled={!reviewJustification.trim()}>
                        Enregistrer la conclusion
                      </Button>
                    </section>
                  ) : null}

                  <details className="rounded-2xl border p-4 text-xs">
                    <summary className="cursor-pointer font-semibold">Détails techniques</summary>
                    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-[11px] text-slate-100">
                      {JSON.stringify({
                        execution_status: selectedExecution.status,
                        failure_reason: selectedExecution.failure_reason,
                        final_url: selectedExecution.final_url,
                        network_summary: selectedExecution.network_summary,
                        business_summary: visibleTechnicalSummary(selectedExecution.summary),
                      }, null, 2)}
                    </pre>
                  </details>
                </div>
              </div>
            );
          })() : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
