import { Globe } from 'lucide-react';
import { Handle, Position } from '@xyflow/react';

interface TriggerNodeData {
  url: string;
}

export function TriggerNode({ data }: { data: TriggerNodeData }) {
  return (
    <div className="bg-background border-2 border-primary/50 rounded-xl px-4 py-3 shadow-sm min-w-[240px]">
      <div className="flex items-center gap-2 text-xs font-semibold text-primary uppercase tracking-wide mb-1">
        <Globe className="h-3.5 w-3.5" />
        Déclencheur
      </div>
      <p className="text-xs text-muted-foreground truncate">{data.url}</p>
      <Handle type="source" position={Position.Bottom} className="!bg-primary" />
    </div>
  );
}
