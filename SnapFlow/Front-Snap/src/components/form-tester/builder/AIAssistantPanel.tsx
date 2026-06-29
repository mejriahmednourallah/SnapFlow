import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, FlaskConical, GitBranch, Loader2, Play, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type {
  FormProfile,
  FormProfileType,
  FormTestScenario,
  TestCaseExpectedSignal,
  TestCaseSuggestion,
  WorkflowAiEditPatch,
  WorkflowExecutionDetail,
} from '@/lib/form-tester/types';
import { cn } from '@/lib/utils';

interface AIAssistantPanelProps {
  scenarios: FormTestScenario[];
  results: WorkflowExecutionDetail[];
  testCaseSuggestions: TestCaseSuggestion[];
  formProfile: FormProfile | null;
  onGenerateTestCases: (formType?: FormProfileType) => void;
  onUpdateTestCase: (suggestion: TestCaseSuggestion) => void;
  onCreateTestCases: (suggestionIds: string[]) => void;
  onExecuteAllCases: (scenarioIds: string[]) => void;
  onProposeWorkflowEdit: (instruction: string) => void;
  onApplyWorkflowEditPatch: (patch?: WorkflowAiEditPatch) => void;
  onClearWorkflowEditPatch: () => void;
  aiEditPatch: WorkflowAiEditPatch | null;
  isLoading: boolean;
  isExecuting: boolean;
  isAiEditing: boolean;
  isEditable: boolean;
}

const FORM_TYPES: Array<{ value: FormProfileType; label: string }> = [
  { value: 'contact', label: 'Contact' },
  { value: 'login', label: 'Connexion' },
  { value: 'search', label: 'Recherche' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'registration', label: 'Inscription' },
  { value: 'password_recovery', label: 'Mot de passe oublie' },
  { value: 'upload', label: 'Depot de fichier' },
  { value: 'appointment', label: 'Rendez-vous' },
  { value: 'checkout_payment', label: 'Commande / paiement' },
  { value: 'quote_request', label: 'Demande de devis' },
  { value: 'feedback_survey', label: 'Questionnaire' },
  { value: 'generic', label: 'Generique' },
];

const OUTCOMES: Array<{ value: TestCaseSuggestion['expected_outcome']; label: string }> = [
  { value: 'success', label: 'Accepter — parcours valide' },
  { value: 'validation_error', label: 'Refuser — validation des champs' },
  { value: 'business_rejection', label: 'Refuser — règle métier' },
  { value: 'server_error', label: 'Explorer — réponse serveur' },
  { value: 'blocked', label: 'Explorer — challenge ou blocage' },
];

function behaviorFor(testCase: TestCaseSuggestion): 'accept' | 'reject' | 'explore' {
  if (testCase.expected_behavior) return testCase.expected_behavior;
  if (testCase.expected_outcome === 'success') return 'accept';
  if (['validation_error', 'business_rejection'].includes(testCase.expected_outcome)) return 'reject';
  return 'explore';
}

const BEHAVIOR_LABELS = {
  accept: 'Accepter',
  reject: 'Refuser',
  explore: 'Explorer',
} as const;

function expectedLabel(scenario: FormTestScenario): string {
  const label = OUTCOMES.find((item) => item.value === scenario.expected_outcome)?.label;
  return label ?? 'Resultat attendu configure';
}

function evidenceLabel(signal: TestCaseExpectedSignal): string {
  const labels: Record<string, string> = {
    form_invalid: 'Formulaire invalide',
    validation_message_present: 'Message de validation',
    response_status: 'Statut HTTP',
    response_status_range: 'Plage HTTP',
    url_contains: 'URL cible',
    url_changed: 'URL modifiee',
    dom_changed: 'DOM modifie',
    form_disappeared: 'Formulaire disparu',
    network_request_matching: 'Requete de soumission',
    field_value_equals: 'Valeur de champ',
    text_present: 'Texte present',
    text_absent: 'Texte absent',
    element_present: 'Element present',
    element_absent: 'Element absent',
    submission_outcome: 'Faisceau de preuves',
  };
  return labels[signal.type] ?? signal.type.replaceAll('_', ' ');
}

