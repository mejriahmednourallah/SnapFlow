import { LockKeyhole, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FormWorkflow, WorkflowNodeWithFields } from '@/lib/form-tester/types';
import { cn } from '@/lib/utils';

interface DetectionPanelProps {
  workflow: FormWorkflow;
  nodes: WorkflowNodeWithFields[];
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string) => void;
  onDetect: () => Promise<void>;
  disabled: boolean;
  isDetecting: boolean;
  errorMessage: string | null;
}

export function DetectionPanel({
  workflow,
  nodes,
  selectedNodeId,
  onNodeSelect,
  onDetect,
  disabled,
  isDetecting,
  errorMessage,
}: DetectionPanelProps) {
  const formFillNodes = nodes.filter((node) => node.type === 'form_fill');
  const hasDetectedFields = formFillNodes.length > 0;

  return (
    <aside className="w-80 border-r border-border bg-background/95 flex flex-col h-full">
      <div className="p-4 border-b border-border space-y-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">URL cible</p>
          <p className="mt-1 text-xs break-all text-foreground">{workflow.target_url}</p>
        </div>

        {!disabled ? (
          <Button onClick={() => void onDetect()} disabled={isDetecting} className="w-full" size="sm">
            <Search className="h-4 w-4 mr-2" />
            {isDetecting ? 'Détection en cours...' : hasDetectedFields ? 'Re-détecter les formulaires' : 'Détecter les formulaires'}
          </Button>
        ) : null}

        {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
          Champs détectés ({formFillNodes.length})
        </p>

        {!hasDetectedFields ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Lancez la détection pour générer les champs de test.
          </div>
        ) : (
          formFillNodes.map((node) => {
            const field = node.field;
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => onNodeSelect(node.id)}
                className={cn(
                  'w-full text-left rounded-lg border p-3 transition-colors',
                  selectedNodeId === node.id
                    ? 'border-primary/70 bg-primary/5'
                    : 'border-border hover:border-primary/40 hover:bg-muted/40',
                )}
              >
                <p className="text-sm font-medium text-foreground truncate">{field?.field_label || field?.field_name || 'Champ'}</p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{field?.field_type || 'text'}</span>
                  {field?.required ? <span className="text-red-500">Requis</span> : null}
                  {field?.is_sensitive ? <LockKeyhole className="h-3.5 w-3.5 text-orange-500" /> : null}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground truncate">
                  {field?.user_value ? 'Valeur personnalisée définie' : field?.ai_suggestion ? 'Suggestion IA disponible' : 'Aucune valeur'}
                </p>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
