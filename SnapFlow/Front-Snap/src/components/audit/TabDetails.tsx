import { useState } from 'react';
import { getAxisScoreBreakdown, getScoreColor, getPagesWithoutMeta, getPagesWithLongMeta, getRecentNews, isClientVisibleFinding, type AuditFinding, type AuditReport, type Criticality, type FindingStatus, type Priority } from '@/data/mockAuditData';
import { CriticalityBadge } from '@/components/CriticalityBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import { ScoreGauge } from '@/components/ScoreGauge';
import { ExternalLink, ChevronDown, ChevronRight, AlertCircle, Image, FileText, Newspaper, CheckCircle, XCircle, AlertTriangle, ShieldAlert, Paperclip, Bug, Lightbulb, Search, Camera, FlaskConical, Pencil, Save } from 'lucide-react';
import { AxisIcon } from '@/components/audit/AxisIcon';
import { EvidenceDetailsDialog } from '@/components/audit/EvidenceDetailsDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface TabDetailsProps {
  audit: AuditReport;
  selectedAxisId?: string;
  isEditMode?: boolean;
  onUpdateFinding?: (axisId: string, findingId: string, updates: Partial<AuditFinding>) => void;
}

type EditableFindingDraft = {
  title: string;
  description: string;
  recommendation: string;
  risk: string;
  criticality: Criticality;
  priority: Priority;
  status: FindingStatus;
};

function resolveFindingStatus(finding: AuditFinding): FindingStatus {
  return finding.status ?? (finding.type === 'pass' ? 'pass' : finding.type === 'bug' ? 'fail' : 'not_measured');
}

