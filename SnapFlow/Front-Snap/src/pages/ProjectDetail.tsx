import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, FileText, Plus, Archive, Eye, BarChart3, Loader2, Calendar, ClipboardList,
  Globe, User, ExternalLink, ChevronDown, ChevronUp, AlertCircle, X,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAsyncAuditPoll } from '@/hooks/useAsyncAuditPoll';
import { useProjectAssignments } from '@/hooks/useProjectAssignments';
import { useRedmineIdentifier } from '@/hooks/useRedmineIdentifier';
import { generateAudit, archiveAudit, failAuditRow } from '@/services/auditService';
import { fetchProjectDetail } from '@/services/redmineService';
import { normalizeAuditForRead, getAuditScoreFromAny } from '@/lib/auditReadUtils';
import { isRedmineProjectUrl, resolveAuditTargetUrl as resolveProjectAuditTargetUrl, resolveProjectWebsiteUrl, resolveRedmineProjectLink } from '@/lib/projectUrls';
import { ClientLogoSidebar } from '@/components/projects/ClientLogoSidebar';

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

interface ProjectInfo {
  id: string;
  site_name: string;
  url: string;
  redmine_url?: string | null;
  logo_url?: string | null;
}

interface RedmineProjectDetail {
  description?: string;
  created_on?: string;
  updated_on?: string;
  homepage?: string;
  custom_fields?: Array<{ id: number; name: string; value: string }>;
  memberships?: Array<{ id: number; user?: { id: number; name: string }; roles: Array<{ id: number; name: string }> }>;
}

