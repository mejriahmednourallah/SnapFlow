import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { FieldConfigPanelProps } from '@/lib/form-tester/types';

interface Props extends FieldConfigPanelProps {
  isDisabled?: boolean;
  embedded?: boolean;
}

function isSecretLikeField(fieldName: string, fieldLabel: string | null, fieldType: string): boolean {
  const text = `${fieldType} ${fieldName} ${fieldLabel ?? ''}`.toLowerCase();
  return fieldType === 'password' || /password|passwd|mot.?de.?passe|token|secret|api.?key/.test(text);
}

function isCheckedValue(value: string): boolean {
  return /^(true|1|yes|oui|on|checked)$/i.test(value.trim());
}

function inputTypeFor(fieldType: string): string {
  if (['email', 'tel', 'password', 'number', 'date', 'time', 'url', 'search'].includes(fieldType)) return fieldType;
  return 'text';
}

export function FieldConfigPanel({ field, onUpdate, isLoading, isDisabled = false, embedded = false }: Props) {
  const [draftValue, setDraftValue] = useState(field.user_value ?? '');

  useEffect(() => {
    setDraftValue(field.user_value ?? '');
  }, [field.id, field.user_value]);

  const handleSave = async (): Promise<void> => {
    await onUpdate(field.id, draftValue);
  };

  const effectiveValue = field.user_value ?? '';
  const secretLikeField = isSecretLikeField(field.field_name, field.field_label, field.field_type);
  const checkboxChecked = isCheckedValue(draftValue);

  return (
    <div className={embedded ? 'space-y-5' : 'w-96 border-l border-border bg-background p-5 overflow-y-auto space-y-5'}>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{field.field_label ?? field.field_name}</h3>
        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="px-2 py-0.5 rounded bg-secondary">{field.field_type}</span>
          {field.required ? <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">Requis</span> : null}
          {field.is_sensitive ? (
            <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-700">
              {secretLikeField ? 'Secret' : 'Masque dans les journaux'}
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground font-mono break-all">{field.field_selector}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Valeur personnalisee</p>
        {field.field_type === 'checkbox' || field.field_type === 'radio' ? (
          <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
            <Checkbox
              checked={checkboxChecked}
              onCheckedChange={(checked) => setDraftValue(checked ? 'true' : 'false')}
              disabled={isDisabled}
            />
            <span className="leading-5">
              {field.field_type === 'radio' ? 'Selectionner cette option pendant le test' : 'Cocher ce champ pendant le test'}
              <span className="block text-xs text-muted-foreground">
                Utile pour les choix, consentements, reglements, conditions et PPDP.
              </span>
            </span>
          </label>
        ) : field.field_type === 'textarea' ? (
          <Textarea
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            rows={4}
            disabled={isDisabled}
            placeholder={field.placeholder ?? ''}
          />
        ) : (
          <Input
            type={inputTypeFor(field.field_type)}
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            disabled={isDisabled}
            placeholder={field.placeholder ?? ''}
          />
        )}
        <Button onClick={() => void handleSave()} disabled={isDisabled || isLoading} size="sm">
          Enregistrer la valeur
        </Button>
        {field.is_sensitive ? (
          <p className="text-xs text-orange-600">
            La saisie reste autorisee avec des donnees fictives. La valeur sera masquee dans les journaux et resultats.
          </p>
        ) : null}
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Valeur a l execution</p>
        <p className="mt-1 text-sm text-foreground">{effectiveValue || 'Aucune valeur definie'}</p>
      </div>
    </div>
  );
}
