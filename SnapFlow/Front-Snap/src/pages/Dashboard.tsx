import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { LogOut, FileText, Globe, CalendarClock } from 'lucide-react';
import snapflowLogo from '@/assets/snapflow-logo.png';
import Footer from '@/components/Footer';

interface Project {
  id: string;
  url: string;
  site_name: string;
  created_at: string;
  redmine_url?: string | null;
}

const Dashboard = () => {
  const { user, userRole, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [assignments, setAssignments] = useState<Record<string, { full_name: string | null; email: string }>>({});

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;

    const fetchProjects = async () => {
      try {
        // Fast path: read pre-synced assignments from DB (bulk sync handled by admin/cache refresh).
        console.log("[Dashboard] Fetching assignments from database for user:", user.id);
        
        const { data: assignments, error: assignErr } = await supabase
          .from('project_assignments')
          .select('project_id')
          .eq('user_id', user.id);

        console.log("[Dashboard] Assignments query result:", {
          error: assignErr?.message,
          assignmentsCount: assignments?.length || 0,
          assignmentsList: assignments,
        });

        if (assignErr) {
          console.error('[Dashboard] Failed to fetch assignments:', assignErr);
          setLoadingProjects(false);
          return;
        }

        if (!assignments || assignments.length === 0) {
          // No projects assigned
          console.warn('[Dashboard] No projects assigned to user');
          setProjects([]);
          setLoadingProjects(false);
          return;
        }

        const projectIds = assignments.map(a => a.project_id);
        console.log("[Dashboard] Fetching project details for IDs:", projectIds);

        const { data: projectData, error: projErr } = await supabase
          .from('projects')
          .select('*')
          .in('id', projectIds);

        console.log("[Dashboard] Projects data:", {
          error: projErr?.message,
          projectsCount: projectData?.length || 0,
          projectsList: projectData,
        });

        if (projErr) {
          console.error('[Dashboard] Failed to fetch projects:', projErr);
          setLoadingProjects(false);
          return;
        }

        setProjects(projectData || []);

        // Step 2: Fetch assignee profiles for display  
        console.log("[Dashboard] Fetching profiles for project assignments");
        
        const { data: profiles, error: profErr } = await supabase
          .from('project_assignments')
          .select('project_id, profiles(full_name,email)')
          .in('project_id', projectIds);

        console.log("[Dashboard] Profiles result:", {
          error: profErr?.message,
          profilesCount: profiles?.length || 0,
        });

        if (!profErr && profiles) {
          const map: Record<string, { full_name: string | null; email: string }> = {};
          for (const row of profiles) {
            const prof = (row as any).profiles;
            if (prof) {
              map[(row as any).project_id] = { full_name: prof.full_name, email: prof.email };
              console.log("[Dashboard] Added profile for project:", {
                projectId: (row as any).project_id,
                profileEmail: prof.email,
              });
            }
          }
          setAssignments(map);
        }

        console.log("[Dashboard] Project fetch complete. Total projects loaded:", projectData?.length || 0);
        setLoadingProjects(false);
      } catch (err) {
        console.error('[Dashboard] Unexpected error:', {
          error: String(err),
          stack: err instanceof Error ? err.stack : 'N/A',
        });
        setLoadingProjects(false);
      }
    };

    if (userRole === 'admin') {
      navigate('/admin');
    } else {
      fetchProjects();
    }
  }, [user, userRole, navigate]);

  if (loading || !user) return null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border/50 px-6 py-3 sticky top-0 bg-background/80 backdrop-blur-md z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <img src={snapflowLogo} alt="Snapflow" className="h-7" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground mr-2">
              {user.email} <span className="text-primary">({userRole})</span>
            </span>
            <Button variant="ghost" size="icon" onClick={() => { signOut(); navigate('/auth'); }} className="h-9 w-9" title="Déconnexion">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Mes Projets</h1>
          <Button variant="outline" size="sm" onClick={() => navigate('/schedules')}>
            <CalendarClock className="w-4 h-4 mr-2" /> Planification
          </Button>
        </div>

        {loadingProjects ? (
          <p className="text-muted-foreground">Chargement…</p>
        ) : projects.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p className="text-muted-foreground">Aucun projet assigné.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(project => (
              <div key={project.id} className="glass-card p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <Globe className="w-5 h-5 text-primary" />
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{project.site_name}</h3>
                    <a href={project.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary truncate block">
                      {project.url}
                    </a>
                    <p className="text-xs text-muted-foreground mt-1">
                      {assignments[project.id]?.full_name || assignments[project.id]?.email || <span className="italic">Non assignÃ©</span>}
                    </p>
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => navigate(`/admin/projects/${project.id}`)}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Voir le projet
                </Button>
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default Dashboard;