export function TabDetails({ audit, selectedAxisId, isEditMode = false, onUpdateFinding }: TabDetailsProps) {
  const visibleAxes = audit.axes
    .map((axis) => ({ ...axis, findings: axis.findings.filter(isClientVisibleFinding) }))
    .filter((axis) => axis.findings.length > 0);

  const [expandedAxis, setExpandedAxis] = useState<string | null>(selectedAxisId || visibleAxes[0]?.id || null);
  const [filterCriticality, setFilterCriticality] = useState<Criticality | 'all'>('all');
  const [filterState, setFilterState] = useState<FindingStatus | 'all'>('all');
  const [editorState, setEditorState] = useState<{ axisId: string; findingId: string } | null>(null);
  const [editorDraft, setEditorDraft] = useState<EditableFindingDraft | null>(null);

  const isRiskPassingFinding = (finding: AuditReport['axes'][number]['findings'][number]) => {
    if (finding.origin !== 'passing_kpi' && finding.status !== 'pass') return false;
    const searchable = `${finding.title ?? ''} ${finding.sourceKpi ?? ''}`.toLowerCase();
    return /\brisk\b|risque|risk_level|niveau_risque/.test(searchable);
  };

  const canEditFindings = Boolean(isEditMode && onUpdateFinding);

  const critFilters: Array<Criticality | 'all'> = ['all', 'critical', 'high', 'medium', 'low'];
  const stateFilters: Array<FindingStatus | 'all'> = ['all', 'pass', 'fail'];

  const pagesWithoutMeta = getPagesWithoutMeta(audit);
  const pagesWithLongMeta = getPagesWithLongMeta(audit);
  const recentNews = getRecentNews(audit);
  const oldNews = (audit.newsItems || []).filter(n => !recentNews.includes(n));

  const [showSeoMeta, setShowSeoMeta] = useState(false);
  const [showSeoImages, setShowSeoImages] = useState(false);
  const [showContentNews, setShowContentNews] = useState(false);

  const openFindingEditor = (axisId: string, finding: AuditFinding) => {
    setEditorState({ axisId, findingId: finding.id });
    setEditorDraft({
      title: finding.title || '',
      description: finding.description || '',
      recommendation: finding.recommendation || '',
      risk: finding.risk || '',
      criticality: finding.criticality,
      priority: finding.priority,
      status: resolveFindingStatus(finding),
    });
  };

  const closeFindingEditor = () => {
    setEditorState(null);
    setEditorDraft(null);
  };

  const handleSaveFindingEdit = () => {
    if (!editorState || !editorDraft || !onUpdateFinding) return;

    const axis = audit.axes.find((item) => item.id === editorState.axisId);
    const currentFinding = axis?.findings.find((item) => item.id === editorState.findingId);
    if (!currentFinding) {
      closeFindingEditor();
      return;
    }

    const nextStatus = editorDraft.status;
    const nextType: AuditFinding['type'] = nextStatus === 'pass'
      ? 'pass'
      : nextStatus === 'fail'
        ? (currentFinding.type === 'bug' || currentFinding.origin === 'bug' ? 'bug' : 'recommendation')
        : 'recommendation';

    let nextOrigin = currentFinding.origin;
    if (nextStatus === 'pass') {
      nextOrigin = 'passing_kpi';
    } else if (nextStatus === 'not_measured' || nextStatus === 'not_available' || nextStatus === 'not_evaluated') {
      nextOrigin = 'coverage';
    } else if (currentFinding.origin === 'passing_kpi' || currentFinding.origin === 'coverage') {
      nextOrigin = nextType === 'bug' ? 'bug' : 'recommendation';
    }

    onUpdateFinding(editorState.axisId, editorState.findingId, {
      title: editorDraft.title.trim() || currentFinding.title,
      description: editorDraft.description.trim() || currentFinding.description,
      recommendation: editorDraft.recommendation.trim() || currentFinding.recommendation,
      risk: nextStatus === 'pass' ? undefined : (editorDraft.risk.trim() || undefined),
      criticality: editorDraft.criticality,
      priority: editorDraft.priority,
      status: nextStatus,
      type: nextType,
      origin: nextOrigin,
    });

    closeFindingEditor();
  };

  const getStatusIcon = (status: 'pass' | 'fail' | 'warning') => {
    if (status === 'pass') return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
    if (status === 'fail') return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    return <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />;
  };

  return (
    <div className="space-y-4 fade-in">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Filtrer :</span>
        {critFilters.map(c => (
          <button
            key={c}
            onClick={() => setFilterCriticality(c)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              filterCriticality === c ? 'bg-primary/20 border-primary/40 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {c === 'all' ? 'Tous' : c === 'critical' ? 'Critique' : c === 'high' ? 'Élevé' : c === 'medium' ? 'Moyen' : 'Faible'}
          </button>
        ))}
        {stateFilters.map(s => (
          <button
            key={s}
            onClick={() => setFilterState(s)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              filterState === s ? 'bg-primary/20 border-primary/40 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {s === 'all' ? 'Tous statuts' : s === 'pass' ? 'Pass' : 'Fail'}
          </button>
        ))}
      </div>

      {canEditFindings && (
        <div className="text-xs text-muted-foreground border border-primary/20 bg-primary/5 rounded-md px-3 py-2">
          Mode edition actif: utilisez le bouton Modifier sur un constat pour changer son contenu.
        </div>
      )}

      {/* Axes */}
      {visibleAxes.map(ax => {
        const breakdown = getAxisScoreBreakdown(ax);
        const isExpanded = expandedAxis === ax.id;
        const findings = ax.findings.filter(f => {
          if (isRiskPassingFinding(f)) return false;
          if (filterCriticality !== 'all' && f.criticality !== filterCriticality) return false;
          if (filterState !== 'all' && (f.status ?? (f.type === 'pass' ? 'pass' : 'fail')) !== filterState) return false;
          return true;
        });
        const isSeoAxis = ax.id === 'seo';
        const isContentAxis = ax.id === 'content';

        return (
          <div key={ax.id} className="glass-card overflow-hidden">
            <button
              onClick={() => setExpandedAxis(isExpanded ? null : ax.id)}
              className="w-full p-4 flex items-center gap-4 hover:bg-muted/20 transition-colors"
            >
              {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              <AxisIcon id={ax.id} className="w-6 h-6 text-muted-foreground" />
              <div className="flex-1 text-left">
                <span className="font-semibold">{ax.name}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{ax.description}</p>
              </div>
              <span className={`font-mono font-bold ${getScoreColor(breakdown.scorePct)}`}>{breakdown.x}/{breakdown.y}</span>
            </button>

            {isExpanded && (
              <div className="border-t border-border/50 p-4 space-y-3">
                <div className="flex items-center gap-4 mb-4">
                  <ScoreGauge score={breakdown.scorePct} size={64} strokeWidth={5} valueText={`${breakdown.x}/${breakdown.y}`} />
                  <div>
                    <p className="text-sm text-muted-foreground">{findings.length} constat{findings.length > 1 ? 's' : ''}</p>
                    <p className="text-xs text-muted-foreground">Pass {breakdown.passed} - Fail {breakdown.failed}</p>
                  </div>
                </div>

                {/* SEO sub-sections */}
                {isSeoAxis && (audit.pagesMeta?.length > 0 || audit.imagesToOptimize?.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    {audit.pagesMeta?.length > 0 && (
                      <button onClick={() => setShowSeoMeta(!showSeoMeta)} className="glass-card-hover p-3 text-left flex items-center gap-3">
                        <FileText className="w-5 h-5 text-warning" />
                        <div>
                          <p className="text-sm font-semibold">Pages sans Meta Description</p>
                          <p className="text-xs text-muted-foreground">{pagesWithoutMeta.length} pages • max 70 caractères recommandé</p>
                        </div>
                      </button>
                    )}
                    {audit.imagesToOptimize?.length > 0 && (
                      <button onClick={() => setShowSeoImages(!showSeoImages)} className="glass-card-hover p-3 text-left flex items-center gap-3">
                        <Image className="w-5 h-5 text-orange-400" />
                        <div>
                          <p className="text-sm font-semibold">Images à Optimiser</p>
                          <p className="text-xs text-muted-foreground">{audit.imagesToOptimize.length} images détectées</p>
                        </div>
                      </button>
                    )}
                  </div>
                )}

                {isSeoAxis && showSeoMeta && pagesWithoutMeta.length > 0 && (
                  <div className="glass-card p-4 space-y-2 bg-muted/10">
                    <h4 className="font-semibold text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4 text-warning" /> Pages sans Meta Description ({pagesWithoutMeta.length})</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-border/50 text-muted-foreground"><th className="text-left p-2">Page</th><th className="text-left p-2">Adresse</th><th className="text-center p-2">Statut</th></tr></thead>
                        <tbody>
                          {pagesWithoutMeta.map(p => (
                            <tr key={p.url} className="border-b border-border/30">
                              <td className="p-2 font-medium">{p.title}</td>
                              <td className="p-2"><a href={p.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs flex items-center gap-1">{p.url} <ExternalLink className="w-3 h-3" /></a></td>
                              <td className="p-2 text-center"><span className="text-xs criticality-critical px-2 py-0.5 rounded-full border">Manquante</span></td>
                            </tr>
                          ))}
                          {pagesWithLongMeta.map(p => (
                            <tr key={p.url} className="border-b border-border/30">
                              <td className="p-2 font-medium">{p.title}</td>
                              <td className="p-2"><a href={p.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs flex items-center gap-1">{p.url} <ExternalLink className="w-3 h-3" /></a></td>
                              <td className="p-2 text-center"><span className="text-xs criticality-medium px-2 py-0.5 rounded-full border">{p.metaDescriptionLength} car.</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {isSeoAxis && showSeoImages && audit.imagesToOptimize?.length > 0 && (
                  <div className="glass-card p-4 space-y-2 bg-muted/10">
                    <h4 className="font-semibold text-sm flex items-center gap-2"><Image className="w-4 h-4 text-orange-400" /> Images à Optimiser ({audit.imagesToOptimize.length})</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-border/50 text-muted-foreground"><th className="text-left p-2">Page</th><th className="text-left p-2">Adresse image</th><th className="text-center p-2">Taille</th><th className="text-center p-2">Format</th><th className="text-center p-2">Recommandé</th><th className="text-center p-2">Gain</th></tr></thead>
                        <tbody>
                          {audit.imagesToOptimize.map((img, i) => (
                            <tr key={i} className="border-b border-border/30">
                              <td className="p-2 font-medium whitespace-nowrap">{img.page}</td>
                              <td className="p-2"><a href={img.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs truncate block max-w-[200px]">{img.url.split('/').pop()}</a></td>
                              <td className="p-2 text-center text-muted-foreground">{img.currentSize}</td>
                              <td className="p-2 text-center">{img.format}</td>
                              <td className="p-2 text-center text-primary">{img.suggestedFormat}</td>
                              <td className="p-2 text-center text-emerald-400">{img.suggestedSize}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Content axis: News */}
                {isContentAxis && audit.newsItems?.length > 0 && (
                  <div className="mb-4">
                    <button onClick={() => setShowContentNews(!showContentNews)} className="glass-card-hover p-3 text-left flex items-center gap-3 w-full md:w-1/2">
                      <Newspaper className="w-5 h-5 text-primary" />
                      <div>
                        <p className="text-sm font-semibold">Actualités récentes</p>
                        <p className="text-xs text-muted-foreground">{recentNews.length} / {audit.newsItems.length} ({"<"} 6 mois)</p>
                      </div>
                    </button>
                  </div>
                )}

                {isContentAxis && showContentNews && (
                  <div className="glass-card p-4 space-y-3 bg-muted/10">
                    <h4 className="font-semibold text-sm flex items-center gap-2"><Newspaper className="w-4 h-4 text-primary" /> Actualités ({"<"} 6 mois)</h4>
                    {recentNews.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Aucune actualité datant de moins de 6 mois.</p>
                    ) : (
                      <div className="space-y-2">
                        {recentNews.map((n, i) => (
                          <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/20">
                            <div>
                              <p className="text-sm font-medium">{n.title}</p>
                              <p className="text-xs text-muted-foreground">{new Date(n.date).toLocaleDateString('fr-FR')}</p>
                            </div>
                            <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-primary"><ExternalLink className="w-3.5 h-3.5" /></a>
                          </div>
                        ))}
                      </div>
                    )}
                    {oldNews.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
                        {oldNews.length} articles archivés ({">"}6 mois)
                      </p>
                    )}
                  </div>
                )}

                {/* Findings */}
                {findings.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Aucun constat pour ce filtre.</p>
                ) : (
                  findings.map(f => (
                    (() => {
                      const hasEvidenceDetails =
                        (f.evidenceRows?.length ?? 0) > 0 ||
                        (f.evidenceSummary?.length ?? 0) > 0 ||
                        (f.evidence?.length ?? 0) > 0 ||
                        (f.annexes?.length ?? 0) > 0 ||
                        (f.exampleUrls?.length ?? 0) > 0;
                      return (
                    <div key={f.id} className="p-4 rounded-lg bg-muted/20 border border-border/30 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="font-semibold text-base leading-snug">{f.title}</h4>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {canEditFindings && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => openFindingEditor(ax.id, f)}
                            >
                              <Pencil className="w-3 h-3 mr-1" />
                              Modifier
                            </Button>
                          )}
                          {(() => {
                            if (f.status === 'pass' || f.origin === 'passing_kpi') {
                              return (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
                                  <CheckCircle className="w-3 h-3" />
                                  <span>Validé</span>
                                </span>
                              );
                            }
                            if (f.origin === 'bug' || f.type === 'bug') {
                              return (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-red-400 bg-red-500/10 border-red-500/20">
                                  <Bug className="w-3 h-3" />
                                  <span>Bug</span>
                                </span>
                              );
                            }
                            return (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-blue-400 bg-blue-500/10 border-blue-500/20">
                                <Lightbulb className="w-3 h-3" />
                                <span>Recommandation</span>
                              </span>
                            );
                          })()}
                          {f.status !== 'pass' && f.origin !== 'passing_kpi' && <CriticalityBadge level={f.criticality} />}
                          {f.status !== 'pass' && <PriorityBadge priority={f.priority} />}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground flex items-start gap-1.5"><Search className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />{f.description}</p>

                      {f.screenshotUrl && (
                        <div className="rounded-lg overflow-hidden border border-border/30">
                          <img src={f.screenshotUrl} alt={`Capture : ${f.title}`} className="w-full h-auto" loading="lazy" />
                          <p className="text-xs text-muted-foreground p-2 bg-muted/30 flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> Capture du problème détecté</p>
                        </div>
                      )}

                      {f.testCases && f.testCases.length > 0 && (
                        <div className="p-3 rounded-md bg-muted/30 border border-border/20">
                          <p className="text-xs font-semibold mb-2 flex items-center gap-1"><FlaskConical className="w-3.5 h-3.5" /> Cas de test ({f.testCases.length})</p>
                          <div className="space-y-1.5">
                            {f.testCases.map((tc, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                {getStatusIcon(tc.status)}
                                <span className="font-medium">{tc.name}</span>
                                <span className="text-muted-foreground">— {tc.description}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {(f.status !== 'pass' && f.risk) && (
                        <div className="p-3 rounded-md bg-destructive/5 border border-destructive/10">
                            <p className="text-sm"><ShieldAlert className="w-3.5 h-3.5 inline mr-1.5 text-destructive" /><span className="font-medium">Risque :</span> {f.risk}</p>
                        </div>
                      )}

                      <div className={`p-3 rounded-md border ${f.status === 'pass' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-primary/5 border-primary/10'}`}>
                        <p className="text-sm flex items-start gap-1.5">
                          {f.status === 'pass'
                            ? <CheckCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-400" />
                            : <Lightbulb className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />}
                          <span>
                             <span className="font-medium">{f.status === 'pass' ? 'Statut :' : 'Recommandation :'}</span> {f.recommendation}
                          </span>
                        </p>
                      </div>

                      {hasEvidenceDetails && (
                        <div className="flex justify-end">
                          <div className="sr-only">
                            <Paperclip className="w-3.5 h-3.5 text-muted-foreground" /> Preuves et contexte
                          </div>
                          <EvidenceDetailsDialog finding={f} triggerLabel="Voir les preuves" />
                          {/*
                            <ul className="space-y-1">
                              {f.annexes.map((a, i) => (
                                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                  <span className="text-muted-foreground/60 mt-0.5">•</span>
                                  <span>{a}</span>
                                </li>
                              ))}
                            </ul>
                          */}
                        </div>
                      )}
                    </div>
                    );
                  })()
                ))
                )}
              </div>
            )}
          </div>
        );
      })}

      {canEditFindings && editorState && editorDraft && (
        <Dialog open={Boolean(editorState)} onOpenChange={(open) => { if (!open) closeFindingEditor(); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Modifier le constat</DialogTitle>
              <DialogDescription>
                Mettez a jour les informations du constat puis enregistrez.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <div className="space-y-2">
                <label className="text-sm font-medium">Titre</label>
                <Input
                  value={editorDraft.title}
                  onChange={(event) => setEditorDraft({ ...editorDraft, title: event.target.value })}
                  placeholder="Titre du constat"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <Textarea
                  value={editorDraft.description}
                  onChange={(event) => setEditorDraft({ ...editorDraft, description: event.target.value })}
                  className="min-h-[100px]"
                  placeholder="Description du constat"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Recommandation</label>
                <Textarea
                  value={editorDraft.recommendation}
                  onChange={(event) => setEditorDraft({ ...editorDraft, recommendation: event.target.value })}
                  className="min-h-[100px]"
                  placeholder="Action recommandee"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Risque / manque a gagner (optionnel)</label>
                <Textarea
                  value={editorDraft.risk}
                  onChange={(event) => setEditorDraft({ ...editorDraft, risk: event.target.value })}
                  className="min-h-[90px]"
                  placeholder="Impact metier attendu"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Statut</label>
                  <select
                    value={editorDraft.status}
                    onChange={(event) => {
                      setEditorDraft({
                        ...editorDraft,
                        status: event.target.value as FindingStatus,
                      });
                    }}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="pass">Pass</option>
                    <option value="fail">Fail</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Criticite</label>
                  <select
                    value={editorDraft.criticality}
                    onChange={(event) => {
                      setEditorDraft({
                        ...editorDraft,
                        criticality: event.target.value as Criticality,
                      });
                    }}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="critical">Critique</option>
                    <option value="high">Eleve</option>
                    <option value="medium">Moyen</option>
                    <option value="low">Faible</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Priorite</label>
                  <select
                    value={editorDraft.priority}
                    onChange={(event) => {
                      setEditorDraft({
                        ...editorDraft,
                        priority: event.target.value as Priority,
                      });
                    }}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="quick-win">Quick win</option>
                    <option value="moyen-terme">Moyen terme</option>
                    <option value="long-terme">Long terme</option>
                  </select>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={closeFindingEditor}>
                Annuler
              </Button>
              <Button onClick={handleSaveFindingEdit}>
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
