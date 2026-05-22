import { getAxisScoreBreakdown, getRiskLevelFromScore, getScoreColor, getCriticalityLabel, getPriorityLabel, isNonTestedFinding, type Criticality, type FindingStatus, type FindingType, type FindingOrigin, type AuditReport } from '@/data/mockAuditData';
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Bug, CheckCircle, FlaskConical, Lightbulb, ShieldAlert } from 'lucide-react';
import { AxisIcon } from '@/components/audit/AxisIcon';

interface TabTableauProps {
  audit: AuditReport;
}

export function TabTableau({ audit }: TabTableauProps) {
  const [filterCrit, setFilterCrit] = useState<Criticality | 'all'>('all');
  const [filterType, setFilterType] = useState<FindingType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<FindingStatus | 'all'>('all');

  const allFindings = audit.axes.flatMap(ax =>
    ax.findings.map(f => {
      const breakdown = getAxisScoreBreakdown(ax);
      const derivedStatus: FindingStatus = f.status ?? (f.type === 'pass' ? 'pass' : f.type === 'bug' ? 'fail' : 'not_measured');
      return {
        ...f,
        axisName: ax.name,
        axisId: ax.id,
        axisScorePct: breakdown.scorePct,
        axisX: breakdown.x,
        axisY: breakdown.y,
        status: derivedStatus,
      };
    }),
  );

  const filtered = allFindings.filter(f => {
    if (filterCrit !== 'all' && f.criticality !== filterCrit) return false;
    if (filterType !== 'all' && f.type !== filterType) return false;
    if (filterStatus !== 'all') {
      if (filterStatus === 'not_measured' && !isNonTestedFinding(f)) return false;
      if (filterStatus !== 'not_measured' && f.status !== filterStatus) return false;
    }
    return true;
  });

  const critOrder: Record<Criticality, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...filtered].sort((a, b) => critOrder[a.criticality] - critOrder[b.criticality]);

  return (
    <div className="space-y-4 fade-in">
      <Tabs defaultValue="synthese">
        <TabsList className="bg-muted/30 border border-border/50 mb-4">
          <TabsTrigger value="synthese">Synthèse par axe</TabsTrigger>
          <TabsTrigger value="filtres">Filtres par priorité</TabsTrigger>
        </TabsList>

        <TabsContent value="synthese">
          <div className="glass-card overflow-hidden">
            <div className="p-4 border-b border-border/50">
              <h3 className="font-semibold">Synthèse par Axe</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-muted-foreground">
                    <th className="text-left p-3">Axe</th>
                    <th className="text-center p-3">Score</th>
                    <th className="text-center p-3">Risque</th>
                    <th className="text-center p-3">Bugs</th>
                    <th className="text-center p-3">Critiques</th>
                    <th className="text-center p-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.axes.map(ax => {
                    const breakdown = getAxisScoreBreakdown(ax);
                    const cc = ax.findings.filter(f => f.criticality === 'critical').length;
                    const bugs = ax.findings.filter(f => f.status === 'fail' && f.type === 'bug').length;
                    const allNonTeste = ax.findings.length > 0 && ax.findings.every(isNonTestedFinding);
                    const riskLevel = getRiskLevelFromScore(breakdown.scorePct);
                    return (
                      <tr key={ax.id} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="p-3 font-medium"><span className="inline-flex items-center gap-2"><AxisIcon id={ax.id} className="w-4 h-4" />{ax.name}</span></td>
                        <td className={`p-3 text-center font-mono font-bold ${getScoreColor(breakdown.scorePct)}`}>
                          {allNonTeste ? 'N/T' : `${breakdown.x}/${breakdown.y}`}
                        </td>
                        <td className="p-3 text-center">
                          {allNonTeste ? (
                            <span className="px-2 py-0.5 rounded-full text-xs border text-yellow-400 bg-yellow-500/10 border-yellow-500/20">Non testé</span>
                          ) : (
                            <span className={`criticality-${riskLevel} px-2 py-0.5 rounded-full text-xs border`}>{getCriticalityLabel(riskLevel)}</span>
                          )}
                        </td>
                        <td className="p-3 text-center font-mono">{bugs}</td>
                        <td className="p-3 text-center font-mono">{cc}</td>
                        <td className="p-3 text-center font-mono">{ax.findings.length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="filtres">
          <div className="glass-card overflow-hidden">
            <div className="p-4 border-b border-border/50 flex items-center gap-4 flex-wrap">
              <h3 className="font-semibold">Tous les Constats</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <select value={filterCrit} onChange={e => setFilterCrit(e.target.value as any)} className="text-xs bg-secondary border border-border rounded-md px-2 py-1 text-foreground">
                  <option value="all">Toute criticité</option>
                  <option value="critical">Critique</option>
                  <option value="high">Élevé</option>
                  <option value="medium">Moyen</option>
                  <option value="low">Faible</option>
                </select>
                <select value={filterType} onChange={e => setFilterType(e.target.value as any)} className="text-xs bg-secondary border border-border rounded-md px-2 py-1 text-foreground">
                  <option value="all">Tout type</option>
                  <option value="bug">Bug</option>
                  <option value="recommendation">Recommandation</option>
                  <option value="pass">Pass</option>
                </select>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="text-xs bg-secondary border border-border rounded-md px-2 py-1 text-foreground">
                  <option value="all">Tout statut</option>
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                  <option value="not_measured">Non testé</option>
                </select>
              </div>
              <span className="text-xs text-muted-foreground">{sorted.length} résultat{sorted.length > 1 ? 's' : ''}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-muted-foreground">
                    <th className="text-left p-3">Axe</th>
                    <th className="text-left p-3">Constat</th>
                    <th className="text-center p-3">Type</th>
                    <th className="text-center p-3">Criticité</th>
                    <th className="text-center p-3">Priorité</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(f => (
                    <tr key={f.id} className="border-b border-border/30 hover:bg-muted/20">
                      <td className="p-3 text-muted-foreground whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><AxisIcon id={f.axisId} className="w-4 h-4" />{f.axisName}</span></td>
                      <td className="p-3 font-medium">{f.title}</td>
                      <td className="p-3 text-center">
                        {(() => {
                          const origin: FindingOrigin | undefined = f.origin;
                          if (isNonTestedFinding(f))
                            return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-yellow-400 bg-yellow-500/10 border-yellow-500/20"><FlaskConical className="w-3 h-3" />Non testé</span>;
                          if (origin === 'passing_kpi' || f.status === 'pass')
                            return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-emerald-400 bg-emerald-500/10 border-emerald-500/20"><CheckCircle className="w-3 h-3" />Validé</span>;
                          if (origin === 'compliance' || origin === 'RGPD')
                            return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-orange-400 bg-orange-500/10 border-orange-500/20"><ShieldAlert className="w-3 h-3" />Protection des données</span>;
                          if (origin === 'bug' || f.type === 'bug')
                            return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-red-400 bg-red-500/10 border-red-500/20"><Bug className="w-3 h-3" />Bug</span>;
                          return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-blue-400 bg-blue-500/10 border-blue-500/20"><Lightbulb className="w-3 h-3" />Recommandation</span>;
                        })()}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`criticality-${f.criticality} px-2 py-0.5 rounded-full text-xs border`}>{getCriticalityLabel(f.criticality)}</span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-xs">{f.status === 'pass' ? '—' : getPriorityLabel(f.priority)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
