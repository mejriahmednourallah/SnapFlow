import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  CalendarClock, Plus, Trash2, Pause, Play, Filter, List, CalendarDays,
} from 'lucide-react';
import { format, addDays, addWeeks, addMonths, startOfWeek, setDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { formatDate } from '@/lib/dateFormat';
import ScheduleCalendarView from '@/components/schedules/ScheduleCalendarView';
import type { CalendarSchedule } from '@/components/schedules/ScheduleCalendarView';
import { formTesterApi } from '@/lib/form-tester/api';
import type { WorkflowSchedule } from '@/lib/form-tester/types';

interface Schedule {
  id: string;
  project_id: string;
  created_by: string;
  report_type: string;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  next_run_at: string;
  last_run_at: string | null;
  is_active: boolean;
  created_at: string;
  start_date: string;
  end_date: string | null;
}

interface Project {
  id: string;
  site_name: string;
  url: string;
}

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
}

const FREQ_LABELS: Record<string, string> = {
  daily: 'Quotidien',
  weekly: 'Hebdomadaire',
  biweekly: 'Bi-hebdomadaire',
  monthly: 'Mensuel',
};

const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

const computeNextRun = (frequency: string, startDate: string, dayOfWeek: number | null, dayOfMonth: number | null): string => {
  const base = new Date(startDate);
  const now = new Date();
  // If start date is in the future, use it directly
  if (base > now) return base.toISOString();
  // Otherwise compute next occurrence from now, preserving the chosen time
  const hours = base.getHours();
  const minutes = base.getMinutes();
  switch (frequency) {
    case 'daily': {
      const next = addDays(now, 1);
      next.setHours(hours, minutes, 0, 0);
      return next.toISOString();
    }
    case 'weekly': {
      const next = setDay(startOfWeek(addWeeks(now, 1), { weekStartsOn: 1 }), dayOfWeek ?? 1);
      next.setHours(hours, minutes, 0, 0);
      return next.toISOString();
    }
    case 'biweekly': {
      const next = addWeeks(now, 2);
      next.setHours(hours, minutes, 0, 0);
      return next.toISOString();
    }
    case 'monthly': {
      const next = new Date(now.getFullYear(), now.getMonth() + 1, dayOfMonth ?? 1, hours, minutes, 0, 0);
      return next.toISOString();
    }
    default:
      return base.toISOString();
  }
};

