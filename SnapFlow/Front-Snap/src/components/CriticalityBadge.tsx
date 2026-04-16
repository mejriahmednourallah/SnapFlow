import { Criticality, getCriticalityLabel } from '@/data/mockAuditData';

interface CriticalityBadgeProps {
  level: Criticality;
}

export function CriticalityBadge({ level }: CriticalityBadgeProps) {
  const styles: Record<Criticality, string> = {
    critical: 'criticality-critical',
    high: 'criticality-high',
    medium: 'criticality-medium',
    low: 'criticality-low',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[level]}`}>
      {getCriticalityLabel(level)}
    </span>
  );
}
