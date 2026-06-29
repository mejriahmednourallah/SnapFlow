import { ShieldCheck } from 'lucide-react';
import { Handle, Position } from '@xyflow/react';

interface AssertNodeData {
  type: 'url_contains' | 'element_present' | 'text_present';
  value: string;
  label: string;
  isSelected?: boolean;
  status?: string;
}

const ASSERT_LABELS: Record<AssertNodeData['type'], string> = {
  url_contains: 'URL contient',
  element_present: 'Element present',
  text_present: 'Texte visible',
};

function dotClass(status?: string): string {
  if (status === 'running') return 'bg-blue-500';
  if (status === 'passed') return 'bg-emerald-500';
  if (status === 'failed') return 'bg-red-500';
  return 'bg-indigo-500';
}

export function AssertNode({ data }: { data: AssertNodeData }) {
  return (
    <div
      className={`relative flex w-24 flex-col items-center text-center transition-all ${
        data.isSelected ? 'scale-105' : 'hover:scale-105'
      }`}
      title={data.value || data.label || ASSERT_LABELS[data.type]}
    >
      <Handle id="default" type="target" position={Position.Top} className="!h-3.5 !w-3.5 !border-2 !border-background !bg-indigo-500" />
      <div
        className={`relative flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-indigo-500 bg-background shadow-md transition-all ${
          data.isSelected ? 'ring-4 ring-primary/20' : 'hover:shadow-lg'
        }`}
      >
        <span className={`absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ${dotClass(data.status)}`} />
        <ShieldCheck className="h-7 w-7 text-indigo-700" />
      </div>
      <p className="mt-2 line-clamp-2 max-w-[92px] text-[11px] font-semibold leading-tight text-foreground">
        {data.label || ASSERT_LABELS[data.type]}
      </p>
      <p className="mt-0.5 max-w-[86px] truncate text-[9px] uppercase tracking-wide text-muted-foreground">assert</p>
      <Handle id="default" type="source" position={Position.Bottom} className="!h-3.5 !w-3.5 !border-2 !border-background !bg-indigo-500" />
    </div>
  );
}