const ReportSchedules = () => {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [formSchedules, setFormSchedules] = useState<WorkflowSchedule[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [assignments, setAssignments] = useState<{ project_id: string; user_id: string }[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const [filterCharge, setFilterCharge] = useState('');
  const [filterProject, setFilterProject] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [newProjectId, setNewProjectId] = useState('');
  const [newType, setNewType] = useState<'audit' | 'activity'>('audit');
  const [newFreq, setNewFreq] = useState<'daily' | 'weekly' | 'biweekly' | 'monthly'>('weekly');
  const [newDayOfWeek, setNewDayOfWeek] = useState(1);
  const [newDayOfMonth, setNewDayOfMonth] = useState(1);
  const [newStartDate, setNewStartDate] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [newEndDate, setNewEndDate] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchData = async () => {
    if (!user) return;

    // Now fetch data (projects for non-admin will be filtered via availableProjects)
    const [schedRes, projRes, profRes, assignRes, formScheduleRes] = await Promise.all([
      supabase.from('report_schedules').select('*').order('next_run_at', { ascending: true }),
      supabase.from('projects').select('*'),
      isAdmin ? supabase.from('profiles').select('id, email, full_name') : Promise.resolve({ data: [] }),
      supabase.from('project_assignments').select('project_id, user_id'),
      formTesterApi.listSchedules().catch(() => ({ schedules: [], runs: [] })),
    ]);
    setSchedules((schedRes.data as Schedule[]) || []);
    setProjects(projRes.data || []);
    setProfiles(profRes.data || []);
    setAssignments(assignRes.data || []);
    setFormSchedules(formScheduleRes.schedules);
    setLoadingData(false);
  };

  useEffect(() => {
    if (user) fetchData();
  }, [user, isAdmin]);

  const availableProjects = useMemo(() => {
    if (isAdmin) return projects;
    const assignedIds = new Set(assignments.filter(a => a.user_id === user?.id).map(a => a.project_id));
    return projects.filter(p => assignedIds.has(p.id));
  }, [projects, assignments, isAdmin, user]);

  const filteredSchedules = useMemo(() => {
    let result = [...schedules];
    if (filterCharge) result = result.filter(s => s.created_by === filterCharge);
    if (filterProject) result = result.filter(s => s.project_id === filterProject);
    return result;
  }, [schedules, filterCharge, filterProject]);

  const calendarData = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    filteredSchedules.filter(s => s.is_active).forEach(s => {
      const key = format(new Date(s.next_run_at), 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(0, 30);
  }, [filteredSchedules]);

  const getProjectName = (id: string) => projects.find(p => p.id === id)?.site_name ?? '—';
  const calendarSchedules = useMemo<CalendarSchedule[]>(() => [
    ...filteredSchedules.map((schedule) => ({
      id: schedule.id,
      title: getProjectName(schedule.project_id),
      kind: schedule.report_type === 'audit' ? 'audit' as const : 'activity' as const,
      frequency: schedule.frequency,
      next_run_at: schedule.next_run_at,
      is_active: schedule.is_active,
    })),
    ...formSchedules
      .filter((schedule) => Boolean(schedule.next_run_at))
      .map((schedule) => ({
        id: schedule.id,
        title: schedule.form_workflows?.name ?? schedule.name,
        kind: 'form_tester' as const,
        frequency: schedule.frequency,
        next_run_at: schedule.next_run_at as string,
        is_active: schedule.is_active,
      })),
  ], [filteredSchedules, formSchedules, projects]);

  const getProfileName = (id: string) => {
    const p = profiles.find(p => p.id === id);
    return p ? (p.full_name || p.email) : '—';
  };

  const chargeProfiles = useMemo(() => {
    const ids = new Set(schedules.map(s => s.created_by));
    return profiles.filter(p => ids.has(p.id));
  }, [profiles, schedules]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newProjectId) return;
    setAdding(true);
    try {
      const nextRun = computeNextRun(
        newFreq,
        newStartDate,
        newFreq === 'weekly' || newFreq === 'biweekly' ? newDayOfWeek : null,
        newFreq === 'monthly' ? newDayOfMonth : null,
      );
      const { error } = await supabase.from('report_schedules').insert({
        project_id: newProjectId,
        created_by: user.id,
        report_type: newType,
        frequency: newFreq,
        day_of_week: newFreq === 'weekly' || newFreq === 'biweekly' ? newDayOfWeek : null,
        day_of_month: newFreq === 'monthly' ? newDayOfMonth : null,
        next_run_at: nextRun,
        start_date: new Date(newStartDate).toISOString(),
        end_date: newEndDate ? new Date(newEndDate).toISOString() : null,
      } as any);
      if (error) throw error;
      toast({ title: 'Planification créée' });
      setShowAdd(false);
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    try {
      const { error } = await supabase.from('report_schedules').update({ is_active: !active } as any).eq('id', id);
      if (error) throw error;
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette planification ?')) return;
    try {
      const { error } = await supabase.from('report_schedules').delete().eq('id', id);
      if (error) throw error;
      toast({ title: 'Planification supprimée' });
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    }
  };

  const handleRunNow = async (id: string) => {
    try {
      // Step 1: Set next_run_at to now so it becomes "due"
      const { error } = await supabase.from('report_schedules')
        .update({ next_run_at: new Date().toISOString(), is_active: true } as any)
        .eq('id', id);
      if (error) throw error;

      toast({ title: 'Lancement en cours…', description: 'Exécution du rapport planifié.' });

      // Step 2: Actually invoke the Edge Function to process due schedules
      const { error: execError } = await supabase.functions.invoke('execute-scheduled-reports');
      if (execError) throw execError;

      toast({ title: 'Exécution terminée', description: 'Le rapport a été généré avec succès.' });
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    }
  };

  const syncAll = async () => {
    try {
      const { error } = await supabase.functions.invoke('execute-scheduled-reports');
      if (error) throw error;
      toast({ title: 'Synchronisation terminée' });
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CalendarClock className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Planning</h1>
            <p className="text-sm text-muted-foreground">
              {filteredSchedules.length + formSchedules.length} planification(s)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center border border-border rounded-md overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <List className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Liste</span>
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors ${viewMode === 'calendar' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <CalendarDays className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Calendrier</span>
            </button>
          </div>
          <Button size="sm" variant="outline" onClick={syncAll}>
            <CalendarClock className="w-4 h-4 mr-1.5" /> Synchroniser
          </Button>
          <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
            <Plus className="w-4 h-4 mr-1.5" /> <span className="hidden sm:inline">Nouvelle planification</span><span className="sm:hidden">Nouveau</span>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">Filtres</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {isAdmin && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Chargé(e)</label>
              <select value={filterCharge} onChange={e => setFilterCharge(e.target.value)} className="w-full h-10 text-sm bg-secondary border border-border rounded-md px-3 text-foreground">
                <option value="">Tous</option>
                {chargeProfiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Projet</label>
            <select value={filterProject} onChange={e => setFilterProject(e.target.value)} className="w-full h-10 text-sm bg-secondary border border-border rounded-md px-3 text-foreground">
              <option value="">Tous</option>
              {availableProjects.map(p => <option key={p.id} value={p.id}>{p.site_name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="glass-card p-4 space-y-4">
          <h3 className="font-semibold text-sm">Nouvelle planification</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Projet</label>
              <select value={newProjectId} onChange={e => setNewProjectId(e.target.value)} className="w-full h-10 text-sm bg-secondary border border-border rounded-md px-3 text-foreground" required>
                <option value="">— Sélectionner —</option>
                {availableProjects.map(p => <option key={p.id} value={p.id}>{p.site_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Type de rapport</label>
              <select value={newType} onChange={e => setNewType(e.target.value as any)} className="w-full h-10 text-sm bg-secondary border border-border rounded-md px-3 text-foreground">
                <option value="audit">Audit</option>
                <option value="activity">Activité (Redmine)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Fréquence</label>
              <select value={newFreq} onChange={e => setNewFreq(e.target.value as any)} className="w-full h-10 text-sm bg-secondary border border-border rounded-md px-3 text-foreground">
                <option value="daily">Quotidien</option>
                <option value="weekly">Hebdomadaire</option>
                <option value="biweekly">Bi-hebdomadaire</option>
                <option value="monthly">Mensuel</option>
              </select>
            </div>
            {(newFreq === 'weekly' || newFreq === 'biweekly') && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Jour</label>
                <select value={newDayOfWeek} onChange={e => setNewDayOfWeek(parseInt(e.target.value))} className="w-full h-10 text-sm bg-secondary border border-border rounded-md px-3 text-foreground">
                  {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
            )}
            {newFreq === 'monthly' && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Jour du mois</label>
                <Input type="number" min={1} max={28} value={newDayOfMonth} onChange={e => setNewDayOfMonth(parseInt(e.target.value))} className="h-10" />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Date et heure de début</label>
              <Input type="datetime-local" value={newStartDate} onChange={e => setNewStartDate(e.target.value)} className="h-10" required />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Date et heure de fin <span className="text-muted-foreground">(optionnel)</span></label>
              <Input type="datetime-local" value={newEndDate} onChange={e => setNewEndDate(e.target.value)} className="h-10" min={newStartDate} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setShowAdd(false)}>Annuler</Button>
            <Button type="submit" disabled={adding}>{adding ? 'Création…' : 'Créer'}</Button>
          </div>
        </form>
      )}

      {/* Calendar View */}
      {viewMode === 'calendar' && (
        <ScheduleCalendarView schedules={calendarSchedules} />
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <>
          {/* Calendar preview */}
          {calendarData.length > 0 && (
            <div className="glass-card p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-primary" />
                Calendrier des prochaines exécutions
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {calendarData.map(([date, items]) => (
                  <div key={date} className="border border-border/50 rounded-lg p-3">
                    <div className="text-sm font-semibold mb-2 text-primary">
                      {formatDate(date)}
                    </div>
                    <div className="space-y-1">
                      {items.map(s => (
                        <div key={s.id} className="text-xs flex items-center gap-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${s.report_type === 'audit' ? 'bg-primary' : 'bg-emerald-500'}`} />
                          <span className="font-medium truncate">{getProjectName(s.project_id)}</span>
                          <span className="text-muted-foreground">{s.report_type === 'audit' ? 'Audit' : 'Activité'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* List */}
          <div className="space-y-2">
            {loadingData ? (
              <div className="glass-card p-8 text-center text-muted-foreground">Chargement…</div>
            ) : filteredSchedules.length === 0 ? (
              <div className="glass-card p-8 text-center text-muted-foreground">
                Aucune planification. Cliquez sur "Nouvelle planification" pour en créer une.
              </div>
            ) : (
              filteredSchedules.map(s => (
                <div key={s.id} className={`glass-card p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 ${!s.is_active ? 'opacity-50' : ''}`}>
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${s.report_type === 'audit' ? 'bg-primary' : 'bg-emerald-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{getProjectName(s.project_id)}</span>
                      <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{s.report_type === 'audit' ? 'Audit' : 'Activité'}</span>
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{FREQ_LABELS[s.frequency]}</span>
                      {(s.frequency === 'weekly' || s.frequency === 'biweekly') && s.day_of_week !== null && (
                        <span className="text-xs text-muted-foreground">le {DAYS[s.day_of_week]}</span>
                      )}
                      {s.frequency === 'monthly' && s.day_of_month !== null && (
                        <span className="text-xs text-muted-foreground">le {s.day_of_month} du mois</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span>Du <strong className="text-foreground">{format(new Date(s.start_date), 'dd/MM/yyyy HH:mm')}</strong></span>
                      <span>{s.end_date ? `au ${format(new Date(s.end_date), 'dd/MM/yyyy HH:mm')}` : '∞ Sans fin'}</span>
                      <span>Prochaine : <strong className="text-foreground">{format(new Date(s.next_run_at), 'dd/MM/yyyy HH:mm')}</strong></span>
                      {s.last_run_at && <span>Dernière : {format(new Date(s.last_run_at), 'dd/MM/yyyy HH:mm')}</span>}
                      {isAdmin && <span>Par : {getProfileName(s.created_by)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => handleRunNow(s.id)} title="Exécuter maintenant">
                      <Play className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleToggle(s.id, s.is_active)} title={s.is_active ? 'Mettre en pause' : 'Activer'}>
                      {s.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(s.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ReportSchedules;
