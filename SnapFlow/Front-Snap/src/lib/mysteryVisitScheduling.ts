export interface MysteryVisitWindow {
  windowStart: string;
  windowEnd: string;
  allowedStartHour: number;
  allowedEndHour: number;
}

export function isInsideMysteryVisitWindow(date: Date, window: MysteryVisitWindow): boolean {
  const start = new Date(window.windowStart);
  const end = new Date(window.windowEnd);
  const hour = date.getHours();
  return date >= start && date <= end && hour >= window.allowedStartHour && hour < window.allowedEndHour;
}

export function pickMysteryVisitRunAt(
  window: MysteryVisitWindow,
  existingRuns: string[] = [],
  random = Math.random,
): string {
  const start = new Date(window.windowStart);
  const end = new Date(window.windowEnd);
  const candidates: Date[] = [];

  for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    for (let hour = window.allowedStartHour; hour < window.allowedEndHour; hour += 1) {
      const candidate = new Date(day);
      candidate.setHours(hour, Math.floor(random() * 60), 0, 0);
      if (candidate >= start && candidate <= end) {
        candidates.push(candidate);
      }
    }
  }

  const pool = candidates.length ? candidates : [start];
  const conflictFree = pool.filter((candidate) => existingRuns.every((value) => {
    const other = new Date(value).getTime();
    return Math.abs(candidate.getTime() - other) >= 2 * 60 * 60 * 1000;
  }));
  const selectedPool = conflictFree.length ? conflictFree : pool;
  const selected = selectedPool[Math.floor(random() * selectedPool.length)] ?? pool[0];
  return selected.toISOString();
}
