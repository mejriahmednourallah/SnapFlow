import {
  Bot,
  Camera,
  CheckCircle2,
  Clock3,
  Code2,
  Download,
  FileCheck2,
  GitBranch,
  MousePointerClick,
  Navigation,
  Play,
  Upload,
} from 'lucide-react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { NodeType } from '@/lib/form-tester/types';

interface GenericActionNodeData {
  kind: NodeType;
  label: string;
  detail?: string;
  status?: 'configured' | 'missing' | 'passed' | 'failed' | 'running' | 'skipped';
  isSelected?: boolean;
}

const NODE_STYLE: Record<string, { icon: typeof Navigation; border: string; dot: string; text: string }> = {
  trigger: { icon: Navigation, border: 'border-sky-500', dot: 'bg-sky-500', text: 'text-sky-700' },
  navigate: { icon: Navigation, border: 'border-sky-500', dot: 'bg-sky-500', text: 'text-sky-700' },
  form_fill: { icon: FileCheck2, border: 'border-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  fill: { icon: FileCheck2, border: 'border-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  select: { icon: CheckCircle2, border: 'border-teal-500', dot: 'bg-teal-500', text: 'text-teal-700' },
  check: { icon: CheckCircle2, border: 'border-teal-500', dot: 'bg-teal-500', text: 'text-teal-700' },
  upload: { icon: Upload, border: 'border-orange-500', dot: 'bg-orange-500', text: 'text-orange-700' },
  click: { icon: MousePointerClick, border: 'border-amber-500', dot: 'bg-amber-500', text: 'text-amber-700' },
  submit: { icon: Play, border: 'border-green-500', dot: 'bg-green-500', text: 'text-green-700' },
  wait: { icon: Clock3, border: 'border-slate-500', dot: 'bg-slate-500', text: 'text-slate-700' },
  condition: { icon: GitBranch, border: 'border-violet-500', dot: 'bg-violet-500', text: 'text-violet-700' },
  assert: { icon: Code2, border: 'border-indigo-500', dot: 'bg-indigo-500', text: 'text-indigo-700' },
  screenshot: { icon: Camera, border: 'border-cyan-500', dot: 'bg-cyan-500', text: 'text-cyan-700' },
  inspect_response: { icon: Download, border: 'border-fuchsia-500', dot: 'bg-fuchsia-500', text: 'text-fuchsia-700' },
};

function statusStyle(status: GenericActionNodeData['status'], fallback: { border: string; dot: string }) {
  if (status === 'running') return { border: 'border-blue-500', dot: 'bg-blue-500' };
  if (status === 'passed') return { border: 'border-emerald-500', dot: 'bg-emerald-500' };
  if (status === 'failed') return { border: 'border-red-500', dot: 'bg-red-500' };
  if (status === 'missing') return { border: 'border-amber-500', dot: 'bg-amber-500' };
  return fallback;
}

export function GenericActionNode({ data }: { data: GenericActionNodeData }) {
  const style = NODE_STYLE[data.kind] ?? { icon: Bot, border: 'border-border', dot: 'bg-muted-foreground', text: 'text-muted-foreground' };
  const state = statusStyle(data.status, style);
  const Icon = style.icon;

  return (
    <div className="relative flex w-24 flex-col items-center text-center" title={`${data.label}${data.detail ? ` - ${data.detail}` : ''}`}>
      <Handle id="default" type="target" position={Position.Top} className="!top-0 !h-3.5 !w-3.5 !border-2 !border-background !bg-muted-foreground" />
      <div
        className={cn(
          'relative flex h-16 w-16 items-center justify-center rounded-2xl border-2 bg-background shadow-md transition-all',
          state.border,
          data.isSelected ? 'scale-105 ring-4 ring-primary/20' : 'hover:-translate-y-0.5 hover:shadow-lg',
        )}
      >
        <span className={cn('absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-background', state.dot)} />
        <Icon className={cn('h-7 w-7', style.text)} />
      </div>
      <p className="mt-2 line-clamp-2 max-w-24 text-[11px] font-semibold leading-tight text-foreground">{data.label}</p>
      <p className="mt-0.5 max-w-24 truncate text-[9px] uppercase tracking-wide text-muted-foreground">{data.kind}</p>
      <Handle id="default" type="source" position={Position.Bottom} className="!bottom-0 !h-3.5 !w-3.5 !border-2 !border-background !bg-muted-foreground" />
    </div>
  );
}
