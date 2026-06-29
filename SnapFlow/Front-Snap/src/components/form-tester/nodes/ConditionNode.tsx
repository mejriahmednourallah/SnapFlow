import { GitBranch } from 'lucide-react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '@/lib/utils';

interface ConditionNodeData {
  label: string;
  detail?: string;
  status?: 'configured' | 'missing' | 'passed' | 'failed' | 'running' | 'skipped';
  isSelected?: boolean;
}

export function ConditionNode({ data }: { data: ConditionNodeData }) {
  return (
    <div className="relative flex w-28 flex-col items-center text-center" title={data.detail || data.label}>
      <Handle id="default" type="target" position={Position.Top} className="!h-3.5 !w-3.5 !border-2 !border-background !bg-violet-500" />
      <div
        className={cn(
          'relative flex h-16 w-16 rotate-45 items-center justify-center rounded-2xl border-2 border-violet-500 bg-background shadow-md transition-all',
          data.isSelected ? 'scale-105 ring-4 ring-primary/20' : 'hover:-translate-y-0.5 hover:shadow-lg',
        )}
      >
        <GitBranch className="-rotate-45 h-7 w-7 text-violet-700" />
      </div>
      <p className="mt-3 line-clamp-2 max-w-28 text-[11px] font-semibold leading-tight text-foreground">
        {data.label || 'Condition'}
      </p>
      <div className="mt-1 flex w-full justify-between px-1 text-[9px] font-semibold uppercase tracking-wide">
        <span className="text-red-600">Faux</span>
        <span className="text-emerald-600">Vrai</span>
      </div>
      <Handle
        id="false"
        type="source"
        position={Position.Bottom}
        className="!bottom-0 !left-5 !h-3.5 !w-3.5 !border-2 !border-background !bg-red-500"
      />
      <Handle
        id="true"
        type="source"
        position={Position.Bottom}
        className="!bottom-0 !left-auto !right-5 !h-3.5 !w-3.5 !border-2 !border-background !bg-emerald-500"
      />
    </div>
  );
}
