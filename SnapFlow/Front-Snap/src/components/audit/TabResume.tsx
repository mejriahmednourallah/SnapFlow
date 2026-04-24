import { useEffect, useState } from 'react';
import { getAxisScoreBreakdown, getAuditGlobalScore, getScoreColor, getCriticalCount, getTotalFindings, type AuditReport } from '@/data/mockAuditData';
import { ScoreGauge } from '@/components/ScoreGauge';
import { CriticalityBadge } from '@/components/CriticalityBadge';
import { AlertTriangle, TrendingUp, CheckCircle, Pencil, Save, XCircle } from 'lucide-react';
import { AxisIcon } from '@/components/audit/AxisIcon';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface TabResumeProps {
  audit: AuditReport;
  isEditMode?: boolean;
  onUpdateSummary?: (payload: {
    strategicSummary: string;
    positivePoints: string[];
    negativePoints: string[];
    opportunities: string[];
    criticalPoints: string[];
  }) => void;
}

function listToMultiline(value: string[]): string {
  return value.join('\n');
}

function multilineToList(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function TabResume({ audit, isEditMode = false, onUpdateSummary }: TabResumeProps) {
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false);
  const [strategicSummaryDraft, setStrategicSummaryDraft] = useState(audit.strategicSummary || '');
  const [positivePointsDraft, setPositivePointsDraft] = useState(listToMultiline(audit.positivePoints));
  const [negativePointsDraft, setNegativePointsDraft] = useState(listToMultiline(audit.negativePoints));
  const [opportunitiesDraft, setOpportunitiesDraft] = useState(listToMultiline(audit.opportunities));
  const [criticalPointsDraft, setCriticalPointsDraft] = useState(listToMultiline(audit.criticalPoints));

  const canEditSummary = Boolean(isEditMode && onUpdateSummary);

  useEffect(() => {
    if (!summaryDialogOpen) return;
    setStrategicSummaryDraft(audit.strategicSummary || '');
    setPositivePointsDraft(listToMultiline(audit.positivePoints));
    setNegativePointsDraft(listToMultiline(audit.negativePoints));
    setOpportunitiesDraft(listToMultiline(audit.opportunities));
    setCriticalPointsDraft(listToMultiline(audit.criticalPoints));
  }, [
    summaryDialogOpen,
    audit.strategicSummary,
    audit.positivePoints,
    audit.negativePoints,
    audit.opportunities,
    audit.criticalPoints,
  ]);

  const handleSaveSummary = () => {
    if (!onUpdateSummary) return;

    onUpdateSummary({
      strategicSummary: strategicSummaryDraft.trim(),
      positivePoints: multilineToList(positivePointsDraft),
      negativePoints: multilineToList(negativePointsDraft),
      opportunities: multilineToList(opportunitiesDraft),
      criticalPoints: multilineToList(criticalPointsDraft),
    });

    setSummaryDialogOpen(false);
  };

  const globalScore = getAuditGlobalScore(audit);
  const summary = audit.summary;
  const passingCount = audit.passingKpis?.length ?? 0;
  const recommendationCount = audit.recommendations?.length ?? 0;
  const complianceCount = audit.compliance?.length ?? 0;
  const topPositivePoints = audit.positivePoints.length > 0
    ? audit.positivePoints
    : (audit.passingKpis?.slice(0, 6).map(item => item.label) ?? []);
  const topNegativePoints = audit.negativePoints.length > 0
    ? audit.negativePoints
    : (audit.bugs?.slice(0, 6).map(item => item.title) ?? []);
  const topOpportunities = audit.opportunities.length > 0
    ? audit.opportunities
    : ((audit.recommendations ?? []).slice(0, 6).map(item => item.title));
  const topCriticalPoints = audit.criticalPoints.length > 0
    ? audit.criticalPoints
    : ([...(audit.bugs ?? []), ...(audit.compliance ?? [])]
      .filter(item => /critical|high/i.test(item.severity))
      .slice(0, 6)
      .map(item => item.title));

  return (
    <div className="space-y-6 fade-in">
      {/* Top KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-card p-6 flex flex-col items-center">
          <ScoreGauge score={globalScore} size={100} strokeWidth={7} />
          <p className="text-sm font-semibold mt-2">Score Global</p>
        </div>
        <div className="glass-card p-6">
          <p className="text-sm text-muted-foreground mb-1">Maturité Digitale</p>
          <p className="text-xl font-bold">{audit.maturityLevel}</p>
          <CriticalityBadge level={audit.riskLevel} />
        </div>
        <div className="glass-card p-6">
          <p className="text-sm text-muted-foreground mb-1">Points analysés</p>
          <p className="text-3xl font-mono font-bold">{summary?.total ?? getTotalFindings(audit)}</p>
        </div>
        <div className="glass-card p-6">
          <p className="text-sm text-muted-foreground mb-1">Points critiques</p>
          <p className="text-3xl font-mono font-bold text-red-400">{summary?.critical ?? getCriticalCount(audit)}</p>
        </div>
      </div>

      {(summary || passingCount > 0 || recommendationCount > 0 || complianceCount > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="glass-card p-5">
            <p className="text-sm text-muted-foreground mb-1">Bugs</p>
            <p className="text-2xl font-mono font-bold text-red-400">{summary?.bugs ?? audit.bugs?.length ?? 0}</p>
          </div>
          <div className="glass-card p-5">
            <p className="text-sm text-muted-foreground mb-1">Recommandations</p>
            <p className="text-2xl font-mono font-bold text-primary">{recommendationCount}</p>
          </div>
          <div className="glass-card p-5">
            <p className="text-sm text-muted-foreground mb-1">KPI validés</p>
            <p className="text-2xl font-mono font-bold text-emerald-400">{passingCount}</p>
          </div>
          <div className="glass-card p-5">
            <p className="text-sm text-muted-foreground mb-1">Conformité</p>
            <p className="text-2xl font-mono font-bold text-yellow-400">{complianceCount}</p>
          </div>
        </div>
      )}

      {/* Strategic summary */}
      <div className="glass-card p-6">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="font-semibold">Synthèse Stratégique</h3>
          {canEditSummary && (
            <Button variant="outline" size="sm" onClick={() => setSummaryDialogOpen(true)}>
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              Modifier
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">{audit.strategicSummary}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" /> Points positifs
            </h4>
            <ul className="space-y-1.5">
              {topPositivePoints.map((p, i) => (
                <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <XCircle className="w-4 h-4 text-red-400" /> Points négatifs
            </h4>
            <ul className="space-y-1.5">
              {topNegativePoints.map((p, i) => (
                <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 flex-shrink-0" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card p-6">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" /> Points Critiques
          </h3>
          <ul className="space-y-2">
            {topCriticalPoints.map((p, i) => (
              <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 flex-shrink-0" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="glass-card p-6">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" /> Opportunités
          </h3>
          <ul className="space-y-2">
            {topOpportunities.map((o, i) => (
              <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />
                {o}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Score per axis */}
      <div className="glass-card p-6">
        <h3 className="font-semibold mb-4">Score par Axe</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {audit.axes.map(ax => (
            <div key={ax.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <AxisIcon id={ax.id} className="w-6 h-6 text-muted-foreground" />
              <div>
                <p className={`font-mono font-bold ${getScoreColor(getAxisScoreBreakdown(ax).scorePct)}`}>{getAxisScoreBreakdown(ax).x}/{getAxisScoreBreakdown(ax).y}</p>
                <p className="text-xs text-muted-foreground">{ax.name}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {canEditSummary && (
        <Dialog open={summaryDialogOpen} onOpenChange={setSummaryDialogOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Modifier la synthèse du rapport</DialogTitle>
              <DialogDescription>
                Saisissez une ligne par point pour chaque liste.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <div className="space-y-2">
                <label className="text-sm font-medium">Synthèse stratégique</label>
                <Textarea
                  value={strategicSummaryDraft}
                  onChange={(event) => setStrategicSummaryDraft(event.target.value)}
                  className="min-h-[110px]"
                  placeholder="Synthèse générale de l'audit"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Points positifs</label>
                  <Textarea
                    value={positivePointsDraft}
                    onChange={(event) => setPositivePointsDraft(event.target.value)}
                    className="min-h-[140px]"
                    placeholder="Une ligne par point positif"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Points négatifs</label>
                  <Textarea
                    value={negativePointsDraft}
                    onChange={(event) => setNegativePointsDraft(event.target.value)}
                    className="min-h-[140px]"
                    placeholder="Une ligne par point négatif"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Opportunités</label>
                  <Textarea
                    value={opportunitiesDraft}
                    onChange={(event) => setOpportunitiesDraft(event.target.value)}
                    className="min-h-[140px]"
                    placeholder="Une ligne par opportunité"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Points critiques</label>
                  <Textarea
                    value={criticalPointsDraft}
                    onChange={(event) => setCriticalPointsDraft(event.target.value)}
                    className="min-h-[140px]"
                    placeholder="Une ligne par point critique"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSummaryDialogOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleSaveSummary}>
                <Save className="w-3.5 h-3.5 mr-1.5" />
                Enregistrer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
