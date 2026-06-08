import { useState, useEffect } from 'react';
import { getAxisScoreBreakdown, getScoreColor, isClientVisibleFinding, type AuditAxis, type AuditReport } from '@/data/mockAuditData';
import { AxisIcon } from '@/components/audit/AxisIcon';
import { AxisDetailSheet } from '@/components/audit/AxisDetailSheet';
import { ScoreGauge } from '@/components/ScoreGauge';
import { Bug, Lightbulb, LayoutGrid, List } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TabSommaireProps {
  audit: AuditReport;
  selectedAxisId?: string | null;
  onSelectAxis?: (axisId: string) => void;
}

type ViewMode = 'list' | 'cards';

// ─── Component ───────────────────────────────────────────────────────────────

export function TabSommaire({ audit, selectedAxisId, onSelectAxis }: TabSommaireProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedAxis, setSelectedAxis] = useState<AuditAxis | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const visibleAxes = audit.axes
    .map((axis) => ({ ...axis, findings: axis.findings.filter(isClientVisibleFinding) }))
    .filter((axis) => axis.findings.length > 0);

  // Auto-open sheet when trigger axis changes (from Resume tab)
  useEffect(() => {
    if (!selectedAxisId) return;
    const axis = visibleAxes.find(ax => ax.id === selectedAxisId);
    if (axis) {
      setSelectedAxis(axis);
      setSheetOpen(true);
      // Clear parent state so re-entering the tab doesn't re-open
      onSelectAxis?.('');
    }
  }, [selectedAxisId, audit.axes]);

  const handleAxisClick = (axis: AuditAxis) => {
    setSelectedAxis(axis);
    setSheetOpen(true);
    onSelectAxis?.(axis.id);
  };

  return (
    <div className="space-y-4 fade-in">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Cliquez sur un axe pour voir ses constats.</p>
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border/50">
          <button
            onClick={() => setViewMode('list')}
            className={cn('p-1.5 rounded-md transition-colors', viewMode === 'list' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            title="Vue liste"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('cards')}
            className={cn('p-1.5 rounded-md transition-colors', viewMode === 'cards' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            title="Vue cartes"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── List view ── */}
      {viewMode === 'list' && (
        <div className="space-y-2">
          {visibleAxes.map((ax, index) => {
            const breakdown = getAxisScoreBreakdown(ax);
            const criticalCount = ax.findings.filter(f => f.criticality === 'critical').length;
            const highCount     = ax.findings.filter(f => f.criticality === 'high').length;
            return (
              <button
                key={ax.id}
                onClick={() => handleAxisClick(ax)}
                className="w-full glass-card-hover p-4 text-left flex items-center gap-4"
              >
                <span className="text-sm font-mono text-muted-foreground w-6 flex-shrink-0">{index + 1}.</span>
                <AxisIcon id={ax.id} className="w-6 h-6 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{ax.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{ax.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {breakdown.x}/{breakdown.y} mesurés réussis - {ax.findings.length} constat{ax.findings.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {criticalCount > 0 && (
                    <span className="text-xs criticality-critical px-2 py-0.5 rounded-full border">{criticalCount} critique{criticalCount > 1 ? 's' : ''}</span>
                  )}
                  {highCount > 0 && (
                    <span className="text-xs criticality-high px-2 py-0.5 rounded-full border">{highCount} {highCount > 1 ? 'élevés' : 'élevé'}</span>
                  )}
                  <span className={`font-mono font-bold text-lg ${getScoreColor(breakdown.scorePct)}`}>
                    {`${breakdown.x}/${breakdown.y}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Cards view ── */}
      {viewMode === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleAxes.map(ax => {
            const breakdown = getAxisScoreBreakdown(ax);
            const bugCount  = ax.findings.filter(f => f.status === 'fail' && f.type === 'bug').length;
            const recoCount = ax.findings.filter(f => f.status === 'fail' && f.type === 'recommendation').length;
            const passed    = breakdown.passed;
            const total     = breakdown.y;
            const gaugeScore = breakdown.scoreMeasured ?? 0;
            return (
              <button
                key={ax.id}
                onClick={() => handleAxisClick(ax)}
                className="glass-card-hover p-5 text-left flex flex-col gap-4 min-h-[178px]"
              >
                {/* Card header */}
                <div className="flex items-start gap-3">
                  <ScoreGauge
                    score={gaugeScore}
                    size={82}
                    strokeWidth={5}
                    valueText={`${gaugeScore}%`}
                    centerScale={1.28}
                  />
                  <div className="flex-1 flex items-start justify-between gap-2">
                    <div className="flex flex-col items-end text-right leading-tight">
                      <p className="font-semibold text-base md:text-lg leading-tight">{ax.name}</p>
                      <p className="text-sm text-muted-foreground font-mono">{passed}/{total} mesurés réussis</p>
                    </div>
                    <div className="p-1.5 rounded-lg bg-muted/40">
                      <AxisIcon id={ax.id} className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted/30 min-w-0">
                    <Bug className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">Bugs</span>
                    <span className="font-semibold ml-auto">{bugCount}</span>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted/30 min-w-0">
                    <Lightbulb className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground truncate">Recommandations</span>
                    <span className="font-semibold ml-auto">{recoCount}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Detail sheet ── */}
      <AxisDetailSheet axis={selectedAxis} open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
