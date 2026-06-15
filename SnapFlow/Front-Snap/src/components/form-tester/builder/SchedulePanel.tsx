import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Loader2, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formTesterApi } from '@/lib/form-tester/api';
import type { WorkflowSchedule, WorkflowScheduleFrequency } from '@/lib/form-tester/types';

interface SchedulePanelProps {
  workflowId: string;
  scenarioId: string;
  workflowName: string;
  isEditable: boolean;
}

const FREQUENCY_LABELS: Record<WorkflowScheduleFrequency, string> = {
  once: 'Une fois',
  daily: 'Tous les jours',
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
};

function defaultStartAt(): string {
  const value = new Date(Date.now() + 5 * 60 * 1000);
  value.setSeconds(0, 0);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function formatDate(value: string | null): string {
  if (!value) return 'Aucune prochaine execution';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function SchedulePanel({
  workflowId,
  scenarioId,
  workflowName,
  isEditable,
}: SchedulePanelProps) {
  const [schedules, setSchedules] = useState<WorkflowSchedule[]>([]);
  const [name, setName] = useState(`${workflowName} - execution planifiee`);
  const [frequency, setFrequency] = useState<WorkflowScheduleFrequency>('once');
  const [startAt, setStartAt] = useState(defaultStartAt);
  const [endAt, setEndAt] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [timezone, setTimezone] = useState('Europe/Paris');
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSchedules = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await formTesterApi.listSchedules(workflowId);
      setSchedules(response.schedules);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les planifications');
    } finally {
      setIsLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  const mutate = async (operation: () => Promise<void>) => {
    setIsMutating(true);
    setError(null);
    try {
      await operation();
      await loadSchedules();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'La planification a echoue');
    } finally {
      setIsMutating(false);
    }
  };

  const createSchedule = async () => {
    await mutate(async () => {
      await formTesterApi.createSchedule({
        workflowId,
        scenarioId,
        name,
        frequency,
        timezone,
        startAt: new Date(startAt).toISOString(),
        dayOfWeek: frequency === 'weekly' ? dayOfWeek : null,
        dayOfMonth: frequency === 'monthly' ? dayOfMonth : null,
        endAt: endAt ? new Date(endAt).toISOString() : null,
      });
      setStartAt(defaultStartAt());
      setEndAt('');
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Planifier ce scenario</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Une version approuvee et immuable du scenario sera epinglee au planning.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium">
            Nom
            <Input className="mt-1" value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium">
              Frequence
              <select
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={frequency}
                onChange={(event) => setFrequency(event.target.value as WorkflowScheduleFrequency)}
              >
                {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium">
              Fuseau horaire
              <Input className="mt-1" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
            </label>
          </div>

          <label className="block text-xs font-medium">
            Premiere execution
            <Input
              className="mt-1"
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </label>

          {frequency === 'weekly' ? (
            <label className="block text-xs font-medium">
              Jour de la semaine
              <select
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={dayOfWeek}
                onChange={(event) => setDayOfWeek(Number(event.target.value))}
              >
                <option value={1}>Lundi</option>
                <option value={2}>Mardi</option>
                <option value={3}>Mercredi</option>
                <option value={4}>Jeudi</option>
                <option value={5}>Vendredi</option>
                <option value={6}>Samedi</option>
                <option value={0}>Dimanche</option>
              </select>
            </label>
          ) : null}

          {frequency === 'monthly' ? (
            <label className="block text-xs font-medium">
              Jour du mois
              <Input
                className="mt-1"
                type="number"
                min={1}
                max={28}
                value={dayOfMonth}
                onChange={(event) => setDayOfMonth(Number(event.target.value))}
              />
            </label>
          ) : null}

          {frequency !== 'once' ? (
            <label className="block text-xs font-medium">
              Fin optionnelle
              <Input
                className="mt-1"
                type="datetime-local"
                min={startAt}
                value={endAt}
                onChange={(event) => setEndAt(event.target.value)}
              />
            </label>
          ) : null}

          <Button
            className="w-full"
            onClick={() => void createSchedule()}
            disabled={!isEditable || isMutating || !name.trim() || !startAt}
          >
            {isMutating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
            Creer la planification
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Chargement...
        </div>
      ) : schedules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Aucune execution planifiee pour ce workflow.
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((schedule) => (
            <div key={schedule.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{schedule.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {FREQUENCY_LABELS[schedule.frequency]} - {schedule.timezone}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Prochaine: {formatDate(schedule.next_run_at)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Snapshot v{schedule.form_scenario_versions?.version_number ?? '?'}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                  schedule.is_active
                    ? 'bg-emerald-500/10 text-emerald-700'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {schedule.is_active ? 'Active' : 'Suspendue'}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isMutating}
                  onClick={() => void mutate(() => formTesterApi.updateSchedule(schedule.id, {
                    is_active: !schedule.is_active,
                  }).then(() => undefined))}
                >
                  {schedule.is_active ? <Pause className="mr-1 h-3.5 w-3.5" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                  {schedule.is_active ? 'Suspendre' : 'Reprendre'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isMutating}
                  onClick={() => void mutate(() => formTesterApi.runScheduleNow(schedule.id))}
                >
                  <Play className="mr-1 h-3.5 w-3.5" />
                  Executer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isMutating}
                  onClick={() => void mutate(() => formTesterApi.refreshScheduleSnapshot(schedule.id).then(() => undefined))}
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  Actualiser
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={isMutating}
                  onClick={() => void mutate(() => formTesterApi.deleteSchedule(schedule.id))}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Supprimer
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
