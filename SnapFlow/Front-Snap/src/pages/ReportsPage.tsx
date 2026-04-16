import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { FileBarChart, Eye, Calendar, Globe } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { getAuditScoreFromAny } from '@/lib/auditReadUtils';

interface AuditWithProject {
  id: string;
  project_id: string;
  status: string;
  created_at: string;
  archived_at: string | null;
  report_data: any;
  site_name?: string;
  url?: string;
}

const ReportsPage = () => {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [audits, setAudits] = useState<AuditWithProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProject, setFilterProject] = useState('');

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data } = await supabase
        .from('audits')
        .select('*, projects(site_name, url)')
        .eq('status', 'completed')
        .order('created_at', { ascending: false });

      const mapped = (data || []).map((a: any) => ({
        ...a,
        site_name: a.projects?.site_name,
        url: a.projects?.url,
      }));
      setAudits(mapped);
      setLoading(false);
    };
    fetch();
  }, [user]);

  const projects = [...new Map(audits.map(a => [a.project_id, { id: a.project_id, name: a.site_name || '—' }])).values()];
  const filtered = filterProject ? audits.filter(a => a.project_id === filterProject) : audits;

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center gap-3">
        <FileBarChart className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Rapports</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} rapport(s) d'audit</p>
        </div>
      </div>

      {/* Filter */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-3">
          <Globe className="w-4 h-4 text-primary" />
          <label className="text-xs text-muted-foreground">Projet</label>
          <select
            value={filterProject}
            onChange={e => setFilterProject(e.target.value)}
            className="h-9 text-sm bg-secondary border border-border rounded-md px-3 text-foreground"
          >
            <option value="">Tous les projets</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="glass-card p-8 text-center text-muted-foreground">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-8 text-center text-muted-foreground">
          Aucun rapport d'audit disponible.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(audit => {
            const rd = audit.report_data as any;
            const score = getAuditScoreFromAny(rd, audit.id, {
              url: audit.url ?? '',
              site_name: audit.site_name ?? 'Site',
            });
            return (
              <div key={audit.id} className="glass-card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${score !== null ? (score >= 70 ? 'bg-emerald-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-500') : 'bg-muted'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{audit.site_name || '—'}</span>
                    {score !== null && (
                      <span className={`text-xs font-bold ${score >= 70 ? 'text-emerald-500' : score >= 50 ? 'text-yellow-500' : 'text-red-500'}`}>
                        {score}/100
                      </span>
                    )}
                    {audit.archived_at && (
                      <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Archivé</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    <span>{format(new Date(audit.created_at), 'dd MMM yyyy à HH:mm', { locale: fr })}</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => navigate(`/audit/${audit.id}/view`)} className="flex-shrink-0">
                  <Eye className="w-3.5 h-3.5 mr-1.5" /> Consulter
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ReportsPage;
