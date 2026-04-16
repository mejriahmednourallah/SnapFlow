import { LockKeyhole, PencilLine } from 'lucide-react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '@/lib/utils';

interface FormFillNodeData {
  fieldLabel: string;
  fieldType: string;
  userValue: string | null;
  aiSuggestion: string | null;
  isSelected: boolean;
  isSensitive: boolean;
}

export function FormFillNode({ data }: { data: FormFillNodeData }) {
  return (
    <div
      className={cn(
        'bg-background border-2 rounded-xl px-4 py-3 shadow-sm min-w-[240px] transition-colors',
        data.isSelected ? 'border-primary/70' : 'border-border',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        <PencilLine className="h-3.5 w-3.5" />
        Champ
      </div>

      <p className="text-sm font-medium text-foreground truncate">{data.fieldLabel}</p>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[11px] text-muted-foreground">{data.fieldType}</span>
        {data.isSensitive ? <LockKeyhole className="h-3.5 w-3.5 text-orange-500" /> : null}
      </div>

      <div className="mt-2 text-xs">
        {data.userValue ? (
          <span className="text-emerald-600">Valeur personnalisée définie</span>
        ) : data.aiSuggestion && !data.isSensitive ? (
          <span className="text-blue-600">Suggestion IA disponible</span>
        ) : (
          <span className="text-red-500">Valeur manquante</span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}
