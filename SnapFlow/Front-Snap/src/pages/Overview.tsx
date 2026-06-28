import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import {
  Building2, FolderOpen, FileBarChart, CalendarClock, Bell, TrendingUp,
} from 'lucide-react';

interface Stats {
  clients: number;
  projects: number;
  audits: number;
  schedules: number;
  unreadNotifications: number;
}

const Overview = () => {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ clients: 0, projects: 0, audits: 0, schedules: 0, unreadNotifications: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [projRes, auditRes, schedRes, notifRes] = await Promise.all([
        isAdmin
          ? supabase.from('projects').select('*', { count: 'exact', head: true })
          : supabase.from('project_assignments').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('audits').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
        supabase.from('report_schedules').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_read', false),
      ]);

      let clientCount = 0;
      if (isAdmin) {
        const { count } = await supabase.from('clients').select('*', { count: 'exact', head: true });
        clientCount = count || 0;
      } else {
        const { data: assignmentRows } = await supabase
          .from('project_assignments')
          .select('project_id')
          .eq('user_id', user.id);
        const projectIds = Array.from(new Set((assignmentRows || []).map(row => row.project_id).filter(Boolean)));
        if (projectIds.length > 0) {
          const { data: assignedProjects } = await supabase
            .from('projects')
            .select('client_id')
            .in('id', projectIds);
          clientCount = new Set((assignedProjects || []).map(project => project.client_id).filter(Boolean)).size;
        }
      }

      setStats({
        clients: clientCount,
        projects: projRes.count || 0,
        audits: auditRes.count || 0,
        schedules: schedRes.count || 0,
        unreadNotifications: notifRes.count || 0,
      });
      setLoading(false);
    };
    load();
  }, [user, isAdmin]);

  const cards = [
    { label: 'Clients', value: stats.clients, icon: Building2, color: 'text-primary', link: '/app/clients' },
    { label: 'Projets', value: stats.projects, icon: FolderOpen, color: 'text-primary', link: '/app/projects' },
    { label: 'Audits terminés', value: stats.audits, icon: FileBarChart, color: 'text-success', link: '/app/reports' },
    { label: 'Planifications actives', value: stats.schedules, icon: CalendarClock, color: 'text-warning', link: '/app/schedules' },
    { label: 'Notifications', value: stats.unreadNotifications, icon: Bell, color: 'text-destructive', link: '/app/notifications' },
  ];

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center gap-3">
        <TrendingUp className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Vue d'ensemble</h1>
          <p className="text-sm text-muted-foreground">Bienvenue sur votre tableau de bord Snapflow</p>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Chargement…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {cards.map(card => (
            <button
              key={card.label}
              onClick={() => navigate(card.link)}
              className="glass-card-hover p-6 text-left"
            >
              <div className="flex items-center justify-between mb-3">
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </div>
              <div className="text-3xl font-bold">{card.value}</div>
              <div className="text-sm text-muted-foreground mt-1">{card.label}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default Overview;
