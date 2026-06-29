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
  status?: string;
}

function statusClass(data: FormFillNodeData): string {
  if (data.status === 'running') return 'border-blue-500 shadow-blue-500/20';
  if (data.status === 'passed') return 'border-emerald-500 shadow-emerald-500/20';
  if (data.status === 'failed') return 'border-red-500 shadow-red-500/20';
  if (data.userValue) return 'border-emerald-400 shadow-emerald-500/10';
  if (data.aiSuggestion && !data.isSensitive) return 'border-sky-400 shadow-sky-500/10';
  return 'border-amber-400 shadow-amber-500/10';
}

function statusDotClass(data: FormFillNodeData): string {
  if (data.status === 'running') return 'bg-blue-500';
  if (data.status === 'passed' || data.userValue) return 'bg-emerald-500';
  if (data.status === 'failed') return 'bg-red-500';
  if (data.aiSuggestion && !data.isSensitive) return 'bg-sky-500';
  return 'bg-amber-500';
}

export function FormFillNode({ data }: { data: FormFillNodeData }) {
  return (
    <div className="relative flex w-24 flex-col items-center text-center" title={`${data.fieldLabel} - ${data.fieldType}`}>
      <Handle id="default" type="target" position={Position.Top} className="!top-0 !h-3.5 !w-3.5 !border-2 !border-background !bg-muted-foreground" />
      <div
        className={cn(
          'relative flex h-16 w-16 items-center justify-center rounded-2xl border-2 bg-background shadow-md transition-all',
          statusClass(data),
          data.isSelected ? 'scale-105 ring-4 ring-primary/20' : 'hover:-translate-y-0.5 hover:shadow-lg',
        )}
      >
        <span className={cn('absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-background', statusDotClass(data))} />
        {data.isSensitive ? <LockKeyhole className="absolute -left-1 -top-1 h-3.5 w-3.5 text-orange-500" /> : null}
        <PencilLine className="h-7 w-7 text-emerald-700" />
      </div>
      <p className="mt-2 line-clamp-2 max-w-24 text-[11px] font-semibold leading-tight text-foreground">{data.fieldLabel}</p>
      <p className="mt-0.5 max-w-24 truncate text-[9px] uppercase tracking-wide text-muted-foreground">{data.fieldType}</p>
      <Handle id="default" type="source" position={Position.Bottom} className="!bottom-0 !h-3.5 !w-3.5 !border-2 !border-background !bg-muted-foreground" />
    </div>
  );
}
