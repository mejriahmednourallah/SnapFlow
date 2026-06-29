import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Compass,
  FlaskConical,
  Play,
  Save,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formTesterApi } from '@/lib/form-tester/api';
import {
  EXPECTED_BEHAVIOR_LABELS,
  expectedBehaviorFromLegacy,
} from '@/lib/form-tester/businessVerdict';
import type {
  ExpectedBehavior,
  FormTestScenario,
  WorkflowWithDetails,
} from '@/lib/form-tester/types';
import { cn } from '@/lib/utils';

interface CampaignPlanWorkspaceProps {
  workflowId: string;
}

const INTENT_META: Record<ExpectedBehavior, {
  icon: typeof Check;
  description: string;
  classes: string;
}> = {
  accept: {
    icon: Check,
    description: 'Le formulaire doit accepter ce parcours.',
    classes: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  reject: {
    icon: ShieldCheck,
    description: 'Le formulaire doit bloquer ces données.',
    classes: 'border-rose-200 bg-rose-50 text-rose-800',
  },
  explore: {
    icon: Compass,
    description: 'Observer sans créer automatiquement une anomalie.',
    classes: 'border-sky-200 bg-sky-50 text-sky-800',
  },
};

function scenarioBehavior(scenario: FormTestScenario): ExpectedBehavior {
  return expectedBehaviorFromLegacy(
    scenario.expected_outcome,
    scenario.case_definition?.expected_behavior,
  );
}

export function CampaignPlanWorkspace({ workflowId }: CampaignPlanWorkspaceProps) {
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState<WorkflowWithDetails | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [baselineIds, setBaselineIds] = useState<string[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState('');
  const [intentFilter, setIntentFilter] = useState<ExpectedBehavior | 'all'>('all');
  const [campaignName, setCampaignName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    void formTesterApi.getWorkflow(workflowId)
      .then((data) => {
        if (!active) return;
        setWorkflow(data);
        const ids = data.scenarios.map((scenario) => scenario.id);
        const accepting = data.scenarios.filter(
          (scenario) => scenarioBehavior(scenario) === 'accept',
        );
        const primary =
          accepting.find((scenario) => scenario.id === data.active_scenario?.id) ??
          accepting.find((scenario) => /principal/i.test(scenario.name)) ??
          accepting[0];
        const generatedNominal =
          accepting.find((scenario) =>
            scenario.id !== primary?.id && /nominal|reference/i.test(scenario.name)
          ) ??
          accepting.find((scenario) => scenario.id !== primary?.id);
        const proposedBaselines = [primary?.id, generatedNominal?.id]
          .filter((value): value is string => Boolean(value));
        setSelectedIds(ids);
        setBaselineIds(proposedBaselines);
        setSelectedScenarioId(proposedBaselines[0] ?? ids[0] ?? '');
        setCampaignName(`Campagne ${new Date().toLocaleDateString('fr-FR')}`);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Chargement impossible');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workflowId]);

  const scenarios = workflow?.scenarios ?? [];
  const filteredScenarios = useMemo(
    () => scenarios.filter((scenario) =>
      intentFilter === 'all' || scenarioBehavior(scenario) === intentFilter
    ),
    [intentFilter, scenarios],
  );
  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null;
  const selectedDefinition = selectedScenario?.case_definition ?? {};
  const selectedBehavior = selectedScenario ? scenarioBehavior(selectedScenario) : 'explore';
  const conflicts = selectedIds.length === 0
    ? ['Sélectionnez au moins un scénario.']
    : baselineIds.length === 0
      ? ['Choisissez un scénario nominal.']
      : baselineIds.some((id) => !selectedIds.includes(id))
        ? ['Le scénario nominal doit faire partie de la campagne.']
        : new Set(baselineIds).size !== baselineIds.length
          ? ['Les deux references nominales doivent etre differentes.']
          : [];

  const updateSelectedDefinition = (
    updates: Partial<{
      expected_behavior: ExpectedBehavior;
      expectation_confidence: number;
      suggested_severity: 'critical' | 'high' | 'medium' | 'low';
      suggested_severity_reason: string;
      baseline_dependent: boolean;
      reasoning: string;
      field_mutations: NonNullable<FormTestScenario['case_definition']['field_mutations']>;
    }>,
  ) => {
    if (!selectedScenario) return;
    setWorkflow((current) => current ? {
      ...current,
      scenarios: current.scenarios.map((scenario) =>
        scenario.id === selectedScenario.id
          ? {
              ...scenario,
              case_definition: {
                ...scenario.case_definition,
                ...updates,
              },
            }
          : scenario
      ),
    } : current);
  };

  const saveSelectedScenario = async () => {
    if (!selectedScenario) return;
    setIsSaving(true);
    setError(null);
    try {
      const definition = selectedScenario.case_definition ?? {};
      const updated = await formTesterApi.updateScenarioBehavior({
        workflowId,
        scenarioId: selectedScenario.id,
        expectedBehavior: scenarioBehavior(selectedScenario),
        expectationConfidence: Number(definition.expectation_confidence ?? 0.8),
        suggestedSeverity:
          (definition.suggested_severity as 'critical' | 'high' | 'medium' | 'low') ?? 'low',
        suggestedSeverityReason: String(definition.suggested_severity_reason ?? ''),
        baselineDependent: Boolean(
          definition.baseline_dependent ?? scenarioBehavior(selectedScenario) === 'accept',
        ),
        fieldMutations: definition.field_mutations,
        purpose: String(definition.purpose ?? ''),
        reasoning: String(definition.reasoning ?? ''),
      });
      setWorkflow((current) => current ? {
        ...current,
        scenarios: current.scenarios.map((scenario) =>
          scenario.id === updated.id ? updated : scenario
        ),
      } : current);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Enregistrement impossible');
    } finally {
      setIsSaving(false);
    }
  };

  const launchCampaign = async () => {
    if (conflicts.length > 0) return;
    setIsLaunching(true);
    setError(null);
    try {
      const response = await formTesterApi.launchCampaign({
        workflowId,
        baselineScenarioIds: baselineIds,
        scenarioIds: selectedIds,
        name: campaignName,
      });
      navigate(`/app/workflows/form-tester/${workflowId}/results?campaign=${response.campaign.id}`);
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : 'Lancement impossible');
    } finally {
      setIsLaunching(false);
    }
  };

  if (isLoading) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">Préparation du plan de test...</div>;
  }
  if (!workflow) {
    return <div className="p-6 text-sm text-destructive">{error ?? 'Workflow introuvable'}</div>;
  }

  return (
    <div className="flex h-[calc(100dvh-5rem)] min-h-0 flex-col overflow-hidden rounded-3xl border bg-background shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/app/workflows/form-tester/${workflowId}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-primary" />
              <h1 className="truncate text-lg font-semibold">Préparer la campagne</h1>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {workflow.name} · {workflow.target_url}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {selectedIds.length} scénario{selectedIds.length > 1 ? 's' : ''}
          </span>
          <Button onClick={launchCampaign} disabled={isLaunching || conflicts.length > 0}>
            <Play className="mr-2 h-4 w-4" />
            {isLaunching ? 'Lancement...' : 'Lancer la campagne'}
          </Button>
        </div>
      </header>

      {error ? <div className="border-b bg-destructive/10 px-5 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid min-h-0 flex-1 xl:grid-cols-[220px_minmax(360px,1fr)_minmax(360px,0.9fr)]">
        <aside className="min-h-0 overflow-y-auto border-r bg-muted/20 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Intentions</p>
          <div className="mt-3 space-y-2">
            {(['all', 'accept', 'reject', 'explore'] as const).map((intent) => {
              const count = intent === 'all'
                ? scenarios.length
                : scenarios.filter((scenario) => scenarioBehavior(scenario) === intent).length;
              return (
                <button
                  key={intent}
                  type="button"
                  onClick={() => setIntentFilter(intent)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition',
                    intentFilter === intent ? 'border-primary bg-primary/10 text-primary' : 'border-transparent hover:bg-muted',
                  )}
                >
                  <span>{intent === 'all' ? 'Tous les cas' : EXPECTED_BEHAVIOR_LABELS[intent]}</span>
                  <span className="text-xs font-semibold">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-6 rounded-2xl border bg-background p-3">
            <p className="text-xs font-semibold">Référence nominale</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Elle est rejouée à chaque campagne pour apprendre le comportement normal du formulaire.
            </p>
            <select
              value={baselineIds[0] ?? ''}
              onChange={(event) => {
                setBaselineIds((current) => [event.target.value, ...current.slice(1)].filter(Boolean));
                setSelectedIds((current) => [...new Set([...current, event.target.value])]);
              }}
              className="mt-3 h-9 w-full rounded-md border bg-background px-2 text-xs"
            >
              {scenarios.filter((scenario) => scenarioBehavior(scenario) === 'accept').map((scenario) => (
                <option key={scenario.id} value={scenario.id}>{scenario.name}</option>
              ))}
            </select>
            <select
              value={baselineIds[1] ?? ''}
              onChange={(event) => {
                setBaselineIds((current) => {
                  const next = [current[0], event.target.value].filter(Boolean);
                  return [...new Set(next)].slice(0, 2);
                });
                if (event.target.value) {
                  setSelectedIds((current) => [...new Set([...current, event.target.value])]);
                }
              }}
              className="mt-2 h-9 w-full rounded-md border bg-background px-2 text-xs"
              aria-label="Seconde reference nominale"
            >
              <option value="">Aucune seconde reference</option>
              {scenarios.filter((scenario) => scenarioBehavior(scenario) === 'accept').map((scenario) => (
                <option key={scenario.id} value={scenario.id}>{scenario.name}</option>
              ))}
            </select>
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Plan par intentions</p>
              <p className="text-xs text-muted-foreground">Sélectionnez un cas pour vérifier ou corriger son attente.</p>
            </div>
            <Input
              value={campaignName}
              onChange={(event) => setCampaignName(event.target.value)}
              className="h-9 max-w-xs"
              aria-label="Nom de la campagne"
            />
          </div>

          <div className="space-y-2">
            {filteredScenarios.map((scenario) => {
              const behavior = scenarioBehavior(scenario);
              const meta = INTENT_META[behavior];
              const Icon = meta.icon;
              const checked = selectedIds.includes(scenario.id);
              return (
                <button
                  type="button"
                  key={scenario.id}
                  onClick={() => setSelectedScenarioId(scenario.id)}
                  className={cn(
                    'grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border p-3 text-left transition',
                    selectedScenarioId === scenario.id ? 'border-primary bg-primary/5 shadow-sm' : 'hover:border-primary/40',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => setSelectedIds((current) =>
                      checked ? current.filter((id) => id !== scenario.id) : [...current, scenario.id]
                    )}
                  />
                  <span className={cn('grid h-9 w-9 place-items-center rounded-xl border', meta.classes)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="truncate text-sm">{scenario.name}</strong>
                      {baselineIds.includes(scenario.id) ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">Nominal</span>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {scenario.case_definition?.purpose || scenario.description || meta.description}
                    </span>
                  </span>
                  <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', meta.classes)}>
                    {EXPECTED_BEHAVIOR_LABELS[behavior]}
                  </span>
                </button>
              );
            })}
          </div>
        </main>

        <aside className="min-h-0 overflow-y-auto border-l bg-muted/10 p-5">
          {selectedScenario ? (
            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Scénario sélectionné</p>
                <h2 className="mt-2 text-lg font-semibold">{selectedScenario.name}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {selectedDefinition.purpose || selectedScenario.description || 'Aucun detail court pour ce scenario.'}
                </p>
              </div>

              <div className="hidden">
                {(['accept', 'reject', 'explore'] as const).map((behavior) => {
                  const meta = INTENT_META[behavior];
                  return (
                    <button
                      type="button"
                      key={behavior}
                      onClick={() => updateSelectedDefinition({
                        expected_behavior: behavior,
                        baseline_dependent: behavior === 'accept',
                      })}
                      className={cn(
                        'rounded-xl border px-2 py-3 text-xs font-semibold transition',
                        selectedBehavior === behavior ? meta.classes : 'bg-background text-muted-foreground',
                      )}
                    >
                      {EXPECTED_BEHAVIOR_LABELS[behavior]}
                    </button>
                  );
                })}
              </div>

              <div className="hidden">
                <label className="space-y-1 text-xs">
                  <span className="font-medium">Sévérité potentielle</span>
                  <select
                    value={String(selectedDefinition.suggested_severity ?? 'low')}
                    onChange={(event) => updateSelectedDefinition({
                      suggested_severity: event.target.value as 'critical' | 'high' | 'medium' | 'low',
                    })}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="critical">Critique</option>
                    <option value="high">Élevée</option>
                    <option value="medium">Moyenne</option>
                    <option value="low">Faible</option>
                  </select>
                </label>
              </div>

              <label className="hidden">
                <span className="font-medium">Pourquoi cette attente ?</span>
                <Textarea
                  value={String(selectedDefinition.reasoning ?? '')}
                  onChange={(event) => updateSelectedDefinition({
                    reasoning: event.target.value,
                  })}
                  className="min-h-24"
                />
              </label>

              <label className="hidden">
                <span className="font-medium">Justification de la sévérité potentielle</span>
                <Textarea
                  value={String(selectedDefinition.suggested_severity_reason ?? '')}
                  onChange={(event) => updateSelectedDefinition({
                    suggested_severity_reason: event.target.value,
                  })}
                  className="min-h-20"
                />
              </label>

              <div className="rounded-2xl border bg-background p-4">
                <p className="text-xs font-semibold">Données modifiées</p>
                <div className="mt-3 space-y-2">
                  {(selectedDefinition.field_mutations ?? []).slice(0, 12).map((mutation, index) => (
                    <label key={mutation.field_id} className="grid gap-1 text-xs">
                      <span className="min-w-0 break-words text-muted-foreground">
                        {mutation.field_name || mutation.field_id}
                      </span>
                      <Input
                        value={mutation.value}
                        placeholder="Valeur vide volontaire"
                        onChange={(event) => updateSelectedDefinition({
                          field_mutations: (selectedDefinition.field_mutations ?? []).map((item, itemIndex) =>
                            itemIndex === index ? { ...item, value: event.target.value } : item
                          ),
                        })}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <details className="rounded-2xl border bg-background p-4 text-xs">
                <summary className="cursor-pointer font-semibold">Réglages avancés</summary>
                <div className="mt-3 space-y-2 text-muted-foreground">
                  <p>{selectedDefinition.expected_signals?.length ?? 0} preuve(s) configurée(s)</p>
                  <p>Portée: {selectedDefinition.validation_scope ?? 'parcours complet'}</p>
                  <p>Cible: {selectedDefinition.target_field_name || selectedDefinition.target_field_id || 'formulaire entier'}</p>
                </div>
              </details>

              <Button variant="outline" className="w-full" onClick={saveSelectedScenario} disabled={isSaving}>
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? 'Enregistrement...' : 'Enregistrer ce scénario'}
              </Button>
            </div>
          ) : (
            <div className="grid h-full place-items-center rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Sélectionnez un scénario pour inspecter son intention.
            </div>
          )}
        </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-5 py-3">
        <div className="flex items-center gap-2 text-xs">
          {conflicts.length > 0 ? (
            <>
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-amber-800">{conflicts[0]}</span>
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">
                Le nominal sera exécuté avant les {Math.max(0, selectedIds.length - 1)} autres cas.
              </span>
            </>
          )}
        </div>
        <Button onClick={launchCampaign} disabled={isLaunching || conflicts.length > 0}>
          <Play className="mr-2 h-4 w-4" />
          Lancer {selectedIds.length} scénario{selectedIds.length > 1 ? 's' : ''}
        </Button>
      </footer>
    </div>
  );
}
