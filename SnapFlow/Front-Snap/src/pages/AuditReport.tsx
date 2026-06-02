import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { recomputeAuditReport, type AuditFinding, type AuditReport as AuditReportType } from '@/data/mockAuditData';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TabResume } from '@/components/audit/TabResume';
import { TabSommaire } from '@/components/audit/TabSommaire';
import { TabDetails } from '@/components/audit/TabDetails';
import { TabTableau } from '@/components/audit/TabTableau';
import { TabSimulateur } from '@/components/audit/TabSimulateur';
import { TabTickets } from '@/components/audit/TabTickets';
import { ArrowLeft, Download, ExternalLink, Loader2, LogOut, PencilLine, RefreshCw, Save, X } from 'lucide-react';
import snapflowLogo from '@/assets/snapflow-logo.png';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { PdfThemePickerModal } from '@/components/pdf/PdfThemePickerModal';
import { normalizeAuditReportData } from '@/lib/normalizeAuditReport';
import { updateAuditReportData } from '@/services/auditService';

type ProjectInfo = {
  site_name: string;
  url: string;
  redmine_url: string | null;
  logo_url: string | null;
};

let supportsProjectLogoUrlColumn: boolean | null = null;

async function fetchProjectInfoById(projectId: string): Promise<ProjectInfo | null> {
  if (supportsProjectLogoUrlColumn === false) {
    const withoutLogoQuery = await supabase
      .from('projects')
      .select('site_name, url, redmine_url')
      .eq('id', projectId)
      .maybeSingle();

    if (withoutLogoQuery.error || !withoutLogoQuery.data) {
      if (withoutLogoQuery.error) {
        console.error('Project fallback fetch error:', withoutLogoQuery.error);
      }
      return null;
    }

    return {
      ...withoutLogoQuery.data,
      logo_url: null,
    };
  }

  const withLogoQuery = await supabase
    .from('projects')
    .select('site_name, url, redmine_url, logo_url')
    .eq('id', projectId)
    .maybeSingle();

  if (!withLogoQuery.error) {
    supportsProjectLogoUrlColumn = true;
    return withLogoQuery.data;
  }

  // Backward compatibility for environments where logo_url is not migrated yet.
  if (!withLogoQuery.error.message.toLowerCase().includes('logo_url')) {
    console.error('Project fetch error:', withLogoQuery.error);
    return null;
  }
  supportsProjectLogoUrlColumn = false;

  const withoutLogoQuery = await supabase
    .from('projects')
    .select('site_name, url, redmine_url')
    .eq('id', projectId)
    .maybeSingle();

  if (withoutLogoQuery.error || !withoutLogoQuery.data) {
    if (withoutLogoQuery.error) {
      console.error('Project fallback fetch error:', withoutLogoQuery.error);
    }
    return null;
  }

  return {
    ...withoutLogoQuery.data,
    logo_url: null,
  };
}

function cloneAuditReport(report: AuditReportType): AuditReportType {
  return JSON.parse(JSON.stringify(report)) as AuditReportType;
}

