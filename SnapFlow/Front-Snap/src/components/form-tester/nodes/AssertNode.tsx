import { ShieldCheck } from 'lucide-react';
import { Handle, Position } from '@xyflow/react';

interface AssertNodeData {
  type: 'url_contains' | 'element_present' | 'text_present';
  value: string;
  label: string;
}

const ASSERT_LABELS: Record<AssertNodeData['type'], string> = {
  url_contains: 'URL contient',
  element_present: 'Élément présent',
  text_present: 'Texte visible',
};

export function AssertNode({ data }: { data: AssertNodeData }) {
  return (
    <div className="bg-background border-2 border-violet-400/70 rounded-xl px-4 py-3 shadow-sm min-w-[240px]">
      <Handle type="target" position={Position.Top} className="!bg-violet-500" />
      <div className="flex items-center gap-2 text-xs font-semibold text-violet-700 uppercase tracking-wide mb-1">
        <ShieldCheck className="h-3.5 w-3.5" />
        Assertion
      </div>
      <p className="text-sm text-foreground truncate">{data.label || ASSERT_LABELS[data.type]}</p>
      {data.value ? <p className="text-xs text-muted-foreground font-mono truncate mt-1">{data.value}</p> : null}
    </div>
  );
}
