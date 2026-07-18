import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  FileText, Download, Archive, Loader2, Filter, RefreshCw, BarChart3,
  ChevronLeft, ChevronRight, LayoutDashboard,
} from 'lucide-react';
import { ActivityDashboard } from '@/components/activity/ActivityDashboard';
import { TicketHistorySheet } from '@/components/activity/TicketHistorySheet';
import { PdfExportModal } from '@/components/activity/pdf/PdfExportModal';
import { PDF_THEMES } from '@/components/pdf/pdfStyles';
import type { ActivityPdfOptions } from '@/components/activity/pdf/pdfTypes';
import { fetchActivityPdfBrandDefaults } from '@/lib/appSettings';
import { hasProjectPerimeterBlocks, normalizeProjectPerimeterBlocks, type ProjectPerimeterBlock } from '@/lib/projectPerimeters';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { formatDateTime } from '@/lib/dateFormat';

import { useRedmineIssues } from '@/hooks/useRedmineIssues';

// ─── Meeting / treatment classification ──────────────────────────────────
const deAccent = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const isMeetingTracker = (name: string): boolean =>
  /reunion|point d[\s']echange|point d echange/.test(deAccent(name));
import { useRedmineIdentifier } from '@/hooks/useRedmineIdentifier';
import {
  fetchAllIssuesPaginated,
  fetchIssueFilters,
  type FilterOption,
  type RedmineIssue,
} from '@/services/redmineService';
import {
  saveActivitySnapshot,
  fetchActivityReports,
  archiveActivityReport,
  type SavedActivityReport,
} from '@/services/reportService';

interface ProjectInfo {
  id: string;
  site_name: string;
  url: string;
  redmine_url?: string | null;
  logo_url?: string | null;
}

const DEFAULT_ACTIVITY_PDF_SECTIONS: Record<string, boolean> = {
  sommaire: true,
  perimetre: true,
  merci: false,
};

const DEFAULT_ACTIVITY_COVER_KPIS: Record<string, boolean> = {
  total: true,
  meetings: true,
  open: true,
  resolved: true,
  cancelled: true,
  critical: true,
  blocked: true,
  closure: true,
};

const ActivityReport = () => {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { toast } = useToast();

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfSections, setPdfSections] = useState<Record<string, boolean>>(DEFAULT_ACTIVITY_PDF_SECTIONS);
  const [coverKpis, setCoverKpis] = useState<Record<string, boolean>>(DEFAULT_ACTIVITY_COVER_KPIS);
  const [showPdfAdvanced, setShowPdfAdvanced] = useState(false);
  const [selectedThemeId, setSelectedThemeId] = useState(PDF_THEMES[0]?.id || 'slate');
  const [pdfColor, setPdfColor] = useState(PDF_THEMES[0]?.primary || '#1E3A5F');
  const [pdfBrandLeft, setPdfBrandLeft] = useState('MEDIANET RUN SERVICES');
  const [pdfBrandRight, setPdfBrandRight] = useState('SNAPFLOW');
  const [pdfContactEmail, setPdfContactEmail] = useState('');
  const [pdfContactWeb, setPdfContactWeb] = useState('');
  const [pdfContactWeb2, setPdfContactWeb2] = useState('');
  const [statuses, setStatuses] = useState<FilterOption[]>([]);
  const [trackers, setTrackers] = useState<FilterOption[]>([]);
  const [savedReports, setSavedReports] = useState<SavedActivityReport[]>([]);
  const [perimeterBlocks, setPerimeterBlocks] = useState<ProjectPerimeterBlock[]>([]);
  const [activeView, setActiveView] = useState<'tickets' | 'saved' | 'compare' | 'dashboard'>('tickets');
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [historyIssueId, setHistoryIssueId] = useState<number | null>(null);

  // Dashboard full-fetch state
  const [dashboardIssues, setDashboardIssues] = useState<RedmineIssue[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardFilterKey, setDashboardFilterKey] = useState('');

  // All issues for statistics (not paginated)
  const [allIssuesForStats, setAllIssuesForStats] = useState<RedmineIssue[]>([]);
  const [statsFilterKey, setStatsFilterKey] = useState('');

  useEffect(() => {
    if (!loading && !user) navigate('/auth');
  }, [user, loading, navigate]);

  // Derive Redmine identifier from project URLs
  const redmineIdentifier = useRedmineIdentifier(project?.redmine_url || project?.url);

  // Use the issues hook (pagination + caching)
  const {
    issues, totalCount, currentPage, totalPages, loading: loadingIssues,
    lastFetchedKey, issueCache,
    filters, setFilters,
    applyFilters, resetFilters, goToPage, refresh,
  } = useRedmineIssues(redmineIdentifier);

  // Split current page into treatment tickets and meetings
  const treatmentIssues = useMemo(() => issues.filter(i => !isMeetingTracker(i.tracker.name)), [issues]);
  const meetingIssues = useMemo(() => issues.filter(i => isMeetingTracker(i.tracker.name)), [issues]);

  // Fetch project info + filter options on mount
  useEffect(() => {
    if (!user || !projectId) return;
    const init = async () => {
      const [projRes, filterOptions, reports, defaults, perimeterRes] = await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        fetchIssueFilters(),
        fetchActivityReports(projectId),
        fetchActivityPdfBrandDefaults(),
        supabase.from('project_perimeter_blocks').select('*').eq('project_id', projectId).order('display_order'),
      ]);
      setProject(projRes.data || null);
      setStatuses(filterOptions.statuses);
      setTrackers(filterOptions.trackers);
      setSavedReports(reports);
      setPdfBrandLeft(defaults.left);
      setPdfBrandRight(defaults.right);
      setPerimeterBlocks(normalizeProjectPerimeterBlocks(perimeterRes.data as Array<Record<string, unknown>> | null));
    };
    init();
  }, [user, projectId]);

  const refreshSavedReports = useCallback(async () => {
    if (!projectId) return;
    const reports = await fetchActivityReports(projectId);
    setSavedReports(reports);
  }, [projectId]);

  const fetchAllForDashboard = useCallback(async () => {
    if (!redmineIdentifier || !project) return;
    setDashboardLoading(true);
    const newKey = `${filters.status}|${filters.tracker}|${filters.dateFrom}|${filters.dateTo}`;
    try {
      const result = await fetchAllIssuesPaginated({
        projectIdentifier: redmineIdentifier,
        statusId: filters.status || undefined,
        trackerId: filters.tracker || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        limit: 500,
        offset: 0,
      });
      setDashboardIssues(result.issues);
      setDashboardFilterKey(newKey);
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    } finally {
      setDashboardLoading(false);
    }
  }, [redmineIdentifier, project, filters, toast]);

  const handleFilter = () => {
    applyFilters();
    setDashboardFilterKey('__stale__');
    // Fetch all issues for stats calculation
    fetchAllIssuesForStats();
  };

  const fetchAllIssuesForStats = useCallback(async () => {
    if (!redmineIdentifier || !project) return;
    const newKey = `${filters.status}|${filters.tracker}|${filters.dateFrom}|${filters.dateTo}`;
    try {
      const result = await fetchAllIssuesPaginated({
        projectIdentifier: redmineIdentifier,
        statusId: filters.status || undefined,
        trackerId: filters.tracker || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        limit: 500,
        offset: 0,
      });
      setAllIssuesForStats(result.issues);
      setStatsFilterKey(newKey);
    } catch (err: any) {
      // Silently fail - stats will just use current page
      console.error('Failed to fetch all issues for stats:', err);
    }
  }, [redmineIdentifier, project, filters]);

  // Initial fetch for stats
  useEffect(() => {
    if (redmineIdentifier && project && !statsFilterKey && allIssuesForStats.length === 0) {
      fetchAllIssuesForStats();
    }
  }, [redmineIdentifier, project, fetchAllIssuesForStats, statsFilterKey, allIssuesForStats.length]);

  const handleResetFilters = () => {
    resetFilters();
    setDashboardFilterKey('__stale__');
    setAllIssuesForStats([]);
    setStatsFilterKey('');
  };

  const handleSaveReport = async () => {
    if (!projectId || issues.length === 0) return;
    try {
      await saveActivitySnapshot({
        projectId,
        issues,
        totalCount,
        projectName: project?.site_name,
        filters: {
          filterStatus: filters.status,
          filterTracker: filters.tracker,
          filterDateFrom: filters.dateFrom,
          filterDateTo: filters.dateTo,
        },
      });
      toast({ title: 'Rapport sauvegardé' });
      await refreshSavedReports();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    }
  };

  const handleArchiveReport = async (reportId: string) => {
    try {
      await archiveActivityReport(reportId);
      toast({ title: 'Rapport archivé' });
      await refreshSavedReports();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    }
  };

  const openActivityPdfPicker = () => {
    if ((allIssuesForStats.length || issues.length) === 0) {
      toast({ title: 'Aucun ticket', description: 'Aucun ticket ne correspond aux filtres actifs.', variant: 'destructive' });
      return;
    }
    setPdfModalOpen(true);
  };

  const doExportActivityPDF = async () => {
    if (!project || !redmineIdentifier) return;
    setIsExporting(true);
    try {
      const selectedTheme = PDF_THEMES.find(theme => theme.id === selectedThemeId) || PDF_THEMES[0];
      const currentKey = `${filters.status}|${filters.tracker}|${filters.dateFrom}|${filters.dateTo}`;
      let exportIssues = allIssuesForStats.length > 0 && statsFilterKey === currentKey ? allIssuesForStats : [];
      let exportTotalCount = exportIssues.length || totalCount;
      if (exportIssues.length === 0) {
        const result = await fetchAllIssuesPaginated({
          projectIdentifier: redmineIdentifier,
          statusId: filters.status || undefined,
          trackerId: filters.tracker || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
          limit: 500,
          offset: 0,
        });
        exportIssues = result.issues;
        exportTotalCount = result.totalCount || result.issues.length;
        setAllIssuesForStats(result.issues);
        setStatsFilterKey(currentKey);
      }
      if (exportIssues.length === 0) {
        toast({ title: 'Aucun ticket', description: 'Aucun ticket ne correspond aux filtres actifs.', variant: 'destructive' });
        return;
      }
      const { generateActivityPdf } = await import('@/lib/generateActivityPdf');
      const options: ActivityPdfOptions = {
        theme: selectedTheme,
        themeId: selectedTheme.id,
        pdfColor,
        sections: pdfSections,
        coverKpis,
        brandLeft: pdfBrandLeft,
        brandRight: pdfBrandRight,
        contactEmail: pdfContactEmail,
        contactWeb: pdfContactWeb,
        contactWeb2: pdfContactWeb2,
      };
      await generateActivityPdf({
        project,
        issues: exportIssues,
        totalCount: exportTotalCount,
        filters: {
          status: filters.status,
          tracker: filters.tracker,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          statusLabel: filters.status ? statuses.find(s => String(s.id) === filters.status)?.name || filters.status : undefined,
          trackerLabel: filters.tracker ? trackers.find(t => String(t.id) === filters.tracker)?.name || filters.tracker : undefined,
        },
        options,
        perimeterBlocks,
      });
      setPdfModalOpen(false);
      toast({ title: 'PDF telecharge', description: `${exportIssues.length} tickets exportes.` });
    } catch (err) {
      toast({ title: 'Erreur', description: "Impossible d'exporter le PDF.", variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  if (loading || !user) return null;

  // Use allIssuesForStats for statistics if available, otherwise fall back to current page.
  // Only treatment tickets (hors réunions) are counted in treatment stats.
  const statsSource = allIssuesForStats.length > 0 ? allIssuesForStats : issues;
  const treatmentStatsSource = useMemo(() => statsSource.filter(i => !isMeetingTracker(i.tracker.name)), [statsSource]);

  const statusCounts = treatmentStatsSource.reduce<Record<string, number>>((acc, i) => {
    acc[i.status.name] = (acc[i.status.name] || 0) + 1;
    return acc;
  }, {});

  const trackerCounts = treatmentStatsSource.reduce<Record<string, number>>((acc, i) => {
    acc[i.tracker.name] = (acc[i.tracker.name] || 0) + 1;
    return acc;
  }, {});

  const redmineBase = project?.redmine_url ?? project?.url ?? undefined;
  const PAGE_SIZE = 25;

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <TicketHistorySheet
        issueId={historyIssueId}
        redmineBaseUrl={redmineBase}
        onClose={() => setHistoryIssueId(null)}
      />
      <PdfExportModal
        open={pdfModalOpen}
        onOpenChange={setPdfModalOpen}
        pdfSections={pdfSections}
        setPdfSections={setPdfSections}
        showAdvanced={showPdfAdvanced}
        setShowAdvanced={setShowPdfAdvanced}
        selectedThemeId={selectedThemeId}
        setSelectedThemeId={setSelectedThemeId}
        pdfColor={pdfColor}
        setPdfColor={setPdfColor}
        coverKpis={coverKpis}
        setCoverKpis={setCoverKpis}
        pdfBrandLeft={pdfBrandLeft}
        setPdfBrandLeft={setPdfBrandLeft}
        pdfBrandRight={pdfBrandRight}
        setPdfBrandRight={setPdfBrandRight}
        pdfContactEmail={pdfContactEmail}
        setPdfContactEmail={setPdfContactEmail}
        pdfContactWeb={pdfContactWeb}
        setPdfContactWeb={setPdfContactWeb}
        pdfContactWeb2={pdfContactWeb2}
        setPdfContactWeb2={setPdfContactWeb2}
        hasPerimeterBlocks={hasProjectPerimeterBlocks(perimeterBlocks)}
        isExporting={isExporting}
        doExportPDF={doExportActivityPDF}
      />
      {/* View toggle */}
      <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto pb-1">
        {(['tickets', 'saved', 'compare', 'dashboard'] as const).map(view => (
          <button
            key={view}
            onClick={() => {
              setActiveView(view);
              if (view === 'dashboard') {
                const currentKey = `${filters.status}|${filters.tracker}|${filters.dateFrom}|${filters.dateTo}`;
                if (currentKey !== dashboardFilterKey && !dashboardLoading) {
                  fetchAllForDashboard();
                }
              }
            }}
            className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${activeView === view ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {view === 'dashboard' && <span className="flex items-center gap-1.5"><LayoutDashboard className="w-3.5 h-3.5" />Tableau de bord</span>}
            {view === 'compare' && <span className="flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" />Comparaison</span>}
            {view === 'saved' && `Sauvegardés (${savedReports.length})`}
            {view === 'tickets' && 'Tickets'}
          </button>
        ))}
      </div>

      {activeView === 'tickets' && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">Filtres</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 items-end">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Statut</label>
                <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })} className="w-full h-10 text-sm bg-secondary border border-border rounded-md px-3 text-foreground">
                  <option value="">Tous</option>
                  {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Tracker</label>
                <select value={filters.tracker} onChange={e => setFilters({ ...filters, tracker: e.target.value })} className="w-full h-10 text-sm bg-secondary border border-border rounded-md px-3 text-foreground">
                  <option value="">Tous</option>
                  {trackers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Date début</label>
                <Input type="date" value={filters.dateFrom} onChange={e => setFilters({ ...filters, dateFrom: e.target.value })} className="h-10" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Date fin</label>
                <Input type="date" value={filters.dateTo} onChange={e => setFilters({ ...filters, dateTo: e.target.value })} className="h-10" />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleFilter} disabled={loadingIssues} className="flex-1">
                  {loadingIssues ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                  Filtrer
                </Button>
                <Button variant="outline" onClick={handleResetFilters} size="icon" className="h-10 w-10">×</Button>
              </div>
            </div>
          </div>

          {/* Stats (treatment tickets only) */}
          {treatmentStatsSource.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="glass-card p-4 text-center">
                <div className="text-2xl font-bold text-primary">{treatmentStatsSource.length}</div>
                <div className="text-xs text-muted-foreground">Tickets traitement{meetingIssues.length > 0 ? ` (hors ${meetingIssues.length} réunion${meetingIssues.length > 1 ? 's' : ''})` : ''}</div>
              </div>
              {Object.entries(statusCounts).slice(0, 3).map(([name, count]) => (
                <div key={name} className="glass-card p-4 text-center">
                  <div className="text-2xl font-bold">{count}</div>
                  <div className="text-xs text-muted-foreground">{name}</div>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <h3 className="font-semibold text-sm">
              {totalCount > 0
                ? `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, totalCount)} sur ${totalCount} demande(s) Redmine`
                : 'Aucune demande Redmine'}
              {meetingIssues.length > 0 && <span className="text-xs text-muted-foreground ml-2">(dont {meetingIssues.length} réunion{meetingIssues.length > 1 ? 's' : ''})</span>}
              {lastFetchedKey && issueCache.get(lastFetchedKey) && (
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  (mis à jour il y a {Math.floor((Date.now() - issueCache.get(lastFetchedKey)!.ts) / 60000)} min)
                </span>
              )}
            </h3>
            <div className="flex gap-2 flex-wrap">
              <Button variant="ghost" size="sm" onClick={refresh} disabled={loadingIssues} title="Forcer le rechargement">
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingIssues ? 'animate-spin' : ''}`} /> Actualiser
              </Button>
              <Button variant="outline" size="sm" onClick={handleSaveReport} disabled={issues.length === 0}>
                <Archive className="w-3.5 h-3.5 mr-1.5" /> Sauvegarder
              </Button>
              <Button variant="outline" size="sm" onClick={openActivityPdfPicker} disabled={isExporting || issues.length === 0}>
                {isExporting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
                Rapport activite
              </Button>
            </div>
          </div>

          {/* Tracker breakdown */}
          {issues.length > 0 && Object.keys(trackerCounts).length > 0 && (
            <div className="glass-card p-4">
              <h4 className="font-semibold text-sm mb-3">Répartition par tracker</h4>
              <div className="flex gap-4 flex-wrap">
                {Object.entries(trackerCounts).map(([name, count]) => (
                  <div key={name} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-primary/60" />
                    <span className="text-sm">{name}: <strong>{count}</strong></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tickets table */}
          {loadingIssues ? (
            <div className="glass-card p-8 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
              <p className="text-muted-foreground mt-2">Chargement des tickets…</p>
            </div>
          ) : treatmentIssues.length === 0 && meetingIssues.length === 0 ? (
            <div className="glass-card p-8 text-center text-muted-foreground">
              Aucun ticket trouvé pour ce projet.
            </div>
          ) : (
            <>
              {/* Treatment tickets table */}
              {treatmentIssues.length > 0 && (
                <div className="glass-card overflow-hidden mb-4">
                  <div className="px-4 py-2 border-b border-border/30 bg-muted/30">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tickets de traitement — {treatmentIssues.length} élément{treatmentIssues.length > 1 ? 's' : ''}</span>
                    {meetingIssues.length > 0 && <span className="text-xs text-muted-foreground ml-2">(réunions exclues)</span>}
                  </div>
                  <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 text-muted-foreground">
                      <th className="text-left p-3">#</th>
                      <th className="text-left p-3">Sujet</th>
                      <th className="text-center p-3">Tracker</th>
                      <th className="text-center p-3">Statut</th>
                      <th className="text-center p-3">Priorité</th>
                      <th className="text-left p-3">Assigné à</th>
                      <th className="text-center p-3">Avancement</th>
                      <th className="text-center p-3">Créé le</th>
                    </tr>
                  </thead>
                  <tbody>
                    {treatmentIssues.map(issue => (
                      <tr key={issue.id} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="p-3">
                          <button
                            type="button"
                            onClick={() => setHistoryIssueId(issue.id)}
                            className="font-mono text-xs text-primary hover:underline hover:text-primary/80 transition-colors"
                            title="Voir l'historique complet"
                          >
                            #{issue.id}
                          </button>
                        </td>
                        <td className="p-3 font-medium max-w-xs truncate">{issue.subject}</td>
                        <td className="p-3 text-center">
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{issue.tracker.name}</span>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            issue.status.name === 'Fermé' || issue.status.name === 'Closed'
                              ? 'bg-emerald-500/10 text-emerald-600'
                              : issue.status.name === 'Nouveau' || issue.status.name === 'New'
                              ? 'bg-blue-500/10 text-blue-600'
                              : 'bg-yellow-500/10 text-yellow-600'
                          }`}>
                            {issue.status.name}
                          </span>
                        </td>
                        <td className="p-3 text-center text-xs">{issue.priority.name}</td>
                        <td className="p-3 text-sm">{issue.assigned_to?.name || '—'}</td>
                        <td className="p-3 text-center">
                          <div className="flex items-center gap-2 justify-center">
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${issue.done_ratio}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground">{issue.done_ratio}%</span>
                          </div>
                        </td>
                        <td className="p-3 text-center text-xs text-muted-foreground">
                          {format(new Date(issue.created_on), 'dd/MM/yyyy')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                  </div>
                </div>
              )}

              {/* Meetings table */}
              {meetingIssues.length > 0 && (
                <div className="glass-card overflow-hidden">
                  <div className="px-4 py-2 border-b border-border/30 bg-muted/30">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Réunions & Points d'échange — {meetingIssues.length} élément{meetingIssues.length > 1 ? 's' : ''}</span>
                    <span className="text-xs text-muted-foreground ml-2">(hors métriques de traitement)</span>
                  </div>
                  <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 text-muted-foreground">
                      <th className="text-left p-3">#</th>
                      <th className="text-left p-3">Sujet</th>
                      <th className="text-center p-3">Statut</th>
                      <th className="text-center p-3">Priorité</th>
                      <th className="text-left p-3">Assigné à</th>
                      <th className="text-center p-3">Créé le</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meetingIssues.map(issue => (
                      <tr key={issue.id} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="p-3">
                          <button
                            type="button"
                            onClick={() => setHistoryIssueId(issue.id)}
                            className="font-mono text-xs text-primary hover:underline hover:text-primary/80 transition-colors"
                            title="Voir l'historique complet"
                          >
                            #{issue.id}
                          </button>
                        </td>
                        <td className="p-3 font-medium max-w-xs truncate">{issue.subject}</td>
                        <td className="p-3 text-center">
                          <span className="text-xs bg-muted/50 text-muted-foreground px-2 py-0.5 rounded-full">{issue.status.name}</span>
                        </td>
                        <td className="p-3 text-center text-xs">{issue.priority.name}</td>
                        <td className="p-3 text-sm">{issue.assigned_to?.name || '—'}</td>
                        <td className="p-3 text-center text-xs text-muted-foreground">
                          {format(new Date(issue.created_on), 'dd/MM/yyyy')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 pt-2">
              <Button variant="outline" size="sm" disabled={currentPage === 1 || loadingIssues} onClick={() => goToPage(currentPage - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('ellipsis');
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, idx) =>
                  item === 'ellipsis' ? (
                    <span key={`e-${idx}`} className="px-1 text-muted-foreground text-sm">…</span>
                  ) : (
                    <Button
                      key={item}
                      variant={item === currentPage ? 'default' : 'outline'}
                      size="sm"
                      className="w-8 h-8 p-0"
                      disabled={loadingIssues}
                      onClick={() => goToPage(item as number)}
                    >
                      {item}
                    </Button>
                  )
                )
              }
              <Button variant="outline" size="sm" disabled={currentPage === totalPages || loadingIssues} onClick={() => goToPage(currentPage + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {activeView === 'saved' && (
        <div className="space-y-3">
          {savedReports.length === 0 ? (
            <div className="glass-card p-8 text-center text-muted-foreground">Aucun rapport sauvegardé.</div>
          ) : (
            <>
              {selectedForCompare.length > 0 && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-muted-foreground">{selectedForCompare.length} sélectionné(s)</span>
                  <Button size="sm" variant="outline" onClick={() => setActiveView('compare')} disabled={selectedForCompare.length < 2}>
                    <BarChart3 className="w-3.5 h-3.5 mr-1.5" /> Comparer
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedForCompare([])}>Désélectionner</Button>
                </div>
              )}
              {savedReports.map(report => {
                const isSelected = selectedForCompare.includes(report.id);
                return (
                  <div key={report.id} className={`glass-card p-4 flex items-center gap-4 ${isSelected ? 'ring-1 ring-primary/50' : ''}`}>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => setSelectedForCompare(prev =>
                          prev.includes(report.id) ? prev.filter(id => id !== report.id) : [...prev, report.id]
                        )}
                        className="rounded border-border"
                      />
                    </label>
                    <FileText className="w-5 h-5 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          Rapport du {formatDateTime(report.created_at)}
                        </span>
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                          {report.ticket_count} tickets
                        </span>
                        {report.archived_at && (
                          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                            Archivé le {format(new Date(report.archived_at), 'dd/MM/yyyy HH:mm')}
                          </span>
                        )}
                      </div>
                    </div>
                    {!report.archived_at && (
                      <Button variant="ghost" size="sm" onClick={() => handleArchiveReport(report.id)}>
                        <Archive className="w-3.5 h-3.5 mr-1" /> Archiver
                      </Button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {activeView === 'compare' && (
        <ActivityComparisonView reports={savedReports.filter(r => selectedForCompare.includes(r.id))} />
      )}

      {activeView === 'dashboard' && project && (
        <ActivityDashboard
          issues={dashboardIssues}
          totalCount={totalCount}
          project={project}
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          isLoading={dashboardLoading}
          onSnapshotSaved={refreshSavedReports}
          onExportPdf={openActivityPdfPicker}
          isExportingPdf={isExporting}
        />
      )}
    </div>
  );
};

// ─── Comparison sub-component ────────────────────────────────────────────────
const ActivityComparisonView = ({ reports }: { reports: SavedActivityReport[] }) => {
  if (reports.length < 2) {
    return (
      <div className="glass-card p-8 text-center space-y-3">
        <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto" />
        <p className="text-muted-foreground">
          Sélectionnez au moins <strong>2 rapports</strong> dans l'onglet "Rapports sauvegardés" pour comparer.
        </p>
      </div>
    );
  }

  const sorted = [...reports].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const statusBreakdowns = sorted.map(r => {
    const issues = r.report_data?.issues || [];
    const counts: Record<string, number> = {};
    issues.forEach((i: any) => {
      const name = i.status?.name || 'Inconnu';
      counts[name] = (counts[name] || 0) + 1;
    });
    return { date: format(new Date(r.created_at), 'dd/MM/yyyy', { locale: fr }), ticketCount: r.ticket_count || 0, counts };
  });

  const allStatuses = Array.from(new Set(statusBreakdowns.flatMap(s => Object.keys(s.counts))));

  const trackerBreakdowns = sorted.map(r => {
    const issues = r.report_data?.issues || [];
    const counts: Record<string, number> = {};
    issues.forEach((i: any) => {
      const name = i.tracker?.name || 'Inconnu';
      counts[name] = (counts[name] || 0) + 1;
    });
    return { date: format(new Date(r.created_at), 'dd/MM/yyyy', { locale: fr }), counts };
  });

  const allTrackers = Array.from(new Set(trackerBreakdowns.flatMap(t => Object.keys(t.counts))));

  return (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          Évolution du nombre de tickets
        </h3>
        <div className="flex items-end gap-4 h-40">
          {statusBreakdowns.map((s, i) => {
            const prev = i > 0 ? statusBreakdowns[i - 1].ticketCount : null;
            const diff = prev !== null ? s.ticketCount - prev : null;
            const maxCount = Math.max(...statusBreakdowns.map(x => x.ticketCount), 1);
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <div className="text-xs font-medium">
                  {s.ticketCount}
                  {diff !== null && (
                    <span className={`ml-1 ${diff <= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      ({diff >= 0 ? '+' : ''}{diff})
                    </span>
                  )}
                </div>
                <div className="w-full bg-muted rounded-t-md relative" style={{ height: '100%' }}>
                  <div className="absolute bottom-0 w-full rounded-t-md bg-primary/50 transition-all" style={{ height: `${(s.ticketCount / maxCount) * 100}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">{s.date}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="glass-card p-6">
        <h3 className="font-semibold mb-4">Répartition par statut</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="text-left p-2">Statut</th>
                {statusBreakdowns.map((s, i) => <th key={i} className="text-center p-2">{s.date}</th>)}
              </tr>
            </thead>
            <tbody>
              {allStatuses.map(status => (
                <tr key={status} className="border-b border-border/30">
                  <td className="p-2 font-medium">{status}</td>
                  {statusBreakdowns.map((s, i) => {
                    const count = s.counts[status] || 0;
                    const prev = i > 0 ? (statusBreakdowns[i - 1].counts[status] || 0) : null;
                    const diff = prev !== null ? count - prev : null;
                    return (
                      <td key={i} className="p-2 text-center">
                        {count}
                        {diff !== null && diff !== 0 && (
                          <span className={`text-xs ml-1 ${diff < 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            ({diff > 0 ? '+' : ''}{diff})
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="font-bold">
                <td className="p-2">Total</td>
                {statusBreakdowns.map((s, i) => <td key={i} className="p-2 text-center">{s.ticketCount}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass-card p-6">
        <h3 className="font-semibold mb-4">Répartition par tracker</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="text-left p-2">Tracker</th>
                {trackerBreakdowns.map((t, i) => <th key={i} className="text-center p-2">{t.date}</th>)}
              </tr>
            </thead>
            <tbody>
              {allTrackers.map(tracker => (
                <tr key={tracker} className="border-b border-border/30">
                  <td className="p-2 font-medium">{tracker}</td>
                  {trackerBreakdowns.map((t, i) => {
                    const count = t.counts[tracker] || 0;
                    const prev = i > 0 ? (trackerBreakdowns[i - 1].counts[tracker] || 0) : null;
                    const diff = prev !== null ? count - prev : null;
                    return (
                      <td key={i} className="p-2 text-center">
                        {count}
                        {diff !== null && diff !== 0 && (
                          <span className={`text-xs ml-1 ${diff < 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            ({diff > 0 ? '+' : ''}{diff})
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ActivityReport;
