import { getAxisScoreBreakdown, getAuditGlobalScore, getScoreColor, getCriticalCount, getTotalFindings, type AuditReport } from '@/data/mockAuditData';
import { ScoreGauge } from '@/components/ScoreGauge';
import { CriticalityBadge } from '@/components/CriticalityBadge';
import { AlertTriangle, TrendingUp, CheckCircle, XCircle } from 'lucide-react';
import { AxisIcon } from '@/components/audit/AxisIcon';

interface TabResumeProps {
  audit: AuditReport;
}

export function TabResume({ audit }: TabResumeProps) {
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
        <h3 className="font-semibold mb-3">Synthèse Stratégique</h3>
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
    </div>
  );
}
