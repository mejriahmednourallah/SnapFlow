import { FlaskConical, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type {
  ExpectedOutcome,
  FormCandidate,
  NodeType,
  WorkflowNodeWithFields,
  WorkflowWithDetails,
} from '@/lib/form-tester/types';
import { cn } from '@/lib/utils';
import { StatusBadge } from '../StatusBadge';
import { NodePalette } from './NodePalette';

interface ScenarioSidebarProps {
  workflow: WorkflowWithDetails;
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string) => void;
  onScenarioSelect: (scenarioId: string) => void;
  onDetect: (selectedFormSelector?: string) => void;
  onAddNode: (type: NodeType) => void;
  disabled: boolean;
  isDetecting: boolean;
  isSaving: boolean;
}

function fieldLabel(node: WorkflowNodeWithFields): string {
  return node.field?.field_label ?? node.field?.field_name ?? node.type;
}

const EXPECTED_OUTCOME_LABELS: Record<ExpectedOutcome, string> = {
  success: 'Succes attendu',
  validation_error: 'Validation attendue',
  business_rejection: 'Refus metier attendu',
  server_error: 'Erreur serveur attendue',
  blocked: 'Blocage attendu',
};

export function ScenarioSidebar({
  workflow,
  selectedNodeId,
  onNodeSelect,
  onScenarioSelect,
  onDetect,
  onAddNode,
  disabled,
  isDetecting,
  isSaving,
}: ScenarioSidebarProps) {
  const fields = workflow.nodes.filter((node) => node.field);
  const latestVersion = workflow.scenario_versions?.[0] ?? null;
  const formCandidates = Array.isArray(workflow.detection_evidence?.form_candidates)
    ? workflow.detection_evidence.form_candidates as unknown as FormCandidate[]
    : [];
  const selectedIdentity =
    workflow.detection_evidence?.selected_form_identity &&
    typeof workflow.detection_evidence.selected_form_identity === 'object'
      ? workflow.detection_evidence.selected_form_identity as { selector?: string }
      : null;
  const selectionRequired = workflow.detection_evidence?.selection_required === true;

  return (
    <ScrollArea className="h-full w-full max-w-full min-w-0 overflow-hidden [&_[data-radix-scroll-area-viewport]]:overflow-x-hidden">
      <div className="box-border w-full max-w-full min-w-0 space-y-5 overflow-x-hidden p-4">
        <section className="box-border w-full max-w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-muted/20 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scenario actif</p>
              <h3 className="mt-1 truncate text-sm font-semibold text-foreground">
                {workflow.active_scenario?.name ?? 'Scenario principal'}
              </h3>
            </div>
            <StatusBadge status={workflow.status} size="sm" />
          </div>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex min-w-0 items-center justify-between gap-3 overflow-hidden rounded-xl bg-background px-3 py-2">
              <span className="shrink-0 text-muted-foreground">Version</span>
              <strong className="min-w-0 truncate text-right">{latestVersion ? `v${latestVersion.version_number}` : 'Brouillon'}</strong>
            </div>
          </div>
        </section>

        <section className="w-full max-w-full min-w-0 space-y-2 overflow-hidden">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Cas de test
            </p>
          </div>
          <div className="space-y-2">
            {workflow.scenarios.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                onClick={() => onScenarioSelect(scenario.id)}
                className={cn(
                  'box-border block w-full max-w-full min-w-0 overflow-hidden rounded-xl border px-3 py-2 text-left transition',
                  workflow.active_scenario.id === scenario.id
                    ? 'border-primary/60 bg-primary/5'
                    : 'border-border bg-background hover:border-primary/40',
                )}
              >
                <span className="block truncate text-xs font-semibold text-foreground">{scenario.name}</span>
                <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span className="truncate">{scenario.generation_source === 'ai' ? 'Genere par IA' : 'Scenario manuel'}</span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5">
                    {EXPECTED_OUTCOME_LABELS[scenario.expected_outcome] ?? 'Resultat a verifier'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="w-full max-w-full min-w-0 space-y-3 overflow-hidden">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Formulaire detecte</p>
              <p className="truncate text-xs text-muted-foreground">{workflow.detection_sources?.join(', ') || 'Source non renseignee'}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void onDetect()} disabled={disabled || isDetecting}>
              <RefreshCcw className="mr-1 h-3.5 w-3.5" />
              Detecter
            </Button>
          </div>

          {formCandidates.length > 1 ? (
            <div className="rounded-xl border border-border bg-background p-3">
              <label className="block text-xs font-medium text-foreground" htmlFor="selected-form-candidate">
                Formulaire analyse
              </label>
              <select
                id="selected-form-candidate"
                value={selectedIdentity?.selector ?? formCandidates[0]?.identity?.selector ?? ''}
                onChange={(event) => void onDetect(event.target.value)}
                disabled={disabled || isDetecting}
                className="mt-2 h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-xs"
              >
                {formCandidates.map((candidate, index) => (
                  <option key={candidate.identity.selector || index} value={candidate.identity.selector}>
                    {candidate.form_type} - {candidate.fields_count} champ(s)
                  </option>
                ))}
              </select>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                {selectionRequired
                  ? 'Plusieurs formulaires sont plausibles. Confirmez celui que cette campagne doit tester.'
                  : 'Les autres formulaires de la page sont exclus des validations de ce workflow.'}
              </p>
            </div>
          ) : null}

          <div className="w-full max-w-full min-w-0 space-y-2 overflow-hidden">
            {fields.length === 0 ? (
              <div className="box-border w-full max-w-full rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                Aucun champ detecte pour le moment.
              </div>
            ) : (
              fields.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onNodeSelect(node.id)}
                  className={cn(
                    'box-border block w-full max-w-full min-w-0 overflow-hidden rounded-xl border p-3 text-left transition hover:border-primary/50 hover:bg-primary/5',
                    selectedNodeId === node.id ? 'border-primary/60 bg-primary/5' : 'border-border bg-background',
                  )}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-foreground">
                      {fieldLabel(node)}
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {node.field?.field_type}
                    </span>
                  </div>
                  <p className="mt-1 max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                    {node.field?.field_selector}
                  </p>
                </button>
              ))
            )}
          </div>
        </section>

        <NodePalette onAddNode={onAddNode} disabled={disabled || isSaving} />
      </div>
    </ScrollArea>
  );
}
