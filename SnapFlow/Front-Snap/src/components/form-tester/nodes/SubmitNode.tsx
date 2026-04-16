import { Send } from 'lucide-react';
import { Handle, Position } from '@xyflow/react';

interface SubmitNodeData {
  selector: string;
}

export function SubmitNode({ data }: { data: SubmitNodeData }) {
  return (
    <div className="bg-background border-2 border-emerald-400/70 rounded-xl px-4 py-3 shadow-sm min-w-[240px]">
      <Handle type="target" position={Position.Top} className="!bg-emerald-500" />
      <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">
        <Send className="h-3.5 w-3.5" />
        Soumission
      </div>
      <p className="text-xs text-muted-foreground font-mono truncate">{data.selector || 'button[type="submit"]'}</p>
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-500" />
    </div>
  );
}
