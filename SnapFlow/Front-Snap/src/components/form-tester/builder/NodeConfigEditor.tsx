import { useEffect, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { WorkflowNodeWithFields } from '@/lib/form-tester/types';

interface NodeConfigEditorProps {
  node: WorkflowNodeWithFields;
  isEditable: boolean;
  isLoading: boolean;
  onSave: (nodeId: string, config: Record<string, unknown>) => Promise<void>;
  onDelete: (nodeId: string) => Promise<void>;
}

const CONDITION_TYPES = [
  ['text_present', 'Texte present'],
  ['text_absent', 'Texte absent'],
  ['element_present', 'Element present'],
  ['element_absent', 'Element absent'],
  ['url_contains', 'URL contient'],
  ['response_status', 'Statut HTTP'],
  ['response_status_range', 'Plage de statuts HTTP'],
  ['form_invalid', 'Formulaire invalide'],
  ['validation_message_present', 'Message de validation present'],
  ['url_changed', 'URL modifiee'],
  ['dom_changed', 'Contenu de page modifie'],
  ['form_disappeared', 'Formulaire disparu'],
  ['network_request_matching', 'Requete reseau observee'],
  ['field_value_equals', 'Valeur de champ egale'],
  ['submission_outcome', 'Verdict de soumission'],
] as const;

function editableFields(node: WorkflowNodeWithFields): Array<{
  key: string;
  label: string;
  inputType?: string;
}> {
  if (node.type === 'navigate') return [{ key: 'url', label: 'URL' }];
  if (['click', 'submit'].includes(node.type)) return [{ key: 'selector', label: 'Selecteur CSS' }];
  if (node.type === 'wait') return [{ key: 'milliseconds', label: 'Duree en millisecondes', inputType: 'number' }];
  if (node.type === 'screenshot') return [{ key: 'label', label: 'Nom de la capture' }];
  if (node.type === 'inspect_response') return [{ key: 'label', label: 'Libelle' }];
  return [];
}

export function NodeConfigEditor({
  node,
  isEditable,
  isLoading,
  onSave,
  onDelete,
}: NodeConfigEditorProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>(node.config ?? {});

  useEffect(() => {
    setDraft(node.config ?? {});
  }, [node.id, node.config]);

  const isRuleNode = node.type === 'condition' || node.type === 'assert';
  const ruleType = typeof draft.type === 'string' ? draft.type : 'text_present';
  const needsValue = ![
    'form_invalid',
    'validation_message_present',
    'url_changed',
    'dom_changed',
    'submission_outcome',
  ].includes(ruleType);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Noeud selectionne</p>
        <h3 className="mt-1 text-base font-semibold capitalize text-foreground">{node.type.replaceAll('_', ' ')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">Etape {node.order_index + 1}</p>
      </div>

      <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4">
        {isRuleNode ? (
          <>
            <label className="block space-y-1.5 text-xs font-medium text-foreground">
              <span>Libelle</span>
              <Input
                value={typeof draft.label === 'string' ? draft.label : ''}
                onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                disabled={!isEditable || isLoading}
              />
            </label>
            <label className="block space-y-1.5 text-xs font-medium text-foreground">
              <span>Regle</span>
              <select
                value={ruleType}
                onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}
                disabled={!isEditable || isLoading}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {CONDITION_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            {needsValue ? (
              <label className="block space-y-1.5 text-xs font-medium text-foreground">
                <span>Valeur attendue</span>
                <Input
                  value={typeof draft.value === 'string' ? draft.value : ''}
                  onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
                  disabled={!isEditable || isLoading}
                  placeholder={ruleType === 'response_status' ? '200' : 'Texte, URL ou selecteur'}
                />
              </label>
            ) : null}
          </>
        ) : (
          editableFields(node).map((field) => (
            <label key={field.key} className="block space-y-1.5 text-xs font-medium text-foreground">
              <span>{field.label}</span>
              <Input
                type={field.inputType ?? 'text'}
                value={String(draft[field.key] ?? '')}
                onChange={(event) => {
                  const value = field.inputType === 'number'
                    ? Number(event.target.value || 0)
                    : event.target.value;
                  setDraft((current) => ({ ...current, [field.key]: value }));
                }}
                disabled={!isEditable || isLoading}
              />
            </label>
          ))
        )}

        {editableFields(node).length === 0 && !isRuleNode ? (
          <p className="text-xs leading-5 text-muted-foreground">
            Ce noeud ne demande pas de parametre visible. Ses details techniques restent conserves.
          </p>
        ) : null}

        <Button
          className="w-full"
          size="sm"
          onClick={() => void onSave(node.id, draft)}
          disabled={!isEditable || isLoading}
        >
          <Save className="mr-1.5 h-4 w-4" />
          Enregistrer la configuration
        </Button>
      </div>

      {node.type !== 'trigger' ? (
        <Button
          className="w-full"
          variant="outline"
          size="sm"
          onClick={() => void onDelete(node.id)}
          disabled={!isEditable || isLoading}
        >
          <Trash2 className="mr-1.5 h-4 w-4 text-destructive" />
          Supprimer le noeud
        </Button>
      ) : null}
    </div>
  );
}
