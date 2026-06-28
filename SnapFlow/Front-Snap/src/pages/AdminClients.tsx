import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, Edit2, Link2, Plus, Save, Search, Trash2, Unlink, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { getProfileDisplayName } from '@/lib/userDisplay';
import { formatDate } from '@/lib/dateFormat';

const HOLDING_CLIENT_NAME = 'A classer';

interface ClientRow { id: string; name: string; created_at: string; updated_at: string }
interface ProjectRow { id: string; site_name: string; url?: string | null; client_id: string }
interface AssignmentRow { project_id: string; user_id: string }
interface ProfileRow { id: string; email: string; full_name: string | null }
interface RoleRow { user_id: string; role: string }
interface ReportRow { id?: string; project_id: string; created_at: string; status?: string | null }

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
  const [searchTerm, setSearchTerm] = useState('');
  const [newName, setNewName] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [attachProjectId, setAttachProjectId] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [clientsRes, projectsRes, assignmentsRes, profilesRes, rolesRes, auditsRes, activityRes] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('projects').select('id, site_name, url, client_id').order('site_name'),
      supabase.from('project_assignments').select('project_id, user_id'),
      supabase.from('profiles').select('id, email, full_name'),
      supabase.from('user_roles').select('user_id, role'),
      supabase.from('audits').select('id, project_id, created_at, status').order('created_at', { ascending: false }),
      supabase.from('activity_reports').select('id, project_id, created_at').order('created_at', { ascending: false }),
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

  useEffect(() => {
    if (!selectedClientId && clients.length > 0) {
      setSelectedClientId(clients.find((client) => client.name !== HOLDING_CLIENT_NAME)?.id ?? clients[0].id);
    }
  }, [clients, selectedClientId]);

  const roleByUser = useMemo(() => new Map(roles.map((role) => [role.user_id, role.role])), [roles]);
  const profileByUser = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const holdingClient = useMemo(() => clients.find((client) => client.name === HOLDING_CLIENT_NAME), [clients]);
  const selectedClient = selectedClientId ? clientById.get(selectedClientId) ?? null : null;

  const projectsForClient = (clientId: string) => projects.filter((project) => project.client_id === clientId);

  const selectedProjects = selectedClient ? projectsForClient(selectedClient.id) : [];
  const selectedProjectIds = useMemo(() => new Set(selectedProjects.map((project) => project.id)), [selectedProjects]);
  const attachableProjects = useMemo(
    () => projects.filter((project) => project.client_id !== selectedClientId),
    [projects, selectedClientId]
  );

  const assignedPeople = useMemo(() => {
    const assignedUserIds = Array.from(new Set(assignments
      .filter((assignment) => selectedProjectIds.has(assignment.project_id))
      .map((assignment) => assignment.user_id)));
    const charges = assignedUserIds
      .filter((userId) => roleByUser.get(userId) === 'charge_de_projet')
      .map((userId) => profileByUser.get(userId))
      .filter(Boolean) as ProfileRow[];
    const rapporteurs = assignedUserIds
      .filter((userId) => roleByUser.get(userId) === 'rapporteur')
      .map((userId) => profileByUser.get(userId))
      .filter(Boolean) as ProfileRow[];
    return { charges, rapporteurs };
  }, [assignments, selectedProjectIds, roleByUser, profileByUser]);

  const selectedAudits = useMemo(
    () => audits.filter((audit) => selectedProjectIds.has(audit.project_id)).slice(0, 8),
    [audits, selectedProjectIds]
  );
  const selectedActivityReports = useMemo(
    () => activityReports.filter((report) => selectedProjectIds.has(report.project_id)).slice(0, 8),
    [activityReports, selectedProjectIds]
  );

  const filteredClients = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    const sorted = [...clients].sort((a, b) => {
      if (a.name === HOLDING_CLIENT_NAME) return 1;
      if (b.name === HOLDING_CLIENT_NAME) return -1;
      return a.name.localeCompare(b.name);
    });
    if (!needle) return sorted;
    return sorted.filter((client) => client.name.toLowerCase().includes(needle));
  }, [clients, searchTerm]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.from('clients').insert({ name }).select('*').single();
      if (error) throw error;
      setNewName('');
      setSearchTerm(name);
      setSelectedClientId(data.id);
      toast({ title: 'Client cree' });
      await fetchData();
    } catch (error: any) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedClient || !editingName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ name: editingName.trim(), updated_at: new Date().toISOString() })
        .eq('id', selectedClient.id);
      if (error) throw error;
      setEditingName('');
      toast({ title: 'Client mis a jour' });
      await fetchData();
    } catch (error: any) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedClient) return;
    if (selectedProjects.length > 0) {
      toast({ title: 'Suppression bloquee', description: 'Retirez les projets associes avant de supprimer ce client.', variant: 'destructive' });
      return;
    }
    if (selectedClient.name === HOLDING_CLIENT_NAME) {
      toast({ title: 'Suppression bloquee', description: 'Ce client sert de zone de classement.', variant: 'destructive' });
      return;
    }
    if (!confirm(`Supprimer le client ${selectedClient.name} ?`)) return;
    const { error } = await supabase.from('clients').delete().eq('id', selectedClient.id);
    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
      return;
    }
    setSelectedClientId(holdingClient?.id ?? null);
    toast({ title: 'Client supprime' });
    await fetchData();
  };

  const handleAttachProject = async () => {
    if (!selectedClient || !attachProjectId) return;
    const { error } = await supabase.from('projects').update({ client_id: selectedClient.id }).eq('id', attachProjectId);
    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
      return;
    }
    setAttachProjectId('');
    toast({ title: 'Projet associe', description: selectedClient.name });
    await fetchData();
  };

  const handleDetachProject = async (project: ProjectRow) => {
    if (!holdingClient) {
      toast({ title: 'Client de classement manquant', description: `Creez le client "${HOLDING_CLIENT_NAME}" avant de retirer un projet.`, variant: 'destructive' });
      return;
    }
    if (project.client_id === holdingClient.id) return;
    const { error } = await supabase.from('projects').update({ client_id: holdingClient.id }).eq('id', project.id);
    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Projet retire', description: `${project.site_name} est revenu dans ${HOLDING_CLIENT_NAME}.` });
    await fetchData();
  };

  if (!isAdmin) return <div className="glass-card p-6 text-sm text-muted-foreground">Acces reserve aux Super Admins.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Clients</h1>
            <p className="text-sm text-muted-foreground">Recherchez un client, ouvrez sa fiche, puis associez les projets concernes.</p>
          </div>
        </div>
        <form onSubmit={handleCreate} className="flex gap-2">
          <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Nouveau client" className="h-9 w-56" />
          <Button size="sm" type="submit" disabled={saving || !newName.trim()}>
            <Plus className="mr-1.5 h-4 w-4" /> Ajouter
          </Button>
        </form>
      </div>

      {loading ? (
        <div className="glass-card p-8 text-center text-sm text-muted-foreground">Chargement...</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="glass-card p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Rechercher un client..."
                className="pl-9"
              />
            </div>
            <div className="mt-3 max-h-[640px] space-y-1 overflow-y-auto pr-1">
              {filteredClients.map((client) => {
                const projectCount = projectsForClient(client.id).length;
                const isSelected = client.id === selectedClientId;
                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => { setSelectedClientId(client.id); setEditingName(''); }}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                      isSelected ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{client.name}</span>
                      <span className="text-xs text-muted-foreground">{projectCount}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{projectCount} projet(s)</p>
                  </button>
                );
              })}
              {filteredClients.length === 0 && (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Aucun client trouve.
                </div>
              )}
            </div>
          </aside>

          <section className="glass-card p-5">
            {!selectedClient ? (
              <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
                Recherchez et selectionnez un client.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 border-b border-border/50 pb-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    {editingName ? (
                      <div className="flex max-w-xl gap-2">
                        <Input value={editingName} onChange={(event) => setEditingName(event.target.value)} className="h-9" />
                        <Button size="sm" onClick={handleUpdate} disabled={saving || !editingName.trim()}><Save className="mr-1.5 h-4 w-4" /> Enregistrer</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingName('')}><X className="mr-1.5 h-4 w-4" /> Annuler</Button>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Fiche client</p>
                        <h2 className="truncate text-2xl font-bold">{selectedClient.name}</h2>
                      </>
                    )}
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedProjects.length} projet(s) associe(s). Creation: {formatDate(selectedClient.created_at)}.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditingName(selectedClient.name)}>
                      <Edit2 className="mr-1.5 h-4 w-4" /> Renommer
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSelectedClientId(holdingClient?.id ?? selectedClientId)}>
                      <ArrowLeft className="mr-1.5 h-4 w-4" /> A classer
                    </Button>
                    <Button size="sm" variant="destructive" onClick={handleDelete} disabled={selectedProjects.length > 0 || selectedClient.name === HOLDING_CLIENT_NAME}>
                      <Trash2 className="mr-1.5 h-4 w-4" /> Supprimer
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <Metric label="Projets" value={selectedProjects.length} />
                  <Metric label="Audits" value={audits.filter((audit) => selectedProjectIds.has(audit.project_id)).length} />
                  <Metric label="Charges" value={assignedPeople.charges.length} />
                  <Metric label="Rapporteurs" value={assignedPeople.rapporteurs.length} />
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
                  <div className="space-y-3">
                    <div className="flex flex-col gap-2 rounded-md border border-border/60 p-3 md:flex-row md:items-end">
                      <div className="flex-1">
                        <label className="mb-1 block text-xs text-muted-foreground">Associer un projet existant</label>
                        <select
                          value={attachProjectId}
                          onChange={(event) => setAttachProjectId(event.target.value)}
                          className="h-10 w-full rounded-md border border-border bg-secondary px-3 text-sm text-foreground"
                        >
                          <option value="">Selectionner un projet...</option>
                          {attachableProjects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.site_name} - {clientById.get(project.client_id)?.name || 'Client inconnu'}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Button onClick={handleAttachProject} disabled={!attachProjectId}>
                        <Link2 className="mr-1.5 h-4 w-4" /> Associer
                      </Button>
                    </div>

                    <div>
                      <h3 className="mb-2 text-sm font-semibold">Projets associes</h3>
                      <div className="space-y-2">
                        {selectedProjects.map((project) => (
                          <div key={project.id} className="flex flex-col gap-2 rounded-md border border-border/60 p-3 md:flex-row md:items-center md:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{project.site_name}</p>
                              {project.url && <p className="truncate text-xs text-muted-foreground">{project.url}</p>}
                            </div>
                            <Button size="sm" variant="outline" onClick={() => handleDetachProject(project)} disabled={selectedClient.name === HOLDING_CLIENT_NAME}>
                              <Unlink className="mr-1.5 h-4 w-4" /> Retirer
                            </Button>
                          </div>
                        ))}
                        {selectedProjects.length === 0 && (
                          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                            Aucun projet associe a ce client.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <PeopleBlock title="Charges de projet" people={assignedPeople.charges} />
                    <PeopleBlock title="Rapporteurs" people={assignedPeople.rapporteurs} />
                    <ReportBlock title="Audits recents" reports={selectedAudits} projects={projects} />
                    <ReportBlock title="Rapports activite recents" reports={selectedActivityReports} projects={projects} />
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-md border border-border/60 p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-bold">{value}</p>
  </div>
);

const PeopleBlock = ({ title, people }: { title: string; people: ProfileRow[] }) => (
  <div className="rounded-md border border-border/60 p-3">
    <h3 className="text-sm font-semibold">{title}</h3>
    <div className="mt-2 flex flex-wrap gap-1.5">
      {people.length > 0 ? people.map((person) => (
        <span key={person.id} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
          {getProfileDisplayName(person)}
        </span>
      )) : <span className="text-xs text-muted-foreground">Aucun</span>}
    </div>
  </div>
);

const ReportBlock = ({ title, reports, projects }: { title: string; reports: ReportRow[]; projects: ProjectRow[] }) => {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return (
    <div className="rounded-md border border-border/60 p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2 space-y-2">
        {reports.length > 0 ? reports.map((report, index) => (
          <div key={`${report.project_id}-${report.created_at}-${index}`} className="text-xs">
            <p className="truncate font-medium">{projectById.get(report.project_id)?.site_name || 'Projet inconnu'}</p>
            <p className="text-muted-foreground">{formatDate(report.created_at)}{report.status ? ` - ${report.status}` : ''}</p>
          </div>
        )) : <p className="text-xs text-muted-foreground">Aucun</p>}
      </div>
    </div>
  );
};

export default AdminClients;
