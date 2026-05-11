import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useAsyncAuditPoll } from '@/hooks/useAsyncAuditPoll';
import { generateAudit, archiveAudit, failAuditRow, deleteAudit } from '@/services/auditService';
import { normalizeAuditForRead, getAuditScoreFromAny } from '@/lib/auditReadUtils';
import { useRedmineIdentifier } from '@/hooks/useRedmineIdentifier';
import { fetchProjectDetail } from '@/services/redmineService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FileText, Plus, Eye, Archive, Loader2, Calendar, AlertCircle, X, Trash2, GitCompare, ArrowLeft,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { ProjectContext } from './ProjectShell';

interface AuditRow {
  id: string;
  project_id: string;
  job_id?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  report_data: any;
  error_message: string | null;
}

// ══════════════════════════════════════════════════════════════════════════════

const ProjectAudits = () => {
  const { projectId, project } = useOutletContext<ProjectContext>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dateFilter, setDateFilter] = useState('');
  const [activeTab, setActiveTab] = useState('reports');
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [staleAuditWarning, setStaleAuditWarning] = useState<AuditRow | null>(null);
  const [redmineHomepage, setRedmineHomepage] = useState<string | null>(null);

  const redmineIdentifier = useRedmineIdentifier(project?.redmine_url || project?.url);

  // Fetch Redmine homepage for audit target resolution
  useEffect(() => {
    if (!redmineIdentifier) return;
    fetchProjectDetail(redmineIdentifier).then(detail => {
      setRedmineHomepage(detail?.homepage?.trim() ?? null);
    });
  }, [redmineIdentifier]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const isLikelyRedmineUrl = (v: string) =>
    v.toLowerCase().includes('redmine') || /\/projects\/[^/]+/.test(v) || /^https?:\/\/[^/]*redmine/i.test(v);

  const resolveAuditTargetUrl = (): string => {
    if (!project) return '';
    const primaryUrl = project.url?.trim() ?? '';
    if (isLikelyRedmineUrl(primaryUrl) && redmineHomepage) return redmineHomepage;
    return primaryUrl || redmineHomepage || '';
  };

  const isStaleAudit = (audit: AuditRow, nowMs: number) =>
    (nowMs - new Date(audit.created_at).getTime()) > 30 * 60 * 1000;

  const getStaleAudit = () => {
    const now = new Date().getTime();
    return audits.find(a => !a.archived_at && ['generating', 'pending', 'running'].includes(a.status) && isStaleAudit(a, now)) ?? null;
  };

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchData = async () => {
    if (!projectId) return;
    const { data } = await supabase.from('audits').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
    setAudits((data as AuditRow[]) || []);
    setLoadingData(false);
  };

  useEffect(() => { if (user) fetchData(); }, [user, projectId]);

  // Stale audit check
  useEffect(() => { setStaleAuditWarning(getStaleAudit()); }, [audits]);

  // ── Async polling ────────────────────────────────────────────────────────

  const { pendingJob, generating, setPendingJob, setGenerating } = useAsyncAuditPoll(
    project, user?.id, { onComplete: fetchData },
  );

  const runningAudit = audits.find(a => !a.archived_at && ['generating', 'pending', 'running'].includes(a.status));
  const isAuditRunning = generating || Boolean(runningAudit);

  useEffect(() => {
    if (!runningAudit) { if (!pendingJob) setGenerating(false); return; }
    setGenerating(true);
    const jobId = runningAudit.job_id;
    if (!jobId) return;
    if (!pendingJob || pendingJob.auditId !== runningAudit.id || pendingJob.jobId !== jobId) {
      setPendingJob({ auditId: runningAudit.id, jobId });
    }
  }, [runningAudit, pendingJob, setGenerating, setPendingJob]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const clearStuckAudit = async (auditId: string) => {
    try {
      await failAuditRow(auditId, 'Audit stuck - automatically cleared by system timeout');
      await fetchData();
      setStaleAuditWarning(null);
      toast({ title: 'Audit bloqué nettoyé', description: "Le job d'audit bloqué a été marqué comme terminé." });
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    }
  };

  const handleGenerate = async () => {
    if (!projectId || !project) return;
    if (isAuditRunning) {
      toast({ title: 'Audit déjà en cours', description: 'Veuillez attendre la fin de la génération en cours.' });
      return;
    }
    const auditTargetUrl = resolveAuditTargetUrl();
    if (!auditTargetUrl) {
      toast({ title: 'URL site manquante', description: "Impossible de lancer l'audit sans URL de site valide.", variant: 'destructive' });
      return;
    }
    setGenerating(true);
    toast({ title: 'Démarrage de l\'analyse…', description: 'Le job d\'audit a été soumis. Résultats dans quelques instants.' });
    try {
      const job = await generateAudit(projectId, auditTargetUrl);
      await fetchData();
      setPendingJob(job);
    } catch (err: any) {
      toast({ title: 'Erreur lors du démarrage', description: err.message || 'Erreur inconnue', variant: 'destructive' });
      setGenerating(false);
      await fetchData();
    }
  };

  const handleArchive = async (auditId: string) => {
    try {
      await archiveAudit(auditId);
      toast({ title: 'Rapport archivé' });
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (auditId: string) => {
    if (!confirm('Supprimer définitivement ce rapport ? Cette action est irréversible.')) return;
    try {
      await deleteAudit(auditId);
      toast({ title: 'Rapport supprimé' });
      setSelectedForCompare(prev => prev.filter(id => id !== auditId));
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedForCompare.length === 0) return;
    const count = selectedForCompare.length;
    if (!confirm(`Supprimer définitivement ${count} rapport${count > 1 ? 's' : ''} ? Cette action est irréversible.`)) return;
    try {
      await Promise.all(selectedForCompare.map(id => deleteAudit(id)));
      toast({ title: `${count} rapport${count > 1 ? 's' : ''} supprimé${count > 1 ? 's' : ''}` });
      setSelectedForCompare([]);
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    }
  };

  const handleCompareClick = () => {
    if (selectedForCompare.length < 2) return;
    setActiveTab('compare');
  };

  const toggleCompare = (auditId: string) => {
    setSelectedForCompare(prev => prev.includes(auditId) ? prev.filter(id => id !== auditId) : prev.length < 5 ? [...prev, auditId] : prev);
  };

  // ── Derived ──────────────────────────────────────────────────────────────

  const filteredAudits = audits.filter(a => !dateFilter || a.created_at.startsWith(dateFilter));
  const archivedAudits = filteredAudits.filter(a => a.archived_at);
  const activeAudits = filteredAudits.filter(a => !a.archived_at && a.status === 'completed');
  const comparisonAudits = audits.filter(a => selectedForCompare.includes(a.id) && a.report_data)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (!project) return null;

  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div>
      {/* ── Stale audit warning ─────────────────────────────────── */}
      {staleAuditWarning && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start justify-between gap-3 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-sm text-yellow-900">Audit bloqué détecté</h3>
              <p className="text-xs text-yellow-800 mt-1">
                Un audit lancé le {format(new Date(staleAuditWarning.created_at), 'dd/MM/yyyy à HH:mm', { locale: fr })} semble bloqué et n'a pas progressé.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => clearStuckAudit(staleAuditWarning.id)} className="flex-shrink-0">
            <X className="w-3 h-3 mr-1" /> Nettoyer
          </Button>
        </div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Nouveau rapport — primary action, leftmost */}
        <Button onClick={handleGenerate} disabled={isAuditRunning} className="gap-2 whitespace-nowrap">
          {isAuditRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {isAuditRunning ? 'Génération…' : 'Nouveau rapport'}
        </Button>

        {/* Date filter — compact */}
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <Input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="h-9 w-[160px] text-sm"
          />
          {dateFilter && (
            <Button variant="ghost" size="sm" onClick={() => setDateFilter('')} className="text-xs h-8">
              Réinitialiser
            </Button>
          )}
        </div>

        {/* Spacer — pushes action buttons to the right */}
        <div className="flex-1 hidden sm:block" />

        {/* Comparer — always visible, dimmed until 2+ selected */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleCompareClick}
          disabled={selectedForCompare.length < 2}
          className="gap-1.5"
        >
          <GitCompare className="w-3.5 h-3.5" />
          Comparer{selectedForCompare.length > 1 ? ` (${selectedForCompare.length})` : ''}
        </Button>

        {/* Supprimer — always visible, dimmed until 1+ selected */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleBulkDelete}
          disabled={selectedForCompare.length === 0}
          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30 disabled:border-border disabled:text-muted-foreground"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Supprimer{selectedForCompare.length > 0 ? ` (${selectedForCompare.length})` : ''}
        </Button>
      </div>

      {/* ── Reports / Compare ────────────────────────────────────── */}
      {activeTab === 'compare' ? (
        <div className="space-y-6">
          {/* ── Back to reports ─────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => { setActiveTab('reports'); setSelectedForCompare([]); }} className="gap-1.5">
              <ArrowLeft className="w-4 h-4" /> Retour aux rapports
            </Button>
            <span className="text-xs text-muted-foreground">
              Comparaison de {comparisonAudits.length} rapport{comparisonAudits.length > 1 ? 's' : ''}
            </span>
          </div>
          <ComparisonView audits={comparisonAudits} project={project} />
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Rapports actifs ({activeAudits.length})
            </h3>
            {loadingData ? (
              <div className="glass-card p-8 text-center text-muted-foreground">Chargement…</div>
            ) : activeAudits.length === 0 ? (
              <div className="glass-card p-8 text-center text-muted-foreground">
                Aucun rapport généré. Cliquez sur "Nouveau rapport" pour en créer un.
              </div>
            ) : (
              <div className="space-y-2">
                {activeAudits.map(audit => (
                  <AuditCard
                    key={audit.id}
                    audit={audit}
                    project={project}
                    onView={() => navigate(`/audit/${audit.id}/view`)}
                    onArchive={() => handleArchive(audit.id)}
                    onDelete={() => handleDelete(audit.id)}
                    isSelectedForCompare={selectedForCompare.includes(audit.id)}
                    onToggleCompare={() => toggleCompare(audit.id)}
                  />
                ))}
              </div>
            )}
          </section>

          {archivedAudits.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Rapports archivés ({archivedAudits.length})
              </h3>
              <div className="space-y-2 opacity-70">
                {archivedAudits.map(audit => (
                  <AuditCard
                    key={audit.id}
                    audit={audit}
                    project={project}
                    onView={() => navigate(`/audit/${audit.id}/view`)}
                    onDelete={() => handleDelete(audit.id)}
                    isArchived
                    isSelectedForCompare={selectedForCompare.includes(audit.id)}
                    onToggleCompare={() => toggleCompare(audit.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectAudits;

// ══════════════════════════════════════════════════════════════════════════════
// Sub-components
// ══════════════════════════════════════════════════════════════════════════════

interface AuditCardProps {
  audit: AuditRow;
  project: { url: string; site_name: string } | null;
  onView: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  isArchived?: boolean;
  isSelectedForCompare: boolean;
  onToggleCompare: () => void;
}

const AuditCard = ({ audit, project, onView, onArchive, onDelete, isArchived, isSelectedForCompare, onToggleCompare }: AuditCardProps) => {
  const computedScore = getAuditScoreFromAny(audit.report_data, audit.id, {
    url: project?.url ?? '',
    site_name: project?.site_name ?? 'Site',
  });
  const score = computedScore;
  const normalized = normalizeAuditForRead(audit.report_data, audit.id, {
    url: project?.url ?? '',
    site_name: project?.site_name ?? 'Site',
  });
  const axes = normalized?.axes ?? [];

  return (
    <div className="glass-card p-4 flex items-center gap-4">
      <label className="flex items-center">
        <input type="checkbox" checked={isSelectedForCompare} onChange={onToggleCompare} className="rounded border-border" />
      </label>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="font-medium text-sm">
            Rapport du {format(new Date(audit.created_at), 'dd MMM yyyy à HH:mm', { locale: fr })}
          </span>
          {['pending', 'running', 'generating'].includes(audit.status) && (
            <span className="text-xs bg-warning/20 text-warning px-2 py-0.5 rounded-full">En cours</span>
          )}
          {['failed', 'error'].includes(audit.status) && (
            <span className="text-xs bg-destructive/20 text-destructive px-2 py-0.5 rounded-full">Échoué</span>
          )}
          {isArchived && audit.archived_at && (
            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
              Archivé le {format(new Date(audit.archived_at), 'dd/MM/yyyy HH:mm')}
            </span>
          )}
        </div>
        {score !== null && (
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-muted-foreground">Score global:</span>
            <span className={`text-sm font-bold ${score >= 70 ? 'text-emerald-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
              {score}/100
            </span>
            <span className="text-xs text-muted-foreground ml-2">{axes.length} axes</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {audit.status === 'completed' && (
          <Button variant="outline" size="sm" onClick={onView}>
            <Eye className="w-3.5 h-3.5 mr-1" /> Consulter
          </Button>
        )}
        {!isArchived && onArchive && audit.status === 'completed' && (
          <Button variant="ghost" size="sm" onClick={onArchive} className="text-muted-foreground hover:text-foreground">
            <Archive className="w-3.5 h-3.5 mr-1" /> Archiver
          </Button>
        )}
        {onDelete && (
          <Button variant="ghost" size="icon" onClick={onDelete} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════

const ComparisonView = ({ audits, project }: { audits: AuditRow[]; project: { url: string; site_name: string } | null }) => {
  const globalData = audits.map(a => ({
    date: format(new Date(a.created_at), 'dd/MM/yyyy', { locale: fr }),
    fullDate: a.created_at,
    score: getAuditScoreFromAny(a.report_data, a.id, { url: project?.url ?? '', site_name: project?.site_name ?? 'Site' }) ?? 0,
  }));

  const allAxes: Map<string, { name: string; scores: { date: string; score: number }[] }> = new Map();
  audits.forEach(a => {
    const date = format(new Date(a.created_at), 'dd/MM/yyyy', { locale: fr });
    const normalized = normalizeAuditForRead(a.report_data, a.id, { url: project?.url ?? '', site_name: project?.site_name ?? 'Site' });
    (normalized?.axes ?? []).forEach((axis: any) => {
      const key = axis.id || axis.name;
      if (!allAxes.has(key)) allAxes.set(key, { name: axis.name, scores: [] });
      allAxes.get(key)!.scores.push({ date, score: axis.score ?? 0 });
    });
  });

  const lastScore = globalData[globalData.length - 1]?.score ?? 0;
  const firstScore = globalData[0]?.score ?? 0;
  const totalDiff = lastScore - firstScore;

  const scoreColor = (s: number) => s >= 70 ? 'text-emerald-500' : s >= 50 ? 'text-yellow-500' : 'text-red-500';
  const scoreBg = (s: number) => s >= 70 ? 'bg-emerald-500' : s >= 50 ? 'bg-yellow-500' : 'bg-red-500';
  const scoreBarBg = (s: number) => s >= 70 ? 'bg-emerald-500/30' : s >= 50 ? 'bg-yellow-500/30' : 'bg-red-500/30';

  return (
    <div className="space-y-8">
      {/* ── Global score: Before / After big numbers ────────────── */}
      <div className="glass-card p-6">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-6">
          Score global
        </h3>

        <div className="flex items-center justify-center gap-8 md:gap-16">
          {/* Before */}
          {globalData.map((d, i) => {
            const isLast = i === globalData.length - 1;
            const prev = i > 0 ? globalData[i - 1].score : null;
            const diff = prev !== null ? d.score - prev : null;
            return (
              <div key={i} className="flex flex-col items-center">
                <span className="text-xs text-muted-foreground mb-2">{d.date}</span>
                <span className={`text-5xl md:text-6xl font-bold tracking-tight ${scoreColor(d.score)}`}>
                  {d.score}
                </span>
                <span className="text-xs text-muted-foreground mt-1">/100</span>

                {/* Diff badge between reports */}
                {!isLast && (
                  <div className="flex items-center gap-1 mt-4 text-sm font-medium">
                    <span className="text-muted-foreground mx-1">→</span>
                  </div>
                )}
                {isLast && globalData.length > 1 && (
                  <div className={`mt-4 flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${
                    totalDiff > 0 ? 'bg-emerald-500/10 text-emerald-600' :
                    totalDiff < 0 ? 'bg-red-500/10 text-red-600' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {totalDiff > 0 ? '▲' : totalDiff < 0 ? '▼' : '—'}
                    <span>{totalDiff > 0 ? '+' : ''}{totalDiff} pt{Math.abs(totalDiff) > 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Mini arrow connecting the two */}
        {globalData.length === 2 && (
          <div className="flex justify-center mt-2">
            <div className="flex items-center gap-6 text-xs text-muted-foreground">
              <span>Ancien</span>
              <svg className="w-8 h-4" viewBox="0 0 32 16" fill="none">
                <path d="M0 8h28M22 2l6 6-6 6" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <span>Nouveau</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Per-axis: Before → After table ──────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Détail par axe d'audit
        </h3>

        <div className="glass-card divide-y divide-border/50">
          {Array.from(allAxes.values()).map((axis, idx) => {
            const first = axis.scores[0];
            const last = axis.scores[axis.scores.length - 1];
            const diff = last.score - first.score;
            return (
              <div key={idx} className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30 transition-colors">
                {/* Axis name */}
                <div className="w-32 md:w-40 flex-shrink-0">
                  <span className="text-sm font-medium">{axis.name}</span>
                </div>

                {/* Mini bar */}
                <div className="flex-1 hidden md:block">
                  <div className="h-1.5 bg-muted rounded-full">
                    <div className={`h-full rounded-full ${scoreBarBg(last.score)}`} style={{ width: `${Math.min(last.score, 100)}%` }} />
                  </div>
                </div>

                {/* Before score */}
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Avant</div>
                    <span className={`text-sm font-semibold ${scoreColor(first.score)}`}>{first.score}</span>
                  </div>

                  {/* Arrow */}
                  <div className="text-muted-foreground">
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                      <path d="M2 8h10M8 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>

                  {/* After score */}
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Après</div>
                    <span className={`text-sm font-semibold ${scoreColor(last.score)}`}>{last.score}</span>
                  </div>
                </div>

                {/* Diff badge */}
                {diff !== 0 && (
                  <div className={`flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded ${
                    diff > 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'
                  }`}>
                    {diff > 0 ? '+' : ''}{diff}
                  </div>
                )}
                {diff === 0 && (
                  <div className="flex-shrink-0 text-xs text-muted-foreground px-2">—</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
