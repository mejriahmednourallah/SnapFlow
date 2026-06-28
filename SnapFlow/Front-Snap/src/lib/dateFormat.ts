/**
 * Shared date formatters for SnapFlow.
 *
 * Human-visible date format contract:
 *   - date only:        dd/MM/yyyy
 *   - date + time:      dd/MM/yyyy HH:mm
 *
 * Machine values (API payloads, DB, grouping keys) MUST use ISO-8601
 * or other machine formats and MUST NOT go through these helpers.
 */
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

/** Safe parse — returns null for invalid / missing inputs. */
function safeParse(value?: string | Date | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** dd/MM/yyyy — 25/06/2026 */
export function formatDate(value?: string | Date | null): string {
  const date = safeParse(value);
  if (!date) return '-';
  return format(date, 'dd/MM/yyyy', { locale: fr });
}

/** dd/MM/yyyy HH:mm — 25/06/2026 14:30 */
export function formatDateTime(value?: string | Date | null): string {
  const date = safeParse(value);
  if (!date) return '-';
  return format(date, 'dd/MM/yyyy HH:mm', { locale: fr });
}

/** for <input type="datetime-local"> — yyyy-MM-dd'T'HH:mm (machine value, NOT visible text) */
export function formatMachineDateTime(value?: string | Date | null): string {
  const date = safeParse(value) ?? new Date();
  return format(date, "yyyy-MM-dd'T'HH:mm");
}
