import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProjectAssignments } from '@/hooks/useProjectAssignments';
import { useRedmineIdentifier } from '@/hooks/useRedmineIdentifier';
import { fetchProjectDetail } from '@/services/redmineService';
import { isRedmineProjectUrl, resolveProjectWebsiteUrl, resolveRedmineProjectLink } from '@/lib/projectUrls';
import { ClientLogoSidebar } from '@/components/projects/ClientLogoSidebar';
import { Globe, User, ExternalLink, FileText, ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import type { ProjectContext } from './ProjectShell';

// ══════════════════════════════════════════════════════════════════════════════

interface RedmineProjectDetail {
  description?: string;
  created_on?: string;
  updated_on?: string;
  homepage?: string;
  custom_fields?: Array<{ id: number; name: string; value: string }>;
  memberships?: Array<{ id: number; user?: { id: number; name: string }; roles: Array<{ id: number; name: string }> }>;
}

// ══════════════════════════════════════════════════════════════════════════════

const ProjectFiche = () => {
  const { projectId, project } = useOutletContext<ProjectContext>();
  const { toast } = useToast();

  const [showProjectCard, setShowProjectCard] = useState(true);
  const [redmineDetail, setRedmineDetail] = useState<RedmineProjectDetail | null>(null);
  const [loadingCard, setLoadingCard] = useState(true);
  const [logoUrlInput, setLogoUrlInput] = useState('');
  const [isSavingLogo, setIsSavingLogo] = useState(false);

  const { assignedUser } = useProjectAssignments(projectId);
  const redmineIdentifier = useRedmineIdentifier(project?.redmine_url || project?.url);

  // Init logo input when project loads
  useEffect(() => {
    if (project) setLogoUrlInput(project.logo_url ?? '');
  }, [project?.logo_url]);

  // Fetch Redmine detail
  useEffect(() => {
    if (!redmineIdentifier) { setLoadingCard(false); return; }
    setLoadingCard(true);
    fetchProjectDetail(redmineIdentifier)
      .then(async detail => {
        setRedmineDetail(detail);
        const homepage = detail?.homepage?.trim();
        if (homepage && project?.url && isRedmineProjectUrl(project.url)) {
          await supabase
            .from('projects')
            .update({ url: homepage, redmine_url: project.redmine_url || project.url, audit_url_needs_review: false } as any)
            .eq('id', projectId);
        }
      })
      .finally(() => setLoadingCard(false));
  }, [redmineIdentifier, projectId, project?.url, project?.redmine_url]);

  const resolveLogoTargetUrl = (): string => {
    if (!project) return '';
    return resolveProjectWebsiteUrl(project.url, redmineDetail?.homepage);
  };

  const handleSaveLogoUrl = async () => {
    if (!projectId) return;
    setIsSavingLogo(true);
    try {
      const trimmed = logoUrlInput.trim();
      const { error } = await supabase
        .from('projects')
        .update({ logo_url: trimmed || null })
        .eq('id', projectId);
      if (error) throw error;
      toast({
        title: 'Logo du client mis à jour',
        description: trimmed ? 'Le logo sera utilisé sur la couverture du PDF.' : 'Le PDF reviendra à la couverture SnapFlow seule.',
      });
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message || "Impossible d'enregistrer le logo du client.", variant: 'destructive' });
    } finally {
      setIsSavingLogo(false);
    }
  };

  if (!project) return null;
  const websiteUrl = resolveProjectWebsiteUrl(project.url, redmineDetail?.homepage);
  const redmineProjectLink = resolveRedmineProjectLink(project.url, project.redmine_url);

  return (
    <div className="glass-card overflow-hidden">
      <button
        onClick={() => setShowProjectCard(!showProjectCard)}
        className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors"
      >
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          Fiche du projet
        </h3>
        {showProjectCard ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {showProjectCard && (
        <div className="px-4 pb-4 space-y-4">
          {loadingCard ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement…
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* ── Left column: project info ───────────────────── */}
              <div className="space-y-3">

                {/* Assigned user */}
                <div className="flex items-start gap-2">
                  <User className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Chargé de projet</p>
                    <p className="text-sm font-medium">
                      {(() => {
                        const accountMember = redmineDetail?.memberships?.find(m =>
                          m.roles.some(r => r.name?.toLowerCase()?.includes('account') || r.id === 9 || r.id === 10)
                        );
                        const redmineAccountName = accountMember?.user?.name;
                        const accountField = redmineDetail?.custom_fields?.find(f => {
                          const n = f.name?.toLowerCase() || '';
                          return n.includes('account') || n.includes('compte') || n.includes('chargé');
                        });
                        const appAssignee = assignedUser ? (assignedUser.full_name || assignedUser.email) : null;
                        const displayAssignee = redmineAccountName || accountField?.value || appAssignee;
                        return displayAssignee || <span className="text-muted-foreground italic">Non assigné</span>;
                      })()}
                    </p>
                    {assignedUser?.full_name && !redmineDetail?.memberships?.some(m =>
                      m.roles.some(r => r.name?.toLowerCase()?.includes('account') || r.id === 9 || r.id === 10)
                    ) && (
                      <p className="text-xs text-muted-foreground">{assignedUser.email}</p>
                    )}
                  </div>
                </div>

                {/* Website URL */}
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

                {/* Project link */}
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

              {/* ── Right column: logo sidebar ──────────────────── */}
              <ClientLogoSidebar
                siteUrl={resolveLogoTargetUrl()}
                projectId={project.id}
                currentUrl={project.logo_url}
                onApply={url => { setLogoUrlInput(url ?? ''); }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectFiche;
