/**
 * Tests for shared date formatters (Ticket 5).
 *
 * Contract:
 * - formatDate     → dd/MM/yyyy
 * - formatDateTime → dd/MM/yyyy HH:mm
 * - The shared helpers do NOT handle machine formats (yyyy-MM-dd, ISO-8601).
 */
import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime, formatMachineDateTime } from '@/lib/dateFormat';

describe('formatDate', () => {
  it('returns dd/MM/yyyy for a valid Date', () => {
    expect(formatDate(new Date(2026, 5, 25))).toBe('25/06/2026');
  });

  it('returns dd/MM/yyyy for a valid ISO string', () => {
    expect(formatDate('2026-06-25T14:30:00Z')).toBe('25/06/2026');
  });

  it('returns dd/MM/yyyy for date-only string', () => {
    expect(formatDate('2026-01-03')).toBe('03/01/2026');
  });

  it('returns "-" for null', () => {
    expect(formatDate(null)).toBe('-');
  });

  it('returns "-" for undefined', () => {
    expect(formatDate(undefined)).toBe('-');
  });

  it('returns "-" for empty string', () => {
    expect(formatDate('')).toBe('-');
  });

  it('returns "-" for invalid date string', () => {
    expect(formatDate('not-a-date')).toBe('-');
  });

  it('pads single-digit day and month', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('05/01/2026');
  });
});

describe('formatDateTime', () => {
  it('returns dd/MM/yyyy HH:mm for a valid Date', () => {
    expect(formatDateTime(new Date(2026, 5, 25, 14, 30))).toBe('25/06/2026 14:30');
  });

  it('returns dd/MM/yyyy HH:mm for a valid ISO string', () => {
    expect(formatDateTime('2026-06-25T09:05:00Z')).toMatch(/^25\/06\/2026 \d{2}:\d{2}$/);
  });

  it('returns "-" for null', () => {
    expect(formatDateTime(null)).toBe('-');
  });

  it('returns "-" for undefined', () => {
    expect(formatDateTime(undefined)).toBe('-');
  });

  it('returns "-" for invalid date string', () => {
    expect(formatDateTime('invalid')).toBe('-');
  });

  it('pads single-digit hours and minutes', () => {
    const date = new Date(2026, 5, 25, 9, 5);
    const result = formatDateTime(date);
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  });
});

describe('formatMachineDateTime', () => {
  it('returns yyyy-MM-ddTHH:mm for machine use only', () => {
    expect(formatMachineDateTime(new Date(2026, 5, 25, 14, 30))).toBe('2026-06-25T14:30');
  });
});