function humanizeFieldName(value: string): string {
  const cleaned = value
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Champ sans libelle';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function validationScopeLabel(testCase: TestCaseSuggestion): string {
  if (testCase.expected_outcome !== 'validation_error') return 'Parcours complet';
  return testCase.validation_scope === 'field' || testCase.target_field_id
    ? 'Champ cible'
    : 'Formulaire entier';
}

function matrixStatus(result: WorkflowExecutionDetail | undefined): {
  label: string;
  classes: string;
} {
  if (!result) return { label: 'Non execute', classes: 'bg-muted text-muted-foreground' };
  if (result.status === 'passed' || result.status === 'pass') {
    if (result.scenario?.expected_outcome === 'validation_error') {
      return { label: 'Conforme', classes: 'bg-emerald-100 text-emerald-700' };
    }
    return { label: 'Conforme', classes: 'bg-emerald-100 text-emerald-700' };
  }
  if (
    (result.status === 'failed' || result.status === 'fail') &&
    result.scenario?.expected_outcome === 'validation_error'
  ) {
    return { label: 'Acceptation inattendue', classes: 'bg-red-100 text-red-700' };
  }
  if (result.status === 'inconclusive' || result.status === 'needs_review') {
    return { label: 'Non concluant', classes: 'bg-amber-100 text-amber-800' };
  }
  if (result.status === 'error' || result.status === 'blocked') {
    return { label: 'Erreur technique', classes: 'bg-orange-100 text-orange-800' };
  }
  return { label: 'Ecart detecte', classes: 'bg-red-100 text-red-700' };
}

