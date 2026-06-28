import { useEffect, useState } from 'react';
import { Outlet, useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, FileText, ClipboardList, Info } from 'lucide-react';

// ══════════════════════════════════════════════════════════════════════════════
// Shared context for child pages
// ══════════════════════════════════════════════════════════════════════════════

export interface ProjectContext {
  projectId: string;
  project: ProjectInfo | null;
  loadingProject: boolean;
  setProjectLogoUrl: (logoUrl: string | null) => void;
}

interface ProjectInfo {
  id: string;
  site_name: string;
  url: string;
  redmine_url?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  logo_url?: string | null;
}

// ══════════════════════════════════════════════════════════════════════════════
// Pill tabs config
// ══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: 'fiche',     label: 'Fiche de projet',    icon: Info,            path: '' },
  { id: 'audits',    label: 'Rapport d\'audit',    icon: FileText,        path: 'audits' },
  { id: 'activity',  label: 'Rapport d\'activité',  icon: ClipboardList,   path: 'activity' },
] as const;

function resolveTabFromPath(pathname: string): string {
  if (pathname.endsWith('/activity')) return 'activity';
  if (pathname.endsWith('/audits'))  return 'audits';
  return 'fiche';
}

// ══════════════════════════════════════════════════════════════════════════════
// Component
// ══════════════════════════════════════════════════════════════════════════════

const ProjectShell = () => {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [loadingProject, setLoadingProject] = useState(true);

  // Active tab derived from URL
  const activeTab = resolveTabFromPath(location.pathname);

  // Protect route
  useEffect(() => {
    if (!loading && !user) navigate('/auth');
  }, [user, loading, navigate]);

  // Fetch project
  useEffect(() => {
    if (!projectId) return;
    setLoadingProject(true);

    const loadProject = async () => {
      const { data } = await supabase.from('projects').select('*').eq('id', projectId).single();
      if (!data) {
        setProject(null);
        return;
      }

      let clientName: string | null = null;
      const clientId = (data as any).client_id as string | null | undefined;
      if (clientId) {
        const { data: client } = await supabase.from('clients').select('name').eq('id', clientId).maybeSingle();
        clientName = client?.name ?? null;
      }

      setProject({ ...(data as ProjectInfo), client_name: clientName });
    };

    loadProject().finally(() => setLoadingProject(false));
  }, [projectId]);

  // Navigate to correct sub-route on tab change
  const handleTabChange = (tabId: string) => {
    const tab = TABS.find(t => t.id === tabId);
    if (!tab) return;
    navigate(`/app/projects/${projectId}${tab.path ? '/' + tab.path : ''}`, { replace: true });
  };

  const setProjectLogoUrl = (logoUrl: string | null) => {
    setProject(prev => prev ? { ...prev, logo_url: logoUrl } : prev);
  };

  const context: ProjectContext = { projectId: projectId!, project, loadingProject, setProjectLogoUrl };

  return (
    <div className="space-y-6 fade-in">
      {/* ── Back + Project title ────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={() => navigate('/app/projects')}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold">{project?.site_name ?? 'Chargement…'}</h1>
          {project && (
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-primary"
            >
              {project.url}
            </a>
          )}
        </div>
      </div>

      {/* ── Pill navigation header ───────────────────────────────────── */}
      <div className="flex items-center gap-1 p-1 bg-muted/40 border border-border/50 rounded-xl w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${isActive
                  ? 'bg-background text-foreground shadow-sm border border-border/60'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }
              `}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Child page ────────────────────────────────────────────────── */}
      <Outlet context={context} />
    </div>
  );
};

export default ProjectShell;
