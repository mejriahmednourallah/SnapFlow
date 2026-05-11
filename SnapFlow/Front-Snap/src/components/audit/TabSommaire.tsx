import { useState, useEffect } from 'react';
import { getAxisScoreBreakdown, getScoreColor, type AuditAxis, type AuditReport } from '@/data/mockAuditData';
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

  // Auto-open sheet when trigger axis changes (from Resume tab)
  useEffect(() => {
    if (!selectedAxisId) return;
    const axis = audit.axes.find(ax => ax.id === selectedAxisId);
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
          {audit.axes.map((ax, index) => {
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
                  <p className="text-xs text-muted-foreground mt-1">{ax.score}/{ax.maxScore} réussis — {ax.findings.length} constat{ax.findings.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {criticalCount > 0 && (
                    <span className="text-xs criticality-critical px-2 py-0.5 rounded-full border">{criticalCount} critique{criticalCount > 1 ? 's' : ''}</span>
                  )}
                  {highCount > 0 && (
                    <span className="text-xs criticality-high px-2 py-0.5 rounded-full border">{highCount} {highCount > 1 ? 'élevés' : 'élevé'}</span>
                  )}
                  <span className={`font-mono font-bold text-lg ${getScoreColor(breakdown.scorePct)}`}>{breakdown.x}/{breakdown.y}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Cards view ── */}
      {viewMode === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {audit.axes.map(ax => {
            const breakdown = getAxisScoreBreakdown(ax);
            const bugCount  = ax.findings.filter(f => f.type === 'bug').length;
            const recoCount = ax.findings.filter(f => f.type === 'recommendation').length;
            const passed    = breakdown.passed;
            const total     = ax.findings.length;
            const gaugeScore = total > 0 ? Math.round((passed / total) * 100) : 0;
            return (
              <button
                key={ax.id}
                onClick={() => handleAxisClick(ax)}
                className="glass-card-hover p-4 text-left flex flex-col gap-3"
              >
                {/* Card header */}
                <div className="flex items-start gap-3">
                  <ScoreGauge
                    score={gaugeScore}
                    size={66}
                    strokeWidth={4}
                    valueText={`${gaugeScore}%`}
                    centerScale={1.2}
                  />
                  <div className="flex-1 flex items-start justify-between gap-2">
                    <div className="flex flex-col items-end text-right leading-tight">
                      <p className="font-semibold text-sm">{ax.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{passed}/{total}</p>
                    </div>
                    <div className="p-1.5 rounded-lg bg-muted/40">
                      <AxisIcon id={ax.id} className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5 p-2 rounded-md bg-muted/30">
                    <Bug className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">Bugs</span>
                    <span className="font-semibold ml-auto">{bugCount}</span>
                  </div>
                  <div className="flex items-center gap-1.5 p-2 rounded-md bg-muted/30">
                    <Lightbulb className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">Recommandations</span>
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