const AuditReport = () => {
  const navigate = useNavigate();
  const { id: paramId } = useParams<{ id: string }>();
  const isViewMode = window.location.pathname.includes('/view');
  const [activeTab, setActiveTab] = useState('resume');
  const [selectedAxisId, setSelectedAxisId] = useState<string | undefined>();
  const [isExporting, setIsExporting] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const { user, userRole, displayName, signOut } = useAuth();
  const { toast } = useToast();

  const [audit, setAudit] = useState<AuditReportType | null>(null);
  const [savedAuditSnapshot, setSavedAuditSnapshot] = useState<AuditReportType | null>(null);
  const [auditRowId, setAuditRowId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingChanges, setIsSavingChanges] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [resolvedProjectId, setResolvedProjectId] = useState<string | null>(null);

  // Fetch project info and existing audit
  useEffect(() => {
    if (!paramId || !user) return;

    const fetchData = async () => {
      if (isViewMode) {
        // paramId is an audit ID — fetch the audit directly
        const { data: auditRow } = await supabase
          .from('audits')
          .select('*')
          .eq('id', paramId)
          .maybeSingle();

        if (!auditRow) {
          setError("Rapport d'audit introuvable ou accès refusé.");
          return;
        }

        setResolvedProjectId(auditRow.project_id);
        // Fetch project info
        const project = await fetchProjectInfoById(auditRow.project_id);
        if (project) setProjectInfo(project);
        if (auditRow.report_data) {
          const normalized = normalizeAuditReportData(
            auditRow.report_data,
            auditRow.id,
            {
              url: project?.url ?? '',
              site_name: project?.site_name ?? 'Site',
            },
          );
          if (normalized) {
            const cloned = cloneAuditReport(normalized);
            setAudit(cloned);
            setSavedAuditSnapshot(cloneAuditReport(cloned));
            setAuditRowId(auditRow.id);
            setIsDirty(false);
            setIsEditMode(false);
          }
        }
      } else {
        // paramId is a project ID
        setResolvedProjectId(paramId);
        const project = await fetchProjectInfoById(paramId);

        if (project) setProjectInfo(project);

        const { data: existingAudit } = await supabase
          .from('audits')
          .select('*')
          .eq('project_id', paramId)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingAudit?.report_data) {
          const normalized = normalizeAuditReportData(
            existingAudit.report_data,
            existingAudit.id,
            {
              url: project?.url ?? '',
              site_name: project?.site_name ?? 'Site',
            },
          );
          if (normalized) {
            const cloned = cloneAuditReport(normalized);
            setAudit(cloned);
            setSavedAuditSnapshot(cloneAuditReport(cloned));
            setAuditRowId(existingAudit.id);
            setIsDirty(false);
            setIsEditMode(false);
          }
        } else {
          generateAudit(paramId);
        }
      }
    };

    fetchData();
  }, [paramId, user]);

  const generateAudit = async (pId?: string) => {
    const targetProjectId = pId || resolvedProjectId;
    if (!targetProjectId) return;
    setIsGenerating(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('generate-audit', {
        body: { projectId: targetProjectId },
      });

      if (fnError) {
        throw new Error(fnError.message);
      }

      if (data?.success && data?.audit) {
        const generatedAudit = data.audit as AuditReportType;
        const cloned = cloneAuditReport(generatedAudit);
        setAudit(cloned);
        setSavedAuditSnapshot(cloneAuditReport(cloned));
        setAuditRowId(generatedAudit.id || null);
        setIsDirty(false);
        setIsEditMode(false);
        toast({ title: 'Audit généré', description: `Le rapport pour ${projectInfo?.site_name || 'ce site'} a été créé avec succès.` });
      } else {
        throw new Error(data?.error || 'Erreur inconnue');
      }
    } catch (err) {
      console.error('Generate audit error:', err);
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      setError(msg);
      toast({ title: 'Erreur', description: msg, variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  };

  // Define derived values early to ensure they're available in all functions
  const backPath = isViewMode && resolvedProjectId
    ? `/app/projects/${resolvedProjectId}`
    : '/app/projects';
  const siteName = audit?.siteName || projectInfo?.site_name || 'Chargement...';
  const siteUrl = audit?.url || projectInfo?.url || '';

  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const applyAuditUpdate = (updater: (current: AuditReportType) => AuditReportType) => {
    setAudit((current) => {
      if (!current) return current;
      const updated = recomputeAuditReport(updater(current));
      setIsDirty(true);
      return updated;
    });
  };

  const handleUpdateFinding = (axisId: string, findingId: string, updates: Partial<AuditFinding>) => {
    applyAuditUpdate((current) => ({
      ...current,
      axes: current.axes.map((axis) => {
        if (axis.id !== axisId) return axis;
        return {
          ...axis,
          findings: axis.findings.map((finding) => {
            if (finding.id !== findingId) return finding;
            return {
              ...finding,
              ...updates,
            };
          }),
        };
      }),
    }));
  };

  const handleUpdateSummary = (payload: {
    strategicSummary: string;
    positivePoints: string[];
    negativePoints: string[];
    opportunities: string[];
    criticalPoints: string[];
  }) => {
    applyAuditUpdate((current) => ({
      ...current,
      strategicSummary: payload.strategicSummary,
      positivePoints: payload.positivePoints,
      negativePoints: payload.negativePoints,
      opportunities: payload.opportunities,
      criticalPoints: payload.criticalPoints,
    }));
  };

  const resolveAuditRowIdForSave = async (): Promise<string | null> => {
    if (auditRowId) return auditRowId;
    if (audit?.id) return audit.id;
    if (!resolvedProjectId) return null;

    const { data, error: lookupError } = await supabase
      .from('audits')
      .select('id')
      .eq('project_id', resolvedProjectId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      console.error('Unable to resolve audit row for save:', lookupError);
      return null;
    }

    return data?.id ?? null;
  };

  const handleSaveChanges = async () => {
    if (!audit) return;
    if (!isDirty) {
      setIsEditMode(false);
      return;
    }

    setIsSavingChanges(true);
    try {
      const targetAuditRowId = await resolveAuditRowIdForSave();
      if (!targetAuditRowId) {
        throw new Error('Impossible de determiner la ligne audit a mettre a jour.');
      }

      await updateAuditReportData(targetAuditRowId, audit);
      setAuditRowId(targetAuditRowId);
      setSavedAuditSnapshot(cloneAuditReport(audit));
      setIsDirty(false);
      setIsEditMode(false);
      toast({ title: 'Rapport enregistre', description: 'Les modifications manuelles ont ete sauvegardees.' });
    } catch (saveError) {
      console.error('Save report edit error:', saveError);
      const message = saveError instanceof Error ? saveError.message : 'Erreur inconnue lors de la sauvegarde';
      toast({ title: 'Erreur', description: message, variant: 'destructive' });
    } finally {
      setIsSavingChanges(false);
    }
  };

  const handleDiscardChanges = () => {
    if (!savedAuditSnapshot) return;
    setAudit(cloneAuditReport(savedAuditSnapshot));
    setIsDirty(false);
    setIsEditMode(false);
  };

  const confirmUnsavedChanges = (): boolean => {
    if (!isDirty) return true;
    return window.confirm('Des modifications non enregistrees seront perdues. Continuer ?');
  };

  const handleBackNavigation = () => {
    if (!confirmUnsavedChanges()) return;
    navigate(backPath);
  };

  const handleRegenerateAudit = () => {
    if (!confirmUnsavedChanges()) return;
    setIsEditMode(false);
    setIsDirty(false);
    generateAudit();
  };

  const handleSelectAxis = (axisId: string) => {
    setSelectedAxisId(axisId);
    setActiveTab('sommaire');
  };

  const handleExportPDF = async (theme?: import('@/components/pdf/pdfStyles').PdfTheme) => {
    if (!audit) return;
    setIsExporting(true);
    try {
      const { generateAuditPdf } = await import('@/lib/generateAuditPdf.tsx');
      const clientLogoUrl = projectInfo?.logo_url ?? undefined;
      await generateAuditPdf(audit, theme, { clientLogoUrl });
      toast({ title: 'PDF téléchargé', description: 'Le rapport complet a été exporté.' });
    } catch (error) {
      console.error('PDF export error:', error);
      toast({ title: 'Erreur', description: "Impossible d'exporter le PDF.", variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };
  // Use the dedicated Redmine URL for ticket integration; fall back to siteUrl for legacy projects
  const redmineProjectUrl = projectInfo?.redmine_url || siteUrl;

  // Loading / generating state
  if (isGenerating || (!audit && !error)) {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="border-b border-border/50 px-6 py-3 sticky top-0 bg-background/80 backdrop-blur-md z-50">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={handleBackNavigation} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-4 h-4" />
                <img src={snapflowLogo} alt="Snapflow" className="h-6" />
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto" />
            <h2 className="text-xl font-bold">Génération de l'audit en cours…</h2>
            <p className="text-muted-foreground max-w-md">
              L'IA analyse le site <strong>{projectInfo?.site_name || ''}</strong> et génère un rapport complet. 
              Cela peut prendre 30 à 60 secondes.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Error state
  if (error && !audit) {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="border-b border-border/50 px-6 py-3 sticky top-0 bg-background/80 backdrop-blur-md z-50">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <button onClick={handleBackNavigation} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
              <img src={snapflowLogo} alt="Snapflow" className="h-6" />
            </button>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <p className="text-red-400 font-semibold">Erreur lors de la génération</p>
            <p className="text-muted-foreground text-sm">{error}</p>
            <Button onClick={() => generateAudit()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Réessayer
            </Button>
          </div>
        </main>
      </div>
    );
  }

  if (!audit) return null;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border/50 px-4 sm:px-6 py-3 sticky top-0 bg-background/80 backdrop-blur-md z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <button onClick={handleBackNavigation} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
              <ArrowLeft className="w-4 h-4" />
              <img src={snapflowLogo} alt="Snapflow" className="h-6 hidden sm:block" />
            </button>
            <div className="h-5 w-px bg-border hidden sm:block" />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold truncate">{siteName}</h1>
              {siteUrl && (
                <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 truncate">
                  <span className="truncate">{siteUrl}</span> <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <span className="text-xs text-muted-foreground mr-1 hidden md:inline">
              {displayName} {userRole && <span className="text-primary">({userRole})</span>}
            </span>
            {isDirty && (
              <span className="text-xs text-amber-300 hidden lg:inline">Modifications non enregistrees</span>
            )}
            {!isEditMode ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditMode(true)}
                disabled={!audit || isSavingChanges}
                title="Modifier manuellement le rapport"
              >
                <PencilLine className="w-3.5 h-3.5 mr-1.5" />
                Modifier
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={handleDiscardChanges} disabled={!isDirty || isSavingChanges}>
                  <X className="w-3.5 h-3.5 mr-1.5" />
                  Annuler
                </Button>
                <Button size="sm" onClick={handleSaveChanges} disabled={!isDirty || isSavingChanges}>
                  {isSavingChanges ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                  Enregistrer
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={handleRegenerateAudit} disabled={isGenerating || isSavingChanges} title="Régénérer l'audit" className="hidden sm:flex">
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isGenerating ? 'animate-spin' : ''}`} />
              Régénérer
            </Button>
            <Button variant="outline" size="icon" onClick={handleRegenerateAudit} disabled={isGenerating || isSavingChanges} title="Régénérer" className="sm:hidden h-8 w-8">
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPdfModalOpen(true)} disabled={isExporting || !audit}>
              {isExporting ? <Loader2 className="w-3.5 h-3.5 sm:mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 sm:mr-1.5" />}
              <span className="hidden sm:inline">PDF</span>
            </Button>
            {user && (
              <Button variant="ghost" size="icon" onClick={() => { signOut(); navigate('/auth'); }} className="h-8 w-8" title="Déconnexion">
                <LogOut className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-muted/30 border border-border/50 mb-6 w-full sm:w-auto h-auto flex-wrap overflow-visible">
            <TabsTrigger value="resume"><span className="hidden sm:inline">1. </span>Résumé</TabsTrigger>
            <TabsTrigger value="sommaire"><span className="hidden sm:inline">2. </span>Sommaire</TabsTrigger>
            <TabsTrigger value="details"><span className="hidden sm:inline">3. </span>Détails</TabsTrigger>
            <TabsTrigger value="tableau"><span className="hidden sm:inline">4. </span>Tableau</TabsTrigger>
            <TabsTrigger value="simulateur"><span className="hidden sm:inline">5. </span>Simulateur</TabsTrigger>
            <TabsTrigger value="tickets"><span className="hidden sm:inline">6. </span>Tickets</TabsTrigger>
          </TabsList>

          <TabsContent value="resume">
            <TabResume
              audit={audit}
              isEditMode={isEditMode}
              onSelectAxis={handleSelectAxis}
              onUpdateSummary={handleUpdateSummary}
            />
          </TabsContent>
          <TabsContent value="sommaire"><TabSommaire audit={audit} selectedAxisId={selectedAxisId} onSelectAxis={handleSelectAxis} /></TabsContent>
          <TabsContent value="details">
            <TabDetails
              audit={audit}
              selectedAxisId={selectedAxisId}
              isEditMode={isEditMode}
              onUpdateFinding={handleUpdateFinding}
            />
          </TabsContent>
          <TabsContent value="tableau"><TabTableau audit={audit} /></TabsContent>
          <TabsContent value="simulateur"><TabSimulateur audit={audit} /></TabsContent>
          <TabsContent value="tickets"><TabTickets audit={audit} projectUrl={redmineProjectUrl} projectId={resolvedProjectId || undefined} /></TabsContent>
        </Tabs>
      </main>

      <PdfThemePickerModal
        open={pdfModalOpen}
        onClose={() => setPdfModalOpen(false)}
        onGenerate={handleExportPDF}
      />
    </div>
  );
};

export default AuditReport;
