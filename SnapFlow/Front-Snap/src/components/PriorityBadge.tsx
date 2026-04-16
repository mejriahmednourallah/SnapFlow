import { Priority, getPriorityLabel } from '@/data/mockAuditData';

interface PriorityBadgeProps {
  priority: Priority;
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  const styles: Record<Priority, string> = {
    'quick-win': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    'moyen-terme': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    'long-terme': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[priority]}`}>
      {getPriorityLabel(priority)}
    </span>
  );
}