const ProjectDetail = () => {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loading, isAdmin } = useAuth();
  const { toast } = useToast();

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dateFilter, setDateFilter] = useState('');
  const [activeTab, setActiveTab] = useState('reports');
  const [showProjectCard, setShowProjectCard] = useState(true);
  const [redmineDetail, setRedmineDetail] = useState<RedmineProjectDetail | null>(null);
  const [loadingCard, setLoadingCard] = useState(true);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [staleAuditWarning, setStaleAuditWarning] = useState<AuditRow | null>(null);
  const [logoUrlInput, setLogoUrlInput] = useState('');
  const [isSavingLogo, setIsSavingLogo] = useState(false);

  const resolveAuditTargetUrl = (): string => {
    if (!project) return '';
    return resolveProjectAuditTargetUrl(project.url, redmineDetail?.homepage);
  };

  const isLikelyRedmineUrl = isRedmineProjectUrl;

  const resolveLegacyAuditTargetUrl = (): string => {
    if (!project) return '';
    const primaryUrl = project.url?.trim() ?? '';
    const fallbackHomepage = redmineDetail?.homepage?.trim() ?? '';

    // No primary URL → use homepage
    if (!primaryUrl) return fallbackHomepage;
    
    // Primary URL is Redmine → use homepage if available
    if (isLikelyRedmineUrl(primaryUrl) && fallbackHomepage) {
      console.log(`[audit] Detected Redmine URL "${primaryUrl}", using homepage: "${fallbackHomepage}"`);
      return fallbackHomepage;
    }
    
    // Primary URL is not Redmine → use it
    return primaryUrl;
  };

  const isStaleAudit = (audit: AuditRow, nowMs: number, staleThresholdMs: number = 30 * 60 * 1000): boolean => {
    const createdMs = new Date(audit.created_at).getTime();
    return (nowMs - createdMs) > staleThresholdMs;
  };

  const getStaleAudit = (): AuditRow | null => {
    const now = new Date().getTime();
    const stuck = audits.find(a => 
      !a.archived_at && 
      ['generating', 'pending', 'running'].includes(a.status) &&
      isStaleAudit(a, now)
    );
    return stuck || null;
  };

  const clearStuckAudit = async (auditId: string) => {
    try {
      await failAuditRow(auditId, 'Audit stuck - automatically cleared by system timeout');
      await fetchData();
      setStaleAuditWarning(null);
      toast({ 
        title: 'Audit bloqué nettoyé',
        description: 'Le job d\'audit bloqué a été marqué comme terminé.',
      });
    } catch (err: any) {
      toast({ 
        title: 'Erreur',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  const resolveLogoTargetUrl = (): string => {
    if (!project) return '';
    return resolveProjectWebsiteUrl(project.url, redmineDetail?.homepage);
  };

  const websiteUrl = project ? resolveProjectWebsiteUrl(project.url, redmineDetail?.homepage) : '';
  const redmineProjectLink = project ? resolveRedmineProjectLink(project.url, project.redmine_url) : '';

  // Hooks replacing inline logic
  const { assignedUser } = useProjectAssignments(projectId);
  const redmineIdentifier = useRedmineIdentifier(project?.redmine_url || project?.url);

  useEffect(() => {
    if (!loading && !user) navigate('/auth');
  }, [user, loading, navigate]);

  const fetchData = async () => {
    if (!projectId) return;
    const [projRes, auditsRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('audits').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    ]);
    setProject(projRes.data || null);
    setLogoUrlInput(projRes.data?.logo_url ?? '');
    setAudits((auditsRes.data as AuditRow[]) || []);
    setLoadingData(false);
  };

  useEffect(() => {
    if (user) fetchData();
  }, [user, projectId]);

  // Check for stale audits and warn user
  useEffect(() => {
    const stale = getStaleAudit();
    setStaleAuditWarning(stale);
  }, [audits]);

  // Fetch Redmine project detail once we have the identifier
  useEffect(() => {
    if (!redmineIdentifier) {
      setLoadingCard(false);
      return;
    }
    fetchProjectDetail(redmineIdentifier).then(async detail => {
      setRedmineDetail(detail);
      const homepage = detail?.homepage?.trim();
      if (homepage && projectId && project?.url && isRedmineProjectUrl(project.url)) {
        await supabase
          .from('projects')
          .update({ url: homepage, redmine_url: project.redmine_url || project.url, audit_url_needs_review: false } as any)
          .eq('id', projectId);
      }
      setLoadingCard(false);
    });
  }, [redmineIdentifier, projectId, project?.url, project?.redmine_url]);

  // Async audit polling hook — replaces the inline setInterval block
  const { pendingJob, generating, setPendingJob, setGenerating } = useAsyncAuditPoll(
    project,
    user?.id,
    { onComplete: fetchData },
  );

  const runningAudit = audits.find(a => !a.archived_at && ['generating', 'pending', 'running'].includes(a.status));
  const isAuditRunning = generating || Boolean(runningAudit);

  useEffect(() => {
    if (!runningAudit) {
      if (!pendingJob) setGenerating(false);
      return;
    }

    setGenerating(true);
    const jobId = runningAudit.job_id;
    if (!jobId) return;

    const alreadyTracking = pendingJob
      && pendingJob.auditId === runningAudit.id
      && pendingJob.jobId === jobId;

    if (!alreadyTracking) {
      setPendingJob({ auditId: runningAudit.id, jobId });
    }
  }, [runningAudit, pendingJob, setGenerating, setPendingJob]);

  const handleGenerate = async () => {
    if (!projectId || !project) return;
    if (isAuditRunning) {
      toast({
        title: 'Audit déjà en cours',
        description: 'Veuillez attendre la fin de la génération en cours avant de relancer.',
      });
      return;
    }

    const auditTargetUrl = resolveAuditTargetUrl();
    if (!auditTargetUrl) {
      toast({
        title: 'URL site manquante',
        description: isRedmineProjectUrl(project.url)
          ? "Ce projet pointe encore vers Redmine. Renseignez ou synchronisez le site web du client avant de lancer l'audit."
          : "Impossible de lancer l'audit sans URL de site valide.",
        variant: 'destructive',
      });
      return;
    }

    setGenerating(true);
    toast({ title: `Démarrage de l'analyse…`, description: `Le job d'audit a été soumis. Résultats dans quelques instants.` });
    try {
      const job = await generateAudit(projectId, auditTargetUrl);
      await fetchData(); // show "generating" row immediately
      setPendingJob(job);
    } catch (err: any) {
      console.error('[handleGenerate] Error during audit generation:', err);
      const errorMsg = err.message || 'Erreur inconnue lors du démarrage de l\'audit';
      toast({ title: 'Erreur lors du démarrage', description: errorMsg, variant: 'destructive' });
      setGenerating(false);
      // Refresh data to show any failed audit row that was created
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

  const handleSaveLogoUrl = async () => {
    if (!projectId) return;
    setIsSavingLogo(true);
    try {
      const trimmedLogoUrl = logoUrlInput.trim();
      const { error } = await supabase
        .from('projects')
        .update({ logo_url: trimmedLogoUrl || null })
        .eq('id', projectId);

      if (error) throw error;

      setProject(prev => prev ? { ...prev, logo_url: trimmedLogoUrl || null } : prev);
      toast({
        title: 'Logo du client mis a jour',
        description: trimmedLogoUrl
          ? 'Le logo sera utilise sur la couverture du PDF.'
          : 'Le PDF reviendra a la couverture SnapFlow seule.',
      });
    } catch (err: any) {
      toast({
        title: 'Erreur',
        description: err.message || "Impossible d'enregistrer le logo du client.",
        variant: 'destructive',
      });
    } finally {
      setIsSavingLogo(false);
    }
  };

  const toggleCompare = (auditId: string) => {
    setSelectedForCompare(prev =>
      prev.includes(auditId)
        ? prev.filter(id => id !== auditId)
        : prev.length < 5 ? [...prev, auditId] : prev
    );
  };

  const filteredAudits = audits.filter(a => {
    if (!dateFilter) return true;
    return a.created_at.startsWith(dateFilter);
  });

  const archivedAudits = filteredAudits.filter(a => a.archived_at);
  const activeAudits = filteredAudits.filter(a => !a.archived_at && a.status === 'completed');
  const comparisonAudits = audits
    .filter(a => selectedForCompare.includes(a.id) && a.report_data)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (loading || !user) return null;

  return (
    <div className="space-y-6 fade-in">
      {project && (
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => navigate('/app/projects')} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold">{project.site_name}</h1>
            <a href={project.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary">{project.url}</a>
          </div>
        </div>
      )}

      {/* Stale Audit Warning */}
      {staleAuditWarning && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-sm text-yellow-900">Audit bloqué détecté</h3>
              <p className="text-xs text-yellow-800 mt-1">
                Un audit lancé le {format(new Date(staleAuditWarning.created_at), 'dd/MM/yyyy à HH:mm', { locale: fr })} semble bloqué et n'a pas progressé.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => clearStuckAudit(staleAuditWarning.id)}
            className="flex-shrink-0"
          >
            <X className="w-3 h-3 mr-1" />
            Nettoyer
          </Button>
        </div>
      )}

      {/* Project Card */}
      {project && (
        <div className="glass-card overflow-hidden">
          <button
            onClick={() => setShowProjectCard(!showProjectCard)}
            className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors"
          >
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              Fiche du projet
            </h3>
            {showProjectCard ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {showProjectCard && (
            <div className="px-4 pb-4 space-y-4">
              {loadingCard ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement…
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    {/* Assigned user from Redmine (account custom field) */}
                    <div className="flex items-start gap-2">
                      <User className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Chargé de projet</p>
                        <p className="text-sm font-medium">
                          {(() => {
                            // 1. Try to find user with account role in memberships (id: 9/10 or role name containing "account")
                            const accountMember = redmineDetail?.memberships?.find(m => 
                              m.roles.some(r => r.name?.toLowerCase()?.includes('account') || r.id === 9 || r.id === 10)
                            );
                            const redmineAccountName = accountMember?.user?.name;

                            // 2. Fallback to custom fields (legacy/other instances)
                            const accountField = redmineDetail?.custom_fields?.find(f => {
                              const n = f.name?.toLowerCase() || '';
                              return n.includes('account') || n.includes('compte') || n.includes('chargé');
                            });
                            const redmineCustomAssignee = accountField?.value;
                            
                            // 3. Fallback to App assigned user
                            const appAssignee = assignedUser ? (assignedUser.full_name || assignedUser.email) : null;
                            
                            const displayAssignee = redmineAccountName || redmineCustomAssignee || appAssignee;
                            
                            return displayAssignee ? displayAssignee : <span className="text-muted-foreground italic">Non assigné</span>;
                          })()}
                        </p>
                        {assignedUser?.full_name && !redmineDetail?.memberships?.some(m => m.roles.some(r => r.name?.toLowerCase()?.includes('account') || r.id === 9 || r.id === 10)) && (
                          <p className="text-xs text-muted-foreground">{assignedUser.email}</p>
                        )}
                      </div>
                    </div>

                    {/* Website + Project link */}
                    <div className="flex items-start gap-2">
                      <ExternalLink className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Site web</p>
                        {websiteUrl ? (
                          <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all">
                            {websiteUrl}
                          </a>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">Non renseigné dans Redmine</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <ExternalLink className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Lien projet</p>
                        {redmineProjectLink ? (
                          <a href={redmineProjectLink} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all">
                            {redmineProjectLink}
                          </a>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">Non relié à Redmine</p>
                        )}
                      </div>
                    </div>

                    {/* Description */}
                    {redmineDetail?.description && (
                      <div className="flex items-start gap-2">
                        <FileText className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">Description</p>
                          <p className="text-sm whitespace-pre-line">{redmineDetail.description}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <ClientLogoSidebar
                    siteUrl={resolveLogoTargetUrl()}
                    projectId={project.id}
                    currentUrl={project.logo_url}
                    onApply={url => setProject(prev => prev ? { ...prev, logo_url: url } : prev)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex flex-col gap-4 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <TabsList className="bg-muted/30 border border-border/50 w-full sm:w-auto overflow-hidden">
                <TabsTrigger value="reports"><FileText className="w-3.5 h-3.5 mr-1.5" /><span className="hidden sm:inline">Rapports d'audit</span><span className="sm:hidden">Rapports</span></TabsTrigger>
                <TabsTrigger value="compare"><BarChart3 className="w-3.5 h-3.5 mr-1.5" />Comparaison</TabsTrigger>
              </TabsList>
              <Button variant="outline" size="sm" onClick={() => navigate(`/app/projects/${projectId}/activity`)} className="sm:ml-auto whitespace-nowrap">
                <ClipboardList className="w-3.5 h-3.5 mr-1.5" /> <span className="hidden sm:inline">Rapport d'activité</span><span className="sm:hidden">Activité</span>
              </Button>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <Input
                  type="date"
                  value={dateFilter}
                  onChange={e => setDateFilter(e.target.value)}
                  className="h-9 text-sm flex-1 min-w-0"
                  placeholder="Filtrer par date"
                />
                {dateFilter && (
                  <Button variant="ghost" size="sm" onClick={() => setDateFilter('')} className="text-xs flex-shrink-0">
                    Réinitialiser
                  </Button>
                )}
              </div>
              <Button onClick={handleGenerate} disabled={isAuditRunning} className="whitespace-nowrap flex-shrink-0">
                {isAuditRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                {isAuditRunning ? 'Génération…' : 'Nouveau rapport'}
              </Button>
            </div>
          </div>

          <TabsContent value="reports" className="space-y-6">
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
                      isArchived
                      isSelectedForCompare={selectedForCompare.includes(audit.id)}
                      onToggleCompare={() => toggleCompare(audit.id)}
                    />
                  ))}
                </div>
              </section>
            )}
          </TabsContent>

          <TabsContent value="compare">
            {comparisonAudits.length < 2 ? (
              <div className="glass-card p-8 text-center space-y-3">
                <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto" />
                <p className="text-muted-foreground">
                  Sélectionnez au moins <strong>2 rapports</strong> dans l'onglet Rapports pour comparer leur évolution.
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedForCompare.length} rapport(s) sélectionné(s)
                </p>
              </div>
            ) : (
              <ComparisonView audits={comparisonAudits} project={project} />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

// ─── Sub-components ─────────────────────────────────────────────────────────

interface AuditCardProps {
  audit: AuditRow;
  project: ProjectInfo | null;
  onView: () => void;
  onArchive?: () => void;
  isArchived?: boolean;
  isSelectedForCompare: boolean;
  onToggleCompare: () => void;
}

const AuditCard = ({ audit, project, onView, onArchive, isArchived, isSelectedForCompare, onToggleCompare }: AuditCardProps) => {
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
        <input
          type="checkbox"
          checked={isSelectedForCompare}
          onChange={onToggleCompare}
          className="rounded border-border"
        />
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
      </div>
    </div>
  );
};

const ComparisonView = ({ audits, project }: { audits: AuditRow[]; project: ProjectInfo | null }) => {
  const globalData = audits.map(a => ({
    date: format(new Date(a.created_at), 'dd/MM/yyyy', { locale: fr }),
    score: getAuditScoreFromAny(a.report_data, a.id, {
      url: project?.url ?? '',
      site_name: project?.site_name ?? 'Site',
    }) ?? 0,
  }));

  const allAxes: Map<string, { name: string; scores: { date: string; score: number }[] }> = new Map();
  audits.forEach(a => {
    const date = format(new Date(a.created_at), 'dd/MM/yyyy', { locale: fr });
    const normalized = normalizeAuditForRead(a.report_data, a.id, {
      url: project?.url ?? '',
      site_name: project?.site_name ?? 'Site',
    });
    const axes = normalized?.axes ?? [];
    axes.forEach((axis: any) => {
      const key = axis.id || axis.name;
      if (!allAxes.has(key)) allAxes.set(key, { name: axis.name, scores: [] });
      allAxes.get(key)!.scores.push({ date, score: axis.score ?? 0 });
    });
  });

  return (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          Évolution du score global
        </h3>
        <div className="flex items-end gap-4 h-40">
          {globalData.map((d, i) => {
            const prev = i > 0 ? globalData[i - 1].score : null;
            const diff = prev !== null ? d.score - prev : null;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <div className="text-xs font-medium">
                  {d.score}/100
                  {diff !== null && (
                    <span className={`ml-1 ${diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      ({diff >= 0 ? '+' : ''}{diff})
                    </span>
                  )}
                </div>
                <div className="w-full bg-muted rounded-t-md relative" style={{ height: '100%' }}>
                  <div
                    className={`absolute bottom-0 w-full rounded-t-md transition-all ${
                      d.score >= 70 ? 'bg-emerald-500/60' : d.score >= 50 ? 'bg-yellow-500/60' : 'bg-red-500/60'
                    }`}
                    style={{ height: `${d.score}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{d.date}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from(allAxes.values()).map((axis, idx) => (
          <div key={idx} className="glass-card p-4">
            <h4 className="font-medium text-sm mb-3">{axis.name}</h4>
            <div className="flex items-end gap-3 h-24">
              {axis.scores.map((s, i) => {
                const prev = i > 0 ? axis.scores[i - 1].score : null;
                const diff = prev !== null ? s.score - prev : null;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="text-xs font-medium">
                      {s.score}
                      {diff !== null && (
                        <span className={`ml-0.5 ${diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          ({diff >= 0 ? '+' : ''}{diff})
                        </span>
                      )}
                    </div>
                    <div className="w-full bg-muted rounded-t-md relative" style={{ height: '100%' }}>
                      <div
                        className={`absolute bottom-0 w-full rounded-t-md ${
                          s.score >= 70 ? 'bg-emerald-500/50' : s.score >= 50 ? 'bg-yellow-500/50' : 'bg-red-500/50'
                        }`}
                        style={{ height: `${s.score}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{s.date}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProjectDetail;