export function AIAssistantPanel({
  scenarios,
  results,
  testCaseSuggestions,
  formProfile,
  onGenerateTestCases,
  onUpdateTestCase,
  onCreateTestCases,
  onExecuteAllCases,
  onProposeWorkflowEdit,
  onApplyWorkflowEditPatch,
  onClearWorkflowEditPatch,
  aiEditPatch,
  isLoading,
  isExecuting,
  isAiEditing,
  isEditable,
}: AIAssistantPanelProps) {
  const [selectedCases, setSelectedCases] = useState<string[]>([]);
  const [selectedFormType, setSelectedFormType] = useState<FormProfileType | ''>('');
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
  const [editInstruction, setEditInstruction] = useState('');

  useEffect(() => {
    setSelectedCases(testCaseSuggestions.map((item) => item.id));
  }, [testCaseSuggestions]);

  useEffect(() => {
    if (formProfile?.form_type) setSelectedFormType(formProfile.form_type);
  }, [formProfile]);

  const latestResultByScenario = useMemo(() => {
    const latest = new Map<string, WorkflowExecutionDetail>();
    [...results]
      .sort((a, b) => new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime())
      .forEach((result) => {
        if (result.scenario_id && !latest.has(result.scenario_id)) latest.set(result.scenario_id, result);
      });
    return latest;
  }, [results]);

  const nominalValues = useMemo(() => {
    const nominal = testCaseSuggestions.find((item) =>
      item.expected_outcome === 'success' && /nominal|reference/i.test(item.name)
    ) ?? testCaseSuggestions.find((item) => item.expected_outcome === 'success');
    return new Map((nominal?.field_mutations ?? []).map((mutation) => [mutation.field_id, mutation.value]));
  }, [testCaseSuggestions]);

  const updateCase = (
    testCase: TestCaseSuggestion,
    updates: Partial<TestCaseSuggestion>,
  ) => onUpdateTestCase({ ...testCase, ...updates });

  const toggleSignal = (
    testCase: TestCaseSuggestion,
    signal: TestCaseExpectedSignal,
    enabled: boolean,
  ) => {
    const oracleSignals = (testCase.oracle?.signals ?? testCase.expected_signals).map((item) =>
      item === signal ? { ...item, enabled } : item
    );
    const nextSignals = enabled
      ? testCase.expected_signals.includes(signal)
        ? testCase.expected_signals
        : [...testCase.expected_signals, signal]
      : testCase.expected_signals.filter((item) => item !== signal);
    updateCase(testCase, {
      expected_signals: nextSignals,
      oracle: testCase.oracle
        ? { ...testCase.oracle, signals: oracleSignals }
        : undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Edition IA</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Demandez une modification, verifiez le patch, puis appliquez-le.
            </p>
          </div>
          <Sparkles className="h-5 w-5 shrink-0 text-primary" />
        </div>

        <Textarea
          className="mt-3 min-h-20 text-sm"
          value={editInstruction}
          onChange={(event) => setEditInstruction(event.target.value)}
          placeholder="Ex: ajoute une verification de message de succes apres la soumission et connecte-la au bouton submit"
          disabled={!isEditable || isAiEditing}
        />
        <Button
          className="mt-3 w-full"
          size="sm"
          variant="secondary"
          onClick={() => onProposeWorkflowEdit(editInstruction)}
          disabled={!isEditable || isAiEditing || !editInstruction.trim()}
        >
          {isAiEditing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
          Preparer la modification
        </Button>

        {aiEditPatch ? (
          <div className="mt-3 rounded-md border border-primary/25 bg-primary/5 p-3">
            <p className="text-sm font-semibold">{aiEditPatch.summary || 'Patch pret'}</p>
            {aiEditPatch.provider || aiEditPatch.model ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {aiEditPatch.provider ?? 'ia'} {aiEditPatch.model ? `- ${aiEditPatch.model}` : ''}
              </p>
            ) : null}
            {aiEditPatch.warnings?.length ? (
              <div className="mt-2 space-y-1 text-xs text-amber-700">
                {aiEditPatch.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            <div className="mt-3 space-y-1">
              {aiEditPatch.operations.map((operation, index) => (
                <div key={`${operation.op}-${index}`} className="rounded border bg-background px-2 py-1.5 text-xs">
                  <span className="font-semibold">{operation.op}</span>
                  {' '}
                  {'node_id' in operation && operation.node_id ? operation.node_id : ''}
                  {'type' in operation && operation.type ? operation.type : ''}
                  {'source_node_id' in operation ? `${operation.source_node_id} -> ${operation.target_node_id} (${operation.branch_key})` : ''}
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="sm" onClick={() => onApplyWorkflowEditPatch(aiEditPatch)} disabled={isLoading}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                Appliquer
              </Button>
              <Button size="sm" variant="outline" onClick={onClearWorkflowEditPatch}>
                <X className="mr-1.5 h-4 w-4" />
                Annuler
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plan de test branche</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Selectionnez le type metier, puis controlez chaque donnees, oracle et chemin avant creation.
            </p>
          </div>
          <FlaskConical className="h-5 w-5 shrink-0 text-primary" />
        </div>

        <label className="mt-3 block space-y-1.5 text-xs font-medium">
          <span>Type de formulaire</span>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={selectedFormType}
            onChange={(event) => setSelectedFormType(event.target.value as FormProfileType | '')}
            disabled={!isEditable || isLoading}
          >
            <option value="">Detection automatique</option>
            {FORM_TYPES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>

        <Button
          className="mt-3 w-full"
          variant="secondary"
          size="sm"
          onClick={() => onGenerateTestCases(selectedFormType || undefined)}
          disabled={!isEditable || isLoading}
        >
          <Sparkles className="mr-1.5 h-4 w-4" />
          Generer le plan
        </Button>

        {testCaseSuggestions.length > 0 ? (
          <div className="mt-3 space-y-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {testCaseSuggestions.length} scénarios proposés
            </p>
            {testCaseSuggestions.map((testCase) => {
              const checked = selectedCases.includes(testCase.id);
              const allSignals = testCase.oracle?.signals ?? testCase.expected_signals;
              const primaryMutations = testCase.field_mutations.filter((mutation) => {
                const reason = String(mutation.reason ?? '').toLowerCase();
                return mutation.field_id === testCase.target_field_id ||
                  nominalValues.get(mutation.field_id) !== mutation.value ||
                  /invalide|invalid|volontaire|refus|decoche|incompatible|vide|volumineu|limite/.test(reason);
              });
              const expanded = expandedCaseId === testCase.id;
              const targetLabel =
                testCase.target_field_name ||
                testCase.field_mutations.find((mutation) => mutation.field_id === testCase.target_field_id)?.field_name ||
                'Formulaire entier';
              return (
                <section
                  key={testCase.id}
                  className={cn(
                    'rounded-xl border p-3 transition',
                    checked ? 'border-primary/50 bg-primary/5' : 'border-border',
                  )}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <input
                      aria-label={`Selectionner ${testCase.name}`}
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelectedCases((current) =>
                          checked ? current.filter((id) => id !== testCase.id) : [...current, testCase.id],
                        );
                      }}
                      className="mt-1"
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setExpandedCaseId(expanded ? null : testCase.id)}
                    >
                      <span className="flex min-w-0 items-start justify-between gap-2">
                        <span className="min-w-0 break-words text-xs font-semibold text-foreground">
                          {testCase.name}
                        </span>
                        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', expanded && 'rotate-180')} />
                      </span>
                      <span className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                        <span className="rounded-full bg-background px-2 py-1 text-muted-foreground">
                          {BEHAVIOR_LABELS[behaviorFor(testCase)]}
                        </span>
                        <span className="max-w-full break-words rounded-full bg-background px-2 py-1 text-muted-foreground" title={targetLabel}>
                          {humanizeFieldName(targetLabel)}
                        </span>
                        <span className="rounded-full bg-background px-2 py-1 text-muted-foreground">
                          {validationScopeLabel(testCase)}
                        </span>
                        <span className="rounded-full bg-background px-2 py-1 text-muted-foreground">
                          {primaryMutations.length} valeur{primaryMutations.length > 1 ? 's' : ''} modifiee{primaryMutations.length > 1 ? 's' : ''}
                        </span>
                      </span>
                    </button>
                  </div>

                  {testCase.compilation_error ? (
                    <div className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-800">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="break-words">{testCase.compilation_error}</span>
                    </div>
                  ) : null}

                  {expanded ? <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
                    {testCase.expected_outcome === 'validation_error' ? (
                      <div className="grid gap-2 text-[10px] sm:grid-cols-2">
                        <div className="min-w-0 rounded-lg bg-muted/40 p-2">
                          <span className="text-muted-foreground">Portee de validation</span>
                          <p className="mt-1 break-words font-semibold">{validationScopeLabel(testCase)}</p>
                        </div>
                        <div className="min-w-0 rounded-lg bg-muted/40 p-2">
                          <span className="text-muted-foreground">Champ cible</span>
                          <p className="mt-1 break-words font-semibold" title={targetLabel}>
                            {humanizeFieldName(targetLabel)}
                          </p>
                        </div>
                      </div>
                    ) : null}
                    <label className="block space-y-1 text-[11px] font-medium">
                      <span>Comportement attendu</span>
                      <select
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                        value={behaviorFor(testCase)}
                        onChange={(event) => {
                          const behavior = event.target.value as 'accept' | 'reject' | 'explore';
                          updateCase(testCase, {
                            expected_behavior: behavior,
                            baseline_dependent: behavior === 'accept',
                            expectation_confidence: behavior === 'explore' ? 0.45 : 0.85,
                          });
                        }}
                      >
                        <option value="accept">Accepter les données</option>
                        <option value="reject">Refuser les données</option>
                        <option value="explore">Explorer sans anomalie automatique</option>
                      </select>
                    </label>
                    <label className="block space-y-1 text-[11px] font-medium">
                      <span>Sous-type technique</span>
                      <select
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                        value={testCase.expected_outcome}
                        onChange={(event) => {
                          const expectedOutcome = event.target.value as TestCaseSuggestion['expected_outcome'];
                          updateCase(testCase, {
                            expected_outcome: expectedOutcome,
                            expected_behavior:
                              expectedOutcome === 'success'
                                ? 'accept'
                                : ['validation_error', 'business_rejection'].includes(expectedOutcome)
                                  ? 'reject'
                                  : 'explore',
                            oracle: testCase.oracle
                              ? { ...testCase.oracle, expected_outcome: expectedOutcome }
                              : undefined,
                          });
                        }}
                      >
                        {OUTCOMES.map((item) => (
                          <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                      </select>
                    </label>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="space-y-1 text-[10px]">
                        <span>Seuil conforme</span>
                        <Input
                          type="number"
                          min="0"
                          max="1"
                          step="0.05"
                          className="h-8 text-xs"
                          value={testCase.oracle?.pass_threshold ?? 0.65}
                          onChange={(event) => updateCase(testCase, {
                            oracle: {
                              expected_outcome: testCase.expected_outcome,
                              signals: allSignals,
                              inconclusive_threshold: testCase.oracle?.inconclusive_threshold ?? 0.4,
                              pass_threshold: Number(event.target.value),
                            },
                          })}
                        />
                      </label>
                      <label className="space-y-1 text-[10px]">
                        <span>Seuil non concluant</span>
                        <Input
                          type="number"
                          min="0"
                          max="1"
                          step="0.05"
                          className="h-8 text-xs"
                          value={testCase.oracle?.inconclusive_threshold ?? 0.4}
                          onChange={(event) => updateCase(testCase, {
                            oracle: {
                              expected_outcome: testCase.expected_outcome,
                              signals: allSignals,
                              pass_threshold: testCase.oracle?.pass_threshold ?? 0.65,
                              inconclusive_threshold: Number(event.target.value),
                            },
                          })}
                        />
                      </label>
                    </div>

                    {primaryMutations.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Valeurs modifiees</p>
                        {primaryMutations.map((mutation) => {
                          const index = testCase.field_mutations.findIndex((item) => item === mutation);
                          const originalName = mutation.field_name ?? mutation.field_id;
                          return (
                          <label key={`${mutation.field_id}-${index}`} className="block min-w-0 space-y-1 text-[10px]">
                            <span className="block break-words" title={originalName}>
                              {humanizeFieldName(originalName)}
                            </span>
                            <Input
                              className="h-8 min-w-0 text-xs"
                              value={mutation.value}
                              onChange={(event) => updateCase(testCase, {
                                field_mutations: testCase.field_mutations.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, value: event.target.value } : item
                                ),
                              })}
                            />
                          </label>
                          );
                        })}
                      </div>
                    ) : null}

                    <details className="min-w-0 rounded-lg border border-border bg-background p-2">
                      <summary className="cursor-pointer text-[10px] font-semibold uppercase text-muted-foreground">
                        Toutes les donnees soumises ({testCase.field_mutations.length})
                      </summary>
                      <div className="mt-2 space-y-1.5">
                        {testCase.field_mutations.map((mutation) => {
                          const originalName = mutation.field_name ?? mutation.field_id;
                          return (
                            <div key={`all-${mutation.field_id}`} className="grid min-w-0 gap-1 rounded-md bg-muted/30 p-2 text-[10px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                              <span className="break-words font-medium" title={originalName}>{humanizeFieldName(originalName)}</span>
                              <span className="break-all text-muted-foreground">{mutation.value || '(vide)'}</span>
                            </div>
                          );
                        })}
                      </div>
                    </details>

                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground">Preuves actives</p>
                      {allSignals.map((signal, index) => {
                        const enabled = signal.enabled !== false;
                        return (
                          <label key={`${signal.type}-${signal.value ?? ''}-${index}`} className="flex items-center gap-2 text-[10px]">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(event) => toggleSignal(testCase, signal, event.target.checked)}
                            />
                            <span className="min-w-0 flex-1 break-words">
                              {evidenceLabel(signal)}
                              {signal.value ? `: ${signal.value}` : ''}
                            </span>
                            <span className="text-muted-foreground">{signal.weight ?? 0.25}</span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-2 rounded-lg bg-muted/40 p-2 text-[10px] text-muted-foreground">
                      <GitBranch className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span>
                        {testCase.route_steps?.length ?? 0} interaction(s), puis branche conforme ou diagnostic.
                      </span>
                    </div>
                  </div> : null}
                </section>
              );
            })}
            <div className="sticky bottom-0 z-10 rounded-xl border border-border bg-background/95 p-2 shadow-lg backdrop-blur">
              <Button
                className="w-full"
                size="sm"
                onClick={() => onCreateTestCases(selectedCases)}
                disabled={!isEditable || isLoading || selectedCases.length === 0}
              >
                Appliquer {selectedCases.length} scenario{selectedCases.length > 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {scenarios.length > 0 ? (
        <div className="rounded-2xl border border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Matrice de validation</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{scenarios.length} scenario(s)</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onExecuteAllCases(scenarios.map((scenario) => scenario.id))}
              disabled={isExecuting || scenarios.length === 0}
            >
              <Play className="mr-1 h-3.5 w-3.5" />
              Tout executer
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {scenarios.map((scenario) => {
              const result = latestResultByScenario.get(scenario.id);
              const display = matrixStatus(result);
              return (
                <div key={scenario.id} className="rounded-xl bg-muted/30 px-3 py-2">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-foreground">{scenario.name}</span>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', display.classes)}>
                      {display.label}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">{expectedLabel(scenario)}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

    </div>
  );
}
