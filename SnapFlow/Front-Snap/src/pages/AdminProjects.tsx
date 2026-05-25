import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Globe, Plus, Download, Users, ArrowLeft, Trash2, Eye, Filter, ArrowUpDown, CalendarClock, ShieldAlert, Search } from 'lucide-react';
import { RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getAuditScoreFromAny } from '@/lib/auditReadUtils';
import { getProfileDisplayName } from '@/lib/userDisplay';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';


interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  redmine_login?: string | null;
  redmine_display_name?: string | null;
}

interface Project {
  id: string;
  url: string;
  site_name: string;
  redmine_url?: string | null;
}

interface Assignment {
  project_id: string;
  user_id: string;
}

interface AuditSummary {
  project_id: string;
  score: number | null;
  created_at: string;
  status?: string;
}

interface ScheduleSummary {
  project_id: string;
  next_run_at: string;
  report_type: string;
}

interface RedmineProject {
  id: number;
  name: string;
  identifier: string;
  homepage?: string;
  existing?: boolean;
}

const AdminProjects = () => {
  const { user, isAdmin, userRole } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filterUserId = searchParams.get('user');
  const { toast } = useToast();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [latestAudits, setLatestAudits] = useState<AuditSummary[]>([]);
  const [nextSchedules, setNextSchedules] = useState<ScheduleSummary[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [syncingBulk, setSyncingBulk] = useState(false);

  // Filters & sorting
  const [filterCharge, setFilterCharge] = useState('');
  const [filterScoreMin, setFilterScoreMin] = useState('');
  const [filterScoreMax, setFilterScoreMax] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'score-asc' | 'score-desc' | 'date-asc' | 'date-desc'>('name');

  // Manual add form
  const [showAdd, setShowAdd] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [adding, setAdding] = useState(false);

  // Redmine import
  const [showRedmine, setShowRedmine] = useState(false);
  const [redmineProjects, setRedmineProjects] = useState<RedmineProject[]>([]);
  const [loadingRedmine, setLoadingRedmine] = useState(false);
  const [selectedRedmine, setSelectedRedmine] = useState<Set<number>>(new Set());
  const [redmineAssignee, setRedmineAssignee] = useState('');
  const [importing, setImporting] = useState(false);
  const [syncingMyRedmine, setSyncingMyRedmine] = useState(false);
  const [redmineSearch, setRedmineSearch] = useState('');

  const fetchData = async () => {
    const [profilesRes, redmineIdentitiesRes, projectsRes, assignmentsRes, auditsRes, schedulesRes] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name'),
      supabase.from('redmine_user_identities').select('user_id, redmine_login, redmine_display_name'),
      supabase.from('projects').select('*'),
      supabase.from('project_assignments').select('*'),
      supabase.from('audits').select('project_id, report_data, created_at, status').order('created_at', { ascending: false }),
      supabase.from('report_schedules').select('project_id, next_run_at, report_type').eq('is_active', true).order('next_run_at', { ascending: true }),
    ]);
    const identitiesByUser = new Map((redmineIdentitiesRes.data || []).map((identity: any) => [identity.user_id, identity]));
    setProfiles((profilesRes.data || []).map((profile: any) => ({
      ...profile,
      redmine_login: identitiesByUser.get(profile.id)?.redmine_login ?? null,
      redmine_display_name: identitiesByUser.get(profile.id)?.redmine_display_name ?? null,
    })));
    setProjects(projectsRes.data || []);
    setAssignments(assignmentsRes.data || []);

    // Extract latest audit per project (prefer completed, else most recent with data)
    const auditMap = new Map<string, AuditSummary>();
    for (const a of (auditsRes.data || [])) {
      const existing = auditMap.get(a.project_id);
      const rd = a.report_data as any;
      const summary: AuditSummary = {
        project_id: a.project_id,
        score: getAuditScoreFromAny(rd, a.project_id, {
          url: projectsRes.data?.find((p: any) => p.id === a.project_id)?.url ?? '',
          site_name: projectsRes.data?.find((p: any) => p.id === a.project_id)?.site_name ?? 'Site',
        }),
        created_at: a.created_at,
        status: a.status,
      };

      if (!existing) {
        auditMap.set(a.project_id, summary);
        continue;
      }

      const existingIsCompleted = existing.status === 'completed';
      const currentIsCompleted = a.status === 'completed';
      if (!existingIsCompleted && currentIsCompleted) {
        auditMap.set(a.project_id, summary);
      }
    }
    setLatestAudits(Array.from(auditMap.values()));

    // Extract next schedule per project
    const schedMap = new Map<string, ScheduleSummary>();
    for (const s of (schedulesRes.data || [])) {
      if (!schedMap.has(s.project_id)) {
        schedMap.set(s.project_id, s as ScheduleSummary);
      }
    }
    setNextSchedules(Array.from(schedMap.values()));

    setLoadingData(false);
  };

  useEffect(() => {
    if (user) fetchData();
  }, [user, isAdmin, filterUserId]);

  const getAssignedUsers = (projectId: string) => {
    return assignments
      .filter(a => a.project_id === projectId)
      .map(a => profiles.find(p => p.id === a.user_id))
      .filter(Boolean) as Profile[];
  };

  const getLatestAudit = (projectId: string): AuditSummary | undefined => {
    return latestAudits.find(a => a.project_id === projectId);
  };

  const getNextSchedule = (projectId: string): ScheduleSummary | undefined => {
    return nextSchedules.find(s => s.project_id === projectId);
  };

  // Get unique chargés (users assigned to at least one project)
  const chargeProfiles = useMemo(() => {
    const userIds = new Set(assignments.map(a => a.user_id));
    return profiles.filter(p => userIds.has(p.id));
  }, [profiles, assignments]);

  const filteredAndSortedProjects = useMemo(() => {
    let result = [...projects];

    if (filterUserId) {
      result = result.filter((p) => assignments.some((a) => a.project_id === p.id && a.user_id === filterUserId));
    }

    if (filterCharge) {
      result = result.filter((p) => assignments.some((a) => a.project_id === p.id && a.user_id === filterCharge));
    }

    if (filterScoreMin || filterScoreMax) {
      result = result.filter((p) => {
        const audit = getLatestAudit(p.id);
        if (!audit || audit.score === null) return false;
        if (filterScoreMin && audit.score < parseInt(filterScoreMin)) return false;
        if (filterScoreMax && audit.score > parseInt(filterScoreMax)) return false;
        return true;
      });
    }

    result.sort((a, b) => {
      const auditA = getLatestAudit(a.id);
      const auditB = getLatestAudit(b.id);

      switch (sortBy) {
        case 'score-asc':
          return (auditA?.score ?? -1) - (auditB?.score ?? -1);
        case 'score-desc':
          return (auditB?.score ?? -1) - (auditA?.score ?? -1);
        case 'date-asc':
          return (auditA?.created_at || '').localeCompare(auditB?.created_at || '');
        case 'date-desc':
          return (auditB?.created_at || '').localeCompare(auditA?.created_at || '');
        default:
          return a.site_name.localeCompare(b.site_name);
      }
    });

    return result;
  }, [projects, assignments, latestAudits, filterUserId, filterCharge, filterScoreMin, filterScoreMax, sortBy]);

  const filterUser = filterUserId ? profiles.find((p) => p.id === filterUserId) : null;
  const currentUserProfile = user?.id ? profiles.find((p) => p.id === user.id) : null;
  const canImportRedmine = isAdmin || ['charge', 'charge_de_projet'].includes(String(userRole || '').toLowerCase());

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      const { data: proj, error } = await supabase.from('projects').insert({ url: newUrl, site_name: newName }).select().single();
      if (error) throw error;
      if (newAssignee) {
        await supabase.from('project_assignments').insert({ project_id: proj.id, user_id: newAssignee });
      }
      toast({ title: 'Projet ajouté', description: newName });
      setShowAdd(false);
      setNewUrl('');
      setNewName('');
      setNewAssignee('');
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  // Delete with double auth
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const openDeleteDialog = (projectId: string, name: string) => {
    if (!isAdmin) return;
    setDeleteTarget({ id: projectId, name });
    setDeleteStep(1);
    setDeletePassword('');
  };

  const handleDeleteStep1 = () => {
    setDeleteStep(2);
  };

  const handleDeleteStep2 = async () => {
    if (!deleteTarget || !user?.email) return;
    setDeleting(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: deletePassword,
      });
      if (authError) throw new Error('Mot de passe incorrect');

      await supabase.from('report_schedules').delete().eq('project_id', deleteTarget.id);
      await supabase.from('project_assignments').delete().eq('project_id', deleteTarget.id);
      await supabase.from('audits').delete().eq('project_id', deleteTarget.id);
      await supabase.from('activity_reports').delete().eq('project_id', deleteTarget.id);
      const { error } = await supabase.from('projects').delete().eq('id', deleteTarget.id);
      if (error) throw error;

      toast({ title: 'Projet supprimé', description: deleteTarget.name });
      setDeleteTarget(null);
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const [filteringRedmineByUser, setFilteringRedmineByUser] = useState(false);

  const handleBulkSyncAssignments = async () => {
    setSyncingBulk(true);

    const requestPayload = {
      type: 'sync_account_projects_bulk',
      user_id: filterUserId || undefined,
    };

    try {
      const session = await supabase.auth.getSession();
      if (!session?.data?.session?.access_token) {
        throw new Error('No active session');
      }

      const response = await fetch(
        'https://wagctsvpmnleqzqjhqjq.functions.supabase.co/fetch-redmine',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.data.session.access_token}`,
          },
          body: JSON.stringify(requestPayload),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        toast({
          title: 'Erreur',
          description: data?.error || `HTTP ${response.status}`,
          variant: 'destructive',
        });
        return;
      }

      const count = data?.assignment_rows_upserted ?? 0;
      toast({
        title: 'Synchronisation terminée',
        description: `${count} assignation(s) mise(s) à jour.`,
      });

      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setSyncingBulk(false);
    }
  };

  const handleFetchRedmine = async () => {
    setLoadingRedmine(true);
    setFilteringRedmineByUser(Boolean(filterUserId));
    try {
      if (!isAdmin) {
        const { data, error } = await supabase.functions.invoke('fetch-redmine', {
          body: { type: 'my_redmine_projects_for_import' },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        setRedmineProjects((data?.projects || []) as RedmineProject[]);
        setShowRedmine(true);
        return;
      }

      const [{ data: projectData, error: projectError }, { data: cacheData, error: cacheError }] = await Promise.all([
        supabase.functions.invoke('fetch-redmine', {
          body: { type: 'projects' },
        }),
        filterUserId
          ? supabase.functions.invoke('fetch-redmine', {
              body: { type: 'get_cached_redmine_projects_for_user', user_id: filterUserId },
            })
          : Promise.resolve({ data: null, error: null } as any),
      ]);

      if (projectError) throw projectError;
      if (cacheError) throw cacheError;

      const allRedmineProjects: RedmineProject[] = projectData.projects || [];
      const allowedIdentifiers = new Set<string>((cacheData?.identifiers || []) as string[]);

      const userScopedProjects = filterUserId
        ? allRedmineProjects.filter((project) => allowedIdentifiers.has(project.identifier))
        : allRedmineProjects;

      const existingIdentifiers = new Set(
        projects
          .map((p) => {
            try {
              const url = new URL(p.redmine_url || p.url);
              const match = url.pathname.match(/\/projects\/([^/]+)/);
              return match ? match[1] : null;
            } catch {
              return null;
            }
          })
          .filter((value): value is string => Boolean(value))
      );

      const projectsToShow = userScopedProjects.filter((rp) => !existingIdentifiers.has(rp.identifier));

      if (filterUserId && cacheData?.matched_count === 0) {
        toast({
          title: 'Aucun projet en cache',
          description: 'Lancez "Sync comptes" pour rafraichir les correspondances Redmine.',
          variant: 'default',
        });
      }

      setRedmineProjects(projectsToShow);
      setShowRedmine(true);
    } catch (err: any) {
      toast({ title: 'Erreur Redmine', description: err.message, variant: 'destructive' });
    } finally {
      setLoadingRedmine(false);
      setFilteringRedmineByUser(false);
    }
  };

  const toggleRedmineSelect = (id: number) => {
    setSelectedRedmine((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleImportRedmine = async () => {
    if (selectedRedmine.size === 0) return;
    setImporting(true);
    try {
      if (!isAdmin) {
        const identifiers = Array.from(selectedRedmine)
          .map((rid) => redmineProjects.find((p) => p.id === rid)?.identifier)
          .filter((identifier): identifier is string => Boolean(identifier));

        const { data, error } = await supabase.functions.invoke('fetch-redmine', {
          body: { type: 'import_my_redmine_projects', identifiers },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        toast({
          title: 'Import terminé',
          description: `${data?.imported ?? identifiers.length} projet(s) Redmine disponible(s).`,
        });
        setShowRedmine(false);
        setSelectedRedmine(new Set());
        await fetchData();
        return;
      }

      const assigneeId = filterUserId || redmineAssignee;

      for (const rid of selectedRedmine) {
        const rp = redmineProjects.find((p) => p.id === rid);
        if (!rp) continue;

        const siteUrl = rp.homepage || `https://maintenance.medianet.tn/projects/${rp.identifier}`;
        const redmineUrl = `https://maintenance.medianet.tn/projects/${rp.identifier}`;

        const { data: proj, error } = await supabase
          .from('projects')
          .insert({
            url: siteUrl,
            redmine_url: redmineUrl,
            redmine_identifier: rp.identifier,
            site_name: rp.name,
            audit_url_needs_review: !rp.homepage,
          })
          .select()
          .single();
        if (error) throw error;

        if (assigneeId) {
          await supabase.from('project_assignments').insert({ project_id: proj.id, user_id: assigneeId });
        }
      }

      toast({ title: 'Import terminé', description: `${selectedRedmine.size} projet(s) importé(s)` });
      setShowRedmine(false);
      setSelectedRedmine(new Set());
      setRedmineAssignee('');
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  const handleSyncMyRedmineProjects = async () => {
    setSyncingMyRedmine(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-redmine', {
        body: { type: 'sync_my_redmine_projects' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: 'Projets Redmine synchronisÃ©s',
        description: `${data?.imported ?? 0} projet(s) disponible(s), ${data?.revoked ?? 0} accÃ¨s retirÃ©(s).`,
      });
      await fetchData();
    } catch (err: any) {
      toast({
        title: 'Synchronisation Redmine impossible',
        description: err.message || 'Connectez-vous avec Redmine pour importer vos projets.',
        variant: 'destructive',
      });
    } finally {
      setSyncingMyRedmine(false);
    }
  };

  const handleResetFilters = () => {
    setFilterCharge('');
    setFilterScoreMin('');
    setFilterScoreMax('');
    setSortBy('name');
  };

  const hasActiveFilters = filterCharge || filterScoreMin || filterScoreMax || sortBy !== 'name';

  return (
    <div className="space-y-6">
      {filterUser && (
        <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/app/projects')}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Tous les projets
          </Button>
          <span className="text-muted-foreground">Projets de <strong className="text-foreground">{getProfileDisplayName(filterUser)}</strong></span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Globe className="w-5 h-5 text-primary" /> Projets ({filteredAndSortedProjects.length})
        </h2>
        <div className="flex gap-2 flex-wrap">
          {!isAdmin && (
            <>
              <Button size="sm" variant="outline" onClick={handleSyncMyRedmineProjects} disabled={syncingMyRedmine}>
                <RefreshCw className={`w-4 h-4 mr-1.5 ${syncingMyRedmine ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{syncingMyRedmine ? 'Synchronisation...' : 'Synchroniser mes accès'}</span>
                <span className="sm:hidden">{syncingMyRedmine ? '...' : 'Sync'}</span>
              </Button>
              {canImportRedmine && (
                <Button size="sm" variant="outline" onClick={handleFetchRedmine} disabled={loadingRedmine}>
                  <Download className="w-4 h-4 mr-1.5" />
                  <span className="hidden sm:inline">{loadingRedmine ? 'Chargement...' : 'Importer de Redmine'}</span>
                  <span className="sm:hidden">{loadingRedmine ? '...' : 'Redmine'}</span>
                </Button>
              )}
            </>
          )}
          {isAdmin && (
            <>
            <Button size="sm" variant="outline" onClick={handleBulkSyncAssignments} disabled={syncingBulk}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${syncingBulk ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{syncingBulk ? 'Syncing…' : 'Sync to Redmine'}</span>
              <span className="sm:hidden">{syncingBulk ? '…' : 'Sync'}</span>
            </Button>
            <Button size="sm" variant="outline" onClick={handleFetchRedmine} disabled={loadingRedmine}>
              <Download className="w-4 h-4 mr-1.5" /> <span className="hidden sm:inline">{loadingRedmine ? 'Chargement…' : 'Importer de Redmine'}</span><span className="sm:hidden">{loadingRedmine ? '…' : 'Redmine'}</span>
            </Button>
            <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
              <Plus className="w-4 h-4 mr-1.5" /> Ajouter
            </Button>
            </>
          )}
        </div>
      </div>

      {/* Filters & Sorting bar */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">Filtres & Tri</h3>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={handleResetFilters} className="text-xs ml-auto">
              Réinitialiser
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Chargé(e)</label>
            <select
              value={filterCharge}
              onChange={e => setFilterCharge(e.target.value)}
              className="w-full h-10 text-sm bg-secondary border border-border rounded-md px-3 text-foreground"
            >
              <option value="">Tous</option>
              {chargeProfiles.map(p => (
                <option key={p.id} value={p.id}>{getProfileDisplayName(p)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Score min</label>
            <Input
              type="number"
              min={0}
              max={100}
              value={filterScoreMin}
              onChange={e => setFilterScoreMin(e.target.value)}
              placeholder="0"
              className="h-10"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Score max</label>
            <Input
              type="number"
              min={0}
              max={100}
              value={filterScoreMax}
              onChange={e => setFilterScoreMax(e.target.value)}
              placeholder="100"
              className="h-10"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Trier par</label>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="w-full h-10 text-sm bg-secondary border border-border rounded-md px-3 text-foreground"
            >
              <option value="name">Nom (A-Z)</option>
              <option value="score-desc">Score ↓ (meilleur en premier)</option>
              <option value="score-asc">Score ↑ (pire en premier)</option>
              <option value="date-desc">Dernier rapport ↓ (récent)</option>
              <option value="date-asc">Dernier rapport ↑ (ancien)</option>
            </select>
          </div>
          <div className="flex items-center">
            <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground ml-1">{filteredAndSortedProjects.length} résultat(s)</span>
          </div>
        </div>
      </div>

      {/* Manual add form */}
      {showAdd && (
        <form onSubmit={handleAddProject} className="glass-card p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Nom du site</label>
            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Mon site" required />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">URL</label>
            <Input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://exemple.com" required />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Affecter à</label>
            <select value={newAssignee} onChange={e => setNewAssignee(e.target.value)} className="w-full h-10 text-sm bg-secondary border border-border rounded-md px-3 text-foreground">
              <option value="">— Aucun —</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{getProfileDisplayName(p)}</option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={adding}>{adding ? 'Ajout…' : 'Ajouter'}</Button>
        </form>
      )}

      {/* Redmine import */}
      {showRedmine && (
        <div className="glass-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">
              Projets Redmine {filterUserId ? `pour ${getProfileDisplayName(filterUser)}` : ''} ({redmineProjects.length})
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setShowRedmine(false)}>Fermer</Button>
          </div>

          {filteringRedmineByUser && (
            <div className="text-xs bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded px-3 py-2 text-blue-700 dark:text-blue-300">
              ⏳ Filtrage des projets Redmine assignés à l'utilisateur...
            </div>
          )}

          <div className="flex items-end gap-3 mb-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">
                {filterUserId ? `Affecter les projets sélectionnés à ${getProfileDisplayName(filterUser)}` : isAdmin ? 'Affecter les projets sélectionnés à' : 'Importer pour mon compte'}
              </label>
              <select 
                value={filterUserId ? filterUserId : !isAdmin ? user?.id || '' : redmineAssignee}
                onChange={e => !filterUserId && isAdmin && setRedmineAssignee(e.target.value)}
                disabled={!!filterUserId || !isAdmin}
                className="w-full h-10 text-sm bg-secondary border border-border rounded-md px-3 text-foreground disabled:opacity-60"
              >
                {filterUserId ? (
                  <option value={filterUserId}>{getProfileDisplayName(filterUser)}</option>
                ) : !isAdmin ? (
                  <option value={user?.id || ''}>{getProfileDisplayName(currentUserProfile)}</option>
                ) : (
                  <>
                    <option value="">— Aucun —</option>
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>{getProfileDisplayName(p)}</option>
                    ))}
                  </>
                )}
              </select>
            </div>
            <Button size="sm" onClick={handleImportRedmine} disabled={importing || selectedRedmine.size === 0 || filteringRedmineByUser}>
              {importing ? 'Import…' : `Importer (${selectedRedmine.size})`}
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher un projet…"
              value={redmineSearch}
              onChange={e => setRedmineSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="max-h-60 overflow-y-auto space-y-1">
            {redmineProjects
              .filter(rp => {
                const keywords = redmineSearch.toLowerCase().split(/\s+/).filter(Boolean);
                if (keywords.length === 0) return true;
                const text = `${rp.name} ${rp.identifier}`.toLowerCase();
                return keywords.every(kw => text.includes(kw));
              })
              .map(rp => (
              <label key={rp.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/30 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={selectedRedmine.has(rp.id)}
                  onChange={() => toggleRedmineSelect(rp.id)}
                  className="rounded"
                />
                <span className="font-medium">{rp.name}</span>
                <span className="text-xs text-muted-foreground">({rp.identifier})</span>
              </label>
            ))}
            {redmineProjects.filter(rp => {
              const keywords = redmineSearch.toLowerCase().split(/\s+/).filter(Boolean);
              if (keywords.length === 0) return true;
              const text = `${rp.name} ${rp.identifier}`.toLowerCase();
              return keywords.every(kw => text.includes(kw));
            }).length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                {filterUserId ? 'Aucun projet Redmine assigné à cet utilisateur' : 'Aucun projet trouvé'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Projects grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredAndSortedProjects.map(project => {
          const assignedUsers = getAssignedUsers(project.id);
          const latestAudit = getLatestAudit(project.id);
          const nextSched = getNextSchedule(project.id);
          return (
            <div key={project.id} className="glass-card p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <Globe className="w-5 h-5 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{project.site_name}</h3>
                    <a href={project.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary truncate block">{project.url}</a>
                  </div>
                </div>
                {isAdmin && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0" onClick={() => openDeleteDialog(project.id, project.site_name)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>

              {/* Score badge */}
              {latestAudit && latestAudit.score !== null && (
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${latestAudit.score >= 70 ? 'text-emerald-500' : latestAudit.score >= 50 ? 'text-yellow-500' : 'text-red-500'}`}>
                    {latestAudit.score}/100
                  </span>
                  <span className="text-xs text-muted-foreground">
                    — {new Date(latestAudit.created_at).toLocaleDateString('fr-FR')}
                  </span>
                </div>
              )}
              {!latestAudit && (
                <span className="text-xs text-muted-foreground italic">Aucun audit</span>
              )}

              {/* Next scheduled report */}
              {nextSched && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarClock className="w-3 h-3" />
                  <span>Prochain rapport : <strong className="text-foreground">{new Date(nextSched.next_run_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</strong></span>
                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{nextSched.report_type === 'audit' ? 'Audit' : 'Activité'}</span>
                </div>
              )}

              <div className="flex items-center gap-1 flex-wrap">
                <Users className="w-3 h-3 text-muted-foreground" />
                {assignedUsers.length > 0 ? assignedUsers.map(u => (
                  <span key={u.id} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{getProfileDisplayName(u)}</span>
                )) : (
                  <span className="text-xs text-muted-foreground">Non assigne</span>
                )}
              </div>
              <Button variant="outline" size="sm" className="w-full" onClick={() => navigate(`/app/projects/${project.id}`)}>
                <Eye className="w-3.5 h-3.5 mr-1.5" /> Voir le projet
              </Button>
            </div>
          );
        })}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="w-5 h-5" />
              {deleteStep === 1 ? 'Confirmer la suppression' : 'Authentification requise'}
            </DialogTitle>
            <DialogDescription>
              {deleteStep === 1
                ? `Vous êtes sur le point de supprimer définitivement le projet "${deleteTarget?.name}". Cette action est irréversible et supprimera tous les rapports, planifications et assignations associés.`
                : 'Pour des raisons de sécurité, veuillez saisir votre mot de passe pour confirmer la suppression.'}
            </DialogDescription>
          </DialogHeader>

          {deleteStep === 1 ? (
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>Annuler</Button>
              <Button variant="destructive" onClick={handleDeleteStep1}>
                Je confirme la suppression
              </Button>
            </DialogFooter>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Mot de passe</label>
                <Input
                  type="password"
                  value={deletePassword}
                  onChange={e => setDeletePassword(e.target.value)}
                  placeholder="••••••••"
                  autoFocus
                />
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setDeleteTarget(null)}>Annuler</Button>
                <Button variant="destructive" onClick={handleDeleteStep2} disabled={deleting || !deletePassword}>
                  {deleting ? 'Suppression…' : 'Supprimer définitivement'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminProjects;

