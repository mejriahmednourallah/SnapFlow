import { Plus } from 'lucide-react';
import type { NodeType } from '@/lib/form-tester/types';

const NODE_GROUPS: Array<{ title: string; nodes: Array<{ type: NodeType; label: string }> }> = [
  {
    title: 'Navigation',
    nodes: [
      { type: 'navigate', label: 'Ouvrir une page' },
      { type: 'wait', label: 'Attendre' },
    ],
  },
  {
    title: 'Formulaire',
    nodes: [
      { type: 'click', label: 'Cliquer' },
      { type: 'submit', label: 'Soumettre' },
    ],
  },
  {
    title: 'Validation',
    nodes: [
      { type: 'condition', label: 'Condition' },
      { type: 'assert', label: 'Assertion' },
    ],
  },
  {
    title: 'Debug',
    nodes: [
      { type: 'screenshot', label: 'Capture' },
      { type: 'inspect_response', label: 'Inspecter reponse' },
    ],
  },
];

interface NodePaletteProps {
  onAddNode: (type: NodeType) => void;
  disabled?: boolean;
}

export function NodePalette({ onAddNode, disabled = false }: NodePaletteProps) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Palette backend</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Ajoutez une condition, une validation ou une etape de diagnostic au scenario actif.
        </p>
      </div>
      {NODE_GROUPS.map((group) => (
        <div key={group.title} className="rounded-xl border border-border bg-muted/25 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</p>
          <div className="flex flex-wrap gap-2">
            {group.nodes.map((node) => (
              <button
                key={node.type}
                type="button"
                onClick={() => onAddNode(node.type)}
                disabled={disabled}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground transition hover:border-primary/60 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                title={node.type}
              >
                <Plus className="h-3 w-3" />
                {node.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
