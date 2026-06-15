import { Globe } from 'lucide-react';
import { Handle, Position } from '@xyflow/react';

interface TriggerNodeData {
  url: string;
  isSelected?: boolean;
  status?: string;
}

export function TriggerNode({ data }: { data: TriggerNodeData }) {
  return (
    <div
      className="relative flex w-24 flex-col items-center text-center"
      title={data.url}
    >
      <div
        className={`relative flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-sky-500 bg-background shadow-md transition-all ${
          data.isSelected ? 'scale-105 ring-4 ring-primary/20' : 'hover:-translate-y-0.5 hover:shadow-lg'
        }`}
      >
        <span className={`absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-background ${data.status === 'running' ? 'bg-blue-500' : 'bg-sky-500'}`} />
        <Globe className="h-7 w-7 text-sky-700" />
      </div>
      <p className="mt-2 line-clamp-2 max-w-24 text-[11px] font-semibold leading-tight text-foreground">Ouvrir</p>
      <p className="mt-0.5 max-w-24 truncate text-[9px] uppercase tracking-wide text-muted-foreground">page</p>
      <Handle id="default" type="source" position={Position.Bottom} className="!bottom-0 !h-2 !w-2 !bg-sky-500" />
    </div>
  );
}
