import { Send } from 'lucide-react';
import { Handle, Position } from '@xyflow/react';

interface SubmitNodeData {
  selector: string;
  isSelected?: boolean;
  status?: string;
}

function dotClass(status?: string): string {
  if (status === 'running') return 'bg-blue-500';
  if (status === 'passed') return 'bg-emerald-500';
  if (status === 'failed') return 'bg-red-500';
  return 'bg-green-500';
}

export function SubmitNode({ data }: { data: SubmitNodeData }) {
  return (
    <div
      className={`relative flex w-24 flex-col items-center text-center transition-all ${
        data.isSelected ? 'scale-105' : 'hover:scale-105'
      }`}
      title={data.selector || 'button[type="submit"]'}
    >
      <Handle id="default" type="target" position={Position.Top} className="!h-2 !w-2 !bg-green-500" />
      <div
        className={`relative flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-green-500 bg-background shadow-md transition-all ${
          data.isSelected ? 'ring-4 ring-primary/20' : 'hover:shadow-lg'
        }`}
      >
        <span className={`absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ${dotClass(data.status)}`} />
        <Send className="h-7 w-7 text-green-700" />
      </div>
      <p className="mt-2 line-clamp-2 max-w-[92px] text-[11px] font-semibold leading-tight text-foreground">
        Soumettre
      </p>
      <p className="mt-0.5 max-w-[86px] truncate text-[9px] uppercase tracking-wide text-muted-foreground">submit</p>
      <div className="mt-1 flex w-full justify-between px-1 text-[9px] font-semibold uppercase tracking-wide">
        <span className="text-red-600">Echec</span>
        <span className="text-emerald-600">Succes</span>
      </div>
      <Handle
        id="failure"
        type="source"
        position={Position.Bottom}
        className="!bottom-0 !left-5 !h-2.5 !w-2.5 !bg-red-500"
      />
      <Handle
        id="success"
        type="source"
        position={Position.Bottom}
        className="!bottom-0 !left-auto !right-5 !h-2.5 !w-2.5 !bg-emerald-500"
      />
    </div>
  );
}
