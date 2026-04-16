import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { FieldConfigPanelProps } from '@/lib/form-tester/types';

interface Props extends FieldConfigPanelProps {
  isDisabled?: boolean;
}

export function FieldConfigPanel({ field, onUpdate, onResuggest, isLoading, isDisabled = false }: Props) {
  const [draftValue, setDraftValue] = useState(field.user_value ?? '');

  useEffect(() => {
    setDraftValue(field.user_value ?? '');
  }, [field.id, field.user_value]);

  const handleSave = async (): Promise<void> => {
    await onUpdate(field.id, draftValue);
  };

  const effectiveValue = field.user_value ?? field.ai_suggestion ?? '';

  return (
    <aside className="w-96 border-l border-border bg-background p-5 overflow-y-auto space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{field.field_label ?? field.field_name}</h3>
        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="px-2 py-0.5 rounded bg-secondary">{field.field_type}</span>
          {field.required ? <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">Requis</span> : null}
          {field.is_sensitive ? <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-700">Sensible</span> : null}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground font-mono break-all">{field.field_selector}</p>
      </div>

      {!field.is_sensitive && field.ai_suggestion ? (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-primary">Suggestion IA</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onResuggest(field.id)}
              disabled={isLoading || isDisabled}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              Re-suggérer
            </Button>
          </div>
          <p className="text-sm text-foreground">{field.ai_suggestion}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDraftValue(field.ai_suggestion ?? '');
              void onUpdate(field.id, field.ai_suggestion ?? '');
            }}
            disabled={isDisabled}
          >
            Utiliser cette suggestion
          </Button>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Valeur personnalisée</p>
        {field.field_type === 'textarea' ? (
          <Textarea
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            rows={4}
            disabled={field.is_sensitive || isDisabled}
            placeholder={field.placeholder ?? ''}
          />
        ) : (
          <Input
            type={field.field_type === 'password' ? 'password' : 'text'}
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            disabled={field.is_sensitive || isDisabled}
            placeholder={field.placeholder ?? ''}
          />
        )}
        <Button onClick={() => void handleSave()} disabled={isDisabled || isLoading} size="sm">
          Enregistrer la valeur
        </Button>
        {field.is_sensitive ? (
          <p className="text-xs text-orange-600">
            Ce champ est sensible. La valeur sera protégée et gérée en mode sécurisé.
          </p>
        ) : null}
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Valeur à l exécution</p>
        <p className="mt-1 text-sm text-foreground">{effectiveValue || 'Aucune valeur définie'}</p>
      </div>
    </aside>
  );
}
