import type { StatusBadgeProps } from '@/lib/form-tester/types';
import { cn } from '@/lib/utils';

const STATUS_CONFIG: Record<StatusBadgeProps['status'], { label: string; classes: string }> = {
  draft: { label: 'Brouillon', classes: 'bg-muted text-muted-foreground' },
  needs_review: { label: 'A valider', classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  pending: { label: 'En attente', classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  approved: { label: 'Approuve', classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  executed: { label: 'Execute', classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  blocked: { label: 'Bloque', classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  queued: { label: 'En file', classes: 'bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-300' },
  running: { label: 'En cours', classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  stopping: { label: 'Arret demande', classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  passed: { label: 'Reussi', classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  failed: { label: 'Echoue', classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  cancelled: { label: 'Annule', classes: 'bg-muted text-muted-foreground' },
  pass: { label: 'Reussi', classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  fail: { label: 'Echoue', classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  error: { label: 'Erreur', classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
  inconclusive: { label: 'Non concluant', classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
};

export function StatusBadge({ status, size = 'md', label }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.error;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        size === 'sm' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1',
        config.classes,
      )}
    >
      {label ?? config.label}
    </span>
  );
}
