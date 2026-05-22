import type { StatusBadgeProps } from '@/lib/form-tester/types';
import { cn } from '@/lib/utils';

const STATUS_CONFIG: Record<StatusBadgeProps['status'], { label: string; classes: string }> = {
  draft: { label: 'Brouillon', classes: 'bg-muted text-muted-foreground' },
  needs_review: { label: 'À valider', classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  pending: { label: 'En attente', classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  approved: { label: 'Approuvé', classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  executed: { label: 'Exécuté', classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  blocked: { label: 'Bloqué', classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  pass: { label: 'Réussi', classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  fail: { label: 'Échoué', classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  error: { label: 'Erreur', classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
};

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.error;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        size === 'sm' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1',
        config.classes,
      )}
    >
      {config.label}
    </span>
  );
}
