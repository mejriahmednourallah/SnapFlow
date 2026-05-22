import { getAxisScoreBreakdown, getScoreColor, isNonTestedFinding, type AuditAxis, type Criticality } from '@/data/mockAuditData';
import { CriticalityBadge } from '@/components/CriticalityBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import { ScoreGauge } from '@/components/ScoreGauge';
import { AxisIcon } from '@/components/audit/AxisIcon';
import { EvidenceDetailsDialog } from '@/components/audit/EvidenceDetailsDialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AlertTriangle, Bug, CheckCircle, ExternalLink, FlaskConical, Lightbulb, ShieldAlert, XCircle } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AxisDetailSheetProps {
  axis: AuditAxis | null;
  open: boolean;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: 'pass' | 'fail' | 'warning' }) {
  if (status === 'pass') return <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />;
  if (status === 'fail') return <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
  return <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />;
}

const criticalityOrder: Record<Criticality, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// ─── Component ───────────────────────────────────────────────────────────────

export function AxisDetailSheet({ axis, open, onClose }: AxisDetailSheetProps) {
  if (!axis) return null;

  const sorted = [...axis.findings].sort(
    (a, b) => criticalityOrder[a.criticality] - criticalityOrder[b.criticality],
  );

  const criticalCount = axis.findings.filter(f => f.criticality === 'critical').length;
  const highCount     = axis.findings.filter(f => f.criticality === 'high').length;
  const mediumCount   = axis.findings.filter(f => f.criticality === 'medium').length;
  const lowCount      = axis.findings.filter(f => f.criticality === 'low').length;
  const breakdown = getAxisScoreBreakdown(axis);
  const nonTestedCount = breakdown.notMeasured + breakdown.notAvailable;

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-2xl overflow-y-auto flex flex-col gap-0 p-0"
      >
        {/* ── Header ── */}
        <SheetHeader className="p-6 border-b border-border/50 flex-shrink-0">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-muted/40 flex-shrink-0">
              <AxisIcon id={axis.id} className="w-6 h-6 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base font-semibold">{axis.name}</SheetTitle>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{axis.description}</p>
            </div>
            <div className="flex-shrink-0">
              <ScoreGauge score={breakdown.scorePct} size={56} strokeWidth={5} />
            </div>
          </div>

          {/* KPI summary chips */}
          <div className="flex flex-wrap gap-2 mt-4">
            <span className={`text-xs font-mono font-bold px-3 py-1 rounded-full border ${getScoreColor(breakdown.scorePct)} bg-muted/30`}>
              {breakdown.x}/{breakdown.y}
            </span>
            <span className="text-xs px-3 py-1 rounded-full border border-border text-muted-foreground">
              {breakdown.passed}/{breakdown.y} réussis - {axis.findings.length} constat{axis.findings.length !== 1 ? 's' : ''}
            </span>
            {nonTestedCount > 0 && (
              <span className="text-xs px-3 py-1 rounded-full border border-yellow-500/20 bg-yellow-500/10 text-yellow-400">
                {nonTestedCount} Non testé{nonTestedCount > 1 ? 's' : ''}
              </span>
            )}
            {criticalCount > 0 && (
              <span className="text-xs criticality-critical px-3 py-1 rounded-full border">
                {criticalCount} critique{criticalCount > 1 ? 's' : ''}
              </span>
            )}
            {highCount > 0 && (
              <span className="text-xs criticality-high px-3 py-1 rounded-full border">
                {highCount} {highCount > 1 ? 'élevés' : 'élevé'}
              </span>
            )}
            {mediumCount > 0 && (
              <span className="text-xs criticality-medium px-3 py-1 rounded-full border">
                {mediumCount} {mediumCount > 1 ? 'moyens' : 'moyen'}
              </span>
            )}
            {lowCount > 0 && (
              <span className="text-xs criticality-low px-3 py-1 rounded-full border">
                {lowCount} {lowCount > 1 ? 'faibles' : 'faible'}
              </span>
            )}
          </div>
        </SheetHeader>

        {/* ── Findings accordion ── */}
        <div className="flex-1 overflow-y-auto p-4">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
              <p className="text-sm">Aucun constat pour cet axe.</p>
            </div>
          ) : (
            <Accordion type="multiple" className="space-y-2">
              {sorted.map(f => {
                const isPassing = f.status === 'pass' || f.origin === 'passing_kpi';
                const isNonTested = isNonTestedFinding(f);
                return (
                <AccordionItem
                  key={f.id}
                  value={f.id}
                  className={`glass-card border rounded-lg overflow-hidden px-0 ${
                    isPassing ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/40'
                  }`}
                >
                  <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/20 [&[data-state=open]]:bg-muted/20 gap-3">
                    <div className="flex items-start gap-3 flex-1 text-left">
                      {(() => {
                        if (isPassing) {
                          return (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border flex-shrink-0 mt-0.5 text-emerald-300 bg-emerald-500/20 border-emerald-500/40 font-semibold">
                              <CheckCircle className="w-3 h-3" />
                              <span>Validé</span>
                            </span>
                          );
                        }
                        if (isNonTested) {
                          return (
                            <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border flex-shrink-0 mt-0.5 text-yellow-400 bg-yellow-500/10 border-yellow-500/20">
                              <FlaskConical className="w-3 h-3" />
                              <span>Non testé</span>
                            </span>
                          );
                        }
                        if (f.origin === 'RGPD') {
                          return (
                            <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border flex-shrink-0 mt-0.5 text-orange-400 bg-orange-500/10 border-orange-500/20">
                              <ShieldAlert className="w-3 h-3" />
                              <span>Protection des données</span>
                            </span>
                          );
                        }
                        if (f.origin === 'bug' || f.type === 'bug') {
                          return (
                            <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border flex-shrink-0 mt-0.5 text-red-400 bg-red-500/10 border-red-500/20">
                              <Bug className="w-3 h-3" />
                              <span>Bug</span>
                            </span>
                          );
                        }
                        return (
                          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border flex-shrink-0 mt-0.5 text-blue-400 bg-blue-500/10 border-blue-500/20">
                            <Lightbulb className="w-3 h-3" />
                            <span>Recommandation</span>
                          </span>
                        );
                      })()}
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-semibold leading-snug">{f.title}</p>
                      </div>
                      <CriticalityBadge level={f.criticality} />
                    </div>
                  </AccordionTrigger>

                  <AccordionContent className="px-4 pb-4 pt-0">
                    <div className="space-y-3 pt-2 border-t border-border/30">

                      <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>

                      <div className="flex items-center gap-2">
                        {f.status !== 'pass' && <PriorityBadge priority={f.priority} />}
                      </div>

                      {(!isPassing && f.risk) && (
                        <div className="p-3 rounded-md bg-destructive/5 border border-destructive/15">
                          <p className="text-sm">
                            <ShieldAlert className="w-3.5 h-3.5 inline mr-1.5 text-destructive" />
                            <span className="font-medium">Risque :</span> {f.risk}
                          </p>
                        </div>
                      )}

                      {!isPassing && f.impact && (
                        <div className="p-3 rounded-md bg-blue-500/5 border border-blue-500/15">
                          <p className="text-sm flex items-start gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-blue-500" />
                            <span>
                              <span className="font-medium">Impact :</span> {f.impact}
                            </span>
                          </p>
                        </div>
                      )}

                      <div className={`p-3 rounded-md border ${isPassing ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-primary/5 border-primary/15'}`}>
                        <p className="text-sm flex items-start gap-1.5">
                          {isPassing
                            ? <CheckCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-400" />
                            : <Lightbulb className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />}
                          <span>
                            <span className="font-medium">{f.status === 'pass' ? 'Statut :' : 'Recommandation :'} </span>
                            {f.recommendation}
                          </span>
                        </p>
                      </div>

                      {(() => {
                        const hasEvidenceDetails =
                          (f.evidenceRows?.length ?? 0) > 0 ||
                          (f.evidenceSummary?.length ?? 0) > 0 ||
                          (f.evidence?.length ?? 0) > 0 ||
                          (f.annexes?.length ?? 0) > 0 ||
                          (f.exampleUrls?.length ?? 0) > 0;
                        if (!hasEvidenceDetails) return null;
                        
                        return (
                          <div className="flex justify-end mt-3">
                            <EvidenceDetailsDialog finding={f} triggerLabel="Voir les preuves" />
                          </div>
                        );
                      })()}

                      {/*
                        const uniqueAnnexes: string[] = [];
                        const hasEvidenceDetails = false;
                        return (
                          <div>
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <p className="text-xs font-semibold flex items-center gap-1">
                                Preuves et contexte ({uniqueAnnexes.length})
                              </p>
                              {hasEvidenceDetails && (
                                <EvidenceDetailsDialog finding={f} triggerLabel="Voir les preuves" />
                              )}
                            </div>
                            {uniqueAnnexes.length > 0 && (
                              <ul className="list-inside space-y-1.5 text-xs text-muted-foreground break-all max-h-48 overflow-y-auto pr-2">
                                {uniqueAnnexes.map((item, idx) => {
                                  const splitIdx = typeof item === 'string' ? item.indexOf(': ') : -1;
                                  if (splitIdx > 0 && splitIdx < 50) {
                                    return (
                                      <li key={idx} className="flex flex-col sm:flex-row sm:gap-2">
                                        <span className="font-semibold text-stone-700 dark:text-stone-300 flex-shrink-0">
                                          • {item.substring(0, splitIdx + 1)}
                                        </span>
                                        <span>{item.substring(splitIdx + 1)}</span>
                                      </li>
                                    );
                                  }
                                  return <li key={idx} className="list-disc ml-1">{item}</li>;
                                })}
                              </ul>
                            )}
                          </div>
                        );
                      */}

                      {f.affectedCount != null && f.affectedCount > 0 && (
                        <div className="flex items-center gap-2 flex-wrap mt-2">
                          <span className="text-xs px-2 py-0.5 rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-400">
                            {f.affectedCount} page{f.affectedCount > 1 ? 's' : ''} ou élément{f.affectedCount > 1 ? 's' : ''} à vérifier
                          </span>
                        </div>
                      )}

                      {f.exampleUrls && f.exampleUrls.length > 0 && (
                        <div className="p-3 rounded-md bg-muted/20 border border-border/20 mt-2">
                          <p className="text-xs font-semibold mb-1.5 flex items-center gap-1.5">
                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" /> Exemples de pages ({f.exampleUrls.length})
                          </p>
                          <ul className="space-y-1">
                            {f.exampleUrls.map((url, i) => (
                              <li key={i}>
                                <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 break-all">
                                  {url} <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {f.testCases && f.testCases.length > 0 && (
                        <div className="p-3 rounded-md bg-muted/30 border border-border/20">
                          <p className="text-xs font-semibold mb-2 flex items-center gap-1">
                            <FlaskConical className="w-3.5 h-3.5" />
                            Cas de test ({f.testCases.length})
                          </p>
                          <div className="space-y-1.5">
                            {f.testCases.map((tc, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs">
                                <StatusIcon status={tc.status} />
                                <span className="font-medium">{tc.name}</span>
                                <span className="text-muted-foreground">— {tc.description}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )})}
            </Accordion>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

