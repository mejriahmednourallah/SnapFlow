import { useEffect, useMemo, useState } from 'react';
import { Building2, Edit2, Plus, Save, Trash2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { getProfileDisplayName } from '@/lib/userDisplay';
import { formatDate } from '@/lib/dateFormat';

interface ClientRow { id: string; name: string; created_at: string; updated_at: string }
interface ProjectRow { id: string; site_name: string; client_id: string }
interface AssignmentRow { project_id: string; user_id: string }
interface ProfileRow { id: string; email: string; full_name: string | null }
interface RoleRow { user_id: string; role: string }
interface ReportRow { project_id: string; created_at: string }

const AdminClients = () => {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [audits, setAudits] = useState<ReportRow[]>([]);
  const [activityReports, setActivityReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [clientsRes, projectsRes, assignmentsRes, profilesRes, rolesRes, auditsRes, activityRes] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('projects').select('id, site_name, client_id'),
      supabase.from('project_assignments').select('project_id, user_id'),
      supabase.from('profiles').select('id, email, full_name'),
      supabase.from('user_roles').select('user_id, role'),
      supabase.from('audits').select('project_id, created_at').order('created_at', { ascending: false }),
      supabase.from('activity_reports').select('project_id, created_at').order('created_at', { ascending: false }),
    ]);
    setClients((clientsRes.data || []) as ClientRow[]);
    setProjects((projectsRes.data || []) as ProjectRow[]);
    setAssignments((assignmentsRes.data || []) as AssignmentRow[]);
    setProfiles((profilesRes.data || []) as ProfileRow[]);
    setRoles((rolesRes.data || []) as RoleRow[]);
    setAudits((auditsRes.data || []) as ReportRow[]);
    setActivityReports((activityRes.data || []) as ReportRow[]);
    setLoading(false);
  };

  useEffect(() => { if (isAdmin) fetchData(); }, [isAdmin]);

  const roleByUser = useMemo(() => new Map(roles.map((role) => [role.user_id, role.role])), [roles]);
  const profileByUser = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);

  const clientSummaries = useMemo(() => clients.map((client) => {
    const clientProjects = projects.filter((project) => project.client_id === client.id);
    const projectIds = new Set(clientProjects.map((project) => project.id));
    const assignedUserIds = Array.from(new Set(assignments.filter((assignment) => projectIds.has(assignment.project_id)).map((assignment) => assignment.user_id)));
    const charges = assignedUserIds
      .filter((userId) => roleByUser.get(userId) === 'charge_de_projet')
      .map((userId) => profileByUser.get(userId))
      .filter(Boolean) as ProfileRow[];
    const rapporteurs = assignedUserIds
      .filter((userId) => roleByUser.get(userId) === 'rapporteur')
      .map((userId) => profileByUser.get(userId))
      .filter(Boolean) as ProfileRow[];
    const latestAudit = audits.find((audit) => projectIds.has(audit.project_id));
    const latestActivity = activityReports.find((report) => projectIds.has(report.project_id));
    return { client, clientProjects, charges, rapporteurs, latestAudit, latestActivity };
  }), [clients, projects, assignments, roleByUser, profileByUser, audits, activityReports]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('clients').insert({ name: newName.trim() });
      if (error) throw error;
      setNewName('');
      toast({ title: 'Client cree' });
      await fetchData();
    } catch (error: any) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingId || !editingName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('clients').update({ name: editingName.trim(), updated_at: new Date().toISOString() }).eq('id', editingId);
      if (error) throw error;
      setEditingId(null);
      setEditingName('');
      toast({ title: 'Client mis a jour' });
      await fetchData();
    } catch (error: any) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (client: ClientRow) => {
    const projectCount = projects.filter((project) => project.client_id === client.id).length;
    if (projectCount > 0) {
      toast({ title: 'Suppression bloquee', description: 'Deplacez les projets de ce client avant suppression.', variant: 'destructive' });
      return;
    }
    if (!confirm(`Supprimer le client ${client.name} ?`)) return;
    const { error } = await supabase.from('clients').delete().eq('id', client.id);
    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Client supprime' });
    await fetchData();
  };

  if (!isAdmin) return <div className="glass-card p-6 text-sm text-muted-foreground">Acces reserve aux Super Admins.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Clients ({clients.length})</h1>
            <p className="text-sm text-muted-foreground">Entreprises clientes et projets associes.</p>
          </div>
        </div>
        <form onSubmit={handleCreate} className="flex gap-2">
          <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Nom du client" className="h-9 w-56" />
          <Button size="sm" type="submit" disabled={saving || !newName.trim()}>
            <Plus className="mr-1.5 h-4 w-4" /> Ajouter
          </Button>
        </form>
      </div>

      {loading ? (
        <div className="glass-card p-8 text-center text-sm text-muted-foreground">Chargement...</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {clientSummaries.map(({ client, clientProjects, charges, rapporteurs, latestAudit, latestActivity }) => (
            <div key={client.id} className="glass-card p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {editingId === client.id ? (
                    <Input value={editingName} onChange={(event) => setEditingName(event.target.value)} className="h-9" />
                  ) : (
                    <h2 className="truncate text-base font-semibold">{client.name}</h2>
                  )}
                  <p className="text-xs text-muted-foreground">{clientProjects.length} projet(s)</p>
                </div>
                <div className="flex items-center gap-1">
                  {editingId === client.id ? (
                    <>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleUpdate} disabled={saving}><Save className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingId(null)}><X className="h-4 w-4" /></Button>
                    </>
                  ) : (
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(client.id); setEditingName(client.name); }}><Edit2 className="h-4 w-4" /></Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleDelete(client)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border border-border/50 p-3">
                  <p className="text-xs text-muted-foreground">Charges</p>
                  <p className="font-semibold">{charges.length}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{charges.map(getProfileDisplayName).join(', ') || 'Aucun'}</p>
                </div>
                <div className="rounded-md border border-border/50 p-3">
                  <p className="text-xs text-muted-foreground">Rapporteurs</p>
                  <p className="font-semibold">{rapporteurs.length}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{rapporteurs.map(getProfileDisplayName).join(', ') || 'Aucun'}</p>
                </div>
              </div>

              <div className="space-y-1 text-xs text-muted-foreground">
                <p>Dernier audit : <span className="text-foreground">{latestAudit ? formatDate(latestAudit.created_at) : 'Aucun'}</span></p>
                <p>Dernier rapport activite : <span className="text-foreground">{latestActivity ? formatDate(latestActivity.created_at) : 'Aucun'}</span></p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {clientProjects.slice(0, 8).map((project) => (
                  <span key={project.id} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{project.site_name}</span>
                ))}
                {clientProjects.length > 8 && <span className="text-xs text-muted-foreground">+{clientProjects.length - 8}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminClients;