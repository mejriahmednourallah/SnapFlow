import { useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Schedule {
  id: string;
  project_id: string;
  report_type: string;
  frequency: string;
  next_run_at: string;
  is_active: boolean;
}

interface Props {
  schedules: Schedule[];
  getProjectName: (id: string) => string;
}

const ScheduleCalendarView = ({ schedules, getProjectName }: Props) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const activeSchedules = useMemo(() => schedules.filter(s => s.is_active), [schedules]);

  const schedulesMap = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    activeSchedules.forEach(s => {
      const key = format(new Date(s.next_run_at), 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [activeSchedules]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days: Date[] = [];
  let d = calStart;
  while (d <= calEnd) {
    days.push(d);
    d = addDays(d, 1);
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  return (
    <div className="glass-card p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <h3 className="font-semibold text-sm capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: fr })}
        </h3>
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {dayNames.map(name => (
          <div key={name} className="text-center text-xs font-medium text-muted-foreground py-1">
            {name}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((day, idx) => {
          const key = format(day, 'yyyy-MM-dd');
          const items = schedulesMap.get(key) || [];
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isToday = isSameDay(day, new Date());

          return (
            <div
              key={idx}
              className={`min-h-[70px] sm:min-h-[90px] rounded-md border p-1 text-xs transition-colors ${
                isCurrentMonth ? 'border-border/50 bg-background' : 'border-border/20 bg-muted/20 opacity-50'
              } ${isToday ? 'ring-1 ring-primary/50' : ''}`}
            >
              <div className={`font-medium mb-0.5 ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                {format(day, 'd')}
              </div>
              <div className="space-y-0.5 overflow-hidden">
                {items.slice(0, 3).map(s => (
                  <div
                    key={s.id}
                    className={`text-[10px] leading-tight px-1 py-0.5 rounded truncate ${
                      s.report_type === 'audit'
                        ? 'bg-primary/15 text-primary'
                        : 'bg-emerald-500/15 text-emerald-600'
                    }`}
                    title={`${getProjectName(s.project_id)} — ${s.report_type === 'audit' ? 'Audit' : 'Activité'}`}
                  >
                    {getProjectName(s.project_id)}
                  </div>
                ))}
                {items.length > 3 && (
                  <div className="text-[10px] text-muted-foreground text-center">+{items.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-primary" />
          <span>Audit</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span>Activité</span>
        </div>
      </div>
    </div>
  );
};

export default ScheduleCalendarView;
