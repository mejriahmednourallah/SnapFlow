import { useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface CalendarSchedule {
  id: string;
  title: string;
  kind: 'audit' | 'activity' | 'mystery_visit' | 'form_tester';
  frequency: string;
  next_run_at: string;
  is_active: boolean;
}

interface Props {
  schedules: CalendarSchedule[];
}

const ScheduleCalendarView = ({ schedules }: Props) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const schedulesMap = useMemo(() => {
    const map = new Map<string, CalendarSchedule[]>();
    schedules
      .filter((schedule) => schedule.is_active && schedule.next_run_at)
      .forEach((schedule) => {
        const key = format(new Date(schedule.next_run_at), 'yyyy-MM-dd');
        const items = map.get(key) ?? [];
        items.push(schedule);
        map.set(key, items);
      });
    return map;
  }, [schedules]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days: Date[] = [];

  for (let day = calendarStart; day <= calendarEnd; day = addDays(day, 1)) {
    days.push(day);
  }

  return (
    <div className="glass-card p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="text-sm font-semibold capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: fr })}
        </h3>
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((name) => (
          <div key={name} className="py-1 text-center text-xs font-medium text-muted-foreground">
            {name}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const items = schedulesMap.get(key) ?? [];
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isToday = isSameDay(day, new Date());

          return (
            <div
              key={key}
              className={`min-h-[70px] rounded-md border p-1 text-xs transition-colors sm:min-h-[90px] ${
                isCurrentMonth
                  ? 'border-border/50 bg-background'
                  : 'border-border/20 bg-muted/20 opacity-50'
              } ${isToday ? 'ring-1 ring-primary/50' : ''}`}
            >
              <div className={`mb-0.5 font-medium ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                {format(day, 'd')}
              </div>
              <div className="space-y-0.5 overflow-hidden">
                {items.slice(0, 3).map((schedule) => (
                  <div
                    key={schedule.id}
                    className={`truncate rounded px-1 py-0.5 text-[10px] leading-tight ${
                      schedule.kind === 'audit'
                        ? 'bg-primary/15 text-primary'
                        : schedule.kind === 'activity'
                          ? 'bg-emerald-500/15 text-emerald-700'
                          : 'bg-amber-500/15 text-amber-700'
                    }`}
                    title={`${schedule.title} - ${
                      schedule.kind === 'audit'
                        ? 'Audit'
                        : schedule.kind === 'activity'
                          ? 'Activite'
                          : 'Form Tester'
                    }`}
                  >
                    {schedule.title}
                  </div>
                ))}
                {items.length > 3 ? (
                  <div className="text-center text-[10px] text-muted-foreground">+{items.length - 3}</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-primary" />
          <span>Audit</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span>Activite</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          <span>Form Tester</span>
        </div>
      </div>
    </div>
  );
};

export default ScheduleCalendarView;
